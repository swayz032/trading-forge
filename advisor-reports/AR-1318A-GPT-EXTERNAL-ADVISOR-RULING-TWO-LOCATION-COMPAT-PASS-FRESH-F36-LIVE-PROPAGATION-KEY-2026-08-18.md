# GPT EXTERNAL ADVISOR RULING — AR-1318A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**Worker repair/report commit:** `3c2df1d04fe3374290c1720785257cf810481fbd`  
**Prior Worker HEAD:** `8ce6d1a1646984446fba38da79f514e998777141`  
**Prior failed authorization:** `cpb-2026-08-18-0006` — permanently spent; replay forbidden  
**Accepted F36 toolbox target:** `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`  
**Accepted F36 toolbox bundle:** `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`  
**Verdict:** **AR-1318 PASS. BOTH REMAINING GIT_TREE SEAT-COMPATIBILITY GAPS ARE CLOSED IN ONE SHARED LAW. ISSUE A FRESH ONE-SHOT EXECUTABLE KEY NOW AND PROPAGATE F36 LIVE. NO NEW AGENT/OPUS CALL IS AUTHORIZED FOR THIS PROPAGATION.**

## 1. EXECUTIVE RULING

Independent repository inspection verifies the AR-1318 repair rather than accepting report prose alone.

The Worker branch is exactly one commit beyond the AR-1317 diagnostic source, and the commit changes only:

1. `scripts/control-plane-bootstrap/authorization.mjs`;
2. `scripts/control-plane-bootstrap/bootstrap.mjs`;
3. `scripts/control-plane-bootstrap/control-plane-guard.mjs`;
4. `scripts/control-plane-bootstrap/control-plane-seat-hook.mjs`;
5. `scripts/control_plane_bootstrap.test.mjs`;
6. the AR-1318 closeout report.

The two receipt-state gaps are both actually closed:

- `authorization.mjs` now exports one pure `checkReceiptState(requireReceipts, measured)` law for both legacy `README_ONLY` and exact `GIT_TREE:<40-hex>` state.
- `control-plane-seat-hook.mjs::verifyAuthorityIndependently()` now independently measures `receiptsGitTreeSha` and `receiptsClean` and passes both to `validateAuthorization()`, closing the earlier blocker GPT identified in AR-1317A.
- the immutable seat manifest now carries the exact validated `require_receipts` value, and the seat independently requires it to match the current GPT marker.
- `measureObservedIdentity()` independently measures the same receipt-tree identity and cleanliness with fail-closed defaults.
- `control-plane-guard.mjs::verifySeatIdentity()` no longer has a second README-only implementation; it calls the same shared `checkReceiptState()` law on every SessionStart and PreToolUse.
- a receipt namespace that becomes dirty after arming therefore denies the next tool call rather than remaining grandfathered green.
- the doorway diagnostic now preserves a bounded `--init-only` stdout tail when no armed receipt is minted, without changing launch arguments, setting sources, timeout, or the arming decision.

The regression suite contains the load-bearing positive and negative controls: valid GIT_TREE authority, wrong-tree refusal, tracked/untracked dirty refusal, manifest receipt-law mismatch refusal, seat identity GIT_TREE positive/negative paths, post-arm dirty denial, and the doorway diagnostic. The Worker reports RED `164/172` and GREEN `172/172`; inspected tests and code are consistent with that result.

The bootstrap fingerprint covers all four changed load-bearing production modules. The exact Worker-supplied target values accepted for this one-shot are:

- Worker/bootstrap source SHA: `3c2df1d04fe3374290c1720785257cf810481fbd`;
- bootstrap bundle SHA-256: `fa17a097329f057c3ac48956542f9066e3c5af550657a95f7b9eca407fe40347`;
- preserved receipt Git tree: `c11966868f8a511554e1f26bf6e5555c59833d04`, clean;
- frozen queue SHA-256: `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
- target F36 toolbox pin/bundle: `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198` / `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`.

Live Worker settings and manifest are still on the old state (`4c5f9d4a...` / `59d95f3c...`, no `SubagentStop` registration), proving there was no early activation.

**Speed ruling:** no more bootstrap repair packet, no more hash-discovery packet, and no extra architecture review before the next execution. The exact values now exist. Use them.

## 2. EXECUTABLE CONTROL-PLANE AUTHORIZATION

The following marker is executable authority, not an example. It is one-shot and bound to the exact reviewed Worker source, bootstrap bundle, frozen queue, and preserved receipt-tree snapshot.

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-18-0007",
  "ruling_id": "AR-1318A",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1319",
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
  "bootstrap_source_sha": "3c2df1d04fe3374290c1720785257cf810481fbd",
  "bootstrap_bundle_sha256": "fa17a097329f057c3ac48956542f9066e3c5af550657a95f7b9eca407fe40347"
}
```

`cpb-2026-08-18-0007` is reserved for this execution only. `cpb-2026-08-18-0006` remains spent and must never be reused.

## 3. FIRST ACTION — EXECUTE THE EXISTING BOOTSTRAP ONCE

From a clean `claude/worker1-h1-20260815` worktree, do not make another Worker commit first.

Run the existing read-only plan/preflight. It must independently measure all of the following exactly:

- Worker HEAD `3c2df1d04fe3374290c1720785257cf810481fbd`;
- bootstrap bundle `fa17a097329f057c3ac48956542f9066e3c5af550657a95f7b9eca407fe40347`;
- queue SHA `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
- 8 READY / 0 SPENT;
- receipt Git tree `c11966868f8a511554e1f26bf6e5555c59833d04` and clean;
- newest ruling `AR-1318A` carrying authorization `cpb-2026-08-18-0007`;
- no claim/replay for `cpb-2026-08-18-0007`;
- no branch-namespace collision for the mechanically derived target branch.

If any pre-claim measurement differs, STOP without execution. Do not alter state to make it match.

If exact, execute **once**:

`node scripts/control-plane-bootstrap/bootstrap.mjs --execute`

No manual protected-file edit and no manual impersonation of the control-plane actor.

## 4. AR-1319 PRIVILEGED SEAT — EXACT PROPAGATION ONLY

The privileged seat may perform only the already-reviewed F36 live wiring.

### A. Re-pin the live toolbox doorway

In `scripts/claude_toolbox.mjs`, change the authoritative `TOOLBOX_PIN` only from:

- `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`

to:

- `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`

Record the normal history/comment for AR-1318A / F36 lifecycle finality. Do not alter the materialization algorithm.

### B. Update the live Worker guard manifest

In `.claude/worker1-hook-guard-manifest.json`:

- `_toolbox_pin = bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`;
- `_toolbox_bundle_sha256 = ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`;
- append one normal toolbox-pin history entry naming the F36 lifecycle repair and this authorization.

Do **not** change `g2_precall.enabled`, `strict_session`, queue path, receipt path, native-call-manifest path, edit scope, finish law, or any unrelated manifest field.

### C. Add exactly one live `SubagentStop` project hook

In `.claude/settings.json`, preserve the existing SessionStart, PreToolUse, and PostToolUse registrations and add exactly one sibling registration:

- event: `SubagentStop`;
- matcher: `general-purpose`;
- type: `command`;
- command: `node \"$CLAUDE_PROJECT_DIR\"/scripts/claude_guard_hook.mjs --manifest \"$CLAUDE_PROJECT_DIR\"/.claude/worker1-hook-guard-manifest.json`;
- timeout: `15`.

Do not point live settings directly at `advisor-prepared/.../tooling/`. The trusted `scripts/claude_guard_hook.mjs` doorway remains the only project hook command.

### D. Fixed proof inside the privileged packet

1. Run the fixed prompt-transport helper required by the bootstrap protocol. Its existing outputs must remain byte-identical. Any prompt-transport diff is a STOP condition and must not be staged.
2. Run exactly the bounded bootstrap regression named by this ruling:
   - `node --test scripts/control_plane_bootstrap.test.mjs`
   - expected: `172/172` pass, `0` fail.
3. Do not run a new Agent, Task, Opus, Haiku, or other model call as a proof. The F36 implementation already has its off-live lifecycle witness; this packet activates reviewed bytes, it does not buy another model experiment.

### E. Closeout and finalization

Write exactly one closeout report:

`docs/replay-results/worker-advisor-reports/AR-1319-CONTROL-PLANE-LIVE-F36-PROPAGATION-CLOSEOUT-cpb-2026-08-18-0007.md`

The closeout must record:

- source Worker HEAD `3c2df1d04fe3374290c1720785257cf810481fbd`;
- authorization `cpb-2026-08-18-0007`;
- target pin `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`;
- target bundle `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`;
- exact one `SubagentStop` registration with matcher `general-purpose` through the trusted doorway;
- bootstrap regression `172/172` green;
- prompt transport zero diff;
- frozen queue SHA/state unchanged;
- receipt Git tree unchanged and clean;
- zero Agent/Task/model calls;
- zero compiler/backtest/paper/broker/live-money work.

Stage only authorized paths. Finalize only through the existing `cp-finalize.mjs` terminal path. The commit-message temp file is never staged.

## 5. EXPECTED CONTROL-PLANE COMMIT SHAPE

If the fixed prompt transport remains byte-identical, the pushed control-plane commit must contain exactly four changed files:

1. `scripts/claude_toolbox.mjs`;
2. `.claude/worker1-hook-guard-manifest.json`;
3. `.claude/settings.json`;
4. `docs/replay-results/worker-advisor-reports/AR-1319-CONTROL-PLANE-LIVE-F36-PROPAGATION-CLOSEOUT-cpb-2026-08-18-0007.md`.

Any additional changed path is a STOP condition. Do not merge a wider commit.

The mechanically derived branch is expected to be:

`control-plane/ar-1319-guard-repair-cpb-2026-08-18-0007`

The preserved failed `control-plane/ar-1317-guard-repair-cpb-2026-08-18-0006` attempt is forensic history and must not be deleted/reset merely to tidy the namespace.

## 6. AUTOMATIC INTEGRATION — NO EXTRA GPT CEREMONY

If and only if the bootstrap returns `completion_verified: true`, the completion receipt says `pushed: true`, and independent post-bootstrap inspection confirms the exact four-file shape and exact target values above, the current normal top-level integration session is authorized to merge that one control-plane commit onto `claude/worker1-h1-20260815` immediately.

Before merge require:

- merge base with Worker-1 exactly `3c2df1d04fe3374290c1720785257cf810481fbd`;
- exactly one new control-plane commit over that base;
- exact four-file path set above;
- no prompt-transport diff;
- exact new toolbox pin/bundle and exact `SubagentStop` registration;
- no merge conflict and no manual conflict resolution.

Then merge with the already-proven no-ff integration pattern, push Worker-1, and independently re-resolve the remote Worker-1 tip.

If any path, base, count, value, or conflict behavior differs: STOP. Do not improvise.

## 7. POST-INTEGRATION F36 STATUS

Once the exact control-plane commit is integrated and pushed:

- F36 live wiring is considered **ACTIVATED**;
- the launch ACK remains launch-only;
- a real `SubagentStop` is now routed to the accepted final-answer capture path;
- no dedicated Agent/Opus call is required merely to celebrate or prove activation;
- the first future **legitimate** subagent lifecycle that uses this path becomes the natural live runtime witness. Any anomaly then fails closed and is reported; do not manufacture a model call solely for the witness.

Before any future legitimate strict-G2 Agent call, a fresh ordinary Worker-1 seat must still arm normally and the live control files must resolve to the exact new pin/bundle/hook above. This is a zero-model precondition, not another engineering packet.

## 8. AFTER F36 ACTIVATION — LEAVE THE GUARD RABBIT HOLE

Do not start another guard refactor or another Opus experiment merely because F36 is now live.

Return to the parked deterministic G2/source-truth problem. The current strategy route remains RED and the next work is the extraction/compiler fidelity path, not more transport infrastructure. Preserve the existing strict grader and the recovered eight outputs. No gate weakening and no hand-patching frozen graded artifacts.

## 9. HARD LIMITS

- No replay of `cpb-2026-08-18-0006` or `cpb-2026-08-18-0007` after either is claimed.
- No new Agent/Task/Opus/model call during propagation or merge-back.
- No receipt deletion/reset/rewrite.
- No frozen queue/native-manifest mutation.
- No new F36 architecture.
- No toolbox redesign.
- No grader/gate weakening.
- No compiler/backtest/paper/broker/live-money work inside the privileged propagation packet.
- No operator copy/paste permission relay.

**AR-1318 final disposition:** **PASS. BOTH SEAT-COMPATIBILITY GAPS ARE CLOSED. `cpb-2026-08-18-0007` IS THE FRESH EXECUTABLE LIVE-PROPAGATION KEY. EXECUTE ONCE, INTEGRATE ONLY THE EXACT FOUR-FILE RESULT, THEN RETURN TO THE REAL EXTRACTION/COMPILER WORK.**
