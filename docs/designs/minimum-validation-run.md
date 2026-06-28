# Minimum Final-Validation Run — the smallest dataset that proves OR disproves the system

> **Status:** PROTOCOL (no new architecture). The system is architecturally complete + offline-tested; this
> is the experiment that collapses uncertainty into a yes/no on the mission: *"extracted strategy reproduces
> the educator's decisions and edge under replay."* Runs against the verdict harness (`verdict-harness.ts`) +
> grounding validator. Gated on the stable NSSM supervisor (W4.2) + engine-attach (real OHLC replay).
>
> Design principle: MINIMUM = smallest dataset that still has (a) statistical power per cell and (b) enough
> DIVERSITY to run the closure test. Below this, a pass is luck and a fail is undersampling.

## Dataset (the minimum)

**~18 unseen videos** (none in the frozen-6 / calibration corpus), chosen for **diversity, not volume** —
diversity is what makes the closure test meaningful:
- **≥3 educators** (so "is it a universal compiler or a fitted interpreter?" is answerable — single-educator success is interpreter, not compiler).
- **≥2 strategy families** (e.g. ICT/order-block vs ORB/breakout-retest) — different inference profiles.
- **≥2 instruments / asset behaviors** (e.g. index futures vs crude) — different market regimes.
- Each video must contain **≥2 educator-DEMONSTRATED example trades with identifiable dates/levels** (the
  ground truth for replay parity). Videos that only describe, never demonstrate, are excluded (no ground truth).

That's ~18 videos × ~2 demonstrated trades = **~36 parity points**, and — at base sizing across a 6–12 month
backtest window — enough fired trades to populate the modality×regime cells the closure test needs (≥5/cell).

## The three gates (each pass/fail; all three must hold)

### Gate 1 — Grounding holds at scale (type-system property)
Run span-native lowering + `validateGrounding` on all 18. **PASS = 100% of explicit nodes transcript-bound,
0 UNGROUNDED_VIOLATION.** This should be 100% by construction; <100% means a paraphrase leak re-entered the
compiler (a regression, localizes to lowering). Cheap; run first. Also record `inference_rate` per video (the
source-content metadata — expect ~30–70%, confirmation-driven).

### Gate 2 — Replay parity (does the compiled IR reproduce the educator's demonstrated entries?)
For each demonstrated trade: run the compiled `runStateMachine` over the REAL OHLC for that window with
engine-computed predicate signals (the engine-attach), and check whether it fires an entry at the educator's
entry **within tolerance** (same direction; entry bar within ±N bars; same zone/level). **PASS = ≥70% of
demonstrated entries reproduced.** Below 70% → the extraction or lowering doesn't capture the entry; the
provenance/grounding machinery localizes which node failed (was the missed entry a grounded node or an
inferred one?). This is the core faithfulness test.

### Gate 3 — Market-coupled segregated P&L (is the edge real, and which layer carries it?)
Run the 18 compiled strategies over the backtest window; tag every trade with `tradeGrounding` +
`analyzeInference.dominant_modality`; feed to `runVerdict(trades, {stratifyBy: "regime"})`. Read:
- **`grounded_vs_inference.verdict`** — does the edge survive on grounded-only trades?
- **`modality.verdict`** — GROUNDED_SIGNAL / PERCEPTUAL_SIGNAL_REAL / STRUCTURAL_SIGNAL_SUSPECT / INFERENCE_NOISE.
- **`closure.kind`** — STRUCTURAL_LAW (signal layer stable across regimes) vs CORPUS_CONDITIONAL.

**PASS = NOT STRUCTURAL_SIGNAL_SUSPECT and NOT INFERENCE_NOISE.** I.e. the measured edge must come from
grounded or faithfully-perceptual layers, not from compiler-imposed structural assumptions or noise.

## The yes/no verdict

| outcome | interpretation |
|---|---|
| G1 ✓ · G2 ≥70% · G3 GROUNDED_SIGNAL or PERCEPTUAL_SIGNAL_REAL | **MISSION VALIDATED** — the system faithfully reproduces the educator's edge; inference is signal, not invention |
| G1 ✓ · G2 ≥70% · G3 STRUCTURAL_SIGNAL_SUSPECT | edge is **compiler-invented** — extraction is faithful but the "edge" isn't the educator's → not a money system, but an honest one |
| G2 < 70% | **extraction/lowering gap** — localized by which nodes the missed trades depended on (grounded miss = extraction; inferred miss = the inference was wrong) |
| G1 < 100% | **compiler regression** (paraphrase leak) — fix lowering, re-run |
| G3 INFERENCE_NOISE | inference adds noise → the perceptual/structural reconstruction is wrong for this corpus |

Crucially, **every failure localizes** (extraction / semantic compilation / execution / engine) via the
provenance + grounding + modality machinery — no black-box "it didn't work."

## Why this is the MINIMUM

- Fewer educators → can't distinguish universal compiler from fitted interpreter (closure untestable).
- Fewer demonstrated trades → Gate-2 parity is anecdote, not measurement.
- No regime diversity → `closure.kind` can't be computed (the STRUCTURAL_LAW vs CORPUS_CONDITIONAL question dies).
- Fewer per-cell trades → modality segregation is underpowered (the operator's ≥5/cell floor).

## What it does NOT claim

A PASS here proves the system **faithfully reproduces what these ~18 educators taught, under replay, with the
edge attributable to grounded/perceptual layers** — a strong, falsifiable result. It does NOT claim universal
trading profitability or that the strategies are live-deployable; those are downstream of (and gated by) the
existing Wave 27.5 promotion gates. This run validates the COMPILER's fidelity + the edge's epistemic origin —
which is exactly the mission ("faithful extraction → executable strategy matching educator intent under replay").

## Readiness

The harness (`runVerdict`) + grounding validator are built + offline-tested. Gate 1 is runnable today on any
unseen transcripts. Gates 2 & 3 need: (a) the stable supervisor to run live extraction at scale, (b) the
engine-attach (real OHLC → predicate signals) for `runStateMachine`. When those exist, this protocol fires and
returns a yes/no — no further construction required.
