# AR-1311 CONTROL-PLANE LIVE G2 GUARD PROPAGATION CLOSEOUT

## Authorization

- **Authorization ID:** cpb-2026-08-17-0005
- **Ruling:** AR-1311A (GPT External Advisor, executable, one-shot)
- **Actor:** top-level-control-plane-guard-repair
- **Packet:** AR-1311

## Source State

- **Source HEAD:** `45b9075476e0be3f40d8541d22ad0fdc96aad3ac`
- **Branch:** `control-plane/ar-1311-guard-repair-cpb-2026-08-17-0005`

## Propagated Changes

### 1. Toolbox Re-pin (`scripts/claude_toolbox.mjs`)

- **Old pin:** `b6c702821bc48281b02e16773c7c277ae17fb03f`
- **New pin:** `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`
- Descendant verified under AR-1310: `git merge-base --is-ancestor b6c70282 4c5f9d4a`
- Member diff: 3 new `.mjs` files (44 -> 47)

### 2. Worker Guard Manifest (`.claude/worker1-hook-guard-manifest.json`)

- **`_toolbox_pin`:** `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`
- **`_toolbox_bundle_sha256`:** `59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`
- History entry appended: `b6c70282 -> 4c5f9d4a` (AR-1311 / AR-1311A, AR-1307 F32-F35 handshake repair)
- No change to `g2_precall.enabled`, `strict_session`, queue path, receipt path, native-call-manifest path, edit scope, or any unrelated field

### 3. PostToolUse Registration (`.claude/settings.json`)

- Added exactly one `PostToolUse` registration:
  - Matcher: `Agent|Task`
  - Type: `command`
  - Command: `node "$CLAUDE_PROJECT_DIR"/scripts/claude_guard_hook.mjs --manifest "$CLAUDE_PROJECT_DIR"/.claude/worker1-hook-guard-manifest.json`
  - Timeout: 15
- Existing `SessionStart` and `PreToolUse` registrations preserved byte-for-byte (structural JSON punctuation adjusted for the new sibling only)

## Verification Results

### Prompt Transport

- `python scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py` executed successfully
- 8 prompt artifacts + index materialized
- **Zero diff** against the existing prompt transport (confirmed: `git add` on the directory produced no staged changes)

### Bootstrap Regression Test

- `node --test scripts/control_plane_bootstrap.test.mjs`
- **152 pass, 0 fail, 0 cancelled, 0 skipped**
- Duration: 13922ms
- All identity, mutation, replay, lifecycle, path-classifier, and boundary controls green

## Frozen State (Unchanged)

- **Queue SHA-256:** `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`
- **Queue state:** 8 READY / 0 SPENT
- **Receipt namespace:** README-only
- **Native-call manifest:** untouched

## Compliance

- Zero Agent/Task/model calls during this propagation
- Zero compiler/backtest/paper/broker/live-money work
- No bootstrap source edits
- No `node scripts/claude_toolbox.mjs materialize` executed from the privileged seat
- No frozen queue/native-manifest/receipt-schema/model/order changes
- Exactly four files changed: `scripts/claude_toolbox.mjs`, `.claude/worker1-hook-guard-manifest.json`, `.claude/settings.json`, this closeout report
- Transient commit-message file written but never staged
