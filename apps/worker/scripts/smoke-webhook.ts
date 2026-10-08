/**
 * Smoke test: real HTTP round-trip for the WEBHOOK channel.
 * Spawns the local receiver (scripts/dev-webhook-receiver.mjs), delivers a
 * reminder through the real adapter over localhost HTTP, asserts the receiver
 * validated our HMAC signature (HTTP 200), then tears down.
 *
 * Run from repo root:  pnpm --filter @lifepilot/worker exec tsx scripts/smoke-webhook.ts
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { createWebhookAdapter } from "../src/channels/webhook";

async function main(): Promise<number> {
  const receiverPath = path.resolve(__dirname, "../../../scripts/dev-webhook-receiver.mjs");
  const receiver = spawn(process.execPath, [receiverPath], {
    env: { ...process.env, PORT: "3100", WEBHOOK_SIGNING_SECRET: "dev-webhook-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  receiver.stdout.on("data", (d) => process.stdout.write(`[receiver] ${d}`));
  receiver.stderr.on("data", (d) => process.stderr.write(`[receiver!] ${d}`));

  try {
    await new Promise((r) => setTimeout(r, 800));

    const adapter = createWebhookAdapter({ defaultSecret: "dev-webhook-secret" });
    const result = await adapter.deliver({
      reminder: {
        id: "smoke_1",
        userId: "user_smoke",
        title: "Smoke: signed webhook",
        body: "sent over real HTTP",
        dueAt: new Date(),
        channel: "WEBHOOK",
        payload: { url: "http://localhost:3100/hook" },
      },
      user: { id: "user_smoke", email: "smoke@example.com" },
    });

    const ok = result.ok === true && result.detail["status"] === 200;
    console.log("[smoke] delivery result:", JSON.stringify(result.detail));
    console.log(ok ? "SMOKE_OK: receiver validated our HMAC signature over real HTTP" : "SMOKE_FAILED");
    return ok ? 0 : 1;
  } finally {
    receiver.kill();
  }
}

main().then((code) => process.exit(code));
