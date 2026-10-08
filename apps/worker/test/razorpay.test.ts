import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRazorpayAdapter } from "../src/channels/razorpay";
import { verifyRazorpayWebhookSignature } from "@lifepilot/core";
import type { FetchLike } from "../src/channels/types";
import type { DeliveryContext } from "@lifepilot/core";

function ctx(amount?: number, currency?: string): DeliveryContext {
  return {
    reminder: {
      id: "rem_rzp",
      userId: "user_1",
      title: "Renew domain",
      body: null,
      dueAt: new Date("2026-10-09T09:00:00.000Z"),
      channel: "RAZORPAY",
      payload: amount ? { amount, currency } : {},
    },
    user: { id: "user_1", email: "user@example.com" },
  };
}

describe("razorpay webhook signature verification (@lifepilot/core contract)", () => {
  const rawBody = JSON.stringify({ event: "order.paid", payload: { order: { id: "order_x" } } });
  const secret = "rzp-webhook-secret";

  it("accepts the exact HMAC-SHA256 hex signature of the raw body", () => {
    const signature = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    expect(verifyRazorpayWebhookSignature(rawBody, signature, secret)).toBe(true);
  });

  it("rejects tampered payloads, wrong secrets and empty inputs", () => {
    const signature = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    expect(verifyRazorpayWebhookSignature(rawBody + " ", signature, secret)).toBe(false);
    expect(verifyRazorpayWebhookSignature(rawBody, signature, "another-secret")).toBe(false);
    expect(verifyRazorpayWebhookSignature(rawBody, "", secret)).toBe(false);
    expect(verifyRazorpayWebhookSignature(rawBody, signature, "")).toBe(false);
  });
});

describe("razorpay adapter — simulated mode (no keys configured)", () => {
  it("creates a clearly-marked simulated order without any network call", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return { ok: true, status: 200 };
    };
    const adapter = createRazorpayAdapter({ fetchImpl });

    const result = await adapter.deliver(ctx());

    expect(called).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.detail.mode).toBe("razorpay-simulated");
    expect(String(result.detail.orderId)).toMatch(/^order_sim_[0-9a-f]{16}$/);
    expect(result.detail).toMatchObject({ amount: 10000, currency: "INR" });
  });
});

describe("razorpay adapter — API mode (test keys configured)", () => {
  it("calls the orders API with basic auth and the reminder as receipt", async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "order_test123", status: "created" }),
      };
    };
    const adapter = createRazorpayAdapter({
      keyId: "rzp_test_keyid",
      keySecret: "rzp_test_secret",
      fetchImpl,
    });

    const result = await adapter.deliver(ctx(49900, "INR"));

    expect(result.ok).toBe(true);
    expect(result.detail).toMatchObject({
      mode: "razorpay-api",
      orderId: "order_test123",
      status: "created",
      amount: 49900,
      currency: "INR",
    });
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    const expectedAuth = Buffer.from("rzp_test_keyid:rzp_test_secret").toString("base64");
    expect(init.headers.authorization).toBe(`Basic ${expectedAuth}`);
    expect(JSON.parse(init.body)).toMatchObject({ amount: 49900, currency: "INR", receipt: "rem_rzp" });
  });

  it("surfaces API errors as failed deliveries", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { description: "Authentication failed" } }),
    });
    const adapter = createRazorpayAdapter({
      keyId: "rzp_test_keyid",
      keySecret: "wrong-secret",
      fetchImpl,
    });
    const result = await adapter.deliver(ctx());
    expect(result.ok).toBe(false);
    expect(result.detail).toMatchObject({ mode: "razorpay-api", status: 401 });
  });

  it("treats network errors as failed deliveries", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const adapter = createRazorpayAdapter({
      keyId: "rzp_test_keyid",
      keySecret: "rzp_test_secret",
      fetchImpl,
    });
    const result = await adapter.deliver(ctx());
    expect(result.ok).toBe(false);
    expect(result.detail).toMatchObject({ error: "getaddrinfo ENOTFOUND" });
  });
});
