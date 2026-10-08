import type { ChannelAdapter, DeliveryContext, DeliveryResult } from "@lifepilot/core";

/** Minimal fetch signature both network adapters rely on; injectable for tests. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** Every adapter ultimately returns one of these — recorded as a DeliveryAttempt. */
export type { ChannelAdapter, DeliveryContext, DeliveryResult };
