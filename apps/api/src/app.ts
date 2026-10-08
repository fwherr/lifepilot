import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { prisma as defaultPrisma, type PrismaClient } from "@lifepilot/db";
import { loadConfig, type ApiConfig } from "./config";
import { BullReminderQueue, type ReminderQueue } from "./lib/queue";
import { MinioObjectStore, type S3Like } from "./lib/s3";
import type { AppDeps } from "./types";
import { registerAuthRoutes } from "./routes/auth";
import { registerReminderRoutes } from "./routes/reminders";
import { registerAttachmentRoutes } from "./routes/attachments";
import { registerWebhookRoutes } from "./routes/webhooks";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export interface AppOverrides {
  config?: Partial<ApiConfig>;
  db?: PrismaClient;
  queue?: ReminderQueue;
  s3?: S3Like;
  logger?: boolean | Record<string, unknown>;
}

/**
 * Builds the Fastify app. All side-effectful collaborators (database, queue,
 * object store) are injectable so tests can run without PostgreSQL, Redis or
 * MinIO.
 */
export async function buildApp(overrides: AppOverrides = {}): Promise<FastifyInstance> {
  const config: ApiConfig = { ...loadConfig(), ...overrides.config };
  const db = overrides.db ?? defaultPrisma;
  const queue = overrides.queue ?? new BullReminderQueue(config.redisUrl);
  const s3 = overrides.s3 ?? new MinioObjectStore(config.s3);
  const deps: AppDeps = { config, db, queue, s3 };

  const app = Fastify({
    logger: overrides.logger ?? { level: config.logLevel },
  });

  await app.register(cors, { origin: config.corsOrigin, credentials: true });

  // Parse JSON while keeping the raw string around — required for verifying
  // Razorpay webhook signatures (they sign the raw bytes, not re-serialized
  // JSON).
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(String(body)));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(fastifyJwt, { secret: config.jwtSecret });

  app.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "lifepilot-api",
    time: new Date().toISOString(),
  }));

  registerAuthRoutes(app, deps);
  registerReminderRoutes(app, deps);
  registerAttachmentRoutes(app, deps);
  registerWebhookRoutes(app, deps);

  return app;
}
