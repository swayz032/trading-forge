/**
 * market-internals-service.ts — Wave 25 Pass 2.5, W25.5b
 *
 * Subscribes to NYSE market-breadth internals ($TICK / $ADD / $VOLD / $TRIN) via
 * the existing Massive WebSocket client (no new vendor).
 *
 * Public API:
 *   getInternalsSnapshot()        — last-known readings, with staleness flag
 *   recordInternalsBar(symbol, value, ts) — update the in-memory cache
 *
 * Graceful degradation:
 *   - If MASSIVE_API_KEY is unset OR MASSIVE_INTERNALS_ENABLED=false:
 *     returns all-null snapshots, no WS connection, no throw.
 *   - If Massive WS disconnects: returns stale snapshots until reconnect.
 *   - Never throws to the caller.
 *
 * MCL note: internals are NYSE stock-breadth — irrelevant for crude oil.
 *   The confluence-score evaluator handles the MCL skip; this service does NOT
 *   need symbol-awareness.
 *
 * Symbol env vars (defaults reflect common Massive symbol catalog names):
 *   MASSIVE_TICK_SYMBOL  (default: "$TICK")
 *   MASSIVE_ADD_SYMBOL   (default: "$ADD")
 *   MASSIVE_VOLD_SYMBOL  (default: "$VOLD")
 *   MASSIVE_TRIN_SYMBOL  (default: "$TRIN")
 *
 * Staleness threshold:
 *   INTERNALS_STALE_THRESHOLD_MS  (default: 300000 = 5 min)
 *
 * Logger import: ./logger.js leaf module per feedback_helper_logger_import.md.
 */

import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// ─── Configuration ─────────────────────────────────────────────────────────────

const TICK_SYMBOL  = process.env["MASSIVE_TICK_SYMBOL"]  ?? "$TICK";
const ADD_SYMBOL   = process.env["MASSIVE_ADD_SYMBOL"]   ?? "$ADD";
const VOLD_SYMBOL  = process.env["MASSIVE_VOLD_SYMBOL"]  ?? "$VOLD";
const TRIN_SYMBOL  = process.env["MASSIVE_TRIN_SYMBOL"]  ?? "$TRIN";

const STALE_THRESHOLD_MS = Number(process.env["INTERNALS_STALE_THRESHOLD_MS"] ?? "300000");

// ─── Module-level state ───────────────────────────────────────────────────────

interface InternalReading {
  value: number | null;
  asOf: Date | null;
}

const _cache: Record<string, InternalReading> = {
  [TICK_SYMBOL]:  { value: null, asOf: null },
  [ADD_SYMBOL]:   { value: null, asOf: null },
  [VOLD_SYMBOL]:  { value: null, asOf: null },
  [TRIN_SYMBOL]:  { value: null, asOf: null },
};

/** True once the WS subscription has been started (prevents double-init). */
let _subscriptionStarted = false;

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface InternalsSnapshot {
  tick: number | null;
  add: number | null;
  vold: number | null;
  trin: number | null;
  asOf: Date;
  stale: boolean;
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

function isEnabled(): boolean {
  const key = process.env["MASSIVE_API_KEY"];
  const flag = process.env["MASSIVE_INTERNALS_ENABLED"];
  if (!key || key.trim() === "") return false;
  if (flag !== undefined && flag.toLowerCase() === "false") return false;
  return true;
}

function isStale(reading: InternalReading): boolean {
  if (reading.asOf === null) return true;
  return Date.now() - reading.asOf.getTime() > STALE_THRESHOLD_MS;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Update the in-memory cache for a single internals symbol.
 * Called by the Massive WS callback for each bar received.
 */
export function recordInternalsBar(symbol: string, value: number, ts: Date): void {
  if (Object.prototype.hasOwnProperty.call(_cache, symbol)) {
    _cache[symbol] = { value, asOf: ts };
  }
}

/**
 * Return the latest internals snapshot.
 * stale=true if ANY reading has not been updated within STALE_THRESHOLD_MS.
 * All values null when the service is disabled or not yet connected.
 */
export function getInternalsSnapshot(): InternalsSnapshot {
  const now = new Date();

  const tickReading  = _cache[TICK_SYMBOL]!;
  const addReading   = _cache[ADD_SYMBOL]!;
  const voldReading  = _cache[VOLD_SYMBOL]!;
  const trinReading  = _cache[TRIN_SYMBOL]!;

  // A snapshot is considered stale if any reading is absent or aged out
  const anyStale =
    isStale(tickReading) ||
    isStale(addReading)  ||
    isStale(voldReading) ||
    isStale(trinReading);

  if (anyStale && (tickReading.value !== null || addReading.value !== null)) {
    logger.debug(
      { tickAge: tickReading.asOf, addAge: addReading.asOf },
      "market-internals-service: stale snapshot returned",
    );
  }

  return {
    tick: tickReading.value,
    add:  addReading.value,
    vold: voldReading.value,
    trin: trinReading.value,
    asOf: now,
    stale: anyStale,
  };
}

// ─── WS subscription bootstrap ───────────────────────────────────────────────

/**
 * Start the Massive WebSocket subscription for internals symbols.
 * Idempotent — safe to call multiple times; WS is only opened once.
 *
 * Should be called once at server startup (e.g., from the Express bootstrap).
 * If the service is disabled (no API key / flag=false), this is a no-op.
 */
export async function startInternalsSubscription(): Promise<void> {
  if (!isEnabled()) {
    logger.info(
      {},
      "market-internals-service: disabled (MASSIVE_API_KEY unset or MASSIVE_INTERNALS_ENABLED=false) — skipping WS subscription",
    );
    return;
  }

  if (_subscriptionStarted) {
    logger.debug({}, "market-internals-service: subscription already started — skipping");
    return;
  }

  _subscriptionStarted = true;

  try {
    const { createMassiveFetcher } = await import("../../data/fetchers/massive.js");

    const apiKey = process.env["MASSIVE_API_KEY"]!;
    const fetcher = createMassiveFetcher({ apiKey });

    const subscribedSymbols = [TICK_SYMBOL, ADD_SYMBOL, VOLD_SYMBOL, TRIN_SYMBOL];

    const ws = fetcher.createWebSocket(subscribedSymbols, (bar) => {
      const ts = new Date(bar.timestamp);
      // Internals use close price as the breadth reading
      recordInternalsBar(bar.symbol, bar.close, ts);
    });

    ws.on("connected", () => {
      logger.info(
        { symbols: subscribedSymbols },
        "market-internals-service: WebSocket connected and subscribed",
      );
      void insertAuditRow({
        action: "internals.subscription_connected",
        entityId: null,
        entityType: "market_internals",
        result: { symbols: subscribedSymbols },
        status: "success",
        decisionAuthority: "system",
      });
    });

    ws.on("disconnected", () => {
      logger.warn(
        {},
        "market-internals-service: WebSocket disconnected — stale snapshots will be returned until reconnect",
      );
    });

    ws.on("reconnecting", ({ attempt, delayMs }: { attempt: number; delayMs: number }) => {
      logger.info(
        { attempt, delayMs },
        "market-internals-service: WebSocket reconnecting",
      );
    });

    ws.on("error", (err: Error) => {
      logger.error({ err }, "market-internals-service: WebSocket error");
    });

    ws.connect();

    logger.info(
      { symbols: subscribedSymbols },
      "market-internals-service: subscription started",
    );
  } catch (err) {
    // Connection setup failure is non-fatal — service degrades to all-null snapshots
    _subscriptionStarted = false; // allow retry on next call
    logger.error(
      { err },
      "market-internals-service: failed to start WS subscription — internals will be unavailable",
    );
  }
}

/**
 * Test-only: reset module state so tests can control the cache directly.
 */
export function __resetInternalsForTests(): void {
  for (const sym of Object.keys(_cache)) {
    _cache[sym] = { value: null, asOf: null };
  }
  _subscriptionStarted = false;
}

/**
 * Test-only: inject a reading directly into the cache (bypasses WS).
 */
export function __injectInternalsReading(
  symbol: "tick" | "add" | "vold" | "trin",
  value: number,
  asOf: Date = new Date(),
): void {
  const symMap: Record<string, string> = {
    tick: TICK_SYMBOL,
    add:  ADD_SYMBOL,
    vold: VOLD_SYMBOL,
    trin: TRIN_SYMBOL,
  };
  const sym = symMap[symbol];
  if (sym && Object.prototype.hasOwnProperty.call(_cache, sym)) {
    _cache[sym] = { value, asOf };
  }
}
