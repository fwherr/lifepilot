import "dotenv/config";

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

export interface ApiConfig {
  port: number;
  host: string;
  corsOrigin: string;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  webhookSigningSecret: string;
  razorpayWebhookSecret: string;
  redisUrl: string;
  databaseUrl: string;
  logLevel: string;
  s3: S3Config;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const jwtSecret = env.JWT_SECRET ?? "dev-only-secret-change-me";
  if (env.NODE_ENV === "production" && jwtSecret === "dev-only-secret-change-me") {
    throw new Error("JWT_SECRET must be set in production (refusing dev default)");
  }
  return {
    port: Number(env.API_PORT ?? 3001),
    host: env.API_HOST ?? "0.0.0.0",
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:3000",
    jwtSecret,
    accessTokenTtl: env.ACCESS_TOKEN_TTL ?? "15m",
    refreshTokenTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 7),
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET ?? "dev-webhook-secret",
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? "",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    databaseUrl:
      env.DATABASE_URL ?? "postgresql://lifepilot:lifepilot@localhost:5432/lifepilot?schema=public",
    logLevel: env.LOG_LEVEL ?? "info",
    s3: {
      endpoint: env.S3_ENDPOINT ?? "http://localhost:9000",
      region: env.S3_REGION ?? "us-east-1",
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "minioadmin",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
      bucket: env.S3_BUCKET ?? "lifepilot-attachments",
      forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    },
  };
}
