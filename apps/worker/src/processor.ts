import type { ChannelAdapter, DeliveryContext } from "@lifepilot/core";
import type { Prisma, PrismaClient, Reminder, User } from "@lifepilot/db";
import type { Logger } from "./config";

export interface WorkerJobInfo {
  data: { reminderId: string };
  /** BullMQ sets attemptsMade=0 on the first try. */
  attemptsMade: number;
  maxAttempts: number;
}

export interface ProcessorDeps {
  db: PrismaClient;
  adapters: Partial<Record<string, ChannelAdapter>>;
  logger: Logger;
}

export type ProcessOutcome =
  | { status: "delivered"; reminderId: string }
  | { status: "cancelled"; reminderId: string }
  | { status: "not_found"; reminderId: string };

/**
 * Delivers one reminder job:
 * 1. loads the reminder (+owner) — unknown ids are dropped, CANCELLED ones skipped;
 * 2. runs the channel adapter (a throw inside an adapter is caught and recorded);
 * 3. persists a DeliveryAttempt with the adapter's structured detail;
 * 4. marks the reminder DELIVERED on success, FAILED once BullMQ retries are
 *    exhausted (job failures rethrow so BullMQ handles the retry schedule).
 */
export async function processReminderJob(
  deps: ProcessorDeps,
  job: WorkerJobInfo
): Promise<ProcessOutcome> {
  const { db, adapters, logger } = deps;
  const reminderId = job.data.reminderId;

  const reminder = (await db.reminder.findUnique({
    where: { id: reminderId },
    include: { user: true },
  })) as (Reminder & { user: User }) | null;

  if (!reminder) {
    logger.error({ reminderId }, "reminder not found; dropping job");
    return { status: "not_found", reminderId };
  }
  if (reminder.status === "CANCELLED") {
    logger.info({ reminderId }, "reminder cancelled; skipping delivery");
    return { status: "cancelled", reminderId };
  }

  const ctx: DeliveryContext = {
    reminder: {
      id: reminder.id,
      userId: reminder.userId,
      title: reminder.title,
      body: reminder.body,
      dueAt: reminder.dueAt,
      channel: reminder.channel,
      payload: reminder.payload,
    },
    user: { id: reminder.user.id, email: reminder.user.email },
  };

  const adapter = adapters[reminder.channel];
  let result: { ok: boolean; detail: Record<string, unknown> };
  if (!adapter) {
    result = { ok: false, detail: { error: `no adapter registered for channel ${reminder.channel}` } };
  } else {
    try {
      result = await adapter.deliver(ctx);
    } catch (err) {
      result = { ok: false, detail: { error: err instanceof Error ? err.message : String(err) } };
    }
  }

  await db.deliveryAttempt.create({
    data: {
      reminderId: reminder.id,
      channel: reminder.channel,
      status: result.ok ? "SUCCESS" : "FAILED",
      detail: result.detail as Prisma.InputJsonValue,
    },
  });

  if (result.ok) {
    await db.reminder.update({ where: { id: reminder.id }, data: { status: "DELIVERED" } });
    logger.info(
      { reminderId: reminder.id, channel: reminder.channel, detail: result.detail },
      "reminder delivered"
    );
    return { status: "delivered", reminderId: reminder.id };
  }

  const isFinalAttempt = job.attemptsMade + 1 >= job.maxAttempts;
  if (isFinalAttempt) {
    await db.reminder.update({ where: { id: reminder.id }, data: { status: "FAILED" } });
    logger.error(
      { reminderId: reminder.id, channel: reminder.channel, detail: result.detail },
      "reminder delivery failed permanently"
    );
  } else {
    logger.warn(
      { reminderId: reminder.id, channel: reminder.channel, attempt: job.attemptsMade + 1, detail: result.detail },
      "reminder delivery failed; will retry"
    );
  }
  throw new Error(
    `delivery failed for reminder ${reminder.id}: ${JSON.stringify(result.detail).slice(0, 300)}`
  );
}
