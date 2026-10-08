import type { ReminderQueue } from "../../src/lib/queue";
import type { S3Like } from "../../src/lib/s3";

export function createFakeQueue() {
  const scheduled: { reminderId: string; dueAt: Date }[] = [];
  const cancelled: string[] = [];
  const queue: ReminderQueue = {
    scheduleReminder: async (reminderId, dueAt) => {
      scheduled.push({ reminderId, dueAt });
    },
    cancelReminder: async (reminderId) => {
      cancelled.push(reminderId);
    },
    close: async () => {},
  };
  return { queue, scheduled, cancelled };
}

export function createFakeS3() {
  const puts: { key: string; body: Buffer; contentType: string }[] = [];
  const s3: S3Like = {
    ensureBucket: async () => {},
    putObject: async (key, body, contentType) => {
      puts.push({ key, body, contentType });
    },
    presignDownload: async (key) => `http://fake-s3.local/signed/${key}`,
  };
  return { s3, puts };
}
