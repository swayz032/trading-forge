// Type declarations for ip-sanitize.js — a plain CommonJS module (railway-relay
// is a standalone deployable, not part of the tsconfig `include` set) consumed
// only by its vitest regression test under src/server/__tests__/.

export interface MinimalRequestLike {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}

export const RELAY_VERIFIED_IP_HEADER: string;
export function normalizeRemoteAddress(addr: string | undefined | null): string;
export function sanitizeAndStampHeaders(req: MinimalRequestLike): Record<string, unknown>;
