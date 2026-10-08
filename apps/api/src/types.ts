import type { PrismaClient } from "@lifepilot/db";
import type { ReminderQueue } from "./lib/queue";
import type { S3Like } from "./lib/s3";
import type { ApiConfig } from "./config";

/** Everything route handlers may touch; fully injectable for tests. */
export interface AppDeps {
  config: ApiConfig;
  db: PrismaClient;
  queue: ReminderQueue;
  s3: S3Like;
}
