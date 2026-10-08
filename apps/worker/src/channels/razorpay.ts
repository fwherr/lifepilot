import crypto from "node:crypto";
import type { ChannelAdapter, DeliveryContext, DeliveryResult } from "@lifepilot/core";
import type { FetchLike } from "./types";
import { defaultFetch } from "./types";

export interface RazorpayAdapterConfig {
  /** Test-mode keys (rzp_test_...). When absent the adapter simulates orders. */
  keyId?: string;
  keySecret?: string;
  fetchImpl?: FetchLike;
  logger?: (msg: string, meta?: unknown) => void;
}

/**
 * RAZORPAY channel (test mode).
 *
 * deliver() creates a Razorpay *order* for the reminder:
 * - With RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET set (use test keys!): calls the
 *   real sandbox API POST https://api.razorpay.com/v1/orders.
 * - Without keys: generates a clearly-marked simulated order locally, so the
 *   full pipeline (queue → worker → attempt recorded → UI) works offline.
 *
 * Incoming webhook *verification* lives on the API side
 * (POST /webhooks/razorpay) and uses verifyRazorpayWebhookSignature from
 * @lifepilot/core — covered by unit tests in both packages.
 */
export function createRazorpayAdapter(cfg: RazorpayAdapterConfig): ChannelAdapter {
  const doFetch = cfg.fetchImpl ?? defaultFetch;
  const log = cfg.logger ?? (() => {});

  return {
    channel: "RAZORPAY",
    description:
      "Creates a Razorpay order for the reminder (sandbox API with test keys, simulated order otherwise). Webhook signatures are verified by the API at POST /webhooks/razorpay.",
    async deliver(ctx: DeliveryContext): Promise<DeliveryResult> {
      const payload = (ctx.reminder.payload ?? {}) as { amount?: number; currency?: string };
      const amount = payload.amount ?? 10_000;
      const currency = payload.currency ?? "INR";

      if (cfg.keyId && cfg.keySecret) {
        const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
        try {
          const res = await doFetch("https://api.razorpay.com/v1/orders", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Basic ${auth}`,
            },
            body: JSON.stringify({
              amount,
              currency,
              receipt: ctx.reminder.id,
              notes: { reminderId: ctx.reminder.id, title: ctx.reminder.title },
            }),
          });
          const json = (res.json ? await res.json().catch(() => ({})) : {}) as {
            id?: string;
            status?: string;
          };
          if (!res.ok) {
            return {
              ok: false,
              detail: { mode: "razorpay-api", status: res.status, error: json },
            };
          }
          log(`razorpay order created: ${json.id}`, { reminderId: ctx.reminder.id });
          return {
            ok: true,
            detail: {
              mode: "razorpay-api",
              orderId: json.id ?? null,
              status: json.status ?? null,
              amount,
              currency,
              note: "Created via the Razorpay API with test-mode keys.",
            },
          };
        } catch (err) {
          return {
            ok: false,
            detail: {
              mode: "razorpay-api",
              error: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }

      const orderId = `order_sim_${crypto.randomBytes(8).toString("hex")}`;
      log(`razorpay simulated order: ${orderId}`, { reminderId: ctx.reminder.id });
      return {
        ok: true,
        detail: {
          mode: "razorpay-simulated",
          orderId,
          amount,
          currency,
          note: "RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not set — a simulated order was generated locally (no network calls). Set test-mode keys to hit the real sandbox API.",
        },
      };
    },
  };
}
