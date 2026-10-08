import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Channel, Prisma } from "@lifepilot/db";
import {
  aiAgentPayloadSchema,
  emailPayloadSchema,
  razorpayPayloadSchema,
  webhookPayloadSchema,
  whatsappPayloadSchema,
} from "@lifepilot/core";
import type { AppDeps } from "../types";

const createReminderSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(5000).nullish(),
  dueAt: z.coerce.date(),
  channel: z.nativeEnum(Channel),
  payload: z.record(z.unknown()).nullish(),
});

const idParam = (req: { params: unknown }): string =>
  (req.params as { id: string }).id;

/**
 * Validates and normalizes the channel-specific payload, filling sensible
 * defaults. Throws ZodError when the payload is invalid for the channel.
 */
function normalizePayload(
  channel: Channel,
  raw: unknown,
  userEmail: string,
  reminderTitle: string,
  deps: AppDeps
): Prisma.InputJsonValue | undefined {
  switch (channel) {
    case Channel.EMAIL: {
      const p = emailPayloadSchema.default({}).parse(raw ?? {});
      return { to: p.to ?? userEmail, subject: p.subject ?? `[LifePilot] ${reminderTitle}` };
    }
    case Channel.WEBHOOK: {
      // url is required here on purpose — a webhook without a target is a bug.
      const p = webhookPayloadSchema.parse(raw ?? {});
      return { url: p.url, secret: p.secret ?? deps.config.webhookSigningSecret };
    }
    case Channel.WHATSAPP: {
      const p = whatsappPayloadSchema.default({}).parse(raw ?? {});
      return { to: p.to ?? "" };
    }
    case Channel.AI_AGENT: {
      const p = aiAgentPayloadSchema.default({}).parse(raw ?? {});
      return { prompt: p.prompt ?? "" };
    }
    case Channel.RAZORPAY: {
      const p = razorpayPayloadSchema.default({}).parse(raw ?? {});
      return { amount: p.amount ?? 10_000, currency: p.currency ?? "INR" };
    }
  }
}

export function registerReminderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, queue } = deps;

  app.get("/reminders", { preHandler: app.authenticate }, async (req) => {
    const reminders = await db.reminder.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: "desc" },
      include: {
        attempts: { orderBy: { createdAt: "desc" }, take: 3 },
        _count: { select: { attempts: true, attachments: true } },
      },
    });
    return { reminders };
  });

  app.post("/reminders", { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = createReminderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    const user = await db.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    let payload: Prisma.InputJsonValue | undefined;
    try {
      payload = normalizePayload(parsed.data.channel, parsed.data.payload ?? undefined, user.email, parsed.data.title, deps);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: "validation_error", details: err.flatten() });
      }
      throw err;
    }

    const reminder = await db.reminder.create({
      data: {
        userId: user.id,
        title: parsed.data.title,
        body: parsed.data.body ?? null,
        dueAt: parsed.data.dueAt,
        channel: parsed.data.channel,
        status: "PENDING",
        payload,
      },
    });
    // BullMQ delayed job — fires at dueAt (immediately if dueAt is in the past).
    await queue.scheduleReminder(reminder.id, reminder.dueAt);
    return reply.code(201).send({ reminder });
  });

  app.get("/reminders/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const reminder = await db.reminder.findFirst({
      where: { id: idParam(req), userId: req.user.sub },
      include: {
        attempts: { orderBy: { createdAt: "desc" } },
        attachments: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!reminder) return reply.code(404).send({ error: "not_found" });
    return { reminder };
  });

  app.delete("/reminders/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = await db.reminder.updateMany({
      where: { id, userId: req.user.sub, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      return reply.code(404).send({ error: "not_found_or_not_cancellable" });
    }
    await queue.cancelReminder(id);
    return reply.code(204).send();
  });
}
