/**
 * Bias State Service — Wave 23.C + Gap-Fix-B
 *
 * Responsible for:
 *   1. Invoking bias_engine.compute_bias() + playbook_router.route_playbook()
 *      at session start (once per CME trading day per symbol, cached thereafter).
 *   2. Selecting the active strategy for today's regime from the DB.
 *   3. Persisting the decision to bias_state table (INSERT — multiple rows per
 *      session_date+symbol allowed; readers pick MAX(computed_at)).
 *   4. Emitting audit_log + SSE for operator visibility.
 *
 * Multi-symbol (Wave 23 Gap-Fix-B):
 *   Each symbol (MES / MNQ / MCL) gets its own bias decision.
 *   Cache key: "${sessionDate}-${symbol}".
 *   The session-start cron iterates ["MES", "MNQ", "MCL"] and computes all three.
 *
 * 10:00 ET refresh (Wave 23 Gap-Fix-B):
 *   getOrComputeBiasStateForDay() accepts forceRefresh:true to bypass the cache
 *   and re-run compute_bias() with intraday SessionContext now available.
 *   The refresh INSERTs a new row (does NOT overwrite the 9:30 row).
 *   On refresh failure (crash, timeout) the 9:30 row remains authoritative.
 *
 * All DB writes are fail-open: an error in bias engine never blocks signal
 * execution. The gate that reads biasState (C.3) also fails open when no row
 * exists for today (legacy_no_confluence bypass takes that path).
 *
 * Session-date key: CME futures trading day uses a 5pm ET cutoff (same as
 * toFuturesTradingDayString from wave12). For now we use UTC date of the bar
 * timestamp as a conservative approximation — sufficient for daily-granularity
 * regime decisions.
 */

import { db } from "../db/index.js";
import { biasState, strategies } from "../db/schema.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { and, eq, isNotNull, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

// ─── Active symbols ───────────────────────────────────────────────────────────
export const BIAS_SYMBOLS = ["MES", "MNQ", "MCL"] as const;
export type BiasSymbol = typeof BIAS_SYMBOLS[number];

// ─── Session-date+symbol cache ─────────────────────────────────────────────────
// Key: "${YYYY-MM-DD}-${SYMBOL}". Value: resolved BiasStateRow.
// Prevents re-running the expensive Python bias engine on every bar within the
// same trading day for the same symbol. Evicted at server start — always fresh
// for a new process.
const dailyBiasCache = new Map<string, CachedBiasDecision>();

interface CachedBiasDecision {
  sessionDate: string;
  symbol: string;
  regimeLabel: string;
  playbook: string;
  activeStrategyId: string | null;
  evidence: Record<string, unknown>;
  computedAt: string;
}

function cacheKey(sessionDate: string, symbol: string): string {
  return `${sessionDate}-${symbol.toUpperCase()}`;
}

/**
 * Test-only: clear the daily bias cache between unit tests.
 */
export function __resetDailyBiasCacheForTests(): void {
  dailyBiasCache.clear();
}

/**
 * Return the CME trading-day string for a bar timestamp.
 * Conservative: UTC date of the timestamp. The wave12 toFuturesTradingDayString
 * (±7h shift for 5pm ET cutoff) is the authoritative version; this is an
 * acceptable approximation for daily regime decisions.
 */
export function barTimestampToTradingDay(ts: string): string {
  return ts.substring(0, 10); // "YYYY-MM-DD"
}

// ─── Result shape returned to paper-signal-service ───────────────────────────
export interface BiasStateForSignal {
  sessionDate: string;
  symbol: string;
  regimeLabel: string;
  playbook: string;
  activeStrategyId: string | null;
}

/**
 * Return a stub bias state when bias engine is OFF or fails.
 * Stub = no regime filter + no strategy filter → legacy bypass path.
 */
function stubBiasState(sessionDate: string, symbol: string): BiasStateForSignal {
  return {
    sessionDate,
    symbol,
    regimeLabel: "UNKNOWN",
    playbook: "NO_TRADE",
    activeStrategyId: null,
  };
}

/**
 * Resolve the best matching active strategy for today's regime.
 *
 * Match criteria (in priority order):
 *   1. strategy.lifecycle_state IN (CANDIDATE, TESTING, PAPER)
 *   2. strategy.preferred_regime == regimeLabel (or regimeLabel == 'UNKNOWN')
 *   3. Highest forge_score; tie-break by created_at ASC (oldest first)
 *
 * When regimeLabel is 'NO_TRADE' → no strategy is active (null).
 * When regimeLabel is 'UNKNOWN'  → any strategy may match (fallback mode).
 */
async function resolveActiveStrategy(regimeLabel: string): Promise<string | null> {
  if (regimeLabel === "NO_TRADE") return null;

  const eligibleLifecycleStates = ["CANDIDATE", "TESTING", "PAPER"];

  // Build query dynamically: if regime is UNKNOWN, skip regime filter
  let rows: { id: string; forgeScore: string | null }[];

  if (regimeLabel === "UNKNOWN") {
    rows = await db
      .select({ id: strategies.id, forgeScore: strategies.forgeScore })
      .from(strategies)
      .where(
        sql`${strategies.lifecycleState} = ANY(ARRAY['CANDIDATE','TESTING','PAPER']::text[])`,
      )
      .orderBy(desc(strategies.forgeScore), strategies.createdAt)
      .limit(1);
  } else {
    rows = await db
      .select({ id: strategies.id, forgeScore: strategies.forgeScore })
      .from(strategies)
      .where(
        and(
          sql`${strategies.lifecycleState} = ANY(ARRAY['CANDIDATE','TESTING','PAPER']::text[])`,
          eq(strategies.preferredRegime, regimeLabel),
        ),
      )
      .orderBy(desc(strategies.forgeScore), strategies.createdAt)
      .limit(1);
  }

  if (!rows.length) return null;
  return rows[0].id;
}

/**
 * Get (or compute) the bias state for the trading day of the given bar timestamp
 * and symbol.
 *
 * First call for a given (session_date, symbol):
 *   - Runs bias_engine (Python) with HTFContext built from daily Parquet.
 *   - Routes playbook.
 *   - Selects active strategy.
 *   - Persists to bias_state table (INSERT).
 *   - Emits audit_log + SSE.
 *
 * Subsequent calls within same trading day:
 *   - Returns in-memory cache hit (no DB, no Python).
 *
 * forceRefresh=true (10:00 ET cron):
 *   - Bypasses in-memory cache.
 *   - Re-runs compute_bias() with intraday SessionContext now available.
 *   - Inserts a NEW row (does NOT overwrite the 9:30 row).
 *   - On failure: logs warn, cache remains pointing at 9:30 row (fail-open).
 *
 * Fail-open: any error returns stubBiasState() so signal flow continues.
 *
 * @param barTimestamp  ISO timestamp string used to derive the session date
 * @param correlationId Optional span correlation ID
 * @param symbol        Instrument symbol (default "MES")
 * @param forceRefresh  If true, bypass cache and re-run compute_bias() (10am refresh)
 */
export async function getOrComputeBiasStateForDay(
  barTimestamp: string,
  correlationId?: string,
  symbol = "MES",
  forceRefresh = false,
): Promise<BiasStateForSignal> {
  const sessionDate = barTimestampToTradingDay(barTimestamp);
  const sym = symbol.toUpperCase();
  const key = cacheKey(sessionDate, sym);

  // Return cache unless forceRefresh
  if (!forceRefresh) {
    const cached = dailyBiasCache.get(key);
    if (cached) return cached;

    // Check if there's already a persisted row for today (e.g. after server restart)
    try {
      const existing = await db
        .select({
          regimeLabel: biasState.regimeLabel,
          playbook: biasState.playbook,
          activeStrategyId: biasState.activeStrategyId,
          computedAt: biasState.computedAt,
          evidence: biasState.evidence,
          symbol: biasState.symbol,
        })
        .from(biasState)
        .where(and(eq(biasState.sessionDate, sessionDate), eq(biasState.symbol, sym)))
        .orderBy(desc(biasState.computedAt))
        .limit(1);

      if (existing.length) {
        const row = existing[0];
        const decision: CachedBiasDecision = {
          sessionDate,
          symbol: sym,
          regimeLabel: row.regimeLabel,
          playbook: row.playbook,
          activeStrategyId: row.activeStrategyId ?? null,
          evidence: (row.evidence as Record<string, unknown>) ?? {},
          computedAt: row.computedAt.toISOString(),
        };
        dailyBiasCache.set(key, decision);
        logger.info(
          { sessionDate, symbol: sym, regimeLabel: decision.regimeLabel, playbook: decision.playbook, activeStrategyId: decision.activeStrategyId },
          "bias-state: restored from DB (server restart or existing row)",
        );
        return decision;
      }
    } catch (dbErr) {
      logger.warn({ err: dbErr, sessionDate, symbol: sym }, "bias-state: DB lookup failed — computing fresh");
    }
  }

  // Invoke Python bias engine (or re-invoke for 10am refresh)
  let regimeLabel = "UNKNOWN";
  let playbook = "NO_TRADE";
  let evidence: Record<string, unknown> = {};
  const computedAt = new Date().toISOString();
  const isRefresh = forceRefresh;

  // ─── Wave 23.C Gap A.2 + Gap-Fix-B: invoke compute_bias() directly ─────────
  // Strategy:
  //   Primary:  run a Python script that loads real daily OHLCV data from the
  //             Parquet cache, builds HTFContext + SessionContext, and calls
  //             compute_bias() directly.
  //   Fallback: if Primary fails, read the most-recent bias_decisions row via
  //             the internal REST API.
  //   Fail-open: if both fail, use UNKNOWN/NO_TRADE stub.
  let computedViaPrimary = false;
  try {
    const { runPythonModule } = await import("../lib/python-runner.js");

    // At 10am refresh: intraday bars are available so SessionContext gets real
    // opening range, overnight_bias, killzone status.
    const refreshContext = isRefresh ? `
    # ── 10am refresh: fetch intraday bars for SessionContext ────────────────
    intraday_session_ok = False
    opening_range_high = current_price
    opening_range_low  = current_price
    overnight_bias_str = "neutral"
    or_broken_val      = None
    ny_kz_active       = False
    london_kz_active   = False
    try:
        import urllib.request as _ireq
        api_url = os.environ.get("TRADING_FORGE_API_URL", "http://localhost:4000")
        api_key = os.environ.get("API_KEY", "")
        today = datetime.date.today().isoformat()
        bars_req = _ireq.Request(
            f"{api_url}/api/bars/{symbol}?date={today}&timeframe=5m&limit=60",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        with _ireq.urlopen(bars_req, timeout=4) as resp:
            bars_data = json.loads(resp.read())
            intraday_bars = bars_data.get("bars", [])
            if len(intraday_bars) >= 6:
                # Opening range = first 30 min = 6 × 5-min bars
                or_bars = intraday_bars[:6]
                opening_range_high = max(b["high"] for b in or_bars)
                opening_range_low  = min(b["low"]  for b in or_bars)
                # Overnight bias = compare open to prior day close
                first_open = float(intraday_bars[0].get("open", current_price))
                overnight_bias_str = (
                    "bullish" if first_open > htf.prev_day_close * 1.001
                    else "bearish" if first_open < htf.prev_day_close * 0.999
                    else "neutral"
                ) if hasattr(htf, "prev_day_close") else "neutral"
                # Killzone: NY open 9:30-10:30 ET — we are at ~10:00 ET
                ny_kz_active = True
                intraday_session_ok = True
    except Exception:
        pass  # fall through to neutral defaults
    ` : `
    # ── Session-start (9:30): no intraday bars yet ──────────────────────────
    opening_range_high = current_price
    opening_range_low  = current_price
    overnight_bias_str = "neutral"
    or_broken_val      = None
    ny_kz_active       = False
    london_kz_active   = False
    `;

    const biasResult = await runPythonModule<{
      regime_label: string;
      playbook: string;
      net_bias: number;
      bias_confidence: number;
      no_trade_reasons: string[];
      evidence: Record<string, unknown>;
      source: string;
    }>({
      scriptCode: `
import sys, json, os, datetime

# ── Output helpers ──────────────────────────────────────────────────────────
# W23H.A: Extended to cover all 9 playbook names from playbook_router.py.
# Mean-reversion playbooks → RANGE_BOUND (new regime).
# Legacy compat aliases (FULL_LONG/LEAN_LONG/etc.) preserved for any callers
# still emitting the old playbook names from prior compute_bias() versions.
PLAYBOOK_TO_REGIME = {
    # 9-playbook router output names (W23H.A)
    "NO_TRADE":                 "NO_TRADE",
    "TREND_CONTINUATION_LONG":  "TRENDING_UP",
    "TREND_CONTINUATION_SHORT": "TRENDING_DOWN",
    "SWEEP_REVERSAL_LONG":      "TRENDING_UP",
    "SWEEP_REVERSAL_SHORT":     "TRENDING_DOWN",
    "MEAN_REVERSION_LONG":      "RANGE_BOUND",
    "MEAN_REVERSION_SHORT":     "RANGE_BOUND",
    "ORB_LONG":                 "TRENDING_UP",
    "ORB_SHORT":                "TRENDING_DOWN",
    # Legacy compat: old 5-playbook names from compute_bias() pre-W23H.A
    "FULL_LONG":                "TRENDING_UP",
    "LEAN_LONG":                "TRENDING_UP",
    "FULL_SHORT":               "TRENDING_DOWN",
    "LEAN_SHORT":               "TRENDING_DOWN",
}

def emit(regime_label, playbook, net_bias, bias_confidence, no_trade_reasons, evidence, source):
    print(json.dumps({
        "regime_label": regime_label,
        "playbook": playbook,
        "net_bias": net_bias,
        "bias_confidence": bias_confidence,
        "no_trade_reasons": no_trade_reasons,
        "evidence": evidence,
        "source": source,
    }))

# ── Attempt Primary: compute_bias() from live OHLCV + HTF/session context ──
primary_ok = False
try:
    import polars as pl
    import numpy as np
    from src.engine.context.htf_context import HTFContext, compute_htf_context
    from src.engine.context.session_context import SessionContext
    from src.engine.context.bias_engine import compute_bias, VPLevels

    # Load daily Parquet from S3 cache path (same as backtester.py)
    data_root = os.environ.get("DATA_ROOT", "data")
    symbol = os.environ.get("BIAS_SYMBOL", "MES")
    parquet_path = os.path.join(data_root, "ratio_adj", f"{symbol}_daily.parquet")

    if not os.path.exists(parquet_path):
        raise FileNotFoundError(f"Daily Parquet not found: {parquet_path}")

    daily_df = pl.read_parquet(parquet_path)
    # Require minimum 20 bars for meaningful HTF analysis
    if len(daily_df) < 20:
        raise ValueError(f"Insufficient daily bars: {len(daily_df)}")

    # Current price from most recent completed daily close
    current_price = float(daily_df["close"][-1])

    # Build HTFContext from daily bars (no 4H/1H data at session-start)
    htf = compute_htf_context(
        daily_df=daily_df,
        four_h_df=None,
        one_h_df=None,
        current_price=current_price,
    )

    ${refreshContext}

    # Minimal SessionContext — enhanced at 10am refresh with intraday data
    session = SessionContext(
        overnight_range=(opening_range_high, opening_range_low),
        overnight_bias=overnight_bias_str,
        london_high=htf.prev_day_high,
        london_low=htf.prev_day_low,
        london_swept_pdh=False,
        london_swept_pdl=False,
        ny_killzone_active=ny_kz_active,
        london_killzone_active=london_kz_active,
        asian_killzone_active=False,
        current_session="ny_open" if ${isRefresh ? "True" : "False"} else "overnight",
        opening_range=(opening_range_high, opening_range_low),
        or_broken=or_broken_val,
        macro_time_active=False,
    )

    # Load VP levels from DB via internal API (non-blocking: Python side)
    vp_levels_obj = None
    try:
        import urllib.request as _req
        api_url = os.environ.get("TRADING_FORGE_API_URL", "http://localhost:4000")
        api_key = os.environ.get("API_KEY", "")
        today = datetime.date.today().isoformat()
        vp_req = _req.Request(
            f"{api_url}/api/volume-profile/{symbol}?date={today}",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        with _req.urlopen(vp_req, timeout=3) as resp:
            vp_data = json.loads(resp.read())
            if vp_data.get("poc") is not None:
                vp_levels_obj = VPLevels(
                    poc=float(vp_data["poc"]),
                    vah=float(vp_data["vah"]),
                    val=float(vp_data["val"]),
                    profile_shape=vp_data.get("profileShape", "D"),
                    shape_confidence=float(vp_data.get("shapeConfidence", 0.5)),
                    ib_high=vp_data.get("ibHigh"),
                    ib_low=vp_data.get("ibLow"),
                    ib_extension_status=vp_data.get("ibExtensionStatus"),
                    open_classification=vp_data.get("openClassification"),
                )
    except Exception:
        pass  # VP unavailable — compute_bias handles None gracefully

    state = compute_bias(
        htf=htf,
        session=session,
        current_price=current_price,
        vwap=current_price,  # VWAP unavailable at session-start; use close as proxy
        event_active=False,
        event_minutes=999,
        deepar_forecast=None,
        bars=None,           # Intraday bars unavailable at Python level
        vp_levels=vp_levels_obj,
    )

    # W23H.A: Wire the dead 9-playbook router. route_playbook() replaces the direct
    # state.playbook lookup with the full routing logic (SWEEP_REVERSAL, ORB, MEAN_REVERSION).
    # Falls back gracefully if import fails (legacy PLAYBOOK_TO_REGIME still covers state.playbook).
    try:
        from src.engine.context.playbook_router import route_playbook as _route_playbook
        _decision = _route_playbook(state, daily_loss_cap_near=False, max_trades_hit=False)
        routed_playbook = _decision.playbook
        allowed_strategies = _decision.allowed_strategies
        allowed_setups = _decision.allowed_setups
        # Emit audit event for playbook routing
        print(f"AUDIT_EVENT_JSON {json.dumps({'event': 'playbook_router.routed', 'playbook': routed_playbook, 'regime': PLAYBOOK_TO_REGIME.get(routed_playbook, 'UNKNOWN'), 'allowed_strategies': allowed_strategies, 'allowed_setups': allowed_setups})}", file=sys.stderr)
    except Exception as _route_err:
        # Fail-open: router unavailable → fall back to legacy state.playbook
        routed_playbook = state.playbook
        allowed_strategies = []
        allowed_setups = []
        print(f"WARNING: route_playbook failed ({_route_err!r}), using legacy playbook", file=sys.stderr)

    # W23H.A: Also emit range_bound_detected audit event when eligible
    if getattr(state, 'range_bound_eligible', False):
        print(f"AUDIT_EVENT_JSON {json.dumps({'event': 'bias_engine.range_bound_detected', 'net_bias': state.net_bias, 'confidence': state.bias_confidence, 'atr_percentile': state.htf_context.atr_percentile})}", file=sys.stderr)

    regime_label = PLAYBOOK_TO_REGIME.get(routed_playbook, "UNKNOWN")
    emit(
        regime_label=regime_label,
        playbook=routed_playbook,
        net_bias=state.net_bias,
        bias_confidence=state.bias_confidence,
        no_trade_reasons=state.no_trade_reasons,
        evidence={
            "source": "compute_bias_primary",
            "symbol": symbol,
            "is_refresh": ${isRefresh ? "True" : "False"},
            "htf_daily_trend": htf.daily_trend,
            "htf_weekly_trend": htf.weekly_trend,
            "htf_atr_percentile": htf.atr_percentile,
            "htf_pd_location": htf.pd_location,
            "vp_shape": state.vp_shape,
            "net_bias": state.net_bias,
            "bias_confidence": state.bias_confidence,
            "daily_bars_loaded": len(daily_df),
            "current_price": current_price,
            "opening_range_high": opening_range_high,
            "opening_range_low":  opening_range_low,
            "overnight_bias": overnight_bias_str,
        },
        source="compute_bias_primary",
    )
    primary_ok = True

except Exception as primary_err:
    # ── Fallback: read most-recent bias_decisions row via REST ──────────────
    import urllib.request as _req2
    api_url = os.environ.get("TRADING_FORGE_API_URL", "http://localhost:4000")
    api_key = os.environ.get("API_KEY", "")

    fallback_regime = "UNKNOWN"
    fallback_playbook = "NO_TRADE"
    fallback_evidence = {"fallback": True, "primary_error": str(primary_err)[:120], "symbol": os.environ.get("BIAS_SYMBOL", "MES")}

    try:
        req = _req2.Request(
            f"{api_url}/api/bias-decisions/recent",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        with _req2.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            rows = data.get("data", [])
            if rows:
                latest = rows[0]
                pb = latest.get("playbook", "NO_TRADE")
                fallback_playbook = pb
                fallback_regime = PLAYBOOK_TO_REGIME.get(pb, "UNKNOWN")
                fallback_evidence.update({
                    "source": "bias_decisions_rest_fallback",
                    "raw_state_probs": latest.get("raw_state_probs", {}),
                    "playbook": pb,
                })
    except Exception as rest_err:
        fallback_evidence["rest_error"] = str(rest_err)[:80]

    emit(
        regime_label=fallback_regime,
        playbook=fallback_playbook,
        net_bias=0,
        bias_confidence=0.0,
        no_trade_reasons=["primary_compute_bias_failed", "using_rest_fallback"],
        evidence=fallback_evidence,
        source="rest_fallback",
    )
`,
      env: { BIAS_SYMBOL: sym },
      timeoutMs: 30_000,  // longer timeout: loads Parquet from disk
      componentName: isRefresh ? "bias-engine-10am-refresh" : "bias-engine-session-start",
      correlationId,
    });

    regimeLabel = biasResult.regime_label ?? "UNKNOWN";
    playbook    = biasResult.playbook ?? "NO_TRADE";
    evidence    = biasResult.evidence ?? {};
    computedViaPrimary = biasResult.source === "compute_bias_primary";

    logger.info(
      { sessionDate, symbol: sym, regimeLabel, playbook, source: biasResult.source, netBias: biasResult.net_bias, isRefresh, correlationId },
      "bias-state: bias engine completed",
    );
  } catch (engineErr) {
    logger.warn(
      { err: engineErr, sessionDate, symbol: sym, isRefresh, correlationId },
      "bias-state: bias engine failed — using UNKNOWN/NO_TRADE fallback (fail-open)",
    );
    evidence = { error: String(engineErr).slice(0, 200), fallback: true, source: "engine_exception", symbol: sym };

    // For 10am refresh failures: preserve the existing 9:30 cache entry (fail-open).
    // Do NOT insert a garbage row — the 9:30 row remains authoritative.
    if (isRefresh) {
      const existing = dailyBiasCache.get(key);
      logger.warn(
        { sessionDate, symbol: sym, correlationId, existingCacheHit: !!existing },
        "bias-state: 10am refresh failed — 9:30 row remains authoritative (fail-open)",
      );
      try {
        await insertAuditRow({
          action: "bias_engine.refresh_10am_et_failed",
          entityType: "paper_session",
          entityId: `${sessionDate}-${sym}`,
          decisionAuthority: "system",
          status: "failure",
          input: { sessionDate, symbol: sym, correlationId },
          result: { error: String(engineErr).slice(0, 200), fallback_used: !!existing },
          correlationId,
        });
      } catch { /* audit failure is non-blocking */ }
      // Return existing cache or stub — never overwrite with garbage
      return existing ?? stubBiasState(sessionDate, sym);
    }
  }

  // Telemetry: record whether we used the real compute_bias or the fallback
  if (!computedViaPrimary) {
    logger.warn(
      { sessionDate, symbol: sym, regimeLabel, playbook, isRefresh, correlationId },
      "bias-state: bias engine completed with REST-fallback (not primary compute_bias) — check DATA_ROOT + Parquet availability",
    );
  }

  // W23H.A — Range-bound 2-day consecutive confirmation gate.
  // If the engine classified RANGE_BOUND, check that the previous trading session
  // ALSO classified RANGE_BOUND. A single RANGE day is insufficient evidence —
  // we need 2 consecutive days to confirm a genuine range regime.
  // Single RANGE day → route to NO_TRADE with awaiting_confirmation reason.
  // Two+ consecutive RANGE days → RANGE_BOUND activated.
  if (regimeLabel === "RANGE_BOUND") {
    try {
      const priorRows = await db.execute(
        sql`SELECT regime_label FROM bias_state WHERE symbol = ${sym} AND session_date < ${sessionDate}::date ORDER BY session_date DESC LIMIT 1`
      );
      const priorRegime: string | null = (priorRows.rows?.[0] as any)?.regime_label ?? null;
      if (priorRegime !== "RANGE_BOUND") {
        // Only 1 consecutive RANGE day → await confirmation, route NO_TRADE
        logger.info(
          { sessionDate, symbol: sym, priorRegime, correlationId },
          "bias-state W23H.A: range_bound_awaiting_confirmation — single RANGE day detected, routing NO_TRADE until 2nd consecutive day",
        );
        try {
          await insertAuditRow({
            action: "bias_engine.range_bound_awaiting_confirmation",
            entityType: "paper_session",
            entityId: `${sessionDate}-${sym}`,
            decisionAuthority: "system",
            status: "info",
            input: { sessionDate, symbol: sym, correlationId },
            result: {
              net_bias: evidence?.net_bias ?? null,
              prior_day_regime: priorRegime,
              range_bound_awaiting_confirmation: true,
            },
            correlationId,
          });
        } catch { /* audit non-blocking */ }
        regimeLabel = "NO_TRADE";
        playbook = "NO_TRADE";
      } else {
        // 2+ consecutive RANGE days → confirmed, emit audit
        logger.info(
          { sessionDate, symbol: sym, correlationId },
          "bias-state W23H.A: range_bound confirmed (2+ consecutive days) — RANGE_BOUND activated",
        );
        try {
          await insertAuditRow({
            action: "bias_engine.range_bound_detected",
            entityType: "paper_session",
            entityId: `${sessionDate}-${sym}`,
            decisionAuthority: "system",
            status: "success",
            input: { sessionDate, symbol: sym, correlationId },
            result: {
              net_bias: evidence?.net_bias ?? null,
              consecutive_count: 2,
              atr_percentile: evidence?.htf_atr_percentile ?? null,
              range_bound_confirmed: true,
            },
            correlationId,
          });
        } catch { /* audit non-blocking */ }
      }
    } catch (gateErr) {
      // DB query failure → fail-open: preserve RANGE_BOUND as classified
      // (conservative: don't silently downgrade to NO_TRADE if we can't query prior day)
      logger.warn(
        { err: gateErr, sessionDate, symbol: sym, correlationId },
        "bias-state W23H.A: range_bound confirmation gate DB query failed — RANGE_BOUND preserved (fail-open)",
      );
    }
  }

  // Resolve active strategy
  let activeStrategyId: string | null = null;
  try {
    activeStrategyId = await resolveActiveStrategy(regimeLabel);
  } catch (stratErr) {
    logger.warn({ err: stratErr, sessionDate, symbol: sym, regimeLabel }, "bias-state: strategy resolution failed — null");
  }

  // Persist to DB — always INSERT so the 9:30 row is preserved when the
  // 10am refresh fires. Readers pick MAX(computed_at) per (session_date, symbol).
  try {
    await db.execute(
      sql`
        INSERT INTO bias_state (session_date, symbol, regime_label, playbook, active_strategy_id, correlation_id, evidence, computed_at, created_at)
        VALUES (
          ${sessionDate}::date,
          ${sym},
          ${regimeLabel},
          ${playbook},
          ${activeStrategyId}::uuid,
          ${correlationId ?? null},
          ${JSON.stringify(evidence)}::jsonb,
          ${computedAt}::timestamptz,
          NOW()
        )
      `,
    );
  } catch (dbWriteErr) {
    logger.warn({ err: dbWriteErr, sessionDate, symbol: sym }, "bias-state: DB persist failed (fail-open, trading continues)");
  }

  // Audit log
  const auditAction = isRefresh ? "bias_engine.refreshed_10am_et" : "bias_engine.strategy_selected";
  try {
    // Detect regime/strategy change vs prior row for refresh delta
    const priorDecision = dailyBiasCache.get(key);
    const regimeChanged = priorDecision ? priorDecision.regimeLabel !== regimeLabel : false;
    const strategyChanged = priorDecision ? priorDecision.activeStrategyId !== activeStrategyId : false;

    await insertAuditRow({
      action: auditAction,
      entityType: "paper_session",
      entityId: `${sessionDate}-${sym}`,
      decisionAuthority: "system",
      status: "success",
      input: { sessionDate, symbol: sym, correlationId, isRefresh },
      result: {
        regimeLabel,
        playbook,
        activeStrategyId,
        evidence,
        ...(isRefresh ? { regimeChanged, strategyChanged } : {}),
      },
      correlationId,
    });
  } catch (auditErr) {
    logger.warn({ err: auditErr, sessionDate, symbol: sym }, "bias-state: audit_log write failed (non-blocking)");
  }

  // SSE broadcast
  try {
    if (isRefresh) {
      const priorDecision = dailyBiasCache.get(key);
      broadcastSSE("bias_engine:refreshed", {
        sessionDate,
        symbol: sym,
        regimeLabel,
        playbook,
        activeStrategyId,
        computedAt,
        priorRegimeLabel: priorDecision?.regimeLabel ?? null,
        priorActiveStrategyId: priorDecision?.activeStrategyId ?? null,
        regimeChanged: priorDecision ? priorDecision.regimeLabel !== regimeLabel : false,
        strategyChanged: priorDecision ? priorDecision.activeStrategyId !== activeStrategyId : false,
      });
    } else {
      broadcastSSE("bias_engine:strategy_selected", {
        sessionDate,
        symbol: sym,
        regimeLabel,
        playbook,
        activeStrategyId,
        computedAt,
      });
    }
  } catch {
    // SSE failures are never blocking
  }

  const decision: CachedBiasDecision = {
    sessionDate,
    symbol: sym,
    regimeLabel,
    playbook,
    activeStrategyId,
    evidence,
    computedAt,
  };
  // Always update cache with latest decision (whether session-start or refresh)
  dailyBiasCache.set(key, decision);
  return decision;
}

/**
 * Compute bias for all active symbols in parallel.
 * Used by session-start cron + 10:00 ET refresh cron.
 *
 * Returns a map of symbol → BiasStateForSignal.
 * Never throws — per-symbol failures are logged and return stubBiasState.
 */
export async function computeBiasForAllSymbols(
  sessionDate: string,
  correlationId?: string,
  forceRefresh = false,
): Promise<Map<string, BiasStateForSignal>> {
  const results = new Map<string, BiasStateForSignal>();

  await Promise.all(
    BIAS_SYMBOLS.map(async (sym) => {
      try {
        const result = await getOrComputeBiasStateForDay(
          sessionDate, // reuse as "barTimestamp" — barTimestampToTradingDay will strip time
          correlationId,
          sym,
          forceRefresh,
        );
        results.set(sym, result);
      } catch (err) {
        logger.warn({ err, symbol: sym, sessionDate, isRefresh: forceRefresh }, "computeBiasForAllSymbols: symbol failed — using stub");
        results.set(sym, stubBiasState(sessionDate, sym));
      }
    }),
  );

  return results;
}
