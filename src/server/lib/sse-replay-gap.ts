/**
 * sse-replay-gap.ts (fresh-scan HIGH#8, 2026-07-12) — the pure SSE reconnect replay-gap decision,
 * split out of routes/sse.ts so it is unit-testable (the route is an HTTP handler the suite doesn't
 * drive via req/res). No I/O, no side effects.
 *
 * Event ids are `<bootId>.<seq>` where bootId is a per-process nonce. On reconnect the client echoes
 * its last id via Last-Event-ID. A bootId that differs from this process's (or a legacy plain-int id)
 * means a restart happened since that id was issued → the reset in-memory ring buffer cannot guarantee
 * continuity → force a replay gap so the client refetches authoritative state. The old seq-only logic
 * was one-directional: it caught a last-seen ABOVE the fresh counter but MISSED the common case where
 * the fresh process climbs the counter back past a small last-seen before the ~1-3s reconnect.
 */
export interface ReplayGapInput {
  /** raw Last-Event-ID header value ("" when absent) */
  lastEventIdRaw: string;
  /** this process's boot id */
  currentBootId: string;
  ringEmpty: boolean;
  /** oldest buffered seq, or -1 when the ring is empty */
  oldestSeq: number;
  /** current in-memory event counter */
  eventSeq: number;
}

export interface ReplayGapDecision {
  /** true when the reconnect should run the replay/gap branch at all */
  shouldEvaluate: boolean;
  /** true when continuity cannot be guaranteed → emit sse:replay_gap */
  hasGap: boolean;
  /** parsed seq from the client's last id (NaN if unparseable) */
  lastSeenSeq: number;
  /** true when the client's echoed bootId is not this process's (a restart) */
  bootMismatch: boolean;
}

export function computeReplayGap(input: ReplayGapInput): ReplayGapDecision {
  const { lastEventIdRaw, currentBootId, ringEmpty, oldestSeq, eventSeq } = input;
  const dotIdx = lastEventIdRaw.lastIndexOf(".");
  const clientBootId = dotIdx >= 0 ? lastEventIdRaw.slice(0, dotIdx) : "";
  const lastSeenSeq = dotIdx >= 0
    ? parseInt(lastEventIdRaw.slice(dotIdx + 1), 10)
    : parseInt(lastEventIdRaw, 10);
  const bootMismatch = lastEventIdRaw !== "" && clientBootId !== currentBootId;
  const shouldEvaluate = bootMismatch || (!isNaN(lastSeenSeq) && lastSeenSeq > 0);
  const hasGap =
    shouldEvaluate &&
    (bootMismatch || ringEmpty || oldestSeq > lastSeenSeq + 1 || lastSeenSeq > eventSeq);
  return { shouldEvaluate, hasGap, lastSeenSeq, bootMismatch };
}
