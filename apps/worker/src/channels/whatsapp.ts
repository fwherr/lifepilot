import type { ChannelAdapter, DeliveryContext, DeliveryResult } from "@lifepilot/core";
import type { Logger } from "../config";
import { consoleLogger } from "../config";

export interface StubAdapterConfig {
  logger?: Logger;
}

/**
 * WHATSAPP channel — working stub.
 * Runs end-to-end (schedules → worker → attempt recorded) without touching the
 * WhatsApp network APIs. To go live: implement a Meta Cloud API call inside
 * deliver() using WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID env vars.
 */
export function createWhatsAppStubAdapter(cfg: StubAdapterConfig = {}): ChannelAdapter {
  const logger = cfg.logger ?? consoleLogger();
  return {
    channel: "WHATSAPP",
    description:
      "Working stub: records what would be sent via the WhatsApp Business Cloud API. Implement the Graph API call to go live.",
    async deliver(ctx: DeliveryContext): Promise<DeliveryResult> {
      const payload = (ctx.reminder.payload ?? {}) as { to?: string };
      const to = payload.to || "<phone-on-file>";
      const message = `⏰ Reminder: ${ctx.reminder.title}${
        ctx.reminder.body ? ` — ${ctx.reminder.body}` : ""
      } (due ${ctx.reminder.dueAt.toISOString()})`;
      logger.info({ reminderId: ctx.reminder.id, to, message }, "💬 [whatsapp stub] would send");
      return {
        ok: true,
        detail: {
          stub: true,
          channel: "WHATSAPP",
          to,
          message,
          note: "Simulated send — implement the Meta Cloud API call in apps/worker/src/channels/whatsapp.ts to go live.",
        },
      };
    },
  };
}
