# Hard-Constraint Demotion Experiment — FORMALIZED v2 (PRE-REGISTERED, dispatch-grade)

**Status:** pre-registered, GPT-tightened v2 (operator + GPT, 2026-07-05). A **causal attribution** experiment —
NOT a behavior tweak. Answers exactly one question: **is the corpus collapse driven by constraint INFLATION
(count) or by constraint INTERACTION (temporal/state/ordering) semantics?**

## Established going in
Execution layer substantially de-risked (OR, direction, P&L fixed — none dominant). Extraction
over-specification CONFIRMED (DRI 2.79, inflation 53%): extractor mis-types discourse functions as hard gates
(a semantic-role-labeling failure). This experiment tests whether correcting that mis-typing behaviorally
resolves the collapse.

## 1. Classification — mutual-exclusive, deterministic, evidence-anchored
Each spine condition maps to **exactly one** class. **Source = the committed `docs/replay-results/dri-audit-2026-07-05.json`**
single-label classification (already mutually exclusive, already quote-anchored — do NOT re-judge). Classes:
| Audit class | Role | Intervention |
|---|---|---|
| `JUSTIFIED_MANDATORY` | real GATE | **KEEP** (never demoted) |
| `ALTERNATIVE` | either/or route | Arm-ALT |
| `OPTIONAL` | soft confluence | Arm-CONF |
| `CONTEXTUAL` (incl. UI-artifact, refuted-strawman) | not a gate | Arm-CTX |
| `UNRESOLVED` | uncertain | **HELD OUT** of primary; separate sensitivity arm |

**Tie-break (already applied in the audit, restated for provenance):** precedence GATE > ALTERNATIVE > OPTIONAL >
CONTEXTUAL, **OVERRIDE:** any transcript negation / pedagogical refutation → **CONTEXTUAL** regardless.
Every assignment carries its verbatim transcript quote (from the audit) — reproducible, not vibes.

## 2. Demotion operators — STRUCTURAL vs EXECUTION (never mixed in one run)
**PRIMARY = STRUCTURAL** `D_struct(node, class)` — alters graph topology, THEREFORE changes conjunction depth
(the DAG mediator this experiment is built to move):
- ALTERNATIVE → merge into an OR_GROUP node (ANY-holds); depth ↓.
- OPTIONAL → move to CONFLUENCE node (entry_quality soft factor, removed from spine AND); depth ↓.
- CONTEXTUAL → removed from the execution graph entirely (metadata only); depth ↓.
- JUSTIFIED_MANDATORY → unchanged spine.

**SECONDARY (validation only) = EXECUTION MASKING** `D_exec(node, class)` — preserves structure, alters
evaluation (ALTERNATIVE→ANY short-circuit, OPTIONAL→skip-in-gate, CONTEXTUAL→never-evaluated). Confirms the
structural result isn't a topology artifact. **Structural and execution demotion MUST NOT be combined in the
same run.** Flag: `TF_ROLE_DEMOTION_MODE ∈ {off, struct_conf, struct_alt, struct_ctx, struct_all, exec_all}`,
default `off`, byte-identical when off and for non-demoted conditions.

## 3. Experimental arms — one class per arm (this is what enables attribution)
PRIMARY (structural): **{baseline, Arm-CONF, Arm-ALT, Arm-CTX, Arm-ALL}** — each of the three single-class arms
modifies **exactly one** class; Arm-ALL = all three. SECONDARY: **exec_all** (structure-preserving replication of
Arm-ALL). **No primary arm modifies more than one class.** Same strategies / rig / seed / engine version /
gating config across all arms.

## 4. Causal DAG — normalized, windowed (so a null is unambiguous)
```
Role-demotion(arm)
   ↓  [conjunction depth: per-strategy, full graph]
Conjunction Depth
   ↓  [firing rate: rolling 100-bar blocks, normalized per instrument]
Firing Rate
   ├──↓ [zero-trade: per family, binary threshold]  Zero-Trade Count
   └──↓ [revival: binary 0→>0 over full run]         Revival Count
                                                          ↓ [SDS: post-filter, active strategies only]
                                                        SDS (behavioral entropy)
```
**DAG constraints:** no edge skips its normalization layer; every edge computed on the SAME data slice, engine
version, and gating config; per-family normalization to prevent Simpson-style reversals.

## 5. Fixed measurement windows
| Metric | Window |
|---|---|
| DRI | per strategy (static, from audit) |
| Conjunction depth | full strategy graph |
| Firing rate | rolling 100-bar blocks, per-instrument normalized |
| Zero-trade / Revival | binary event over full run |
| SDS | post-filter (active strategies only), pre-registered paired-delta instrument |

## 6. PRE-REGISTERED decision (applied ONCE, on Arm-ALL vs baseline)
**Mediator gate (must hold or the intervention didn't fire → INVALID, not a result):** mean conjunction depth
↓ materially (report before/after).
- **FALSIFIER C — CONFIRMED (over-specification dominant):** DRI↓ AND firing rate↑ AND revival↑ AND SDS paired-delta 90% CI entirely **> +0.20** (floor ≥15 strategies/≥5 families).
- **FALSIFIER B — INTERACTION DOMINANT:** depth↓ AND firing rate↑ BUT SDS ~unchanged (CI includes/below +0.20) → constraints are not the issue, their **interaction/ordering/state coupling** is → next phase = interaction semantics (WAIT_RETEST sequencing, stateful-as-instantaneous).
- **FALSIFIER A — COUNT NOT DOMINANT:** depth↓ significantly BUT firing rate ~unchanged AND SDS ~unchanged → reject "constraint count" as the driver entirely.
- Else INCONCLUSIVE.
**Attribution (secondary):** rank Arm-CONF / Arm-ALT / Arm-CTX by revival + firing-rate lift → which discourse
mis-typing dominates → extractor-fix priority. Report `exec_all` vs `struct_all` agreement (topology-artifact check).

## 7. Scope / purity
Semantic-role reassignment only, sourced from the audit; flag-gated default OFF; single-class-per-arm; non-demoted
conditions byte-identical corpus-wide (prove it). Reuse `signature-divergence.py` + controlled-run rig + paired-delta,
same instrument as increments 2–3. Fresh corrected engine. No new evaluators. Do NOT commit until reviewed.

## 8. Why this can fail meaningfully
If structural demotion drops depth (DRI-effect real) but the dead strategies stay dead and SDS stays flat
(Falsifier A/B), the *count* of constraints was never the bottleneck — their *interaction* is. That eliminates
the entire "how many conditions" hypothesis class and pivots cleanly to constraint-coupling semantics. Every
one of the three falsifiers is a real, publishable outcome.
