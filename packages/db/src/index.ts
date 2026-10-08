export { PrismaClient, Prisma } from "@prisma/client";
export { Channel, ReminderStatus, AttemptStatus } from "@prisma/client";
export type { User, Reminder, RefreshToken, DeliveryAttempt, Attachment } from "@prisma/client";

import { PrismaClient } from "@prisma/client";

/**
 * Process-wide Prisma singleton. Connection is lazy — the first query opens
 * the pool. Tests inject their own db instances instead of using this.
 */
export const prisma = new PrismaClient();
