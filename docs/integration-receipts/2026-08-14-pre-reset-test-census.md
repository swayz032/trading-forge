# Pre-reset test census — 2026-08-14

## Purpose

This receipt establishes the local test population and the smallest compiler/runtime safety baseline before Claude resumes. It does not change AR-1138 state, certify PAPER, activate TopstepX, or claim the full project suite is green.

## Worker 1 / H1 compiler baseline

- Worktree: `C:/Users/tonio/Projects/wt-h1-wave4-20260712`
- Head: `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`
- Dirty state before and after: one tracked modification plus 82 untracked paths; unchanged by the test run.
- Command: `python -m pytest src/engine/tests/test_pilot_conveyor.py src/engine/tests/test_spec_producer.py src/engine/tests/test_svkm_role_execution.py -q --tb=short`
- Result: exit 0; 137 passed in 1.40 seconds.
- Pinned transcript SHA-256: `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`.
- Embedded extraction SHA-256: `c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823`.

The detailed dirty-state boundary is in `2026-08-14-h1-preservation-manifest.json`. No extraction was run and no H1 file was edited, cleaned, reset, or removed.

## Collection census

| Population | Command | Exit | Count |
| --- | --- | ---: | ---: |
| Python engine | `python -m pytest --collect-only -q src/engine/tests` | 0 | 7,252 tests |
| TypeScript/Vitest | `npx vitest list` | 0 after local dependency repair | 13,280 test cases |

The first Vitest collection attempt failed because `node_modules/duckdb/lib/binding/duckdb.node` was absent after the earlier `npm ci --ignore-scripts`. Codex ran `npm rebuild duckdb`; it exited 0, and `node -e "require('duckdb')"` printed `duckdb_binding=ok`. The second collection completed successfully. No tracked dependency or lockfile changed.

## Current-main runtime safety baseline

Command:

```powershell
npx vitest run src/data/fetchers/massive.test.ts src/data/fetchers/massive-websocket-protocol.test.ts src/server/__tests__/first-paper-trade-smoke.test.ts src/server/__tests__/paper-trading-stream-correlation-id.test.ts src/server/services/paper-trading-stream.feed-gap-wiring.test.ts src/server/__tests__/broker-router.test.ts src/server/__tests__/fill-reconciliation.test.ts src/server/services/paper-execution-service.double-close-idempotency.test.ts src/server/__tests__/kill-switch.test.ts src/server/__tests__/failure-injection-kill-switch-l2-l3-force-close.test.ts
```

Result: exit 0; 10 files passed; 162 tests passed in 2.08 seconds.

Covered seams:

- Massive REST/WebSocket protocol;
- PAPER cold/feed gap wiring and first-trade smoke path;
- broker routing;
- fill reconciliation;
- double-close idempotency;
- kill switch and forced-close failure injection.

The run emitted a non-failing third-party sourcemap warning for `node-cron`; record it as output noise, not a test failure or a pristine-output claim.

## Honest boundary

This census proves collection plus the named focused baselines only. It does not prove all 20,532 collected Python/TypeScript test cases pass. Future owners must run the packet-specific tests and hard integrity gates after every accepted change.
