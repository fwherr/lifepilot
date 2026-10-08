import { describe, expect, it } from "vitest";
import { createWhatsAppStubAdapter } from "../src/channels/whatsapp";
import { createAiAgentStubAdapter } from "../src/channels/ai-agent";
import type { DeliveryContext } from "@lifepilot/core";

function ctx(channel: "WHATSAPP" | "AI_AGENT", payload?: Record<string, unknown>): DeliveryContext {
  return {
    reminder: {
      id: "rem_stub",
      userId: "user_1",
      title: "Book the flight",
      body: "LIS → SHA, window seat",
      dueAt: new Date("2026-10-10T18:00:00.000Z"),
      channel,
      payload: payload ?? {},
    },
    user: { id: "user_1", email: "user@example.com" },
  };
}

describe("whatsapp stub adapter", () => {
  it("records a successful simulated send", async () => {
    const adapter = createWhatsAppStubAdapter();
    const result = await adapter.deliver(ctx("WHATSAPP", { to: "+8613800000000" }));
    expect(result.ok).toBe(true);
    expect(result.detail).toMatchObject({
      stub: true,
      channel: "WHATSAPP",
      to: "+8613800000000",
    });
    expect(String(result.detail.message)).toContain("Book the flight");
  });

  it("falls back to a placeholder recipient when payload.to is absent", async () => {
    const adapter = createWhatsAppStubAdapter();
    const result = await adapter.deliver(ctx("WHATSAPP"));
    expect(result.detail).toMatchObject({ to: "<phone-on-file>" });
  });
});

describe("ai-agent stub adapter", () => {
  it("returns a deterministic simulated plan", async () => {
    const adapter = createAiAgentStubAdapter();
    const result = await adapter.deliver(ctx("AI_AGENT", { prompt: "Rebook if cheaper" }));
    expect(result.ok).toBe(true);
    expect(result.detail).toMatchObject({ stub: true, channel: "AI_AGENT", prompt: "Rebook if cheaper" });
    const plan = result.detail.plan as string[];
    expect(plan).toHaveLength(4);
    expect(plan[0]).toContain("Rebook if cheaper");
  });

  it("defaults the prompt to the reminder title", async () => {
    const adapter = createAiAgentStubAdapter();
    const result = await adapter.deliver(ctx("AI_AGENT"));
    expect(result.detail).toMatchObject({ prompt: "Follow up on: Book the flight" });
  });
});
