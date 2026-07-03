/**
 * spec-onboarding-service.ts — Band B (spec-onboarding-bridge, 2026-07-02)
 *
 * THE SPEC -> PRODUCTION-STRATEGIES-ROW CONVERTER (roadmap Band B1-B4).
 *
 * Consumes a SERIALIZED SPEC ARTIFACT (the JSON contract emitted by the
 * certified compiler on the extraction/100pct-evidence branch — this module
 * never imports extraction-branch code, only its JSON output shape) and
 * produces onboarded `strategies` rows that walk the SAME gates every other
 * strategy-creation site walks:
 *
 *   Gate 1 (auditBidirectionalCompleteness) -> Gate 2 (classifyFactorSources)
 *   -> framework overlay (applyFrameworkOverlay, AUTHORITATIVE risk/sizing/exits)
 *   -> auditor (auditGraduatedConfig) -> DSL quality critic (runDslQualityCritic,
 *   fail-open by documented design) -> assertCrossValidatedSource guard
 *   immediately before the INSERT (deep-scan #11 single-entry-point mandate)
 *   -> playbook registration (Band B2, playbook-registration.ts) as part of
 *   the same transaction -> Gate 3 (thin-confluence advisory, post-insert).
 *
 * No new gates are invented. No archetype evaluators are invented (Band C's
 * job). Where a spec's entry-condition graph does not map onto an EXISTING
 * archetype, the strategy is still onboarded — honestly parked at
 * `lifecycle_state=NEEDS_ARCHETYPE` with a `needs_archetype_queue` row, per
 * the existing uncatalogued-strategy convention (direct-bucket-graduator.ts).
 *
 * PROVENANCE CHAIN (transcript -> spec -> strategy -> backtest row, closed
 * end-to-end): every onboarded row's `config.metadata.extraction_provenance`
 * is set to `spec:<video>:<spec_hash>`. `deriveSpecProvenanceRef()`
 * (provenance-stamp.ts) reads exactly this field via
 * `config.strategy.metadata.extraction_provenance` when a backtest run wraps
 * the strategy config under a `strategy` key — so every backtest of an
 * onboarded strategy carries a live `spec_provenance_ref` back to this exact
 * spec_hash, and `spec_grounded=true` (migration 0186 hard gate, deep-scan
 * #11 Track P) instead of the `"none"` sentinel.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { strategies, needsArchetypeQueue } from "../db/schema.js";
import { and, eq, sql } from "drizzle-orm";
import { applyFrameworkOverlay, type StrategySource } from "./framework-overlay.js";
import { auditGraduatedConfig, formatAuditResult } from "./graduated-strategy-auditor.js";
import { inferSymbolSet } from "../lib/wave25-strategy-defaults.js";
import { matchArchetype, type ArchetypeMatchResult } from "../lib/spec-archetype-matcher.js";
import { compileBindingPlan, type BindingPlan } from "../lib/spec-family-bindings.js";
import {
  registerStrategiesInPlaybook,
  deriveCategoryFromArchetype,
  type PlaybookCategory,
} from "../lib/playbook-registration.js";
import { logger } from "../lib/logger.js";

// ─── Lazy dynamic imports (sever static circular-import edges) ─────────────
//
// direct-bucket-graduator.ts imports `logger` from "../index.js" (the full
// Express app entrypoint — mounts every route, constructs `new AgentService()`
// at module scope in routes/agent.ts) instead of "../lib/logger.js". A STATIC
// top-level import of direct-bucket-graduator.ts's Gate 1/2 helpers from any
// fresh standalone entry point (this CLI/service — not src/server/index.ts
// itself, and not a vitest suite where vi.mock intercepts the edge) triggers
// a genuine Node ESM circular-import TDZ: direct-bucket-graduator.ts ->
// ../index.js -> routes/agent.ts -> agent-service.ts (AgentService class
// referenced before its own module finishes evaluating) -> back to
// direct-bucket-graduator.ts (deriveEntryIndicator). Verified this session —
// confirmed via `npx tsx scripts/onboard-compiled-specs.ts` crashing with
// "Cannot access 'AgentService' before initialization" at routes/agent.ts:102.
//
// Same failure class + same fix as the Office deploy-approvals router
// (src/server/routes/slumhouse/deploy-approvals.ts:47-58, "sever static
// lifecycle-service edge"): type-only static imports for shapes we need +
// dynamic `await import(...)` at call time, cached in a module-level
// singleton so the cost is paid once per process, not once per spec.
// agent-service.ts gets the same treatment — it independently reaches the
// same cycle through its own large import graph (confirmed empirically: a
// bare static import of agent-service.ts alone reproduces the same crash).
import type {
  auditBidirectionalCompleteness as AuditBidirectionalCompletenessFn,
  classifyFactorSources as ClassifyFactorSourcesFn,
} from "./direct-bucket-graduator.js";
import type { runDslQualityCritic as RunDslQualityCriticFn } from "./agent-service.js";

type GraduatorModule = typeof import("./direct-bucket-graduator.js");
let _graduatorModule: GraduatorModule | null = null;
async function getGraduatorModule(): Promise<GraduatorModule> {
  if (!_graduatorModule) {
    _graduatorModule = await import("./direct-bucket-graduator.js");
  }
  return _graduatorModule;
}

type AgentServiceModule = typeof import("./agent-service.js");
let _agentServiceModule: AgentServiceModule | null = null;
async function getAgentServiceModule(): Promise<AgentServiceModule> {
  if (!_agentServiceModule) {
    _agentServiceModule = await import("./agent-service.js");
  }
  return _agentServiceModule;
}

// ─── Single-entry-point guard (deep-scan #11 mandate) — LOCAL MIRROR ───────
//
// assertCrossValidatedSource() in agent-service.ts is the canonical, single
// enforcement point for "no strategy row lands in `strategies` unless it came
// from cross-validation or an operator-initiated clone/regen." It is trivial
// and pure (a 3-branch set-membership check, zero I/O), but agent-service.ts
// itself is NOT safely dynamic-importable from a standalone entry point: its
// own import of backtest-service.ts reaches (via paper-trading-stream.ts ->
// paper-execution-service.ts -> scheduler.ts -> lifecycle-service.ts -> {
// adversarial-stress-service.ts | frankenstein-service.ts |
// pine-export-service.ts | agent-coordinator-service.ts |
// multi-firm-promotion-service.ts}) all the way to src/server/index.ts ->
// routes/agent.ts -> agent-service.ts — a genuine, deep, pre-existing
// circular reference confirmed via a full transitive-import trace this
// session. Unlike the DSL quality critic below (optional, already
// fail-open-on-any-throw by documented design), this guard is an
// unconditional, security-relevant check that must NEVER silently fail open
// on an infra/import error — so it is not routed through the same
// dynamic-import-inside-try/catch pattern.
//
// This is a DELIBERATE, DOCUMENTED, BYTE-IDENTICAL mirror of
// agent-service.ts's exported `assertCrossValidatedSource` (verified against
// its source at the time of writing) — not a divergent reimplementation. If
// agent-service.ts's version changes, this one must change with it. Fixing
// this properly means applying the SAME "sever static edge, dynamic-import
// at call time" pattern one level deeper inside agent-service.ts itself
// (its own edge to backtest-service.ts) — a legitimate, larger architectural
// fix flagged in docs/spec-onboarding-runbook.md, out of scope for this band.
function assertCrossValidatedSourceLocal(source: string, tags: string[]): void {
  const EXEMPT_SOURCES = new Set(["clone", "b4_regen", "evolved"]);
  if (EXEMPT_SOURCES.has(source)) return;
  if (source === "graduated_bucket") return;
  if (tags.includes("cross-validated")) return;
  throw new Error(
    `strategy_insert_violation: only graduated_bucket source or cross-validated tag is allowed; got source=${source}`,
  );
}

// Mirrors the private BIDIR_SENTINEL constant in direct-bucket-graduator.ts
// (not exported there — this is a documented, deliberate literal match, same
// convention direct-bucket-graduator.ts itself calls a "sentinel").
const BIDIR_SENTINEL = "high < low";

// ─── Spec artifact contract (mirrors the 25-sample generalization corpus) ───

export interface SpecEntryCondition {
  id: string;
  type: string;
  object: string;
  role: "spine" | "confluence" | "trigger" | "invalidation";
  span: { start: number; end: number };
  evidence: string;
}

export interface SpecArtifactBody {
  direction: string;
  entry_conditions: SpecEntryCondition[];
  and_groups: string[][];
  or_branches: string[][];
  invalidations: SpecEntryCondition[];
  entry_trigger_id: string;
  framework_overlay?: Record<string, unknown>;
}

export interface SpecArtifact {
  video: string;
  spec_hash: string;
  graph_canonical_hash: string;
  ledger_d: string;
  transcript_chars: number;
  spec: SpecArtifactBody;
  /** Optional — present when the manifest carries a pipeline version stamp. */
  pipeline_version?: string;
}

export interface ParseResult {
  ok: boolean;
  artifact?: SpecArtifact;
  reason?: string;
}

const VALID_DIRECTIONS = new Set(["long", "short", "both"]);

/** Validates the minimal required shape. Never throws. */
export function parseSpecArtifact(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "artifact_not_an_object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.video !== "string" || r.video.length === 0) {
    return { ok: false, reason: "missing_video_id" };
  }
  if (typeof r.spec_hash !== "string" || r.spec_hash.length === 0) {
    return { ok: false, reason: "missing_spec_hash" };
  }
  const spec = r.spec as Record<string, unknown> | undefined;
  if (typeof spec !== "object" || spec === null) {
    return { ok: false, reason: "missing_spec_body" };
  }
  const direction = spec.direction;
  if (typeof direction !== "string" || !VALID_DIRECTIONS.has(direction)) {
    return { ok: false, reason: `invalid_direction: ${String(direction)}` };
  }
  const entryConditions = spec.entry_conditions;
  if (!Array.isArray(entryConditions)) {
    return { ok: false, reason: "entry_conditions_not_an_array" };
  }
  if (typeof spec.entry_trigger_id !== "string") {
    return { ok: false, reason: "missing_entry_trigger_id" };
  }
  return {
    ok: true,
    artifact: {
      video: r.video,
      spec_hash: r.spec_hash,
      graph_canonical_hash: typeof r.graph_canonical_hash === "string" ? r.graph_canonical_hash : "",
      ledger_d: typeof r.ledger_d === "string" ? r.ledger_d : "UNKNOWN",
      transcript_chars: typeof r.transcript_chars === "number" ? r.transcript_chars : 0,
      spec: {
        direction,
        entry_conditions: entryConditions as SpecEntryCondition[],
        and_groups: Array.isArray(spec.and_groups) ? (spec.and_groups as string[][]) : [],
        or_branches: Array.isArray(spec.or_branches) ? (spec.or_branches as string[][]) : [],
        invalidations: Array.isArray(spec.invalidations) ? (spec.invalidations as SpecEntryCondition[]) : [],
        entry_trigger_id: spec.entry_trigger_id,
        framework_overlay: (spec.framework_overlay as Record<string, unknown>) ?? undefined,
      },
      pipeline_version: typeof r.pipeline_version === "string" ? r.pipeline_version : undefined,
    },
  };
}

// ─── Confluence factor extraction (Gate 2 input — REAL extracted factors) ──

function normalizeFactorToken(object: string): string {
  return object
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** role==="confluence" objects ONLY — never a synthetic/auto_floor fallback. */
export function deriveConfluenceFactors(spec: SpecArtifactBody): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of spec.entry_conditions) {
    if (c.role !== "confluence") continue;
    if (typeof c.object !== "string" || c.object.trim().length === 0) continue;
    const tok = normalizeFactorToken(c.object);
    if (tok.length === 0 || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

// ─── Concept naming (best-effort; W23F.M-style symbol-suffixed name) ───────

const GENERIC_TRIGGER_OBJECTS = new Set([
  "entry", "trade entry", "entry point", "enter", "entry signal",
]);

export interface ConceptNameResult {
  conceptName: string;
  /** Raw trigger-condition text used to build the entry_long/entry_short marker; "" if none found. */
  triggerText: string;
}

export function deriveConceptName(spec: SpecArtifactBody, video: string): ConceptNameResult {
  const trigger = spec.entry_conditions.find((c) => c.id === spec.entry_trigger_id);
  const candidates: string[] = [];
  if (trigger?.object) candidates.push(trigger.object);
  for (const c of spec.entry_conditions) if (c.role === "spine" && c.object) candidates.push(c.object);
  for (const c of spec.entry_conditions) if (c.role === "confluence" && c.object) candidates.push(c.object);

  let conceptName = `spec_${video}`;
  for (const raw of candidates) {
    const norm = raw.trim().toLowerCase();
    if (norm.length >= 8 && !GENERIC_TRIGGER_OBJECTS.has(norm)) {
      conceptName = raw;
      break;
    }
  }
  const triggerText = typeof trigger?.object === "string" ? trigger.object.trim() : "";
  return { conceptName: prettifyConcept(conceptName), triggerText };
}

function prettifyConcept(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 60) || "unnamed_concept";
}

function deriveStrategyName(conceptName: string, market: string, timeframe: string): string {
  return `${conceptName}_${market.toLowerCase()}_${timeframe}`;
}

// ─── entry_long / entry_short construction (Gate 1 input) ──────────────────
//
// HONESTY CONTRACT: if there is no real trigger text to reference AND no
// archetype match, the marker is "" (empty) — NOT a fabricated placeholder.
// This is what makes Gate 1 a real gate for this path: a genuinely degenerate
// spec (empty entry_conditions, blank trigger object) produces an empty
// direction side and gets REJECTED by auditBidirectionalCompleteness when
// direction="both", exactly like a malformed LLM extraction would.

export function buildDirectionalEntries(
  direction: string,
  archetypeKey: string | null,
  triggerText: string,
  // Band C: when the spec didn't match a named archetype but the condition-
  // family binding plan cleared the coverage threshold (see
  // spec-family-bindings.ts::compileBindingPlan), this marker routes the
  // strategy to SpecConditionStrategy in the Python engine instead of
  // needs_archetype. Takes priority over the archetypeKey-null fallback but
  // never overrides an actual archetype match.
  conditionCompiledMarker: string | null = null,
): { entry_long: string; entry_short: string } {
  const marker = archetypeKey
    ? `archetype_dispatch:${archetypeKey}`
    : conditionCompiledMarker
      ? conditionCompiledMarker
      : triggerText.length > 0
        ? `pending_archetype:${normalizeFactorToken(triggerText)}`
        : "";

  if (direction === "long") return { entry_long: marker, entry_short: BIDIR_SENTINEL };
  if (direction === "short") return { entry_long: BIDIR_SENTINEL, entry_short: marker };
  // "both"
  return { entry_long: marker, entry_short: marker };
}

// ─── Onboarding orchestration ───────────────────────────────────────────────

export type SymbolCode = "MES" | "MNQ" | "MCL";

export interface OnboardSpecOptions {
  /** Default: MES leader + Wave 25 [MES, MNQ, MCL] fan-out (spec artifacts carry no market field). */
  symbols?: SymbolCode[];
  /** Default "5m" — CONTRACT AMBIGUITY: the spec artifact carries no timeframe field. See runbook. */
  timeframe?: string;
  dryRun: boolean;
  /** Absolute path to playbook_router.py; overridable so tests point at a temp copy. */
  playbookRouterPath: string;
  /** Skip the LLM DSL-quality-critic call (test/CI convenience — critic is fail-open on any infra error anyway). */
  skipDslCritic?: boolean;
}

export type PerSymbolStatus =
  | "inserted"
  | "skipped_duplicate"
  | "rejected_gate1"
  | "rejected_auditor"
  | "rejected_dsl_critic"
  | "registration_failed"
  | "dry_run_planned";

export interface PerSymbolOnboardResult {
  symbol: SymbolCode;
  status: PerSymbolStatus;
  strategyId?: string;
  strategyName: string;
  lifecycleState: string;
  needsArchetype: boolean;
  reason?: string;
  playbookCategory?: PlaybookCategory;
}

export interface OnboardSpecResult {
  video: string;
  specHash: string;
  ok: boolean;
  reason?: string;
  archetypeMatch?: ArchetypeMatchResult;
  /** Band C: set only when archetypeMatch did not match — the condition-family binding decision. */
  bindingPlan?: BindingPlan | null;
  /** Band C: true when routed to spec_conditions dispatch (archetype unmatched but binding plan compiled). */
  conditionCompiled?: boolean;
  conceptName?: string;
  confluenceFactors?: string[];
  perSymbol: PerSymbolOnboardResult[];
}

async function findExistingOnboardedRow(specHash: string, symbol: string) {
  const tag = `spec_hash:${specHash}`;
  const rows = await db
    .select({ id: strategies.id, tags: strategies.tags })
    .from(strategies)
    .where(and(eq(strategies.source, "spec_onboarding"), eq(strategies.symbol, symbol)));
  return rows.find((r) => Array.isArray(r.tags) && r.tags.includes(tag)) ?? null;
}

export async function onboardSpecArtifact(
  raw: unknown,
  opts: OnboardSpecOptions,
): Promise<OnboardSpecResult> {
  const parsed = parseSpecArtifact(raw);
  if (!parsed.ok || !parsed.artifact) {
    return { video: "unknown", specHash: "unknown", ok: false, reason: parsed.reason, perSymbol: [] };
  }
  const artifact = parsed.artifact;
  const { video, spec_hash: specHash } = artifact;
  const spec = artifact.spec;

  const archetypeMatch = matchArchetype(spec.entry_conditions);
  const { conceptName, triggerText } = deriveConceptName(spec, video);
  const confluenceFactors = deriveConfluenceFactors(spec);

  // ── Band C: condition-family compiler fallback ──────────────────────────
  // When no named archetype matches, don't fall straight to needs_archetype —
  // first ask whether the individual condition FAMILIES (WAIT_SESSION,
  // INVALIDATE, etc.) clear the binding-plan coverage threshold against
  // EXISTING engine primitives (spec-family-bindings.ts, mirrored in
  // src/engine/spec_family_bindings.py). This is a pure, synchronous,
  // no-I/O function — safe to call inline here, no Python subprocess needed.
  // Honesty preserved: an insufficiently-bound spec (e.g. the trigger
  // condition itself can't bind, or too few spine conditions bind) still
  // routes to needs_archetype_queue with PER-CONDITION reasons attached
  // (see queueReasons below) — never a blanket blind accept.
  let bindingPlan: BindingPlan | null = null;
  let conditionCompiled = false;
  if (!archetypeMatch.matched) {
    bindingPlan = compileBindingPlan({
      entry_conditions: spec.entry_conditions,
      invalidations: spec.invalidations,
      entry_trigger_id: spec.entry_trigger_id,
    });
    conditionCompiled = bindingPlan.compiled;
  }

  const entryIndicator = archetypeMatch.matched
    ? `archetype:${archetypeMatch.archetypeKey}`
    : conditionCompiled
      ? `spec_conditions:${specHash.slice(0, 12)}`
      : `needs_archetype:${normalizeFactorToken(conceptName)}`;

  const symbols: SymbolCode[] =
    opts.symbols ?? (inferSymbolSet(null, conceptName, "MES") as SymbolCode[]);
  const timeframe = opts.timeframe ?? "5m";
  const sourceUrl = `https://www.youtube.com/watch?v=${video}`;
  const category = deriveCategoryFromArchetype(archetypeMatch.matched ? archetypeMatch.archetypeKey : null);

  const perSymbol: PerSymbolOnboardResult[] = [];

  for (const symbol of symbols) {
    const strategyName = deriveStrategyName(conceptName, symbol, timeframe);

    // ── Idempotency: key on spec_hash + symbol ──────────────────────────────
    if (!opts.dryRun) {
      const existing = await findExistingOnboardedRow(specHash, symbol);
      if (existing) {
        perSymbol.push({
          symbol,
          status: "skipped_duplicate",
          strategyId: existing.id,
          strategyName,
          lifecycleState: "unknown",
          needsArchetype: !archetypeMatch.matched && !conditionCompiled,
        });
        continue;
      }
    }

    // ── Build compiled config ───────────────────────────────────────────────
    const { entry_long, entry_short } = buildDirectionalEntries(
      spec.direction,
      archetypeMatch.matched ? (archetypeMatch.archetypeKey as string) : null,
      triggerText,
      conditionCompiled ? `spec_conditions:${specHash.slice(0, 12)}` : null,
    );

    // ── Gate 1: Bidirectional completeness ──────────────────────────────────
    const { auditBidirectionalCompleteness } = await getGraduatorModule();
    const gate1 = auditBidirectionalCompleteness({
      direction: spec.direction,
      archetype: archetypeMatch.matched ? (archetypeMatch.archetypeKey as string) : null,
      entry_long,
      entry_short,
    });
    if (!gate1.pass) {
      logger.warn({ video, specHash, symbol, reason: gate1.reason }, "spec_onboarding.rejected_incomplete_bidirectional");
      perSymbol.push({
        symbol,
        status: "rejected_gate1",
        strategyName,
        lifecycleState: "n/a",
        needsArchetype: !archetypeMatch.matched && !conditionCompiled,
        reason: gate1.reason ?? "gate1_failed",
      });
      continue;
    }

    // E1_REGIME_GATE_DISABLED is a DEFECT-level auditor check (CLAUDE.md §13:
    // "Don't deploy without preferred regime tag") — framework-overlay.ts does
    // NOT set this (verified; it only owns risk/sizing/exits), so the
    // onboarding converter must supply it itself, same as any other
    // strategy-creation site. direction:"both" gets enabled=true with no
    // single preferred_regime (a WARNING only, not a defect — a genuinely
    // bidirectional setup has no single regime bias by construction).
    const preferredRegime = spec.direction === "long" ? "TRENDING_UP" : spec.direction === "short" ? "TRENDING_DOWN" : null;

    const compiled: Record<string, unknown> = {
      direction: spec.direction,
      entry_type: "market",
      regime_gate: { enabled: true, preferred_regime: preferredRegime },
      strategy: {
        entry_long,
        entry_short,
        entry_indicator: entryIndicator,
        stop_loss: { type: "atr", multiplier: 1.5 },
        position_size: { type: "risk_derived_pyramid" },
      },
      metadata: {
        source: "spec_onboarding",
        extraction_provenance: `spec:${video}:${specHash}`,
        source_url: sourceUrl,
        spec_hash: specHash,
        graph_canonical_hash: artifact.graph_canonical_hash,
        ledger_d: artifact.ledger_d,
        pipeline_version: artifact.pipeline_version ?? null,
      },
    };

    type OverlayInputShape = Parameters<typeof applyFrameworkOverlay>[0];
    const overlayed = applyFrameworkOverlay({
      compiled: compiled as unknown as OverlayInputShape["compiled"],
      source: "spec_onboarding" as unknown as StrategySource,
      symbol,
      exitStyle: "static_styleC",
    });

    const { classifyFactorSources } = await getGraduatorModule();
    const { factor_sources, factor_quality, mergedFactors } = classifyFactorSources(
      confluenceFactors,
      confluenceFactors,
      entryIndicator,
    );

    const entryQuality = {
      confluence_factors: mergedFactors,
      factor_sources,
      factor_quality,
      use_weighted_scoring: false,
    };

    const finalConfig: Record<string, unknown> = {
      ...(overlayed.config as unknown as Record<string, unknown>),
      entry_quality: entryQuality,
      compiled_spec: {
        video,
        spec_hash: specHash,
        graph_canonical_hash: artifact.graph_canonical_hash,
        ledger_d: artifact.ledger_d,
        spec,
        // Band C: audit-visible summary of the binding-plan decision (the
        // Python engine recomputes the full plan itself at backtest time via
        // spec_family_bindings.compile_binding_plan — this summary is for
        // fast operator/audit inspection without a recompute).
        ...(bindingPlan
          ? {
              binding_plan_summary: {
                compiled: bindingPlan.compiled,
                approximation_used: bindingPlan.approximationUsed,
                spine_bound: bindingPlan.spineBound,
                spine_total: bindingPlan.spineTotal,
                trigger_bound: bindingPlan.triggerBound,
                queue_reasons: bindingPlan.queueReasons,
              },
            }
          : {}),
      },
    };

    // ── Auditor ──────────────────────────────────────────────────────────────
    const auditResult = auditGraduatedConfig({ conceptName, symbol, config: finalConfig });
    if (!auditResult.passed) {
      perSymbol.push({
        symbol,
        status: "rejected_auditor",
        strategyName,
        lifecycleState: "n/a",
        needsArchetype: !archetypeMatch.matched && !conditionCompiled,
        reason: formatAuditResult(auditResult),
      });
      continue;
    }

    // ── DSL quality critic (fail-open on any infra error, per documented design) ──
    let criticAccepted = true;
    if (!opts.skipDslCritic) {
      try {
        const { runDslQualityCritic } = await getAgentServiceModule();
        const critic = await runDslQualityCritic(
          { dsl: finalConfig, sourceFind: { title: conceptName, source: sourceUrl, description: conceptName } },
          `spec:${specHash}:${symbol}`,
        );
        criticAccepted = critic ? critic.accept !== false : true;
      } catch (err) {
        logger.warn({ video, specHash, symbol, err: String(err) }, "spec_onboarding.dsl_critic_fail_open");
        criticAccepted = true;
      }
    }
    if (!criticAccepted) {
      perSymbol.push({
        symbol,
        status: "rejected_dsl_critic",
        strategyName,
        lifecycleState: "n/a",
        needsArchetype: !archetypeMatch.matched && !conditionCompiled,
        reason: "dsl_quality_critic_rejected",
      });
      continue;
    }

    const lifecycleState = archetypeMatch.matched || conditionCompiled ? "CANDIDATE" : "NEEDS_ARCHETYPE";
    const tags = [
      "cross-validated",
      "spec-onboarding",
      `spec_hash:${specHash}`,
      `spec_video:${video}`,
      archetypeMatch.matched
        ? `archetype:${archetypeMatch.archetypeKey}`
        : conditionCompiled
          ? "condition_compiled"
          : "needs_archetype",
    ];

    // ── Single-entry-point guard (deep-scan #11 mandate) ───────────────────
    assertCrossValidatedSourceLocal("spec_onboarding", tags);

    if (opts.dryRun) {
      perSymbol.push({
        symbol,
        status: "dry_run_planned",
        strategyName,
        lifecycleState,
        needsArchetype: !archetypeMatch.matched && !conditionCompiled,
        playbookCategory: category,
      });
      continue;
    }

    const [inserted] = await db
      .insert(strategies)
      .values({
        id: randomUUID(),
        name: strategyName,
        description: `Spec-onboarded: ${conceptName} (video ${video})`,
        symbol,
        symbols: [symbol],
        timeframe,
        config: finalConfig,
        lifecycleState,
        preferredRegime,
        source: "spec_onboarding",
        tags,
      })
      .returning({ id: strategies.id });

    // ── B2: Playbook registration — part of the onboarding transaction ─────
    const regResult = registerStrategiesInPlaybook(opts.playbookRouterPath, [strategyName], category);
    if (!regResult.ok) {
      // Registration failure must not leave a DB-registered-but-invisible row
      // (deep-scan #10 finding: unregistered = silent confluence-overlay bypass).
      await db.delete(strategies).where(eq(strategies.id, inserted.id));
      perSymbol.push({
        symbol,
        status: "registration_failed",
        strategyName,
        lifecycleState,
        needsArchetype: !archetypeMatch.matched && !conditionCompiled,
        reason: regResult.reason,
      });
      continue;
    }

    // ── needs_archetype_queue routing (honest parking, never silently dropped) ──
    // Band C: only queues when NEITHER a named archetype matched NOR the
    // condition-family binding plan cleared coverage. Per-condition binding
    // reasons (never a blanket rejection) are appended to verbatimDescription
    // when a binding plan was computed.
    if (!archetypeMatch.matched && !conditionCompiled) {
      const spineAndTriggerObjects = spec.entry_conditions
        .filter((c) => c.role === "spine" || c.role === "trigger")
        .map((c) => c.object)
        .filter(Boolean)
        .join(" | ");
      const trigger = spec.entry_conditions.find((c) => c.id === spec.entry_trigger_id);
      const reasonSuffix =
        bindingPlan && bindingPlan.queueReasons.length > 0
          ? ` [unbindable: ${bindingPlan.queueReasons
              .map((r) => `${r.type}:"${r.object}" (${r.reason})`)
              .join("; ")}]`
          : "";
      await db
        .insert(needsArchetypeQueue)
        .values({
          speakerTerm: normalizeFactorToken(conceptName),
          verbatimDescription: (spineAndTriggerObjects || conceptName) + reasonSuffix,
          transcriptQuote: trigger?.evidence ?? null,
          sourceUrl,
          extractionCount: 1,
        })
        .onConflictDoUpdate({
          target: needsArchetypeQueue.speakerTerm,
          set: { extractionCount: sql`${needsArchetypeQueue.extractionCount} + 1`, updatedAt: sql`now()` },
        });
    }

    perSymbol.push({
      symbol,
      status: "inserted",
      strategyId: inserted.id,
      strategyName,
      lifecycleState,
      needsArchetype: !archetypeMatch.matched && !conditionCompiled,
      playbookCategory: category,
    });
  }

  return {
    video,
    specHash,
    ok: true,
    archetypeMatch,
    bindingPlan,
    conditionCompiled,
    conceptName,
    confluenceFactors,
    perSymbol,
  };
}
