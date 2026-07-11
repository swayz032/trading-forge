# Ratify Packets — 2026-07-11

> **STATUS: STAGED, NOT STARTED.** Zero code written. None of these may proceed
> without EXPLICIT per-packet operator ratification ("ratified" / "fire" / "yes
> do it" on the named packet). Packet existence is not authorization. Momentum
> ("continue", "the board is moving") does not ratify instrument/execution-gate code.

---

## Packet 1 — C1 exchange-outage phantom-block (execution-gate)

### 1. What & why now

The C1 CME-outage entry gate is **stuck engaged on a phantom outage** and, once
paper trading starts, will hard-block every new paper entry. Root causes, all
verified read-only on tip `4444ee28`:

- **Dead probe URL.** `exchange-status-service.ts:116` defaults `CME_PROBE_URL`
  to `https://www.cmegroup.com/CmeWS/mvc/Venue/GLOBEX/status`, which no longer
  works: `curl` with the code's `Accept: application/json` header → **HTTP 000
  (15s timeout)**; with a browser UA → **HTTP 403**. The probe path fails CLOSED
  (`:166-181`), so every 60s poll records another outage.
- **In-memory-only dedup + boot race.** `pollCmeStatus` checks only the in-process
  `activeOutageIds` map (`:200`), never the DB, before inserting (`:212-220`).
  `reconcileMissedRuns()` catchup-runs the gate-exempt `cme-status-poll`
  immediately at boot with no job lock, beating the 3s-deferred
  `reconcileOutageState()` — so a fresh row is inserted before the map is
  hydrated. Evidence: **80 unresolved CME rows** (live SELECT 2026-07-11),
  oldest 2026-05-03, newest today 11:01Z; same-second duplicate pairs
  (2026-06-28 09:30:00.285/.293) and 26 rows on the 2026-05-20 crash-loop day
  prove the unlocked concurrent catchup+cron race.
- **Auto-resolve can never fire.** The probe-OK branch (`:273-302`) that would
  close an outage is unreachable because the dead URL never returns OK; and even
  if fixed, resolution closes only ONE mapped row per cycle, so the 79 stale rows
  re-engage the block every boot via `reconcileOutageState()` (`:458-486`).

Blocking mechanism confirmed: `paper-execution-service.ts:903-931` `openPosition()`
consults `isExchangeHalted("CME")` on every entry and returns `filled:false`; the
signal path funnels through `openPosition` (`paper-signal-service.ts:2794`).

**Why now:** latent today (production HALT, 0 open positions, all-CANDIDATE — the
intentional hardening-first phase), so **zero live impact currently**. But it is a
guaranteed hard block the moment paper trading begins, and every boot re-engages it.

### 2. Blast radius

- Changes WHEN paper/live entries are blocked by C1 — an execution-safety gate
  other systems trust. Must remain fail-CLOSED on a GENUINE outage.
- Touches `exchange-status-service.ts` (outage state machine) and a one-time
  operator-approved DB close-out of 80 phantom rows.
- No backtest/promotion baseline invalidated (C1 is a live-execution gate, not a
  measured metric). No frozen-policy hash affected.
- Risk to guard against: a fix that makes the gate too eager to auto-resolve
  could clear a REAL outage. The verification plan must prove a real outage still
  blocks and still fails closed.

### 3. The exact change, scope-locked

**In scope:**
1. Replace/repair the CME availability probe — either a working endpoint or a
   probe method that returns a trustworthy operational signal (decision point:
   operator to confirm the probe source; a candidate is the CME status JSON with
   a browser UA, or a broker-reachability probe via the existing Tradovate path).
2. DB-aware dedup: partial unique index `WHERE ended_at IS NULL` on `exchange`
   (one open row per exchange max) + a DB existence check in `pollCmeStatus`
   before insert.
3. Serialize the boot catchup path for `cme-status-poll` under `_tryAcquireJobLock`
   so reconcile completes before a poll can insert.
4. One-time operator-approved SQL close-out of the 80 phantom rows
   (`UPDATE exchange_outages SET ended_at = now(), response_taken = 'phantom_cleanup'
   WHERE ended_at IS NULL` — exact statement in the implementation PR for review).

**Explicitly OUT of scope:** the C2 firm-suspension gate; the paper-execution
openPosition gate logic itself (only the outage-state source changes); any change
to the fail-CLOSED-on-genuine-outage contract.

### 4. Verification plan

- **Repro-before:** live SELECT count of unresolved CME rows (currently 80) +
  the dead-URL curl transcript (HTTP 000 / 403) attached.
- **Probe unit test:** operational-signal → no outage row; genuine non-200 /
  connection failure → outage row + entry block (fail-CLOSED preserved).
- **Dedup test:** two concurrent poll inserts + a boot-catchup race produce AT
  MOST one open row per exchange (partial-unique-index enforced).
- **Auto-resolve test:** probe flips OK → the single open row closes and the
  entry block lifts; probe flips back to failure → a new outage opens and blocks.
- **Post-fix live check:** unresolved-row count returns to 0 (after the approved
  close-out) and a boot no longer emits "startup reconciliation found active
  outages — entry block re-engaged" for a phantom.
- Migration authored via skill `migration-author` (idempotent partial index);
  independent certification via skill `grading-integrity` (doer ≠ grader).

### 5. Rollback

- Revert the `exchange-status-service.ts` diff and drop the partial unique index
  (migration reversible). The phantom-row close-out is forward-only but harmless
  (rows are ended, not deleted; a genuine future outage opens a fresh row).
- `CME_STATUS_URL` env override remains, so the probe source can be repointed
  without a code change if the chosen endpoint degrades.

**HOLD — awaiting explicit operator ratification of Packet 1.**

---

## Carry-forward findings still needing their own packets (NOT authored here)

These are recorded findings, not packets. Each needs its own 5-part packet before
any code — listed so the next session doesn't mistake them for ratified work:

- **Daily-trade-cap leg overcounting** (sizing/gate math). Re-verified OPEN on tip:
  `paper-signal-service.ts:3589-3595` / `:2699-2705` and the kill-switch feeder
  `paper-execution-service.ts:1215-1225` count `paperTrades` rows (per-leg), so a
  multi-leg Style C exit inflates the daily count. A prior 2-site packet
  (`docs/ratify-packets-2026-07-10.md`) missed the third site.
- **Partial-fill model live-path gap** (fill/P&L math). Re-verified OPEN: `fill_model.py`
  is referenced only by `backtester.py`/`walk_forward.py`; the live paper path
  (`paper-execution-service.ts:1890-1921`) is binary all-or-nothing (`fillRatio` only
  0 or 1.0). Backtests model partial fills the live path never applies.
- **ds19 branch account-scoping** (kill-switch scoping) — the accountKey scoping
  deliberately omitted from the broker-router firm-prefetch fix.
- Remaining Track-B findings (SHADOW ladder edge, B14 counter-reset, fingerprint
  truncation, pattern-aggregator scoping) — re-verify from zero before packeting.

## Superseded / withdrawn

- **Confluence-sizing schema-drift packet** (`docs/ratify-packets-2026-07-10.md`
  Packet 2) is **SUPERSEDED** — the underlying `confirming_indicators` drift was
  closed by the ds22 FIX A1/F-1 wave; the remaining `1.0x` multiplier pinning is a
  documented operator opt-in flag (`CONFLUENCE_SIZE_UPSIZE_ENABLED`, default false),
  not a silent bug. The only live decision is a product one: whether to flip that flag.
