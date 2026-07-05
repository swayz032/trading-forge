# OR-Branches Fix — Frozen Baseline ("Before" column)

**Captured 2026-07-05 BEFORE any engine-logic change** (per GPT: freeze the baseline so the before/after
table is provenance-clean and the implementation can't retroactively move the reference). Pure measurement —
no engine files touched to produce this. Engine at HEAD `e2029bc` (Deep-Scan #17 P&L/gate fixes in; the
`or_branches` defect NOT yet fixed).

## Static defect (engine-independent structural fact)
| Metric | Before |
|---|---|
| OR branches extracted (in specs, 108/117 strategies) | **726** |
| OR branches executed by the engine (`or_branches` consumers) | **0** |
| **Composition Conservation Rate (CCR)** = executed / extracted | **0%** |
| OR-alternative condition-ids total (multi-option branches) | 1452 |
| … of which are `role="spine"` (strictly ANDed despite being alternatives) | **576** |
| Strategies with ≥1 spine-role OR-alternative (over-conjoined) | **93 / 117** |

Source: audit of `config.compiled_spec.spec.or_branches` vs `spec_condition_compiler.py`
(`spine_satisfied &= arr`, `grep -rl or_branch src/engine` = 0).

## Behavioral baseline (composition controlled-run instrument — SAME rig the re-run uses)
| Metric | Before |
|---|---|
| SDS (baseline, from increment-2 paired-delta `point_sds_before`) | **2.777** |
| Primary-set strategies (gating-fidelity ≥0.80) | 37 (17 families) |
| Zero-trade strategies — generic-binding baseline | 0 / 37 |
| Zero-trade strategies — native-bundle strict-AND (increment-2 "after") | **10 / 37** |
| Median trades/strategy — generic baseline | 611 (range 47–765) |

Note: the median-trade count reflects the lighter fixed-ATR-bracket measurement instrument (documented in the
composition experiment; never claimed as edge), NOT the full battery — it is used only for distribution
sufficiency and is identical before/after so it cancels.

## The "After" column (to be filled by the OR-branches re-run)
The re-run (`TF_OR_BRANCHES_ENABLED` on vs off, else byte-identical) fills:
- CCR: target ~99% (semantic — should succeed if the implementation is correct, independent of markets).
- Zero-trade rate: prediction ↓ (honoring OR should revive the 10 collapsed strategies — alternatives no longer required simultaneously).
- Median trades, SDS: behavioral falsification (SDS vs pre-registered +0.20, decision once).

**Interpretation guide:** CCR→~99% is the engineering win regardless. If behavior ALSO moves (zero-trades
revive, SDS rises) → execution layer was the primary collapse source. If CCR→~99% but behavior flat → the
defect is real but not the dominant behavioral bottleneck → next audit upstream (extraction/sequencing).
