# CLAUDE FAST TEST-COMMAND INDEX

**Purpose:** stop re-discovering the first test command for every prepared packet.

These commands are starting points from the current repository. A worker still follows the packet's exact RED/GREEN evidence contract and adds the smallest new regression test required by the finding.

## Global health commands

```bash
npm run build
npm run test:full-fleet
npm run preflight:vacation
python -m pytest src/engine/ -q --tb=short
```

Do not treat `npm run build` or Fast Lane alone as launch proof. AR-1177 requires a full-lane receipt tied to the exact release SHA.

## AR-1178 — production dev-auth bypass

Existing focused tests:

```bash
npx vitest run src/server/__tests__/auth-middleware.test.ts
npx vitest run src/server/__tests__/deepscan16-a1-self-restart-auth-gate.test.ts
```

Required RED addition: production/preprod environment + `AUTH_DEV_BYPASS=true` must refuse/invalid-config rather than bypass auth.

## AR-1175 / AR-1176 — reconciliation boundaries

Existing focused tests:

```bash
npx vitest run src/server/__tests__/fill-reconciliation.test.ts
npx vitest run src/server/services/fill-reconciliation-service.drift-sweep.test.ts
```

Required RED additions:
- server qty 1 vs broker qty 0 is drift by default;
- clearing MES cannot clear unresolved MNQ on the same account;
- account-wide conservative entry block remains until all unresolved symbol problems are cleared.

## AR-1173 — unhandled rejection must enter fatal teardown

Start with:

```bash
npm run build
```

No existing dedicated test was found by the GPT audit. Add the smallest process/shutdown helper seam or isolated test necessary to prove an `unhandledRejection` reaches the same graceful-fatal teardown authority already used for fatal termination. Do not spawn a second shutdown architecture.

## AR-1184 — PAPER -> broker explicit account identity

Existing focused tests:

```bash
npx vitest run src/server/__tests__/server-mediated-executor.test.ts
npx vitest run src/server/__tests__/live-order-lifecycle-gate.test.ts
```

Required RED addition: with two enabled Topstep accounts on the same firm, PAPER entry must not choose arbitrary `LIMIT 1` account identity. Entry, persisted order, reconciliation, and every exit must conserve one explicit account ID. Zero/ambiguous identity fails closed. No broker network egress in this proof.

## AR-1174 — dormant network-failover honesty

Start with:

```bash
npm run preflight:vacation
npm run build
```

Add a focused regression proving an unstarted/unmeasured network monitor cannot report `PRIMARY_HEALTHY` as if a measurement occurred. Do not activate global network failover as part of this packet.

## AR-1177 — exact release-SHA launch authority

Required evidence is CI/workflow-level, not just a unit test:

```text
release_sha == full_lane_receipt_sha
Fast Lane green alone != launch authority
```

Run the repository's full required release lane on the exact candidate SHA. Any advisory/failing full Python engine state remains a blocker until AR-1171 closes the escape hatch.

## AR-1171 / AR-1172 — fake-green CI

Full Python engine command:

```bash
python -m pytest src/engine/ -q --tb=short
```

AR-1171 RED: intentionally failing an engine test outside the Fast Lane subset must make the blocking CI lane fail.

AR-1172 RED: a previously allowlisted failure that turns green must require baseline shrink/removal; re-breaking that same test later must not remain hidden by a stale allowlist.

## AR-1182 — 120-strategy load test

Do not create 120 fake WebSockets. Drive the real shared-feed -> PAPER-session fan-out.

Proof must include:

```text
120 active PAPER sessions
shared symbol sockets reused
no missing bars
no duplicate bars
per-session order preserved
one slow/failing session does not corrupt another
zero silently swallowed session failures
DB/audit failure counts exposed
latency/queue/resource headroom recorded
```

Run load proof separately from normal unit CI so timing noise does not make correctness tests flaky.

## AR-1183 — one-strategy golden run

Only after AR-1138 receives GPT semantic PASS.

The first golden candidate is the accepted AR-1138 strategy. Preserve machine-verifiable identity/hash across:

```text
source evidence
-> Graph Engineering
-> Compiler
-> Strategy Factory
-> backtest/replay
-> Context Observer (read-only)
-> Qualification
-> 3-5 day PAPER
-> no-egress execution intent
```

Any silent semantic delta is RED.

## Final packet completion

A focused green is not enough when the change touches shared production authority. Before report/push, run the broader commands required by the packet, typically:

```bash
npm run build
npm run test:full-fleet
```

and Python engine coverage when the packet touches Python/compiler/backtest semantics.
