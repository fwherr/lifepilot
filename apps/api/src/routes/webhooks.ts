import type { FastifyInstance } from "fastify";
import { verifyRazorpayWebhookSignature } from "@lifepilot/core";
import type { AppDeps } from "../types";

/**
 * Razorpay webhook receiver.
 * Razorpay signs the raw request body with HMAC-SHA256 using the webhook
 * secret and sends it in the `x-razorpay-signature` header. We verify that
 * signature against the *raw* body (kept by our content-type parser) before
 * trusting anything.
 */
export function registerWebhookRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/webhooks/razorpay", async (req, reply) => {
    const secret = deps.config.razorpayWebhookSecret;
    if (!secret) {
      return reply.code(503).send({ error: "razorpay_webhook_not_configured" });
    }
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";
    const signature = req.headers["x-razorpay-signature"];
    if (
      typeof signature !== "string" ||
      !verifyRazorpayWebhookSignature(rawBody, signature, secret)
    ) {
      return reply.code(401).send({ error: "invalid_signature" });
    }
    req.log.info({ event: "razorpay_webhook_verified" }, "razorpay webhook signature verified");
    return { received: true };
  });
}
