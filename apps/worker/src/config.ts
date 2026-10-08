import "dotenv/config";

export interface EmailConfig {
  transport: "console" | "smtp";
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface WorkerConfig {
  redisUrl: string;
  queueName: string;
  concurrency: number;
  logLevel: string;
  email: EmailConfig;
  webhookSigningSecret: string;
  razorpay: { keyId?: string; keySecret?: string };
}

export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const transport: EmailConfig["transport"] = env.EMAIL_TRANSPORT === "smtp" ? "smtp" : "console";
  return {
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    queueName: env.QUEUE_NAME ?? "reminders",
    concurrency: Number(env.WORKER_CONCURRENCY ?? 5),
    logLevel: env.LOG_LEVEL ?? "info",
    email: {
      transport,
      host: env.SMTP_HOST || undefined,
      port: env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined,
      secure: env.SMTP_SECURE === "true",
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
      from: env.EMAIL_FROM ?? "LifePilot <no-reply@lifepilot.local>",
    },
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET ?? "dev-webhook-secret",
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID || undefined,
      keySecret: env.RAZORPAY_KEY_SECRET || undefined,
    },
  };
}

export function consoleLogger(level: string = "info"): Logger {
  const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
  const min = (order as Record<string, number>)[level] ?? 20;
  return {
    info: (obj, msg) => {
      if (min <= 20) console.log(JSON.stringify({ level: "info", msg: msg ?? "", ...(typeof obj === "object" ? obj : { obj }) }));
    },
    warn: (obj, msg) => {
      if (min <= 30) console.warn(JSON.stringify({ level: "warn", msg: msg ?? "", ...(typeof obj === "object" ? obj : { obj }) }));
    },
    error: (obj, msg) => {
      console.error(JSON.stringify({ level: "error", msg: msg ?? "", ...(typeof obj === "object" ? obj : { obj }) }));
    },
  };
}
