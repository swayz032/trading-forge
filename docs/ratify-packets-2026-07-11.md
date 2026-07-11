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

**✅ RATIFIED + SHIPPED 2026-07-11** (operator "do rest of tasks"). Landed `d9c6062b` on
`hardening/phase-0`, deployed to the tower + verified LIVE: migration 0199 applied cleanly
(closed 81 phantom rows → **0 open**, partial unique index created), C1 block did NOT
re-engage on the post-fix boot, and after a full 60s poll cycle open rows stayed 0 (the
broker-corroborated probe no longer creates phantoms). 6/6 probe vitest + full-journal
2-pass PGlite replay + tsc + 3 CI gates green. The venue→broker probe-signal shift is
flagged in-code for operator veto (`CME_STATUS_URL` restores affirmative venue detection).

---

## Packet 2 — PC-1 Power-Calibration Harness (edge-injection dual of null-cal)

### 1. What & why now

The validation battery's **specificity** is measured (null-cal: 0/100 passed, false-pass
≤ ~3.6% @95%; scope: corpus v2-2026-07-04 / that battery / that engine snapshot). Its
**sensitivity (statistical power)** — P(pass the ladder | injected strategy has a genuine
edge of specified shape) — has never been measured. A first-cut external model (session
2026-07-11, `scratchpad/gate_power_sim.py`, adversarially verified by an independent agent
in `scratchpad/verify_gate_power.py`) found, surviving verification: (a) at extraction
fidelity ~0.54 (corpus-v2 measured ceiling) modeled joint power ≈ 0.000 under every
assumption tried; (b) `performance_gate.py:127,133,183` (PF ≥ 1.7, Sharpe ≥ 1.5,
expectancy ≥ 2.0R) plus the consistency family (`:112` positive-day ≥ 0.60, `:145`
max DD ≤ $2000, `:152` ≤ 4 consecutive losing days) impose an implicit per-trade-quality
bar — at ~133 trades/yr, PF ≥ 1.7 alone maps to an implicit true-Sharpe floor ≈ 2.76
under a Style-C outcome mixture (verifier's coherence derivation); (c) the modeled B14
was vacuous-as-modeled (passed zero-edge too) — real B14 discrimination hinges on
integer-contract minimum sizing near the trailing-DD barrier and is UNKNOWN in
[0.03, 1.00]. The H2 read cannot be honestly interpreted without a measured power bound:
0 survivors at unknown-but-near-zero power is evidence about the instrument, not the
source thesis. Measuring power — rather than adjusting any threshold after seeing model
output — is the non-goalpost-moving path (campaign law 6). The 2024-2026 validation
literature flags test-power analysis as the most commonly omitted institutional item.

### 2. Blast radius

Additive instrument. Invalidates nothing: no certification, baseline, frozen ref, gate,
threshold, or engine behavior changes. No DB writes, no lifecycle mutations. Downstream:
the H2 read artifact gains a companion power-bound citation; any future H2′ threshold
re-registration would cite this harness's output — that decision is explicitly NOT part
of this packet.

### 3. The exact change, scope-locked

**In scope:** NEW file `scripts/power_calibration_harness.py` (Tier 1: gate-INPUT
injection). Generates synthetic strategy artifacts with planted true properties — grid
over {true annual Sharpe} × {trades/yr} × {Style-C skew profile incl. DLL truncation +
time-stop shaping} × {fidelity-degradation factor} — and evaluates them through the
**real, imported** gate implementations (no reimplementation):
`performance_gate.check_performance_gate`, `walk_forward` CPCV/WFE/PBO aggregation,
`monte_carlo.run_monte_carlo` + `simulate_firm_survival` (integer contract sizing, firms
`topstep_50k`/`mffu_50k`), `parameter_jitter_battery` (same-data jitters). Emits per-gate
+ joint pass-rate curves with scope stamp (engine git SHA, engaged env config, seed,
generator version) to stdout + a results doc under `docs/`.

**Explicitly OUT of scope:** any edit to any gate/threshold/engine/service file; Tier 2
(bar-level synthetic market through the full backtester — future packet if Tier 1
motivates it); null-cal changes; any lifecycle/DB write; any threshold recommendation.

### 4. Verification plan

- **Engagement evidence (campaign law 1):** per-gate invocation counters prove every real
  gate executed per injected strategy — no vacuous pass.
- **RED-proofs:** zero-edge injection reproduces ~0 joint pass consistent with null-cal's
  0/100 within binomial bounds; a hand-built dream-profile injection passes the front
  gate; a deliberately wrong-keyed gate input is CAUGHT (guards the documented
  wrong-key grandfather-pass class).
- **Determinism:** fixed seed → byte-identical curves on re-run.
- **Doer ≠ grader:** independent certification of the harness itself (skill
  `grading-integrity`) before any of its numbers are cited anywhere.

### 5. Rollback

Delete `scripts/power_calibration_harness.py` + its results doc. No persistent state,
no migrations, no env vars.

**HOLD — awaiting explicit operator ratification naming Packet 2 / PC-1.**

---

## Packet 3 — Daily-trade-cap leg overcounting (sizing/gate math)

### 1. What & why now

The daily-trade-cap gate (operator's "1-2 A+ trades/day" mandate) counts **paperTrades
rows**, but a Style C exit closes in multiple legs (TP1 33% / TP2 33% / runner 34%) — so
one A+ trade writes up to 3 closed rows and inflates the daily count ~3×, tripping the
`TF_MAX_TRADES_PER_DAY=2` cap after a single completed trade. Re-verified OPEN on tip
`d9c6062b` (workflow re-verification 2026-07-11): counting sites `paper-signal-service.ts`
~`:3589-3595` and ~`:2699-2705` (`count(*)::int FROM paperTrades`), plus the belt-and-
suspenders kill-switch feeder `paper-execution-service.ts` ~`:1215-1225`. A prior 2-site
packet (`docs/ratify-packets-2026-07-10.md`) missed the third (kill-switch feeder) site.

**Why now:** latent (no live trading today), but the moment paper trading begins the very
first completed A+ trade would exhaust the daily quota, directly defeating the mandate.

### 2. Blast radius

- Changes the daily-trade-cap count → changes WHEN entries are blocked (a signal-time gate
  other decisions trust). Must count *distinct trades*, not legs, without letting a genuine
  2nd trade slip past.
- Touches sizing/gate counting only. No backtest baseline, no frozen hash affected. Live
  paper path only.
- Risk to guard against: undercounting (counting an entry+exit as separate, or missing a
  multi-fill entry) would let a 3rd real trade through.

### 3. The exact change, scope-locked

**In scope:** change all three counting sites to count DISTINCT completed trades, not
`paperTrades` legs — count distinct `position_id` (or entry events) closed on the current
CME trading day, so a multi-leg Style C exit counts as ONE. Apply identically at the two
`paper-signal-service.ts` sites and the `paper-execution-service.ts` kill-switch feeder so
the signal-time gate and the fill-time backstop agree.

**Explicitly OUT of scope:** the `TF_MAX_TRADES_PER_DAY` default (stays 2); the CME
trading-day boundary convention (unchanged); any other gate.

### 4. Verification plan

- Fixture: one strategy, one A+ trade that exits in 3 legs → assert daily count = 1 (not 3).
- Fixture: two distinct A+ trades (6 legs total) → count = 2 → 3rd signal blocked; a genuine
  3rd trade is still rejected (no undercount escape).
- All three sites asserted to return the same count for the same trade set.
- pglite gate-chain integration test (real reader over producer-shape rows), per the
  documented no-mock-DB rule for gate tests.

### 5. Rollback

Revert the counting expression at the three sites (single-commit, no migration, no state).

**HOLD — awaiting explicit operator ratification of Packet 3.**

---

## Packet 4 — Partial-fill model live-path gap (fill/P&L math)

### 1. What & why now

The 3-zone partial-fill model (`src/engine/fill_model.py`, default-ON per §12) is referenced
ONLY by `backtester.py` / `walk_forward.py`. The LIVE paper execution path
(`paper-execution-service.ts` ~`:1890-1921`) is binary all-or-nothing — `fillRatio` is only
ever `0` or `1.0` (~`:2258`, ~`:2329`). Re-verified OPEN on tip `d9c6062b`. Consequence:
backtests model thin-volume partial fills that the live/paper path never applies, so a
large-size strategy on a thin bar shows a backtest fill the live tape can't reproduce — a
backtest↔live parity gap that inflates backtested edge for size-sensitive strategies.

**Why now:** latent today, but it is a standing parity break — the exact class the paper
engine exists to catch — and it silently favors the strategies most likely to fail live
(large size into thin liquidity).

### 2. Blast radius

- Changes live/paper fill quantities + P&L for size-on-thin-volume signals. Directly affects
  paper-journal numbers that feed promotion gates (B14/WFE/etc read backtest, but paper
  journal feeds the operator's go/no-go).
- Instrument: fill/P&L math — a measured value other decisions trust.
- Risk: a live partial-fill model that diverges from the Python backtest mirror would create
  a NEW parity gap in the other direction. TS↔Python parity is mandatory (mirror the exact
  3-zone thresholds + degraded-price formula).

### 3. The exact change, scope-locked

**In scope:** port the `fill_model.py` 3-zone model (order_qty/bar_volume thresholds +
degraded-price) into the live paper path so `fillRatio` can take intermediate values, gated
by the same `BACKTEST_PARTIAL_FILL_ENABLED` semantics, and add a TS↔Python parity fixture
proving identical fill ratios across the 3 zones.

**Explicitly OUT of scope:** the backtester side (unchanged — it's the reference); the
threshold defaults; broker-side real fills (TradersPost/TopstepX report actual fills — this
models the internal simulator only, pre-live).

### 4. Verification plan

- TS↔Python parity fixture: same (order_qty, bar_volume) → identical fillRatio + price in all
  3 zones (100% / linear-degrade / forced-partial).
- Live-path fixture: a large order on a thin bar now yields a partial fillRatio (was 1.0).
- Backtest byte-identical where volume is ample (no regression on normal-liquidity fills).

### 5. Rollback

Feature-gated on `BACKTEST_PARTIAL_FILL_ENABLED`; revert the TS port to restore binary fills.

**HOLD — awaiting explicit operator ratification of Packet 4.**

---

## Packet 5 — Bias-decisions ingest self-call storm (transport / reliability; instrument-adjacent)

### 1. What & why now

**This is the confirmed root cause of the 2026-07-11 P0 port-exhaustion storm** (attributed
live 2026-07-11 by the new rate-limit path/method/UA instrumentation: `POST
/api/bias-decisions/ingest`, `curl/8.20.0`, `::1`). `bias_engine.py` ~`:1402` fires a
fire-and-forget `subprocess.Popen(["curl", ..., "/api/bias-decisions/ingest", ...])` on
**every** `compute_bias()` call. A bulk bias computation (boot-catchup or a backfill over a
date range × 3 symbols) fans out to hundreds/thousands of curl subprocesses, each a NEW
loopback TCP connection (no keep-alive) → TIME_WAIT accumulates faster than the OS reclaims
→ ephemeral-port pool exhausted (16.2K sockets observed) → API 429s everything.

**Mitigation already shipped (not the fix):** the escape-valve exemption
(`/api/admin/self-restart` + local `/api/health` now bypass the limiter) closed the acute
danger (recovery + heartbeat no longer starve — verified live: health stayed HTTP 200 during
a boot-catchup burst). The fan-out itself remains.

**Why now:** the storm is bounded on a normal boot but ran for hours in the original incident;
it will recur on any bulk bias recompute/backfill. It touches `bias_engine.py` (instrument-
adjacent — the bias engine produces the bias/regime numbers), so the transport fix is
staged, not momentum-fixed. The shadow-write side-effect does NOT change any bias number.

### 2. Blast radius

- Changes HOW bias-decision shadow rows are transported to the DB (curl-per-call → batched or
  pooled). Does NOT change the bias/regime computation, the decision, or any downstream number.
- Touches `bias_engine.py` shadow-write path + possibly the `/api/bias-decisions/ingest`
  route (batch endpoint). No gate, no sizing, no exit logic.
- Risk: the shadow write is fire-and-forget/fail-open by design — the fix must preserve that
  (a batching failure must never block or alter `compute_bias()`).

### 3. The exact change, scope-locked

**In scope (pick one at ratify):** (A) replace per-call `curl` with an in-process bounded
queue that batches N decisions into one `POST /api/bias-decisions/ingest-batch` with keep-
alive; OR (B) a concurrency cap + connection reuse on the existing per-decision POST; OR (C)
write shadow rows directly to Postgres from the Python side (no HTTP self-call at all). Add a
per-boot-catchup guard so a bulk recompute cannot fan out unbounded.

**Explicitly OUT of scope:** the bias/regime computation; the decision schema; the shadow-
write fail-open contract (preserved).

### 4. Verification plan

- Repro: a bulk `computeBiasForAllSymbols` over a multi-day range spawns O(1) batched calls
  (or bounded concurrency), not O(N×symbols) curl subprocesses — assert socket count stays
  flat (netstat before/after).
- Fail-open preserved: inject an ingest-endpoint failure → `compute_bias()` return value
  unchanged, no throw.
- The rate-limit path/method/UA attribution (already shipped) shows zero
  `/api/bias-decisions/ingest` rejections on a bulk recompute after the fix.

### 5. Rollback

Revert the batching/transport change to restore per-call curl (the escape-valve mitigation
remains regardless, so recovery is never re-endangered).

**HOLD — awaiting explicit operator ratification of Packet 5.**

---

## Carry-forward findings still needing their own packets (NOT authored here)

These are recorded findings, not packets. Each needs its own 5-part packet before
any code — listed so the next session doesn't mistake them for ratified work:

- **Daily-trade-cap leg overcounting** → now **Packet 3** above (full 5-part, staged).
- **Partial-fill model live-path gap** → now **Packet 4** above (full 5-part, staged).
- **Bias-decisions ingest self-call storm** (the P0 root cause) → now **Packet 5** above.
- **ds19 branch account-scoping** (kill-switch scoping) — the accountKey scoping
  deliberately omitted from the broker-router firm-prefetch fix.
- Remaining Track-B findings (SHADOW ladder edge, B14 counter-reset, fingerprint
  truncation, pattern-aggregator scoping) — re-verify from zero before packeting.
- **Fade-the-losers selection layer** (2 findings, 2026-07-11 session): (a) fadeability
  screens NET expectancy with no cost correction (`fade-the-losers-service.ts:226-231`) —
  inverted ≈ −gross − 2×costs, so cost-dominated marginal losers fade into losers;
  (b) fades carry no loser-tail selection deflation / own FDR family (deferred in
  `docs/superpowers/specs/2026-07-03-fade-the-losers-design.md:34`). Dormant-priority:
  graveyard currently has 0 directional losers (119/119 bidirectional-sentinel).
- **Doc/code drift, record-only (2026-07-11 gate-chain read):** A7 audit rows stamp
  `threshold: 0.85` while the decision uses 0.70 (`lifecycle-service.ts:845,883` vs
  `correlation-constants.ts:20`); WFE binding floor at PAPER→DEPLOY_READY is the
  orchestrator's 0.80 (`promotion-gate-orchestrator.ts:47`) vs §12's 0.70 row; §12 B14
  "40% consistency cap" vs coded `B14_PAYOUT_DENIAL_THRESHOLD=0.10` + 0.50 caps
  (`monte_carlo.py:885`); stale `WF_MODE` docstring (`walk_forward.py:1173` says plain,
  code defaults cpcv `:1193`); tier PF 1.75 (`performance_gate.py:252`) vs canonical
  1.7 (`:36`).

## Superseded / withdrawn

- **Confluence-sizing schema-drift packet** (`docs/ratify-packets-2026-07-10.md`
  Packet 2) is **SUPERSEDED** — the underlying `confirming_indicators` drift was
  closed by the ds22 FIX A1/F-1 wave; the remaining `1.0x` multiplier pinning is a
  documented operator opt-in flag (`CONFLUENCE_SIZE_UPSIZE_ENABLED`, default false),
  not a silent bug. The only live decision is a product one: whether to flip that flag.
