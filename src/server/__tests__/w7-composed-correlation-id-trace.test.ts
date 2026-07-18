/**
 * w7-composed-correlation-id-trace.test.ts — W7-2 (2026-07-18), $250-1K campaign close-out
 *
 * COMPOSITION-VERIFICATION test (not a unit test). Waves W1 (F-3 bar-time exit slippage),
 * W2 (unified stop-geometry: managedStopPts/sizingStopPts), W2b/C-05 (risk-sizing
 * "lowest wins", no healthy-account pyramid-floor override), and M2 (deterministic
 * hash-seeded fill-model RNG) each landed with their OWN dedicated test that mocks the
 * other 3 away. NONE of them had been proven to compose on one real trade through a
 * real DB. This file traces a single trade's correlationId end-to-end through:
 *   sizing decision -> pending-entry persistence -> position open (fill) -> exit
 *     -> journal (paper_trades) / audit_log
 * against a REAL in-memory PGlite Postgres (createTestDb()), calling the REAL
 * production functions at every hop — no hand-simulated DB writes.
 *
 * ── Entry-point choice (see also the final assistant report for the full writeup) ──
 * `evaluateSignals()` in paper-signal-service.ts is a single ~7000-line function that
 * gates a signal through ~15 unrelated concerns (11-factor confluence scoring, DLL
 * bands, lunch/macro blackout, consistency-rule, bias-engine, indicator computation,
 * daily-trade-cap, ...) before it ever reaches sizing. Driving a real signal through
 * ALL of those gates would require standing up the bias engine, indicator pipeline,
 * and confluence scorer — none of which are part of what W1/W2/C-05/M2 touch — and
 * would make this test a referendum on the whole signal pipeline instead of a
 * targeted composition proof of the 4 named fixes. Instead this file calls the exact
 * REAL functions each fix lives in, wired together by hand through ONE continuous
 * real-DB script, threading the correlationId exactly the way evaluateSignals does
 * (mint once at the signal, persist it, read it back at the next hop):
 *
 *   1. computeRiskDerivedContracts()   [risk-sizing.ts]              — C-05 engages
 *   2. persistPendingEntry() + read back [pending-entry-persistence.ts]
 *   3. openPosition()                  [paper-execution-service.ts]  — W2 + M2 engage
 *   4. closePosition()                 [paper-execution-service.ts]  — F-3 engages
 *
 * This is MORE than the ground rules' minimum 2-segment bar (signal->sizing->fill,
 * fill->exit->journal) — segment (b) here literally reads the row segment (a) wrote,
 * and both segments share one PGlite instance / one transaction-visible DB state.
 *
 * ── db/index.js injection ──────────────────────────────────────────────────────────
 * Every production service in this call chain (openPosition, closePosition, the
 * 9-layer kill switch, pipeline-control-service, cross-symbol-pnl, ...) imports the
 * singleton `db` from "../db/index.js" directly (not dependency-injected). The
 * standard pattern this test-layer uses to make that singleton resolve to the real
 * PGlite instance is a `vi.mock` redirect (same pattern as
 * pending-entry-durability.integration.test.ts and composite-shadow.integration.test.ts):
 * intercept the module, return a getter that reads a `let injectedDb` set in beforeAll.
 * PGlite itself is never mocked — this only swaps which physical Postgres the existing
 * production code talks to.
 *
 * ── What's mocked, and why each is the sanctioned "unavoidable external boundary" ──
 *   - "../lib/python-runner.js" (runPythonModule) — every Python-subprocess call site
 *     openPosition/closePosition can reach (C5 compliance gate, calendar_filter) is
 *     ALREADY documented fail-open in the source (see the comments at the call sites
 *     cited in the report). Mocking it to reject exercises that real fail-open path
 *     deterministically and fast instead of spawning a real subprocess with a 3s
 *     timeout budget. This is the same class of boundary the task brief pre-authorizes
 *     ("the Python exit-decision subprocess ... if paper's internal engine doesn't
 *     need those for a PAPER-state position").
 *   - "../index.js" — stubs the Express app-boot module (which runs
 *     runPendingMigrations() at import time) that paper-execution-service.ts's import
 *     graph transitively reaches via scheduler.ts -> paper-signal-service.ts. Same
 *     stub pattern pending-entry-durability.integration.test.ts uses.
 * The DB itself is never mocked or hand-simulated — every table read/write in this
 * file goes through the real Drizzle schema against the real PGlite instance.
 *
 * ── Engineered scenario (so all 4 fixes actually ENGAGE, not just pass through) ────
 *   - Symbol MES, ATR=4, stopMultiplier=1.5 -> managedStopPts=min(14, 1.5*4)=6pt
 *     (the OLD hardcoded pre-Wave-2 formula was atr*2.0=8pt, uncapped, floor-free,
 *     ignoring configMult — 6 != 8 proves W2 is what's driving the persisted stop).
 *   - Sizing: firm=mffu, accountBalance=$5,000, max_risk_pct_per_trade=2%,
 *     pyramidTier=9 (base_contracts) vs riskDerivedCap=floor($100 / (6pt*$5))=3.
 *     finalContracts must be 3 (riskDerivedCap binds BELOW pyramidTier) — proves
 *     C-05's pure min() lowest-wins, not the old max(base, ...) floor override.
 *   - Entry fill: TF_MAX_TRADES_PER_DAY=0 (env) disables the D6 Python kill-switch
 *     gate (documented operator escape valve, CLAUDE.md Don't-section) so the ONLY
 *     Python-subprocess touchpoint left is C5 compliance (fail-open, mocked). The
 *     M2 deterministic RNG (seededUniformDraw) engages at BOTH the fill-probability-
 *     miss check and the latency-drift draw — proven by independently recomputing
 *     applyLatency() with the identical seed identity and asserting the persisted
 *     entryPrice matches exactly.
 *   - Exit: bar timestamped 16:30 ET (inside the 16:00-17:00 ET CME_HALT window,
 *     classifySessionType() etMinutes [960,1020)) threaded via context.barTimestamp.
 *     F-3 makes the SESSION CLASSIFICATION — and therefore the 100x CME_HALT
 *     slippage multiplier — a deterministic function of the BAR's timestamp, not of
 *     wall-clock `new Date()` (the pre-fix bug). This test proves engagement by
 *     showing classifySessionType() returns a DIFFERENT session for the entry bar
 *     (RTH) vs the exit bar (CME_HALT) fed through the identical pure function, and
 *     that the persisted exit slippage/exitPrice match the CME_HALT-scale value
 *     exactly (not the RTH-scale value a wall-clock-driven bug would have produced
 *     on an arbitrary test-run wall-clock time).
 *
 * ── correlationId propagation — real, not fabricated ────────────────────────────
 * closePosition() is called WITHOUT context.correlationId (only barTimestamp/atr/
 * medianAtr) — this matches the REAL, most common production call shape for a
 * management exit (paper-execution-service.ts:4604/4715/4838, the stop/TP/time-stop
 * paths inside updatePositionPrices), NOT the less common explicit-override shape
 * seen at a few other call sites (e.g. :5088, :6115 batchCorrelationId). Per the
 * documented BL-9 priority ("context caller -> persisted entry id -> fresh UUID"),
 * omitting context.correlationId makes closePosition fall back to the position's
 * OWN persisted correlationId (set at openPosition) — this is the real mechanism
 * schema.ts's own comment on paperTrades.correlationId documents as the contract
 * ("Populated from the originating signal's correlationId (carried via
 * paperPositions.correlationId)"). No wrapper injects the id after the fact.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";

let injectedDb: TestDb["db"] | null = null;

// Standard PGlite-injection pattern for this test layer (see
// pending-entry-durability.integration.test.ts / composite-shadow.integration.test.ts):
// every production service in the call chain imports the `db` singleton directly from
// "../db/index.js" — swap the module import at test time so it resolves to the real
// PGlite instance created in beforeAll. PGlite itself is never mocked.
vi.mock("../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

// paper-execution-service.ts -> scheduler.ts -> paper-signal-service.ts transitively
// reaches ../index.js (the Express app boot, which runs runPendingMigrations() at
// module load). Stub it minimally to stop the boot chain at collection — same
// precedent as pending-entry-durability.integration.test.ts.
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The unavoidable external boundary: every Python-subprocess call site openPosition/
// closePosition can reach (C5 compliance gate at entry, calendar_filter at exit
// journal-enrichment) is documented fail-open/fail-soft in the source. Rejecting here
// exercises that real fail-open path deterministically and fast instead of spawning a
// real subprocess. See file-header comment for the full rationale.
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockRejectedValue(
    new Error("w7-test: python subprocess boundary intentionally mocked — see file header"),
  ),
}));

import {
  strategies,
  paperSessions,
  paperPositions,
  paperTrades,
  auditLog,
} from "../db/schema.js";
import {
  computeRiskDerivedContracts,
  type RiskSizingInputs,
} from "../lib/risk-sizing.js";
import { managedStopPts, sizingStopPts } from "../lib/stop-geometry.js";
import {
  persistPendingEntry,
  type PersistablePendingEntry,
} from "../lib/pending-entry-persistence.js";
import {
  openPosition,
  closePosition,
  applyLatency,
  classifySessionType,
  toSlippageSession,
  FILL_MODEL_VERSION,
  type FillModelSeedIdentity,
} from "../services/paper-execution-service.js";

// ─── Fixed identity constants (chosen so the M2 deterministic RNG draws land on the
//     "fills" side of the fill-probability-miss check — see file header + the report's
//     seed-search note. The seed is a pure function of these strings; nothing here is
//     re-rolled or retried at test time). ────────────────────────────────────────────

const STRATEGY_UUID = "00007777-0000-0000-0000-000000000001";
const SESSION_UUID = "0000aaaa-0007-0000-0000-000000000002";
const SYMBOL = "MES";
const ENTRY_SIGNAL_PRICE = 5800;
const ATR = 4;
const STOP_MULTIPLIER = 1.5;
const ENTRY_CORRELATION_ID = "w7-trace-002"; // seed-searched: fillMissDraw=0.3791 <= fillProb(0.6375) -> fills

// Entry bar: 2026-06-23 10:00 ET (EDT, summer, UTC-4) -> RTH (NY_OPEN), never CME_HALT
// (entries during CME_HALT are rejected outright by openPosition — P1-7).
const ENTRY_BAR_ISO = "2026-06-23T14:00:00.000Z";
// Exit bar: 2026-06-23 16:30 ET -> inside the 16:00-17:00 ET CME_HALT settlement window
// (classifySessionType: etMinutes in [960,1020)).
const EXIT_BAR_ISO = "2026-06-23T20:30:00.000Z";

describe("W7-2 composed correlationId trace — sizing -> pending-entry -> fill -> exit (real PGlite DB)", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;

    // ── Supplementary DDL: tables required by the REAL kill-switch / pipeline-
    //    control gates that openPosition() unconditionally evaluates, but which
    //    pglite-db.ts's CORE_DDL does not include (they aren't needed by the other
    //    consumers of that shared harness). Column shapes mirror schema.ts exactly.
    //    Not touching pglite-db.ts itself — this is this file's own supplementary
    //    setup, scoped to this file's PGlite instance only.
    await ctx.pg.exec(`
      CREATE TABLE IF NOT EXISTS system_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        production_mode TEXT NOT NULL DEFAULT 'HALT',
        kill_reason TEXT,
        set_by TEXT NOT NULL DEFAULT 'system',
        set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        operator_absent_since TIMESTAMPTZ,
        operator_absent_pending TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS system_parameters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        param_name TEXT NOT NULL UNIQUE,
        current_value NUMERIC NOT NULL,
        min_value NUMERIC,
        max_value NUMERIC,
        description TEXT,
        domain TEXT NOT NULL,
        auto_tunable BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);
    // Layer 1 (manual halt) of the 9-layer kill switch fails CLOSED if this row is
    // missing or production_mode='HALT'. Seed it healthy — this is the REAL Layer-1
    // code path (checkLayer1Manual) reading REAL data, not a bypass.
    await ctx.pg.exec(
      `INSERT INTO system_state (id, production_mode, set_by) VALUES (1, 'PAPER', 'w7-test')
       ON CONFLICT (id) DO UPDATE SET production_mode = 'PAPER';`,
    );

    // FINDING (harness DDL-parity gap, reported in full in the final report): schema.ts
    // declares BOTH paperPositions.id and paperTrades.id as `uuid(...).defaultRandom()`,
    // but pglite-db.ts's CORE_DDL only carries that DEFAULT on audit_log / broker_accounts
    // / paper_pending_entries (per that file's own "M2 sibling fix" comments) — paper_
    // positions and paper_trades were missed. openPosition()/closePosition() both rely on
    // the DB default (they never supply an id in their INSERT), so calling the REAL
    // production functions against the shared harness fails with a NOT NULL violation
    // until this is patched. Every other pglite consumer of these two tables sidesteps
    // this by hand-supplying explicit ids (never calling openPosition/closePosition for
    // real) — this appears to be the first test to call the real fill/close functions
    // against this harness. Patched here via supplementary ALTER TABLE scoped to this
    // file's own PGlite instance (NOT editing pglite-db.ts, per the task's file-scope
    // constraint) — gen_random_uuid() is already proven available in this harness (used
    // by audit_log/broker_accounts/paper_pending_entries above).
    await ctx.pg.exec(`
      ALTER TABLE paper_positions ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE paper_trades ALTER COLUMN id SET DEFAULT gen_random_uuid();
    `);
    // system_parameters intentionally left with NO pipeline_mode row: isPipelineActive()
    // defaults to "ACTIVE" when the row is absent (real code path, not a stub).

    // D6 kill-switch (a SEPARATE Python-subprocess gate from the 9-layer kill switch
    // above) only fires when dailyLossLimit>0 OR the resolved max-trades-per-session
    // cap is >0. Session config below sets neither, and TF_MAX_TRADES_PER_DAY=0 zeroes
    // the env default too, so resolveKillSwitchMaxTradesPerSession() returns undefined
    // and the D6 Python call is skipped entirely (documented operator escape valve —
    // CLAUDE.md §13 "Setting TF_MAX_TRADES_PER_DAY=0 disables the gate for debugging
    // only"). This is a real, documented code path being exercised for its intended
    // purpose, not a workaround invented for this test.
    process.env.TF_MAX_TRADES_PER_DAY = "0";

    await ctx.db.insert(strategies).values({
      id: STRATEGY_UUID,
      name: "w7-composed-trace-strategy",
      symbol: SYMBOL,
      timeframe: "5m",
      config: {},
    });

    await ctx.db.insert(paperSessions).values({
      id: SESSION_UUID,
      strategyId: STRATEGY_UUID,
      status: "active",
      mode: "paper",
      firmId: "mffu",
      startingCapital: "5000",
      currentEquity: "5000",
      peakEquity: "5000",
      realizedPeakEquity: "5000",
      highWaterBalance: "5000",
      totalTrades: 0,
      config: {},
    });
  });

  afterAll(async () => {
    delete process.env.TF_MAX_TRADES_PER_DAY;
    await ctx.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Segment A — signal -> sizing decision -> pending-entry persistence
  // ═══════════════════════════════════════════════════════════════════════════════

  it("Segment A: computeRiskDerivedContracts() sizes to riskDerivedCap (3), NOT pyramidTier (9) — C-05 lowest-wins engages", async () => {
    const sizingInputs: RiskSizingInputs = {
      positionSizeConfig: {
        type: "risk_derived_pyramid",
        base_contracts: 9,
        tier_increment: 3,
        tier_threshold_dollars: 3000,
        personal_dll_pct: 0.67,
        max_risk_pct_per_trade: 0.02,
        liquidity_comfort_cap: 100,
        topstep_account_cap_override: null,
        computed_at_signal_time: true,
      },
      accountBalance: 5000,
      cumulativeProfit: 0,
      atrPoints: ATR,
      stopMultiplier: STOP_MULTIPLIER,
      pointDollarValue: 5, // MES
      firmContractCap: null,
      firm: "mffu",
      symbol: SYMBOL,
    };

    const sizingResult = computeRiskDerivedContracts(sizingInputs);

    // pyramidTier = base_contracts(9) + tier_increment(3) * tiers(0, cumulativeProfit=0) = 9
    expect(sizingResult.pyramidTier).toBe(9);
    // sizingStopPts(MES, 4, 1.5) = min(max(1.5*4, floor=6), ceiling=14) = 6
    // stopDollarsPerContract = 6 * $5 = $30; riskDollars = $5000*0.02 = $100
    // riskDerivedCap = floor(100/30) = 3
    expect(sizingStopPts(SYMBOL, ATR, STOP_MULTIPLIER)).toBe(6);
    expect(sizingResult.riskDerivedCap).toBe(3);
    // C-05: pure min(pyramidTier, riskDerivedCap, ...) — the healthy-account floor
    // override was REMOVED. If it were still present, finalContracts would be 9
    // (or some max(base,...) blend), not 3.
    expect(sizingResult.finalContracts).toBe(3);
    expect(sizingResult.confluenceAudit.binding_constraint).toBe("riskDerivedCap");
    expect(sizingResult.rejectionReason).toBeNull();
    expect(sizingResult.pyramidFloorApplied).toBe(false);
  });

  it("Segment A: persistPendingEntry() writes a REAL paper_pending_entries row carrying the entry correlationId", async () => {
    const entry: PersistablePendingEntry = {
      sessionId: SESSION_UUID,
      symbol: SYMBOL,
      side: "long",
      contracts: 3, // = Segment A's sizingResult.finalContracts, threaded by hand (as evaluateSignals would)
      orderType: "stop_limit",
      stopLimitOffset: undefined,
      rsi: undefined,
      atr: ATR,
      barVolume: undefined,
      medianBarVolume: undefined,
      signalBarTimestamp: ENTRY_BAR_ISO,
      correlationId: ENTRY_CORRELATION_ID,
      stopMultiplier: STOP_MULTIPLIER,
      entryContext: undefined,
      newsReducedAtSignalTime: false,
    };
    await persistPendingEntry(entry);

    const { paperPendingEntries } = await import("../db/schema.js");
    const rows = await ctx.db
      .select()
      .from(paperPendingEntries)
      .where(eq(paperPendingEntries.sessionId, SESSION_UUID));
    expect(rows).toHaveLength(1);
    expect(rows[0].correlationId).toBe(ENTRY_CORRELATION_ID);
    expect(rows[0].contracts).toBe(3);
    expect(rows[0].symbol).toBe(SYMBOL);
    expect(Number(rows[0].stopMultiplier)).toBe(STOP_MULTIPLIER);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Segment B — read the pending-entry row back -> real fill (openPosition) ->
  //   real exit (closePosition) -> journal/audit_log, asserting value coherence and
  //   correlationId identity at every hop.
  // ═══════════════════════════════════════════════════════════════════════════════

  let positionId: string;
  let expectedActualEntry: number;
  let expectedInitialStopPrice: number;
  let expectedTp2Price: number;

  it("Segment B: openPosition() reads the REAL pending-entry contract count and stop-geometry inputs, fills via the deterministic M2 RNG path, and persists W2's managedStopPts-derived stop/TP2 — all under the SAME correlationId", async () => {
    const { paperPendingEntries } = await import("../db/schema.js");
    const [pendingRow] = await ctx.db
      .select()
      .from(paperPendingEntries)
      .where(eq(paperPendingEntries.sessionId, SESSION_UUID));
    expect(pendingRow).toBeDefined();
    expect(pendingRow.correlationId).toBe(ENTRY_CORRELATION_ID);
    expect(pendingRow.contracts).toBe(3);

    // ── Independently recompute the M2 deterministic entry-fill RNG draws using the
    //    REAL exported applyLatency() with the EXACT seed identity openPosition will
    //    construct internally (sessionId, orderIntentId=correlationId, barTimestamp,
    //    fillModelVersion) — reproducible-by-construction, not a second production
    //    write. openPosition's default session config has latencyMs=150 (not
    //    overridden), so this WILL engage (applyLatency short-circuits only when
    //    latencyMs<=0 or atr<=0 — neither is true here).
    const seedIdentity: FillModelSeedIdentity = {
      sessionId: SESSION_UUID,
      orderIntentId: ENTRY_CORRELATION_ID,
      barTimestamp: new Date(ENTRY_BAR_ISO).toISOString(),
      fillModelVersion: FILL_MODEL_VERSION,
    };
    const expectedPriceAfterLatency = applyLatency(
      ENTRY_SIGNAL_PRICE,
      SYMBOL,
      150,
      pendingRow.atr != null ? Number(pendingRow.atr) : ATR,
      seedIdentity,
    );
    // The RNG genuinely engaged (didn't no-op) — a real, nonzero, deterministic drift.
    expect(expectedPriceAfterLatency).not.toBe(ENTRY_SIGNAL_PRICE);
    // medianAtr14 == atr (both 4) is passed at the openPosition call below so
    // slippageTicks = 1*(atr/medianAtr) = 1 exactly, orderType=stop_limit ->
    // orderMod=1.0, entry-bar session = RTH -> sessionMult=1.0, MES tickSize=0.25.
    // slippage = 1 * 1.0 * 1.0 * 0.25 = 0.25 exactly (long side: entry price INCREASES
    // by slippage — calculateSlippage's known, read-from-source formula, see
    // paper-execution-service.ts:576-611).
    const expectedSlippage = 0.25;
    expectedActualEntry = expectedPriceAfterLatency + expectedSlippage;

    const { position, executionResult } = await openPosition(
      SESSION_UUID,
      {
        symbol: SYMBOL,
        side: "long",
        signalPrice: ENTRY_SIGNAL_PRICE,
        contracts: pendingRow.contracts, // <-- REAL value read back from Segment A's DB row
        orderType: "stop_limit",
        barTimestamp: new Date(ENTRY_BAR_ISO),
        atr: ATR,
        stopMultiplier: STOP_MULTIPLIER,
        medianAtr14: ATR, // clean 1.0 ratio for a precisely-reproducible slippage value
        adaptiveExitInput: {
          strategy: { id: STRATEGY_UUID, exit_plan_config: null }, // exit_style stays "static_styleC"
          entry: undefined,
          bar: { close: ENTRY_SIGNAL_PRICE, high: ENTRY_SIGNAL_PRICE, low: ENTRY_SIGNAL_PRICE, volume: 100 },
          marketState: { regime: "TRENDING", narrativePhase: null },
        },
      },
      { correlationId: pendingRow.correlationId ?? undefined },
    );

    expect(executionResult.filled).toBe(true);
    expect(position).not.toBeNull();
    positionId = position!.id;

    // ── W2 stop-geometry: managed stop = min(ceiling=14, 1.5*4) = 6pt. The OLD
    //    hardcoded pre-Wave-2 paper formula was atr*2.0 = 8pt (uncapped, floor-free,
    //    ignoring configMult) — 6 != 8 is the engagement proof.
    const expectedManagedStopPts = managedStopPts(SYMBOL, ATR, STOP_MULTIPLIER);
    expect(expectedManagedStopPts).toBe(6);
    expectedInitialStopPrice = expectedActualEntry - expectedManagedStopPts; // long: stop below entry
    expectedTp2Price = expectedActualEntry + 2.0 * expectedManagedStopPts; // static styleC flat +2.0R

    const [pos] = await ctx.db.select().from(paperPositions).where(eq(paperPositions.id, positionId));
    expect(pos).toBeDefined();

    // ── correlationId IDENTICAL across the entry chain: pending-entry row ->
    //    paper_positions row (both == the one id minted at "signal time").
    expect(pos.correlationId).toBe(ENTRY_CORRELATION_ID);

    // ── Value coherence, not just presence ──────────────────────────────────────
    expect(Number(pos.entryPrice)).toBeCloseTo(expectedActualEntry, 6);
    expect(pos.contracts).toBe(3); // == riskDerivedCap from Segment A, not pyramidTier(9)
    expect(pos.entryContracts).toBe(3);
    expect(Number(pos.initialStopPrice)).toBeCloseTo(expectedInitialStopPrice, 6);

    const exitPlan = pos.exitPlan as unknown as { static_styleC_tp2_price?: number; static_styleC_tp2_r_multiple?: number } | null;
    expect(exitPlan).not.toBeNull();
    expect(exitPlan!.static_styleC_tp2_r_multiple).toBe(2.0);
    // TP2 derives from managedStopPts (6pt -> +12 off entry), NOT the old atr*2.0=8pt
    // formula (which would have produced +16 off entry).
    expect(exitPlan!.static_styleC_tp2_price).toBeCloseTo(expectedTp2Price, 6);

    // ── trade_open audit row carries the SAME correlationId + the stop_basis stamp ──
    const auditRows = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, positionId));
    const openAudit = auditRows.find((r) => r.action === "paper.trade_open");
    expect(openAudit).toBeDefined();
    expect(openAudit!.correlationId).toBe(ENTRY_CORRELATION_ID);
    const openAuditResult = openAudit!.result as { stop_basis?: string; initial_stop_price?: number };
    expect(openAuditResult.stop_basis).toBe("managed_stop_pts");
    expect(openAuditResult.initial_stop_price).toBeCloseTo(expectedInitialStopPrice, 6);
  });

  it("Segment B: classifySessionType() proves the exit-bar session classification is a deterministic function of the THREADED BAR time, not wall-clock (F-3 engagement)", () => {
    const entrySession = classifySessionType(new Date(ENTRY_BAR_ISO));
    const exitSession = classifySessionType(new Date(EXIT_BAR_ISO));
    expect(entrySession).not.toBe("CME_HALT");
    expect(exitSession).toBe("CME_HALT");
    // toSlippageSession only remaps ASIA->ASIAN; CME_HALT passes through unchanged —
    // this is the exact session label calculateSlippage receives from closePosition.
    expect(toSlippageSession(exitSession as never)).toBe("CME_HALT");
  });

  it("Segment B: closePosition() reads the REAL persisted position, applies F-3 bar-time-driven CME_HALT slippage, and the SAME entry correlationId propagates to paper_trades via the BL-9 fallback (no context.correlationId passed — matches the real management-exit call shape)", async () => {
    // Exit at the position's OWN persisted stop (a realistic stop-out narrative;
    // ties the exit trigger price back to the SAME managedStopPts basis W2 computed
    // at entry). medianAtr == atr (both 4) again for a precisely-reproducible
    // slippage value: slippageTicks=1, orderMod=1.0 (stop_limit, closePosition's
    // hardcoded exit order type per P1-10), sessionMult=100 (CME_HALT),
    // tickSize(MES)=0.25 -> slippage = 1*1.0*100*0.25 = 25.0 exactly.
    const exitSignalPrice = expectedInitialStopPrice;
    const expectedExitSlippage = 25.0;
    const expectedActualExit = exitSignalPrice - expectedExitSlippage; // long: exit price DECREASES by slippage

    // No context.correlationId passed — matches paper-execution-service.ts:4604/
    // 4715/4838 (the real stop/TP/time-stop management-exit call shape inside
    // updatePositionPrices), which supplies only {medianAtr, precedingUnrealizedPnl,
    // barTimestamp}. closePosition's BL-9 fallback resolves correlationId from
    // pos.correlationId (the entry's persisted id) when the caller omits it.
    const closeResult = await closePosition(positionId, exitSignalPrice, ATR, {
      medianAtr: ATR,
      barTimestamp: new Date(EXIT_BAR_ISO),
    });
    expect(closeResult).toBeDefined();

    const [closedPos] = await ctx.db.select().from(paperPositions).where(eq(paperPositions.id, positionId));
    expect(closedPos.closedAt).not.toBeNull();

    const trades = await ctx.db.select().from(paperTrades).where(eq(paperTrades.sessionId, SESSION_UUID));
    expect(trades).toHaveLength(1);
    const trade = trades[0];

    // ── correlationId IDENTICAL end-to-end: sizing/pending-entry -> paper_positions
    //    -> paper_trades, all == the ONE id minted at signal time. This is the BL-9
    //    fallback engaging for real (closePosition was called with no
    //    context.correlationId), not a wrapper injecting it after the fact.
    expect(trade.correlationId).toBe(ENTRY_CORRELATION_ID);

    // ── Value coherence on the exit: CME_HALT-scale slippage (100x), driven by the
    //    THREADED bar time, not by wall-clock (F-3). ──────────────────────────────
    expect(Number(trade.slippage)).toBeCloseTo(expectedExitSlippage, 6);
    expect(Number(trade.exitPrice)).toBeCloseTo(expectedActualExit, 6);
    expect(Number(trade.entryPrice)).toBeCloseTo(expectedActualEntry, 6);
    // A losing stop-out, further widened by the CME_HALT slippage artifact.
    expect(Number(trade.pnl)).toBeLessThan(0);

    // ── paper.trade_close audit row also carries the SAME id. NOTE (real production
    //    behavior, confirmed by reading paper-execution-service.ts:2953-2978): this
    //    row's entityId is the paper_trades.id (insertedTrade.id), NOT the position
    //    id — a different join key than openPosition's paper.trade_open row (which
    //    uses entityId=position.id). Querying by trade.id here, not positionId.
    const closeAuditRows = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, trade.id));
    const closeAudit = closeAuditRows.find((r) => r.action === "paper.trade_close");
    expect(closeAudit).toBeDefined();
    expect(closeAudit!.correlationId).toBe(ENTRY_CORRELATION_ID);
    expect(closeAudit!.entityType).toBe("paper_trade");
  });
});
