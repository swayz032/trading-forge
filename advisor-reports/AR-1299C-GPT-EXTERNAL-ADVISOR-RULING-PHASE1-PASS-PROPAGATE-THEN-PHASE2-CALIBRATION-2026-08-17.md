# GPT EXTERNAL ADVISOR RULING — AR-1299C

## VERDICT

**AR-1299B / bootstrap authorization `cpb-2026-08-17-0004` = PASS. AR-1278 Phase 1 completed successfully on the pushed control-plane branch. The protected seat launched, made the two required Worker-1 guard/config changes, materialized the exact eight frozen prompt-transport artifacts, ran the bounded bootstrap suite, finalized through the trusted commit/push path, and pushed commit `f60a6abf5064bd3ecd8072454c4ac4d6d18834dc`. The frozen G2 queue remains 8 READY / 0 SPENT.**

There is **no new control-plane hardening packet**. The next move is transition, not redesign:

1. propagate the already-reviewed Phase-1 commit into the Worker-1 branch **without retyping or modifying its semantics**;
2. launch one **fresh ordinary Worker-1 seat** from that propagated state;
3. run exactly one cheap NON-G2 Agent traversal calibration whose required outcome is **PreToolUse DENY before any subagent model execution**;
4. re-prove frozen state 8/0 and stop for GPT grade.

No frozen G2 call is authorized by this ruling.

---

## 1. INDEPENDENT GITHUB EVIDENCE — PHASE 1 PASS

### Pushed branch identity

GitHub independently shows:

- branch: `control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004`
- tip: `f60a6abf5064bd3ecd8072454c4ac4d6d18834dc`

This exactly matches the Worker-1 completion report.

### Exact Phase-1 diff

`compare(94fd175adc60502b0dfe825c31f601d33939eaff..f60a6abf5064bd3ecd8072454c4ac4d6d18834dc)` is one commit and contains only:

- `.claude/settings.json`
- `.claude/worker1-hook-guard-manifest.json`
- 8 deterministic prompt files under `docs/replay-results/g2d-prompt-transport/`
- `docs/replay-results/g2d-prompt-transport/index.json`
- `docs/replay-results/worker-advisor-reports/AR-1278-PHASE-1-CLOSEOUT-cpb-2026-08-17-0004.md`

No queue file, isolated-receipt file, native-call manifest, compiler, backtester, paper, broker, or live-money file changed.

### Guard/config repair

At `f60a6abf...`:

- `.claude/settings.json` PreToolUse matcher is exactly:

  `Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell`

- `.claude/worker1-hook-guard-manifest.json` has:

  `g2_precall.enabled = true`

  `g2_precall.strict_session = true`

This closes the PowerShell registration gap and arms the dedicated strict session so every Agent/Task dispatch requires a valid frozen G2 permit.

### Prompt-transport identity

`docs/replay-results/g2d-prompt-transport/index.json` contains exactly `row_count = 8` and the same eight condition refs as the frozen queue.

For all eight rows, the transport SHA and native-call SHA independently match `native_call_manifest_t1.json`.

The frozen native-call manifest remains:

- `model = opus`
- `subagent_type = general-purpose`
- `call_count = 8`
- queue SHA256 = `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`

Therefore the control-plane repair did **not** silently reroute the frozen eight to Haiku or Sonnet. The frozen experiment pin remains Opus.

### Frozen post-state

At pushed Phase-1 tip `f60a6abf...`:

- queue contains 8 unresolved rows;
- `attempts = {}`;
- `max_attempts_per_condition = 1`;
- isolated receipt directory contains only `README.md`.

Therefore:

**FROZEN G2 = 8 READY / 0 SPENT.**

### Tests / CI wording

The privileged-seat closeout reports:

`node --test scripts/control_plane_bootstrap.test.mjs` -> `152/152` green.

GitHub exposes no CI status checks/workflow runs for this work. Treat `152/152` as local execution evidence, not CI.

### Completion

Worker-1 reports the one-shot execution returned:

- `authorization_spent = true`
- `doorway.ok = true`
- `launch.ok = true`
- `completion.pushed = true`
- `completion_verified = true`
- `completion_failure_reason = null`

The externally visible GitHub branch tip independently equals the claimed completion commit. This is sufficient to accept the Phase-1 terminal push result; the Git-common-dir claim/armed/completion receipt files are local execution artifacts and are not independently visible through GitHub.

`cpb-2026-08-17-0004` is now permanently SPENT. It must never be retried.

---

## 2. TRANSITION FACT — WORKER-1 BRANCH HAS NOT YET INGESTED PHASE 1

Current Worker-1 branch tip after its completion report is:

`c124689e4b9cf26546f698b4169fe22684e27c8f`

At that tip, GitHub independently still shows:

- `g2_precall.strict_session = false`
- PreToolUse matcher = `Edit|Write|NotebookEdit|Bash|Agent|Task`

Therefore a fresh ordinary Worker-1 seat **must not** run the Phase-2 calibration from `c124689e...` as-is. The successful protected-seat state must be propagated first.

This is not a new engineering problem and not authorization to reimplement the changes.

---

# PHASE 2 AUTHORIZATION — EXACT PROPAGATION, THEN ONE LIVE DENY CALIBRATION

## 3. STEP A — PROPAGATE THE REVIEWED PHASE-1 COMMIT EXACTLY

Source of truth:

- source branch: `origin/control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004`
- source commit: `f60a6abf5064bd3ecd8072454c4ac4d6d18834dc`
- target branch: `claude/worker1-h1-20260815`

Use an integration path that preserves the reviewed bytes exactly (merge or cherry-pick is acceptable). **Do not manually retype the `.claude` changes or prompt artifacts.**

Because `.claude/settings.json` and `.claude/worker1-hook-guard-manifest.json` are self-protected Worker-1 control files, an ordinary Worker-1 model seat must not bypass or weaken its guard to perform this propagation. If the existing guarded seat refuses the integration, that refusal is correct; use the normal operator/main-advisor/control-plane integration authority rather than changing the guard.

Before launching the fresh Phase-2 Worker-1 seat, independently prove on the Worker-1 branch:

1. `strict_session = true`;
2. PowerShell is present in the PreToolUse matcher;
3. `docs/replay-results/g2d-prompt-transport/index.json` has 8 rows;
4. the eight prompt files exist with the reviewed hashes;
5. frozen queue remains `attempts = {}` and 8 READY / 0 SPENT;
6. isolated receipt directory remains README-only;
7. no semantic/config divergence from `f60a6abf...` exists in the Phase-1 paths.

If propagation cannot be completed exactly, **STOP and report**. Do not author a substitute repair.

---

## 4. STEP B — FRESH ORDINARY WORKER-1 SESSION ONLY

After propagation, start a **fresh** ordinary Worker-1 Claude Code session from `claude/worker1-h1-20260815`.

Do not reuse the pre-propagation session.

Required SessionStart evidence:

- correct Worker-1 branch;
- current propagated branch tip;
- guard armed normally;
- `g2_precall.enabled = true`;
- `g2_precall.strict_session = true`;
- PowerShell matcher present.

No privileged control-plane seat is authorized in Phase 2.

---

## 5. THE ONE LIVE AGENT TRAVERSAL CALIBRATION

Purpose: prove the real Worker-1 PreToolUse registration now intercepts Agent dispatch under `strict_session=true` **before model execution**.

Run **exactly one** NON-G2 Agent call.

Use the cheapest appropriate model:

`model = haiku`

Use a clearly non-G2 calibration prompt, for example a request to return one harmless literal such as `PHASE2_CALIBRATION_SHOULD_NOT_RUN`. The call must:

- NOT use any frozen prompt transport artifact;
- NOT name any G2 permit file;
- NOT carry `G2D-PERMIT:` in its description;
- NOT match any of the eight frozen `native_call_sha256` identities;
- NOT touch the frozen queue or receipt namespace.

### Required outcome

**PreToolUse DENY before the Agent/subagent model executes.**

Evidence must include the guard denial / refusal from the Agent dispatch path.

If any Agent model answer returns — even a harmless answer — the calibration is **RED**. Stop immediately. Do not retry.

One attempt means one attempt. No second Agent call, no mutation loop, no “try again with a different description.”

This calibration does not spend a frozen G2 attempt because it has no valid frozen permit/native-call identity. If it causes any frozen attempt/receipt mutation, that is RED and must stop.

---

## 6. ZERO-MODEL CONTROLS AFTER THE DENY

After the single Agent DENY, perform only read-only / zero-model checks needed to close Phase 2:

1. frozen queue still contains the same 8 refs;
2. `attempts = {}`;
3. isolated receipt directory is still README-only;
4. native-call manifest remains byte-identical;
5. `strict_session = true` remains armed;
6. PowerShell remains registered through PreToolUse;
7. prompt transport index remains 8 rows with the reviewed hashes.

If a real PowerShell tool is present in the Worker-1 tool registry, one **harmless zero-model** PowerShell denial control is permitted only if it can be invoked without weakening the one-Agent rule; expected outcome is guard DENY before command execution. If no PowerShell tool exists, record `tool absent` and do not synthesize another mechanism merely to create a test.

Do not call Task merely for symmetry if the runtime still has no Task tool.

---

## 7. PHASE-2 REPORT / STOP

Write one Worker-1 report containing:

- propagated Worker-1 branch tip;
- exact integration relationship to `f60a6abf...`;
- SessionStart guard evidence;
- `strict_session=true` evidence;
- PowerShell matcher evidence;
- the one Agent calibration tool input metadata (model, subagent type, description/prompt identity enough to prove it is NON-G2; do not paste frozen prompt content);
- exact guard DENY result;
- explicit statement whether any Agent model answer returned;
- post-calibration frozen state;
- prompt transport index/hash proof;
- any PowerShell zero-model control result if applicable;
- local tests run, clearly labeled local rather than CI.

Then STOP for GPT grade.

---

## 8. FORBIDDEN IN THIS RULING

Until GPT grades Phase 2:

- NO frozen G2 Opus call;
- NO G2 permit creation for any of the eight;
- NO isolated answer receipt creation;
- NO retry of `cpb-2026-08-17-0004`;
- NO new bootstrap authorization;
- NO privileged control-plane seat;
- NO Agent call beyond the single cheap NON-G2 calibration;
- NO Task/subagent experiments;
- NO compiler/backtest/paper/broker/live-money work;
- NO permanent model-router implementation;
- NO optional control-plane hardening;
- NO deletion/cleanup of #1/#2/#3/#4 forensic claim state.

---

## 9. SPEED LAW

**The control-plane engineering phase is closed unless Phase 2 exposes a direct execution failure. Do not invent another hardening cycle.**

If Phase 2 proves the one Agent dispatch is denied before model execution and frozen state remains 8/0, the next GPT ruling should authorize the **eight frozen original Opus calls**, one-shot each, under their frozen native identities.

---

## END STATE

- AR-1299B / bootstrap #4 = PASS
- Phase 1 = COMPLETE
- pushed Phase-1 commit = `f60a6abf5064bd3ecd8072454c4ac4d6d18834dc`
- bootstrap #4 = SPENT, never retry
- Worker-1 propagation = REQUIRED BEFORE Phase 2
- Phase 2 = AUTHORIZED after exact propagation
- one cheap NON-G2 Haiku Agent traversal = AUTHORIZED, expected DENY before model execution
- frozen G2 = 8 READY / 0 SPENT
- frozen Opus calls = NOT YET AUTHORIZED
- next = exact propagation -> fresh Worker-1 -> one Agent DENY proof -> report -> GPT grade
