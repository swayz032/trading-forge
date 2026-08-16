# GPT EXTERNAL ADVISOR RULING — AR-1273

## Authority
This ruling is the live operator message for the next Worker-1 action. It supersedes any conflicting older operator language while preserving all unchanged safety locks.

## Verdict
**AR-1272: PASS ON ROOT-CAUSE IDENTIFICATION / NO-GO ON CALIBRATION.**

The real fresh Worker-1 launch exposed a lifecycle defect that the existing unit tests did not prove: SessionStart can verify the anchor successfully, yet the later PreToolUse hook process does not necessarily inherit `TF_CLAUDE_GUARD_ANCHOR_OK=1` merely because SessionStart appended it to `CLAUDE_ENV_FILE`.

The current guard implementation therefore has a broken cross-hook handshake assumption. The fail-closed behavior is correct; the persistence mechanism is not yet proven.

Separately, the root `CLAUDE.md` is above Claude Code's 150k-character warning threshold (~203.5k chars observed by the operator). This is not the cause of the anchor-handshake failure, but it is a real instruction-loading risk and should be reduced now while the worker seat is already blocked from calibration.

## Evidence graded

### A. Fresh Worker-1 seat
PASS.

The observed runtime sequence is consistent with the correct worktree/branch being launched:
- SessionStart executed.
- SessionStart reported the Worker-1 anchor verified.
- The first later tool invocation was denied by PreToolUse with `worker session anchor was not verified at SessionStart; edits are fail-closed`.

That sequence proves the seat reached the installed SessionStart guard and also proves the later PreToolUse process did not observe the expected marker.

### B. Exact implementation path
PASS FOR ROOT CAUSE.

At toolbox pin `18108039056a0994c1fc1be9583812b0838dba50`, `claude-hook-bridge.mjs` does the following:
1. SessionStart calls `verifyResumeAnchor(...)`.
2. On success it calls `persistAnchorOk(env.CLAUDE_ENV_FILE)`.
3. `persistAnchorOk()` appends `export TF_CLAUDE_GUARD_ANCHOR_OK=1` to `CLAUDE_ENV_FILE`.
4. PreToolUse later refuses unless `env.TF_CLAUDE_GUARD_ANCHOR_OK === '1'`.

This creates a cross-process state dependency that the current tests do not establish in a real Claude Code hook lifecycle.

### C. Existing test hole
PASS — defect in proof found.

`claude-hook-bridge.test.mjs` proves SessionStart writes the marker file, but later PreToolUse tests supply a synthetic environment via `verifiedEnv()` containing `TF_CLAUDE_GUARD_ANCHOR_OK: '1'`.

That means the suite proves:
- SessionStart can write a marker;
- PreToolUse behaves correctly when the marker is already present in its process environment;

but it does **not** prove:
- a real SessionStart process causes a later real PreToolUse hook process to receive that marker.

The production failure therefore invalidates the previous assumption that these unit tests closed the lifecycle boundary.

### D. Safety response
PASS.

The guard denied the tool rather than silently allowing an unverified session. This is the correct failure mode.

### E. Calibration/frozen budget
NO-GO remains in force.

Do not spend the one non-G2 Opus calibration while the hook lifecycle boundary is unproven.

The frozen G2 eight remain locked and must remain 8 READY / 0 SPENT with the queue SHA unchanged.

## Required claim correction
Do **not** describe `CLAUDE_ENV_FILE` as a proven session-wide hook authentication channel. It may be useful to persist shell environment for later commands, but this repository has now observed that the current SessionStart→PreToolUse dependency is not reliable enough for the guard contract.

## AR-1274 — exact next worker packet

### 1. Repair the lifecycle boundary, not the symptom
Choose the smallest robust mechanism that does not rely on unproven environment inheritance between hook subprocesses.

Preferred engineering direction:
- SessionStart verifies the exact Worker-1 anchor as today.
- SessionStart writes a **session-bound guard receipt** to a trusted, non-repository mutable runtime location (for example under `.git/` or another explicitly controlled session-state location), keyed/bound to the actual Claude `session_id` plus the expected Worker-1 worktree/repo root, expected branch/head, manifest identity, and toolbox/bundle identity.
- PreToolUse independently reads and validates that receipt on every invocation.
- The receipt must not be accepted across a different `session_id`, different worktree, different expected head, different manifest, or different toolbox/bundle identity.
- If the receipt is absent, malformed, stale, mismatched, or points at a moved anchor, fail closed.

A simpler alternative is acceptable if it is equally strong and easier to prove: PreToolUse may mechanically re-verify the anchor itself on every invocation instead of depending on a SessionStart marker. If this is fast enough and removes mutable cross-process session state entirely, prefer the simpler design. Do not add complexity merely to preserve the old marker architecture.

### 2. Add the missing real lifecycle test
A passing unit that manually calls `verifiedEnv()` is not enough.

Add a production-shaped control that runs the hook runner as separate processes:
- Process A: feed a SessionStart JSON event to `claude-hook-runner.mjs` with the real manifest and test repo/worktree.
- Process A exits.
- Process B: feed a PreToolUse JSON event with the SAME `session_id`.
- Process B receives **no manually injected `TF_CLAUDE_GUARD_ANCHOR_OK`**.
- The legitimate same-session invocation must traverse the guard successfully.

Negative controls must include at minimum:
- wrong/different `session_id` → deny;
- wrong worktree/repo root → deny;
- moved/stale expected head or dirty anchor beyond governed exception → deny;
- absent SessionStart receipt/state when using receipt design → deny;
- stale/tampered receipt or changed manifest/toolbox identity → deny if the chosen architecture persists state.

If the chosen design re-verifies at each PreToolUse and no SessionStart receipt exists, substitute equivalent mutation controls proving that a moved/dirty/wrong-worktree anchor bites immediately.

### 3. Preserve the fail-closed ordering already won
Do not regress:
- queue exact protection;
- receipt-prefix self-protection;
- protected-surface Bash fence before the generic mutation blacklist;
- native Agent/Task G2 pre-call identity checks;
- 0/8 frozen-call preservation.

### 4. Slim `CLAUDE.md` now, without losing rules
The root `CLAUDE.md` warning is real and should be removed from the hot path.

Goal:
- root `CLAUDE.md` comfortably below 150k characters; target a concise hot-rules file rather than trimming to 149.9k.

Keep in root `CLAUDE.md` only durable always-needed operating rules such as:
- mission/current operating mode;
- Worker/advisor authority model;
- branch/worktree rules;
- GPT rulings are live operator authority;
- fast + robust engineering principles;
- safety locks;
- report/ruling protocol;
- critical commands/locations;
- pointers to detailed docs.

Move historical Wave journals, long subsystem histories, old closeout prose, and deep reference material into existing appropriate docs or new clearly named reference docs under `docs/` / `.claude/rules/` as appropriate. Do not delete unique institutional knowledge; relocate it and leave pointers.

Required controls:
- before/after character count;
- prove all current Worker-1/GPT authority/safety rules remain discoverable in the new hot file or explicitly referenced rule files;
- no contradiction introduced between root instructions and moved material.

### 5. Re-pin only if toolbox code changes
If the lifecycle repair changes toolbox files on `claude/worker1-p1-toolbox-20260816`, create a deliberate descendant commit and update the Worker-1 immutable toolbox pin/bundle identity exactly once after review of the member diff.

Do not silently follow the moving branch.

### 6. Test ordering
Use the fastest robust sequence:
1. focused lifecycle red/green controls;
2. neighboring hook/guard tests;
3. mutation/negative controls;
4. full toolbox local suite once after the focused lane is green;
5. report CI separately from local tests.

Do not run giant unrelated Trading Forge suites for this guard-only repair unless a direct dependency demands it.

## AR-1274 required evidence

### A. Root-cause repair
- exact files/commits changed;
- chosen architecture and why it removes the cross-process assumption;
- proof no manual environment injection is required for the production-shaped lifecycle control.

### B. Lifecycle red/green
- pre-fix command/result showing the production-shaped SessionStart→separate PreToolUse failure;
- post-fix identical control green;
- all required negative/mutation controls biting.

### C. Toolbox provenance
- previous toolbox pin;
- new toolbox pin if changed;
- descendant proof;
- member diff;
- new bundle SHA if changed;
- Worker-1 manifest pin/bundle updated consistently.

### D. `CLAUDE.md` cleanup
- before character count;
- after character count;
- list of material moved and destination paths;
- proof current live authority/safety/worker rules remain in hot instructions or directly referenced by them.

### E. Frozen preservation
Before and after all work:
- queue SHA exactly `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
- `attempts: {}`;
- 8 READY / 0 SPENT;
- real G2 receipt namespace contains no new `.attempt`, `.dispatch`, `.raw`, or `.completion` files.

### F. Runtime status
- Do **not** run the one-shot non-G2 Opus calibration in AR-1274.
- Report it as UNSPENT.

### G. CI
Report GitHub CI/status separately. If there are no checks/runs at the grading pin, state exactly:
`CI: NONE; tests are local-only evidence.`

## Forbidden in AR-1274
- no non-G2 Opus calibration yet;
- no frozen G2 calls;
- no second/retry Agent call;
- no compiler/backtest campaign;
- no PAPER;
- no broker/Topstep/live;
- no broad shell-parser project;
- no unrelated architecture expansion;
- no silent deletion of historical `CLAUDE.md` knowledge.

## Safety locks
- Certification: RED / LOCKED.
- Frozen G2 eight: NO-GO, 0/8 must remain untouched.
- One-shot non-G2 Opus calibration: **temporarily NO-GO until AR-1274 is graded GREEN.**
- Compiler authorization on uncertified strategy: NO-GO.
- Broad backtest campaign: NO-GO.
- PAPER: NO-GO.
- Broker/Topstep/live: NO-GO.

## Operator directive
**REPAIR THE SESSIONSTART→PRETOOLUSE LIFECYCLE BOUNDARY FIRST. PROVE IT WITH TWO SEPARATE HOOK PROCESSES AND NO MANUALLY INJECTED VERIFIED ENVIRONMENT. KEEP THE GUARD FAIL-CLOSED AND PRESERVE 8 READY / 0 SPENT.**

**AT THE SAME TIME, REDUCE ROOT `CLAUDE.md` FROM ~203.5K CHARACTERS TO A CONCISE HOT-RULES FILE WITHOUT DELETING UNIQUE PROJECT KNOWLEDGE; MOVE HISTORY/REFERENCE DETAIL OUT OF THE ALWAYS-LOADED FILE AND LEAVE CLEAR POINTERS.**

**DO NOT SPEND THE ONE NON-G2 OPUS CALIBRATION YET. REPORT THE REPAIR, RED/GREEN EVIDENCE, CLAUDE.MD BEFORE/AFTER COUNTS, TOOLBOX REPIN IF ANY, FROZEN PRESERVATION, AND CI STATUS AS AR-1274.**
