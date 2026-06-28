/**
 * CONSENSUS PROTOCOL — Checkpoint 6 (the final architecture checkpoint).
 *
 * NOT "multi-pass Gemma". A CONSENSUS PROTOCOL: four passes with DIFFERENT JOBS, meant to disagree, then an
 * agreement graph + disagreement report + semantic entropy + stability. The MEASUREMENT OF UNCERTAINTY is the
 * deliverable — you learn WHERE extraction is unsure, not just whether it "succeeded".
 *
 *   Pass 1 LITERAL          — extract only what is explicitly stated; never infer; UNKNOWN when uncertain.
 *   Pass 2 DECISION_PROCESS — may infer missing execution detail; produces a complete IR; inferences MARKED.
 *   Pass 3 SKEPTIC          — attacks Pass 2: invented invalidation? assumed confirmation? OR→AND collapse?
 *   Pass 4 CONSERVATION     — walks the transcript line by line; every sentence must land somewhere or FAIL.
 *
 * This module is the PURE consensus machinery (testable offline). The live Gemma invocation is a defined
 * adapter (`GemmaPassRunner`) flagged as needing the stable NSSM supervisor (W4.2) — it is NOT run in tests;
 * the protocol is proven with deterministic pass fixtures.
 */

import type { StrategyIR } from "./state-machine-ir.js";

export type PassRole = "literal" | "decision_process" | "skeptic" | "conservation";
export type UnitStatus = "extracted" | "inferred" | "unknown";

/** One semantic unit as seen by one pass. `key` = normalized concept identity (for cross-pass comparison). */
export interface PassUnit { key: string; node: string; status: UnitStatus; evidence?: string }
export interface PassOutput { role: PassRole; units: PassUnit[]; ir?: StrategyIR }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const extractedKeys = (p: PassOutput) => new Set(p.units.filter((u) => u.status !== "unknown").map((u) => norm(u.key)));

// ── Agreement graph ────────────────────────────────────────────────────────────
export interface AgreementEntry { key: string; extracted_by: PassRole[]; count: number; level: "unanimous" | "majority" | "minority" | "single" }
export function buildAgreement(extractors: PassOutput[]): AgreementEntry[] {
  const n = extractors.length;
  const byKey = new Map<string, PassRole[]>();
  for (const p of extractors) for (const k of extractedKeys(p)) { const a = byKey.get(k) ?? []; a.push(p.role); byKey.set(k, a); }
  return [...byKey.entries()].map(([key, roles]) => {
    const count = roles.length;
    const level = count === n ? "unanimous" : count === 1 ? "single" : count > n / 2 ? "majority" : "minority";
    return { key, extracted_by: roles, count, level };
  });
}

// ── Disagreement report ─────────────────────────────────────────────────────────
export interface DisagreementReport { unanimous: string[]; majority: string[]; disputed: string[]; single: string[] }
export function disagreementReport(extractors: PassOutput[]): DisagreementReport {
  const ag = buildAgreement(extractors);
  return {
    unanimous: ag.filter((a) => a.level === "unanimous").map((a) => a.key),
    majority: ag.filter((a) => a.level === "majority").map((a) => a.key),
    disputed: ag.filter((a) => a.level === "minority").map((a) => a.key),
    single: ag.filter((a) => a.level === "single").map((a) => a.key),
  };
}

// ── Semantic entropy (WHERE the uncertainty lives) ───────────────────────────────
export interface SemanticEntropy { total: number; unanimous: number; disputed: number; missing: number }
export function semanticEntropy(transcriptUnitKeys: string[], extractors: PassOutput[]): SemanticEntropy {
  const ag = buildAgreement(extractors);
  const agByKey = new Map(ag.map((a) => [a.key, a]));
  const keys = transcriptUnitKeys.map(norm);
  let unanimous = 0, disputed = 0, missing = 0;
  for (const k of keys) {
    const a = agByKey.get(k);
    if (!a) missing++;
    else if (a.level === "unanimous") unanimous++;
    else disputed++;
  }
  return { total: keys.length, unanimous, disputed, missing };
}

// ── Pass 3 SKEPTIC — adversarial checks on the decision-process pass vs the literal pass ──
export type SkepticFindingType = "SILENT_INVENTION" | "DROPPED_EXPLICIT" | "OR_COLLAPSE";
export interface SkepticFinding { type: SkepticFindingType; key: string; detail: string }
/**
 * The skeptic attacks Pass 2. SILENT_INVENTION = DP extracted a unit (NOT marked inferred) that the literal
 * pass never saw → silent invention (violates the explicit-XOR-inferred invariant). DROPPED_EXPLICIT = literal
 * extracted an explicit unit that DP dropped. OR_COLLAPSE = literal saw alternatives but DP forced all_required.
 */
export function skepticFindings(literal: PassOutput, dp: PassOutput): SkepticFinding[] {
  const findings: SkepticFinding[] = [];
  const litKeys = extractedKeys(literal);
  const litExplicit = new Set(literal.units.filter((u) => u.status === "extracted").map((u) => norm(u.key)));
  for (const u of dp.units) {
    const k = norm(u.key);
    if (u.status === "extracted" && !litKeys.has(k)) findings.push({ type: "SILENT_INVENTION", key: u.key, detail: "DP extracted (not marked inferred) a unit the literal pass never saw" });
  }
  for (const u of literal.units) {
    if (u.status !== "extracted") continue;
    if (!extractedKeys(dp).has(norm(u.key))) findings.push({ type: "DROPPED_EXPLICIT", key: u.key, detail: "literal extracted an explicit unit DP dropped" });
  }
  // OR_COLLAPSE — literal saw ≥2 alternative entries but DP's IR forced all_required
  const litAlts = literal.units.filter((u) => u.node === "alternative").length;
  if (litAlts >= 1 && dp.ir?.wait_state.confirmation.compound?.enforcement === "all_required") {
    findings.push({ type: "OR_COLLAPSE", key: "entry_alternatives", detail: `literal saw ${litAlts + 1} alternatives; DP forced all_required` });
  }
  return findings;
}

// ── Semantic diff + stability (compare GRAPHS, not text) ─────────────────────────
function irSignature(ir: StrategyIR): Record<string, string> {
  const c = ir.wait_state.confirmation.compound;
  const primary = c?.legs.find((l) => l.order === c.primary_order) ?? c?.legs[0];
  return {
    bias: ir.bias?.direction ?? "∅",
    structural_event: ir.structural_event?.event ?? "∅",
    execution_context: ir.execution_context?.zone ?? "∅",
    until: ir.wait_state.until.kind,
    confirmation_primary: primary ? `${primary.kind}@${primary.level_ref ?? "?"}` : "∅",
    enforcement: c?.enforcement ?? "∅",
    invalidation: ir.wait_state.invalidated_by ? "present" : "∅",
    entry: ir.entry.order_type,
  };
}
export interface SemanticDiffEntry { node: string; a: string; b: string; same: boolean }
export function semanticDiff(a: StrategyIR, b: StrategyIR): SemanticDiffEntry[] {
  const sa = irSignature(a), sb = irSignature(b);
  return Object.keys(sa).map((node) => ({ node, a: sa[node], b: sb[node], same: sa[node] === sb[node] }));
}
/** Stability across N runs of the SAME transcript: fraction of graph nodes identical across all runs. */
export function semanticStability(graphs: StrategyIR[]): { score: number; unstable_nodes: string[] } {
  if (graphs.length < 2) return { score: 1, unstable_nodes: [] };
  const sigs = graphs.map(irSignature);
  const nodes = Object.keys(sigs[0]);
  const unstable = nodes.filter((node) => sigs.some((s) => s[node] !== sigs[0][node]));
  return { score: (nodes.length - unstable.length) / nodes.length, unstable_nodes: unstable };
}

// ── Live adapter (DEFINED, flagged — NOT run in tests; needs the stable NSSM supervisor, W4.2) ──
export interface GemmaPassRunner {
  /** Runs one pass of the consensus protocol against the transcript via Gemma. Live-only. */
  runPass(role: PassRole, transcript: string): Promise<PassOutput>;
}
