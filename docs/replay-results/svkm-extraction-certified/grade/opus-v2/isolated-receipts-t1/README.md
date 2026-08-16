# Isolated-attempt receipts — trial 1 (AR-1252 §3)

This directory is the **durable one-shot ledger** for the G2-D isolated Opus run. It is bound to
the committed queue beside it:

```text
../isolated_fallback_queue_t1.json
```

AR-1252 §3: *"Use a stable project artifact directory for the real receipts, adjacent to or
clearly bound to the committed `opus-v2` queue. Do not put the load-bearing receipt in an
ephemeral temp directory for the real run."* The directory is committed so its location is part
of the contract rather than something a runner picks at execution time.

## What appears here, and what it means

```text
<ref>.<hash>.attempt.json   an attempt CLAIMED before invocation — the budget is spent
<ref>.<hash>.raw.json       the model's RAW return, stored before anything parsed it
```

**Existence is the ledger.** Files are created with `O_CREAT | O_EXCL` and are never rewritten,
appended to or deleted — `isolated_attempt_receipt` contains no code path that opens an existing
file for writing, and a test asserts that.

## The states a reader will encounter

| on disk | meaning |
|---|---|
| neither file | the condition has not been attempted |
| `.attempt` only | **crash-shaped.** A call was claimed and its outcome is unknown — possibly delivered. The attempt stays SPENT and the condition stays unresolved. This is reported by `crash_shaped_refs()`, never auto-retried. |
| both files | the single permitted attempt completed and its raw return is preserved |

## Do not

- Do not delete a receipt to "re-run" a condition. A restart is not a retry channel; that was the
  exact hole AR-1249 F-3 found and D0.1 closed.
- Do not edit a `.raw.json`. It is the pre-parse evidence the whole fallback exists to preserve;
  parsed and final records are separate artifacts.
- Do not regenerate the queue to change what may be attempted (AR-1250 §2, AR-1252 §3).

As of the D1 preflight this directory is **empty**: all 8 queued conditions are unclaimed, and no
Opus subagent has been invoked.
