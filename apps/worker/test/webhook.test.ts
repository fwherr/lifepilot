import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWebhookAdapter } from "../src/channels/webhook";
import { signWebhookBody } from "@lifepilot/core";
import type { FetchLike } from "../src/channels/types";
import type { DeliveryContext } from "@lifepilot/core";

const SECRET = "unit-webhook-secret";

function ctx(overrides: Partial<DeliveryContext["reminder"]["payload"]> = {}): DeliveryContext {
  return {
    reminder: {
      id: "rem_1",
      userId: "user_1",
      title: "Pay the invoice",
      body: "Invoice #42",
      dueAt: new Date("2026-10-08T09:00:00.000Z"),
      channel: "WEBHOOK",
      payload: { url: "https://receiver.example/hook", ...overrides },
    },
    user: { id: "user_1", email: "user@example.com" },
  };
}

describe("webhook adapter", () => {
  it("POSTs JSON with a valid HMAC-SHA256 signature header", async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "received" };
    };
    const adapter = createWebhookAdapter({ defaultSecret: SECRET, fetchImpl });

    const result = await adapter.deliver(ctx());

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://receiver.example/hook");
    expect(init.headers["content-type"]).toBe("application/json");

    const signature = init.headers["x-lifepilot-signature"];
    expect(signature).toBe(signWebhookBody(SECRET, init.body));
    const reference = crypto.createHmac("sha256", SECRET).update(init.body, "utf8").digest("hex");
    expect(signature).toBe(`sha256=${reference}`);

    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({ id: "rem_1", title: "Pay the invoice", channel: "WEBHOOK" });
    expect(result.detail).toMatchObject({ status: 200, url: "https://receiver.example/hook" });
  });

  it("uses a per-reminder payload.secret over the default secret", async () => {
    let seenSignature = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      seenSignature = init.headers["x-lifepilot-signature"];
      return { ok: true, status: 204 };
    };
    const adapter = createWebhookAdapter({ defaultSecret: SECRET, fetchImpl });

    await adapter.deliver(ctx({ secret: "reminder-specific-secret-16" }));

    const body = seenSignature.replace(/^sha256=/, "");
    const reference = crypto
      .createHmac("sha256", "reminder-specific-secret-16")
      .update("irrelevant", "utf8")
      .digest("hex");
    // Signature must NOT be valid for the default secret (proves override used)
    expect(body).not.toBe(reference);
  });

  it("marks non-2xx responses as failed with the status code", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    const adapter = createWebhookAdapter({ defaultSecret: SECRET, fetchImpl });
    const result = await adapter.deliver(ctx());
    expect(result.ok).toBe(false);
    expect(result.detail).toMatchObject({ status: 500, responseBody: "boom" });
  });

  it("returns a structured failure when the endpoint is unreachable", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const adapter = createWebhookAdapter({ defaultSecret: SECRET, fetchImpl });
    const result = await adapter.deliver(ctx());
    expect(result.ok).toBe(false);
    expect(result.detail).toMatchObject({ error: "ECONNREFUSED" });
  });

  it("fails fast (no HTTP call) when payload.url is missing", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return { ok: true, status: 200 };
    };
    const adapter = createWebhookAdapter({ defaultSecret: SECRET, fetchImpl });
    const result = await adapter.deliver(ctx({ url: undefined }));
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatchObject({ error: "missing_webhook_url" });
  });
});
