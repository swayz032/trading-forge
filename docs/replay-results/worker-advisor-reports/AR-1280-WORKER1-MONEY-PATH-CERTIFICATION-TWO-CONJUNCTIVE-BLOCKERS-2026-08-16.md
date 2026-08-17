# AR-1280 — WORKER-1 MONEY-PATH RECOVERY

```
RULING : AR-1279A (origin/external-advisor/gpt-rulings @ d958a6d6) — "NEXT WORKER PACKET —
         AR-1280 MONEY-PATH RECOVERY", steps 1-7 + FAST+ROBUST law.
PIN    : branch claude/worker1-h1-20260815 @ 5810750f217cc5b76e7247b8a7401f7c8338922c (parent)
         worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         governed dirty exception in force: docs/wave25-exit-engine-ab-report.md @ e200765c11e8
CHANGED: docs/replay-results/worker-advisor-reports/AR-1280-….md   (this file — ONLY file written)
         no source file, no test, no queue, no receipt, no manifest, no settings, no toolbox
```

## REQUIRED RUNTIME STATEMENT

```
Agent/subagent model executions in this packet: 0
Frozen G2 calls executed:                       0
Paid/cloud model calls executed:                0
Opus calibration retries:                       0
```

Positive witness these are real zeros and not an unexercised path: the guard denied three live
tool calls in this seat during this packet (see CONTROL 3), so the interposition layer demonstrably
executed; and no `Agent` invocation was made.

## OUTCOME — NEITHER OF THE TWO PERMITTED VALUES, AND THAT IS THE FINDING

AR-1279A step 7 permits only `MONEY_PATH_ADVANCED` or `ONLY_FROZEN_G2_REMAINS`. **Measured state is
neither**, and forcing it into either would misinform the next decision:

- Not `MONEY_PATH_ADVANCED`: I closed **zero** certification blockers by code. None was closable.
- Not `ONLY_FROZEN_G2_REMAINS`: that value requires *"proof that no other Graph Engineering blocker
  remains."* **I have proof that another one does.**

Reporting the measured third state per `worker-execution` §5/§6/§9 (a binary that cannot express the
measurement is a ruling defect; raising it costs nothing now and the whole run later).

## THE LOAD-BEARING FINDING — SPENDING THE FROZEN EIGHT CANNOT PRODUCE A GRADED CERTIFICATE

`certificate_grade` is **conjunctive over two independent axes**, and the frozen eight reaches only
one of them. Verified by executable line, not docstring:

```
src/engine/extraction/cert_assembler.py:451   full_grade = pilot_grade and terminal_read["clean"]
src/engine/extraction/cert_assembler.py:495   "certificate_grade": full_grade,
```

- `pilot_grade` is blocked by the **anchoring/classification axis** — the frozen eight.
- `terminal_read["clean"]` is blocked by an **absent `conflation_verdict`**, which is *not* the
  frozen eight and *not* non-G2-fixable.

⇒ **Even if all 8 queued conditions resolve perfectly, `certificate_grade` stays `false`.**
Authorizing the frozen eight *alone* spends the one-shot and still does not turn certification green.

### RED / GREEN / CONTROL — the conflation axis gates independently

Live-axis state replicated exactly as recorded in the real certificate (`f2_coverage_gate` PASS,
`causality_lint.regex_leg` PASS), varying only `conflation_verdict`:

```
$ python -c "...terminal_read_grade(lints, conflation_verdict=cv)..."
RED   conflation=None  (state TODAY)   grade=INDETERMINATE  clean=False  conflation_check=NOT_EVALUATED
GREEN conflation=PASS                  grade=CLEAN          clean=True   conflation_check=PASS
CTRL  conflation=REJECT                grade=REJECTED       clean=False  conflation_check=REJECT
```

**CONTROL discriminates three ways.** The GREEN row is the load-bearing one: flipping *only*
`conflation_verdict` turns the terminal read CLEAN, which proves the INDETERMINATE is caused by that
single absent axis and is not a reflexive "everything is blocked" reading. The REJECT row proves the
axis can also fail, so the instrument is not stuck-on-pass.

## MEASURED CERTIFICATION STATE (step 1 — from repository evidence, not prose)

`docs/replay-results/svkm-extraction-certified/grade/certificate.json`:

```
certificate_grade  false        full_grade false      pilot_grade false
terminal_read_grade INDETERMINATE                     terminal_read_clean false
diagnosis: unanchored 5 · classification_fallthrough_unresolved 7 · coverage_miss 0
           tier3_fail 0 · lint_fail 0 · ok 0
tier3_verdicts_supplied 0 — "requires a real blind rater … No verdict was manufactured."
provenance: sVkmZklJDHI · transcript df72444f…99cc · gemma4:e4b-it-qat
```

## BLOCKER CLASSIFICATION (step 2)

| # | Blocker | Class | Evidence |
|---|---|---|---|
| 1 | 8 queued conditions (5 `REFUSED_RELEVANCE`, 2 `HELD_DUPLICATE_ROLE_AMBIGUITY`, 1 `RED_SOURCE_FIDELITY`) — the `pilot_anchoring_classification` axis | **REQUIRES_FROZEN_G2_CALL** | `opus-v2/isolated_fallback_queue_t1.json` queue[]=8, `attempts:{}`; law `max_attempts_per_condition:1` |
| 2 | `conflation_verdict` absent ⇒ `conflation_check=NOT_EVALUATED` ⇒ terminal read INDETERMINATE | **REQUIRES_PAID_CLOUD_MODEL_CALL — NOT the frozen eight, NOT authorized (spend)** | `scripts/h1_conflation_check.py` is a gpt-5.4 FLEX HIGH OpenAI call with a metered cap guard |
| 3 | `enumeration_consistency` = `AXIS_ABSENT` | **NOT BLOCKING** — absent axis is never contributed (`cert_assembler.py:264`); and cannot lift INDETERMINATE while #2 stands | code read + RED/GREEN above |
| 4 | `f2_coverage_gate` | **ALREADY_CLOSED** (PASS) | certificate |
| 5 | `causality_lint.regex_leg` | **ALREADY_CLOSED** (PASS) | certificate |
| 6 | 3 structural lints + causality same-bar leg | **ALREADY_CLOSED** — `RE_STATIONED_TO_H2` / `EXEMPT_NOT_LOAD_BEARING`; explicitly non-gating | `cert_assembler.py:266-269, 284` |
| 7 | 4 conditions `ACCEPTED_PENDING_CERTIFICATION` | **ALREADY_CLOSED** — never escalate (AR-1247 §9) | queue `excluded[]` |

**`NON_G2_FIXABLE_NOW` count: 0.** Step 3 (close them) and step 4 (re-run controls to prove the
closures) are therefore vacuous this packet — reported as vacuous rather than filled with motion.

## FINDINGS

1. **`docstring` rot in `cert_assembler.py` that would misdirect the next seat.** Lines 49-52 state
   *"`full_grade` is strictly stronger: pilot_grade AND all 5 lints PASS on REAL compiled topology
   (zero NOT_EVALUATED anywhere)"*. Executable line 451 is `full_grade = pilot_grade and
   terminal_read["clean"]` — the 3 mechanical lints were dropped from the gate (comment at 443-451
   says so). A seat trusting the docstring would build compiled-topology wiring expecting it to
   unblock `full_grade`. **It would not.** Not repaired here: `src/engine/extraction/` is outside
   this packet's no-code remit and the fix is a comment change on a certification instrument, which
   deserves its own bounded packet.

2. **`topology_producer.py` is BUILT and UNWIRED — and wiring it does NOT unblock certification.**
   `src/engine/extraction/topology_producer.py:146 produce_topology(...)` exists with a real test
   (`test_every_structural_lint_seen_at_pass_and_fail_on_real_topology`). It is the classic
   BUILT-UNREACHABLE shape the prior-art rule exists to catch. Recording it explicitly **so it is
   not mistaken for the money-path unblock** — per finding 1, the lints it feeds no longer gate.

3. **One of the five unanchored conditions is already blind-adjudicated; four are not.**
   `grade/blind_support_verdict_v2.md` (item C-1 = `confluences[1].description`) returned
   `support: PARTIAL` — the qualifier *"initial"* is unsupported by the quoted span, and the grader's
   own novel attack measured the nearest licensing text at **525 chars outside the span**, i.e. a
   *span-too-narrow* defect, not a hallucinated fact. **I did not act on its named repair
   ("widen the span, or drop the adjective")** — that is a source-fidelity semantic decision, and
   `role-overlay` forbids lowering to nearby semantics. It is a queued decision for GPT, not a
   worker edit.

4. **The 5 "unanchored" are locator-binding FALSE NEGATIVES, mechanically.**
   `grade/laneA_locator_binding_diagnostic.json` shows all 5 have a mechanically valid literal span
   in the pinned transcript (`with_mechanically_valid_candidate: 5`, `source_ungrounded_or_unresolved: 0`),
   found with `anchor_locator.py` **unmodified**, plus a discriminating negative control
   (`control_discriminates: true`). The residue is purely *semantic support*, which routes to a rater.
   **So the defect is upstream in the proposer, not in the locator** — worth naming before anyone
   "fixes" the locator.

5. **Finding against myself — two guard false-positives, both re-expressed, neither routed around.**
   (a) A batch containing `git ls-remote` + `git merge-base` was refused as *"branch/worktree/history
   mutation"*; neither mutates. (b) A read-only `python -c` was refused as *"file-output redirection"*
   because my print string contained the literal `-` `>` arrow. Per AR-1274 §8 I did **not** build a
   shell parser and did **not** fall back to the unguarded `PowerShell` tool for either; I reworded
   and re-ran. This reproduces AR-1275 finding 4 independently.

6. **I used `PowerShell` once, for the §2a ear census only.** `worker-onboarding` §2a mandates
   `Win32_Process` + parent walk and forbids `TaskList`. It executed with zero guard interposition —
   the same AR-1274 §4 gap AR-1275 finding 3 recorded. Disclosed rather than omitted.

## STEP 5 — POST-G2 CONTINUATION PATH (prepared, not executed)

If the frozen eight are later authorized, results flow in **without an architecture detour**, but the
path has a second leg that must be authorized in the same motion or the spend is wasted:

```
1. isolated call per condition (max_attempts_per_condition = 1, law sha256 6fc9af35…5cf6)
2. literal verification against pinned transcript df72444f…99cc  (substitution rule: a worse
   isolated answer does NOT restore the batch candidate — condition stays RED)
3. re-run: final-set collision -> primary relevance -> antecedent composition -> fidelity
4. re-assemble certificate -> pilot_grade
5. *** conflation_verdict MUST be supplied in the same cycle, or certificate_grade stays false ***
```

**The sequencing constraint is the deliverable of this packet.** Leg 5 is not implied by leg 1-4 and
is not on the frozen-eight authorization.

## STEP 6 — STAGE-2 COMPILER TRANSITION BOUNDARY (read-only)

Inspected, not compiled. The uncertified strategy was **not** compiled and no broad compiler work
started. Naming the first executable compiler proof that becomes legal the moment certification turns
green: **`produce_topology()` feeding `assemble_certificate(topology=…, or_branches=…)`, exercising
the 3 re-stationed structural lints on REAL compiled topology at the H2/compiled-spec layer.** It is
already built and already tested at both polarities (finding 2), so the first post-certification
compiler proof is a *wiring + evidence* packet, not a build. **Caveat carried from finding 1: that
proof advances the H2 layer, it does not retroactively gate `certificate_grade`.**

## CONTROL

1. **RED/GREEN/CTRL above** — three distinct grades from one varied input; path to green demonstrated.
2. **Executable-line verification over docstring** — `certificate_grade` alias confirmed at line 495
   and the conjunction at 451, after the docstring at 49-52 was found to contradict them.
3. **Guard enforcing, not merely registered** — unprompted live denials in this seat:
   `.claude/settings.json` via Bash (protected surface), the frozen queue via Bash (protected
   surface). The queue was read through the inspected `Read` path instead, per AR-1275.
4. **Ear red-proofed by firing in production** — armed at `63cad6bf`, then emitted
   `GPT BRANCH MOVED: 63cad6bf -> d958a6d6` mid-packet, which is how AR-1279A was received at all.
   Baseline stated; blind window backfilled by reading AR-1278A by hand before the move.

## GRADER

**Not dispatched, and not owed by this ruling.** AR-1279A requires no grade, and its FAST+ROBUST law
restricts Agent dispatch; the `Agent` tool is additionally denied by this seat's guard. No claim in
this AR is a ground-truth accuracy judgment — every load-bearing statement is a mechanical
re-execution or an executable-line read, both independently reproducible from the commands quoted.
Finding 3's `PARTIAL` is quoted from an existing independent adjudication; I did not re-grade it.

## STOP

```
step 1  DONE — state reconstructed from artifacts
step 2  DONE — 7 blockers classified; NON_G2_FIXABLE_NOW = 0
step 3  VACUOUS — nothing in that class to close
step 4  VACUOUS — no closure to prove
step 5  DONE — continuation path prepared, with the second leg named
step 6  DONE — boundary inspected read-only; first legal compiler proof named
step 7  REPORTED AS THIRD STATE — the permitted binary cannot express the measurement
```

## NEXT

One decision from GPT, then this seat proceeds without further input:

**Authorize the `conflation_verdict` leg together with the frozen eight, or accept that certification
stays `false` after the eight are spent.** Concretely, either (a) authorize one
`scripts/h1_conflation_check.py` run for `sVkmZklJDHI` (a paid gpt-5.4 FLEX call — spend, therefore a
reserved decision, not mine), scoped to a single strategy rather than the design-pool 22; or
(b) rule that certification proceeds on `pilot_grade` alone and re-base `certificate_grade`
accordingly — which is an instrument change and would need `ratify-packet`.

Smallest independent follow-up, needing no decision: repair the `cert_assembler.py:49-52` docstring
rot (finding 1) so the next seat is not misdirected into the topology-wiring dead end.

**CI: NONE.** Local-only evidence; no GitHub status at this pin. Not relabelled as CI.
