# Hard-Constraint Demotion Experiment (Semantic Role Reclassification Intervention) — PRE-REGISTERED

**Status:** pre-registered (operator + GPT, 2026-07-05). The falsification the DRI audit triggered.

## What is conclusively established (going in)
- Execution layer is substantially de-risked: OR-defect (real, not dominant), directional bugs (fixed), P&L/gate (#17). Correct execution of correct logic did NOT resolve the collapse (27/30 dead strategies persist).
- **Extraction over-specification CONFIRMED** (DRI 2.79, inflation 53%): the extractor mis-types discourse functions — scene-setting/narrative/UI-artifact/refuted-strawman cues become mandatory spine-AND conditions. The educator gates on ~3; the extractor emits ~8. This is a **semantic-role-labeling failure**, not a modeling failure.

## The question (sharpened)
NOT "does the system improve?" — **"Is semantic-role compression (mis-typing discourse functions as hard gates) the ROOT constraint bottleneck behind the corpus collapse?"**

## The structural bug this targets
The compiler collapses THREE distinct discourse functions into one `spine AND` node:
| True role | Currently | Should be |
|---|---|---|
| Optional confluence ("ideally", "helps") | hard AND gate | soft factor (entry_quality), not gating |
| Alternative route ("A or B") | hard AND gate | OR-branch (any-holds) |
| Context / scene-setting / narrative / UI-artifact / refuted-strawman | hard AND gate | NOT an entry gate at all (drop from gating) |

## THREE isolated transformations (each run SEPARATELY, then combined — for attribution)
Demotions are DETERMINISTIC, sourced from the committed `docs/replay-results/dri-audit-2026-07-05.json` per-condition classification (evidence-backed, not re-judged):
- **T1 — Gate→Confluence:** conditions classed `OPTIONAL` → demote spine→confluence (leave entry_quality, remove from spine AND).
- **T2 — Gate→Alternative:** conditions classed `ALTERNATIVE` → route into or_branches (any-holds) instead of AND.
- **T3 — Gate→Context:** conditions classed `CONTEXTUAL` (incl. UI-artifact / refuted-strawman) → remove from entry-gating entirely.
- `JUSTIFIED_MANDATORY` → UNCHANGED (never demoted — the real gates stay). `UNRESOLVED` → held OUT of the primary demotion set (conservative), reported as a separate sensitivity arm.
Runs: **{baseline, T1-only, T2-only, T3-only, T1+T2+T3}** on the same strategies/rig/seed, flag-gated (`TF_ROLE_DEMOTION_MODE`), default OFF, non-demoted conditions byte-identical.

## Causal DAG (so a null is unambiguous)
```
role demotion → hard-conjunction depth ↓ → (a) trade frequency ↑ → zero-trade revival ↑
                                          → (b) behavioral diversity ↑ → SDS ↑
```
Every arrow is measured. A break in any arrow localizes the failure.

## PRE-REGISTERED decision (fixed before looking; applied ONCE)
Primary metric per the DAG, on the combined T1+T2+T3 arm vs baseline:
- **Mediator check (must hold or the intervention didn't fire):** hard-conjunction depth ↓ materially (report mean depth before/after).
- **DOMINANT CONFIRMED** iff: **zero-trade revival ≥ 50%** of baseline-dead strategies AND median trade frequency ↑ ≥ 2× AND SDS paired-delta 90% CI entirely **> +0.20** (reuse the pre-registered SDS instrument + floor ≥15 strategies/≥5 families).
- **NOT DOMINANT (the meaningful falsifier)** iff: conjunction depth ↓ materially (intervention fired) BUT zero-trade revival < 20% AND SDS CI includes/below +0.20 → **over-specification is real but NOT the dominant behavioral cause** → the bottleneck is **constraint INTERACTION semantics** (temporal/state coupling, evaluation ordering — WAIT_RETEST sequencing, stateful-treated-as-instantaneous) → that becomes the next phase.
- **INCONCLUSIVE** otherwise / below floor.
- **Attribution (secondary):** compare T1/T2/T3-only arms → which discourse-mis-typing drives the effect. Actionable extractor-fix priority.

## Scope + purity
Semantic-role reassignment ONLY (role field per the audit map), flag-gated default OFF, single-variable per arm, non-demoted conditions byte-identical (prove corpus-wide). Reuse `signature-divergence.py` + the controlled-run rig + paired-delta. Same instrument as increments 2–3 (comparable). Fresh corrected engine (#17 + direction + OR fixes). No new evaluators. Do NOT commit until reviewed.

## Why this design can FAIL meaningfully
If demotion drops conjunction depth (DRI-effect confirmed) yet the dead strategies stay dead and SDS stays flat, the count of constraints was never the issue — the **interaction/ordering** of constraints is. That would eliminate the entire "how many conditions" class of hypotheses and pivot to constraint-coupling semantics — a different, well-defined next phase. Either outcome is a clean, publishable result.

## Open refinement (offered by GPT — optional next tightening)
A formal causal-DAG diagram + exact demotion-rule table per misclassification subtype can be layered in before dispatch if we want the null result to be even more surgical; the above is sufficient to run.
