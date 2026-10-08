import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../src/lib/passwords";
import {
  generateRefreshToken,
  hashToken,
} from "../src/lib/tokens";
import {
  hmacSha256Hex,
  signWebhookBody,
  timingSafeEqualHex,
  verifyRazorpayWebhookSignature,
  verifyWebhookSignature,
} from "@lifepilot/core";

describe("passwords", () => {
  it("hashes with bcrypt and verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});

describe("refresh tokens", () => {
  it("generates an opaque token whose stored form is its sha-256 hash", () => {
    const { token, tokenHash, expiresAt } = generateRefreshToken(7);
    expect(token).toMatch(/^[0-9a-f]{96}$/);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const expectedExpiry = Date.now() + 7 * 86_400_000;
    expect(Math.abs(expiresAt.getTime() - expectedExpiry)).toBeLessThan(5_000);
  });

  it("produces different tokens on every call", () => {
    const a = generateRefreshToken(7);
    const b = generateRefreshToken(7);
    expect(a.token).not.toBe(b.token);
  });
});

describe("hmac utilities (@lifepilot/core)", () => {
  const secret = "unit-test-secret";
  const body = JSON.stringify({ event: "payment.captured", amount: 12345 });

  it("hmacSha256Hex matches node crypto reference implementation", () => {
    const expected = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(hmacSha256Hex(secret, body)).toBe(expected);
  });

  it("signWebhookBody / verifyWebhookSignature round-trip", () => {
    const signature = signWebhookBody(secret, body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(signature, secret, body)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets and missing headers", () => {
    const signature = signWebhookBody(secret, body);
    expect(verifyWebhookSignature(signature, secret, body + " ")).toBe(false);
    expect(verifyWebhookSignature(signature, "other-secret", body)).toBe(false);
    expect(verifyWebhookSignature(undefined, secret, body)).toBe(false);
    expect(verifyWebhookSignature("sha256=deadbeef", secret, body)).toBe(false);
  });

  it("timingSafeEqualHex is false for different lengths", () => {
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
  });

  it("verifyRazorpayWebhookSignature accepts the correct signature only", () => {
    const good = crypto.createHmac("sha256", "whs").update(body, "utf8").digest("hex");
    const bad = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
    expect(verifyRazorpayWebhookSignature(body, good, "whs")).toBe(true);
    expect(verifyRazorpayWebhookSignature(body, bad, "whs")).toBe(false);
    expect(verifyRazorpayWebhookSignature(body, good, "")).toBe(false);
    expect(verifyRazorpayWebhookSignature("", good, "whs")).toBe(false);
  });
});
