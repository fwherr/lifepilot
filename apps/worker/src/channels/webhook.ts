import {
  signWebhookBody,
  type ChannelAdapter,
  type DeliveryContext,
  type DeliveryResult,
} from "@lifepilot/core";
import type { FetchLike } from "./types";
import { defaultFetch } from "./types";

export interface WebhookAdapterConfig {
  /** Fallback signing secret (WEBHOOK_SIGNING_SECRET env). */
  defaultSecret: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  logger?: (msg: string, meta?: unknown) => void;
}

/**
 * Outgoing WEBHOOK channel.
 * POSTs the reminder as JSON to `payload.url` with an HMAC-SHA256 signature:
 *
 *   x-lifepilot-signature: sha256=<hex hmac(secret, rawBody)>
 *   x-lifepilot-timestamp: <unix seconds>
 *
 * Receivers verify with @lifepilot/core's verifyWebhookSignature — see
 * scripts/dev-webhook-receiver.mjs for a ready-made local receiver.
 */
export function createWebhookAdapter(cfg: WebhookAdapterConfig): ChannelAdapter {
  const doFetch = cfg.fetchImpl ?? defaultFetch;
  const log = cfg.logger ?? (() => {});

  return {
    channel: "WEBHOOK",
    description:
      "POSTs the reminder payload as JSON to payload.url, signed with HMAC-SHA256 (x-lifepilot-signature: sha256=<hex>).",
    async deliver(ctx: DeliveryContext): Promise<DeliveryResult> {
      const payload = (ctx.reminder.payload ?? {}) as { url?: string; secret?: string };
      const url = payload.url;
      if (!url) {
        return {
          ok: false,
          detail: {
            error: "missing_webhook_url",
            hint: "Create the reminder with payload: { url: \"https://your-endpoint/hook\" }",
          },
        };
      }
      const secret = payload.secret || cfg.defaultSecret;
      const body = JSON.stringify({
        id: ctx.reminder.id,
        title: ctx.reminder.title,
        body: ctx.reminder.body,
        dueAt: ctx.reminder.dueAt.toISOString(),
        channel: ctx.reminder.channel,
        deliveredAt: (cfg.now?.() ?? new Date()).toISOString(),
      });
      const headers = {
        "content-type": "application/json",
        "x-lifepilot-signature": signWebhookBody(secret, body),
        "x-lifepilot-timestamp": String(Math.floor((cfg.now?.() ?? new Date()).getTime() / 1000)),
      };

      try {
        const res = await doFetch(url, { method: "POST", headers, body });
        const responseText = res.text ? await res.text().catch(() => undefined) : undefined;
        log(`webhook delivered to ${url}`, { status: res.status });
        return {
          ok: res.ok,
          detail: { url, status: res.status, responseBody: responseText?.slice(0, 500) ?? null },
        };
      } catch (err) {
        return {
          ok: false,
          detail: { url, error: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };
}
