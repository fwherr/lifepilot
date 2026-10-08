import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@lifepilot/db";
import { consoleLogger, loadConfig } from "./config";
import { createEmailAdapter } from "./channels/email";
import { createWhatsAppStubAdapter } from "./channels/whatsapp";
import { createAiAgentStubAdapter } from "./channels/ai-agent";
import { createWebhookAdapter } from "./channels/webhook";
import { createRazorpayAdapter } from "./channels/razorpay";
import { processReminderJob } from "./processor";
import type { ChannelAdapter } from "@lifepilot/core";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = consoleLogger(config.logLevel);
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  const adapters: Record<string, ChannelAdapter> = {
    EMAIL: createEmailAdapter(config.email),
    WHATSAPP: createWhatsAppStubAdapter({ logger }),
    AI_AGENT: createAiAgentStubAdapter({ logger }),
    WEBHOOK: createWebhookAdapter({ defaultSecret: config.webhookSigningSecret }),
    RAZORPAY: createRazorpayAdapter(config.razorpay),
  };

  const worker = new Worker(
    config.queueName,
    async (job) =>
      processReminderJob(
        { db: prisma, adapters, logger },
        {
          data: job.data as { reminderId: string },
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 1,
        }
      ),
    { connection, concurrency: config.concurrency }
  );

  worker.on("completed", (job) => logger.info({ jobId: job.id }, "job completed"));
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id ?? null, error: err.message }, "job failed")
  );

  const shutdown = async () => {
    logger.info({}, "worker shutting down");
    await worker.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  logger.info(
    { queue: config.queueName, concurrency: config.concurrency, redis: config.redisUrl },
    "lifepilot worker started"
  );
}

void main();
