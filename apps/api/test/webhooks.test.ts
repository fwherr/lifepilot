import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createFakeDb } from "./helpers/fake-db";
import { createFakeQueue } from "./helpers/fakes";

const SECRET = "test-razorpay-webhook-secret";
let app: FastifyInstance;
let appWithoutSecret: FastifyInstance;

beforeAll(async () => {
  const { db } = createFakeDb();
  const { queue } = createFakeQueue();
  app = await buildApp({
    db,
    queue,
    logger: false,
    config: { razorpayWebhookSecret: SECRET },
  });
  const { db: db2 } = createFakeDb();
  const { queue: queue2 } = createFakeQueue();
  appWithoutSecret = await buildApp({
    db: db2,
    queue: queue2,
    logger: false,
    config: { razorpayWebhookSecret: "" },
  });
});

function signed(rawBody: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

describe("POST /webhooks/razorpay", () => {
  const event = JSON.stringify({ event: "payment.captured", payload: { amount: 49900 } });

  it("accepts a correctly signed webhook (200 received:true)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signed(event),
      },
      payload: event,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
  });

  it("rejects a tampered body (401 invalid_signature)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signed(event),
      },
      payload: event + " ", // one extra byte breaks the signature
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_signature");
  });

  it("rejects a wrong signature and a missing header (401)", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/webhooks/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signed(event, "some-other-secret"),
      },
      payload: event,
    });
    expect(wrong.statusCode).toBe(401);

    const missing = await app.inject({
      method: "POST",
      url: "/webhooks/razorpay",
      headers: { "content-type": "application/json" },
      payload: event,
    });
    expect(missing.statusCode).toBe(401);
  });

  it("reports 503 when no webhook secret is configured", async () => {
    const res = await appWithoutSecret.inject({
      method: "POST",
      url: "/webhooks/razorpay",
      headers: { "content-type": "application/json", "x-razorpay-signature": signed(event) },
      payload: event,
    });
    expect(res.statusCode).toBe(503);
  });
});
