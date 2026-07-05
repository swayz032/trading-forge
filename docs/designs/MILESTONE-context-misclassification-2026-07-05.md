# MILESTONE — Context Misclassification: Validated Causal Mechanism (frozen 2026-07-05)

**The first mechanism in this project that is BOTH causally supported by intervention AND actionable in the
product.** Frozen as a completed, evidence-backed milestone and the new research baseline. Later investigations
(the residual sub-population) must NOT blur into this record.

## The claim (stated exactly to the evidence — do not overreach)
**Context misclassification is a SUFFICIENT cause for the observed revival in the affected subset, and the
DOMINANT IDENTIFIED cause of the majority of the corpus collapse.** NOT "the root cause" (the 6 resistant
strategies are unexplained by it).

## What "context misclassification" is (the mechanism)
The extractor mis-maps a **discourse-modality** cue (scene-setting, narrative example, UI interaction,
rhetorically-refuted strawman) into an **execution constraint** (a mandatory spine-AND predicate). This is a
linguistic-to-executable **ontology mapping failure** — not a logic error, model error, or metric error. The
engine then faithfully obeys an over-constrained AND-lattice that can almost never be satisfied → near-zero
firing → collapse.

## The intervention chain (each link independently measured)
1. **DRI audit** (`dri-audit-2026-07-05.json`): median DRI 2.79, inflation 53%; CONTEXTUAL the largest inflated type (91/221 conditions mis-typed as gates).
2. **Context-only demotion** cut conjunction depth **12.4 → 7.6 (−38.5%)**; combined **−47.1%**.
3. **Context-only revived 9 of 15 dead strategies**; firing rate **+32%** (6.34 → 8.39 / 100 bars).
4. **Context-only revival set == combined revival set (identical 9 strategies).** The OPTIONAL and ALTERNATIVE interventions contributed **nothing** beyond context for these strategies → **sufficiency**.
5. **OPTIONAL-only revived 0; ALTERNATIVE-only INVALID** (no siblings to OR in-sample).
6. **exec_all == struct_all, 42/42 identical** → the effect is a genuine semantic-structure change, NOT an execution artifact.

All flag-gated (`TF_ROLE_DEMOTION_MODE`, default OFF), 116 tests green, 0 byte-identical violations. Commit `77a72f9`.

## Honest scope note on the SDS metric
The pre-registered SDS "diversity" score returned point +0.66 (85% resamples positive) but a 90% CI that
straddled +0.20 → mechanical verdict FALSIFIER_B. That verdict is NOT used to weaken this milestone, because the
SDS instrument **structurally cannot observe 0→N revivals** (its pairing requires both-sides-traded). The
sufficiency claim rests on the **binary revival + identical-set proof**, which do not depend on SDS. The SDS
question (trading-style diversity among already-active strategies) remains separately open and is NOT part of
this milestone's claim.

## The project state has bifurcated (the biggest structural change)
| | |
|---|---|
| **Problem A — SOLVED (this milestone)** | Context misclassification over-constrains the majority of strategies. Isolated, sufficient, actionable. |
| **Problem B — REMAINING (new, separate)** | **6 strategy instances / 2 concepts** stay dead under *full* demotion: `5m_minute_support_level` ×3, `hammer_candle_long_side` ×3. A different failure mode — do NOT mix with Problem A. |

## Next actions (GPT-sequenced; this doc = the frozen record)
1. **[DONE] Freeze this milestone** as the new baseline.
2. **Extractor fix — context classification** (product change, evidence-justified independently of Problem B): teach extraction/onboarding to NOT promote discourse-modality cues (scene-setting/narrative/UI/refuted-strawman) to spine. The `TF_ROLE_DEMOTION_MODE=struct_ctx` mechanism + the DRI-audit classification are the proven template.
3. **Residual probe on the 2 resistant concepts** — structured, minimal-guessing sequence: (a) extraction audit (are remaining mandatory conditions transcript-supported? residual inflation?), (b) execution trace (which condition first blocks entry? always the same?), (c) temporal audit (do individually-satisfiable conditions fail on ordering/timing?), (d) concept audit (does the concept require state/history the representation can't express?). Determines whether Problem B is interaction/sequencing (GPT Layer-2) or concept-specific.
