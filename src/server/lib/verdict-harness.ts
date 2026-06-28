/**
 * VERDICT HARNESS — the falsification instrument (zero-dependency; the LAST artifact, not architecture).
 *
 * The system is complete as a span-grounded, inference-classified execution compiler that produces
 * segregated financial simulations conditioned on the EPISTEMIC ORIGIN of instruction. Nothing more is built.
 * This harness consumes real backtest trades the moment they exist and renders the verdict that decides which
 * representational layer actually carries signal — with NO model and NO engine dependency.
 *
 * The hypothesis (sharpened, operator): not "signal vs noise" but — when instruction is decomposed into
 *   lexical structure (grounded) · perceptual inference (confirmation) · structural inference (imposed rules)
 * — does only ONE layer carry predictive power, and does that partition hold ACROSS UNSEEN REGIMES?
 *   - holds across strata  → a STRUCTURAL LAW of instructional encoding (universal)
 *   - varies across strata → a CORPUS-CONDITIONAL decomposition (valid but not universal)
 * Stability-of-absence-of-language ≠ universality-of-mechanism — this harness can tell them apart.
 *
 * Pure / deterministic. Imports only the already-built pure libs.
 */

import type { StrategyIR } from "./state-machine-ir.js";
import { tradeGrounding } from "./uncertainty-propagation.js";
import { analyzeInference } from "./inference-taxonomy.js";
import {
  segregateBacktest, segregateByInferenceModality,
  type SegregatedBacktest, type ModalitySegregation, type ModalityClass, type GroundingClass,
} from "./uncertainty-propagation.js";

export interface VerdictTrade {
  strategy_id: string;
  pnl: number;
  ir?: StrategyIR;                  // if present, classes are derived from it (preferred)
  modality_class?: ModalityClass;   // else pre-tagged
  grounding_class?: GroundingClass;
  regime?: string; educator?: string; asset?: string; // strata for the closure test
}

/** Derive grounding + modality class for a trade (from its IR, or use the pre-tagged values). */
function classify(t: VerdictTrade): { grounding_class: GroundingClass; modality_class: ModalityClass } {
  if (t.grounding_class && t.modality_class) return { grounding_class: t.grounding_class, modality_class: t.modality_class };
  if (t.ir) {
    const g = tradeGrounding(t.ir);
    const a = analyzeInference(g);
    const modality_class: ModalityClass = g.grounding_class === "FULLY_GROUNDED" ? "FULLY_GROUNDED" : (a.dominant_modality ?? "STRUCTURAL");
    return { grounding_class: g.grounding_class, modality_class };
  }
  // last resort: treat as structural inference (most conservative — highest attribution risk)
  return { grounding_class: t.grounding_class ?? "INFERENCE_DEPENDENT", modality_class: t.modality_class ?? "STRUCTURAL" };
}

export type SignalLayer = "grounded" | "perceptual" | "structural" | "mixed" | "none";
function signalLayer(m: ModalitySegregation): SignalLayer {
  switch (m.verdict) {
    case "GROUNDED_SIGNAL": return "grounded";
    case "PERCEPTUAL_SIGNAL_REAL": return "perceptual";
    case "STRUCTURAL_SIGNAL_SUSPECT": return "structural";
    case "MIXED_INFERENCE_SIGNAL": return "mixed";
    default: return "none";
  }
}

export type ClosureKind = "STRUCTURAL_LAW" | "CORPUS_CONDITIONAL" | "INSUFFICIENT_DATA";
export interface Closure { kind: ClosureKind; dominant_layer: SignalLayer | null; per_stratum: Array<{ key: string; layer: SignalLayer; n: number }>; note: string }

export interface VerdictReport {
  n: number;
  grounded_vs_inference: SegregatedBacktest;  // does the edge survive when only grounded trades are kept?
  modality: ModalitySegregation;              // which inference modality carries signal (pooled)
  closure: Closure;                            // does the partition hold across strata?
}

export interface VerdictOpts { stratifyBy?: "regime" | "educator" | "asset"; minTrades?: number }

/** Run the full verdict: pooled grounded/inference + modality segregation + the cross-stratum closure test. */
export function runVerdict(trades: VerdictTrade[], opts: VerdictOpts = {}): VerdictReport {
  const minTrades = opts.minTrades ?? 5;
  const tagged = trades.map((t) => ({ ...t, ...classify(t) }));
  const grounded_vs_inference = segregateBacktest(tagged.map((t) => ({ grounding_class: t.grounding_class, pnl: t.pnl })), { minTrades });
  const modality = segregateByInferenceModality(tagged.map((t) => ({ modality_class: t.modality_class, pnl: t.pnl })), { minTrades });

  // Closure: stratify, compute the signal layer per stratum, check stability.
  const field = opts.stratifyBy;
  let closure: Closure;
  if (!field) {
    closure = { kind: "INSUFFICIENT_DATA", dominant_layer: signalLayer(modality), per_stratum: [], note: "no stratification field — pooled verdict only; closure requires unseen-regime strata" };
  } else {
    const groups = new Map<string, typeof tagged>();
    for (const t of tagged) { const k = (t[field] ?? "∅") as string; (groups.get(k) ?? groups.set(k, []).get(k)!).push(t); }
    const per_stratum = [...groups.entries()].map(([key, ts]) => {
      const m = segregateByInferenceModality(ts.map((t) => ({ modality_class: t.modality_class, pnl: t.pnl })), { minTrades });
      return { key, layer: signalLayer(m), n: ts.length };
    });
    const decisive = per_stratum.filter((s) => s.layer !== "none" && s.n >= minTrades);
    if (decisive.length < 2) closure = { kind: "INSUFFICIENT_DATA", dominant_layer: null, per_stratum, note: `need ≥2 strata with ≥${minTrades} trades and a decisive layer` };
    else {
      const layers = new Set(decisive.map((s) => s.layer));
      if (layers.size === 1) closure = { kind: "STRUCTURAL_LAW", dominant_layer: decisive[0].layer, per_stratum, note: `the '${decisive[0].layer}' layer carries signal across ALL ${decisive.length} strata — a structural law of instructional encoding (universal in this stratification)` };
      else closure = { kind: "CORPUS_CONDITIONAL", dominant_layer: null, per_stratum, note: `the signal-carrying layer VARIES across strata (${[...layers].join(", ")}) — corpus-conditional, NOT universal` };
    }
  }
  return { n: trades.length, grounded_vs_inference, modality, closure };
}

/** Render the verdict as a human/operator-facing markdown report (the falsification readout). */
export function renderVerdict(r: VerdictReport): string {
  const stat = (s: { n: number; avg_pnl: number; win_rate: number; total_pnl: number }) => `n=${s.n} avg=${s.avg_pnl} win=${(s.win_rate * 100).toFixed(0)}% total=${s.total_pnl}`;
  const lines = [
    `# Verdict (${r.n} trades)`,
    ``,
    `## Grounded vs inference — does the edge survive when only transcript-grounded trades are kept?`,
    `- verdict: **${r.grounded_vs_inference.verdict}** — ${r.grounded_vs_inference.note}`,
    `- fully_grounded: ${stat(r.grounded_vs_inference.fully_grounded)}`,
    `- inference_dependent: ${stat(r.grounded_vs_inference.inference_dependent)}`,
    ``,
    `## Which inference modality carries signal? (the signal-vs-noise axis)`,
    `- verdict: **${r.modality.verdict}** — ${r.modality.note}`,
    `- fully_grounded: ${stat(r.modality.fully_grounded)}`,
    `- perceptual (confirmation): ${stat(r.modality.perceptual)}`,
    `- structural (imposed rules): ${stat(r.modality.structural)}`,
    ``,
    `## Closure — does the partition hold across regimes?`,
    `- **${r.closure.kind}** — ${r.closure.note}`,
    ...r.closure.per_stratum.map((s) => `  - ${s.key}: signal layer = ${s.layer} (n=${s.n})`),
  ];
  return lines.join("\n");
}
