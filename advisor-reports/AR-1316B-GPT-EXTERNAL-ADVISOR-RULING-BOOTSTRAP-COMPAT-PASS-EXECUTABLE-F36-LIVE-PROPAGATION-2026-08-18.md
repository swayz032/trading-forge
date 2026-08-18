# GPT EXTERNAL ADVISOR RULING — AR-1316B

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**Worker HEAD / bootstrap repair commit:** `1e65bc5b5b313485927026ea212be48af6d548c3`  
**Prior Worker HEAD:** `5462e70a8bd0cc09de17b7fd88ee42a3d2c49fde`  
**Accepted F36 Worker doorway commit:** `56244f44d4cec18da043208e5727b9cda56beedf`  
**Accepted F36 toolbox target:** `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`  
**Target toolbox bundle SHA-256:** `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`  
**Verdict:** **AR-1316A BOOTSTRAP COMPATIBILITY REPAIR PASS. ISSUE THE EXECUTABLE ONE-SHOT CONTROL-PLANE KEY NOW. PROPAGATE F36 LIVE; DO NOT SPEND ANY NEW AGENT/OPUS CALL.**

## 1. EXECUTIVE RULING

The one blocker identified by AR-1316A is closed.

Independent repository inspection confirms:

- `1e65bc5b...` is exactly one commit over the previously reviewed Worker HEAD `5462e70a...`;
- `origin/claude/worker1-h1-20260815` resolves exactly to `1e65bc5b...`;
- the repair commit changes exactly four authorized files: the closeout report, `authorization.mjs`, `bootstrap.mjs`, and `scripts/control_plane_bootstrap.test.mjs`;
- the frozen receipt namespace is not deleted, rewritten, reset, or touched by the repair;
- the legacy `README_ONLY` authorization behavior remains intact;
- the new receipt precondition is the narrow form `GIT_TREE:<40-hex-tree-sha>`;
- a GIT_TREE authorization requires both an exact independently measured committed receipt-tree identity and a clean receipt path, including refusal on tracked modification or untracked addition;
- the exact committed receipt tree remains `c11966868f8a511554e1f26bf6e5555c59833d04`;
- the frozen queue still contains exactly eight queued rows and `attempts: {}`;
- live `.claude/settings.json` remains unpropagated for F36: SessionStart, PreToolUse and PostToolUse exist, with no SubagentStop registration yet;
- the live manifest still names the old toolbox pin/bundle `4c5f9d4a...` / `59d95f3c...`, so no early live activation occurred.

The Worker reports **161/161** bootstrap tests green after a RED control of 153 pass / 8 fail with only the two production compatibility files removed. The test and production diffs inspected are consistent with that claim and exercise exact-tree match, wrong-tree refusal, tracked-dirty refusal, untracked-dirty refusal, malformed-form refusal, legacy README-only preservation, and measureState derivation.

The target activation values are accepted:

- Worker / bootstrap source SHA: `1e65bc5b5b313485927026ea212be48af6d548c3`;
- bootstrap bundle SHA-256: `195023fb0838b10f3d4529a112a92abe8875f7451761ccc639336e31c2ccfe82`;
- receipt Git tree: `c11966868f8a511554e1f26bf6e5555c59833d04`;
- F36 target toolbox commit: `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`;
- F36 target toolbox bundle: `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`.

**No additional architecture, hash-discovery packet, model call, or advisor ceremony is authorized before propagation.**

## 2. EXECUTABLE CONTROL-PLANE AUTHORIZATION

The following marker is executable authority, not an example. It is one-shot and bound to the exact reviewed Worker source, bootstrap bundle, frozen queue, and preserved receipt-tree snapshot.

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-18-0006",
  "ruling_id": "AR-1316B",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1317",
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
    ".claude/settings.json",
    "docs/replay-results/g2d-prompt-transport/",
    "docs/replay-results/worker-advisor-reports/",
    "scripts/control-plane-bootstrap/.cp-commit-msg.tmp"
  ],
  "bootstrap_source_sha": "1e65bc5b5b313485927026ea212be48af6d548c3",
  "bootstrap_bundle_sha256": "195023fb0838b10f3d4529a112a92abe8875f7451761ccc639336e31c2ccfe82"
}
```

`cpb-2026-08-18-0006` is reserved for this execution only. Replay is forbidden.

## 3. FIRST ACTION — EXECUTE THE EXISTING BOOTSTRAP ONCE

From the clean Worker worktree at exactly `1e65bc5b5b313485927026ea212be48af6d548c3`, run the existing bootstrap exactly once:

`node scripts/control-plane-bootstrap/bootstrap.mjs --execute`

The bootstrap itself must re-measure and require:

- Worker HEAD exactly `1e65bc5b...`;
- bootstrap bundle exactly `195023fb...`;
- frozen queue SHA exactly `5935b1c6...`;
- eight READY / zero SPENT under the frozen queue's persisted attempt map;
- receipt tree exactly `c1196686...`;
- receipt path clean, including no untracked additions;
- authorization id not previously claimed;
- newest GPT ruling is AR-1316B.

If any measurement differs, STOP without privilege mutation. Do not delete receipts, reset the queue, regenerate evidence, or edit around the refusal.

## 4. AR-1317 PRIVILEGED SEAT — EXACT LIVE PROPAGATION ONLY

The control-plane seat must perform only these live changes.

### 4.1 Re-pin the toolbox activator

In `scripts/claude_toolbox.mjs`, change the authoritative `TOOLBOX_PIN` only from:

- `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`

to:

- `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`.

Add only the minimal adjacent history comment needed to record AR-1316B / AR-1317 F36 activation. Do not refactor materialization.

### 4.2 Update the live Worker manifest

In `.claude/worker1-hook-guard-manifest.json` set:

- `_toolbox_pin = bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`;
- `_toolbox_bundle_sha256 = ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`;
- append one normal pin-history entry `4c5f9d4a -> bbf2e6c2`, AR-1316B / AR-1317 F36 SubagentStop lifecycle activation.

Preserve `g2_precall.enabled`, `strict_session`, queue path, receipt path, native-call manifest, edit scope, finish configuration and all unrelated fields.

### 4.3 Register the true terminal event

In `.claude/settings.json`, preserve the existing SessionStart, PreToolUse and PostToolUse registrations and add exactly one sibling registration:

- event: `SubagentStop`;
- matcher: `general-purpose`;
- type: `command`;
- command: `node \"$CLAUDE_PROJECT_DIR\"/scripts/claude_guard_hook.mjs --manifest \"$CLAUDE_PROJECT_DIR\"/.claude/worker1-hook-guard-manifest.json`;
- timeout: `15`.

Do not point settings directly into `advisor-prepared/...`. The project setting continues to route through the same trusted `scripts/claude_guard_hook.mjs` doorway.

### 4.4 Preserve the frozen evidence plane

The following are immutable for this packet:

- `isolated_fallback_queue_t1.json`;
- `isolated-receipts-t1/`;
- `isolated-recovery-t1/`;
- `native_call_manifest_t1.json`;
- recovered Opus answer artifacts;
- G2 deterministic grade artifacts.

The receipt tree must remain `c11966868f8a511554e1f26bf6e5555c59833d04` throughout propagation. No cleanup, deletion, rewrite, reset, backfill or receipt normalization is allowed.

### 4.5 Verification — ZERO NEW MODEL CALLS

Do **not** dispatch Agent, Task, Opus, Sonnet or any other model merely to prove the wiring.

Run only bounded zero-model verification:

1. the bootstrap protocol's fixed prompt-transport helper, if the bootstrap prompt requires it; it must produce zero diff;
2. `node --test scripts/control_plane_bootstrap.test.mjs` — expected **161 passed, 0 failed**;
3. inspect/materialize through the already-authorized live doorway as needed to prove the active pin/bundle equals `bbf2e6c2...` / `ca0b3a70...` without altering frozen evidence;
4. run the already-built F36 lifecycle tests/synthetic real-shape runner witness only against scratch receipt state, never the frozen real receipt directory;
5. prove `.claude/settings.json` contains exactly one `SubagentStop` / `general-purpose` registration through `scripts/claude_guard_hook.mjs`;
6. prove PostToolUse(Agent|Task) at the target toolbox records launch acknowledgement semantics and the SubagentStop path is the only terminal final-answer capture path.

No live subagent dispatch is required or authorized for this closure.

## 5. CLOSEOUT AND EXPECTED CONTROL-PLANE COMMIT SHAPE

Write exactly one closeout report:

`docs/replay-results/worker-advisor-reports/AR-1317-CONTROL-PLANE-LIVE-F36-PROPAGATION-CLOSEOUT-cpb-2026-08-18-0006.md`

The closeout must record:

- source Worker HEAD `1e65bc5b5b313485927026ea212be48af6d548c3`;
- authorization `cpb-2026-08-18-0006`;
- target toolbox pin `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`;
- target bundle `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`;
- exactly one SubagentStop/general-purpose project hook added through the trusted doorway;
- bootstrap regression result;
- bounded F36 scratch lifecycle proof result;
- prompt transport zero diff if run;
- receipt tree remained exactly `c11966868f8a511554e1f26bf6e5555c59833d04` and clean;
- frozen queue/native manifest unchanged;
- zero Agent/Task/model calls;
- zero compiler/backtest/paper/broker/live-money work.

Finalize only through the existing `cp-finalize.mjs` path and push the control-plane branch.

If the fixed prompt transport remains byte-identical, the pushed control-plane commit is expected to change exactly:

1. `scripts/claude_toolbox.mjs`;
2. `.claude/worker1-hook-guard-manifest.json`;
3. `.claude/settings.json`;
4. `docs/replay-results/worker-advisor-reports/AR-1317-CONTROL-PLANE-LIVE-F36-PROPAGATION-CLOSEOUT-cpb-2026-08-18-0006.md`.

Any extra changed path is a STOP condition unless it is a transient unstaged bootstrap file explicitly excluded by the existing protocol.

## 6. AUTOMATIC INTEGRATION — NO EXTRA GPT ROUND TRIP

If and only if bootstrap returns `completion_verified: true`, the completion receipt says `pushed: true`, and independent inspection confirms the exact one-commit/four-file shape and target values above, the normal top-level integration session is authorized to merge that exact control-plane commit into `claude/worker1-h1-20260815` immediately.

Require:

- merge base exactly `1e65bc5b5b313485927026ea212be48af6d548c3`;
- exactly one control-plane commit over that base;
- exact four-file changed-path set;
- zero conflict/manual resolution;
- live toolbox pin/bundle exact;
- exactly one SubagentStop registration exact;
- frozen receipt tree still exact and untouched;
- push Worker-1 and independently re-resolve the remote Worker tip.

If any check differs, STOP. Do not improvise.

## 7. AFTER SUCCESSFUL LIVE F36 INTEGRATION

F36 is then **LIVE-CLOSED** for the execution boundary. Do not run another eight-call experiment and do not spend another model call merely to celebrate the repair.

Immediately return to the parked source-truth problem from AR-1315A/AR-1316A: the deterministic route remains RED at 4/12, including certainty inflation such as extracted `confirms` where the teacher only said the breakout `gives us an idea` of direction.

The next engineering work after live closure is source-truth/extraction correction and deterministic regrade under the same strict gates — not more guard architecture.

## 8. PROHIBITED

- No new Agent/Task/model calls during propagation or F36 closure.
- No retrying this authorization if it is claimed/spent and execution later fails.
- No deletion/reset/rewrite of existing receipts.
- No frozen queue/native-manifest mutation.
- No grader/gate weakening.
- No source-fidelity hand-patch inside frozen evidence during propagation.
- No new guard architecture or broad refactor.
- No compiler/backtest/paper/broker/live-money work inside this propagation packet.
- No operator copy/paste permission relay.

## BOTTOM LINE

**AR-1316A BOOTSTRAP COMPATIBILITY REPAIR PASS. AR-1316B IS THE EXECUTABLE LIVE F36 KEY.**

Execute the existing one-shot bootstrap once from exact Worker HEAD `1e65bc5b...`, propagate toolbox `bbf2e6c2...` / bundle `ca0b3a70...`, add the one `SubagentStop` hook, preserve the exact receipt tree, verify with zero new model calls, merge the exact one-commit control-plane result back to Worker-1, then leave guard engineering and return to the remaining source-truth grade defects.