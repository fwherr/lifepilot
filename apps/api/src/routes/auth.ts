import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../types";
import { hashPassword, verifyPassword } from "../lib/passwords";
import { generateRefreshToken, hashToken } from "../lib/tokens";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(16),
});

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;

  const issueTokens = async (userId: string) => {
    const refresh = generateRefreshToken(config.refreshTokenTtlDays);
    await db.refreshToken.create({
      data: { tokenHash: refresh.tokenHash, expiresAt: refresh.expiresAt, userId },
    });
    const accessToken = app.jwt.sign({ sub: userId }, { expiresIn: config.accessTokenTtl });
    return { accessToken, refreshToken: refresh.token };
  };

  app.post("/auth/register", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "email_already_registered" });
    }
    const user = await db.user.create({
      data: { email, passwordHash: await hashPassword(password) },
    });
    const tokens = await issueTokens(user.id);
    return reply.code(201).send({ user: { id: user.id, email: user.email }, ...tokens });
  });

  app.post("/auth/login", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const tokens = await issueTokens(user.id);
    return { user: { id: user.id, email: user.email }, ...tokens };
  });

  app.post("/auth/refresh", async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { refreshToken } = parsed.data;
    const stored = await db.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      return reply.code(401).send({ error: "invalid_refresh_token" });
    }
    // Rotation: revoke the presented token, issue a fresh pair.
    await db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await issueTokens(stored.userId);
    return { user: { id: stored.user.id, email: stored.user.email }, ...tokens };
  });

  app.post("/auth/logout", { preHandler: app.authenticate }, async (req, reply) => {
    const body = (req.body ?? {}) as { refreshToken?: string };
    if (body.refreshToken) {
      await db.refreshToken.updateMany({
        where: { tokenHash: hashToken(body.refreshToken), userId: req.user.sub },
        data: { revokedAt: new Date() },
      });
    }
    return reply.code(204).send();
  });
}
