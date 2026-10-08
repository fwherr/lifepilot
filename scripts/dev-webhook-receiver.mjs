#!/usr/bin/env node
/**
 * Minimal local webhook receiver for the LifePilot WEBHOOK channel.
 *
 * Verifies the HMAC-SHA256 signature header
 *   x-lifepilot-signature: sha256=<hex hmac(secret, rawBody)>
 * against WEBHOOK_SIGNING_SECRET and prints every delivery it receives.
 *
 * Usage:
 *   node scripts/dev-webhook-receiver.mjs
 *   PORT=3200 WEBHOOK_SIGNING_SECRET=dev-webhook-secret node scripts/dev-webhook-receiver.mjs
 *
 * Then create a reminder with channel WEBHOOK and payload
 *   { "url": "http://localhost:3100/hook" }
 * and watch the signature being verified here.
 */
import crypto from "node:crypto";
import http from "node:http";

const SECRET = process.env.WEBHOOK_SIGNING_SECRET || "dev-webhook-secret";
const PORT = Number(process.env.PORT || 3100);

http
  .createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const signature = req.headers["x-lifepilot-signature"] || "";
      const expected =
        "sha256=" + crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
      const valid =
        typeof signature === "string" &&
        signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

      console.log(`\n--- webhook @ ${new Date().toISOString()} ---`);
      console.log("signature:", valid ? "VALID" : `INVALID (got: ${signature})`);
      try {
        console.log("payload:", JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        console.log("payload(raw):", raw);
      }

      res.writeHead(valid ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(valid ? { received: true } : { error: "invalid_signature" }));
    });
  })
  .listen(PORT, () => {
    console.log(
      `Webhook receiver listening on http://localhost:${PORT} (verifying with WEBHOOK_SIGNING_SECRET)`
    );
  });
