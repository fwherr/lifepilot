import { z } from "zod";

/**
 * Delivery channels. Values must stay in sync with the Prisma `Channel` enum
 * in packages/db/prisma/schema.prisma.
 */
export const CHANNELS = ["EMAIL", "WHATSAPP", "AI_AGENT", "WEBHOOK", "RAZORPAY"] as const;
export type Channel = (typeof CHANNELS)[number];

export const channelSchema = z.enum(CHANNELS);

/** Reminder shape the adapters receive (structural, Prisma-free). */
export interface DeliveryReminder {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  dueAt: Date;
  channel: Channel;
  payload: unknown; // normalized payload, see payloadSchemas below
}

export interface DeliveryUser {
  id: string;
  email: string;
}

export interface DeliveryContext {
  reminder: DeliveryReminder;
  user: DeliveryUser;
}

export interface DeliveryResult {
  ok: boolean;
  detail: Record<string, unknown>;
}

/** Contract every delivery channel implements. */
export interface ChannelAdapter {
  readonly channel: Channel;
  /** Human-readable description of what the adapter does / needs to go live. */
  readonly description: string;
  deliver(ctx: DeliveryContext): Promise<DeliveryResult>;
}

/**
 * Normalized per-channel payload schemas. The API validates + fills defaults
 * with these before persisting the reminder; the worker reads the same shape.
 */
export const emailPayloadSchema = z
  .object({
    to: z.string().email().optional(),
    subject: z.string().max(200).optional(),
  })
  .strict();

export const webhookPayloadSchema = z
  .object({
    url: z.string().url(),
    secret: z.string().min(8).max(200).optional(),
  })
  .strict();

export const whatsappPayloadSchema = z
  .object({
    to: z.string().min(3).max(32).optional(),
  })
  .strict();

export const aiAgentPayloadSchema = z
  .object({
    prompt: z.string().max(2000).optional(),
  })
  .strict();

export const razorpayPayloadSchema = z
  .object({
    /** Amount in the smallest currency unit (paise for INR). */
    amount: z.number().int().positive().max(100_000_000).optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();
