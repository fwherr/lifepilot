import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";

export const REMINDER_QUEUE_NAME = "reminders";

/** Producer side of the delivery queue; injectable for tests. */
export interface ReminderQueue {
  scheduleReminder(reminderId: string, dueAt: Date): Promise<void>;
  cancelReminder(reminderId: string): Promise<void>;
  close(): Promise<void>;
}

export class BullReminderQueue implements ReminderQueue {
  private readonly queue: Queue;
  private readonly connection: Redis;

  constructor(redisUrl: string) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(REMINDER_QUEUE_NAME, { connection: this.connection });
  }

  async scheduleReminder(reminderId: string, dueAt: Date): Promise<void> {
    const delay = Math.max(0, dueAt.getTime() - Date.now());
    await this.queue.add(
      "deliver",
      { reminderId },
      {
        // Deterministic job id => re-creating a reminder never duplicates jobs.
        jobId: `reminder:${reminderId}`,
        delay,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1_000 },
      }
    );
  }

  async cancelReminder(reminderId: string): Promise<void> {
    const job = await this.queue.getJob(`reminder:${reminderId}`);
    if (!job) return;
    try {
      await job.remove();
    } catch {
      // Job already completed/removed — nothing to cancel.
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
