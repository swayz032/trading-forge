# GPT EXTERNAL ADVISOR RULING — AR-1299A

## VERDICT

**AR-1299 = PASS. F30 closes the remaining recursive-search ancestor gap across the complete categorical protection set. No new direct execution blocker was found. Per the standing speed law, bootstrap authorization `cpb-2026-08-17-0004` is issued NOW. No additional hardening packet is authorized before this execution.**

Reviewed Worker-1 true tip:

`94fd175adc60502b0dfe825c31f601d33939eaff`

Reviewed repair commit:

`b2ceca15aca45355a0b553b4b3fa27d1691ff4c3`

Accepted production-measured bootstrap bundle SHA256:

`4e060c72d931d8e6b28cc688f8d3ea664143078fefee826b966b1d92d35aa773`

Frozen queue SHA256:

`5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`

## 1. F30 — PASS

The production guard now defines the recursive-search ancestor target set as the literal union of:

- `PROTECTED_SURFACE_PATHS`, and
- `CATEGORICAL_DENY_PREFIXES`.

`ancestorOfProtectedSurface()` evaluates that union directly. Therefore a recursive `Grep`/`Glob` root cannot bypass a protected descendant merely because the supplied ancestor itself does not directly match a deny token/prefix.

The actual patch includes behavioral controls for the concrete gaps identified in AR-1298A, including `src/`, `src/server/`, `src/server/services/`, and the protected advisor-tooling ancestor, while retaining safe unrelated recursive roots.

The worker reports `152/152` local tests green. GitHub exposes no status checks and no workflow runs at the reviewed Worker tip, so this is local test evidence, not CI.

## 2. SOURCE / BUNDLE IDENTITY

The AR-1299 repair commit changes the load-bearing `control-plane-guard.mjs`, so the bundle digest correctly moved to:

`4e060c72d931d8e6b28cc688f8d3ea664143078fefee826b966b1d92d35aa773`

The current Worker tip is one commit beyond the repair commit. GitHub comparison exposes no additional changed files between `b2ceca15...` and `94fd175a...`, so no reviewed bundle byte changed after the production measurement.

The current Worker commit carries the AR-1299 closeout evidence in its commit message; no separate AR-1299 report file is visible in the report directory. This is a non-blocking reporting irregularity only. Do not create cleanup work before bootstrap #4.

## 3. FROZEN STATE

Independent GitHub inspection confirms:

- 8 unresolved frozen queue rows,
- `attempts = {}`,
- frozen receipt directory contains only `README.md`.

Therefore:

`FROZEN G2 = 8 READY / 0 SPENT`

The worker's production read-only measurement reports shared claimed ids #1/#2/#3 spent and #4 absent. GitHub cannot independently see the local Git-common-dir claim store, so runtime must remeasure and fail closed before mutation.

The prospective remote branch `control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004` is not currently present on GitHub.

## 4. EXECUTABLE BOOTSTRAP AUTHORIZATION #4

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-17-0004",
  "ruling_id": "AR-1299A",
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
  "bootstrap_source_sha": "94fd175adc60502b0dfe825c31f601d33939eaff",
  "bootstrap_bundle_sha256": "4e060c72d931d8e6b28cc688f8d3ea664143078fefee826b966b1d92d35aa773"
}
```

This marker authorizes exactly one execution of:

`node scripts/control-plane-bootstrap/bootstrap.mjs --execute`

### One-shot law

Before any mutation, runtime must independently revalidate:

- newest GPT authority is AR-1299A,
- exact Worker source HEAD is `94fd175adc60502b0dfe825c31f601d33939eaff`,
- exact bundle digest is `4e060c72d931d8e6b28cc688f8d3ea664143078fefee826b966b1d92d35aa773`,
- frozen queue identity and 8/0/README_ONLY state,
- #4 is not already claimed,
- the derived branch namespace is collision-free.

If any preflight check fails, **do not write the claim and do not execute**. Report the refusal.

If the #4 claim is written, #4 is SPENT FOREVER even if a later step fails. No retry and no second execute under this authorization.

## 5. REQUIRED PHASE-1 EXECUTION

If preflight passes, execute bootstrap #4 once. Expected sequence:

1. atomically write the shared #4 claim before mutation;
2. create the AR-1278 / #4 flat branch and sibling worktree;
3. materialize the local all-tools control-plane guard;
4. prove the doorway with zero-model `--init-only`;
5. launch the protected top-level seat hands-free with `user,local` setting sources;
6. protected seat reads AR-1299A through the exact fixed authority-read Bash command;
7. repair only the authorized Worker-1 G2 execution configuration, including `g2_precall.enabled=true`, `g2_precall.strict_session=true`, and the intended PowerShell closure;
8. materialize and verify the deterministic 8-row G2 prompt transport;
9. run only the bounded allowed tests;
10. write the Phase-1 closeout report and transient commit-message file;
11. never stage the transient commit-message file;
12. stage only authorized persistent paths;
13. finalize only through `node scripts/control-plane-bootstrap/cp-finalize.mjs`;
14. cp-finalize commits, pushes the control-plane branch, and writes the trusted completion receipt;
15. bootstrap supervisor accepts completion only if launch + identity + branch + valid 40-hex commit SHA + `pushed:true` all verify.

The privileged seat must make **zero Agent, Task, or PowerShell calls** and must make **zero frozen G2 model calls**.

## 6. WHAT THIS DOES NOT AUTHORIZE

This marker does NOT authorize:

- frozen G2 execution,
- any retry of bootstrap #4,
- Phase 2 Agent traversal calibration,
- compiler/backtest/paper/broker/live-money work,
- permanent model-router implementation,
- optional control-plane hardening.

After Phase 1 succeeds and GPT independently verifies the pushed control-plane branch/receipt, the next step is the already-planned fresh ordinary Worker-1 Phase 2 cheap NON-G2 live traversal proof. Do not combine Phase 2 into this privileged session.

## SPEED LAW

**Execute the authorized path. Do not reopen passed F26-F30 or invent another hardening packet unless execution reveals a new defect that directly prevents or invalidates Phase 1.**

## END STATE

- F26 = PASS
- F27 = PASS
- F28 = PASS
- F29 = PASS
- F30 = PASS
- bootstrap #1/#2/#3 = spent historical
- bootstrap #4 = EXECUTABLE / unspent until claim
- target packet = AR-1278
- frozen G2 = 8 READY / 0 SPENT
- next = bootstrap #4 Phase 1 execution exactly once
