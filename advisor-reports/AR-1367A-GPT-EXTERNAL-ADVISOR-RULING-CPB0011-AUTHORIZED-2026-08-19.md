# GPT EXTERNAL ADVISOR RULING — AR-1367A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Stage:** 3 — Strategy Factory  
**Worker branch:** `claude/worker1-h1-20260815`  
**Worker HEAD inspected / bootstrap source pin:** `39b354e4cb9dfacf2a615605b1cfaf2fd948787d`  
**Prior controlling ruling:** AR-1366A @ `e45972fa17a4627625701e7cec2b66ab3783b99d`

## DISPOSITION

**AR-1373 = PASS.**  
**FRESH GUARD-V2 PROMOTION PREFLIGHT = PASS.**  
**`cpb-2026-08-19-0011` = AUTHORIZED FOR EXACTLY ONE BOOTSTRAP EXECUTION.**  
**GUARD-V2 TARGET REMAINS `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`.**

Worker 1 completed the exact read-only preflight AR-1366A ordered and changed only the report. GPT independently compared the prior Worker HEAD `20cea56675c15d9690e285aa330a7b1da813cb42` to current `39b354e4cb9dfacf2a615605b1cfaf2fd948787d`; the only changed path is AR-1373 itself. No protected/control-plane/bootstrap/toolbox/manifest code changed after the path repair and regression closeout.

The measured repaired bootstrap bundle is accepted:

`f75739efcc41fe8763b6f779e46ee4862900ebbd0673d799d344c4f5fb1dc613`

Worker measured it using the repository's real `computeBundle` implementation over the real 10-file `BUNDLE_FILES` set and supplied per-file byte/hash detail. GPT independently verified from GitHub that the report commit is report-only, the bundle-covered production source is unchanged from the already inspected repaired candidate, and `BUNDLE_FILES` still covers the two repaired load-bearing files plus the remaining bootstrap helpers. The report-only commit therefore does not invalidate that measured bundle.

The frozen state is accepted as:

- queue SHA256: `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
- READY: `8`;
- SPENT: `0`;
- receipt law: `GIT_TREE:c11966868f8a511554e1f26bf6e5555c59833d04`;
- receipt path: clean;
- `cpb-2026-08-19-0009` and `cpb-2026-08-19-0010`: present in claim history and permanently spent.

The intended Guard-V2 target was re-resolved without drift:

- target commit: `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`;
- target toolbox bundle: `5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`;
- target materialized file count: `56`.

GPT independently inspected the current Worker branch files and confirmed the live pre-promotion identity is still:

- `scripts/claude_toolbox.mjs` actual `TOOLBOX_PIN` = `59cfb1cdd1a9779e2a7be406397bea52362db467`;
- `.claude/worker1-hook-guard-manifest.json::_toolbox_pin` = same `59cfb1cd...`;
- manifest `_toolbox_bundle_sha256` = `849253f1e5a08f7c9f1e0f177d9a956e50a249612df24476a97dde6c0f36ee7d`.

GPT also checked the actual repository branch namespace for `control-plane/ar-1367a`; no such branch currently exists. Therefore the fresh `AR-1367A + cpb-2026-08-19-0011` attempt does not collide with an existing branch namespace.

GitHub reports no status checks and no workflow runs for exact Worker HEAD `39b354e4...`.

**CI: NONE. Preflight evidence is local/mechanical plus independently inspected repository state.**

---

## 1. FRESH EXECUTABLE AUTHORIZATION

The following is the **only executable control-plane bootstrap marker in this ruling**.

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-19-0011",
  "ruling_id": "AR-1367A",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1367A",
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
    "docs/replay-results/worker-advisor-reports/AR-1374-WORKER1-GUARD-V2-PROMOTION-CLOSEOUT-CPB0011-2026-08-19.md"
  ],
  "bootstrap_source_sha": "39b354e4cb9dfacf2a615605b1cfaf2fd948787d",
  "bootstrap_bundle_sha256": "f75739efcc41fe8763b6f779e46ee4862900ebbd0673d799d344c4f5fb1dc613"
}
```

This authorization is one-shot. Claim-before-launch law remains in force. If `--plan` or `--execute` measures any mismatch, STOP. Do not edit the marker, delete a claim, reuse the id, or manually finish a failed worktree.

---

## 2. EXACT PROMOTION WORK

After `bootstrap.mjs --plan` accepts the marker, Worker may execute exactly one `--execute` attempt.

The privileged seat is authorized only to promote the already graded Guard-V2 target.

### A. Actual toolbox materialization pin

In `scripts/claude_toolbox.mjs`, change the actual immutable pin:

`59cfb1cdd1a9779e2a7be406397bea52362db467`

->

`4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`

Record the deliberate descendant transition in the existing pin-history comment style. Do not change unrelated toolbox logic.

### B. Manifest expected identity

In `.claude/worker1-hook-guard-manifest.json`, set exactly:

- `_toolbox_pin = 4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`;
- `_toolbox_bundle_sha256 = 5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`.

Update only the pin-history/provenance prose necessary to record this deliberate Guard-V2 promotion. Do not weaken edit scope, G2 policy, session identity, lifecycle controls, or any unrelated manifest law.

### C. Do not edit `.claude/settings.json`

The current hook wiring is not part of this promotion. `.claude/settings.json` is not authorized.

### D. Commit-message temp path

`scripts/control-plane-bootstrap/.cp-commit-msg.tmp` is authorized only because `cp-finalize.mjs` requires the fixed terminal commit-message transport. It must never be staged and must be consumed/deleted by the finalizer.

### E. Closeout

Write exactly:

`docs/replay-results/worker-advisor-reports/AR-1374-WORKER1-GUARD-V2-PROMOTION-CLOSEOUT-CPB0011-2026-08-19.md`

The closeout must record:

- exact authorization id and ruling id;
- bootstrap `--plan` verdict;
- claim result;
- privileged SessionStart result;
- exact before/after toolbox pin;
- exact after manifest pin and toolbox bundle;
- materialized 56-file target bundle recomputation;
- bounded regression commands and actual counts;
- frozen queue/receipt identities before and after;
- final staged-path set;
- final commit SHA;
- push result;
- completion-receipt result;
- zero Agent/Task/model execution inside the privileged seat.

---

## 3. REQUIRED PROMOTION ACCEPTANCE

A successful commit alone is not enough.

Inside the authorized seat, run the bounded existing Guard-V2/control-plane tests permitted by the guard. Record exact commands/counts.

After the privileged closeout lands, Worker 1 from the normal seat must independently verify all of the following before reporting success:

1. live `scripts/claude_toolbox.mjs` resolves exact target pin `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`;
2. live manifest expected pin equals the same target;
3. live manifest bundle equals `5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`;
4. actual materialization recomputes that exact 56-file bundle;
5. frozen queue remains `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939` with READY 8 / SPENT 0;
6. receipt tree remains `c11966868f8a511554e1f26bf6e5555c59833d04` and clean;
7. normal Worker SessionStart arms under the promoted guard;
8. the permitted isolated accuracy-validator / `isolation:"worktree"` path activates for a harmless read/test action;
9. that isolated grader remains unable to Write/Edit/Agent/Task or mutate protected state;
10. same-session/cross-worktree borrowing remains refused;
11. parent advance -> rewind authority loss remains refused;
12. the current CPB Windows long-ruling object-read regression remains green under T1/T2/T3;
13. completion receipt is present and binds the exact successful attempt.

Any failure is a STOP. Do not weaken Guard-V2 to make the acceptance set pass.

---

## 4. SPENT-ID / FAILURE LAW

If CPB-0011 is claimed and then fails, it is permanently spent.

Do not:

- retry CPB-0011;
- delete or alter its claim;
- reuse its branch/worktree for a fresh authorization;
- manually mutate the protected files from the failed seat;
- forge or copy a completion receipt;
- fall back to CPB-0009 or CPB-0010.

Report the exact first failed gate. GPT will decide the next action from evidence.

---

## 5. WHAT REMAINS LOCKED

This ruling authorizes only the Guard-V2 promotion above.

Still locked:

- broad semantic intake;
- certifier weakening;
- broad Factory rerun;
- PAPER;
- broker/Topstep/live execution;
- autonomous-runtime promotion;
- any self-modifying learning change during qualification;
- reopening settled G2 model calls.

Stage 3 Strategy Factory remains the active architecture stage. The control-plane work is a bounded infrastructure dependency, not a replacement for the money path.

---

## FINAL RULING

**AR-1373 PASSES. The repaired bootstrap preflight is clean, the new bootstrap bundle is `f75739ef...`, the frozen queue/receipt state remains unchanged, old CPB ids remain spent, the Guard-V2 target remains exact at `4c6f36ea...` with bundle `5b54027e...`, and the live pre-promotion identity is still the expected `59cfb1cd...` pair. GPT therefore issues one fresh executable authorization: `cpb-2026-08-19-0011`, bound to exact Worker HEAD `39b354e4...` and the repaired bootstrap bundle. Worker may now run one Guard-V2 promotion attempt. No retries, no scope widening, no PAPER/live shortcut.**
