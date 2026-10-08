import type { ChannelAdapter, DeliveryContext, DeliveryResult } from "@lifepilot/core";
import type { Logger } from "../config";
import { consoleLogger } from "../config";

export interface StubAdapterConfig {
  logger?: Logger;
}

/**
 * AI_AGENT channel — working stub.
 * Runs end-to-end without any model credentials. To go live: replace the
 * simulated plan with a real agent/LLM runtime call (prompt comes from
 * payload.prompt).
 */
export function createAiAgentStubAdapter(cfg: StubAdapterConfig = {}): ChannelAdapter {
  const logger = cfg.logger ?? consoleLogger();
  return {
    channel: "AI_AGENT",
    description:
      "Working stub: simulates handing the reminder to an AI agent and returns a deterministic plan. Wire a real agent runtime to go live.",
    async deliver(ctx: DeliveryContext): Promise<DeliveryResult> {
      const payload = (ctx.reminder.payload ?? {}) as { prompt?: string };
      const prompt = payload.prompt || `Follow up on: ${ctx.reminder.title}`;
      const plan = [
        `1. Parse objective: ${prompt}`,
        `2. Gather context for reminder ${ctx.reminder.id} (due ${ctx.reminder.dueAt.toISOString()})`,
        "3. Draft and execute the follow-up action",
        "4. Report the outcome back to the user",
      ];
      logger.info({ reminderId: ctx.reminder.id, prompt, plan }, "🤖 [ai-agent stub] simulated run");
      return {
        ok: true,
        detail: {
          stub: true,
          channel: "AI_AGENT",
          prompt,
          plan,
          note: "Simulated agent run — plug a real LLM/agent runtime into apps/worker/src/channels/ai-agent.ts.",
        },
      };
    },
  };
}
