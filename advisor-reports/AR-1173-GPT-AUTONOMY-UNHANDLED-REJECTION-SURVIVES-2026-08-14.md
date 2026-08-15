# GPT EXTERNAL ADVISOR RULING — AR-1173

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / AUTONOMY STATIC AUDIT  
**V4 stage:** AR / AUTONOMOUS RUNTIME  
**Status:** FINDING CONFIRMED — PREPARED FUTURE FIX PACKET

## SIMPLE RESULT

At accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99`, Trading Forge has a real graceful-shutdown path, but the global `unhandledRejection` handler does **not use it**.

Current behavior:

```text
unknown async promise failure
        ↓
logger.error(...)
        ↓
process keeps serving
```

By contrast, `uncaughtException` logs and exits, and SIGTERM/SIGINT use the real graceful teardown.

For an unattended trading runtime, an unknown unhandled async failure should not leave the same process serving requests indefinitely with unknown in-memory state.

---

## DIRECT CODE EVIDENCE

`src/server/index.ts` currently has:

```ts
process.on("unhandledRejection", (reason, _promise) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});
```

The same file already contains a reusable `gracefulShutdown(signal)` path that:

1. guards against double-fire;
2. broadcasts shutdown to SSE clients;
3. closes SSE clients;
4. stops Massive streams;
5. stops compute-failover timer;
6. begins Python subprocess drain;
7. stops accepting new HTTP connections;
8. drains the DB pool;
9. flushes logs;
10. has a 10-second forced-exit backstop.

So the needed machinery already exists. Do not build a second shutdown subsystem.

---

## WHY THIS MATTERS

Vacation-mode scenario:

```text
2:11 AM
an unexpected promise rejects outside a local catch
        ↓
global handler logs it
        ↓
service remains Running
        ↓
Windows sees a live process
        ↓
future requests/crons may continue from unknown state
```

The safe unattended behavior is:

```text
unexpected unhandled rejection
        ↓
record fatal event
        ↓
stop accepting work
        ↓
gracefully tear down
        ↓
exit NONZERO
        ↓
existing service supervisor may restart under the already-defined P0-6 recovery authority
```

This packet must not redesign NSSM or P0-6. It only makes the Node process fail closed so the existing supervisor/recovery proof can observe a real failure.

---

# SMALLEST SAFE FIX

Refactor the existing graceful shutdown function to support an explicit exit code or fatal mode, for example:

```text
gracefulShutdown(reason, exitCode)
```

Rules:

- SIGTERM/SIGINT normal operator/service shutdown may use exit 0.
- `unhandledRejection` must request fatal shutdown and final exit 1.
- `uncaughtException` should use the same fatal graceful path instead of immediate `process.exit(1)` if doing so can be proven safe without re-entering unstable code.
- Preserve the existing 10-second hard-kill.
- Preserve the double-fire guard.
- Do not add a second watchdog or second restart authority.

If attempting graceful cleanup from `uncaughtException` proves unsafe in testing, keep its immediate fail-fast behavior; the required defect closure is `unhandledRejection` no longer logging-and-continuing.

---

# REQUIRED TESTS

## RED proof

Use a child-process integration fixture, not an in-process unit test that would kill the test runner.

Trigger an intentionally unhandled rejected promise after the test server is listening.

Current candidate must prove:

```text
fatal log observed
child remains alive / does not enter shutdown
```

That is the RED witness.

## GREEN proof

After fix, same fixture must prove:

```text
unhandled rejection observed
shutdown begins once
HTTP listener closes
child exits nonzero
```

## Double-fire control

Trigger two fatal events close together.

Required:

```text
one graceful shutdown sequence
one process exit
no duplicate teardown race
```

## Normal shutdown control

SIGTERM still follows graceful teardown and retains the intended normal exit behavior.

## P0-6 integration witness later

Only during the already-authorized P0-6 live/recovery phase, prove the real Windows supervisor restarts the service after this fatal exit. Do not attempt that mutation in this static GPT packet.

---

# IMPORTANT NON-FINDINGS

GPT does **not** claim Trading Forge lacks shutdown/recovery infrastructure.

It has substantial existing startup and shutdown machinery, including PAPER state warmup/recovery, stream teardown, DB drain, and hard-kill protection.

This finding is narrow:

> `unhandledRejection` is the global fatal async escape hatch that currently logs and continues instead of entering the existing fail-closed teardown path.

---

# ORDERING

Do not execute ahead of AR-1138.

This is a prepared Autonomous Runtime hardening packet for the post-activation queue. It must not delay the first semantic gate or duplicate P0-6 deployment/recovery work.

## Bottom line

**CONFIRMED AUTONOMY GAP:** unknown unhandled promise rejection can leave the same Trading Forge process running.

**REUSE EXISTING AUTHORITY:** route that fatal class into the existing graceful teardown, exit nonzero, and let the already-planned supervisor/recovery proof handle restart.