import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createFakeDb } from "./helpers/fake-db";
import { createFakeQueue } from "./helpers/fakes";

const fakeDb = createFakeDb();
const { queue, scheduled, cancelled } = createFakeQueue();
let app: FastifyInstance;
let token1 = "";
let token2 = "";

async function registerAndLogin(email: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "password-123" },
  });
  return res.json().accessToken as string;
}

beforeAll(async () => {
  app = await buildApp({ db: fakeDb.db, queue, logger: false });
  token1 = await registerAndLogin("owner@example.com");
  token2 = await registerAndLogin("intruder@example.com");
});

describe("reminder routes", () => {
  it("creates an EMAIL reminder and defaults payload.to to the user email", async () => {
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
      payload: { title: "Call the dentist", dueAt, channel: "EMAIL" },
    });
    expect(res.statusCode).toBe(201);
    const reminder = res.json().reminder;
    expect(reminder.status).toBe("PENDING");
    expect(reminder.payload).toEqual({ to: "owner@example.com", subject: "[LifePilot] Call the dentist" });

    // The queue received exactly one scheduled job for this reminder.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.reminderId).toBe(reminder.id);
  });

  it("requires payload.url for WEBHOOK reminders (422 without it)", async () => {
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    const missing = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
      payload: { title: "Hook me", dueAt, channel: "WEBHOOK" },
    });
    expect(missing.statusCode).toBe(422);

    const ok = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
      payload: { title: "Hook me", dueAt, channel: "WEBHOOK", payload: { url: "https://example.com/hook" } },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().reminder.payload.secret).toBe("dev-webhook-secret");
  });

  it("keeps explicit RAZORPAY amounts and fills defaults otherwise", async () => {
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    const explicit = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
      payload: { title: "Renew domain", dueAt, channel: "RAZORPAY", payload: { amount: 49900, currency: "INR" } },
    });
    expect(explicit.json().reminder.payload).toEqual({ amount: 49900, currency: "INR" });

    const defaults = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
      payload: { title: "Renew VPS", dueAt, channel: "RAZORPAY" },
    });
    expect(defaults.json().reminder.payload).toEqual({ amount: 10000, currency: "INR" });
  });

  it("rejects malformed dueAt and unknown channels with 422", async () => {
    const badDate = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
      payload: { title: "x", dueAt: "not-a-date", channel: "EMAIL" },
    });
    expect(badDate.statusCode).toBe(422);

    const badChannel = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
      payload: { title: "x", dueAt: new Date().toISOString(), channel: "CARRIER_PIGEON" },
    });
    expect(badChannel.statusCode).toBe(422);
  });

  it("lists only the caller's reminders", async () => {
    const list1 = await app.inject({
      method: "GET",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
    });
    const list2 = await app.inject({
      method: "GET",
      url: "/reminders",
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(list1.json().reminders.length).toBeGreaterThan(0);
    expect(list2.json().reminders).toHaveLength(0);
    for (const r of list1.json().reminders) {
      expect(r.userId).toBe(fakeDb.users.find((u) => u.email === "owner@example.com")!.id);
    }
  });

  it("returns the detail with attempts and attachments for the owner only", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
    });
    const id = list.json().reminders[0].id;

    const ownerView = await app.inject({
      method: "GET",
      url: `/reminders/${id}`,
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(ownerView.statusCode).toBe(200);
    expect(ownerView.json().reminder.attempts).toEqual([]);
    expect(ownerView.json().reminder.attachments).toEqual([]);

    const intruderView = await app.inject({
      method: "GET",
      url: `/reminders/${id}`,
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(intruderView.statusCode).toBe(404);
  });

  it("cancels a pending reminder and removes its queued job", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: { authorization: `Bearer ${token1}` },
      payload: { title: "To be cancelled", dueAt: new Date(Date.now() + 600_000).toISOString(), channel: "EMAIL" },
    });
    const id = created.json().reminder.id;

    const del = await app.inject({
      method: "DELETE",
      url: `/reminders/${id}`,
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(del.statusCode).toBe(204);
    expect(cancelled).toContain(id);

    const again = await app.inject({
      method: "DELETE",
      url: `/reminders/${id}`,
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(again.statusCode).toBe(404);
  });

  it("refuses unauthenticated access", async () => {
    const res = await app.inject({ method: "GET", url: "/reminders" });
    expect(res.statusCode).toBe(401);
  });
});
