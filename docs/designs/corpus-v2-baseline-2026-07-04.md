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

## Next (evidence generation — sequence)

1. **Null-strategy calibration** — establish the battery's false-pass noise floor
   (`TF_ALLOW_FIXED_1=true PYTHONPATH=. python scripts/null_gate_calibration.py --n 100 --seed 42`).
2. **Corpus Mode A vs Mode B** on Corpus v2 (raw vs overlay).
3. **Overlay attribution** on Corpus v2.
4. **Only then** onboard additional strategies (growing the corpus after the baseline is calibrated).

See [[project_onboarding_leak_hunt_direction_fix_2026_07_04]], [[project_timeframe_integrity_fix_2026_07_03]],
[[project_layer4_research_conveyor_2026_07_02]].
