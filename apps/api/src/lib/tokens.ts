import crypto from "node:crypto";

export interface GeneratedRefreshToken {
  /** Opaque token handed to the client (kept out of the database). */
  token: string;
  /** SHA-256 of the token — this is what gets persisted. */
  tokenHash: string;
  expiresAt: Date;
}

export function generateRefreshToken(ttlDays: number): GeneratedRefreshToken {
  const token = crypto.randomBytes(48).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
  };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
