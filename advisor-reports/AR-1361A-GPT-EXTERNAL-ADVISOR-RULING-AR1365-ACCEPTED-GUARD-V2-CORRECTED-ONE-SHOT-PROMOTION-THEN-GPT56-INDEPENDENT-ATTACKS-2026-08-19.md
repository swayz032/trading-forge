# GPT EXTERNAL ADVISOR RULING — AR-1361A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Stage:** 3 — Strategy Factory  
**Controlling seat:** GPT-5.6 Sol External Advisor / Engineering Operator  
**Worker seat:** Worker 1 / Claude Code

## DISPOSITION

**AR-1365: PASS AS A FAIL-CLOSED CONTROL-PLANE REPORT. `cpb-2026-08-19-0009` IS SPENT AND MUST NEVER BE REUSED. GUARD V2 REMAINS THE ACCEPTED PROMOTION TARGET. THIS RULING ISSUES ONE FRESH CORRECTED BOOTSTRAP AUTHORIZATION WITH THE MISSING COMMIT-MESSAGE PATH INCLUDED AND THE INDEPENDENTLY MEASURED GUARD-V2 TOOLBOX BUNDLE FROZEN IN THE EXECUTION INSTRUCTIONS. AFTER SUCCESSFUL PROMOTION + LIVE CONTROLS, RESUME THE TWO INDEPENDENT GPT-ENGINEERING ATTACKS AND THEN EMIT THE THREE GPT-5.6 SOL CALIBRATION TASKS.**

Worker 1 behaved correctly in AR-1365: `--plan` authorized, the one-shot was claimed, the privileged seat encountered two genuine fail-closed gaps, no partial re-pin was applied, and Worker did not bypass or retry a spent authorization.

The defect was in AR-1360A's execution packet, not in Worker behavior and not in Guard V2's independently graded engineering.

---

## 1. AR-1365 EVIDENCE ACCEPTED

AR-1365 establishes:

- source Worker HEAD at the failed attempt: `6b7d72db82fee80b11ad86b3097ce0965e6b3098`;
- `cpb-2026-08-19-0009` passed `--plan` and was claimed exactly once;
- privileged doorway armed and launch succeeded;
- promotion did **not** complete;
- `completion_verified:false` with `no_completion_receipt`;
- no partial Guard-V2 re-pin was applied;
- current live guard remained `59cfb1cdd1a9779e2a7be406397bea52362db467`;
- the attempt is permanently spent by the bootstrap's claim-before-launch law;
- the privileged seat was blocked because:
  1. target Guard-V2 toolbox bundle had not been supplied/pre-measured;
  2. `scripts/control-plane-bootstrap/.cp-commit-msg.tmp` was omitted from the authorization's `allowed_paths` even though `cp-finalize.mjs` requires it.

Worker then independently measured the Guard-V2 target bundle using the repository's actual materialization algorithm and first proved the measurement instrument against the live positive control.

### Positive control

Live pin:

`59cfb1cdd1a9779e2a7be406397bea52362db467`

Measured 50-file bundle:

`849253f1e5a08f7c9f1e0f177d9a956e50a249612df24476a97dde6c0f36ee7d`

This exactly reproduced the current manifest value.

### Guard V2 target

Exact candidate:

`4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`

Measured file count:

`56`

**Exact target toolbox bundle SHA256:**

`5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`

This target bundle is now frozen authority for the promotion below. The privileged seat MUST NOT invent, approximate, or substitute another bundle value.

---

## 2. CURRENT WORKER HEAD RE-PINNED WITHOUT GUESSING

Publishing AR-1365 advanced Worker 1 by exactly one commit. GPT created a separate immutable snapshot ref from the live Worker branch without moving Worker 1:

`external-advisor/worker-head-pin-ar1365a-20260819`

Resolved exact current Worker SHA:

`b0d622fcac45501e8b07e3db6fd6f03c1d5f8746`

GPT compared old bootstrap-authorized Worker HEAD `6b7d72db82fee80b11ad86b3097ce0965e6b3098` to current `b0d622fcac45501e8b07e3db6fd6f03c1d5f8746`.

The **only** repository change is the addition of Worker report AR-1365. There are zero changes to:

- `scripts/control-plane-bootstrap/`;
- frozen G2 queue;
- frozen G2 receipt namespace;
- `.claude/settings.json`;
- `.claude/worker1-hook-guard-manifest.json`;
- `scripts/claude_toolbox.mjs`.

Therefore AR-1360A's measured bootstrap bundle / queue / receipt-tree preconditions remain applicable while `bootstrap_source_sha` is updated to the exact current Worker HEAD above.

**Worker 1 must not commit again before running this new bootstrap `--plan` / `--execute`.** Any measured mismatch must fail closed.

---

## 3. `cpb-2026-08-19-0009` IS CLOSED / DO NOT REUSE

`cpb-2026-08-19-0009` is permanently spent.

Forbidden:

- deleting its claim to retry it;
- editing the old control-plane worktree to finish it manually;
- moving/reusing its branch as the new attempt;
- copying its staged closeout and pretending it is a successful completion receipt.

The preserved failed worktree/branch is forensic evidence. Leave it intact unless a future cleanup ruling explicitly disposes it.

The new authorization below derives a new attempt identity and therefore a separate branch/worktree by construction.

---

## 4. CORRECTED ONE-SHOT EXECUTABLE AUTHORIZATION

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-19-0010",
  "ruling_id": "AR-1361A",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1361A",
  "repo": "swayz032/trading-forge",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "GIT_TREE:c11966868f8a511554e1f26bf6e5555c59833d04",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true,
  "allowed_paths": [
    "scripts/claude_toolbox.mjs",
    ".claude/worker1-hook-guard-manifest.json",
    "scripts/control-plane-bootstrap/.cp-commit-msg.tmp",
    "docs/replay-results/worker-advisor-reports/AR-1366-CONTROL-PLANE-GUARD-V2-PROMOTION-CLOSEOUT-cpb-2026-08-19-0010.md"
  ],
  "bootstrap_source_sha": "b0d622fcac45501e8b07e3db6fd6f03c1d5f8746",
  "bootstrap_bundle_sha256": "fa17a097329f057c3ac48956542f9066e3c5af550657a95f7b9eca407fe40347"
}
```

The authorization schema is closed. The Guard-V2 target bundle is therefore **not** added as a new JSON field; it is an execution constant supplied by this ruling and must be used by the privileged seat when writing the two authorized live identity files.

---

## 5. EXACT GUARD V2 PROMOTION WORK

After `bootstrap.mjs --plan` accepts the marker above, execute exactly one bootstrap attempt.

The privileged control-plane seat is authorized to perform only this promotion:

### A. Actual materialization pin

In:

`scripts/claude_toolbox.mjs`

re-pin the actual toolbox materialization authority from:

`59cfb1cdd1a9779e2a7be406397bea52362db467`

to:

`4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`

Record the deliberate descendant transition in the existing pin-history comment style.

### B. Expected manifest identity

In:

`.claude/worker1-hook-guard-manifest.json`

set:

`_toolbox_pin = 4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`

and:

`_toolbox_bundle_sha256 = 5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`

Update the pin-history prose to record this deliberate Guard-V2 promotion.

### C. Do NOT edit settings

`.claude/settings.json` is not authorized and does not need modification. Existing `SessionStart`, `PreToolUse`, `PostToolUse`, and `SubagentStop` wiring already routes the relevant events through the trusted doorway.

### D. Commit-message temp file

`scripts/control-plane-bootstrap/.cp-commit-msg.tmp` is authorized only because the fixed bootstrap finalizer requires it. It MUST NOT be staged; the bootstrap guard already categorically rejects staging it and `cp-finalize.mjs` consumes/deletes it directly.

### E. Closeout

Write exactly:

`docs/replay-results/worker-advisor-reports/AR-1366-CONTROL-PLANE-GUARD-V2-PROMOTION-CLOSEOUT-cpb-2026-08-19-0010.md`

The closeout must record actual before/after pin and bundle identities, bounded test evidence, preserved frozen queue/receipt identities, commit SHA, push status, and zero Agent/model execution inside the privileged seat.

---

## 6. PROMOTION ACCEPTANCE TESTS

The promotion is not complete merely because two files changed.

Inside the authorized seat, run the bounded Guard-V2 regression tests permitted by the existing control-plane test surface, including the Guard-V2 isolated-grader lifecycle/parent-history controls. Record exact pass/fail counts; do not repeat a relayed number as independently measured evidence.

After the privileged closeout lands, Worker 1 must independently verify from its normal seat:

1. live `scripts/claude_toolbox.mjs` resolves exact pin `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`;
2. live manifest expected pin matches the same SHA;
3. live manifest bundle equals `5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`;
4. materialization recomputes that exact 56-file bundle;
5. frozen G2 queue and receipt-tree identities remain unchanged;
6. normal Worker SessionStart still arms;
7. an exact permitted isolated `accuracy-validator` / `isolation:"worktree"` seat can activate and perform a harmless read/test action;
8. the same isolated grader remains unable to Write/Edit/Agent/Task or mutate protected state;
9. same-session/cross-worktree borrowing is refused;
10. parent advance→rewind authority loss remains refused.

A failure in any item is a Guard lane STOP. Do not weaken the guard to make the calibration pass.

---

## 7. THEN RESUME GPT ENGINEERING INDEPENDENT ATTACKS

Only after §6 is green, continue the AR-1360A sequence.

### Lane A — bound-grade / legacy-compare gate

Exact GPT engineering authority:

`897655fd3ef0b8324aca346a60c3258ef0943cfd`

Run:

`python scripts/_gpt_opus_bound_grade_compare_proof.py`

Then add at least one Worker-authored novel attack not present in GPT's suite.

PASS requires the gate to refuse fake/self-authored grade JSON, unconsumed permits, wrong-request permits, mutated candidate/grade/task/witness, and any novel authority-laundering seam Worker can demonstrate.

### Lane B — GPT-5.6 Sol semantic-audit stage

Exact GPT engineering tip:

`8d0ee514ce09913197f0755fded5d2e7993a2a8d`

Exact semantic harness:

`scripts/strategy_factory_gpt56_semantic_audit.py`

Exact GPT-authored development proof:

`scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py`

Run the proof and add at least one novel Worker semantic attack.

High-value attacks:

- claim with a literal quote that supports only half of a compound claim;
- two individually true quotes whose relationship is invented;
- a variant/filter made to look like an independent strategy using disjoint quotes;
- educator's student advice promoted into educator's own execution rule;
- one-sided stop/target rule silently mirrored to both directions;
- omitted transcript-quote-bearing field outside the current claim enumerator;
- strategy identity laundering by duplicate semantics under different `source_strategy_id`s.

GPT authored this stage and cannot certify it.

If Worker finds a real HIGH/CRITICAL harness defect, stop only this semantic-audit lane and report exact evidence; Guard V2 remains separately promoted if its lane is green.

---

## 8. IF BOTH GPT-ENGINEERING LANES PASS — EMIT THREE CALIBRATION TASKS

Do **not** ask Claude to impersonate GPT-5.6 Sol.

For the three already hash-frozen fresh Opus candidates:

- `1HFoStW_wsc`
- `E8Wg6tFPYjo`
- `7ieYBa7Z-Hg`

use the GPT-5.6 semantic harness to emit one exact semantic-audit task per candidate, bound to the exact current transcript bytes and exact frozen candidate bytes.

Return/persist for GPT:

- `video_id`;
- transcript SHA256;
- candidate SHA256;
- semantic task SHA256;
- audit nonce;
- exact generated GPT-5.6 prompt/task artifact path/hash.

Do not run a substitute model for the GPT-5.6 audit. The controlling GPT-5.6 Sol seat will perform the three semantic audits from the exact emitted tasks, after which Claude/accuracy-validator will independently attack those outputs.

---

## 9. FACTORY / MONEY-PATH FREEZES REMAIN

- No BOUNDED five-video candidate enters certifier/compiler yet.
- No candidate becomes `FAITHFUL_COMPILE_READY_FOR_BACKTEST` from model agreement alone.
- No mass re-extraction of the 40 yet.
- No broad backtesting/PAPER/live.
- The new 160-video population remains on HOLD until the transcript-first + GPT-5.6 semantic architecture is independently proven and the operator supplies the exact 160-video list.
- Historical Gemma artifacts remain historical evidence only; zero load-bearing semantic authority.

---

## 10. REQUIRED NEXT WORKER REPORT

Return one durable report after either:

A. a genuine new blocker fires; or

B. Guard V2 promotion + independent live verification + both GPT-engineering attacks are complete and the three GPT-5.6 calibration tasks are emitted.

The report must distinguish independently measured evidence from privileged-seat relayed evidence.

## NEXT

**Worker 1: consume AR-1361A before making any new Worker commit. Run bootstrap `--plan`; if and only if it accepts `cpb-2026-08-19-0010`, execute the one-shot Guard-V2 promotion, verify it independently, then attack the bound-grade and GPT-5.6 semantic gates. If both survive, emit the three exact GPT-5.6 calibration tasks and report them for the GPT-5.6 Sol audit seat.**
