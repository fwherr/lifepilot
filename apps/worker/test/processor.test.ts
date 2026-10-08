import { describe, expect, it } from "vitest";
import { processReminderJob } from "../src/processor";
import type { WorkerJobInfo } from "../src/processor";
import type { ChannelAdapter } from "@lifepilot/core";
import type { PrismaClient } from "@lifepilot/db";
import type { Logger } from "../src/config";

/* eslint-disable @typescript-eslint/no-explicit-any */

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function makeFixture(channel = "EMAIL", status = "PENDING") {
  const reminder: any = {
    id: "rem_1",
    userId: "user_1",
    title: "Call mum",
    body: null,
    dueAt: new Date("2026-10-08T12:00:00.000Z"),
    channel,
    status,
    payload: {},
    user: { id: "user_1", email: "user@example.com" },
  };
  const attempts: any[] = [];
  const updates: any[] = [];
  const db = {
    reminder: {
      findUnique: async () => reminder,
      update: async ({ data }: any) => {
        updates.push(data);
        Object.assign(reminder, data);
        return reminder;
      },
    },
    deliveryAttempt: {
      create: async ({ data }: any) => {
        const a = { id: `att_${attempts.length + 1}`, createdAt: new Date(), ...data };
        attempts.push(a);
        return a;
      },
    },
  } as unknown as PrismaClient;
  return { db, reminder, attempts, updates };
}

const okAdapter: ChannelAdapter = {
  channel: "EMAIL",
  description: "test",
  deliver: async () => ({ ok: true, detail: { transport: "console" } }),
};

const failingAdapter: ChannelAdapter = {
  channel: "EMAIL",
  description: "test",
  deliver: async () => ({ ok: false, detail: { error: "endpoint down" } }),
};

const throwingAdapter: ChannelAdapter = {
  channel: "EMAIL",
  description: "test",
  deliver: async () => {
    throw new Error("socket hang up");
  },
};

function job(reminderId: string, attemptsMade = 0, maxAttempts = 3): WorkerJobInfo {
  return { data: { reminderId }, attemptsMade, maxAttempts };
}

describe("processReminderJob", () => {
  it("records a SUCCESS attempt and marks the reminder DELIVERED", async () => {
    const f = makeFixture();
    const outcome = await processReminderJob(
      { db: f.db, adapters: { EMAIL: okAdapter }, logger: silentLogger },
      job("rem_1")
    );

    expect(outcome).toEqual({ status: "delivered", reminderId: "rem_1" });
    expect(f.attempts).toHaveLength(1);
    expect(f.attempts[0]).toMatchObject({ reminderId: "rem_1", channel: "EMAIL", status: "SUCCESS" });
    expect(f.updates).toEqual([{ status: "DELIVERED" }]);
    expect(f.reminder.status).toBe("DELIVERED");
  });

  it("records a FAILED attempt and rethrows on non-final attempts (BullMQ retries)", async () => {
    const f = makeFixture();
    await expect(
      processReminderJob({ db: f.db, adapters: { EMAIL: failingAdapter }, logger: silentLogger }, job("rem_1", 0, 3))
    ).rejects.toThrow(/delivery failed/);

    expect(f.attempts[0]).toMatchObject({ status: "FAILED", detail: { error: "endpoint down" } });
    // not final yet → reminder stays PENDING
    expect(f.updates).toHaveLength(0);
    expect(f.reminder.status).toBe("PENDING");
  });

  it("marks the reminder FAILED when the last attempt also fails", async () => {
    const f = makeFixture();
    await expect(
      processReminderJob({ db: f.db, adapters: { EMAIL: failingAdapter }, logger: silentLogger }, job("rem_1", 2, 3))
    ).rejects.toThrow(/delivery failed/);

    expect(f.updates).toEqual([{ status: "FAILED" }]);
    expect(f.reminder.status).toBe("FAILED");
  });

  it("catches adapter throws and records them as failed attempts", async () => {
    const f = makeFixture();
    await expect(
      processReminderJob({ db: f.db, adapters: { EMAIL: throwingAdapter }, logger: silentLogger }, job("rem_1", 2, 3))
    ).rejects.toThrow(/socket hang up/);
    expect(f.attempts[0]).toMatchObject({ status: "FAILED", detail: { error: "socket hang up" } });
    expect(f.reminder.status).toBe("FAILED");
  });

  it("skips cancelled reminders without delivering or recording attempts", async () => {
    const f = makeFixture("EMAIL", "CANCELLED");
    const outcome = await processReminderJob(
      { db: f.db, adapters: { EMAIL: okAdapter }, logger: silentLogger },
      job("rem_1")
    );
    expect(outcome).toEqual({ status: "cancelled", reminderId: "rem_1" });
    expect(f.attempts).toHaveLength(0);
  });

  it("returns not_found for unknown reminder ids without throwing", async () => {
    const f = makeFixture();
    (f.db as any).reminder.findUnique = async () => null;
    const outcome = await processReminderJob(
      { db: f.db, adapters: { EMAIL: okAdapter }, logger: silentLogger },
      job("ghost")
    );
    expect(outcome).toEqual({ status: "not_found", reminderId: "ghost" });
  });

  it("fails the delivery when no adapter is registered for the channel", async () => {
    const f = makeFixture("WEBHOOK");
    await expect(
      processReminderJob({ db: f.db, adapters: { EMAIL: okAdapter }, logger: silentLogger }, job("rem_1", 2, 3))
    ).rejects.toThrow(/no adapter registered for channel WEBHOOK/);
    expect(f.attempts[0]).toMatchObject({ status: "FAILED", channel: "WEBHOOK" });
    expect(f.reminder.status).toBe("FAILED");
  });
});
