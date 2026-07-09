/**
 * fade-the-losers-service.ts — Wave B "Fade-the-Losers" (2026-07-03)
 *
 * Turns the graveyard's PROVEN DIRECTIONAL losers into fresh edge candidates.
 * If a directional strategy consistently lost money WITH statistical
 * significance, its inverse (short a persistent long-loser) may hold real edge.
 * We invert it (fade-inverter.ts) and create it as a NEW CANDIDATE through the
 * SAME UNCHANGED gate ladder every other strategy-creation site walks:
 *
 *   Gate 1 (auditBidirectionalCompleteness) -> Gate 2 (classifyFactorSources)
 *   -> framework overlay (applyFrameworkOverlay, AUTHORITATIVE) -> auditor
 *   (auditGraduatedConfig) -> DSL quality critic (runDslQualityCritic, fail-open)
 *   -> assertCrossValidatedSource guard -> playbook registration.
 *
 * NEVER a raw INSERT. NEVER a relaxed/exempt path. A fade survivor has passed
 * exactly what every other strategy passes — the full battery (backtest ->
 * CPCV/WFE/PBO/DSR/B14/BIF + slippage gate) downstream. Survivors = real edge.
 *
 * STATISTICAL HONESTY: fading DOUBLES the hypotheses tested (selection). Faded
 * strategies carry the SAME unchanged battery — no lighter path. The
 * source='fade_the_losers' tag is PROVENANCE-ONLY today: corpus-fdr-report.py
 * has no source filter, so a fade folds into the corpus-FDR multiple-testing
 * correction INCIDENTALLY via its backtest, exactly like any other strategy —
 * it is NOT counted as its own selection-family. Grouping fades as a distinct
 * testing-family in the FDR correction is a documented FUTURE enhancement; this
 * module does not claim tag-driven FDR that does not yet exist.
 *
 * CIRCULAR-IMPORT HAZARD (same class as spec-onboarding-service.ts): Gate 1/2
 * live in direct-bucket-graduator.ts and the DSL critic in agent-service.ts;
 * both transitively pull ../index.js (the full Express bootstrap) through their
 * import graphs, which TDZ-crashes any standalone CLI. So we import their
 * SHAPES with `import type` and defer the value import to a dynamic
 * `await import(...)` at call time (cached per-process). All leaf helpers
 * (framework-overlay, auditor, playbook-registration, audit-log-helper,
 * fade-inverter, logger) are safe static imports.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { strategies, strategyGraveyard } from "../db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { applyFrameworkOverlay, type StrategySource } from "./framework-overlay.js";
import { auditGraduatedConfig, formatAuditResult } from "./graduated-strategy-auditor.js";
import {
  registerStrategiesInPlaybook,
  deriveCategoryFromArchetype,
  type PlaybookCategory,
} from "../lib/playbook-registration.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { logger } from "../lib/logger.js";
import { invertStrategyConfig, FADE_SOURCE } from "../lib/fade-inverter.js";

// ─── Deferred value imports (sever static circular-import edges) ────────────
import type {
  auditBidirectionalCompleteness as AuditBidirectionalCompletenessFn,
  classifyFactorSources as ClassifyFactorSourcesFn,
} from "./direct-bucket-graduator.js";
import type { runDslQualityCritic as RunDslQualityCriticFn } from "./agent-service.js";

type GraduatorModule = typeof import("./direct-bucket-graduator.js");
let _graduatorModule: GraduatorModule | null = null;
async function getGraduatorModule(): Promise<GraduatorModule> {
  if (!_graduatorModule) _graduatorModule = await import("./direct-bucket-graduator.js");
  return _graduatorModule;
}

type AgentServiceModule = typeof import("./agent-service.js");
let _agentServiceModule: AgentServiceModule | null = null;
async function getAgentServiceModule(): Promise<AgentServiceModule> {
  if (!_agentServiceModule) _agentServiceModule = await import("./agent-service.js");
  return _agentServiceModule;
}

// ─── Single-entry-point guard — LOCAL MIRROR (deep-scan #11 mandate) ────────
// A mirror of agent-service.ts's exported assertCrossValidatedSource — same
// rationale as spec-onboarding-service.ts's local mirror (agent-service.ts is
// not safely dynamic-importable pre-INSERT; this unconditional security check
// must not fail-open on an import error).
//
// DIVERGENCE FROM THE CANONICAL MIRROR (deliberate, documented): `fade_the_losers`
// is added to the allowed-source set alongside {clone, b4_regen, evolved,
// graduated_bucket}. A fade is operator-initiated and derives from an existing
// strategy (conceptually like `evolved`), so it is an ALLOWED single-entry
// source in its own right. We do NOT stamp the fade with a false
// "cross-validated" tag (the fade cross-validated nothing) — the source itself
// is the authorization. If agent-service adds `fade_the_losers` to its own
// set, this mirror can drop the local branch.
type Dict = Record<string, unknown>;

function assertCrossValidatedSourceLocal(source: string, tags: string[]): void {
  const EXEMPT_SOURCES = new Set(["clone", "b4_regen", "evolved", "fade_the_losers"]);
  if (EXEMPT_SOURCES.has(source)) return;
  if (source === "graduated_bucket") return;
  if (tags.includes("cross-validated")) return;
  throw new Error(
    `strategy_insert_violation: only graduated_bucket source or cross-validated tag is allowed; got source=${source}`,
  );
}

// ─── Env-tunable cohort thresholds (design §Config) ─────────────────────────

const DEFAULT_MIN_TRADES = 30;
const DEFAULT_MAX_PROFIT_FACTOR = 1.0;
// Degenerate death reasons — NOT fadeable (no losing *edge* to invert):
// 0-trade / data-gap / NaN / compliance / look-ahead / curve-fit (PBO /
// Frankenstein / overfit) / consistency-block.
//
// "rejected_by_gate" is the CATCH-ALL production vocabulary: buryInGraveyard()
// (lifecycle-service.ts:2519) collapses EVERY hard-gate rejection into this
// single opaque death_reason. A gate rejection is a NON-performance failure
// (the strategy never earned a real losing-edge measurement) — so it is not
// fadeable. Included conservatively so a gate-rejected death is skipped, not
// silently faded. The genuine performance-loss vocabulary (unprofitable /
// low_sharpe / alpha_decay / negative_expectancy / underperformance) is
// deliberately NOT in this list and stays fadeable.
const DEFAULT_EXCLUDE_DEATH_REASONS = [
  "rejected_by_gate",
  "zero_trade",
  "zero-trade",
  "no_trade",
  "no_trades",
  "0_trade",
  "0-trade",
  "nan",
  "not_a_number",
  "data_gap",
  "data-gap",
  "missing_data",
  "data_missing",
  "insufficient_data",
  "compliance",
  "look_ahead",
  "look-ahead",
  "lookahead",
  "future_leak",
  "curve_fit",
  "curve-fit",
  "curvefit",
  "overfit",
  "pbo",
  "frankenstein",
  "consistency",
];

interface CohortThresholds {
  minTrades: number;
  maxProfitFactor: number;
  excludeKeywords: string[];
}

function resolveThresholds(overrides?: { minTrades?: number }): CohortThresholds {
  const envMin = Number(process.env.FADE_MIN_TRADES);
  const envPf = Number(process.env.FADE_MAX_PROFIT_FACTOR);
  const envExclude = process.env.FADE_EXCLUDE_DEATH_REASONS;
  return {
    minTrades:
      // Override must be a positive finite number — a 0/negative --min-trades
      // is guarded the SAME way as the env path (both fall back to the default).
      overrides?.minTrades != null && Number.isFinite(overrides.minTrades) && overrides.minTrades > 0
        ? overrides.minTrades
        : Number.isFinite(envMin) && envMin > 0
          ? envMin
          : DEFAULT_MIN_TRADES,
    maxProfitFactor: Number.isFinite(envPf) && envPf > 0 ? envPf : DEFAULT_MAX_PROFIT_FACTOR,
    excludeKeywords:
      typeof envExclude === "string" && envExclude.trim().length > 0
        ? envExclude
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        : DEFAULT_EXCLUDE_DEATH_REASONS,
  };
}

// ─── Metric extraction (searchableMetrics / backtestSummary) ────────────────

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickNum(sources: Array<Dict | null | undefined>, keys: string[]): number | null {
  for (const src of sources) {
    if (!src) continue;
    for (const k of keys) {
      if (k in src) {
        const n = toNum(src[k]);
        if (n != null) return n;
      }
    }
  }
  return null;
}

export interface CohortMetrics {
  nTrades: number | null;
  expectancy: number | null;
  profitFactor: number | null;
}

export function extractCohortMetrics(
  searchableMetrics: unknown,
  backtestSummary: unknown,
): CohortMetrics {
  const sm = (searchableMetrics as Dict | null) ?? null;
  const bs = (backtestSummary as Dict | null) ?? null;
  const srcs = [sm, bs];
  return {
    nTrades: pickNum(srcs, ["n_trades", "num_trades", "total_trades", "totalTrades", "trades", "trade_count"]),
    expectancy: pickNum(srcs, [
      "expectancy",
      "expectancy_r",
      "avg_r",
      "avg_trade_r",
      "avg_trade_pnl",
      "avgTradePnl",
      "avg_pnl",
    ]),
    profitFactor: pickNum(srcs, ["profit_factor", "profitFactor", "pf"]),
  };
}

function isSignificantLoser(m: CohortMetrics, t: CohortThresholds): boolean {
  if (m.nTrades == null || m.nTrades < t.minTrades) return false;
  const negExpectancy = m.expectancy != null && m.expectancy < 0;
  const losingPf = m.profitFactor != null && m.profitFactor < t.maxProfitFactor;
  return negExpectancy || losingPf;
}

function isDegenerateDeath(
  deathReason: string | null,
  failureCategory: string | null,
  failureModes: string[] | null,
  excludeKeywords: string[],
): boolean {
  const haystack = [
    deathReason ?? "",
    failureCategory ?? "",
    ...(Array.isArray(failureModes) ? failureModes : []),
  ]
    .join(" | ")
    .toLowerCase();
  return excludeKeywords.some((kw) => kw.length > 0 && haystack.includes(kw));
}

// ─── Directionality classification (design §Cohort filter 1) ────────────────

const BIDIR_SENTINEL = "high < low";

function isDisabled(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return s.length === 0 || s === BIDIR_SENTINEL;
}

/** Returns "long" | "short" for a clean directional config, else null. */
export function classifyDirectionality(config: Dict): "long" | "short" | null {
  const dirRaw =
    (typeof config.direction === "string" && config.direction) ||
    (typeof (config.strategy as Dict | undefined)?.direction === "string" &&
      ((config.strategy as Dict).direction as string)) ||
    "";
  const dir = dirRaw.toLowerCase();
  if (dir === "both" || (dir !== "long" && dir !== "short")) return null;
  const strat = config.strategy as Dict | undefined;
  const longVal = (strat?.entry_long ?? config.entry_long) as unknown;
  const shortVal = (strat?.entry_short ?? config.entry_short) as unknown;
  const longDisabled = isDisabled(longVal);
  const shortDisabled = isDisabled(shortVal);
  if (longDisabled === shortDisabled) return null; // both/neither sentinel — not clean directional
  // The ACTIVE (non-sentinel) side must AGREE with the declared direction. A
  // `direction:"long"` config whose only active side is entry_short is
  // contradictory — not a clean directional loser, refuse it.
  const activeSide: "long" | "short" = longDisabled ? "short" : "long";
  if (activeSide !== dir) return null;
  return dir as "long" | "short";
}

// ─── Cohort selection ───────────────────────────────────────────────────────

export type SkipReason =
  | "not_directional"
  | "insufficient_trades"
  | "degenerate_death"
  | "already_faded";

export interface CohortMember {
  graveyardId: string;
  strategyId: string | null;
  /** `strategyId ?? graveyardId` — the origin key stamped as config.faded_from (dedupe). */
  dedupeKey: string;
  originalName: string;
  config: Dict;
  symbol: SymbolCode;
  timeframe: string;
  direction: "long" | "short";
  metrics: CohortMetrics;
}

export interface CohortSkip {
  graveyardId: string;
  strategyId: string | null;
  name: string;
  reason: SkipReason;
}

export interface CohortSelection {
  fadeable: CohortMember[];
  skipped: CohortSkip[];
  scanned: number;
}

export type SymbolCode = "MES" | "MNQ" | "MCL";

function resolveSymbol(rowSymbol: string | null, config: Dict): SymbolCode {
  const strat = config.strategy as Dict | undefined;
  const raw = String(rowSymbol ?? strat?.symbol ?? config.symbol ?? "MES").toUpperCase();
  if (raw === "MES" || raw === "MNQ" || raw === "MCL") return raw;
  return "MES";
}

/**
 * Derives the row-level `preferred_regime` scalar + `preferred_regimes` array
 * columns from the PRESERVED config regime (the inverter does NOT flip regime —
 * the fade fires on the same regime bar set as the loser). The scalar's regime
 * is always contained in the array, so the column, config field, and array
 * never desync. Mirrors direct-bucket-graduator.ts:2768-2798 column-write intent
 * but PRESERVES rather than re-derives, so a RANGE_BOUND original stays
 * RANGE_BOUND everywhere.
 */
function preservedRegime(config: Dict): { scalar: string | null; array: string[] | null } {
  const rg = config.regime_gate as Dict | undefined;
  const scalarRaw =
    (typeof rg?.preferred_regime === "string" && rg.preferred_regime) ||
    (typeof config.preferred_regime === "string" && (config.preferred_regime as string)) ||
    "";
  const scalar = scalarRaw.length > 0 ? scalarRaw : null;
  const arrRaw = config.preferred_regimes;
  const array =
    Array.isArray(arrRaw) && arrRaw.length > 0
      ? (arrRaw as string[])
      : scalar
        ? [scalar]
        : null;
  return { scalar, array };
}

/**
 * Selects the fadeable cohort from `strategy_graveyard` joined to `strategies`.
 * Pure read (no writes). Classifies each graveyard row as fadeable or skipped
 * with a discriminated reason.
 */
export async function selectFadeCohort(opts: {
  minTrades?: number;
  scanLimit?: number;
}): Promise<CohortSelection> {
  const t = resolveThresholds({ minTrades: opts.minTrades });
  const scanLimit = opts.scanLimit && opts.scanLimit > 0 ? opts.scanLimit : 1000;

  const rows = await db
    .select({
      graveyardId: strategyGraveyard.id,
      strategyId: strategyGraveyard.strategyId,
      graveyardName: strategyGraveyard.name,
      dslSnapshot: strategyGraveyard.dslSnapshot,
      backtestSummary: strategyGraveyard.backtestSummary,
      searchableMetrics: strategyGraveyard.searchableMetrics,
      deathReason: strategyGraveyard.deathReason,
      failureCategory: strategyGraveyard.failureCategory,
      failureModes: strategyGraveyard.failureModes,
      deathDate: strategyGraveyard.deathDate,
      stratConfig: strategies.config,
      stratSource: strategies.source,
      stratSymbol: strategies.symbol,
      stratTimeframe: strategies.timeframe,
      stratName: strategies.name,
    })
    .from(strategyGraveyard)
    .leftJoin(strategies, eq(strategyGraveyard.strategyId, strategies.id))
    .orderBy(desc(strategyGraveyard.deathDate))
    .limit(scanLimit);

  // Dedupe: every origin id that already has a fade in `strategies`.
  const fadeRows = await db
    .select({ config: strategies.config })
    .from(strategies)
    .where(eq(strategies.source, FADE_SOURCE));
  const alreadyFadedOrigins = new Set<string>();
  for (const fr of fadeRows) {
    const ff = (fr.config as Dict | null)?.faded_from;
    if (typeof ff === "string" && ff.length > 0) alreadyFadedOrigins.add(ff);
  }

  const fadeable: CohortMember[] = [];
  const skipped: CohortSkip[] = [];

  for (const row of rows) {
    const config = ((row.stratConfig ?? row.dslSnapshot) as Dict | null) ?? {};
    const name = row.stratName ?? row.graveyardName ?? "unknown";

    // 1) Directional (one entry side is the sentinel; not `both`).
    const direction = classifyDirectionality(config);
    if (direction == null) {
      skipped.push({ graveyardId: row.graveyardId, strategyId: row.strategyId, name, reason: "not_directional" });
      continue;
    }

    // 2) Statistically-significant loser.
    const metrics = extractCohortMetrics(row.searchableMetrics, row.backtestSummary);
    if (!isSignificantLoser(metrics, t)) {
      skipped.push({ graveyardId: row.graveyardId, strategyId: row.strategyId, name, reason: "insufficient_trades" });
      continue;
    }

    // 3) Performance-failure death only (skip degenerate deaths).
    if (isDegenerateDeath(row.deathReason, row.failureCategory, row.failureModes, t.excludeKeywords)) {
      skipped.push({ graveyardId: row.graveyardId, strategyId: row.strategyId, name, reason: "degenerate_death" });
      continue;
    }

    // 4) Not already faded (self-fade OR existing fade of same origin — no fade-of-fade).
    // The dedupe key is `strategyId ?? graveyardId` — the SAME key the fade's
    // config.faded_from is stamped with (see createFadedCandidate). This closes
    // the deleted-original hole: when strategy_graveyard.strategy_id was nulled
    // by ON DELETE SET NULL, faded_from carries the graveyardId, and this check
    // still catches an existing fade across re-runs.
    const dedupeKey = row.strategyId ?? row.graveyardId;
    const selfIsFade = row.stratSource === FADE_SOURCE || config.faded_from != null;
    const originFaded = alreadyFadedOrigins.has(dedupeKey);
    if (selfIsFade || originFaded) {
      skipped.push({ graveyardId: row.graveyardId, strategyId: row.strategyId, name, reason: "already_faded" });
      continue;
    }

    fadeable.push({
      graveyardId: row.graveyardId,
      strategyId: row.strategyId,
      dedupeKey,
      originalName: name,
      config,
      symbol: resolveSymbol(row.stratSymbol, config),
      timeframe: row.stratTimeframe ?? String((config.strategy as Dict | undefined)?.timeframe ?? "5m"),
      direction,
      metrics,
    });
  }

  return { fadeable, skipped, scanned: rows.length };
}

// ─── Create-through-gate-ladder ─────────────────────────────────────────────

export type CreateStatus =
  | "created"
  | "dry_run_planned"
  | "rejected_gate1"
  | "rejected_auditor"
  | "rejected_dsl_critic"
  | "registration_failed"
  | "skipped_invert"
  | "skipped_duplicate";

export interface FadeCreateResult {
  originalId: string | null;
  originalName: string;
  fadeName: string;
  symbol: SymbolCode;
  status: CreateStatus;
  strategyId?: string;
  reason?: string;
}

export interface RunFadeOptions {
  dryRun: boolean;
  minTrades?: number;
  /** Max number of fadeable candidates to actually create (undefined = all). */
  limit?: number;
  scanLimit?: number;
  /** Absolute path to playbook_router.py. */
  playbookRouterPath: string;
  /** Skip the LLM DSL critic (default true for batch/CLI — critic is fail-open anyway). */
  skipDslCritic?: boolean;
}

export interface RunFadeResult {
  dryRun: boolean;
  scanned: number;
  cohortSize: number;
  skipped: CohortSkip[];
  created: FadeCreateResult[];
}

async function writeSkipAudits(skips: CohortSkip[], correlationId: string): Promise<void> {
  for (const s of skips) {
    await insertAuditRowSafe({
      id: randomUUID(),
      action: `fade.skipped_${s.reason}`,
      entityType: "strategy",
      entityId: s.strategyId ?? null,
      status: "success",
      decisionAuthority: "agent",
      correlationId,
      input: { graveyard_id: s.graveyardId, name: s.name },
      result: { reason: s.reason },
    });
  }
}

/**
 * Creates a single faded CANDIDATE through the full gate ladder. Returns a
 * discriminated per-strategy result. Never a raw INSERT, never a relaxed gate.
 */
async function createFadedCandidate(
  member: CohortMember,
  opts: RunFadeOptions,
  correlationId: string,
): Promise<FadeCreateResult> {
  const base: Omit<FadeCreateResult, "status"> = {
    originalId: member.strategyId,
    originalName: member.originalName,
    fadeName: "",
    symbol: member.symbol,
  };

  // ── Invert (pure) ─────────────────────────────────────────────────────────
  // faded_from is stamped with the dedupe key (strategyId ?? graveyardId) so the
  // provenance stamp matches the selector's dedupe check across re-runs even when
  // the original strategy row was deleted (strategy_id nulled).
  const inv = invertStrategyConfig({
    config: member.config,
    originalId: member.dedupeKey,
    originalName: member.originalName,
  });
  if (!inv.ok) {
    logger.warn({ originalId: member.strategyId, reason: inv.reason }, "fade.skipped_invert");
    return { ...base, status: "skipped_invert", reason: inv.reason };
  }
  base.fadeName = inv.name;

  const invertedConfig = inv.config;
  const entryIndicatorRaw = String(invertedConfig.entry_indicator ?? "");
  const archetypeKey = entryIndicatorRaw.startsWith("archetype:")
    ? entryIndicatorRaw.slice("archetype:".length)
    : null;
  const strat = invertedConfig.strategy as Dict | undefined;
  const entryLong = String((strat?.entry_long ?? invertedConfig.entry_long) ?? "");
  const entryShort = String((strat?.entry_short ?? invertedConfig.entry_short) ?? "");

  // ── Gate 1: Bidirectional completeness (unchanged helper) ─────────────────
  const { auditBidirectionalCompleteness } = await getGraduatorModule();
  const gate1 = auditBidirectionalCompleteness({
    direction: inv.invertedDirection,
    archetype: archetypeKey,
    entry_long: entryLong,
    entry_short: entryShort,
  });
  if (!gate1.pass) {
    return { ...base, status: "rejected_gate1", reason: gate1.reason ?? "gate1_failed" };
  }

  // ── Framework overlay (AUTHORITATIVE, idempotent re-assert) ───────────────
  const exitStyle =
    ((invertedConfig.exit_plan_config as Dict | undefined)?.exit_style as string | undefined) ===
    "adaptive"
      ? "adaptive"
      : "static_styleC";
  type OverlayInputShape = Parameters<typeof applyFrameworkOverlay>[0];
  const overlayed = applyFrameworkOverlay({
    compiled: invertedConfig as unknown as OverlayInputShape["compiled"],
    source: FADE_SOURCE as unknown as StrategySource,
    symbol: member.symbol,
    exitStyle,
  });

  // ── Gate 2: Factor-source classification (confluence preserved untouched) ─
  const origEntryQuality = (invertedConfig.entry_quality as Dict | undefined) ?? {};
  const confluenceFactors = Array.isArray(origEntryQuality.confluence_factors)
    ? (origEntryQuality.confluence_factors as string[])
    : [];
  const { classifyFactorSources } = await getGraduatorModule();
  const { factor_sources, factor_quality, mergedFactors } = classifyFactorSources(
    confluenceFactors,
    confluenceFactors,
    entryIndicatorRaw || null,
  );

  const finalConfig: Dict = {
    ...(overlayed.config as unknown as Dict),
    entry_quality: {
      ...origEntryQuality,
      confluence_factors: mergedFactors,
      factor_sources,
      factor_quality,
    },
    // Re-stamp provenance (overlay preserves unknown keys, but be explicit).
    faded_from: inv.fadedFrom,
    source: FADE_SOURCE,
  };

  // ── Auditor (schema invariants — unchanged helper) ────────────────────────
  const auditResult = auditGraduatedConfig({
    conceptName: inv.name,
    symbol: member.symbol,
    config: finalConfig,
  });
  if (!auditResult.passed) {
    return { ...base, status: "rejected_auditor", reason: formatAuditResult(auditResult) };
  }

  // ── DSL quality critic (fail-open on any infra error, per documented design) ─
  let criticAccepted = true;
  if (opts.skipDslCritic !== true) {
    try {
      const { runDslQualityCritic } = await getAgentServiceModule();
      const critic = await runDslQualityCritic(
        {
          dsl: finalConfig,
          sourceFind: { title: inv.name, source: `fade:${inv.fadedFrom}`, description: inv.name },
        },
        `fade:${inv.fadedFrom}:${member.symbol}`,
      );
      criticAccepted = critic ? critic.accept !== false : true;
    } catch (err) {
      logger.warn({ originalId: member.strategyId, err: String(err) }, "fade.dsl_critic_fail_open");
      criticAccepted = true;
    }
  }
  if (!criticAccepted) {
    return { ...base, status: "rejected_dsl_critic", reason: "dsl_quality_critic_rejected" };
  }

  // Regime is PRESERVED (not flipped) — derive both the scalar column and the
  // array column from the same preserved config regime so config/column/array
  // never desync. bias-state-service.ts matches on the array OR the scalar.
  const regime = preservedRegime(finalConfig);
  // No "cross-validated" tag: the fade cross-validated nothing (that would be a
  // semantically false canary). `fade_the_losers` source is itself the allowed
  // single-entry authorization (see assertCrossValidatedSourceLocal).
  const tags = [
    FADE_SOURCE,
    `faded_from:${inv.fadedFrom}`,
    ...(archetypeKey ? [`archetype:${archetypeKey}`] : []),
  ];

  // ── Single-entry-point guard (deep-scan #11 mandate) ──────────────────────
  assertCrossValidatedSourceLocal(FADE_SOURCE, tags);

  if (opts.dryRun) {
    return { ...base, status: "dry_run_planned" };
  }

  const category: PlaybookCategory = deriveCategoryFromArchetype(archetypeKey);
  const newId = randomUUID();

  const [inserted] = await db
    .insert(strategies)
    .values({
      id: newId,
      name: inv.name,
      description: `Fade-the-losers inversion of "${member.originalName}" (${inv.originalDirection}->${inv.invertedDirection})`,
      symbol: member.symbol,
      symbols: [member.symbol],
      timeframe: member.timeframe,
      config: finalConfig,
      lifecycleState: "CANDIDATE",
      preferredRegime: regime.scalar,
      preferredRegimes: regime.array,
      source: FADE_SOURCE,
      tags,
    })
    .returning({ id: strategies.id });

  // ── Playbook registration — part of the create transaction ────────────────
  const regResult = registerStrategiesInPlaybook(opts.playbookRouterPath, [inv.name], category);
  if (!regResult.ok) {
    // Never leave a DB-registered-but-playbook-invisible row (confluence-overlay bypass).
    await db.delete(strategies).where(eq(strategies.id, inserted.id));
    return { ...base, status: "registration_failed", reason: regResult.reason };
  }

  await insertAuditRowSafe({
    id: randomUUID(),
    action: "fade.candidate_created",
    entityType: "strategy",
    entityId: inserted.id,
    status: "success",
    decisionAuthority: "agent",
    correlationId,
    input: {
      faded_from: inv.fadedFrom,
      original_name: member.originalName,
      graveyard_id: member.graveyardId,
      original_direction: inv.originalDirection,
      inverted_direction: inv.invertedDirection,
      symbol: member.symbol,
      n_trades: member.metrics.nTrades,
      expectancy: member.metrics.expectancy,
      profit_factor: member.metrics.profitFactor,
    },
    result: {
      strategy_id: inserted.id,
      fade_name: inv.name,
      lifecycle_state: "CANDIDATE",
      playbook_category: category,
      factor_quality,
    },
  });

  logger.info(
    { fadeId: inserted.id, fadedFrom: inv.fadedFrom, name: inv.name },
    "fade.candidate_created",
  );

  return { ...base, status: "created", strategyId: inserted.id };
}

/**
 * Top-level orchestration: select cohort -> invert each fadeable -> create as a
 * CANDIDATE through the full gate ladder. Dry-run (default) reports the cohort +
 * planned inversions and performs NO writes (no INSERTs, no audit rows).
 */
export async function runFadeTheLosers(opts: RunFadeOptions): Promise<RunFadeResult> {
  // One correlationId per run threads through every fade audit row (skip +
  // created) so a whole apply pass is reconstructable end-to-end.
  const correlationId = `fade:${randomUUID()}`;

  const selection = await selectFadeCohort({ minTrades: opts.minTrades, scanLimit: opts.scanLimit });

  const toCreate =
    opts.limit != null && opts.limit >= 0
      ? selection.fadeable.slice(0, opts.limit)
      : selection.fadeable;

  // Per-run dedupe: `alreadyFadedOrigins` in the selector was snapshotted BEFORE
  // this loop's INSERTs. Two graveyard rows for the SAME origin in one --apply
  // pass would both pass the selector — this set catches the 2nd (and beyond).
  const createdOrigins = new Set<string>();
  const created: FadeCreateResult[] = [];
  for (const member of toCreate) {
    if (createdOrigins.has(member.dedupeKey)) {
      created.push({
        originalId: member.strategyId,
        originalName: member.originalName,
        fadeName: "",
        symbol: member.symbol,
        status: "skipped_duplicate",
        reason: "origin_already_faded_this_run",
      });
      continue;
    }
    const result = await createFadedCandidate(member, opts, correlationId);
    created.push(result);
    // Reserve the origin once the fade is created (or planned, so the dry-run
    // plan is honest about the duplicate it would otherwise create).
    if (result.status === "created" || result.status === "dry_run_planned") {
      createdOrigins.add(member.dedupeKey);
    }
  }

  // Audit skips only in apply mode (dry-run performs no writes).
  if (!opts.dryRun) {
    await writeSkipAudits(selection.skipped, correlationId);
  }

  return {
    dryRun: opts.dryRun,
    scanned: selection.scanned,
    cohortSize: selection.fadeable.length,
    skipped: selection.skipped,
    created,
  };
}
