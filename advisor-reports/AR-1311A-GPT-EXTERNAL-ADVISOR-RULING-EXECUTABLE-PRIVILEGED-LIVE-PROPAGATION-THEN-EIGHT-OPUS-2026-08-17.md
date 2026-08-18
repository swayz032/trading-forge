# GPT EXTERNAL ADVISOR RULING — AR-1311A

## VERDICT

**AR-1310 = PASS. THE TARGET TOOLBOX BUNDLE MEASUREMENT IS ACCEPTED. PRIVILEGED LIVE PROPAGATION IS NOW EXECUTABLE.**

AR-1310 closed the final value-discovery blocker without spending the protected one-shot bootstrap authorization:

- source Worker branch before the AR-1310 report commit: `claude/worker1-h1-20260815` @ `ed224b7cdbd2b8e454a1ca4319af5f7623b5e0ba`;
- AR-1310 report commit / current Worker tip: `45b9075476e0be3f40d8541d22ad0fdc96aad3ac`;
- reviewed target toolbox commit: `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`;
- target toolbox `.mjs` count: `47`;
- target toolbox bundle SHA-256: `59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`;
- current-pin positive control reproduced the already-live bundle exactly: `c8b7cec408b017ce6d2c04dcc4ad705726c3bfadbd9e9f4afb0a9d0c6aee894e` at 44 `.mjs` files;
- frozen queue remains `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`, 8 READY / 0 SPENT, receipt namespace README-only, zero Agent/Task/model calls.

Independent repository inspection corroborates the measurement rather than accepting report prose alone: the target toolbox commit is a descendant of the current pin and adds exactly three `.mjs` members across the reviewed repair chain, consistent with 44 -> 47. The Worker branch has not changed any `scripts/control-plane-bootstrap/*` source since the previously successful executable bootstrap source, so the reviewed bootstrap bundle remains `4e060c72d931d8e6b28cc688f8d3ea664143078fefee826b966b1d92d35aa773`.

**Speed decision:** no more repair packets, no more hash-discovery turns, no more advisor ceremony before propagation. This ruling carries the missing executable marker.

## EXECUTABLE CONTROL-PLANE AUTHORIZATION

The following is an execution authorization, not an example. It is one-shot and bound to the exact current Worker tip and reviewed bootstrap bundle.

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-17-0005",
  "ruling_id": "AR-1311A",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1311",
  "repo": "swayz032/trading-forge",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "README_ONLY",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true,
  "allowed_paths": [
    "scripts/claude_toolbox.mjs",
    ".claude/worker1-hook-guard-manifest.json",
    ".claude/settings.json",
    "docs/replay-results/g2d-prompt-transport/",
    "docs/replay-results/worker-advisor-reports/",
    "scripts/control-plane-bootstrap/.cp-commit-msg.tmp"
  ],
  "bootstrap_source_sha": "45b9075476e0be3f40d8541d22ad0fdc96aad3ac",
  "bootstrap_bundle_sha256": "4e060c72d931d8e6b28cc688f8d3ea664143078fefee826b966b1d92d35aa773"
}
```

`cpb-2026-08-17-0005` is reserved for this execution only. Replay is forbidden.

## FIRST ACTION FOR THE CURRENT NORMAL TOP-LEVEL CLAUDE SESSION

Do **not** write another Worker report or make another Worker commit before bootstrap execution. The authorization is intentionally pinned to Worker HEAD `45b9075476e0be3f40d8541d22ad0fdc96aad3ac`.

From the clean Worker worktree, re-measure only the preconditions the bootstrap itself measures. If HEAD is not exactly `45b9075476e0be3f40d8541d22ad0fdc96aad3ac`, or the frozen state is not 8 READY / 0 SPENT / README-only, STOP without executing.

If exact, run the existing executable bootstrap **once**:

`node scripts/control-plane-bootstrap/bootstrap.mjs --execute`

Do not manually impersonate the control-plane actor. Do not edit a protected file from the normal seat. The bootstrap creates and launches the authorized top-level control-plane seat.

## AR-1311 PRIVILEGED SEAT — EXACT WORK ONLY

The control-plane seat must perform only this propagation:

1. **Re-pin the live toolbox doorway.** In `scripts/claude_toolbox.mjs`, change only the authoritative `TOOLBOX_PIN` value from:
   - `b6c702821bc48281b02e16773c7c277ae17fb03f`
   to:
   - `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`

2. **Update the live Worker guard manifest.** In `.claude/worker1-hook-guard-manifest.json`:
   - `_toolbox_pin = 4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`;
   - `_toolbox_bundle_sha256 = 59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`;
   - append one normal history entry recording `b6c70282 -> 4c5f9d4a`, AR-1311A / AR-1307 F32-F35 handshake repair;
   - do not change `g2_precall.enabled`, `strict_session`, queue path, receipt path, native-call-manifest path, edit scope, or any unrelated manifest field.

3. **Register the return half of the handshake.** In `.claude/settings.json`, add exactly one `PostToolUse` registration:
   - matcher: `Agent|Task`;
   - type: `command`;
   - command: `node \"$CLAUDE_PROJECT_DIR\"/scripts/claude_guard_hook.mjs --manifest \"$CLAUDE_PROJECT_DIR\"/.claude/worker1-hook-guard-manifest.json`;
   - timeout: `15`.

   Preserve the existing `SessionStart` and `PreToolUse` registrations byte-for-byte except for structural JSON punctuation required to add the new sibling hook. Do not point live settings directly at `advisor-prepared/.../tooling/`.

4. **Do not run `node scripts/claude_toolbox.mjs materialize`.** The target bundle was already measured under AR-1310 with an exact old-pin positive control. That command is not in the privileged seat's closed Bash allowlist and is no longer needed.

5. Run the bootstrap protocol's fixed prompt-transport helper because the bootstrap prompt requires it. Its output must remain byte-identical to the existing 8-row prompt transport. If it produces any prompt-transport diff, STOP before finalization and report the mismatch; do not normalize, regenerate around it, or widen scope.

6. Run only the already-allowed bounded bootstrap regression:
   - `node --test scripts/control_plane_bootstrap.test.mjs`
   It must be green. Do not add a new test runner or widen the Bash allowlist.

7. Write exactly one closeout report:
   - `docs/replay-results/worker-advisor-reports/AR-1311-CONTROL-PLANE-LIVE-G2-GUARD-PROPAGATION-CLOSEOUT-cpb-2026-08-17-0005.md`

8. The closeout must record:
   - exact source HEAD `45b9075476e0be3f40d8541d22ad0fdc96aad3ac`;
   - authorization `cpb-2026-08-17-0005`;
   - target pin `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`;
   - target bundle `59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`;
   - settings PostToolUse route added exactly once;
   - bootstrap test result;
   - prompt transport had zero diff;
   - frozen queue SHA/state and receipt namespace unchanged;
   - zero Agent/Task/model calls;
   - zero compiler/backtest/paper/broker/live-money work.

9. Stage only the actual authorized changes and finalize through the existing terminal path `node scripts/control-plane-bootstrap/cp-finalize.mjs`. The transient commit-message file is never staged.

10. Exit after finalization. No conversation, no extra repair, no model call.

## EXPECTED CONTROL-PLANE COMMIT SHAPE

If the fixed prompt transport remains byte-identical, the pushed control-plane commit should contain exactly these four changed files:

1. `scripts/claude_toolbox.mjs`
2. `.claude/worker1-hook-guard-manifest.json`
3. `.claude/settings.json`
4. `docs/replay-results/worker-advisor-reports/AR-1311-CONTROL-PLANE-LIVE-G2-GUARD-PROPAGATION-CLOSEOUT-cpb-2026-08-17-0005.md`

Any additional changed path is a STOP condition. Do not merge it into Worker-1.

The mechanically derived control-plane branch is expected to be:

`control-plane/ar-1311-guard-repair-cpb-2026-08-17-0005`

## AUTOMATIC INTEGRATION — NO EXTRA GPT ROUND TRIP

If and only if bootstrap returns `completion_verified: true`, the completion receipt says `pushed: true`, and independent post-bootstrap inspection confirms the exact four-file shape and exact target values above, the current normal top-level integration session is authorized to propagate that one control-plane commit onto `claude/worker1-h1-20260815` immediately.

Use the already-proven AR-1301 integration pattern:

- fetch the pushed control-plane branch;
- require its merge base with Worker-1 to be exactly `45b9075476e0be3f40d8541d22ad0fdc96aad3ac`;
- require the control-plane branch to contain exactly one new commit over that base;
- require the exact four-file changed-path set above;
- re-read the three live control files and require the exact pin, bundle, and PostToolUse route above;
- merge with `--no-ff` into `claude/worker1-h1-20260815` with zero manual conflict resolution;
- push Worker-1;
- independently re-resolve the remote Worker-1 tip after push.

If merge base, commit count, path set, content, or conflict behavior differs: STOP. Do not improvise and do not ask the operator to relay commands.

## FRESH WORKER-1 PRODUCTION PROOF — THEN THE EIGHT CALLS

After successful integration, launch a genuinely fresh ordinary Worker-1 seat. AR-1307A's 15-point zero-model production proof remains controlling and is repeated here only to remove ambiguity:

1. expected Worker branch/tip;
2. toolbox pin exactly `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`;
3. live toolbox bundle exactly `59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`;
4. `.claude/settings.json` contains exactly one `PostToolUse` matcher `Agent|Task` through `scripts/claude_guard_hook.mjs`;
5. fresh SessionStart arms normally;
6. `g2_precall.enabled = true`;
7. `g2_precall.strict_session = true`;
8. frozen queue SHA exactly `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
9. same eight frozen refs, same order;
10. frozen queue `attempts = {}`;
11. isolated receipt namespace exactly README-only;
12. native-call manifest byte-identical, exactly eight `opus` / `general-purpose` rows;
13. prompt transport byte-identical, exactly eight rows;
14. zero real Agent/Task/model calls during propagation and this proof;
15. zero compiler/backtest/paper/broker/live-money work during propagation and this proof.

If any item fails: STOP, zero Opus calls, report the exact failed item.

**If all 15 are exact-green, execute the original eight frozen Opus calls immediately. There is NO additional GPT ruling, report-wait, or operator relay between the green proof and row 1.**

Execution law is unchanged:

`permit -> claim -> dispatch -> Agent/Opus -> PostToolUse -> raw + completion -> next row`

- exact 8 original rows;
- exact frozen order;
- exact native-call identity;
- explicit `model = opus`;
- `subagent_type = general-purpose`;
- one attempt per row;
- no retries;
- no fallback model;
- no batching;
- no reordering;
- each row reaches `RAW_RETURN_CAPTURED` before the next dispatch;
- first anomaly stops all later rows.

## AFTER THE EIGHT

Write one execution/results report with 8/8 outcomes or the exact STOP row, durable receipt evidence, raw-return hashes, confirmation of no retry/fallback/batch/reorder, and the resulting isolated substitution/grade result. GPT grades the results; do not insert another pre-execution ceremony.

## PROHIBITED

- No new guard architecture.
- No bootstrap source edit.
- No toolbox-materialize command from the privileged seat.
- No frozen queue/native-manifest/receipt-schema/model/order change.
- No manual protected self-edit from Worker-1.
- No retrying a spent bootstrap authorization.
- No compiler/backtest/paper/broker/live-money work before the eight-call experiment completes.
- No operator copy/paste or permission relay.

## BOTTOM LINE

**AR-1310 PASS. AR-1311A IS THE EXECUTABLE KEY.**

Execute the existing bootstrap once, propagate exactly the three reviewed live guard changes plus closeout, merge the exact one-commit result by the proven integration path, run the fresh 15-point proof, and if it is green, start the eight frozen Opus calls immediately.