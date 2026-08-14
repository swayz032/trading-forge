# GPT EXTERNAL ADVISOR RULING — AR-1154

**Date:** 2026-08-13  
**Branch:** `external-advisor/gpt-rulings`  
**Audit target:** `h1-wave4-sealed12-driver` @ `46ff2b8778045f15af273a076a60d18210eb6b3e`  
**Parent GPT ruling:** AR-1153 @ `5e14ff4a408ebd38350e3aaef951ab735c8f8112`  
**Status:** STATIC AUDIT / PRE-ENGINEERING / NO CLAUDE INTERFERENCE  
**Scope:** GPT-P0-1 from AR-1153 only. Claude keeps exclusive authority over unfinished AR-1138 compiler/grading work.

---

## 1. DECISION

The custom PAPER daily qualification receipt should be built as a **deterministic reconciliation over the existing PAPER ledgers plus the append-only audit spine**. Do **not** build a second PAPER engine, a second scheduler, a second nightly brain, or a parallel telemetry database.

However, the current production path is **not yet capable of certifying a GREEN qualification day**. The static audit found four blocking evidence gaps that must be closed after AR-1138:

1. the AR-1152 candidate/run/runtime qualification identity is designed but not yet present in the current `PaperSessionConfigShape` or enforced on start/resume;
2. the deferred N -> N+1 entry queue is currently an in-process `Map`, so a process restart can erase an accepted-but-not-yet-filled entry;
3. the generic `paper_signal_logs` path does not durably persist the signal bar timestamp or its correlation ID, and a successful deferred fill returns before a generic fill-success signal row is written;
4. the n8n execution scraper persists an execution header/status, not organ-level 14A completion/report-delivery proof, so generic n8n `success` cannot by itself close the nightly leg.

These are **bounded joins**, not justification for a new architecture.

### Ruling

**P0 qualification work = JOIN + HARDEN EXISTING EVIDENCE.**

Do not let a day count toward the 3-day minimum / 5-day target until the receipt can prove all required legs below. Silence is never proof.

---

## 2. CORRECTION TO EARLIER STATIC REUSE LANGUAGE

AR-1153 summarized `PAPER pending-entry durability` as a reusable foundation based on earlier audit history. The current branch inspection tightens that statement.

`src/server/services/paper-signal-service.ts` currently declares:

```ts
const pendingEntryQueue = new Map<string, PendingEntry>();
```

Accepted entries are written to that map and consumed on the next bar. Session cleanup deletes pending entries from that map. The typed current schema contains `paper_sessions`, `paper_positions`, `paper_trades`, and `paper_signal_logs`; this audit did not find a typed `paper_pending_entries` table or a production-path import/use of one.

Therefore:

> **PENDING-ENTRY DURABILITY IS NOT CERTIFIED ON THE CURRENT AUDIT TARGET.**

If an older/unmerged implementation exists elsewhere, recover and verify it before writing new code. Otherwise close this with the smallest durable event/state join; do not pretend the in-memory map survives process death.

This correction does not invalidate the broader AR-1153 architecture. It narrows one reuse claim to repository evidence actually present on the current compiler branch.

---

## 3. EXISTING STORAGE AUTHORITY MAP

### 3.1 `paper_sessions` — session authority / receipt anchor

Current useful fields include:

- `id`
- `strategy_id`
- `status`
- `mode`
- `firm_id`
- `started_at`
- `stopped_at`
- `config` JSONB
- `current_equity`
- `realized_peak_equity`
- `high_water_balance`
- `total_trades`
- `governor_state`

The schema already enforces **at most one active PAPER session per strategy** with partial unique index `paper_sessions_one_active_per_strategy WHERE status='active'`.

Use `paper_sessions.config.qualification_identity` as the preferred AR-1152 identity container after that contract is implemented. Do not create a separate identity table.

Important: `PaperSessionConfigShape` currently does not declare the AR-1152 qualification identity. This is still future implementation work, not current evidence.

### 3.2 `strategies` — mutable source row, NOT the historical day identity

Useful live assertions:

- strategy id/name
- symbol/timeframe
- lifecycle state
- strategy config
- dedicated `exit_plan_config`
- `shadow_mode_enabled`

Do **not** recompute a historical PAPER-day identity from the current mutable strategy row. The day receipt must compare against the set-once stamped identity from AR-1152.

### 3.3 `paper_signal_logs` — signal/gate journal, useful but currently incomplete

Current columns include:

- session id
- symbol
- direction
- signal type
- price
- indicator snapshot
- acted
- reason
- nullable correlation id
- created timestamp

The generic `logSignal()` implementation currently writes only when entry/exit/stop is present. It derives `acted` from `action !== 'none'`.

This creates an important ambiguity for deferred entry:

- a source entry can pass gates and be **queued** for N+1;
- at the queue point `action` has not become `open` yet;
- generic logging can therefore persist an entry row with `acted=false` and no rejection reason even though the signal was accepted into the pending queue;
- the accepted pending entry itself is only in memory.

Also, although the table has `correlation_id`, generic `logSignal()` does not currently pass the per-bar correlation ID into its INSERT, and it does not persist `entry.timestamp` / the bar timestamp into a dedicated field or JSON key.

Therefore `paper_signal_logs` can participate in the receipt, but **today it is not sufficient by itself to prove exact expected -> queued -> filled accounting**.

### 3.4 `paper_positions` — executed open-position authority

Current useful fields include:

- session id
- symbol / side
- entry price / contracts
- entry time
- `closed_at`
- fill ratio / arrival price / implementation shortfall
- persisted trail HWM / bars held / TP state
- adaptive exit plan JSONB
- `correlation_id`

The N+1 fill path passes the pending entry correlation ID into `openPosition()`. Thus positions can carry the trace ID after a successful open.

Open positions at the official end-of-day receipt boundary are a qualification problem for the day-trading contract unless explicitly explained by a certified emergency/recovery state. The current Style C path has a 15:55 ET hard flatten; an unexplained still-open position after the official close is not GREEN.

### 3.5 `paper_trades` — authoritative closed execution slices

Current useful fields include:

- session id
- symbol / side
- entry and exit prices
- net P&L / gross P&L / commission
- contracts
- timezone-aware entry and exit times
- slippage
- MAE/MFE
- session type
- fill probability
- `correlation_id`

Rows are closed round trips; entry/exit/pnl are non-null. This is the correct source for realized custom-PAPER execution evidence. Session cumulative counters are secondary cross-checks, not the day ledger authority.

### 3.6 `paper_session_feedback` — derived learning summary only

`paper-session-feedback-service.ts` derives post-session totals and learning metrics from `paper_trades` and upserts per session.

Use this as a **cross-check / downstream learning artifact**, not as primary day-accounting truth. It can legitimately say `No trades in session.` without proving that the engine saw every expected bar or that no accepted signal was lost.

### 3.7 `audit_log` — append-only trust spine and preferred missing-join carrier

The repo already writes correlated audit events for safety and PAPER lifecycle decisions, including pending-entry drop reasons and `paper_stream.started` / `paper_stream.stopped`.

This is the preferred place for bounded receipt/transition evidence because the repo already treats it as the trust spine and existing migration history protects append-only behavior.

Do not create another generic telemetry table merely to hold a PAPER-day verdict.

### 3.8 `n8n_execution_log` — nightly execution header, not complete nightly receipt

`n8n-execution-scraper-service.ts`:

- polls Railway n8n execution history;
- deduplicates on n8n execution id;
- persists workflow id/name, execution id, normalized status, start/finish times, duration, trigger type, and scraper metadata;
- emits failure evidence and an audit summary.

This is reusable and should remain the execution-header source.

But it does **not** prove that every required 14A organ completed, that GPT vs fallback was known, that the advisory/autonomous mode contract held inside the run, or that the final report persisted/delivered. Generic execution status remains insufficient for a GREEN official PAPER night.

---

## 4. CANONICAL PAPER-DAY IDENTITY

Use one deterministic logical key:

```text
paper_candidate_hash
+ paper_run_hash
+ runtime_revision
+ CME_futures_trading_day
```

`session_id` is a locator / runtime instance, not the semantic candidate identity.

The trading-day function must reuse the existing futures day authority (`toFuturesTradingDayString()`), not UTC calendar date and not server wall-clock date.

Recommended deterministic receipt id:

```text
paper_day_receipt_id = SHA256(
  "paper-day-receipt-v1" |
  paper_candidate_hash |
  paper_run_hash |
  runtime_revision |
  futures_trading_day
)
```

Repeated reconciliation of the same immutable evidence must return the same canonical receipt body/hash. If two runs produce different receipt bodies for the same receipt id without new append-only evidence, that is an integrity failure.

---

## 5. REQUIRED RECEIPT LEGS

A countable official PAPER day must reconcile seven legs.

### LEG A — identity

Require all:

- candidate hash present and matches set-once session stamp;
- run hash present and matches;
- runtime revision present and matches deployed revision;
- strategy id/name/symbol/timeframe/executable config/live exit config covered by candidate identity;
- lifecycle is `PAPER` for the counted custom-PAPER day;
- shadow mode is false;
- custom PAPER authority is the intended lane.

Any mismatch/unknown = **RED**.

### LEG B — engine/feed continuity

Require evidence that the engine could faithfully evaluate the official market window:

- stream started/active as expected;
- provider/feed identity resolved;
- declared delayed/realtime mode recorded;
- no unresolved market-data gap;
- reconnect/backfill, if any, completed before dependent signals were evaluated;
- restart recovery complete;
- bar state/warmup adequate before official counting.

Current `paper-trading-stream.ts` has in-memory `barBuffer` and reconnect backfill only when prior bars exist. Cold-process warmup remains an AR-1148 gap. Stream start/stop has durable audit markers, but reconnect/backfill is primarily logging/in-memory behavior today.

Until the Massive cold-start/feed receipt work is implemented, any restart/gap whose state continuity cannot be proven makes the day **RED**, not GREEN-by-assumption.

### LEG C — signal accounting

For every source entry/exit/stop decision that becomes receipt-relevant, reconcile a durable event identity.

Minimum lifecycle for an accepted entry:

```text
ENTRY_SIGNAL
-> ENTRY_QUEUED
-> exactly one of:
   ENTRY_FILLED
   ENTRY_FILL_MISS
   ENTRY_DROPPED_<REASON>
```

Rules:

- one accepted queue cannot have two terminal outcomes;
- two accepted queues with the same deterministic event identity are duplicate evidence;
- a fired source signal cannot disappear without terminal disposition;
- a blocked signal must retain its exact block reason;
- a fill cannot exist with no traceable accepted signal unless explicitly classified as a manual/non-qualification action.

### LEG D — deferred-entry durability

Current blocker: `pendingEntryQueue` is process-local.

Fastest reuse-first repair order after AR-1138:

1. first check whether a complete durable pending-entry implementation exists on another intended merge source and can be recovered safely;
2. otherwise prefer the existing append-only `audit_log` as a tiny durable event journal before inventing a new subsystem:
   - await `pending_entry.queued` with the complete reconstructible pending payload + correlation id before the in-memory queue becomes authoritative;
   - write one terminal correlated event on fill/miss/drop;
   - on restart, rehydrate unresolved queued events for active PAPER sessions before qualification-active evaluation resumes;
3. only if the audit spine cannot safely support execution-state recovery under measured tests may Claude add one narrow pending-entry state table. That would be execution state, not a second telemetry system.

The receipt must fail closed on an unresolved queued event.

### LEG E — position/trade consistency

Reconcile by correlation ID where present, then refuse ambiguity rather than guessing.

For each successful fill:

- exactly one intended open-position lineage exists;
- closed slices reconcile to position/contracts semantics;
- closed trades retain the same signal lineage/correlation where architecture supports it;
- no unexplained orphan/open position remains after the day close;
- aggregate realized P&L from `paper_trades` agrees with session/day accounting within defined numeric tolerance;
- forced closes / stops / time exits have an auditable terminal reason.

Do not use session `total_trades` as the sole proof. It is a cross-check.

### LEG F — risk/control integrity

Query existing PAPER/audit evidence for any critical control failure during the day, including but not limited to:

- kill-switch / DLL safety events;
- orphan position recovery;
- critical execution mismatch;
- audit-write failures affecting a required receipt leg;
- calendar/indicator bridge failure when fail-closed execution authority requires healthy data;
- unresolved firm/account/routing identity problems;
- unauthorized lifecycle/shadow/mutation event.

A legitimate expected block is not automatically RED; an **unresolved safety/integrity failure** is.

### LEG G — 3AM nightly proof

Require the schedule-appropriate 14A run associated with the PAPER day and prove:

- expected run occurred;
- unique n8n execution id is known;
- execution completed within the correct schedule window;
- report/run correlation is known;
- advisory mode ON;
- autonomous mutation OFF;
- required regime/leak/decay/composite organs each have explicit outcome or explicit degraded/fallback classification;
- GPT-vs-deterministic fallback is known;
- report persistence/delivery result is known;
- no candidate mutation occurred.

`n8n_execution_log.status='success'` alone does not satisfy this leg.

---

## 6. ZERO-TRADE DAY LAW

A zero-trade day may count toward the 3–5 day execution-integrity window **only** when the receipt proves:

```text
0 accepted entry signals
+ complete expected engine/feed evaluation coverage
+ no unresolved pending entry
+ no lost/restarted signal state
+ all legitimate gate decisions accounted for
+ identity valid
+ risk/control integrity valid
+ nightly proof complete
```

Current signal persistence does not log every evaluated no-signal bar, and current stream state does not yet provide a complete durable day-coverage receipt. Therefore a present-day `0 trades` summary is **not enough** to call a day clean.

The fix is not to persist millions of extra bar telemetry rows. Prefer a bounded, deterministic stream-day summary/reconciliation using existing feed/audit data: expected window, first/last processed bar, unique processed-bar count or equivalent provider reconciliation, reconnect/backfill status, warmup status, unresolved-gap count, and restart count.

---

## 7. GREEN / YELLOW / RED

### GREEN — countable qualification day

All seven legs are complete and mutually consistent; no unresolved/ambiguous evidence exists.

A GREEN day may count toward AR-1151 duration:

- 0–2 GREEN days: duration gate blocked;
- 3–4 GREEN days: minimum duration met, target not yet met;
- 5+ GREEN days: target duration met;
- heavy historical/robustness gates still cannot be bypassed.

### YELLOW — inspectable but NOT countable

Use only for evidence that is complete enough to diagnose but not sufficient to certify, e.g.:

- one non-critical optional nightly organ degraded with an explicit fallback but the promotion policy has not yet classified that fallback;
- complete trade evidence but one receipt cross-check unavailable;
- an expected legitimate operational pause whose counting policy is not frozen.

**YELLOW never increments the 3–5 day counter.**

### RED — invalid qualification day

Any of:

- identity missing/mismatch;
- runtime revision mismatch;
- lifecycle/shadow authority wrong;
- unresolved feed gap/warmup/restart state;
- accepted signal with no terminal disposition;
- duplicate terminal disposition;
- pending entry lost/unresolved;
- fill/trade with no unambiguous lineage;
- unexplained open/orphan position after close;
- critical risk/control failure;
- required audit evidence write failure that destroys proof;
- missing/ambiguous 3AM required evidence;
- unauthorized candidate mutation;
- receipt evidence contradiction.

RED never becomes GREEN because P&L happened to be positive.

---

## 8. MINIMUM POST-AR-1138 IMPLEMENTATION ORDER

Do these as small production-path patches. Stop after each RED -> GREEN proof; do not broad-refactor.

### Patch 1 — AR-1152 identity seam

- add pure candidate/run canonical hash helper;
- extend PAPER session config contract with set-once qualification identity;
- stamp before qualification-active start;
- verify on resume/day check;
- runtime mismatch fail closed;
- append identity snapshot/mismatch audit event.

### Patch 2 — make accepted/fill signal lineage durable

On existing `paper_signal_logs` / audit spine:

- persist `correlation_id` on generic signal rows;
- persist source bar timestamp/trading day deterministically;
- distinguish `entry_queued` from rejected/no-action entry;
- persist `entry_filled` success or an equivalent terminal audit event with same correlation;
- preserve existing fill-miss/drop reasons;
- no schema migration is required merely to add new text `signal_type` values or JSONB keys.

### Patch 3 — close pending-entry restart hole

Reuse/recover a proven durable queue if one exists. Otherwise make queue acceptance durable before relying on the in-memory Map, with restart rehydration and exactly-one terminal outcome.

Do not silently drop an unresolved accepted queue on `cleanupSession()`.

### Patch 4 — stream/feed day evidence

Add the smallest durable feed-day/restart summary sufficient to prove:

- provider/feed mode;
- first/last expected evaluation point;
- warmup ready;
- no unresolved gap;
- reconnect/backfill outcome;
- restart count/recovery outcome.

Do not build per-bar generic telemetry if deterministic summary/reconciliation is enough.

### Patch 5 — pure day reconciler

One pure/deterministic function consumes normalized evidence and returns:

```text
receipt_id
candidate identity
trading day
evidence counts
exceptions
GREEN | YELLOW | RED
reason codes
canonical receipt hash
```

Persist the resulting receipt on the existing append-only audit spine, e.g. `paper.qualification_day_receipt`. Re-running with identical evidence must be idempotent at the semantic level.

### Patch 6 — complete 3AM organ/report join

Reuse `n8n_execution_log` as the execution header. Add only the missing correlation/organ/report evidence required to convert generic workflow status into the AR-1145/1149 honest nightly receipt.

---

## 9. REQUIRED RED -> GREEN TEST PACK

### Identity mutation controls

- mutate executable config -> candidate hash changes -> RED;
- mutate dedicated live exit config -> RED;
- rename strategy while name still affects execution -> RED;
- symbol/timeframe mutation -> RED;
- JSON key reordering only -> hash stable;
- environment-only change -> run hash changes, candidate hash stable;
- runtime deploy during pinned official window -> RED/partition continuity.

### Signal/pending tests

- accepted signal -> queued -> filled = GREEN lineage;
- accepted signal -> fill miss = complete non-fill lineage;
- accepted signal -> dropped by each fill-time gate = complete non-fill lineage;
- accepted signal with no terminal event = RED;
- same accepted signal with two terminal events = RED;
- process death after durable queue acceptance but before N+1 -> restart restores exactly once;
- process death before durable acceptance -> signal may not be represented as accepted;
- cleanup/restart cannot silently erase accepted queue.

### Signal timestamp/correlation controls

- replay/backfilled bar timestamp differs from wall clock -> receipt assigns by bar/CME trading day, not insert time;
- two same-symbol signals close together require distinct correlation identities;
- null correlation on a required new qualification event -> RED.

### Position/trade tests

- fill -> position -> closed trade keeps lineage;
- fill with missing position/trade = RED;
- orphan open position after official close = RED;
- partial-close slices reconcile total contracts and lineage;
- P&L aggregate mismatch beyond tolerance = RED.

### Feed/restart tests

- clean uninterrupted day = feed leg pass;
- same-process reconnect + complete backfill = pass only with explicit completion evidence;
- unresolved gap = RED;
- cold restart with empty buffer/no warmup = RED;
- cold restart after implemented warmup + restored pending state = eligible to pass.

### Zero-trade tests

- zero trades + full evaluation coverage + zero accepted signals = eligible GREEN;
- zero trades + missing feed coverage = RED;
- zero trades + accepted queue lost at restart = RED;
- zero trades + all source signals legitimately gate-blocked with complete evidence = eligible GREEN if all other legs pass.

### 3AM tests

- n8n generic success but required organ continued-on-fail = NOT GREEN;
- missing report delivery/persistence evidence = NOT GREEN;
- deterministic fallback explicitly used and policy-approved = classified explicitly, never hidden as GPT success;
- autonomous mutation enabled during frozen PAPER = RED;
- expected 3AM run absent = RED.

---

## 10. DO NOT BUILD

Claude must not respond to this ruling by building:

- a second PAPER engine;
- a second signal evaluator;
- a second strategy identity authority;
- a second scheduler;
- a second n8n/nightly brain;
- a generic event-sourcing platform;
- a giant new telemetry warehouse;
- per-bar database spam merely to prove a day when bounded reconciliation can do it;
- a new promotion policy that weakens AR-1151 heavy robustness requirements.

The existing ledgers are mostly sufficient. Fix only the measured missing joins.

---

## 11. STATIC-AUDIT LIMIT

This ruling is a production-path static contract, not a claim that a real official PAPER day has passed.

A live GREEN receipt still requires runtime evidence from the deployed system, including the actual deployed revision, Massive feed/warmup behavior, restart behavior if any, and the real 3AM workflow run/report.

No historical commit or unit test may substitute for that live witness.

---

## 12. FINAL RULING / NEXT AUTHORIZED GPT LANE

**AR-1154: COMPLETE — contract frozen.**

Main finding:

> Trading Forge does not need a new PAPER accounting architecture. It needs a small deterministic receipt join over existing tables/audit evidence, plus four bounded durability/identity gaps. The most important newly measured correction is that the current N -> N+1 pending-entry queue is process-local and therefore cannot yet support restart-safe official PAPER qualification.

Claude remains on AR-1138 when quota returns. Do not interrupt that compiler work for AR-1154 implementation yet.

**Next GPT pre-engineering lane:** GPT-P0-2 — trace the exact PAPER qualification activation/start-resume seam so AR-1152 identity can later be stamped and verified at the smallest safe async orchestration point without making synchronous `paper-trading-stream.ts::startStream()` async.
