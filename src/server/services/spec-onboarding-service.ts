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
  deriveCategoryFromConditionSpec,
  type PlaybookCategory,
} from "../lib/playbook-registration.js";
import { logger } from "../lib/logger.js";
// deepscan17 H-3: factor-quality observability (leaf lib — no service cycle).
import { emitFactorQualityClassified, emitThinConfluenceWarning } from "../lib/confluence-quality-audit.js";
import { recoverSpecTimeframe } from "../lib/spec-timeframe-recovery.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";

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
// This began as a DELIBERATE, DOCUMENTED mirror of agent-service.ts's exported
// `assertCrossValidatedSource`. Deep-scan #16 Wave 2 (H-6, 2026-07-04)
// INTENTIONALLY DIVERGED it: the canonical version's `tags.includes("cross-validated")`
// branch is a legitimate signal for its multi-layer graduation callers, but it was a
// false guarantee here — this file's sole caller self-stamps "cross-validated" on
// every insert, so the tag branch verified nothing. The local guard now trusts the
// spec_onboarding path by SOURCE IDENTITY (provenance = certified-compiler artifact +
// auditor + DSL critic), not by a self-stamped tag. The larger architectural fix
// (sever the static edge to backtest-service.ts, dynamic-import at call time) remains
// flagged in docs/spec-onboarding-runbook.md, out of scope for this band.
function assertCrossValidatedSourceLocal(source: string, tags: string[]): void {
  const EXEMPT_SOURCES = new Set(["clone", "b4_regen", "evolved"]);
  if (EXEMPT_SOURCES.has(source)) return;
  if (source === "graduated_bucket") return;
  // Deep-scan #16 Wave 2 (H-6, 2026-07-04): the spec-onboarding path is trusted
  // by SOURCE IDENTITY, not by a self-stamped tag. Previously this guard passed
  // whenever `tags` contained "cross-validated" — but the sole caller
  // (onboardSpecArtifact, source always "spec_onboarding") stamps that exact tag
  // UNCONDITIONALLY on every insert, so the tag branch was a decorative no-op that
  // guaranteed nothing (any junk config could pass by self-stamping the string).
  // The spec_onboarding path's real provenance is the certified-compiler artifact
  // contract + the graduated-strategy auditor + the DSL quality critic (now run by
  // DEFAULT per H-1) — NOT the presence of a caller-controlled tag. So we allow it
  // by explicit source identity and DROP the circular tag-based escape for this
  // local guard. NOTE: this is a DELIBERATE divergence from agent-service.ts's
  // exported assertCrossValidatedSource (whose "cross-validated" tag is meaningful
  // for its own multi-layer graduation callers); `tags` is retained in the
  // signature for call-site symmetry and future diagnostics.
  if (source === "spec_onboarding") return;
  void tags;
  throw new Error(
    `strategy_insert_violation: only graduated_bucket / spec_onboarding source (or exempt clone/regen source) is allowed; got source=${source}`,
  );
}

// Mirrors the private BIDIR_SENTINEL constant in direct-bucket-graduator.ts
// (not exported there — this is a documented, deliberate literal match, same
// convention direct-bucket-graduator.ts itself calls a "sentinel").
const BIDIR_SENTINEL = "high < low";

// ─── Source-risk contract (SOURCE-RISK-HANDOFF-1 / UNIT A) ──────────────────
// Lives in its own DB-free module so the compiler, the overlay and tests can import
// the contract without inheriting this file's import-time DATABASE_URL requirement.
// Re-exported here so existing call sites keep a single import surface.
import {
  resolveSpecStopLoss,
  type SourceRiskContract,
} from "./source-risk-contract";

export {
  ANCHOR_TO_RESOLVER,
  resolveSpecStopLoss,
  type RiskOwnershipMode,
  type SourceRiskContract,
  type SourceStopAnchor,
  type SourceStopContract,
  type SourceTargetContract,
} from "./source-risk-contract";

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
  /**
   * SOURCE-RISK-HANDOFF-1 / UNIT A (AR-1059 §4). OPTIONAL — absent on every existing
   * artifact, which is why the entire current library keeps byte-identical behaviour.
   * Present only when the teacher explicitly taught risk. See source-risk-contract.ts.
   */
  source_risk?: SourceRiskContract;
  /**
   * SPINE-B (AR-1121 §4.B / AR-1123 §6.B). The source-owned timeframe ROLES, produced
   * by the canonical Python compiler and carried INSIDE the certified `spec` body, so
   * `spec_hash` covers them.
   *
   * 🛑 TYPESCRIPT IS TRANSPORT AND A STRUCTURAL FIREBREAK — NEVER AN AUTHOR.
   * It may check the envelope's SHAPE (see `parseSourceTimeframeRoles`). It may NOT
   * choose a timeframe, upgrade an evidence grade, fill a missing role, or derive any
   * of this from `recoverSpecTimeframe()`, the confidence-0.4 lowest-timeframe
   * backfill, `strategy.timeframe` or `trigger_tf`. Teaching TS to manufacture these
   * would create a second semantic compiler — the B1 architecture AR-1119 §1 REJECTED.
   */
  source_timeframe_roles?: SourceTimeframeRolesEnvelope;
}

/** The exact schema string the Python authority stamps. Mirrored, never invented. */
export const SOURCE_TIMEFRAME_ROLES_SCHEMA = "SOURCE_TIMEFRAME_ROLES/1";

/** The closed role set, mirrored from `src/engine/source_timeframe_roles.py`. */
export const SOURCE_TIMEFRAME_ROLE_NAMES = [
  "OPENING_RANGE_WINDOW",
  "BREAKOUT_CONFIRMATION",
  "FVG_DETECTION",
  "ENTRY_COMPLETION",
] as const;

export interface TimeframeRoleBinding {
  role: string;
  timeframe: string;
  evidence_grade: string;
  source_quote: string;
  condition_id: string;
}

export interface SourceTimeframeRolesEnvelope {
  schema: string;
  bindings: TimeframeRoleBinding[];
}

/**
 * STRUCTURAL firebreak only. Returns the envelope UNCHANGED when it is well-shaped,
 * or `undefined` when the field is absent.
 *
 * 🛑 IT RETURNS THE PARSED OBJECT, IT NEVER REPAIRS ONE. A malformed envelope yields
 * `undefined` rather than a patched-up envelope, because a half-filled role set that
 * reaches the engine is exactly what the Python authority refuses at construction — and
 * a carrier TS "fixed" would arrive downstream indistinguishable from a taught one.
 */
export function parseSourceTimeframeRoles(raw: unknown): SourceTimeframeRolesEnvelope | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const env = raw as Record<string, unknown>;
  if (env.schema !== SOURCE_TIMEFRAME_ROLES_SCHEMA) return undefined;
  if (!Array.isArray(env.bindings)) return undefined;

  const bindings: TimeframeRoleBinding[] = [];
  for (const b of env.bindings) {
    if (typeof b !== "object" || b === null) return undefined;
    const r = b as Record<string, unknown>;
    // Every field is required and must be a non-empty string. An empty timeframe or a
    // missing quote is precisely what a DROPPED source fact looks like downstream.
    for (const key of ["role", "timeframe", "evidence_grade", "source_quote", "condition_id"]) {
      if (typeof r[key] !== "string" || (r[key] as string).length === 0) return undefined;
    }
    if (!SOURCE_TIMEFRAME_ROLE_NAMES.includes(r.role as (typeof SOURCE_TIMEFRAME_ROLE_NAMES)[number])) {
      return undefined;
    }
    bindings.push({
      role: r.role as string,
      timeframe: r.timeframe as string,
      evidence_grade: r.evidence_grade as string,
      source_quote: r.source_quote as string,
      condition_id: r.condition_id as string,
    });
  }
  return { schema: env.schema, bindings };
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
        // SPINE-B: transport only. The parser rebuilds `spec` from a FIXED key set, so a
        // field absent from this literal is SILENTLY DROPPED before persistence — which
        // is why adding the carrier to the Python output alone would not have been
        // enough (AR-1119 §2.4).
        source_timeframe_roles: parseSourceTimeframeRoles(spec.source_timeframe_roles),
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
  /**
   * EXPLICIT operator override for a known-uniform batch ONLY. When set, this TF
   * is applied verbatim to every symbol and per-spec recovery is skipped.
   * When UNSET (the default), the exec timeframe is RECOVERED per-spec from the
   * artifact prose via recoverSpecTimeframe(). There is NO silent "5m" default:
   * a spec whose timeframe cannot be recovered is QUARANTINED (fail-loud audit
   * `onboard.timeframe_unrecoverable`), NEVER onboarded at a guessed 5m.
   * (Timeframe Integrity Fix, 2026-07-03.)
   */
  timeframe?: string;
  dryRun: boolean;
  /** Absolute path to playbook_router.py; overridable so tests point at a temp copy. */
  playbookRouterPath: string;
  /** Skip the LLM DSL-quality-critic call (test/CI convenience — critic is fail-open on any infra error anyway). */
  skipDslCritic?: boolean;
  /**
   * MP-1 (R-797 lane `L`): the ONE taught execution candidate this call represents.
   *
   * A certified opening-range spec teaches THREE candidates (5m/15m/30m) that share
   * one `spec_hash`, one `graph_canonical_hash` and one `ledger_d` — every field that
   * crosses this boundary today is computed over the SPEC and so cannot say WHICH
   * variant. Without this, three taught bots are indistinguishable here.
   *
   * 🛑 OPAQUE TO TYPESCRIPT. These are identity strings to compare, never trading
   * semantics to interpret: Python remains the candidate semantic authority. Nothing
   * in this file may parse a duration out of them.
   *
   * 🛑 L-1 SCOPE: accepting this field does NOT change the idempotency decision. It
   * exists so three candidate-aware inputs are DISTINGUISHABLE at this boundary,
   * which is what makes the pre-repair RED meaningful — a RED whose three inputs are
   * identical could never be turned green by the repair, and would be measuring the
   * absence of a channel rather than the collapse itself.
   *
   * Absent for legacy/receiptless callers, which keep `(spec_hash, symbol)` EXACTLY.
   */
  executionCandidate?: {
    candidateId: string;
    cacheIdentity: string;
    receipt: unknown;
  };
}

export type PerSymbolStatus =
  | "inserted"
  | "skipped_duplicate"
  | "rejected_gate1"
  | "rejected_auditor"
  | "rejected_dsl_critic"
  | "registration_failed"
  | "dry_run_planned"
  /**
   * MP-1 `L-3`: the candidate's shipping label is absent, malformed, or disagrees with
   * the identity it claims (obligations H/I/J/K). Distinct from every REJECTION above:
   * those are judgements about the STRATEGY, this is a refusal to trust the LABEL.
   */
  | "refused_candidate_receipt"
  /**
   * MP-1 `L-3`, obligation `L`: one candidate identity is claiming DIFFERENT certified
   * content than the row that already carries it — provenance drift.
   *
   * 🛑 Deliberately NOT `skipped_duplicate` and deliberately NOT an insert. Skipping
   * would silently prefer the stored content; inserting would mint a second row for
   * one candidate identity. Neither is an honest answer to a contradiction, so the
   * only honest answer is to refuse and make a human look.
   */
  | "refused_candidate_identity_conflict";

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

/**
 * MP-1 `L-3`. MIRRORS `src/engine/opening_range_candidate_receipt.py` — it does not
 * re-derive it. `RECEIPT_SCHEMA` and `_RECEIPT_KEYS` are that module's, verbatim.
 *
 * 🛑 THE BOUNDARY THIS FILE MAY NOT CROSS: these are the receipt's OUTER, OPAQUE
 * identity fields. `payload` is checked for PRESENCE and never for CONTENT — the
 * definition, the taught variants and every duration inside it are Python's authority.
 * Nothing here parses opening-range semantics, and nothing here may learn to.
 */
const EXECUTION_CANDIDATE_RECEIPT_SCHEMA = "OPENING_RANGE_EXECUTION_CANDIDATE_RECEIPT/1";
const EXECUTION_CANDIDATE_RECEIPT_KEYS = [
  "schema",
  "parent_spec_hash",
  "candidate_id",
  "cache_identity",
  "payload",
] as const;

/**
 * Obligations H/I/J/K. Returns a REASON when the label may not be trusted, else null.
 *
 * Every branch refuses; none defaults. A receipt this function cannot fully verify is
 * a receipt that does not travel — `NOTHING IS DEFAULTED OR IGNORED` is the Python
 * module's own rule and it is the whole value of a shipping label.
 */
function refuseExecutionCandidate(
  candidate: NonNullable<OnboardSpecOptions["executionCandidate"]>,
  specHash: string,
): string | null {
  // Outer identity must itself be substantive — an empty id is not an identity.
  if (typeof candidate.candidateId !== "string" || candidate.candidateId.length === 0) {
    return "execution candidate id is absent or empty";
  }
  if (typeof candidate.cacheIdentity !== "string" || candidate.cacheIdentity.length === 0) {
    return "execution candidate cache identity is absent or empty";
  }

  // H — the receipt itself.
  const receipt = candidate.receipt;
  if (receipt === null || receipt === undefined || typeof receipt !== "object" || Array.isArray(receipt)) {
    return "execution candidate receipt is absent or is not an object";
  }
  const r = receipt as Record<string, unknown>;
  const got = Object.keys(r);
  const missing = EXECUTION_CANDIDATE_RECEIPT_KEYS.filter((k) => !got.includes(k));
  const unknown = got.filter((k) => !(EXECUTION_CANDIDATE_RECEIPT_KEYS as readonly string[]).includes(k));
  if (missing.length > 0 || unknown.length > 0) {
    // Unknown keys refuse too, mirroring `_exact_keys`: a field this file does not
    // understand is a field some other writer believed was load-bearing.
    return `execution candidate receipt has the wrong field set (missing: [${missing.join(", ")}]; unknown: [${unknown.join(", ")}])`;
  }
  if (r["schema"] !== EXECUTION_CANDIDATE_RECEIPT_SCHEMA) {
    return `unrecognised execution candidate receipt schema ${JSON.stringify(r["schema"])}; expected ${JSON.stringify(EXECUTION_CANDIDATE_RECEIPT_SCHEMA)}`;
  }

  // I — outer candidate id vs the receipt's.
  if (r["candidate_id"] !== candidate.candidateId) {
    return "execution candidate id disagrees with the receipt it travels with";
  }
  // J — outer cache identity vs the receipt's.
  if (r["cache_identity"] !== candidate.cacheIdentity) {
    return "execution candidate cache identity disagrees with the receipt it travels with";
  }
  // K — the receipt must name the parent spec it is actually a child of.
  if (r["parent_spec_hash"] !== specHash) {
    return "execution candidate receipt names a different parent spec than the artifact being onboarded";
  }
  return null;
}

/** Reads a persisted sibling identity field. Never infers one — see obligation `N`. */
function readPersistedCandidateField(config: unknown, key: string): string | null {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return null;
  const v = (config as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * MP-1 `L-3`, the repair. The idempotency question this answers changed shape:
 *
 *   LEGACY (no `candidateId`)  — `spec_hash + symbol`, EXACTLY as before. Obligation `M`.
 *   CANDIDATE-AWARE           — `spec_hash + symbol + candidate_id`.
 *
 * 🛑 `cache_identity` is NOT a fourth identity dimension. `candidate_id` answers WHICH
 * taught bot; `cache_identity` answers WHICH content of that bot. Keying on content
 * would turn every restamp into a new row instead of a visible collision — the
 * cardinality collapse running in reverse. The mismatch is handled by the CALLER as a
 * refusal (obligation `L`), not silently here.
 */
async function findExistingOnboardedRow(specHash: string, symbol: string, candidateId?: string) {
  const tag = `spec_hash:${specHash}`;
  const rows = await db
    .select({ id: strategies.id, tags: strategies.tags, config: strategies.config })
    .from(strategies)
    .where(and(eq(strategies.source, "spec_onboarding"), eq(strategies.symbol, symbol)));
  const forThisSpec = rows.filter((r) => Array.isArray(r.tags) && r.tags.includes(tag));
  if (candidateId === undefined) {
    // Legacy: first row for this (spec_hash, symbol) — identical to the pre-L-3
    // `rows.find(...)` over the same predicate. Receiptless callers see no change.
    return forThisSpec[0] ?? null;
  }
  return (
    forThisSpec.find((r) => readPersistedCandidateField(r.config, "execution_candidate_id") === candidateId) ?? null
  );
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

  // ── MP-1 L-3: the candidate's shipping label, checked BEFORE any DB work ────
  // Obligations H/I/J/K. Symbol-independent by nature — the receipt is a claim about
  // the CANDIDATE and its parent spec, not about a market — so it is settled once and
  // reported for every symbol rather than re-derived per iteration.
  //
  // 🛑 Refusing here rather than mid-loop is deliberate: a malformed label must not be
  // able to insert row 1 and then refuse row 2, which would leave the caller a partial
  // write to reason about.
  const executionCandidate = opts.executionCandidate;
  if (executionCandidate) {
    const refusal = refuseExecutionCandidate(executionCandidate, specHash);
    if (refusal) {
      logger.warn({ video, specHash, refusal }, "spec_onboarding.execution_candidate_refused");
      if (!opts.dryRun) {
        await insertAuditRowSafe({
          action: "onboard.execution_candidate_refused",
          entityType: "strategy",
          status: "warning",
          input: { video, spec_hash: specHash, candidate_id: executionCandidate.candidateId },
          result: { refusal },
          decisionAuthority: "gate",
        });
      }
      return {
        video,
        specHash,
        ok: false,
        reason: `execution_candidate_refused: ${refusal}`,
        archetypeMatch,
        conceptName,
        confluenceFactors,
        perSymbol: symbols.map((symbol) => ({
          symbol,
          status: "refused_candidate_receipt" as const,
          strategyName: deriveStrategyName(conceptName, symbol, opts.timeframe ?? "unresolved"),
          lifecycleState: "n/a",
          needsArchetype: !archetypeMatch.matched && !conditionCompiled,
          reason: refusal,
        })),
      };
    }
  }

  // ── Per-spec timeframe (Timeframe Integrity Fix, 2026-07-03) ──────────────
  // THE ONE INVIOLABLE PRINCIPLE: never silently default a timeframe to "5m".
  // Explicit operator --timeframe override wins (known-uniform batch); otherwise
  // recover the educator's exec (lower/trigger) + higher (context) TF from the
  // artifact prose. If genuinely unrecoverable → QUARANTINE the whole spec with
  // a loud `onboard.timeframe_unrecoverable` audit — never a guessed-5m row.
  let timeframe: string;
  let higherTimeframe: string | null = null;
  let timeframeSource: string;
  let timeframeConfidence = 1;
  let timeframeEvidence = "operator override";
  if (typeof opts.timeframe === "string" && opts.timeframe.length > 0) {
    timeframe = opts.timeframe;
    timeframeSource = "operator_override";
  } else {
    const rec = recoverSpecTimeframe(artifact);
    if (!rec.recovered || !rec.exec_timeframe) {
      if (!opts.dryRun) {
        await insertAuditRowSafe({
          action: "onboard.timeframe_unrecoverable",
          entityType: "strategy",
          status: "warning",
          input: { video, spec_hash: specHash, concept: conceptName },
          result: { evidence: rec.evidence, confidence: rec.confidence },
          decisionAuthority: "gate",
        });
      }
      logger.warn(
        { video, specHash, conceptName, evidence: rec.evidence },
        "spec_onboarding.timeframe_unrecoverable_quarantine",
      );
      return {
        video,
        specHash,
        ok: false,
        reason: `timeframe_unrecoverable: ${rec.evidence}`,
        archetypeMatch,
        conceptName,
        confluenceFactors,
        perSymbol: [],
      };
    }
    timeframe = rec.exec_timeframe;
    higherTimeframe = rec.higher_timeframe;
    timeframeSource = "recovered_from_spec";
    timeframeConfidence = rec.confidence;
    timeframeEvidence = rec.evidence;
  }
  const sourceUrl = `https://www.youtube.com/watch?v=${video}`;
  // Band C: condition-compiled specs (no named archetype, binding plan cleared
  // coverage) get a RESOLVED category from spine+trigger condition vocabulary,
  // not the blanket CONTINUATION_STRATS default `deriveCategoryFromArchetype(null)`
  // would otherwise produce. Registers into the SAME 4 playbook_router.py
  // category lists via the same registerStrategiesInPlaybook mechanism below.
  const category = archetypeMatch.matched
    ? deriveCategoryFromArchetype(archetypeMatch.archetypeKey)
    : conditionCompiled
      ? deriveCategoryFromConditionSpec(spec)
      : deriveCategoryFromArchetype(null);

  const perSymbol: PerSymbolOnboardResult[] = [];

  for (const symbol of symbols) {
    const strategyName = deriveStrategyName(conceptName, symbol, timeframe);

    // ── Idempotency (MP-1 L-3) ──────────────────────────────────────────────
    //   LEGACY         : spec_hash + symbol                  (obligation M, unchanged)
    //   CANDIDATE-AWARE: spec_hash + symbol + candidate_id    (obligations F, G)
    //
    // The whole money path turns on this: three taught candidates of ONE certified
    // parent spec share `spec_hash`, `graph_canonical_hash` and `ledger_d`, so before
    // L-3 they were duplicates of each other and candidates 2 and 3 vanished into
    // `skipped_duplicate`. `ONE TAUGHT CANDIDATE = ONE DURABLE QUALIFICATION IDENTITY`.
    if (!opts.dryRun) {
      const existing = await findExistingOnboardedRow(specHash, symbol, executionCandidate?.candidateId);
      if (existing) {
        // ── Obligation L: same candidate, different content ⇒ REFUSE ────────
        // The row already carrying this candidate identity was certified from
        // DIFFERENT content. Skipping would silently prefer the stored version;
        // inserting would give one candidate identity two rows. Both launder a
        // contradiction, so neither is available.
        if (executionCandidate) {
          const storedCacheIdentity = readPersistedCandidateField(
            existing.config,
            "execution_candidate_cache_identity",
          );
          if (storedCacheIdentity !== executionCandidate.cacheIdentity) {
            const reason =
              `candidate ${executionCandidate.candidateId} already exists with cache identity ` +
              `${JSON.stringify(storedCacheIdentity)}, but this onboarding claims ` +
              `${JSON.stringify(executionCandidate.cacheIdentity)} — provenance drift, refusing`;
            logger.warn({ video, specHash, symbol, reason }, "spec_onboarding.candidate_identity_conflict");
            await insertAuditRowSafe({
              action: "onboard.candidate_identity_conflict",
              entityType: "strategy",
              status: "warning",
              input: {
                video,
                spec_hash: specHash,
                symbol,
                candidate_id: executionCandidate.candidateId,
                claimed_cache_identity: executionCandidate.cacheIdentity,
              },
              result: { existing_strategy_id: existing.id, stored_cache_identity: storedCacheIdentity },
              decisionAuthority: "gate",
            });
            perSymbol.push({
              symbol,
              status: "refused_candidate_identity_conflict",
              strategyId: existing.id,
              strategyName,
              lifecycleState: "unknown",
              needsArchetype: !archetypeMatch.matched && !conditionCompiled,
              reason,
            });
            continue;
          }
        }
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
      entry_indicator: entryIndicator,
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

    // PACKET 2 (R-039 pin c / R-040): propagate the producer's house-default-exit
    // provenance stamp so it reaches the persisted cert↔spec chain. The Python
    // spec_producer stamps `spec.framework_overlay.exit = "house-default (trader
    // taught none)"` when the trader taught NO exit; framework-overlay.ts then
    // supplies Style C unconditionally, but carries no record of WHY. This
    // threads the "why" into config.metadata AND compiled_spec (both sides).
    const houseDefaultExit =
      (spec.framework_overlay?.["exit"] as string | undefined) === "house-default (trader taught none)"
        ? {
            exit: "house-default (trader taught none)",
            exit_source:
              (spec.framework_overlay?.["exit_source"] as string | undefined) ?? "framework_overlay_style_c",
          }
        : null;

    const compiled: Record<string, unknown> = {
      direction: spec.direction,
      entry_type: "market",
      regime_gate: { enabled: true, preferred_regime: preferredRegime },
      strategy: {
        entry_long,
        entry_short,
        entry_indicator: entryIndicator,
        // Per-spec exec timeframe (trigger TF). Higher/context TF carried alongside.
        timeframe,
        trigger_tf: timeframe,
        ...(higherTimeframe ? { htf_tf: higherTimeframe } : {}),
        // SOURCE-RISK-HANDOFF-1 / UNIT A+E. Was an unconditional
        // `{ type: "atr", multiplier: 1.5 }`, which destroyed a taught stop at this
        // exact boundary (AR-1056 §2.4). resolveSpecStopLoss returns that SAME object
        // for every spec without an explicit SOURCE_FAITHFUL contract — i.e. the whole
        // existing library is unchanged — and preserves the taught anchor only when the
        // teacher actually taught one.
        stop_loss: resolveSpecStopLoss(spec),
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
        ...(houseDefaultExit ? { exit_provenance: houseDefaultExit } : {}),
        timeframe_recovery: {
          exec_timeframe: timeframe,
          higher_timeframe: higherTimeframe,
          source: timeframeSource,
          confidence: timeframeConfidence,
          evidence: timeframeEvidence,
        },
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
        ...(houseDefaultExit ? { exit_provenance: houseDefaultExit } : {}),
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
      // ── MP-1 L-3: the candidate's identity, persisted as SIBLINGS ──────────
      // 🛑 Siblings of `compiled_spec`, never inside it: `compiled_spec.spec` is the
      // CERTIFIED artifact and `spec_hash` is computed over it. Writing a per-candidate
      // field in there would change what the certification covers and silently move the
      // hash — the one thing this lane is forbidden to touch.
      //
      // Absent entirely for legacy callers (obligation N): a row with no candidate is a
      // row with no candidate FIELDS. Nothing here mints one from a timeframe, an array
      // index, a strategy name or a default duration.
      ...(executionCandidate
        ? {
            execution_candidate_id: executionCandidate.candidateId,
            execution_candidate_cache_identity: executionCandidate.cacheIdentity,
            execution_candidate_receipt: executionCandidate.receipt,
          }
        : {}),
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
        // Wave 25 multi-TF columns: exec → trigger_tf, context → htf_tf.
        triggerTf: timeframe,
        ...(higherTimeframe ? { htfTf: higherTimeframe } : {}),
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

    // ── deepscan17 H-3: factor-quality telemetry (Gate 2 always; Gate 3 on fallback_only) ──
    // The graduator emits these for bucket-graduated strategies; spec-onboarding computed
    // factor_quality above but never emitted the observability — so the entire live 120-strategy
    // library had ZERO factor-quality signal (no graduation.factor_quality_classified audit, no
    // tf_graduation_factor_quality_total Prometheus, no thin-confluence Discord advisory). Emit here,
    // after the row is durably registered, so library debt is visible for the whole corpus.
    try {
      emitFactorQualityClassified({
        strategy_id: inserted.id,
        strategy_name: strategyName,
        correlation_id: null,
        factor_quality,
        factor_sources: factor_sources as Record<string, "extracted" | "auto_floor" | "kb_inferred">,
        confluence_factors: mergedFactors,
      });
      if (factor_quality === "fallback_only") {
        emitThinConfluenceWarning({
          strategy_id: inserted.id,
          strategy_name: strategyName,
          correlation_id: null,
          factor_quality: "fallback_only",
          confluence_factors: mergedFactors,
          source_url: sourceUrl ?? null,
        });
      }
    } catch (helperErr: unknown) {
      logger.warn({ err: String(helperErr), strategyId: inserted.id, strategyName }, "deepscan17 H-3: factor-quality telemetry emit failed (non-blocking)");
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
