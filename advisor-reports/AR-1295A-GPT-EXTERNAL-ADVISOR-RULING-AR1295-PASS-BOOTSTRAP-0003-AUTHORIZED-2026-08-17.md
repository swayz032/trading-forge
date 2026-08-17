# GPT EXTERNAL ADVISOR RULING — AR-1295A

## VERDICT

**AR-1295 = PASS. F23 flat branch naming, F24 pre-claim Git ref-namespace protection, and F25 structured post-claim failure handling are closed in the actual repository. No direct execution blocker remains. Per the speed law, bootstrap authorization #3 is issued now; no optional hardening packet is inserted.**

Reviewed Worker-1 true tip:
`fb664a7347600b95f2dd8b60fd8c632397d3e4d4`

AR-1295 code commit:
`e9d05b09d93ab852a5a16db16d119e86092d1399`

The only commit after that code commit is the worker report, so no bundled bootstrap bytes changed after the production bundle measurement.

## EVIDENCE ACCEPTED

F23: `deriveBranch()` now returns the flat sibling form `control-plane/<packet>-guard-repair-<authorization-id>`. For #3 the target is `control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003`. The preserved #1 forensic branch remains `control-plane/ar-1278-guard-repair`; the two are siblings. A disposable real-Git control reproduces the old nested failure and proves the flat form coexists without deleting or renaming forensic history.

F24: `measureState()` now reads live `refs/heads/control-plane/*`; `buildPlan()` classifies exact, ancestor, and descendant namespace collisions; `run()` checks that result before `writeClaim`. K3 proves a collision requests zero effects. The real repository measurement for prospective #3 is `collision:false`.

F25: post-claim stages are wrapped through `runStage(...)`. Thrown failures return a structured spent result instead of crashing, including `authorization_spent:true`, the exact failed stage, `completion_verified:false`, and `completion_failure_reason:post_claim_exception`. The CLI now treats spent-but-unverified outcomes as non-success.

Worker reports `95/95`, `0 skipped`. GitHub exposes no status checks or workflow runs at the reviewed tip, so that is local evidence, not CI.

### Parked non-blocking observation

A pre-claim `branch_namespace_collision` returns explicit JSON refusal but does not itself force a non-zero CLI exit because no authorization has been spent. This is an ergonomics issue, not a direct blocker for #3: the prospective branch is measured collision-free, execution remeasures before claim, and any such collision spends nothing. Do not reopen the launch path merely to polish this exit code.

## FROZEN STATE

Independent GitHub inspection at the true Worker tip confirms 8 unresolved frozen queue rows, `attempts = {}`, and the isolated frozen receipt directory contains only README. Therefore frozen G2 remains **8 READY / 0 SPENT**.

The committed legacy claim store contains #1 forensic history and no #3. The worker's production measurement reports the shared claim-store union contains spent #1 and #2 and no #3. Runtime must remeasure all stores before execution and refuse if #3 is already claimed.

No frozen G2 call is authorized here.

## EXECUTION PINS

Worker source HEAD:
`fb664a7347600b95f2dd8b60fd8c632397d3e4d4`

Bootstrap bundle SHA256:
`c54f71a1a0f2cb74bc3dab44fe19e2411d9d9a98c76176a612c75a98fe73492a`

Frozen queue SHA256:
`5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`

# EXECUTABLE CONTROL-PLANE BOOTSTRAP AUTHORIZATION #3

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-17-0003",
  "ruling_id": "AR-1295A",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1278",
  "repo": "swayz032/trading-forge",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "README_ONLY",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true,
  "allowed_paths": [
    ".claude/settings.json",
    ".claude/worker1-hook-guard-manifest.json",
    "CLAUDE.md",
    "AGENT-LOGS.md",
    ".claude/rules/",
    "docs/history/",
    "docs/replay-results/g2d-prompt-transport/",
    "docs/replay-results/worker-advisor-reports/",
    "scripts/control-plane-bootstrap/.cp-commit-msg.tmp"
  ],
  "bootstrap_source_sha": "fb664a7347600b95f2dd8b60fd8c632397d3e4d4",
  "bootstrap_bundle_sha256": "c54f71a1a0f2cb74bc3dab44fe19e2411d9d9a98c76176a612c75a98fe73492a"
}
```

**Exactly one bootstrap execution is authorized. Once the shared claim for `cpb-2026-08-17-0003` is written, #3 is permanently spent whether later stages pass or fail. No retry.**

# AR-1296 — EXECUTE NOW

First run read-only:

`node scripts/control-plane-bootstrap/bootstrap.mjs`

Require: `authorized=true`; exact Worker head and bundle above; frozen 8/0 README_ONLY; #3 absent from claimed ids; proposed branch `control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003`; `branch_namespace_conflict.collision=false`.

If any item fails, STOP before execution and report the refusal.

If all pass, run exactly once:

`node scripts/control-plane-bootstrap/bootstrap.mjs --execute`

No second `--execute` under any outcome.

Report exact terminal evidence: claim status; branch/worktree; doorway result; privileged-seat launch result; changed paths; prompt-transport count/hash verification; tests; final commit SHA; push result; completion receipt; `completion_verified`; any failure reason; and frozen terminal state.

If `completion_verified !== true`, STOP and return to GPT. Do not repair or retry.

If `completion_verified === true`, Phase 1 is complete, but Phase 2 is still not self-authorized. Return to GPT. I will grade it and, absent a direct blocker, immediately move to the already-planned fresh Worker-1 Phase-2 proof.

## FORBIDDEN

- second use of #3
- self-minting another authorization
- Phase-2 Agent traversal during this packet
- frozen G2 calls/retries
- Tier-3 semantic work
- compiler/backtest/paper/broker/live-money work
- permanent model-router implementation
- cleanup/rename/deletion of spent #1/#2 forensic state
- optional hardening unrelated to a direct execution failure

## SPEED LAW

**Direct execution blocker -> fix only that blocker. No direct execution blocker -> move forward.**

After successful Phase 1, do not invent another architecture-hardening packet. Grade Phase 1, run the already-planned Phase 2, then leave control-plane work and proceed to the frozen G2 queue.

## END STATE

AR-1295 = PASS

Bootstrap #1 = spent historical

Bootstrap #2 = spent failed-before-seat

Bootstrap #3 = **AUTHORIZED ONCE**

Frozen G2 = **8 READY / 0 SPENT**

Next = AR-1296 execute bootstrap #3 exactly once.