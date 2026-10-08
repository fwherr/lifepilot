import { describe, expect, it } from "vitest";
import { createEmailAdapter } from "../src/channels/email";
import type { EmailConfig, Logger } from "../src/config";
import type { DeliveryContext } from "@lifepilot/core";

function emailCtx(payload?: Record<string, unknown>): DeliveryContext {
  return {
    reminder: {
      id: "rem_mail",
      userId: "user_1",
      title: "Water the plants",
      body: "Monstera + ferns",
      dueAt: new Date("2026-10-08T08:30:00.000Z"),
      channel: "EMAIL",
      payload: payload ?? {},
    },
    user: { id: "user_1", email: "owner@example.com" },
  };
}

function spyLogger(): { logger: Logger; lines: { level: string; msg: string; obj?: unknown }[] } {
  const lines: { level: string; msg: string; obj?: unknown }[] = [];
  const logger: Logger = {
    info: (obj, msg) => lines.push({ level: "info", msg: msg ?? "", obj }),
    warn: (obj, msg) => lines.push({ level: "warn", msg: msg ?? "", obj }),
    error: (obj, msg) => lines.push({ level: "error", msg: msg ?? "", obj }),
  };
  return { logger, lines };
}

const consoleCfg: EmailConfig = { transport: "console", from: "LifePilot <no-reply@lifepilot.local>" };

describe("email adapter — console transport", () => {
  it("succeeds and defaults the recipient to the account email", async () => {
    const { logger, lines } = spyLogger();
    const adapter = createEmailAdapter(consoleCfg, logger);

    const result = await adapter.deliver(emailCtx());

    expect(result.ok).toBe(true);
    expect(result.detail).toMatchObject({ transport: "console", to: "owner@example.com", subject: "[LifePilot] Water the plants" });
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0]!.obj)).toContain("Water the plants");
  });

  it("honours payload.to and payload.subject overrides", async () => {
    const { logger, lines } = spyLogger();
    const adapter = createEmailAdapter(consoleCfg, logger);

    const result = await adapter.deliver(
      emailCtx({ to: "someone-else@example.com", subject: "Plants need water NOW" })
    );

    expect(result.detail).toMatchObject({
      transport: "console",
      to: "someone-else@example.com",
      subject: "Plants need water NOW",
    });
    expect(JSON.stringify(lines[0]!.obj)).toContain("someone-else@example.com");
  });

  it("falls back to console when transport=smtp but SMTP_HOST is empty", async () => {
    const { logger } = spyLogger();
    const adapter = createEmailAdapter({ ...consoleCfg, transport: "smtp", host: undefined }, logger);
    const result = await adapter.deliver(emailCtx());
    expect(result.detail).toMatchObject({ transport: "console" });
  });
});
