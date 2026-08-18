# AR-1319 CONTROL-PLANE LIVE F36 PROPAGATION CLOSEOUT

**Packet:** AR-1319
**Authorization:** cpb-2026-08-18-0007
**Ruling:** AR-1318A
**Actor:** top-level-control-plane-guard-repair
**Date:** 2026-08-18
**Source Worker HEAD:** 3c2df1d04fe3374290c1720785257cf810481fbd

## Changes Applied

### A. Toolbox re-pin (scripts/claude_toolbox.mjs)

- **Old pin:** 4c5f9d4adba5972a051aa845b98809bc2b6c7aa4
- **New pin:** bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198
- History comment added naming AR-1318A / F36 lifecycle finality.

### B. Worker guard manifest (.claude/worker1-hook-guard-manifest.json)

- `_toolbox_pin` = bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198
- `_toolbox_bundle_sha256` = ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167
- Pin history entry appended: `-> bbf2e6c2 (AR-1319 / AR-1318A, F36 two-location GIT_TREE receipt-state compatibility + SubagentStop lifecycle finality, cpb-2026-08-18-0007, 2026-08-18)`.

### C. SubagentStop hook registration (.claude/settings.json)

- Added exactly one `SubagentStop` registration:
  - matcher: `general-purpose`
  - type: `command`
  - command: `node "$CLAUDE_PROJECT_DIR"/scripts/claude_guard_hook.mjs --manifest "$CLAUDE_PROJECT_DIR"/.claude/worker1-hook-guard-manifest.json`
  - timeout: 15
- Existing SessionStart, PreToolUse, and PostToolUse registrations preserved unchanged.

## Verification

| Check | Result |
|-------|--------|
| Bootstrap regression | **172/172 pass, 0 fail** |
| Prompt transport | **Zero diff** (8 artifacts byte-identical) |
| Frozen queue SHA/state | **Unchanged** |
| Receipt Git tree | **Unchanged and clean** |
| Agent/Task/model calls | **Zero** |
| Compiler/backtest/paper/broker/live-money work | **Zero** |

## Commit Shape

Exactly four changed files:

1. `scripts/claude_toolbox.mjs`
2. `.claude/worker1-hook-guard-manifest.json`
3. `.claude/settings.json`
4. `docs/replay-results/worker-advisor-reports/AR-1319-CONTROL-PLANE-LIVE-F36-PROPAGATION-CLOSEOUT-cpb-2026-08-18-0007.md`

## Disposition

F36 live wiring ACTIVATED. The SubagentStop event is now routed through the trusted doorway to the accepted final-answer capture path. No dedicated Agent/Opus call required — the first legitimate subagent lifecycle becomes the natural live runtime witness.
