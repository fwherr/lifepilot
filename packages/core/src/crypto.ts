import crypto from "node:crypto";

/** Hex-encoded HMAC-SHA256 of a raw string body. */
export function hmacSha256Hex(secret: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests; false on length mismatch. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Outgoing webhook signature helper.
 * Signature format: `sha256=<hex hmac-sha256(secret, rawBody)>`.
 * Headers sent by the worker:
 *   x-lifepilot-signature: sha256=<...>
 *   x-lifepilot-timestamp: <unix seconds>
 */
export function signWebhookBody(secret: string, rawBody: string): string {
  return `sha256=${hmacSha256Hex(secret, rawBody)}`;
}

/** Verify an `sha256=<hex>` style signature against a raw body. */
export function verifyWebhookSignature(
  signatureHeader: string | undefined | null,
  secret: string,
  rawBody: string
): boolean {
  if (!signatureHeader) return false;
  const expected = signWebhookBody(secret, rawBody);
  return timingSafeEqualHex(expected, signatureHeader);
}

/**
 * Razorpay webhook verification (test mode).
 * Razorpay sends the hex HMAC-SHA256 of the *raw* request body, computed with
 * the webhook secret, in the `x-razorpay-signature` header.
 * See: https://razorpay.com/docs/webhooks/validate/
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string
): boolean {
  if (!rawBody || !signature || !webhookSecret) return false;
  const expected = hmacSha256Hex(webhookSecret, rawBody);
  return timingSafeEqualHex(expected, signature);
}
