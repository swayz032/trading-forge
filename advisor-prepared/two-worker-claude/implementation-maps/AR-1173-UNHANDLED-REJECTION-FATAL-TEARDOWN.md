# AR-1173 — READY-TO-EDIT MAP

Parent finding: the global `unhandledRejection` handler logs and continues, leaving the same process alive after an unknown async failure. The process already has a real graceful shutdown path for SIGTERM/SIGINT.

## Open first

1. `src/server/index.ts`
2. Search existing shutdown/process-handler tests. If no production-path test exists, add ONE focused test seam; do not build a second shutdown system.

## Exact production seam

Current production code:

```ts
process.on("unhandledRejection", (reason, _promise) => {
  logger.error({ reason }, "Unhandled promise rejection");
});
```

Existing shutdown authority:

```ts
function gracefulShutdown(signal: string): void { ... }
```

It already:
- stops double-fire with `_shuttingDown`;
- broadcasts shutdown;
- closes SSE;
- stops Massive streams;
- stops compute failover monitor;
- drains Python subprocesses;
- closes HTTP;
- closes DB;
- flushes logs;
- has a 10-second hard-kill backstop.

## RED first

Required behavioral witness:

```text
unhandledRejection occurs
-> fatal path is invoked exactly once
-> process is not allowed to keep serving indefinitely
```

Do NOT accept a test that only copies the desired handler logic into the test.

Preferred test approach:
- expose the smallest handler-registration or fatal-event seam needed to invoke the REAL production callback without booting the entire server; OR
- use another existing process-handler test seam if one exists.

If extracting a seam is required, it may choose/invoke the existing `gracefulShutdown` callback but must not duplicate teardown steps.

Focused command should be the exact new/extended Vitest file, e.g.:

```bash
npx vitest run <fatal-process-handler-test-file>
```

## Smallest repair

Route `unhandledRejection` into the existing fatal teardown authority after logging, conceptually:

```text
log rejection
-> gracefulShutdown("unhandledRejection")
```

Keep `_shuttingDown` as the double-fire authority.

Do not add retry/continue behavior for an unknown unhandled rejection.

`uncaughtException` is adjacent but already exits. Do not widen this packet into a complete process-lifecycle redesign unless a shared tiny handler seam is necessary for truthful testing.

## Forbidden detours

- No second graceful-shutdown implementation.
- No new supervisor/process manager.
- No swallowing/retrying arbitrary rejected promises.
- No Windows service mutation in this packet.
- No P0-6 deployment/restart execution.

## GREEN

```bash
npx vitest run <focused fatal-handler test>
npm run build
```

Then canonical relevant server lane.

## Controls

Must prove:

```text
one unhandled rejection -> one fatal teardown request
second fatal event while shutdown active -> no duplicate teardown
SIGTERM/SIGINT behavior remains intact
```

## Mutation control

Remove the call into the existing fatal teardown from the `unhandledRejection` handler. The RED witness MUST fail.

## Expected touched-file boundary

Preferred:

```text
src/server/index.ts
ONE focused test file
```

At most ONE tiny helper module is acceptable only to make the real production process-handler policy testable. That helper may dispatch to `gracefulShutdown`; it may not contain teardown logic.

## Completion receipt

RED output, exact production handler seam, GREEN output, double-fire control, mutation result, commit SHA, push proof, STOP for GPT review.
