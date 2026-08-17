# AR-1278 Phase 1 Closeout Report

## Authorization

- **Ruling:** AR-1299A (PASS)
- **Authorization ID:** cpb-2026-08-17-0004
- **Actor:** top-level-control-plane-guard-repair
- **Target packet:** AR-1278
- **Source SHA:** 94fd175adc60502b0dfe825c31f601d33939eaff
- **Bundle SHA256:** 4e060c72d931d8e6b28cc688f8d3ea664143078fefee826b966b1d92d35aa773
- **Frozen queue SHA256:** 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
- **Frozen state:** 8 READY / 0 SPENT / receipts README-only

## Changes Applied

### 1. `.claude/worker1-hook-guard-manifest.json` — strict_session armed

`g2_precall.strict_session` changed from `false` to `true`. This arms the G2 execution session: every Agent/Task dispatch now requires a valid frozen-queue permit. No unguarded model calls are possible. The explanatory `_why` comment was updated to reflect the new state and its authority (AR-1299A section 4).

### 2. `.claude/settings.json` — PowerShell closure

Added `PowerShell` to the PreToolUse matcher, changing `Edit|Write|NotebookEdit|Bash|Agent|Task` to `Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell`. This ensures PowerShell tool calls are routed through the guard hook for evaluation. The guard's `DENIED_TOOLS` list already included PowerShell; this change closes the registration gap where PowerShell dispatches would bypass the hook entirely because the matcher never caught them.

### 3. Prompt transport materialized

`python scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py` ran successfully. 8 prompt artifacts + index written to `docs/replay-results/g2d-prompt-transport/`:

| Condition ref | SHA256 (prefix) | Bytes |
|---|---|---|
| entry_sequence[0].rationale | def6539072ea927a | 25948 |
| entry_sequence[1].action | d7db358c3226d473 | 25969 |
| entry_sequence[1].rationale | 23a786f07fd2029c | 25948 |
| entry_sequence[2].action | 3c57e4740c81487d | 25957 |
| entry_sequence[2].rationale | a91752c29ee77eea | 25965 |
| entry_sequence[3].rationale | 95599ce8784d73b4 | 25954 |
| confluences[0].description | cf2d192c8eadb507 | 25945 |
| confluences[1].description | 905cac9b90dade5f | 25935 |

Every artifact was independently verified against the frozen `native_call_manifest_t1.json` before writing.

## Tests

`node --test scripts/control_plane_bootstrap.test.mjs`: **152 of 152 tests green, 0 fail.**

`node --test scripts/control-plane-bootstrap/lifecycle.test.mjs`: file not present in this worktree — not a failure, only the bootstrap suite exists here.

## Constraints Honored

- **Zero** Agent or subagent dispatches
- **Zero** Task tool calls
- **Zero** PowerShell invocations
- **Zero** frozen G2 model calls
- **Zero** frozen G2 queue/receipt/native-manifest writes
- **Zero** operator questions asked
- The transient commit-message file (`scripts/control-plane-bootstrap/.cp-commit-msg.tmp`) was written but is **never staged**
- All writes confined to the 9 authorized paths

## What This Does Not Do

This Phase 1 does not execute the frozen G2 queue, does not run the Agent traversal calibration, and does not attempt Phase 2. Those belong to a fresh ordinary Worker-1 seat launched only after GPT independently grades this closeout.

## Next Step

GPT grades this Phase 1 closeout on the pushed control-plane branch. If it passes, a fresh Worker-1 seat runs the Phase 2 cheap non-G2 live traversal proof.
