# ALGO-012 — Evaluator closed 4 of 5; the independent grader is BLOCKED. Semantics not started.

**Strategy head:** `28345a5e639e` · PR #38 **OPEN / DRAFT / DO NOT MERGE**.

Reporting a blocker rather than working around it, per ALGO-011 §9: *"If the repaired-evaluator
independent grader fails before semantic work begins, publish that failure instead of hiding it
and do not mutate semantics until it is understood."*

---

## 1. The blocker

I dispatched the fresh DISPROVE grade against the repaired evaluator. It failed:

> `idleReason: "failed"` · `failureReason: "You've hit your weekly limit · resets 7pm (America/New_York)"`

It is an account-level quota, not a defect in the work and not something I can route around.
Dispatching another grader would hit the same wall, and grading my own repair is exactly what
doer ≠ grader forbids — **I have published two wrong baselines in one day, so my self-assessment
is worth less here than usual.**

**Consequence: the four-route state machine is NOT started.** No strategy-semantic file has been
touched. §9 gates semantics on this grade and the gate has not opened.

---

## 2. ALGO-011 §9 evaluator closure — 4 of 5 CLOSED

| # | item | state |
|---|---|---|
| 1 | exact-head workflows green | **CLOSED** — 9/9 SUCCESS at `068bb24a` |
| 2 | independent DISPROVE grade of the repaired evaluator | **BLOCKED** — weekly limit |
| 3 | real `force_snapshot` receipts, red-proofed | **CLOSED** — `068bb24a` |
| 4 | F-5 documentation corrected | **CLOSED** — `55a9b5f5` |
| 5 | session/window dual contract + censoring load-bearing | **CLOSED** |

### 3 · Force receipts are now real and falsifiable

The regrade recomputes `force_snapshot` at each candidate's own
`(signal_time, confirmed_time, direction)` — the same pure call the kernel gated on. All 14
in-window entries carry one. Sample, 2026-03-23: `confirmed True`, clock `11:27:00-04:00`,
2 completed 1m observations, `path_efficiency 1.0`,
`latest_close_at_directional_extreme True`, reason `SUSTAINED_DIRECTIONAL_FORCE`.

It can go red: the regrade raises `FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` if the
recomputation ever returns unconfirmed. Red-proofed — falsified gate raises, confirmed gate
does not.

### 4 · I was wrong about the bullet, and you were right

You refuted ALGO-010's *"the bullet mechanism does not exist"* and I reproduced your evidence
before accepting it. All three sites are real: `return` inside the candidate loop in
`_analysis_run_day` (AST-confirmed), first-actionable-only in the signal path, and the explicit
`DAILY_BULLET_ALREADY_RESOLVED` guard in the shadow runtime.

**Why I missed it: a rule implemented as control flow has no name to grep for.** I searched a
vocabulary — `one_trade`, `bullet`, `max_trades`, `already_traded_today` — found nothing, and
published absence. That is the second absence claim this session that a structural
implementation defeated; the first was reading an empty `initialSL` column as "no stop data"
when the stops were encoded in the realized loss.

`research/current_mnq_strategy_v2_4_session_budget.py` now names the invariant once, records
each enforcement site and *how* it enforces, and adds **no trading rule**. Red-proofed 5 arms —
removing the in-loop return goes red, which is the defect my false claim said already existed.

---

## 3. §8 — the 315 is retracted. Deduplicated it is 177, and the ratio is 15:1

You were right that 315 could not be compared to 7. I divided incommensurable quantities: 315
counts per-decision-clock observations of possibly-persistent setups; 7 counts decisions.

| | |
|---|---|
| raw survivor observations | 315 |
| **deduplicated episodes** | **177** (1.8 observations each) |
| episodes per session | 12.6 |
| **uncensored sessions: episodes vs trader trades** | **106 vs 7 = 15.1 : 1** |

Grouping: `(session, direction, legal_route, location_id)`, new episode when consecutive
permission clocks are more than one 5m bucket apart.

**Sensitivity, because the gap is my choice and not a fact:** 1min → 224, 5min → 177,
15min → 150, 30min → 139. The ratio stays roughly 12:1 to 20:1 across every grouping, so the
conclusion does not rest on the parameter. A test enforces that the sensitivity is always
reported and that a larger gap can never produce more episodes.

**By legal route:** `A_NORMAL_REJECTION` **152**, `D_PREBREAK_RETEST` 18, `B_NORMAL_BREAKOUT` 6,
`C_PREBREAK_DISPLACEMENT` 1. Route A is **86%** of all permission episodes — independently
consistent with your §5B source-level finding that rejection authorization is self-attested,
and reached without touching the scorecard.

Executability is marked per §2: only the first episode by permission clock could reach
execution under the real budget. The module states, and a test pins, that this may never again
be cited as evidence that production takes more than one trade.

---

## 4. Current measured state

Scorecard at `068bb24a`, window join, censoring segregated:

- exact action agreement **6/14**; on the 8 decided cases **6/8**
- opposite direction at decision **1** — 2026-04-09
- bot-only entry against a real decline **1** — 2026-04-02
- missed trader entries **0** *(branch now live but unexercised — flagged as a residual risk
  below)*
- censored, segregated **6**
- decisions through window end / in-window **39 / 25**

---

## 5. Residual risks I am carrying, unverified

Stated because nobody has graded the repair:

1. **`missed_trader_entry = 0` is live but unexercised.** `bot_declined_in_window_count` is
   also 0, so the branch has never fired on this corpus. I have moved it off a structurally
   dead path, but I cannot prove from data that it is reachable. This was one of my briefs to
   the blocked grader.
2. **`_mismatch_class` is my rewrite and nobody else has read it.** Its censored branch returns
   before every other check.
3. **The episode grouping rule is mine.** Sensitivity is reported, but the rule itself is
   unreviewed.
4. **The scorecard filename still says `2026_08_21` while `produced` says `2026-08-22`.**
   Cosmetic, flagged rather than silently fixed mid-packet.

---

## 6. What I propose, and what I will not do without a ruling

**Will not do:** start the four-route state machine. §9 gates it on the grade.

**Ask:** the quota resets at 7pm America/New_York. Options as I see them —

- **(a)** hold semantics until the grader is available and re-dispatch then;
- **(b)** you grade the repaired evaluator yourself from the repository, as you did for
  ALGO-006, and rule whether §9.2 is discharged;
- **(c)** authorize a narrower start — e.g. the X-ray/state-machine scaffolding that adds no
  production authority — while the evaluator grade stays pending.

I lean **(b)**, because you have graded this repository directly twice and the evaluator is
small enough to inspect: the whole repair is three files and the window-join change is four
lines. But it is your call, and I would rather wait than mutate semantics on an ungraded
instrument for the third time today.

**No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this packet.** PR #38 remains DRAFT / DO NOT MERGE.
