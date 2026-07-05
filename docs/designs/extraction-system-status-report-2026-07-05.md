# Trading Forge — Extraction/Execution System Status Report (2026-07-05)

*Handoff brief for a fresh reasoning agent. Scoped-claim discipline throughout: every quantitative
result is stated relative to Corpus v2 / the specific battery / engine version / data snapshot — never
generalized to "YouTube strategies" writ large.*

---

## 1. What the system is

A pipeline that turns trading-educator YouTube videos into **executable, backtestable strategies** with
full provenance — then validates them statistically. Unlike the common "video → LLM summary → backtest"
shortcut, it preserves semantics through an explicit chain:

```
Video → Transcript → Decision extraction → Decision graph → Compiler
      → Executable spec → Engine → Traceable trade → Transcript provenance
      → Statistical validation → Mode A/B (overlay) comparison → Corpus analytics
```

Each arrow has a verification artifact (Ledgers A–G for conservation; interpreter parity TS==Python;
per-trade provenance back to the educator's verbatim words).

---

## 2. Current corpus — "Corpus v2" (the named research baseline)

- **40 educator videos → 117 CANDIDATE strategies** (each concept fanned ×3 markets MES/MNQ/MCL) + 3 parked.
- Tagged `config.metadata.corpus_version = "v2-2026-07-04"`; full provenance (engine + data + overlay + corpus).
- **v1 → v2 was a *correction*, not a re-extraction.** Two onboarding-contract bugs were fixed in place:
  - **Timeframe**: all 120 strategies had been silently defaulted to 5m; recovered each educator's real
    timeframe (15m/4h/1m/1h/30m), fail-loud quarantine for the unrecoverable.
  - **Direction**: 75 strategies the educators taught "both ways" had their short side silently amputated
    to long-only; restored.
- Data snapshot: 2015-08 → 2026-03 (ES/NQ/CL ratio-adjusted; cache has 5m/15m/1h/daily).

---

## 3. What is PROVEN / mature

- **Compiler + verification pipeline are mature enough that execution fidelity is now the limiting factor.**
  (Not "the compiler is solved" — it names the bottleneck from evidence.) 40/40 compiler executions behaved
  correctly; 39 produced runnable strategies, 1 correctly quarantined, 0 fabricated.
- **The gate battery is calibrated and selective.** Null calibration: 100 random strategies through the full
  battery (WF/CPCV/PBO/DSR/B14) → **full-battery false-pass 0/100.** A real pass is meaningful.
- **The overlay (risk framework) is a risk-shaper, not an edge-adder — keep FROZEN.** Mode A vs B on Corpus v2:
  positive-Sharpe strategies 21/47 raw → 5/47 with overlay (it over-filters). Confirmed prior evidence.

---

## 4. THE CENTRAL FINDING — Execution Fidelity Score

`scripts/corpus-fidelity-score.py` (pure; scores each strategy's binding plan):
`fidelity = (faithful_spine + 0.5·approximated_spine) / spine_total`.

- **All 117 strategies score ≤ 0.54 (median 0.44). None reach high fidelity.**
- **85% of spine steps are bound — but 96.6% of bindings are APPROXIMATIONS; only ~3% are native evaluators.**
- Mechanism: the binding compiler is **object-blind** — every `WAIT_STRUCTURE` routes to one generic
  `structure_engine` regardless of whether the object is FVG, order-block, VWAP, sweep, MSS. So distinct
  educators bind to the *same* generic primitives → collapse to identical behavior.
- **Consequence, measured:** 47 scored strategies produce only **17 distinct behavioral outcomes** (recurring
  "~8 trades in a decade"). No demonstrable edge (best Sharpe 0.50, median −0.27) — but that number is
  *downstream* of the fidelity collapse, not an independent verdict on the ideas.

**Key reframing:** this is not a low-fidelity *extractor*. It is a high-fidelity extraction system feeding a
**low-resolution execution lens.** The failure is **loss of object identity during binding compilation** —
a dispatch problem, not a missing-detector problem (native FVG/sweep/VWAP/MSS/OB logic already exists in the
engine; the binding layer just doesn't route to it).

---

## 5. The research program (falsifiable, leading-indicator-driven)

Success is NOT "find a profitable strategy." It's watching *process* metrics move, in causal order, before
outcome metrics mean anything:

| Leading indicator | Today | Direction |
|---|---|---|
| Native evaluator coverage | ~3% | ↑ |
| Approximation rate | ~97% | ↓ |
| Median execution fidelity | 0.44 | ↑ |
| **Distinct behavioral signatures** | **17 / 47** | **→ 47/47 (leading indicator)** |

**Falsifiable hypothesis:** *if execution fidelity increases, distinct strategies exhibit increasingly
distinct behavior.*
- **Supports:** native coverage ↑ → signatures diverge → educators stop collapsing.
- **Refutes (Prediction 2):** coverage ↑ but signatures stay clustered → fidelity is NOT the dominant
  bottleneck → stop adding evaluators, investigate upstream (extraction over-compression / normalization /
  execution model). *Both outcomes are real results.*

---

## 6. FIRST fidelity experiment — FVG identity dispatch (JUST COMPLETED)

Single-variable controlled experiment (spec: `docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md`):
restore identity for ONE object family (FVG) via a **fresh, isolated** 3-candle detector (`fvg_native.py`,
AST-proven to import no engine context — guards against "moving the collapse one layer down"). Measured with a
**Signature Divergence Score (SDS = mean inter-family distance / mean intra-family distance)** over
entry-time / holding / per-trade-R distributions (Wasserstein + cosine + KS), with **bootstrap 90% CI +
resampling stability** (small-N guard, n≈18–39).

**RESULT: Prediction 2 fired — fidelity rose, SDS did NOT move.**
- Fidelity 0.443 → 0.467 (real, on only+all FVG strategies); non-FVG byte-identical.
- SDS paired-delta 90% CI = **[−0.0057, +0.0016] — includes zero.** 28% of resamples rose. No behavioral separation.
- **Root cause (found empirically, not assumed):** strategies are **AND-chains** of many spine conditions,
  most still generic. The conjunction is gated by whichever condition is *rarest-true* — almost never the FVG
  one. Only 6/33 strategies changed at all (2–5 bars). **Restoring one condition's identity is invisible when
  it's ANDed with several still-generic conditions that gate tighter.**
- All flag-gated (`TF_FVG_IDENTITY_ENABLED`, **default OFF** — zero production change); 75 new tests green;
  reusable SDS harness (`scripts/signature-divergence.py`) + FVG detector retained.

**Refined conclusion:** fidelity is still necessary, but **the unit that matters is the strategy's whole
conjunction, not one condition.** Single-object-at-a-time is the wrong granularity — building sweep/MSS/VWAP
one at a time would reproduce the same flat SDS.

---

## 7. THE OPEN DECISION (what the fresh agent should weigh in on)

Per the decision gate, we do NOT expand one-object-at-a-time. Two candidate next steps:

1. **Composition experiment (leaning toward this):** restore identity to *several* of a strategy's conditions
   at once (FVG + sweep + bias + confirmation) for a handful of strategies, re-measure SDS. Direct test of the
   AND-chain diagnosis: does *aggregate* conjunction fidelity move behavior even when single-object doesn't?
   Reuses the SDS harness + detectors already built. If SDS *still* doesn't move at high conjunction fidelity,
   Prediction 2's deeper causes are confirmed and we stop chasing evaluators.
2. **Upstream investigation:** the compiler shares one cached generic array across multiple conditions
   (`spec_condition_compiler.py`), and extraction may over-compress distinct concepts. These could be a
   structural collapse source *beneath* the binding layer.

**Question for the agent:** is the composition experiment the right next falsification, or should we
characterize the AND-chain / caching / extraction-compression structure first before spending more evaluator
effort? What would make the composition experiment's negative result *conclusive* rather than "not enough
conditions restored"?

---

## 8. Key artifacts

- Baseline + roadmap + hypothesis: `docs/designs/corpus-v2-baseline-2026-07-04.md`
- Fidelity metric: `scripts/corpus-fidelity-score.py` → `docs/replay-results/corpus-fidelity-2026-07-04.json`
- Approximation inventory (what to build, by breadth): `scripts/corpus-approximation-inventory.py` → `...approximation-inventory-2026-07-04.json`
- SDS harness (reusable): `scripts/signature-divergence.py`
- Fresh FVG detector: `src/engine/indicators/fvg_native.py`
- FVG experiment spec + result data: `docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md`, `docs/replay-results/fvg-experiment-*.json`
- Mode A/B: `scripts/full-battery-mode-ab.py` → `docs/replay-results/mode-ab-corpus-v2-2026-07-04-report.json`
- Null calibration: `scripts/null_gate_calibration.py` → `docs/replay-results/null-calibration-corpus-v2-2026-07-04-report.json`
- Binding compiler (the object-blind dispatch): `src/engine/spec_family_bindings.py`

All committed to branch `hardening/phase-0`.
