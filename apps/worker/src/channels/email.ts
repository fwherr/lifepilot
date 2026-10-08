import nodemailer from "nodemailer";
import type { ChannelAdapter, DeliveryContext, DeliveryResult } from "@lifepilot/core";
import type { EmailConfig, Logger } from "../config";
import { consoleLogger } from "../config";

/**
 * EMAIL channel.
 * - transport=console (default): "sends" by logging the full email — ideal for
 *   local development and CI, zero credentials required.
 * - transport=smtp: real delivery through the SMTP_* env configuration.
 */
export function createEmailAdapter(
  cfg: EmailConfig,
  logger: Logger = consoleLogger()
): ChannelAdapter {
  return {
    channel: "EMAIL",
    description:
      "Sends reminder emails. EMAIL_TRANSPORT=console logs the email (dev); EMAIL_TRANSPORT=smtp sends via SMTP_HOST etc.",
    async deliver(ctx: DeliveryContext): Promise<DeliveryResult> {
      const payload = (ctx.reminder.payload ?? {}) as { to?: string; subject?: string };
      const to = payload.to || ctx.user.email;
      const subject = payload.subject || `[LifePilot] ${ctx.reminder.title}`;
      const text = [
        `Reminder: ${ctx.reminder.title}`,
        ctx.reminder.body ?? "",
        "",
        `Due: ${ctx.reminder.dueAt.toISOString()}`,
        `Reminder ID: ${ctx.reminder.id}`,
      ]
        .join("\n")
        .trimEnd();

      if (cfg.transport === "console" || !cfg.host) {
        logger.info(
          { reminderId: ctx.reminder.id, to, subject, text, transport: "console" },
          "email delivered via console transport"
        );
        return { ok: true, detail: { transport: "console", to, subject } };
      }

      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port ?? 587,
        secure: cfg.secure ?? false,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      });
      const info = await transporter.sendMail({ from: cfg.from, to, subject, text });
      return {
        ok: true,
        detail: { transport: "smtp", to, subject, messageId: info.messageId ?? null },
      };
    },
  };
}
