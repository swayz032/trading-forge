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
`mandatory → spine · optional → confluence · alternative → or_branch · contextual → drop (metadata)`.

**Hybrid rule order (deterministic-first, LLM-margin):**
```
1. CONTEXT_LANG (scene-setting / narrative example / refuted-strawman / UI-artifact)  → contextual → DROP
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

## Validation (three gates, all must pass before flip)
1. **Gold-label agreement:** run `classifyGateStrength` on the 221 DRI-labeled conditions (`dri-audit-2026-07-05.json`,
   which carry ground-truth class + quote). **Target ≥ 85% agreement** with the gold labels (above the 57.7%
   human-margin floor by design; the deterministic clear-cases should be ~100%, LLM carries the margin).
   New test `src/server/lib/__tests__/gate-strength.test.ts`.
2. **Parity gate extended:** add `entry_conditions[].role` validation to `scripts/wave26-gemma4-smoke-test.ts`
   (today it only checks speaker_concept role — a different field). Prompt/atomizer changes must still pass the
   existing `--parity-only` minimal-shape check + `--legacy-parity`.
3. **End-to-end revival proof (the decisive one):** re-onboard the 14 audited concepts with the classifier ON,
   backtest, and confirm the demotion result reproduces AT SOURCE: the 9 strategies that revived only under
   `TF_ROLE_DEMOTION_MODE=struct_ctx` now trade with the flag OFF (roles correct at extraction), AND the B1
   concept `5m_support_level` now has a NON-EMPTY spine. If the extraction fix reproduces the engine-level
   demotion revival without the runtime override, the fix is proven end-to-end.

## Rollout
Build in the `extraction-100` worktree (isolated per §11b). Validate the three gates → flip
`TF_SEMANTIC_ROLE_CLASSIFIER=true` → re-onboard the full corpus → stamp `config.metadata.corpus_version="v3-2026-07-…"`.
Preserve: provenance guarantees, existing parity gates, backward-compat (v2 specs still readable). The 2
directional bug fixes + this = the fully-corrected extraction → full re-baseline (null-cal → Mode A/B) as Corpus v3.

## Explicit non-goals
- **NOT** Layer-2 stateful/sequential execution (Track #26 — separate architecture initiative). `hammer_candle`
  stays dead after this fix by design; that's B2, not this.
- **NOT** re-opening the execution-layer investigations (frozen, `1ab7321` / `240c933`).
- **NOT** changing the DRI taxonomy or the frozen findings.

## Open question for review
The end-to-end revival proof (gate 3) requires re-onboarding the 14 concepts — which mutates DB rows. Options:
(a) re-onboard into a scratch/shadow namespace for the proof, keep v2 live until full-corpus flip; or
(b) re-onboard in place with the flag, reversible via the v2 backfill pattern. **Recommend (a)** — keeps v2 the
clean baseline until v3 is proven, matching the "don't contaminate the baseline" discipline used throughout.
