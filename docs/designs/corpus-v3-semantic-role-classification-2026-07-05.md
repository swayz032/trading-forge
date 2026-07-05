# Corpus v3 — Bidirectional Semantic Role Classification (DESIGN, 2026-07-05)

**Status:** design for review (operator approved Hybrid classifier). The first change that touches the whole
extraction pipeline — design-first, parity-gated. Scope = role classification ONLY. Layer-2 stateful execution
(Track #26) is explicitly OUT of scope.

## Objective
Fix the extractor so each `entry_conditions[]` element gets the CORRECT role (`spine` / `confluence` /
`or_branch` / dropped) by its **semantic gate-strength**, not by graph topology. Bidirectional: fix both
over-promotion (context → spine, Problem A) and under-assignment (real gates → confluence, Problem B1). Produces
**Corpus v3** (v1 baseline → v2 corrected onboarding → v3 discourse-role-aware).

## Root cause (from the code map)
Two stages in the `.claude/worktrees/extraction-100/` pipeline:
1. **Discourse filter (LLM):** `scripts/atomize-transcript.ts:40-80` — gemma `is_decision` + 11-value classification. Context that slips through as `decision_bearing` leaks Problem A in.
2. **Role assignment (topology heuristic, NO semantics):** `src/server/lib/graph-to-engine.ts:86` —
   `role: inAndGroup.has(a.id) ? "confluence" : "spine"`. A condition is a hard `spine` gate purely for
   NOT being adjacent to same-rank neighbors. **This is the B1 root:** a genuine multi-part entry trigger is
   clustered into an AND-group → demoted to `confluence` → spine left empty.

## Design — replace topology with semantic gate-strength (Hybrid classifier)
New function `classifyGateStrength(atom) → {mandatory | optional | alternative | contextual}`, mapped:
`mandatory → spine · optional → confluence · alternative → or_branch · contextual → **role=context (RETAINED, non-gating, engine-ignored)**`.
**Faithfulness invariant (Fable-5 review):** `contextual` is NEVER dropped/silenced at extraction — the clause
the educator spoke stays in the spec with a non-gating `context` role so the provenance receipt survives and a
future re-audit can re-adjudicate margin calls WITHOUT re-running extraction. Same execution behavior (engine
ignores `context`), complete faithful record.

**Hybrid rule order (deterministic-first, LLM-margin):**
```
1. CONTEXT_LANG (scene-setting / narrative example / refuted-strawman / UI-artifact)  → contextual → CONTEXT (retained, non-gating)
2. type==WAIT_CONFIRMATION and MANDATORY_LANG ("wait for","must","only enter","need to see") → mandatory → SPINE
3. ALT_LANG ("or","either…or","any of")                                               → alternative → OR_BRANCH
4. clear OPTIONAL_LANG ("ideally","helps","bonus","even better")                       → optional → CONFLUENCE
5. type∈{WAIT_STRUCTURE,WAIT_BIAS} with MANDATORY_LANG                                 → mandatory → SPINE
6. AMBIGUOUS (none clear)  → gemma adjudicates with the DRI taxonomy in the prompt     → its label
```
Language pattern lists are seeded from the DRI audit's per-condition quotes (the CONTEXTUAL/OPTIONAL/ALTERNATIVE/
JUSTIFIED_MANDATORY examples). `graph-to-engine.ts:86` reads `gate_strength` instead of `inAndGroup`. Graph
topology (adjacency) is retained ONLY as a secondary tiebreaker inside the ambiguous branch, never as the
primary role signal.

## Where it lives (touch-points, all in `.claude/worktrees/extraction-100/` unless noted)
| Concern | File |
|---|---|
| New `classifyGateStrength()` + language-pattern tables | new `src/server/lib/gate-strength.ts` |
| Role assignment reads gate-strength | `src/server/lib/graph-to-engine.ts:76-89` |
| Discourse filter tightened (defense-in-depth for clearest context) | `scripts/atomize-transcript.ts:40-80` |
| Atom type vocabulary (unchanged, referenced) | `src/server/lib/decision-atom.ts` |
| Spine densification interaction (must not re-inflate) | `src/server/lib/spine-density.ts` |

**Flag-gated:** `TF_SEMANTIC_ROLE_CLASSIFIER` (default OFF) so the old topology heuristic and the new semantic
classifier can be A/B'd before flip. Byte-identical when OFF.

## Validation (gates, all must pass before flip — Fable-5-tightened)
**Gate ordering (Fable-5 review #5): Gate 2 lands FIRST**, before the classifier build, so the classifier's
first baseline is cut against a parity gate that already validates `entry_conditions[].role`. Sequence:
land Gate 2 → cut baseline → build classifier → Gates 1 & 3.

2 (FIRST). **Parity gate extended:** add `entry_conditions[].role` validation to `scripts/wave26-gemma4-smoke-test.ts`
   (today it only checks speaker_concept role — a different field). Land + green on the v2 baseline BEFORE the
   classifier exists. Prompt/atomizer changes must still pass `--parity-only` minimal-shape + `--legacy-parity`.

1. **Gold-label agreement — STRATIFIED + HELD-OUT (Fable-5 review #2, circularity fix):** the deterministic
   rules are seeded from DRI quotes → the gold set is IN-SAMPLE for the rule component, so a naive 85%-aggregate
   overstates generalization AND can be won by nailing easy rule-covered cases while coin-flipping the margin.
   - **Held-out split:** randomly partition the 221 DRI-labeled conditions into a **rules-design set (70%)** —
     the ONLY conditions allowed to inform the deterministic pattern lists — and a **held-out test set (30%)**
     never seen during rule design. Report agreement on the **held-out 30% only**.
   - **Stratify** the held-out agreement into **rule-covered** vs **gemma-adjudicated (margin)** strata; report both.
   - **PRE-REGISTERED floors (fixed before first run):** held-out overall **≥ 85%**; **margin stratum ≥ 60%
     AND strictly > the majority-class baseline of that stratum** (must beat the ambiguity baseline, not just
     inherit it). Below either floor → Gate 1 FAILS.
   - **Scoped claim:** report as "agreement on the held-out DRI-audited slice," NOT "classifier accuracy."
   - New test `src/server/lib/__tests__/gate-strength.test.ts`.

3. **End-to-end revival proof — BIDIRECTIONAL (Fable-5 review #3):** a promotion fix both revives dead strategies
   AND can correctly kill over-permissive ones; the gate must distinguish fidelity-correct kills from bugs.
   Re-onboard the 14 audited concepts with the classifier ON (in the pinned shadow namespace), backtest vs the
   v2-under-`struct_ctx` control, and measure BOTH directions:
   - **Revival criterion (PRE-REGISTERED):** ≥ **8 of 9** strategies that revived only under
     `TF_ROLE_DEMOTION_MODE=struct_ctx` now trade with the flag OFF; a single miss is allowed ONLY with an
     audited mechanistic explanation. AND `5m_support_level`'s spine is NON-EMPTY.
   - **Regression clause (PRE-REGISTERED):** every strategy that traded in the v2 baseline and goes to ZERO
     under v3 MUST have an audited mechanistic explanation — a specific promoted `spine` condition with a
     transcript-anchored justification (= a correct fidelity kill). **Zero UNEXPLAINED regressions permitted;
     any unexplained new death FAILS the gate.**
   Proven end-to-end iff extraction reproduces the engine-level revival without the runtime override AND every
   behavioral change (both directions) is mechanistically accounted for.

## Rollout
Build in the `extraction-100` worktree (isolated per §11b). Land Gate 2 → Gates 1 & 3 → flip
`TF_SEMANTIC_ROLE_CLASSIFIER=true` → re-onboard the full corpus → stamp `config.metadata.corpus_version="v3-2026-07-…"`.

**Shadow-namespace PINNING MANIFEST (Fable-5 review #1) — mandatory for the Gate-3 paired experiment:** the
`v3-shadow-<date>` namespace MUST pin everything except the classifier flag, else a pass/fail is confounded and
the decisive experiment is burned. Record + hold identical to the v2-under-`struct_ctx` control:
- data snapshot id (same OHLCV cache / S3 keys), engine commit SHA, battery config, seed, symbol set + timeframe.
- provenance-stamp every shadow row `corpus_version="v3-shadow-<date>"` + `engine_sha=<sha>`.
Only `TF_SEMANTIC_ROLE_CLASSIFIER` differs between control and treatment.

Preserve: provenance guarantees, existing parity gates, backward-compat (v2 specs still readable). The 2
directional bug fixes + this = the fully-corrected extraction → full re-baseline (null-cal → Mode A/B) as Corpus v3.

## Explicit non-goals
- **NOT** Layer-2 stateful/sequential execution (Track #26 — separate architecture initiative). `hammer_candle`
  stays dead after this fix by design; that's B2, not this.
- **NOT** re-opening the execution-layer investigations (frozen, `1ab7321` / `240c933`).
- **NOT** changing the DRI taxonomy or the frozen findings.

## Operator decision (Fable-5 resolved the method; operator confirms)
Gate 3 re-onboards the 14 concepts (mutates DB rows). **Advisor recommendation (Fable 5): (a) scratch/shadow
namespace + the pinning manifest above.** Rationale: the revival proof is a PAIRED experiment whose control arm
is v2-under-`struct_ctx`; in-place re-onboarding mutates the control mid-experiment → any discrepancy becomes
unattributable → the decisive experiment is burned. (a) keeps v2 the clean live baseline until v3 is fully proven.
**Operator: confirm (a) + pinning manifest (recommended) vs (b) in-place.** This is the only decision blocking the
implementation-plan step.
