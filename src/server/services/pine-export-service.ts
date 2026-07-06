import { spawn, type ChildProcess } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyExports, strategyExportArtifacts, auditLog, backtests, monteCarloRuns, quantumMcRuns, brokerAccounts, accountStrategyAssignments } from "../db/schema.js";
import { logger } from "../index.js";
import { broadcastSSE } from "../routes/sse.js";
import { parsePythonJson } from "../../shared/utils.js";
import { getPythonSubprocessStats } from "../lib/python-runner.js";
import { assertNotShadow, PineExportShadowError } from "../lib/pine-export-shadow-guard.js";
import { emitPineShadowRefused } from "../lib/pine-shadow-observability.js";
import { notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
// Pass 4 Track B: pure gateway-options helper — isolated from DB module for testability
import { deriveGatewayOptions, type GatewayOptions } from "../lib/pine-gateway-options.js";
// Re-export so callers that previously imported from this module continue to work
export type { GatewayOptions };
export { deriveGatewayOptions };

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// FIX 4: Pine compiler subprocess pool — mirrors python-runner.ts semaphore pattern.
// Without a cap, concurrent export requests can leak unbounded Python processes.
const PINE_MAX_SUBPROCESSES = Math.max(
  1,
  parseInt(process.env.PINE_MAX_SUBPROCESSES ?? "3", 10) || 3,
);
let _pineActiveCount = 0;
const _pineWaitQueue: Array<() => void> = [];

function _acquirePineSlot(): Promise<void> {
  if (_pineActiveCount < PINE_MAX_SUBPROCESSES) {
    _pineActiveCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    _pineWaitQueue.push(() => {
      _pineActiveCount++;
      resolve();
    });
  });
}

function _releasePineSlot(): void {
  _pineActiveCount = Math.max(0, _pineActiveCount - 1);
  const next = _pineWaitQueue.shift();
  if (next) next();
}

// FIX 4: SIGTERM drain registry for Pine compiler subprocesses.
// Entries auto-remove on process exit so the set always reflects live procs.
const _activePineProcs = new Set<ChildProcess>();

function _registerPineProc(child: ChildProcess): void {
  _activePineProcs.add(child);
  child.once("exit", () => _activePineProcs.delete(child));
}

interface CompilerOutput {
  exportability: {
    score: number;
    band: string;
    indicator_scores: Record<string, number>;
    deductions: string[];
    recommendations: string[];
    exportable: boolean;
    // Semantic-fidelity flag (2026-06-22 FAIL-LOUD mandate).
    // faithful=false means the exported Pine omits validated logic (Style C exits /
    // confluence gating / multi-TF alignment).  Always present on compiler output
    // ≥2026-06-22; absent on old compiler output (treated as true for backward-compat).
    faithful?: boolean;
  };
  artifacts: Array<{
    artifact_type: string;
    file_name: string;
    content: string;
    size_bytes: number;
  }>;
  strategy_name: string;
  pine_version: string;
  content_hash: string;
}

/**
 * G6.3 — Exportability pre-check for TESTING → PAPER promotion.
 *
 * Calls the Pine compiler in dry-run / dual-output mode and returns the
 * exportability score + deductions without persisting an export artifact.
 * Lifecycle service can use this as a hard gate before writing PAPER state.
 *
 * Returns { ok, score, band, deductions, recommendations, faithful,
 * isDirectRoutedArchetype }. `ok` is true iff the strategy compiles AND the
 * compiler's `exportable` flag is set AND (the compiler's `faithful` flag is
 * set OR the strategy is a direct-routed archetype/uncatalogued strategy —
 * see the Deep-Scan #21 Wave-2 note below).
 *
 * Semantic-fidelity model (2026-06-22 FAIL-LOUD mandate):
 *   ok=true  → the exported Pine faithfully reproduces the validated strategy logic
 *              (or the strategy is exempt — see below).
 *   ok=false → one or more features (Style C exits / confluence gating / multi-TF
 *               alignment) cannot be expressed in Pine.  The strategy executes
 *               server-side via broker-router (server-mediated execution); Pine is
 *               a visual-only aid for DEPLOYED strategies — the refusal is by design.
 *
 * faithful defaults to true when absent in compiler output (backward-compat with
 * compiler versions prior to 2026-06-22).
 *
 * ── Deep-Scan #21 Wave-2 (2026-07-05) — archetype/uncatalogued direct-route exemption ──
 * exportability.py's `archetype:`/`uncatalogued:` fast-path now reports `faithful`
 * HONESTLY (previously hardcoded `true` unconditionally — a false-green: an archetype
 * carrying Style-C exits / 11-factor confluence / multi-TF gating would report
 * faithful=true even though Pine genuinely cannot reproduce that logic).
 *
 * BUT archetype/uncatalogued strategies execute DIRECT via broker-router — never
 * through Pine (CLAUDE.md §7 "Pine parity wall") — so Pine's inability to reproduce
 * their entry/exit logic is IRRELEVANT to how they actually execute. Gating promotion
 * on an honest faithful=false for these strategies would strand them at TESTING for a
 * reason that has zero bearing on their real (direct) execution path.
 *
 * This function therefore detects the archetype/uncatalogued prefix on
 * `strat.config.entry_indicator` (or `indicators[0].type` fallback — mirrors
 * exportability.py's own detection exactly) and does NOT require `faithful` for
 * those strategies' `ok` to be true. The `faithful` value returned below is ALWAYS
 * the compiler's honest value (never coerced to true) — no consumer of this result
 * is misled about whether Pine actually reproduces the strategy. `isDirectRoutedArchetype`
 * is surfaced so callers (e.g. lifecycle-service.ts) can log/audit that an exemption
 * was applied, rather than the exemption being invisible.
 *
 * Non-archetype (Pine-routed) strategies are UNCHANGED: ok still requires
 * exportable && faithful, full stop.
 *
 * NOTE: This is a thin wrapper over the existing compiler — it does not
 * yet perform full semantic-equivalence checking (running the strategy in
 * Python AND a Pine simulator and asserting trades match within tolerance).
 * That is documented as the next G6.3 iteration; today's check catches the
 * "strategy can't be expressed in Pine at all" AND "strategy exports a
 * lossy degraded Pine that omits validated logic" failure modes.
 */
export async function checkExportability(strategyId: string): Promise<{
  ok: boolean;
  score: number | null;
  band: string | null;
  deductions: string[];
  recommendations: string[];
  error?: string;
  faithful?: boolean; // Deep-Scan #21 Wave-2: honest value, never coerced for archetypes
  isDirectRoutedArchetype?: boolean;
}> {
  try {
    const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
    if (!strat) {
      return { ok: false, score: null, band: null, deductions: ["strategy_not_found"], recommendations: [] };
    }
    // Dry-run (persist=false) — inspect exportability metadata, no DB writes.
    const result = await compileDualPineExport(strategyId, undefined, undefined, false);

    const exportable = !!result?.exportability?.exportable;
    // faithful defaults to true when absent (backward-compat — pre-2026-06-22 compiler output
    // does not have this field; treat those as faithful to avoid blocking existing pipelines).
    // This is ALWAYS the honest compiler value — never coerced for archetypes.
    const faithful = result?.exportability?.faithful !== false;

    // Deep-Scan #21 Wave-2: detect the archetype:/uncatalogued: direct-route prefix from
    // the strategy's own config — mirrors exportability.py::score_exportability's exact
    // detection (entry_indicator first, indicators[0].type fallback) so the two stay in
    // lockstep. Archetypes/uncatalogued strategies execute DIRECT via broker-router —
    // never through Pine (CLAUDE.md §7) — so they are exempt from the faithfulness
    // requirement below. `faithful` itself is NEVER coerced true for them; only `ok` is.
    const cfg = (strat.config ?? {}) as Record<string, unknown>;
    let entryIndicatorRaw = typeof cfg.entry_indicator === "string" ? cfg.entry_indicator : "";
    if (!entryIndicatorRaw) {
      const inds = Array.isArray(cfg.indicators) ? cfg.indicators : [];
      const first = inds[0];
      entryIndicatorRaw = typeof first === "object" && first !== null
        ? String((first as Record<string, unknown>).type ?? "")
        : String(first ?? "");
    }
    const isDirectRoutedArchetype =
      entryIndicatorRaw.startsWith("archetype:") || entryIndicatorRaw.startsWith("uncatalogued:");
    const gateOk = exportable && (faithful || isDirectRoutedArchetype);

    return {
      ok: gateOk,
      score: result?.exportability?.score ?? null,
      band: result?.exportability?.band ?? null,
      deductions: result?.exportability?.deductions ?? [],
      recommendations: result?.exportability?.recommendations ?? [],
      faithful,
      isDirectRoutedArchetype,
    };
  } catch (err) {
    return {
      ok: false,
      score: null,
      band: null,
      deductions: ["compiler_error"],
      recommendations: [],
      error: err instanceof Error ? err.message : String(err),
      faithful: undefined,
      isDirectRoutedArchetype: false,
    };
  }
}

/** Dual-artifact compiler output — both _INDICATOR.pine and _STRATEGY.pine. */
interface DualCompilerOutput {
  exportability: {
    score: number;
    band: string;
    indicator_scores: Record<string, number>;
    deductions: string[];
    recommendations: string[];
    exportable: boolean;
    // Semantic-fidelity flag (2026-06-22 FAIL-LOUD mandate).
    // faithful=false means the exported Pine omits validated logic (Style C exits /
    // confluence gating / multi-TF alignment).  Always present on compiler output
    // ≥2026-06-22; absent on old compiler output (treated as true for backward-compat).
    faithful?: boolean;
  };
  strategy_name: string;
  pine_version: string;
  content_hash: string;
  indicator_artifact: {
    artifact_type: string;   // "dual_indicator"
    file_name: string;       // "{name}_INDICATOR.pine"
    content: string;
    size_bytes: number;
  } | null;
  strategy_artifact: {
    artifact_type: string;   // "dual_strategy"
    file_name: string;       // "{name}_STRATEGY.pine"
    content: string;
    size_bytes: number;
  } | null;
  alerts_artifact: {
    artifact_type: string;   // "dual_alerts_json"
    file_name: string;
    content: string;
    size_bytes: number;
  } | null;
  indicator_firms: string[];
  strategy_firms: string[];
  degradation_notes: string[];
}

// FIX 4: runPineCompiler now uses pool semaphore + SIGTERM registry + 120s timeout.
async function runPineCompiler(configPath: string, correlationId?: string): Promise<CompilerOutput> {
  await _acquirePineSlot();
  try {
    return await new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const args = ["-m", "src.engine.pine_compiler", "--input-json", configPath];

      const proc = spawn(pythonCmd, args, {
        env: { ...process.env },
        cwd: PROJECT_ROOT,
      });
      _registerPineProc(proc);

      // FIX 4: increased from 60s → 120s per audit requirement
      const TIMEOUT_MS = 120_000;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { proc.kill("SIGTERM"); } catch { /* dead */ }
          killTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* dead */ } }, 2000);
          reject(new Error(`Pine compiler timed out after ${TIMEOUT_MS / 1000}s`));
        }
      }, TIMEOUT_MS);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) {
          stderr += msg + "\n";
          logger.info({ component: "pine-compiler", correlationId }, msg);
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (settled) return;
        settled = true;
        if (code === 0) {
          try {
            resolve(parsePythonJson<CompilerOutput>(stdout));
          } catch {
            reject(new Error(`Failed to parse Pine compiler output: ${stdout.slice(0, 500)}`));
          }
        } else {
          reject(new Error(`Pine compiler failed (exit ${code}): ${stderr.slice(0, 500)}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  } finally {
    _releasePineSlot();
  }
}

// FIX 4: runDualPineCompiler now uses pool semaphore + SIGTERM registry + 120s timeout.
async function runDualPineCompiler(configPath: string, strategyId?: string, correlationId?: string): Promise<DualCompilerOutput> {
  await _acquirePineSlot();
  try {
    return await new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      // --dual flag activates compile_dual_artifacts() in pine_compiler.py
      // --strategy-id passes the DB UUID so it is embedded in TradersPost webhook payloads
      const args = ["-m", "src.engine.pine_compiler", "--input-json", configPath, "--dual"];
      if (strategyId) {
        args.push("--strategy-id", strategyId);
      }

      const proc = spawn(pythonCmd, args, {
        env: { ...process.env },
        cwd: PROJECT_ROOT,
      });
      _registerPineProc(proc);

      // FIX 4: increased from 60s → 120s per audit requirement
      const TIMEOUT_MS = 120_000;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { proc.kill("SIGTERM"); } catch { /* dead */ }
          killTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* dead */ } }, 2000);
          reject(new Error(`Dual Pine compiler timed out after ${TIMEOUT_MS / 1000}s`));
        }
      }, TIMEOUT_MS);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) {
          stderr += msg + "\n";
          logger.info({ component: "pine-compiler-dual", correlationId }, msg);
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (settled) return;
        settled = true;
        if (code === 0) {
          try {
            resolve(parsePythonJson<DualCompilerOutput>(stdout));
          } catch {
            reject(new Error(`Failed to parse dual Pine compiler output: ${stdout.slice(0, 500)}`));
          }
        } else {
          reject(new Error(`Dual Pine compiler failed (exit ${code}): ${stderr.slice(0, 500)}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  } finally {
    _releasePineSlot();
  }
}

/**
 * Compile BOTH Pine artifacts (INDICATOR + STRATEGY) for a strategy that has
 * reached DEPLOY_READY.  Writes two artifact rows to strategy_export_artifacts:
 *   - artifact_type="dual_indicator"  → {name}_INDICATOR.pine (Apex/Tradeify path)
 *   - artifact_type="dual_strategy"   → {name}_STRATEGY.pine (ATS/TradersPost path)
 *   - artifact_type="dual_alerts_json" → alerts metadata for both paths
 *
 * DB schema is NOT changed — both artifacts are separate rows in
 * strategy_export_artifacts (same exportId).  Callers can filter by
 * artifact_type to get the right file for each firm.
 *
 * No exportability score gate — both artifacts are ALWAYS produced when the
 * strategy is exportable.  The score is surfaced as metadata only.
 */
export async function compileDualPineExport(
  strategyId: string,
  firmKey?: string,
  injectedRiskIntelligence?: Record<string, number | string | null> | null,
  persist: boolean = true,
  correlationId?: string,
  recipientQty?: number,
  recipientLabel?: string,
  hmacSecret?: string,
  accountId?: string,
  gatewayOptions?: GatewayOptions,
) {
  // C2/C3 (Pass 3 Track C): SHADOW guard — must be first gate.
  // Prevents Pine artifacts from leaking out of SHADOW strategies, which would
  // corrupt the shadow-signal divergence measurement (Wave 29 Pass A.1 invariant).
  try {
    await assertNotShadow(strategyId, db);
  } catch (err) {
    if (err instanceof PineExportShadowError) {
      // C3: audit row
      try {
        await db.insert(auditLog).values({
          action: "pine_export.refused_shadow_strategy",
          entityType: "strategy",
          entityId: strategyId,
          decisionAuthority: "system",
          input: { strategyId, blockedAt: "compileDualPineExport" } as Record<string, unknown>,
          result: {
            strategy_id: strategyId,
            lifecycle_state: err.lifecycleState ?? "unknown",
            shadow_mode_enabled: err.shadowModeEnabled,
            blocked_at: "compileDualPineExport",
          } as Record<string, unknown>,
          status: "warn",
          correlationId: correlationId ?? null,
        });
      } catch (auditErr) {
        logger.error({ auditErr, strategyId }, "pine-export-shadow-guard: audit write failed");
      }
      // C3: Discord WARN with family-grade postscript
      notifyWarning(
        `Pine export blocked: SHADOW strategy ${strategyId}`,
        appendFamilyGradePostscript(
          `compileDualPineExport blocked for strategy ${strategyId} (${err.message})`,
          "The system blocked a Pine export request for a strategy still in Shadow testing mode.",
          "No action needed — the strategy is not ready for TradingView deployment yet.",
        ),
        { strategyId, lifecycleState: err.lifecycleState, shadowModeEnabled: err.shadowModeEnabled },
      );
      emitPineShadowRefused({
        strategy_id: strategyId,
        lifecycle_state: err.lifecycleState ?? "unknown",
        shadow_mode_enabled: err.shadowModeEnabled,
        blocked_at: "compileDualPineExport",
        correlation_id: correlationId ?? null,
      });
      return { id: null, status: "failed", error: "shadow_strategy_pine_blocked", reason: "shadow_strategy_pine_blocked", ok: false };
    }
    throw err;
  }

  // FIX 4: track wall-clock duration for audit_log
  const startMs = Date.now();

  // 1. Load strategy from DB
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  // P2-4: When persist=false (dry-run / checkExportability), skip all DB writes.
  // Return in-memory result only — no export row, no artifact rows, no audit log.
  let exportId: string | null = null;
  if (persist) {
    // 2. Insert pending export row (export_type = "pine_dual" to distinguish from legacy)
    const [exportRow] = await db
      .insert(strategyExports)
      .values({
        strategyId,
        exportType: "pine_dual",
        status: "compiling",
        propOverlayFirm: firmKey ?? null,
      })
      .returning();
    exportId = exportRow.id;
  }

  try {
    // 3. Risk intelligence — same fetch logic as compilePineExport
    let riskIntelligence: Record<string, number | string | null> | null =
      injectedRiskIntelligence ?? null;
    let latestBacktestId: string | null = null;
    if (riskIntelligence === null) {
      try {
        const [latestBacktest] = await db
          .select({ id: backtests.id })
          .from(backtests)
          .where(eq(backtests.strategyId, strategyId))
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (latestBacktest) {
          latestBacktestId = latestBacktest.id;
          const [mcRun] = await db
            .select({
              probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
              sharpeP50: monteCarloRuns.sharpeP50,
              riskMetrics: monteCarloRuns.riskMetrics,
            })
            .from(monteCarloRuns)
            .where(eq(monteCarloRuns.backtestId, latestBacktest.id))
            .orderBy(desc(monteCarloRuns.createdAt))
            .limit(1);

          const [quantumRun] = await db
            .select({
              estimatedValue: quantumMcRuns.estimatedValue,
              governanceLabels: quantumMcRuns.governanceLabels,
            })
            .from(quantumMcRuns)
            .where(eq(quantumMcRuns.backtestId, latestBacktest.id))
            .orderBy(desc(quantumMcRuns.createdAt))
            .limit(1);

          if (mcRun || quantumRun) {
            const rm = (mcRun?.riskMetrics as Record<string, unknown> | null) ?? {};
            const ruinProb = mcRun?.probabilityOfRuin != null ? Number(mcRun.probabilityOfRuin) : null;
            const survivalRate = ruinProb != null ? 1 - ruinProb : null;
            const breachProb = rm.breach_probability != null ? Number(rm.breach_probability) : null;
            const sharpeP50 = mcRun?.sharpeP50 != null ? Number(mcRun.sharpeP50) : null;
            const govLabels = (quantumRun?.governanceLabels as Record<string, unknown> | null) ?? {};
            const quantumEst = quantumRun?.estimatedValue != null ? Number(quantumRun.estimatedValue) : null;

            const candidate: Record<string, number | string | null> = {
              breach_probability: breachProb,
              ruin_probability: ruinProb,
              survival_rate: survivalRate,
              mc_sharpe_p50: sharpeP50,
              quantum_estimate: quantumEst,
            };
            if (govLabels.decision_role != null) {
              candidate.governance_label = govLabels.decision_role as string;
            }

            const hasData = Object.values(candidate).some((v) => v != null);
            if (hasData) riskIntelligence = candidate;
          }
        }
      } catch (riErr) {
        logger.warn(
          { strategyId, err: riErr },
          "Failed to fetch risk intelligence for dual Pine export (non-blocking)",
        );
      }
    }

    // 4. Build config — pass strategy_id so it embeds in webhook payloads
    const strategyConfig = strategy.config as Record<string, unknown>;

    // Track 4: broker_type field for Pine alert template generation.
    // When an account is wired via broker_accounts, its broker_type determines
    // which webhook payload format the alerts_json artifact uses.
    // TradersPost path: existing JSON shape.
    // TopstepX path: generates a Pine comment stub (not yet implemented).
    // Default: 'traderspost' (backwards-compatible — existing exports unchanged).
    const brokerType = (strategyConfig.broker_type as "traderspost" | "topstepx" | undefined) ?? "traderspost";

    const config: Record<string, unknown> = {
      strategy: { ...strategyConfig },
      firm_key: firmKey,
      strategy_id: strategyId,
      broker_type: brokerType,
      ...(riskIntelligence != null ? { risk_intelligence: riskIntelligence } : {}),
    };
    // T6: Per-recipient params — injected into config JSON for Python subprocess
    if (recipientQty != null) config.recipient_qty = recipientQty;
    if (recipientLabel) config.recipient_label = recipientLabel;
    // BUG-1 fix: inject account_id so Python compile_dual_artifacts can emit the
    // marker alertcondition block (requires both account_id AND hmac_secret).
    if (accountId) config.account_id = accountId;
    if (hmacSecret) {
      config.hmac_secret = hmacSecret;
      // Track 8: inject Trading Forge webhook URL so Pine alert payload includes
      // the destination for marker collection. The URL is embedded as a Pine
      // comment / alert_message field for operator reference — the TradingView
      // alert webhook URL configured by the operator should point here.
      const tfPublicUrl = process.env["TRADING_FORGE_PUBLIC_URL"] ?? "";
      if (tfPublicUrl) {
        config.tf_marker_webhook_url = `${tfPublicUrl}/api/tradingview/marker`;
      }
    }

    // Pass 4 Track B: gateway options — controls Pine alert webhook payload shape.
    //
    // Pine compiler (Track A) reads gateway_mode from strategy["config"]["gateway_mode"]
    // (i.e. input_json.strategy.config.gateway_mode).  We inject into the nested
    // strategy.config sub-dict — creating it if absent — so the Python compiler
    // finds the key at the expected path without a separate top-level key.
    //
    // snake_case keys (gateway_mode, gateway_url) match pine_compiler.py exactly.
    {
      const { opts: gwOpts, shouldAuditFallback } = deriveGatewayOptions(strategyId, gatewayOptions);
      const strategyObj = config["strategy"] as Record<string, unknown>;
      const innerConfig = (typeof strategyObj["config"] === "object" && strategyObj["config"] !== null
        ? strategyObj["config"]
        : {}) as Record<string, unknown>;
      innerConfig["gateway_mode"] = gwOpts.mode;
      if (gwOpts.gatewayUrl) {
        innerConfig["gateway_url"] = gwOpts.gatewayUrl;
      }
      strategyObj["config"] = innerConfig;
      if (shouldAuditFallback) {
        // LOUD audit — operator MUST know Path A (direct) is in use
        try {
          await db.insert(auditLog).values({
            action: "pine_export.fallback_direct_path",
            entityType: "strategy",
            entityId: strategyId,
            decisionAuthority: "system",
            input: { strategyId, correlationId: correlationId ?? null } as Record<string, unknown>,
            result: {
              strategy_id: strategyId,
              reason: "LIVE_ORDER_GATEWAY_URL_unset",
              gateway_mode: "direct",
            } as Record<string, unknown>,
            status: "warn",
            correlationId: correlationId ?? null,
          });
        } catch (auditErr) {
          logger.error({ auditErr, strategyId }, "pine-export-gateway-fallback: audit write failed");
        }
        notifyWarning(
          `Pine export: falling back to direct TradersPost path for strategy ${strategyId}`,
          appendFamilyGradePostscript(
            `LIVE_ORDER_GATEWAY_URL is not set — Pine alert will post DIRECTLY to TradersPost, bypassing the TF gateway. This skips the kill-switch, compliance gate, firm-cap clamp, and circuit breaker.`,
            "The Pine export is using the legacy direct path because LIVE_ORDER_GATEWAY_URL is missing.",
            "Set LIVE_ORDER_GATEWAY_URL in your production .env to enable the institutional Path B gateway.",
          ),
          { strategyId, reason: "LIVE_ORDER_GATEWAY_URL_unset", gatewayMode: "direct" },
        );
      }
    }

    // Pass 6 Track B: A/B routing account_id injection.
    // When a strategy has paper_account_routing set (baseline or rl-challenger),
    // resolve the broker_accounts UUID for the target sub-account and inject it
    // into the Pine alert payload as config.account_id. This allows the TradingView
    // alert to embed the correct account_id so POST /api/live-order → routeOrder()
    // routes to the right slumdawg sub-account.
    //
    // Canonical path: Pine alert → /api/live-order → routeOrder(resolvedAccountId, signal)
    // Pine compiler reads config.account_id to embed in the alertcondition block.
    //
    // Only inject when accountId was NOT already passed in (caller may override).
    {
      const strategyPaperRouting = (strategy as unknown as { paperAccountRouting?: string }).paperAccountRouting
        ?? "baseline";
      if (!config.account_id) {
        const targetExternal = strategyPaperRouting === "rl-challenger"
          ? "slumdawg-rl-challenger"
          : "slumdawg-baseline";
        try {
          const subAccRows = await db
            .select({ accountId: brokerAccounts.accountId })
            .from(brokerAccounts)
            .where(
              and(
                eq(brokerAccounts.accountIdExternal, targetExternal),
                eq(brokerAccounts.firmId, "paper"),
              ),
            )
            .limit(1);
          const resolvedId = subAccRows[0]?.accountId ?? null;
          if (resolvedId) {
            config.account_id = resolvedId;
            // Audit: pine_export.ab_routing_resolved (info)
            await db.insert(auditLog).values({
              action: "pine_export.ab_routing_resolved",
              entityType: "strategy",
              entityId: strategyId,
              decisionAuthority: "system",
              input: { strategyId, paper_account_routing: strategyPaperRouting } as Record<string, unknown>,
              result: {
                strategy_id: strategyId,
                paper_account_routing: strategyPaperRouting,
                resolved_account_id: resolvedId,
                sub_account: targetExternal,
              } as Record<string, unknown>,
              status: "info",
              correlationId: correlationId ?? null,
            });
          }
        } catch (abInjectErr) {
          // Fail-soft: A/B injection failure does not block the export
          logger.warn(
            { strategyId, err: abInjectErr },
            "pine-export: A/B routing account_id injection failed (non-blocking)",
          );
        }
      }
    }

    // hardening/phase-0: live_order_token injection for tf_gateway archetype Pine.
    // When gateway_mode='tf_gateway' and an account_id was resolved (either from caller
    // or A/B routing above), look up the per-account static bearer token from
    // account_strategy_assignments.hmac_secret.  This token is what /api/live-order
    // validates in static-token auth mode B (field name: live_order_token in payload body).
    //
    // Injecting it here means the Pine compiler substitutes it at compile time into
    // the archetype alertcondition message, eliminating the operator-manual text-replace
    // step that caused silent order drops when skipped (the literal placeholder bug).
    //
    // Fail-soft: if the lookup fails or returns no row, we log a warning and proceed
    // without the token — the artifact will contain the literal placeholder (legacy path),
    // and the operator must substitute manually. We do NOT block the export.
    {
      const strategyObj = config["strategy"] as Record<string, unknown>;
      const innerConfig = (typeof strategyObj?.["config"] === "object" && strategyObj["config"] !== null
        ? strategyObj["config"]
        : {}) as Record<string, unknown>;
      const resolvedGatewayMode = innerConfig["gateway_mode"];
      const resolvedAccountId: string | undefined = config.account_id as string | undefined;
      if (resolvedGatewayMode === "tf_gateway" && resolvedAccountId && !config.live_order_token) {
        try {
          const assignmentRows = await db
            .select({ hmacSecret: accountStrategyAssignments.hmacSecret })
            .from(accountStrategyAssignments)
            .where(
              and(
                eq(accountStrategyAssignments.accountId, resolvedAccountId),
                eq(accountStrategyAssignments.strategyId, strategyId),
              ),
            )
            .limit(1);
          const resolvedToken = assignmentRows[0]?.hmacSecret ?? null;
          if (resolvedToken) {
            config.live_order_token = resolvedToken;
          } else {
            logger.warn(
              { strategyId, resolvedAccountId },
              "pine-export: no account_strategy_assignments row for account+strategy — live_order_token will be literal placeholder (operator must substitute manually)",
            );
          }
        } catch (tokenErr) {
          // Fail-soft — do not block the export
          logger.warn(
            { strategyId, resolvedAccountId, err: tokenErr },
            "pine-export: live_order_token lookup failed (non-blocking) — artifact will contain literal placeholder",
          );
        }
      }
    }

    const tmpPath = pathResolve(tmpdir(), `pine-dual-config-${strategyId.slice(0, 8)}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: DualCompilerOutput;
    try {
      // FIX 4: pass correlationId to subprocess wrapper
      result = await runDualPineCompiler(tmpPath, strategyId, correlationId);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // hardening/phase-0 M5: audit warn when archetype strategy caller forgot gatewayOptions.
    // If the strategy is archetype-typed, has paper_account_routing set, but the caller
    // passed gatewayOptions=undefined — the function still resolves correctly via env fallback
    // (deriveGatewayOptions picks up LIVE_ORDER_GATEWAY_URL), but the explicit caller-side
    // threading is missing. Log as warn (not throw) — the export is not blocked.
    if (!gatewayOptions) {
      const stratCfgForGuard = (strategy.config ?? {}) as Record<string, unknown>;
      const entryIndicatorForGuard = typeof stratCfgForGuard.entry_indicator === "string"
        ? stratCfgForGuard.entry_indicator
        : "";
      const routingForGuard = (strategy as unknown as { paperAccountRouting?: string }).paperAccountRouting;
      const hasProductionContext = entryIndicatorForGuard.startsWith("archetype:")
        && routingForGuard != null
        && routingForGuard !== "";
      if (hasProductionContext) {
        logger.warn(
          { strategyId, entryIndicator: entryIndicatorForGuard, paperAccountRouting: routingForGuard },
          "pine_export.gateway_options_missing: archetype strategy with paper_account_routing set but caller did not thread gatewayOptions — " +
          "using env-derived gateway_mode fallback (correct when LIVE_ORDER_GATEWAY_URL is set). " +
          "Thread gatewayOptions explicitly from this caller to make the override intent auditable.",
        );
        try {
          await db.insert(auditLog).values({
            action: "pine_export.gateway_options_missing",
            entityType: "strategy",
            entityId: strategyId,
            decisionAuthority: "system",
            input: {
              strategyId,
              entryIndicator: entryIndicatorForGuard,
              paperAccountRouting: routingForGuard,
              callerPassedGatewayOptions: false,
            } as Record<string, unknown>,
            result: {
              strategy_id: strategyId,
              reason: "archetype_strategy_caller_missing_gateway_options",
              env_fallback_mode: process.env["LIVE_ORDER_GATEWAY_URL"] ? "tf_gateway" : "direct",
            } as Record<string, unknown>,
            status: "warn",
            correlationId: correlationId ?? null,
          });
        } catch (auditMissingErr) {
          logger.error(
            { auditMissingErr, strategyId },
            "pine-export: gateway_options_missing audit write failed (non-blocking)",
          );
        }
      }
    }

    // hardening/phase-0: TS-side post-compile assertion (defense-in-depth).
    // Python raises PineCompileError when credentials were provided but placeholders
    // survive.  This TS guard is a second layer — it catches the case where Python
    // does not raise (e.g., Python is a different version, or the config was not
    // wired correctly) but the artifact still contains literal placeholder strings.
    // M5 fix: assertion fires whenever credentials were resolved (account_id + live_order_token
    // both present in config), regardless of whether the caller explicitly passed gatewayOptions.
    // Previously gated on `gatewayOptions &&` which created a blind spot when callers passed
    // undefined but the internal A/B routing + env fallback resolved full credentials.
    if (config.account_id && config.live_order_token) {
      const artifactsToCheck = [
        result.indicator_artifact,
        result.strategy_artifact,
      ].filter(Boolean) as NonNullable<DualCompilerOutput["indicator_artifact"]>[];
      const placeholder_account = "<account-id-placeholder>";
      const placeholder_token = "<live-order-token-placeholder>";
      for (const art of artifactsToCheck) {
        if (art.content.includes(placeholder_account) || art.content.includes(placeholder_token)) {
          const which = [
            art.content.includes(placeholder_account) ? "account_id (<account-id-placeholder>)" : null,
            art.content.includes(placeholder_token) ? "live_order_token (<live-order-token-placeholder>)" : null,
          ].filter(Boolean).join(", ");
          throw new Error(
            `pine-export: post-compile assertion failed — artifact '${art.file_name}' still contains literal placeholder(s): ${which}. ` +
            "This would cause silent order drops via /api/live-order. " +
            "Credentials were resolved (account_id + live_order_token present) but substitution did not occur.",
          );
        }
      }
    }

    const durationMs = Date.now() - startMs;

    // P2-4: persist=false → skip all DB writes, return in-memory result only
    const artifactRows: { id: string; artifactType: string; fileName: string; sizeBytes: number | null }[] = [];

    if (persist && exportId) {
      // 5. Update export row — FIX 3: write contentHash, configSnapshot, backtestId
      await db
        .update(strategyExports)
        .set({
          exportabilityScore: String(result.exportability.score),
          exportabilityDetails: result.exportability,
          status: "completed",
          pineVersion: result.pine_version,
          // FIX 3: persist content_hash so re-export drift is detectable
          contentHash: result.content_hash ?? null,
          // FIX 3: snapshot the strategy config at export time for reproducibility
          configSnapshot: strategyConfig,
          // FIX 3: link to the backtest that produced this export
          backtestId: latestBacktestId ?? null,
        })
        .where(eq(strategyExports.id, exportId));

      // 6. Insert artifacts — FIX 3: include contentHash per artifact
      const dualArtifacts = [
        result.indicator_artifact,
        result.strategy_artifact,
        result.alerts_artifact,
      ].filter(Boolean) as NonNullable<DualCompilerOutput["indicator_artifact"]>[];

      for (const artifact of dualArtifacts) {
        // FIX 3: compute per-artifact SHA-256 content hash
        const { createHash } = await import("crypto");
        const artifactHash = createHash("sha256").update(artifact.content).digest("hex");
        const [row] = await db
          .insert(strategyExportArtifacts)
          .values({
            exportId,
            artifactType: artifact.artifact_type,
            fileName: artifact.file_name,
            content: artifact.content,
            sizeBytes: artifact.size_bytes,
            pineVersion: result.pine_version,
            // FIX 3: per-artifact hash
            contentHash: artifactHash,
          })
          .returning();
        artifactRows.push(row);
      }

      // 7. Audit log — FIX 4: include durationMs, contentHash, exportType
      await db.insert(auditLog).values({
        action: "pine-export.compile-dual",
        entityType: "strategy_export",
        entityId: exportId,
        input: { strategyId, firmKey, exportType: "pine_dual", correlationId },
        result: {
          exportabilityScore: result.exportability.score,
          band: result.exportability.band,
          contentHash: result.content_hash,
          indicator_file: result.indicator_artifact?.file_name,
          strategy_file: result.strategy_artifact?.file_name,
          degradation_notes: result.degradation_notes,
          artifactCount: artifactRows.length,
          // FIX 4: track duration for performance monitoring
          durationMs,
          status: "success",
        },
        status: "success",
        decisionAuthority: "human",
      });

      // 8. SSE broadcast — pine:export-completed (hyphen, frontend discriminated union)
      broadcastSSE("pine:export-completed", {
        strategyId,
        exportId,
        contentHash: result.content_hash,
        exportabilityScore: result.exportability.score,
        durationMs,
      });

      if (result.exportability.score < 70) {
        broadcastSSE("alert:triggered", {
          type: "low_exportability",
          strategyId,
          score: result.exportability.score,
          message: `Pine dual export score ${result.exportability.score}/100 — strategy may not export cleanly`,
        });
      }

      // 9. Warn if degradation notes present
      if (result.degradation_notes.length > 0) {
        broadcastSSE("alert:triggered", {
          type: "pine_export_degradation",
          strategyId,
          notes: result.degradation_notes,
          message: `Pine dual export has degradation notes: ${result.degradation_notes.join("; ")}`,
        });
      }
    }

    return {
      id: exportId,
      strategyId,
      exportType: "pine_dual",
      exportabilityScore: result.exportability.score,
      exportabilityBand: result.exportability.band,
      status: "completed",
      contentHash: result.content_hash,
      indicator_file: result.indicator_artifact?.file_name,
      strategy_file: result.strategy_artifact?.file_name,
      degradation_notes: result.degradation_notes,
      artifacts: artifactRows.map((r) => ({
        id: r.id,
        artifactType: r.artifactType,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
      })),
      exportability: result.exportability,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startMs;

    if (persist && exportId) {
      await db
        .update(strategyExports)
        .set({ status: "failed", errorMessage: errorMsg })
        .where(eq(strategyExports.id, exportId));

      // FIX 4: audit log on failure includes durationMs
      await db.insert(auditLog).values({
        action: "pine-export.compile-dual",
        entityType: "strategy_export",
        entityId: exportId,
        input: { strategyId, firmKey, exportType: "pine_dual", correlationId },
        result: { error: errorMsg, durationMs, status: "failure" },
        status: "failure",
        decisionAuthority: "human",
        errorMessage: errorMsg,
      });
    }

    // SSE broadcast on failure — always emit regardless of persist flag
    broadcastSSE("pine:export-failed", {
      strategyId,
      errorCode: "compile_dual_failed",
      message: errorMsg,
      durationMs,
    });

    return { id: exportId, status: "failed", error: errorMsg };
  }
}

export async function compilePineExport(
  strategyId: string,
  firmKey?: string,
  exportType: string = "pine_indicator",
  injectedRiskIntelligence?: Record<string, number | string | null> | null,
  correlationId?: string,
  gatewayOptions?: GatewayOptions,
) {
  // C2/C3 (Pass 3 Track C): SHADOW guard — must be first gate.
  try {
    await assertNotShadow(strategyId, db);
  } catch (err) {
    if (err instanceof PineExportShadowError) {
      try {
        await db.insert(auditLog).values({
          action: "pine_export.refused_shadow_strategy",
          entityType: "strategy",
          entityId: strategyId,
          decisionAuthority: "system",
          input: { strategyId, blockedAt: "compilePineExport" } as Record<string, unknown>,
          result: {
            strategy_id: strategyId,
            lifecycle_state: err.lifecycleState ?? "unknown",
            shadow_mode_enabled: err.shadowModeEnabled,
            blocked_at: "compilePineExport",
          } as Record<string, unknown>,
          status: "warn",
          correlationId: correlationId ?? null,
        });
      } catch (auditErr) {
        logger.error({ auditErr, strategyId }, "pine-export-shadow-guard: audit write failed");
      }
      notifyWarning(
        `Pine export blocked: SHADOW strategy ${strategyId}`,
        appendFamilyGradePostscript(
          `compilePineExport blocked for strategy ${strategyId} (${err.message})`,
          "The system blocked a Pine export request for a strategy still in Shadow testing mode.",
          "No action needed — the strategy is not ready for TradingView deployment yet.",
        ),
        { strategyId, lifecycleState: err.lifecycleState, shadowModeEnabled: err.shadowModeEnabled },
      );
      emitPineShadowRefused({
        strategy_id: strategyId,
        lifecycle_state: err.lifecycleState ?? "unknown",
        shadow_mode_enabled: err.shadowModeEnabled,
        blocked_at: "compilePineExport",
        correlation_id: correlationId ?? null,
      });
      return { id: null, status: "failed", error: "shadow_strategy_pine_blocked", reason: "shadow_strategy_pine_blocked", ok: false };
    }
    throw err;
  }

  // FIX 4: track wall-clock duration for audit_log
  const startMs = Date.now();

  // 1. Load strategy from DB
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  // 2. Insert pending export row
  const [exportRow] = await db
    .insert(strategyExports)
    .values({
      strategyId,
      exportType,
      status: "compiling",
      propOverlayFirm: firmKey ?? null,
    })
    .returning();

  const exportId = exportRow.id;

  try {
    // 3. Fetch risk intelligence from MC + quantum MC runs (best-effort, non-blocking).
    //    If the caller already has MC results in scope (e.g. auto-trigger), they can inject
    //    riskIntelligence directly to skip the DB round-trip.
    let riskIntelligence: Record<string, number | string | null> | null =
      injectedRiskIntelligence ?? null;
    if (riskIntelligence === null) {
      try {
        // Find the most recent backtest for this strategy (any status — MC may exist even if bt failed)
        const [latestBacktest] = await db
          .select({ id: backtests.id })
          .from(backtests)
          .where(eq(backtests.strategyId, strategyId))
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (latestBacktest) {
          // Fetch most recent classical MC run for this backtest
          const [mcRun] = await db
            .select({
              probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
              sharpeP50: monteCarloRuns.sharpeP50,
              riskMetrics: monteCarloRuns.riskMetrics,
            })
            .from(monteCarloRuns)
            .where(eq(monteCarloRuns.backtestId, latestBacktest.id))
            .orderBy(desc(monteCarloRuns.createdAt))
            .limit(1);

          // Fetch most recent quantum MC run for this backtest
          const [quantumRun] = await db
            .select({
              estimatedValue: quantumMcRuns.estimatedValue,
              governanceLabels: quantumMcRuns.governanceLabels,
            })
            .from(quantumMcRuns)
            .where(eq(quantumMcRuns.backtestId, latestBacktest.id))
            .orderBy(desc(quantumMcRuns.createdAt))
            .limit(1);

          if (mcRun || quantumRun) {
            const rm = (mcRun?.riskMetrics as Record<string, unknown> | null) ?? {};
            const ruinProb = mcRun?.probabilityOfRuin != null ? Number(mcRun.probabilityOfRuin) : null;
            const survivalRate = ruinProb != null ? 1 - ruinProb : null;
            const breachProb = rm.breach_probability != null ? Number(rm.breach_probability) : null;
            const sharpeP50 = mcRun?.sharpeP50 != null ? Number(mcRun.sharpeP50) : null;
            const govLabels = (quantumRun?.governanceLabels as Record<string, unknown> | null) ?? {};
            const quantumEst = quantumRun?.estimatedValue != null ? Number(quantumRun.estimatedValue) : null;

            const candidate: Record<string, number | string | null> = {
              breach_probability: breachProb,
              ruin_probability: ruinProb,
              survival_rate: survivalRate,
              mc_sharpe_p50: sharpeP50,
              quantum_estimate: quantumEst,
            };
            if (govLabels.decision_role != null) {
              candidate.governance_label = govLabels.decision_role as string;
            }

            // Only include risk_intelligence if at least one numeric field is non-null
            const hasData = Object.values(candidate).some((v) => v != null);
            if (hasData) riskIntelligence = candidate;
          }
        }
      } catch (riErr) {
        // Risk intelligence is advisory — never block export on query failure
        logger.warn(
          { strategyId, err: riErr },
          "Failed to fetch risk intelligence for Pine export (non-blocking)",
        );
      }
    }

    // 4. Build config and write to temp file
    const strategyConfig = strategy.config as Record<string, unknown>;
    const config: Record<string, unknown> = {
      strategy: {
        ...strategyConfig,
        export_type: exportType,
      },
      firm_key: firmKey,
      ...(riskIntelligence != null ? { risk_intelligence: riskIntelligence } : {}),
    };

    // Pass 4 Track B: gateway options — controls Pine alert webhook payload shape.
    //
    // Pine compiler (Track A) reads gateway_mode from strategy["config"]["gateway_mode"]
    // (i.e. input_json.strategy.config.gateway_mode).  We inject into the nested
    // strategy.config sub-dict — creating it if absent — so the Python compiler
    // finds the key at the expected path without a separate top-level key.
    //
    // snake_case keys (gateway_mode, gateway_url) match pine_compiler.py exactly.
    {
      const { opts: gwOpts, shouldAuditFallback } = deriveGatewayOptions(strategyId, gatewayOptions);
      const strategyObj = config["strategy"] as Record<string, unknown>;
      const innerConfig = (typeof strategyObj["config"] === "object" && strategyObj["config"] !== null
        ? strategyObj["config"]
        : {}) as Record<string, unknown>;
      innerConfig["gateway_mode"] = gwOpts.mode;
      if (gwOpts.gatewayUrl) {
        innerConfig["gateway_url"] = gwOpts.gatewayUrl;
      }
      strategyObj["config"] = innerConfig;
      if (shouldAuditFallback) {
        // LOUD audit — operator MUST know Path A (direct) is in use
        try {
          await db.insert(auditLog).values({
            action: "pine_export.fallback_direct_path",
            entityType: "strategy",
            entityId: strategyId,
            decisionAuthority: "system",
            input: { strategyId, correlationId: correlationId ?? null } as Record<string, unknown>,
            result: {
              strategy_id: strategyId,
              reason: "LIVE_ORDER_GATEWAY_URL_unset",
              gateway_mode: "direct",
            } as Record<string, unknown>,
            status: "warn",
            correlationId: correlationId ?? null,
          });
        } catch (auditErr) {
          logger.error({ auditErr, strategyId }, "pine-export-gateway-fallback: audit write failed");
        }
        notifyWarning(
          `Pine export: falling back to direct TradersPost path for strategy ${strategyId}`,
          appendFamilyGradePostscript(
            `LIVE_ORDER_GATEWAY_URL is not set — Pine alert will post DIRECTLY to TradersPost, bypassing the TF gateway. This skips the kill-switch, compliance gate, firm-cap clamp, and circuit breaker.`,
            "The Pine export is using the legacy direct path because LIVE_ORDER_GATEWAY_URL is missing.",
            "Set LIVE_ORDER_GATEWAY_URL in your production .env to enable the institutional Path B gateway.",
          ),
          { strategyId, reason: "LIVE_ORDER_GATEWAY_URL_unset", gatewayMode: "direct" },
        );
      }
    }

    const tmpPath = pathResolve(tmpdir(), `pine-config-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: CompilerOutput;
    try {
      // FIX 4: pass correlationId to subprocess wrapper
      result = await runPineCompiler(tmpPath, correlationId);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    const durationMs = Date.now() - startMs;

    // 5. Update export row — FIX 3: write contentHash, configSnapshot
    await db
      .update(strategyExports)
      .set({
        exportabilityScore: String(result.exportability.score),
        exportabilityDetails: result.exportability,
        status: "completed",
        pineVersion: result.pine_version,
        // FIX 3: persist content_hash so re-export drift is detectable
        contentHash: result.content_hash ?? null,
        // FIX 3: snapshot strategy config at export time
        configSnapshot: strategyConfig,
      })
      .where(eq(strategyExports.id, exportId));

    // 6. Insert artifacts — FIX 3: include contentHash per artifact
    const artifactRows = [];
    for (const artifact of result.artifacts) {
      const { createHash } = await import("crypto");
      const artifactHash = createHash("sha256").update(artifact.content).digest("hex");
      const [row] = await db
        .insert(strategyExportArtifacts)
        .values({
          exportId,
          artifactType: artifact.artifact_type,
          fileName: artifact.file_name,
          content: artifact.content,
          sizeBytes: artifact.size_bytes,
          pineVersion: result.pine_version,
          // FIX 3: per-artifact hash
          contentHash: artifactHash,
        })
        .returning();
      artifactRows.push(row);
    }

    // 7. Audit log — FIX 4: include durationMs, contentHash, correlationId
    await db.insert(auditLog).values({
      action: "pine-export.compile",
      entityType: "strategy_export",
      entityId: exportId,
      input: { strategyId, firmKey, exportType, correlationId },
      result: {
        exportabilityScore: result.exportability.score,
        band: result.exportability.band,
        contentHash: result.content_hash,
        artifactCount: result.artifacts.length,
        // FIX 4: track duration for performance monitoring
        durationMs,
        status: "success",
      },
      status: "success",
      decisionAuthority: "human",
    });

    // 8. Broadcast export completion SSE — pine:export-completed (hyphen, frontend discriminated union)
    broadcastSSE("pine:export-completed", {
      strategyId,
      exportId,
      contentHash: result.content_hash,
      exportabilityScore: result.exportability.score,
      durationMs,
    });

    // Broadcast SSE alert if exportability score is low
    if (result.exportability.score < 70) {
      broadcastSSE("alert:triggered", {
        type: "low_exportability",
        strategyId,
        score: result.exportability.score,
        message: `Pine export score ${result.exportability.score}/100 — strategy may not export cleanly`,
      });
    }

    return {
      id: exportId,
      strategyId,
      exportType,
      exportabilityScore: result.exportability.score,
      exportabilityBand: result.exportability.band,
      status: "completed",
      contentHash: result.content_hash,
      artifacts: artifactRows.map((r) => ({
        id: r.id,
        artifactType: r.artifactType,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
      })),
      exportability: result.exportability,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startMs;

    await db
      .update(strategyExports)
      .set({ status: "failed", errorMessage: errorMsg })
      .where(eq(strategyExports.id, exportId));

    // FIX 4: audit log on failure includes durationMs
    await db.insert(auditLog).values({
      action: "pine-export.compile",
      entityType: "strategy_export",
      entityId: exportId,
      input: { strategyId, firmKey, exportType, correlationId },
      result: { error: errorMsg, durationMs, status: "failure" },
      status: "failure",
      decisionAuthority: "human",
      errorMessage: errorMsg,
    });

    // SSE broadcast on failure
    broadcastSSE("pine:export-failed", {
      strategyId,
      errorCode: "compile_failed",
      message: errorMsg,
      durationMs,
    });

    return { id: exportId, status: "failed", error: errorMsg };
  }
}

export async function getExport(exportId: string) {
  const [exportRow] = await db
    .select()
    .from(strategyExports)
    .where(eq(strategyExports.id, exportId));
  return exportRow ?? null;
}

export async function getExportArtifacts(exportId: string) {
  return db
    .select()
    .from(strategyExportArtifacts)
    .where(eq(strategyExportArtifacts.exportId, exportId));
}

export async function getArtifact(artifactId: string) {
  const [artifact] = await db
    .select()
    .from(strategyExportArtifacts)
    .where(eq(strategyExportArtifacts.id, artifactId));
  return artifact ?? null;
}
