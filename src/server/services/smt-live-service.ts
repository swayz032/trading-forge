/**
 * smt-live-service.ts — Wave 26 Group B, Task 3
 *
 * Live bridge: Python compute_smt_divergence() → paper-signal-service.ts SignalContext.
 *
 * Wave 25 Pass 5 shipped smt_divergence.py for backtests; the live-paper bridge
 * was explicitly deferred to Wave 26 (CLAUDE.md §2 Wave 25 Pass 5 note).
 * This service closes that gap.
 *
 * Architecture:
 *   - In-memory TTL cache (default 30s, env SMT_LIVE_CACHE_TTL_MS)
 *   - On cache miss: serialize MES + MNQ bar buffers from paper-signal-service,
 *     invoke Python CLI via runPythonModule, parse result
 *   - Graceful degradation: Python error → all-null SmtLiveSnapshot (never throws)
 *   - Audit events: smt.snapshot_captured, smt.snapshot_stale_skipped
 *
 * Scope constraint: MES ↔ MNQ ONLY. Do not add YM/RTY.
 *
 * Logger import: ./logger.js per feedback_helper_logger_import.md
 *   (never ../index.js — that imports db/schema.js which blows test isolation)
 *
 * SMT direction strings are canonical (CLAUDE.md §11b):
 *   "bullish_es_low_nq_higher" | "bearish_es_high_nq_lower"
 *   Other strings returned from Python → treated as null direction.
 */

import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { runPythonModule } from "../lib/python-runner.js";

// ─── Bar buffer provider (injected to break circular dependency) ───────────────
// paper-trading-stream.ts imports paper-signal-service.ts which imports this module.
// Importing paper-trading-stream.ts here would create a circular dep.
// Solution: paper-trading-stream.ts calls initSmtBarBufferProvider() at startup,
// injecting its getBarBuffer function. Until injected, buffer returns [].

type BarLike = { open: number; high: number; low: number; close: number; volume: number; timestamp?: string | number };
type BarBufferProvider = (symbol: string) => BarLike[];

let _barBufferProvider: BarBufferProvider | null = null;

/**
 * Register the bar buffer accessor.
 * Called by paper-trading-stream.ts after module load to wire the live bar feed.
 * Until called, getSmtLiveSnapshot will return null snapshots (insufficient data).
 */
export function initSmtBarBufferProvider(provider: BarBufferProvider): void {
  _barBufferProvider = provider;
}

function getBarBuffer(symbol: string): BarLike[] {
  return _barBufferProvider ? _barBufferProvider(symbol) : [];
}

// ─── Configuration ─────────────────────────────────────────────────────────────

const CACHE_TTL_MS = Number(process.env["SMT_LIVE_CACHE_TTL_MS"] ?? "30000");

/** MES symbol: the "ES" leg of the divergence computation */
const MES_SYMBOL = process.env["SMT_LIVE_ES_SYMBOL"] ?? "MES";
/** MNQ symbol: the "NQ" leg */
const MNQ_SYMBOL = process.env["SMT_LIVE_NQ_SYMBOL"] ?? "MNQ";

/** Canonical SMT direction strings (CLAUDE.md §11b no-widen rule) */
const CANONICAL_DIRECTIONS = new Set([
  "bullish_es_low_nq_higher",
  "bearish_es_high_nq_lower",
]);

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SmtLiveSnapshot {
  /** Continuous [0,1] confidence from compute_smt_divergence().score. null when unavailable. */
  score: number | null;
  /**
   * Canonical direction string or null.
   * Only "bullish_es_low_nq_higher" or "bearish_es_high_nq_lower" are live.
   * Non-canonical strings from Python are normalized to null.
   */
  direction: string | null;
  /** Bars elapsed since detection. 0 on a fresh divergence bar. null when unavailable. */
  age_bars: number | null;
  /** UTC timestamp when this snapshot was computed */
  computed_at: Date;
  /** True when snapshot age > CACHE_TTL_MS and Python recompute failed */
  stale: boolean;
}

// ─── Module-level cache ───────────────────────────────────────────────────────

interface CacheEntry {
  snapshot: SmtLiveSnapshot;
  cachedAt: number; // Date.now()
}

let _cache: CacheEntry | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isCacheValid(now: number): boolean {
  if (_cache == null) return false;
  return now - _cache.cachedAt < CACHE_TTL_MS;
}

function nullSnapshot(now: Date, stale = false): SmtLiveSnapshot {
  return {
    score: null,
    direction: null,
    age_bars: null,
    computed_at: now,
    stale,
  };
}

/**
 * Serialize a Bar[] into the JSON array shape the Python CLI expects.
 * Fields: open, high, low, close, volume, ts_event (optional).
 */
function serializeBars(bars: { open: number; high: number; low: number; close: number; volume: number; timestamp?: string | number }[]): object[] {
  return bars.map((b) => ({
    open:  b.open,
    high:  b.high,
    low:   b.low,
    close: b.close,
    volume: b.volume,
    ...(b.timestamp != null ? { ts_event: String(b.timestamp) } : {}),
  }));
}

// ─── Core computation ─────────────────────────────────────────────────────────

async function computeSnapshotFromPython(correlationId?: string): Promise<SmtLiveSnapshot> {
  const now = new Date();

  const esBuf = getBarBuffer(MES_SYMBOL);
  const nqBuf = getBarBuffer(MNQ_SYMBOL);

  // Need at minimum lookback + ATR_PERIOD + 1 = 20 + 14 + 1 = 35 bars.
  // Fail gracefully if insufficient data.
  const MIN_BARS = 35;
  if (esBuf.length < MIN_BARS || nqBuf.length < MIN_BARS) {
    logger.debug(
      { esBars: esBuf.length, nqBars: nqBuf.length, minRequired: MIN_BARS },
      "smt-live-service: insufficient bar data for computation — returning null snapshot",
    );
    return nullSnapshot(now);
  }

  let result: Record<string, unknown>;
  try {
    result = await runPythonModule<Record<string, unknown>>({
      module: "src.engine.indicators.smt_divergence",
      config: {
        es_bars: serializeBars(esBuf),
        nq_bars: serializeBars(nqBuf),
        lookback: 20,
      },
      timeoutMs: Number(process.env["SMT_LIVE_TIMEOUT_MS"] ?? "15000"),
      componentName: "smt-live-service",
      correlationId,
    });
  } catch (err) {
    logger.warn(
      { err, symbol: `${MES_SYMBOL}/${MNQ_SYMBOL}`, correlationId },
      "smt-live-service: Python subprocess error — returning null snapshot",
    );
    return nullSnapshot(now);
  }

  // Parse result — Python CLI outputs null fields on no-divergence or error
  const rawScore = result["score"];
  const rawDirection = result["direction"];
  const rawAgeBars = result["age_bars"];

  const score: number | null = typeof rawScore === "number" && Number.isFinite(rawScore)
    ? Math.max(0, Math.min(1, rawScore))
    : null;

  // Enforce canonical direction strings — non-canonical values treated as null
  const direction: string | null = typeof rawDirection === "string" && CANONICAL_DIRECTIONS.has(rawDirection)
    ? rawDirection
    : null;

  const age_bars: number | null = typeof rawAgeBars === "number" && Number.isFinite(rawAgeBars)
    ? Math.max(0, rawAgeBars)
    : null;

  const snapshot: SmtLiveSnapshot = {
    score,
    direction,
    age_bars,
    computed_at: now,
    stale: false,
  };

  // Audit: capture event with §10b correlation_id
  insertAuditRow({
    action: "smt.snapshot_captured",
    entityType: "signal",
    entityId: null,
    decisionAuthority: "system",
    status: "success",
    result: {
      score,
      direction,
      age_bars,
      es_bars_used: esBuf.length,
      nq_bars_used: nqBuf.length,
      cache_ttl_ms: CACHE_TTL_MS,
    } as Record<string, unknown>,
    correlationId: correlationId ?? null,
  }).catch((err) => logger.warn({ err }, "smt-live-service: audit row write failed"));

  return snapshot;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the latest SMT divergence snapshot for the live paper path.
 *
 * Behavior:
 *   - Returns cached snapshot when < CACHE_TTL_MS old (default 30s).
 *   - On cache miss: recomputes via Python CLI, updates cache.
 *   - On Python error: returns all-null snapshot (never throws).
 *   - stale=true when the cached snapshot is beyond TTL AND recompute failed.
 *
 * Called in paper-signal-service.ts Path C BEFORE evaluateWeightedConfluence().
 * Populates ctx.smt_score / ctx.smt_direction / ctx.smt_age_bars.
 *
 * @param currentBarTs  Timestamp of the current bar (unused in computation,
 *                      reserved for future per-bar TTL alignment).
 * @param correlationId Propagated to audit_log for §10b reconstruction.
 */
export async function getSmtLiveSnapshot(
  currentBarTs: Date,
  correlationId?: string,
): Promise<SmtLiveSnapshot> {
  const now = Date.now();

  if (isCacheValid(now)) {
    return _cache!.snapshot;
  }

  // Cache miss or expired: recompute
  const isStaleRecompute = _cache != null && !isCacheValid(now);

  try {
    const snapshot = await computeSnapshotFromPython(correlationId);
    _cache = { snapshot, cachedAt: now };
    return snapshot;
  } catch (err) {
    // computeSnapshotFromPython already returns null snapshots on errors;
    // this outer catch handles any unexpected throws from cache updates.
    logger.warn({ err, correlationId }, "smt-live-service: unexpected error in getSmtLiveSnapshot");

    if (isStaleRecompute && _cache != null) {
      // Return stale snapshot rather than null — at least has prior direction
      const staleSnapshot: SmtLiveSnapshot = { ..._cache.snapshot, stale: true };
      insertAuditRow({
        action: "smt.snapshot_stale_skipped",
        entityType: "signal",
        entityId: null,
        decisionAuthority: "system",
        status: "info",
        result: {
          stale_age_ms: now - _cache.cachedAt,
          cache_ttl_ms: CACHE_TTL_MS,
          prior_score: _cache.snapshot.score,
          prior_direction: _cache.snapshot.direction,
        } as Record<string, unknown>,
        correlationId: correlationId ?? null,
      }).catch(() => void 0);
      return staleSnapshot;
    }

    return nullSnapshot(new Date());
  }
}

/**
 * Invalidate the in-memory cache.
 * Used by tests to reset state between test cases.
 */
export function _resetSmtCacheForTest(): void {
  _cache = null;
}
