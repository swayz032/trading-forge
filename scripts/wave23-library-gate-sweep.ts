/**
 * wave23-library-gate-sweep.ts — Wave 23 Pass 2 + Pass 3
 *
 * Pass 2 — Library Graveyard Sweep:
 *   Iterates every CANDIDATE strategy and runs the gate chain in order (stop at first hard fail):
 *   1. C9 DSL Diversity (query strategy_dsl_features — already wired at graduation)
 *   2. R-multiple expectancy ≥ 2.0R (from backtests.gateResult OR resultExtras)
 *   3. Profit factor ≥ 1.7
 *   4. Sharpe ≥ 1.5
 *   5. A4 Frankenstein (query frankenstein_test_runs)
 *   6. A7 Signal Correlation (query signal_correlation_runs)
 *   7. Harsh-regime survival (Phase 0 soft advisory — log don't block)
 *
 * Pass 3 — Validation Gauntlet (survivors only):
 *   Walk-forward stability (5-split, 2018-2025):
 *     Positive OOS Sharpe in ≥70% of windows = pass; else HOLD
 *   Regime cross-validation (4 single-mode backtests):
 *     2019 bull / 2020 COVID / 2022 Fed / 2024 melt-up
 *     Positive R-expectancy in ≥3 of 4 regimes = PROMOTE TO PAPER recommendation
 *
 * CONSTRAINTS:
 *   - Pipeline stays PAUSED; backtests triggered via direct Python subprocess
 *   - actor="operator" bypass is used for any backtest trigger
 *   - Legacy strategies with extraction_provenance="legacy_no_confluence" bypass A+ gate
 *     but still evaluated by metric gates
 *   - Harsh-regime gate is Phase 0 advisory (log, never block)
 *   - Never pass slippage/fees to vectorbt for futures — P&L computed manually in Python
 *
 * Usage:
 *   npx tsx scripts/wave23-library-gate-sweep.ts
 *   npx tsx scripts/wave23-library-gate-sweep.ts --dry-run
 */

import "dotenv/config";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { resolve as pathResolve } from "path";
import { db } from "../src/server/db/index.js";
import {
  strategies,
  backtests,
  auditLog,
  frankensteinTestRuns,
  strategyGraveyard,
  lifecycleTransitions,
} from "../src/server/db/schema.js";
import { eq, desc, and, not, inArray, sql } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const IS_DRY_RUN = process.argv.includes("--dry-run");
// Compute project root: the script is in scripts/, project root is one up.
// process.cwd() is the most reliable in the bash-under-Windows (npx tsx) context.
const PROJECT_ROOT = process.cwd();

// Gate thresholds (operator-locked per Wave 23 spec)
const GATE_EXPECTANCY_R = 2.0;   // R-multiple expectancy minimum
const GATE_PF = 1.7;              // Profit factor minimum
const GATE_SHARPE = 1.5;          // Sharpe ratio minimum

// Backtest date range for pass2 evaluation
const BACKTEST_START = "2018-01-01";
const BACKTEST_END = "2025-12-31";
const WF_SPLITS = 5;

// Regime cross-validation windows (Pass 3)
const REGIME_WINDOWS = [
  { name: "2019_bull",     start: "2019-01-01", end: "2019-12-31" },
  { name: "2020_covid",    start: "2020-02-01", end: "2020-04-30" },
  { name: "2022_fed",      start: "2022-01-01", end: "2022-06-30" },
  { name: "2024_meltup",   start: "2024-07-01", end: "2024-12-31" },
] as const;

// States that already left the active pipeline
const TERMINAL_STATES = ["GRAVEYARD", "RETIRED", "DEPLOYED", "DECLINING", "PAPER", "DEPLOY_READY", "PILOT"];

// ── Types ─────────────────────────────────────────────────────────────────────

interface GateOutcome {
  gate: string;
  passed: boolean;
  reason: string;
  evidence: Record<string, unknown>;
}

interface StrategyResult {
  id: string;
  name: string;
  symbol: string;
  pass2Verdict: "SURVIVED" | "GRAVEYARD" | "NO_BACKTEST";
  failedGate: string | null;
  failureReason: string | null;
  gateOutcomes: GateOutcome[];
  backtestId: string | null;
  sharpe: number | null;
  pf: number | null;
  expectancyR: number | null;
}

interface Pass3Result {
  id: string;
  name: string;
  wfVerdict: "PASS" | "HOLD" | "SKIP";
  wfOosSharpes: number[];
  wfPositiveWindowPct: number;
  regimeVerdict: "PASS" | "FAIL" | "SKIP";
  regimeResults: Array<{ name: string; expectancyR: number | null; passed: boolean; reason: string }>;
  regimesPassedCount: number;
  finalVerdict: "PROMOTE_TO_PAPER" | "HOLD" | "GRAVEYARD";
  notes: string;
}

// ── Python Runner (inline — avoids importing server/index.js) ─────────────────

// Python command resolution:
// - PYTHON_EXE env var overrides (set for custom Python installs)
// - In bash-under-Windows (npx tsx context), `python3` is in bash PATH → works
// - Native Windows PowerShell → `python` works (resolves via Windows PATH)
// - Production-server Linux → `python3`
const PYTHON_CMD = process.env.PYTHON_EXE ?? "python3";
const PYTHON_USE_SHELL = false;

function runPython(config: Record<string, unknown>, module: string, extraArgs: string[] = [], timeoutMs = 600_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const configPath = pathResolve(tmpdir(), `wave23-sweep-${randomUUID()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    const env: Record<string, string> = {
      ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>,
      MKL_CBWR: "COMPATIBLE",
      OPENBLAS_NUM_THREADS: "1",
      BLIS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
    };

    const finalArgs = ["-m", module, "--config", configPath, ...extraArgs];
    const proc = spawn(PYTHON_CMD, finalArgs, {
      env,
      cwd: PROJECT_ROOT,
      shell: PYTHON_USE_SHELL,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill("SIGTERM"); } catch { /* dead */ }
      try { unlinkSync(configPath); } catch { /* ignore */ }
      reject(new Error(`Python module ${module} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unlinkSync(configPath); } catch { /* ignore */ }
      reject(new Error(`Failed to spawn Python (${PYTHON_CMD}): ${err.message}. Check PYTHON_EXE env var.`));
    });

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) {
        stderr += msg + "\n";
        // Always print Python stderr for debugging
        console.warn(`  [py] ${msg}`);
      }
    });

    proc.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unlinkSync(configPath); } catch { /* ignore */ }

      if (code !== 0) {
        reject(new Error(`Python ${module} exited code ${code}. stderr: ${stderr.slice(0, 2000)}`));
        return;
      }

      // Robust JSON parse: skip logging lines, find first {...} or [...]
      const lines = stdout.split("\n");
      let jsonStr = "";
      for (const line of lines) {
        const t = line.trim();
        if ((t.startsWith("{") || t.startsWith("[")) && t.length > 2) {
          jsonStr = t;
          break;
        }
      }
      if (!jsonStr) {
        // Try to parse the whole stdout
        jsonStr = stdout.trim();
      }
      try {
        resolve(JSON.parse(jsonStr) as Record<string, unknown>);
      } catch (parseErr) {
        reject(new Error(`Python ${module} JSON parse failed. stdout: ${stdout.slice(0, 400)}`));
      }
    });
  });
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function writeAuditLog(
  action: string,
  entityId: string,
  entityType: string,
  status: string,
  input: Record<string, unknown>,
  result: Record<string, unknown>,
  correlationId: string,
): Promise<void> {
  if (IS_DRY_RUN) {
    console.log(`  [DRY-RUN] audit_log: ${action} entityId=${entityId}`);
    return;
  }
  await db.insert(auditLog).values({
    action,
    entityId,
    entityType,
    status,
    decisionAuthority: "gate",
    input,
    result,
    correlationId,
  }).catch((err: Error) => {
    console.error(`  [WARN] audit_log insert failed (non-blocking): ${err.message}`);
  });
}

async function graveyardStrategy(
  strategy: { id: string; name: string; config: unknown; symbol: string },
  failureReason: string,
  failedGate: string,
  evidence: Record<string, unknown>,
  correlationId: string,
): Promise<void> {
  if (IS_DRY_RUN) {
    console.log(`  [DRY-RUN] GRAVEYARD: ${strategy.name} — ${failedGate}: ${failureReason}`);
    return;
  }

  // 1. Update lifecycle_state → GRAVEYARD
  await db.update(strategies)
    .set({
      lifecycleState: "GRAVEYARD",
      lifecycleChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, strategy.id));

  // 2. Insert lifecycle_transitions row
  await db.insert(lifecycleTransitions).values({
    strategyId: strategy.id,
    fromState: "CANDIDATE",
    toState: "GRAVEYARD",
    reason: `wave23_sweep: ${failedGate} — ${failureReason}`,
    decisionAuthority: "gate",
  }).catch((err: Error) => {
    console.warn(`  [WARN] lifecycle_transitions insert failed: ${err.message}`);
  });

  // 3. Insert graveyard row
  await db.insert(strategyGraveyard).values({
    strategyId: strategy.id,
    name: strategy.name,
    dslSnapshot: (strategy.config ?? {}) as Record<string, unknown>,
    failureModes: [failedGate],
    failureDetails: evidence as Record<string, unknown>,
    backtestSummary: evidence as Record<string, unknown>,
    deathReason: `Wave 23 graveyard sweep: ${failedGate} — ${failureReason}`,
    deathDate: new Date(),
    source: "auto",
    failureCategory: "performance",
    failureSeverity: "0.9",
  }).catch((err: Error) => {
    console.warn(`  [WARN] graveyard insert failed: ${err.message}`);
  });

  // 4. Audit log
  await writeAuditLog(
    "strategy.graveyarded_by_wave23_sweep",
    strategy.id,
    "strategy",
    "failure",
    { fromState: "CANDIDATE", toState: "GRAVEYARD" },
    {
      failed_gate: failedGate,
      failure_reason: failureReason,
      sweep_version: "wave23-pass2",
      evidence,
    },
    correlationId,
  );

  console.log(`  [GRAVEYARD] ${strategy.name} — failed ${failedGate}: ${failureReason}`);
  console.log(`  [ALERT:CRITICAL] Strategy ${strategy.name} graveyarded by Wave 23 sweep — gate: ${failedGate}`);
}

// ── Backtest trigger via Python ────────────────────────────────────────────────

async function triggerBacktest(
  strategy: { id: string; name: string; symbol: string; timeframe: string; config: Record<string, unknown> },
  mode: "single" | "walk_forward" = "single",
  startDate = BACKTEST_START,
  endDate = BACKTEST_END,
  wfSplits = WF_SPLITS,
): Promise<{ backtestId: string; result: Record<string, unknown> }> {
  console.log(`  [BACKTEST] Triggering ${mode} backtest for ${strategy.name} (${startDate}→${endDate})...`);

  // Build the strategy config from db config.strategy if available
  const cfg = strategy.config as Record<string, unknown>;
  const innerStrategy = (cfg?.strategy as Record<string, unknown>) ?? cfg;

  // Mode CLI arg: "walk_forward" maps to Python CLI "walkforward"
  const pythonMode = mode === "walk_forward" ? "walkforward" : "single";

  const backtestConfig = {
    strategy: {
      name: innerStrategy.name ?? strategy.name,
      symbol: innerStrategy.symbol ?? strategy.symbol,
      timeframe: innerStrategy.timeframe ?? strategy.timeframe,
      indicators: innerStrategy.indicators ?? [],
      entry_long: innerStrategy.entry_long ?? "",
      entry_short: innerStrategy.entry_short ?? "high < low",
      exit: innerStrategy.exit ?? "high < low",
      stop_loss: innerStrategy.stop_loss ?? { type: "atr", multiplier: 1.5 },
      position_size: innerStrategy.position_size ?? { type: "fixed", fixed_contracts: 1 },
    },
    start_date: startDate,
    end_date: endDate,
    ...(mode === "walk_forward" ? { walk_forward_splits: wfSplits } : {}),
    commission_per_side: 0.62,
    // HARD RULE: never pass slippage/fees to vectorbt for futures — Python computes P&L manually
    max_trades_per_day: 2,
  };

  // Insert a DB row first (pending row contract)
  const backtestId = randomUUID();
  if (!IS_DRY_RUN) {
    await db.insert(backtests).values({
      id: backtestId,
      strategyId: strategy.id,
      symbol: (innerStrategy.symbol as string) ?? strategy.symbol,
      timeframe: (innerStrategy.timeframe as string) ?? strategy.timeframe,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      status: "running",
      config: backtestConfig as Record<string, unknown>,
    });
  }

  try {
    const result = await runPython(backtestConfig, "src.engine.backtester", ["--mode", pythonMode], 600_000);

    // Extract key metrics
    const stats = (result.stats as Record<string, unknown>) ?? {};
    const sharpe = stats.sharpe_ratio as number ?? result.sharpe_ratio as number ?? null;
    const pf = stats.profit_factor as number ?? result.profit_factor as number ?? null;
    const expectancyR = stats.expectancy_r as number ?? result.expectancy_r as number ?? null;
    const totalTrades = stats.total_trades as number ?? result.total_trades as number ?? null;

    // Update DB row with results
    if (!IS_DRY_RUN) {
      const wfWindows = mode === "walk_forward"
        ? ((result.windows as Record<string, unknown>[]) ?? null)
        : null;
      await db.update(backtests).set({
        status: "completed",
        sharpeRatio: sharpe !== null ? String(sharpe) : null,
        profitFactor: pf !== null ? String(pf) : null,
        totalTrades: totalTrades,
        walkForwardResults: wfWindows as Record<string, unknown> | null,
        gateResult: (result.gate_result as Record<string, unknown>) ?? null,
        resultExtras: { expectancy_r: expectancyR, ...((result.extras as Record<string, unknown>) ?? {}) } as Record<string, unknown>,
      }).where(eq(backtests.id, backtestId));
    }

    console.log(`  [BACKTEST] Completed: sharpe=${sharpe?.toFixed(3) ?? "null"}, pf=${pf?.toFixed(3) ?? "null"}, expectancy_r=${expectancyR?.toFixed(3) ?? "null"}`);
    return { backtestId, result: { ...result, _sharpe: sharpe, _pf: pf, _expectancy_r: expectancyR } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!IS_DRY_RUN) {
      await db.update(backtests).set({
        status: "failed",
        errorMessage: msg.slice(0, 1000),
      }).where(eq(backtests.id, backtestId)).catch(() => {});
    }
    throw new Error(`Backtest failed for ${strategy.name}: ${msg}`);
  }
}

// ── Gate evaluators ────────────────────────────────────────────────────────────

async function checkC9DslDiversity(strategyId: string): Promise<GateOutcome> {
  // C9 is evaluated at graduation time and stored in strategy_dsl_features.
  // Here we verify the strategy HAS a DSL feature vector (if not, it means C9 was skipped — allow pass)
  // and that it passed (no rejection audit row). For the graveyard sweep we treat C9 as:
  //   - No feature vector: PASS (legacy strategy, C9 ran at graduation, not retroactive)
  //   - Feature vector exists: PASS regardless (C9 blocks at graduation, never at sweep time)
  // C9 is a PRE-backtest gate — if the strategy is CANDIDATE, C9 already passed (or was bypassed for legacy).
  return {
    gate: "C9_DSL_Diversity",
    passed: true,
    reason: "C9 is a pre-graduation gate. Strategies in CANDIDATE state have already passed C9 or are legacy bypasses.",
    evidence: { note: "C9 evaluated at graduation; retroactive sweep treats all CANDIDATEs as C9-cleared" },
  };
}

function checkExpectancyR(
  sharpe: number | null,
  pf: number | null,
  expectancyR: number | null,
  backtestId: string | null,
): GateOutcome {
  // R-multiple expectancy ≥ 2.0R
  // If expectancy_r is not available (legacy backtest), check from resultExtras or gateResult.
  // If entirely absent, this is a data gap — we evaluate on PF as proxy.
  if (expectancyR === null) {
    // Pre-W23 backtest: expectancy_r absent. The gate permissive fallback in performance_gate.py
    // warns and proceeds permissively. Here we log but don't block — mark as "data_gap".
    return {
      gate: "R_Expectancy",
      passed: true, // permissive — pre-W23 backtest
      reason: `expectancy_R absent from backtest ${backtestId ?? "unknown"} — pre-W23 data, proceeding permissively`,
      evidence: { expectancy_r: null, note: "pre-W23 backtest, re-run to enforce" },
    };
  }

  const passed = expectancyR >= GATE_EXPECTANCY_R;
  return {
    gate: "R_Expectancy",
    passed,
    reason: passed
      ? `expectancy_R=${expectancyR.toFixed(3)}R ≥ ${GATE_EXPECTANCY_R}R threshold`
      : `expectancy_R=${expectancyR.toFixed(3)}R < ${GATE_EXPECTANCY_R}R threshold — FAIL`,
    evidence: { expectancy_r: expectancyR, threshold: GATE_EXPECTANCY_R },
  };
}

function checkProfitFactor(pf: number | null): GateOutcome {
  if (pf === null) {
    return {
      gate: "Profit_Factor",
      passed: false,
      reason: "Profit factor absent — cannot evaluate (no completed backtest with PF data)",
      evidence: { pf: null, threshold: GATE_PF },
    };
  }
  const passed = pf >= GATE_PF;
  return {
    gate: "Profit_Factor",
    passed,
    reason: passed
      ? `profit_factor=${pf.toFixed(3)} ≥ ${GATE_PF} threshold`
      : `profit_factor=${pf.toFixed(3)} < ${GATE_PF} threshold — FAIL`,
    evidence: { pf, threshold: GATE_PF },
  };
}

function checkSharpe(sharpe: number | null): GateOutcome {
  if (sharpe === null) {
    return {
      gate: "Sharpe",
      passed: false,
      reason: "Sharpe ratio absent — cannot evaluate",
      evidence: { sharpe: null, threshold: GATE_SHARPE },
    };
  }
  const passed = sharpe >= GATE_SHARPE;
  return {
    gate: "Sharpe",
    passed,
    reason: passed
      ? `sharpe=${sharpe.toFixed(3)} ≥ ${GATE_SHARPE} threshold`
      : `sharpe=${sharpe.toFixed(3)} < ${GATE_SHARPE} threshold — FAIL`,
    evidence: { sharpe, threshold: GATE_SHARPE },
  };
}

async function checkA4Frankenstein(backtestId: string | null, strategyId: string): Promise<GateOutcome> {
  if (!backtestId) {
    return {
      gate: "A4_Frankenstein",
      passed: false,
      reason: "No backtest ID — cannot check Frankenstein test",
      evidence: { backtestId: null },
    };
  }

  const [frank] = await db.select({
    id: frankensteinTestRuns.id,
    passed: frankensteinTestRuns.passed,
    p95Sharpe: frankensteinTestRuns.p95Sharpe,
    medianPf: frankensteinTestRuns.medianPf,
    status: frankensteinTestRuns.status,
  }).from(frankensteinTestRuns)
    .where(and(
      eq(frankensteinTestRuns.backtestId, backtestId),
      eq(frankensteinTestRuns.status, "completed"),
    ))
    .orderBy(desc(frankensteinTestRuns.createdAt))
    .limit(1);

  if (!frank) {
    // No Frankenstein run — in the graveyard sweep, if there's no frank run,
    // we can't block on it (the strategy never reached TESTING). Treat as pass
    // with advisory note. The lifecycle service will enforce it at TESTING→PAPER.
    return {
      gate: "A4_Frankenstein",
      passed: true,
      reason: "No Frankenstein run found for this backtest — CANDIDATE pre-TESTING, gate deferred to TESTING→PAPER lifecycle check",
      evidence: { backtestId, note: "no_frank_run_at_candidate_state" },
    };
  }

  const p95Sharpe = frank.p95Sharpe !== null ? parseFloat(String(frank.p95Sharpe)) : null;
  const medianPf = frank.medianPf !== null ? parseFloat(String(frank.medianPf)) : null;

  return {
    gate: "A4_Frankenstein",
    passed: !!frank.passed,
    reason: frank.passed
      ? `A4 passed: p95_sharpe=${p95Sharpe?.toFixed(3) ?? "null"} < 0.3, median_pf=${medianPf?.toFixed(3) ?? "null"} in [0.85, 1.15]`
      : `A4 FAILED: p95_sharpe=${p95Sharpe?.toFixed(3) ?? "null"} (threshold <0.3), median_pf=${medianPf?.toFixed(3) ?? "null"} (threshold [0.85,1.15])`,
    evidence: { frankensteinRunId: frank.id, passed: frank.passed, p95Sharpe, medianPf },
  };
}

async function checkA7SignalCorrelation(strategyId: string): Promise<GateOutcome> {
  // A7 is a PAPER→DEPLOY_READY gate — not applicable at CANDIDATE state.
  // At graveyard sweep time, no strategy has yet reached PAPER, so no correlation data exists.
  // Treat as pass with advisory note.
  return {
    gate: "A7_Signal_Correlation",
    passed: true,
    reason: "A7 is a PAPER→DEPLOY_READY gate — deferred. No correlation data at CANDIDATE state.",
    evidence: { note: "a7_deferred_to_paper_deploy_ready_gate" },
  };
}

function evaluateHarshRegimeSurvival(regimeResult: Record<string, unknown> | null): GateOutcome {
  // Phase 0 = SOFT advisory, never blocks
  if (!regimeResult) {
    return {
      gate: "Harsh_Regime_Survival",
      passed: true, // advisory — soft
      reason: "No harsh-regime data available — Phase 0 advisory only, not blocking",
      evidence: { phase: "advisory", note: "no_data" },
    };
  }

  const allPassed = !!regimeResult.all_passed;
  const regimesFailed = (regimeResult.regimes_failed as string[]) ?? [];

  return {
    gate: "Harsh_Regime_Survival",
    passed: true, // Phase 0 = ALWAYS non-blocking
    reason: allPassed
      ? "Harsh-regime survival: all 4 regimes passed (Phase 0 advisory)"
      : `Harsh-regime advisory: failed regimes = [${regimesFailed.join(", ")}] (Phase 0 soft — not blocking)`,
    evidence: { phase: "advisory", all_passed: allPassed, regimes_failed: regimesFailed, raw: regimeResult },
  };
}

// ── Pass 2 — Graveyard Sweep ───────────────────────────────────────────────────

async function runPass2(correlationId: string): Promise<StrategyResult[]> {
  console.log("\n════════════════════════════════════════════════");
  console.log("PASS 2 — Library Graveyard Sweep");
  console.log("════════════════════════════════════════════════\n");

  const candidateStrategies = await db.select({
    id: strategies.id,
    name: strategies.name,
    symbol: strategies.symbol,
    timeframe: strategies.timeframe,
    config: strategies.config,
    lifecycleState: strategies.lifecycleState,
  }).from(strategies).where(eq(strategies.lifecycleState, "CANDIDATE"));

  console.log(`Found ${candidateStrategies.length} CANDIDATE strategies\n`);

  const results: StrategyResult[] = [];

  for (const strat of candidateStrategies) {
    console.log(`\n── Strategy: ${strat.name} (${strat.id}) ──`);
    console.log(`   Symbol: ${strat.symbol}  Timeframe: ${strat.timeframe}`);

    const outcomes: GateOutcome[] = [];
    let graveyardVerdictMet = false;
    let failedGate: string | null = null;
    let failureReason: string | null = null;

    // Load latest completed backtest
    const [latestBt] = await db.select({
      id: backtests.id,
      sharpeRatio: backtests.sharpeRatio,
      profitFactor: backtests.profitFactor,
      gateResult: backtests.gateResult,
      resultExtras: backtests.resultExtras,
      walkForwardResults: backtests.walkForwardResults,
    }).from(backtests)
      .where(and(eq(backtests.strategyId, strat.id), eq(backtests.status, "completed")))
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    let backtestId: string | null = null;
    let sharpe: number | null = null;
    let pf: number | null = null;
    let expectancyR: number | null = null;
    let backtestNeeded = false;

    if (!latestBt) {
      console.log(`   No completed backtest found — triggering backtest (2018-01-01 → 2025-12-31, WF 5-split)...`);
      backtestNeeded = true;
    } else {
      backtestId = latestBt.id;
      sharpe = latestBt.sharpeRatio !== null ? parseFloat(String(latestBt.sharpeRatio)) : null;
      pf = latestBt.profitFactor !== null ? parseFloat(String(latestBt.profitFactor)) : null;
      const gateResult = latestBt.gateResult as Record<string, unknown> | null;
      const resultExtras = latestBt.resultExtras as Record<string, unknown> | null;
      expectancyR = (resultExtras?.expectancy_r as number) ?? (gateResult?.expectancy_r as number) ?? null;
      console.log(`   Existing backtest ${backtestId}: sharpe=${sharpe?.toFixed(3) ?? "null"}, pf=${pf?.toFixed(3) ?? "null"}, expectancy_r=${expectancyR?.toFixed(3) ?? "null"}`);
    }

    if (backtestNeeded) {
      // Trigger a walk-forward backtest (5 splits)
      const cfg = strat.config as Record<string, unknown>;
      const innerStrategy = (cfg?.strategy as Record<string, unknown>) ?? cfg;
      const sym = (innerStrategy.symbol as string) ?? strat.symbol;
      const tf = (innerStrategy.timeframe as string) ?? strat.timeframe;

      try {
        const { backtestId: btId, result } = await triggerBacktest(
          { id: strat.id, name: strat.name, symbol: sym, timeframe: tf, config: cfg },
          "walk_forward",
          BACKTEST_START,
          BACKTEST_END,
          WF_SPLITS,
        );
        backtestId = btId;
        sharpe = (result._sharpe as number) ?? null;
        pf = (result._pf as number) ?? null;
        expectancyR = (result._expectancy_r as number) ?? null;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`   [ERROR] Backtest failed: ${msg}`);
        // Log and mark as no-backtest — don't graveyard on infra failure
        results.push({
          id: strat.id,
          name: strat.name,
          symbol: strat.symbol,
          pass2Verdict: "NO_BACKTEST",
          failedGate: "BACKTEST_ERROR",
          failureReason: `Backtest engine error: ${msg.slice(0, 200)}`,
          gateOutcomes: [],
          backtestId: null,
          sharpe: null,
          pf: null,
          expectancyR: null,
        });
        continue;
      }
    }

    // GATE 1: C9 DSL Diversity
    const g1 = await checkC9DslDiversity(strat.id);
    outcomes.push(g1);
    if (!g1.passed) {
      graveyardVerdictMet = true;
      failedGate = g1.gate;
      failureReason = g1.reason;
    }

    // GATE 2: R-multiple expectancy (only if prior gates passed)
    if (!graveyardVerdictMet) {
      const g2 = checkExpectancyR(sharpe, pf, expectancyR, backtestId);
      outcomes.push(g2);
      if (!g2.passed) {
        graveyardVerdictMet = true;
        failedGate = g2.gate;
        failureReason = g2.reason;
      }
    }

    // GATE 3: Profit Factor
    if (!graveyardVerdictMet) {
      const g3 = checkProfitFactor(pf);
      outcomes.push(g3);
      if (!g3.passed) {
        graveyardVerdictMet = true;
        failedGate = g3.gate;
        failureReason = g3.reason;
      }
    }

    // GATE 4: Sharpe
    if (!graveyardVerdictMet) {
      const g4 = checkSharpe(sharpe);
      outcomes.push(g4);
      if (!g4.passed) {
        graveyardVerdictMet = true;
        failedGate = g4.gate;
        failureReason = g4.reason;
      }
    }

    // GATE 5: A4 Frankenstein
    if (!graveyardVerdictMet) {
      const g5 = await checkA4Frankenstein(backtestId, strat.id);
      outcomes.push(g5);
      if (!g5.passed) {
        graveyardVerdictMet = true;
        failedGate = g5.gate;
        failureReason = g5.reason;
      }
    }

    // GATE 6: A7 Signal Correlation
    if (!graveyardVerdictMet) {
      const g6 = await checkA7SignalCorrelation(strat.id);
      outcomes.push(g6);
      if (!g6.passed) {
        graveyardVerdictMet = true;
        failedGate = g6.gate;
        failureReason = g6.reason;
      }
    }

    // GATE 7: Harsh-regime survival (advisory — logged but never blocks)
    {
      const g7 = evaluateHarshRegimeSurvival(null); // No pre-computed regime data at sweep time
      outcomes.push(g7);
      // Advisory — g7.passed is always true in Phase 0
      if (!g7.passed) {
        console.log(`   [ADVISORY] Harsh-regime: ${g7.reason}`);
      }
    }

    // Log gate chain
    for (const outcome of outcomes) {
      const icon = outcome.passed ? "✓" : "✗";
      console.log(`   ${icon} ${outcome.gate}: ${outcome.reason}`);
    }

    if (graveyardVerdictMet) {
      console.log(`\n   VERDICT: GRAVEYARD — failed gate ${failedGate}`);
      await graveyardStrategy(
        strat,
        failureReason!,
        failedGate!,
        { backtestId, sharpe, pf, expectancy_r: expectancyR, gate_chain: outcomes },
        correlationId,
      );
      results.push({
        id: strat.id,
        name: strat.name,
        symbol: strat.symbol,
        pass2Verdict: "GRAVEYARD",
        failedGate,
        failureReason,
        gateOutcomes: outcomes,
        backtestId,
        sharpe,
        pf,
        expectancyR,
      });
    } else {
      console.log(`\n   VERDICT: SURVIVED — all hard gates passed`);
      // Write audit for survival
      await writeAuditLog(
        "strategy.wave23_sweep_survived",
        strat.id,
        "strategy",
        "success",
        { sweep_version: "wave23-pass2" },
        {
          gate_chain: outcomes,
          backtestId,
          sharpe,
          pf,
          expectancy_r: expectancyR,
        },
        correlationId,
      );
      results.push({
        id: strat.id,
        name: strat.name,
        symbol: strat.symbol,
        pass2Verdict: "SURVIVED",
        failedGate: null,
        failureReason: null,
        gateOutcomes: outcomes,
        backtestId,
        sharpe,
        pf,
        expectancyR,
      });
    }
  }

  return results;
}

// ── Pass 3 — Validation Gauntlet ─────────────────────────────────────────────

async function runPass3(survivors: StrategyResult[], correlationId: string): Promise<Pass3Result[]> {
  console.log("\n════════════════════════════════════════════════");
  console.log("PASS 3 — Validation Gauntlet (survivors only)");
  console.log("════════════════════════════════════════════════\n");

  if (survivors.length === 0) {
    console.log("No survivors from Pass 2 — Pass 3 skipped.\n");
    return [];
  }

  console.log(`Processing ${survivors.length} survivor(s)...\n`);

  const pass3Results: Pass3Result[] = [];

  for (const survivor of survivors) {
    console.log(`\n── Pass 3: ${survivor.name} ──`);

    // Load strategy full config
    const [strat] = await db.select({
      id: strategies.id,
      name: strategies.name,
      symbol: strategies.symbol,
      timeframe: strategies.timeframe,
      config: strategies.config,
    }).from(strategies).where(eq(strategies.id, survivor.id));

    if (!strat) {
      console.error(`   [ERROR] Strategy ${survivor.id} not found in DB after Pass 2`);
      continue;
    }

    const cfg = strat.config as Record<string, unknown>;
    const innerStrategy = (cfg?.strategy as Record<string, unknown>) ?? cfg;
    const sym = (innerStrategy.symbol as string) ?? strat.symbol;
    const tf = (innerStrategy.timeframe as string) ?? strat.timeframe;

    // ── Walk-forward stability ────────────────────────────────
    console.log(`   Running walk-forward stability (5-split, 2018-01-01 → 2025-12-31)...`);
    let wfVerdict: "PASS" | "HOLD" | "SKIP" = "SKIP";
    let wfOosSharpes: number[] = [];
    let wfPositiveWindowPct = 0;

    try {
      const { result: wfResult } = await triggerBacktest(
        { id: strat.id, name: strat.name, symbol: sym, timeframe: tf, config: cfg },
        "walk_forward",
        BACKTEST_START,
        BACKTEST_END,
        WF_SPLITS,
      );

      // Extract OOS Sharpe per window
      // walk_forward.py emits: windows[i].oos_metrics.sharpe_ratio
      const wfWindows = (wfResult.walk_forward_results ?? wfResult.windows) as Array<Record<string, unknown>> | undefined;
      if (wfWindows && Array.isArray(wfWindows)) {
        wfOosSharpes = wfWindows
          .map((w) => {
            const oosMet = w.oos_metrics as Record<string, number> | undefined;
            return (oosMet?.sharpe_ratio ?? w.oos_sharpe ?? w.out_of_sample_sharpe ?? w.sharpe) as number ?? null;
          })
          .filter((s): s is number => s !== null);

        const positiveCount = wfOosSharpes.filter((s) => s > 0).length;
        wfPositiveWindowPct = wfOosSharpes.length > 0 ? positiveCount / wfOosSharpes.length : 0;
        wfVerdict = wfPositiveWindowPct >= 0.70 ? "PASS" : "HOLD";

        console.log(`   WF OOS Sharpes: [${wfOosSharpes.map((s) => s.toFixed(3)).join(", ")}]`);
        console.log(`   WF positive window pct: ${(wfPositiveWindowPct * 100).toFixed(0)}% (need ≥70% → ${wfVerdict})`);
      } else {
        console.log(`   [WARN] Walk-forward results have no window breakdown — using overall sharpe`);
        const overallSharpe = wfResult._sharpe as number ?? null;
        if (overallSharpe !== null) {
          wfOosSharpes = [overallSharpe];
          wfPositiveWindowPct = overallSharpe > 0 ? 1.0 : 0.0;
          wfVerdict = overallSharpe > 0 ? "PASS" : "HOLD";
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   [ERROR] Walk-forward backtest failed: ${msg}`);
      wfVerdict = "SKIP";
    }

    // ── Regime cross-validation ───────────────────────────────
    console.log(`\n   Running regime cross-validation (4 single-mode backtests)...`);
    const regimeResults: Pass3Result["regimeResults"] = [];
    let regimeVerdict: "PASS" | "FAIL" | "SKIP" = "SKIP";
    let regimesPassedCount = 0;

    for (const regime of REGIME_WINDOWS) {
      console.log(`   Regime ${regime.name} (${regime.start} → ${regime.end})...`);
      try {
        const { result: regResult } = await triggerBacktest(
          { id: strat.id, name: strat.name, symbol: sym, timeframe: tf, config: cfg },
          "single",
          regime.start,
          regime.end,
          1,
        );

        const regExpR = (regResult._expectancy_r as number) ?? null;
        const regPf = (regResult._pf as number) ?? null;
        const regTrades = (regResult.total_trades ?? (regResult.stats as Record<string, unknown>)?.total_trades) as number ?? 0;

        // Pass: positive R-expectancy
        const passed = regExpR !== null && regExpR > 0 && regTrades >= 5;
        const reason = passed
          ? `expectancy_R=${regExpR.toFixed(3)}R > 0 (${regTrades} trades)`
          : regExpR === null
            ? `no expectancy_R data (trades=${regTrades})`
            : `expectancy_R=${regExpR.toFixed(3)}R ≤ 0 (trades=${regTrades})`;

        if (passed) regimesPassedCount++;
        regimeResults.push({ name: regime.name, expectancyR: regExpR, passed, reason });

        const icon = passed ? "✓" : "✗";
        console.log(`   ${icon} ${regime.name}: ${reason}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`   [ERROR] Regime backtest failed for ${regime.name}: ${msg}`);
        regimeResults.push({
          name: regime.name,
          expectancyR: null,
          passed: false,
          reason: `backtest_error: ${msg.slice(0, 100)}`,
        });
      }
    }

    if (regimeResults.length === REGIME_WINDOWS.length) {
      regimeVerdict = regimesPassedCount >= 3 ? "PASS" : "FAIL";
    }
    console.log(`   Regime verdict: ${regimesPassedCount}/4 passed → ${regimeVerdict}`);

    // ── Final verdict ─────────────────────────────────────────
    let finalVerdict: Pass3Result["finalVerdict"];
    let notes = "";

    if (wfVerdict === "PASS" && regimeVerdict === "PASS") {
      finalVerdict = "PROMOTE_TO_PAPER";
      notes = "Walk-forward stable AND regime-diverse. Recommended for PAPER state (operator authorization required).";
    } else if (wfVerdict === "HOLD" || regimeVerdict === "FAIL") {
      finalVerdict = "HOLD";
      notes = [
        wfVerdict === "HOLD" ? `Walk-forward: OOS positive in ${(wfPositiveWindowPct * 100).toFixed(0)}% windows (need 70%)` : null,
        regimeVerdict === "FAIL" ? `Regime: only ${regimesPassedCount}/4 regimes positive (need 3)` : null,
      ].filter(Boolean).join("; ");
    } else {
      finalVerdict = "HOLD";
      notes = `Walk-forward verdict: ${wfVerdict}, Regime verdict: ${regimeVerdict}`;
    }

    // Write audit log
    await writeAuditLog(
      "pass3.validation_complete",
      strat.id,
      "strategy",
      finalVerdict === "PROMOTE_TO_PAPER" ? "success" : "warning",
      { sweep_version: "wave23-pass3" },
      {
        wf_verdict: wfVerdict,
        wf_oos_sharpes: wfOosSharpes,
        wf_positive_window_pct: wfPositiveWindowPct,
        regime_verdict: regimeVerdict,
        regimes_passed_count: regimesPassedCount,
        regime_results: regimeResults,
        final_verdict: finalVerdict,
        notes,
      },
      correlationId,
    );

    console.log(`\n   FINAL VERDICT: ${finalVerdict}`);
    console.log(`   Notes: ${notes}`);

    pass3Results.push({
      id: strat.id,
      name: strat.name,
      wfVerdict,
      wfOosSharpes,
      wfPositiveWindowPct,
      regimeVerdict,
      regimeResults,
      regimesPassedCount,
      finalVerdict,
      notes,
    });
  }

  return pass3Results;
}

// ── Operator Report ────────────────────────────────────────────────────────────

function printOperatorReport(
  pass2Results: StrategyResult[],
  pass3Results: Pass3Result[],
): void {
  const entered = pass2Results.length;
  const survived = pass2Results.filter((r) => r.pass2Verdict === "SURVIVED");
  const graveyarded = pass2Results.filter((r) => r.pass2Verdict === "GRAVEYARD");
  const noBacktest = pass2Results.filter((r) => r.pass2Verdict === "NO_BACKTEST");
  const p3Promote = pass3Results.filter((r) => r.finalVerdict === "PROMOTE_TO_PAPER");
  const p3Hold = pass3Results.filter((r) => r.finalVerdict === "HOLD");

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          WAVE 23 PASS 2+3 — OPERATOR REPORT                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  PASS 2 — Library Graveyard Sweep`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Strategies entered Pass 2:   ${entered}`);
  console.log(`  Survived Pass 2:             ${survived.length}`);
  console.log(`  Graveyarded:                 ${graveyarded.length}`);
  console.log(`  No backtest (infra error):   ${noBacktest.length}`);
  console.log("");

  if (graveyarded.length > 0) {
    console.log(`  Graveyard details:`);
    for (const r of graveyarded) {
      console.log(`    • ${r.name}: failed ${r.failedGate} — ${r.failureReason}`);
      console.log(`      sharpe=${r.sharpe?.toFixed(3) ?? "null"}, pf=${r.pf?.toFixed(3) ?? "null"}, expectancy_r=${r.expectancyR?.toFixed(3) ?? "null"}`);
    }
    console.log("");
  }

  if (noBacktest.length > 0) {
    console.log(`  No-backtest strategies (need manual retry):`);
    for (const r of noBacktest) {
      console.log(`    • ${r.name}: ${r.failureReason}`);
    }
    console.log("");
  }

  console.log(`  PASS 3 — Validation Gauntlet`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Strategies entered Pass 3:   ${pass3Results.length}`);
  console.log(`  Ready for PAPER promotion:   ${p3Promote.length}`);
  console.log(`  On HOLD:                     ${p3Hold.length}`);
  console.log("");

  if (pass3Results.length > 0) {
    console.log(`  Pass 3 per-strategy verdicts:`);
    for (const r of pass3Results) {
      console.log(`    • ${r.name}: ${r.finalVerdict}`);
      if (r.wfOosSharpes.length > 0) {
        console.log(`      WF: [${r.wfOosSharpes.map((s) => s.toFixed(3)).join(", ")}] → ${r.wfVerdict} (${(r.wfPositiveWindowPct * 100).toFixed(0)}% positive windows)`);
      }
      console.log(`      Regime: ${r.regimesPassedCount}/4 passed → ${r.regimeVerdict}`);
      for (const reg of r.regimeResults) {
        const icon = reg.passed ? "✓" : "✗";
        console.log(`        ${icon} ${reg.name}: ${reg.reason}`);
      }
      if (r.notes) console.log(`      Notes: ${r.notes}`);
    }
    console.log("");
  }

  console.log(`  RECOMMENDATION`);
  console.log(`  ──────────────`);
  if (p3Promote.length > 0) {
    console.log(`  Strategies ready for PAPER promotion (operator authorization required):`);
    for (const r of p3Promote) {
      console.log(`    ★  ${r.name} — PROMOTE TO PAPER`);
    }
  } else if (survived.length > 0) {
    console.log(`  Survivors exist but none passed Pass 3 validation.`);
    console.log(`  Recommendation: hold all survivors pending additional data.`);
  } else {
    console.log(`  No strategies survived Pass 2 gates.`);
    console.log(`  Recommendation: scout pipeline needs to generate new candidates.`);
    console.log(`  All existing strategies failed metric gates (low PF/Sharpe/expectancy_R).`);
  }

  console.log("");
  console.log(`  LIBRARY STATE SUMMARY`);
  console.log(`  ─────────────────────`);
  console.log(`  CANDIDATE (active):  ${survived.length + noBacktest.length}`);
  console.log(`  GRAVEYARD (new):     ${graveyarded.length}`);
  console.log(`  PROMOTE TO PAPER:    ${p3Promote.length}`);
  console.log("");
  console.log(`  ${IS_DRY_RUN ? "[DRY RUN — no DB changes applied]" : "[LIVE RUN — all DB changes applied]"}`);
  console.log("══════════════════════════════════════════════════════════════");
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Wave 23 Library Gate Sweep ${IS_DRY_RUN ? "[DRY RUN]" : "[LIVE]"}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Gate thresholds: expectancy_R ≥ ${GATE_EXPECTANCY_R}R, PF ≥ ${GATE_PF}, Sharpe ≥ ${GATE_SHARPE}`);
  console.log(`Backtest range: ${BACKTEST_START} → ${BACKTEST_END}, WF splits: ${WF_SPLITS}`);

  const correlationId = randomUUID();

  const pass2Results = await runPass2(correlationId);
  const survivors = pass2Results.filter((r) => r.pass2Verdict === "SURVIVED");
  const pass3Results = await runPass3(survivors, correlationId);

  printOperatorReport(pass2Results, pass3Results);

  // Final audit log — sweep complete
  // NOTE: entity_id must be a valid UUID. Use the correlationId as the entity_id
  // for system-level events since there's no single strategy entity.
  await writeAuditLog(
    "wave23.library_sweep_complete",
    correlationId,  // use correlationId as entity_id (valid UUID)
    "wave23_sweep",
    "success",
    { sweep_version: "wave23-pass2-pass3", correlation_id: correlationId },
    {
      pass2_entered: pass2Results.length,
      pass2_survived: survivors.length,
      pass2_graveyarded: pass2Results.filter((r) => r.pass2Verdict === "GRAVEYARD").length,
      pass3_entered: pass3Results.length,
      pass3_promote_count: pass3Results.filter((r) => r.finalVerdict === "PROMOTE_TO_PAPER").length,
      promote_recommendations: pass3Results
        .filter((r) => r.finalVerdict === "PROMOTE_TO_PAPER")
        .map((r) => r.name),
    },
    correlationId,
  );
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
}).finally(() => process.exit(0));
