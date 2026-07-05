# Corpus v2 — Research Baseline (2026-07-04)

**Named, frozen research baseline for the spec-onboarded strategy corpus.** Every backtest,
Mode A/B run, corpus-FDR report, or paper that draws on these strategies should cite
**Corpus v2** so the evidence chain (engine version + data snapshot + overlay hash +
**corpus baseline**) is complete and reproducible.

Programmatic tag: every row carries `config.metadata.corpus_version = "v2-2026-07-04"`
(`source='spec_onboarding'`, 120 rows). Query: `config->'metadata'->>'corpus_version' = 'v2-2026-07-04'`.

---

## Versions

| Version | State | Use |
|---|---|---|
| **Corpus v1** | Pre-fix (all `timeframe=5m`; 75 certified-`both` strategies coerced long-only) | **ARCHIVED — not for research.** Any backtest generated before 2026-07-04 against these rows is invalid (wrong charts + amputated direction). |
| **Corpus v2** | Timeframe corrected + direction corrected + quarantines preserved | **RESEARCH BASELINE.** |

**v1 → v2 is a correction of two onboarding-contract defects, NOT a re-extraction.** The
certified compiler artifacts (`corpus/specs/*.spec.json`, gate-passed + Ledger-conserved +
provenance-stamped) are unchanged. Only the DB projection of those specs was corrected,
in place (row IDs preserved, every change audited + reversible).

## Corrections applied (v1 → v2)

| Fix | Commit | Effect |
|---|---|---|
| Timeframe integrity | `c7a2c0d` + backfill | Recovered each educator's real exec/higher timeframe from the certified spec; fail-loud quarantine, never a silent 5m default. 42 corrected, 39 genuine-5m, 39 quarantined. |
| Direction-both restoration | `7498230` (guard) + `d810f81` (backfill) | Un-amputated the short side on 75 handler-driven `direction:"both"` strategies coerced long-only by a stale framework-overlay exemption. Shared `isHandlerDrivenEntry()` helper; the 3 parked rows correctly excluded. |
| Corpus versioning | this doc + `corpus_version` stamp | Named the baseline; completes the provenance chain. |

## v2 composition (120 rows = 40 videos × 3 markets)

- **Lifecycle:** 117 CANDIDATE + 3 NEEDS_ARCHETYPE (quarantined).
- **Timeframe:** 5m×78 (39 genuinely-5m + 39 recovery-unresolvable, flagged not guessed), 15m×15, 4h×9, 1m×9, 1h×6, 30m×3.
- **Direction:** both×75, long×36 (33 genuine + 3 parked), short×9. Zero silent coercions.

## Compiler / reader honesty statement

- **40/40 compiler executions behaved correctly** — 39 produced executable strategies, 1 was
  correctly rejected for human review, **0 fabricated.**
- The 39 satisfy current production acceptance criteria and are promoted; the 1 failed them and
  is quarantined. Reader (gemma) accuracy ≈ 97.5% here (documented ~91–93% coverage baseline) —
  production-grade means "never ships what it can't stand behind," not "perfect on every video."

## Quarantine / regression benchmark

**`aHLIE_TXjpo`** (`entry_chart_timeframe_{mes,mnq,mcl}`, NEEDS_ARCHETYPE) — the one weak read.
Failure mode: *the reader over-weighted the video's timeframe discussion and elevated
"chart timeframe / timeframe selection" into the spine, burying the real 4h-candle-close setup,
so the condition-compiler could not bind enough executable logic → parked, not faked.*

**Treatment (do NOT block the pipeline):** targeted re-extraction of this single video is a
roadmap item; it is retained as a **regression benchmark**. Promote a future reader improvement
ONLY if it correctly extracts `aHLIE_TXjpo` **without** regressing the other 39.

## Reporting discipline (claim scoping — MANDATORY for every result)

Tie every conclusion to the evidence; never overgeneralize. The baseline exists so claims stay
falsifiable and reproducible.

- **Correct:** *"Under Corpus v2, this validation battery, engine version `<v>`, and market-data
  snapshot `<hash>`, N of M compiled strategies satisfied the current acceptance criteria."*
- **Wrong:** *"X% of YouTube strategies work."* (untethered from corpus/battery/engine/data; overgeneralized).
- **Uncertainty:** a `0/100` null result is *"≤ ~3.6% at 95% confidence,"* not *"exactly 0%."* Report
  observed rate + confidence bound, never a point estimate as if it were the true rate.
- Always name: corpus_version, battery/gate set, engine version, data snapshot hash. A result without
  its scope is not a result.

Noise-floor reference (this baseline): full-battery false-pass **0/100 nulls** (N=100, seed=42) —
`docs/replay-results/null-calibration-corpus-v2-2026-07-04-report.json`. DSR/WRC/SPA/B14 each 0% on
nulls; wf_cpcv (67%) + PBO (81%) permissive alone but AND-stacked to 0. Battery validated selective.

## First measurements (done)

- **Null calibration** (`docs/replay-results/null-calibration-corpus-v2-2026-07-04-report.json`): full-battery
  false-pass **0/100** — battery validated selective.
- **Mode A vs Mode B** (`docs/replay-results/mode-ab-corpus-v2-2026-07-04-report.json`): 47/78 scored
  (31 unscorable, data quality). Of 47: 38 HURTS / 9 HELPS-EDGE; positive raw Sharpe 21/47 → overlay 5/47
  (over-filters). **No demonstrable edge** (best 0.50, median −0.27). Overlay confirmed a risk-shaper,
  not edge-adder — **keep it FROZEN.**
- **★ Execution Fidelity Score** (`scripts/corpus-fidelity-score.py`, report
  `docs/replay-results/corpus-fidelity-2026-07-04.json`): **ALL 117 ≤ 0.54, median 0.44.** Spine steps 85%
  bound BUT **96.6% of bindings are approximations** — only ~3% native evaluators. Distinct educators
  (VWAP/FVG/order-block/supply-demand) all bind to the same generic primitives → collapse to identical
  ~8-trades/decade behavior → indistinguishable + edgeless. **This is the dominant bottleneck, quantified:
  the corpus can't reveal edge because it isn't executing the educators' actual methods.**

## Next (evidence-driven roadmap — fidelity FIRST, overlay LAST)

1. **Execution fidelity** — raise fidelity by building NATIVE evaluators for the educators' actual concepts
   (VWAP reclaim, FVG, order block, supply/demand, sweep+reclaim) instead of the generic BOS/CHoCH proxy.
   Track the Execution Fidelity Score per strategy (Wave C / Fidelity Verdict productionizes it — persist +
   expose + quarantine low-fidelity backtests as inadmissible). *This is the point where distinct strategies
   will spread out instead of clustering.*
2. **Data completeness** — fix intraday/MCL `ratio_adj` gaps (31/78 unscorable) so the scored sample ≈ 78.
3. **Corpus re-run** — re-run Mode A/B once strategies execute faithfully AND are fully scorable.
4. **Overlay evaluation** — only meaningful after fidelity; overlay stays FROZEN until then.
5. **Portfolio construction** — from the survivors, later.

NOT: optimize the overlay / tune thresholds / add filters. Those come much later, if ever.

## Project phase model (evidence-based)

| Phase | Question | Status |
|---|---|---|
| 1 — Extraction | Can we recover what the educator taught? | Largely demonstrated |
| 2 — Conservation | Can we preserve semantics through compilation? | Demonstrated (Ledgers A–G) |
| **3 — Faithful execution** | Does the engine execute those semantics vs approximations? | **CURRENT dominant bottleneck** |
| 4 — Strategy research | Which strategies have durable edge? | Premature until Phase 3 improves |

**Precise claim (not "the compiler is solved"):** *the compiler and verification pipeline are mature
enough that execution fidelity is now the limiting factor.* Names the bottleneck from evidence; does not
imply nothing is left to improve.

## Definition of success for Phase 3 (what to watch, NOT "find a profit")

Success is these metrics moving on re-runs — **not** a single profitable strategy:

| Metric | Today (Corpus v2, 2026-07-04) | Target direction |
|---|---|---|
| Native evaluator coverage | ~3% | much higher |
| Approximation usage | ~97% | much lower |
| Median execution fidelity | 0.44 | substantially higher |
| **★ Distinct behavioral signatures** | **17 / 47** | **→ 47 / 47** |

**The leading indicator is distinct behavioral signatures.** As native evaluators replace generic proxies,
different educators should produce increasingly DISTINCT trade behavior (signatures approach n/n). If
fidelity rises but signatures DON'T diverge, that signals another bottleneck downstream of execution —
investigate before continuing. Only after fidelity ↑ **and** behavior diversifies should edge improvements
be trusted as evidence about the educators' ideas rather than the engine's approximations.

See [[project_onboarding_leak_hunt_direction_fix_2026_07_04]], [[project_timeframe_integrity_fix_2026_07_03]],
[[project_layer4_research_conveyor_2026_07_02]].
