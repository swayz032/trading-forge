# AR-1094 (worker) — F-4 REPAIRED: A SOURCE-MANAGED TRADE NOW RELEASES THE POSITION. GRADE DISPATCHED.

**Governing:** AR-1092 §5–§10 · **Pin:** `45e4ca84` (pushed) · **Pre-flight:** AR-1093 at `66c9a476`
**Grade:** `accuracy-validator`, DISPROVE, dispatched at this pin — verdict to
`docs/advisor-rulings/GRADE-F4-TRADE-POPULATION-2026-08-12.md`, to be published IN FULL, not summarised.

---

## 1. WHAT THE DEFECT ACTUALLY WAS — MEASURED AT THE LINE, NOT INHERITED FROM THE GRADE

`[MEASURED HERE]` occupancy is owned by `vbt.Portfolio.from_signals` (`backtester.py:7814`), and it
is decided **before** any source logic runs. `exit_long` is framework-owned; no source strategy sets
it. So vectorbt opened on the first source entry, never saw a reason to close, dropped every later
event, and `_apply_source_fixed_r_management` (`:1095`) — which iterates `trades_records`, i.e.
**vectorbt's output** — retrofitted the taught stop and target onto the one record that survived.

★ **`THE SOURCE ENGINE WAS DOWNSTREAM OF THE DECISION IT NEEDED TO INFLUENCE. IT COULD RE-PRICE THE
ONE TRADE VECTORBT MADE; IT COULD NOT CREATE THE TRADES VECTORBT REFUSED.`**

Your §5 chain is confirmed at the executable line. AR-1093 records the full six-question pre-flight,
committed **before** the first production edit.

---

## 2. THE REPAIR, AND WHY IT IS NOT A SECOND BACKTESTER (§9.1, §9.7)

**The shape already existed in this file.** `_apply_dsl_stop_loss_and_time_stop` (`:3597`) is a
forward bar loop that holds `in_long`/`in_short`, writes `exit_long_out[i] = True` when a level fixed
at entry is breached, and clears occupancy so a later entry survives. It is **bypassed** under
SOURCE_FAITHFUL because its *content* is the house ATR ceiling and the 15:55 flatten — neither
taught.

⚠️ **THE BYPASS GAVE UP THE HOUSE RULES AND, SILENTLY, THE OCCUPANCY RELEASE WITH THEM. Nothing
replaced it.** That is the whole of F-4. The repair puts source-owned arithmetic into that same
architectural slot.

**Three commits, in this order, deliberately:**

| pin | what |
|---|---|
| `66c9a476` | the §6 pre-flight, recorded **before** any code changed |
| `cd21522c` | `_resolve_source_managed_exit` extracted — **behaviour-neutral**, 102 green, and the collapse still present |
| `45e4ca84` | `_apply_source_faithful_occupancy` + proof matrix |

**The middle commit is the one that makes the last one auditable.** The extraction was proven to
change nothing *while the defect was still there*, so the population change at `45e4ca84` cannot be
confused with a side effect of moving code.

### §6 Q5 — ONE AUTHORITY, ENFORCED STRUCTURALLY

`_resolve_source_managed_exit` is the **single implementation** of "where does this source trade
close?". The pre-portfolio occupancy pass calls it to decide where to write the exit; the
post-portfolio management calls it to price the record. ★ `TWO CALLERS OF ONE FUNCTION CANNOT
DISAGREE; TWO COPIES OF ONE FORMULA ALWAYS EVENTUALLY DO.`

### §7/§9.2 — CAUSALITY

The stop and the fixed-R target are **both fixed at the entry bar** from the taught anchor; the scan
returns the **first later bar** that touches one. An exit at bar `k` depends only on entry-time
levels and bars ≤ `k`. ★ `A FORWARD SCAN FOR A LEVEL SET AT ENTRY IS SIMULATION; PICKING THE BAR
THAT FLATTERS THE RESULT IS LOOK-AHEAD. THEY ARE NOT THE SAME ACT.`

### §4 — vectorbt WAS NOT GIVEN EXIT AUTHORITY

`from_signals` is still called with no `sl_stop`, no `tp_stop`, no `price=` array. The codebase's own
comment at `:5487` says why, and delegating would have handed gap-through and same-bar resolution to
conventions this campaign did not certify — your §9.3. **Measured, not assumed.**

### FAIL-CLOSED PLACEMENT

The pass sits **outside** the guard `try/except`. That block is fail-*safe* and degrades to an
unguarded run; degrading here would silently restore the collapsed population under a
SOURCE_FAITHFUL label. ★ `THE OFF BRANCH OF A CORRECTNESS REPAIR MUST REFUSE, NEVER FALL BACK TO THE
WRONG ROUTE.`

---

## 3. THE PROOF MATRIX — §8 P1–P8

`src/engine/tests/test_source_trade_population.py`, 15 tests, every one driving the **real persisted
Band C route** through `bt.main.callback` and reading **returned trade records** (§8 P8).

| § | proof | state |
|---|---|---|
| P1 | 3 separated events → 3 trades; separation itself ASSERTED (each exit < next entry, one per session) | **GREEN** |
| P2 | an event arriving while a trade is open is rejected, counted, and the policy disclosed | **GREEN** |
| P3 | mutating session 2's wick moves trade 2's stop 7.5→7.0 and target 134.0→133.0 **while trades 1 and 3 do not move** | **GREEN** |
| P4 | entry bars unique; trade count ≤ the engine's own `raw=` count, read from the diagnostic rather than hard-coded | **GREEN** |
| P5 | ablating the occupancy pass collapses 3 → 1 **and reproduces `vectorbt drop: 67%`** | **GREEN (RED-PROOF)** |
| P6 | legacy + `TF_OVERLAY_VARIANT` unreachable (spy, with positive witness) + canonical population | **GREEN, scope stated below** |
| P7 | source exit semantics still certified | **GREEN** — 174 across all source suites |
| P8 | end-to-end Band C witness disclosing events / trades / suppressions separately | **GREEN** |

**P5 is the load-bearing one.** Without it, P1's green is compatible with a fixture that would have
produced three trades anyway.

### P3, concretely

`entry 119.0 · risk 7.5 · exit 134.0` on trades 1 and 3; `risk 7.0 · exit 133.0` on the mutated
trade 2 — and every trade asserted to exit at exactly `entry + 2 × its own risk`, so target and stop
are jointly witnessed per trade rather than by one shared constant.

### P6 — HONEST SCOPE

The spy proves the pass is **unreachable** from both non-source arms, with a positive witness that
the spy fires at all on the source arm. **A non-vacuous legacy trade-population control could not be
built on this fixture** — the legacy arm produces `raw=0` on this price action `[MEASURED, AR-1087]`,
which is exactly the skip-only weakness your §2 warned about. The executing evidence is therefore
the committed canonical population, below. **I am naming this as the weakest link in my own matrix.**

### THE REGRESSION MEASUREMENT — BY MEMBER-LIST DIFF, BOTH DIRECTIONS

The campaign's committed instrument (`canonical_regression_population.txt`, 107 members, AR-1086's
law: never a total):

```
at 45e4ca84 (mine):     32 failed, 2387 passed, 2 xfailed   (124.67s)
at 66c9a476 (baseline): 32 failed, 2387 passed, 2 xfailed   (134.34s)

ONLY-AT-MY-PIN:   (empty)   <- zero attributable regressions
ONLY-AT-BASELINE: (empty)   <- zero failures silently masked
IDENTICAL MEMBERS: 32
```

Baseline ran in a real detached worktree at `66c9a476`, verified by `git rev-parse` inside it,
removed after. **Both directions matter**: a change that makes a pre-existing red disappear is also
a change nobody asked for.

---

## 4. WHAT I GOT WRONG, AND THE INSTRUMENT TRAPS — SURFACED, NOT TIDIED (§0-CTRL.4)

1. **My first extraction did not run at all** — I moved the target computation into the new helper
   and left its lazy `compute_source_fixed_r_target` import behind. `NameError`, 9 failed / 7 errors.
   Caught by running, not by reading.
2. **My P2 fixture was not what I named it.** I built `_never_resolves()` to make the first trade
   touch neither level. `[MEASURED]` the flat band is itself a displacement-and-gap shape, so the
   session emitted a **FOURTH** source event (`raw=4`), and the trade *did* resolve — carrying into
   the next session and hitting its taught stop there, because the source contract has no time stop.
   **My positive witness caught it**, which is the only reason it did not become a green built on a
   false premise. Renamed `_second_event_while_open()` and rewritten against the measured truth —
   and it is now the **stronger** P2 witness, because the overlapping event is genuinely in-session,
   which is literally what your §8 P2 asks for. ★ `A FIXTURE IS WHAT IT MEASURES, NOT WHAT I NAMED
   IT.`
3. **A count is not an identity.** P2 originally asserted only that one event vanished. That green is
   also produced by a pass dropping an arbitrary event for an unrelated reason. I added
   `source_overlap_suppressed_bars` to the metadata and now assert the rejected bar lies **strictly
   inside the open trade's interval**. Your §8 P2's "visible in audit metadata" is what forced this.
4. **My sparse baseline checkout was a broken instrument.** Cone-mode `src`-only produced 6 collection
   errors; the failing test said so in words — *"this file is committed, so its absence is a broken
   checkout, not an environment gap"*. Full checkout, 2421 collected, 0 errors. **I nearly reported a
   baseline that was measuring my checkout.**
5. **`ruff` rejected two commits** (dead import, import order). Fixed and re-run, not bypassed.

---

## 5. 🛑 A LIMITATION F-4 MADE VISIBLE, AND IT DOMINATES ANY FUTURE P&L NUMBER

`[MEASURED]` the three trades are **identical in every source-owned value** — entry `119.0`, risk
`7.5`, exit `134.0`, `source_fixed_r_target` — and yet:

```
trade 1 (bar 8):  Size = 1.0      PnL = 73.76
trade 2 (bar 41): Size = 15.0     PnL = 1031.40
trade 3 (bar 74): Size = 15.0     PnL = 1031.40
```

The class path sizes with `PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500.0)` off
ATR-14 (`:~7535`). At bar 8 the ATR is still inside its own warmup, so the sizer falls back to 1
contract; by bar 41 it is established and asks for 15.

**This is not a defect and it is not mine** — framework-owned SIZING is deliberately separate from
source-owned entry/stop/target, and F-4 touched no sizing code. But it was **invisible while only one
trade ever existed**, and it is a **15× lever on P&L**. I did **not** fix it: that would be a
silent, unauthorized change to money-path behaviour under cover of a different unit.

★ **`THE SOURCE OWNS WHERE THE TRADE STARTS AND STOPS; THE HOUSE OWNS HOW BIG IT IS — SO A P&L
NUMBER FROM THIS ROUTE IS NOT YET A STATEMENT ABOUT THE TEACHER.`**

Pinned as a test so no expectancy / Sharpe / drawdown claim is ever read off this population without
meeting it first. **Flagging it for your ruling — it is squarely in your §10.5 territory.**

---

## 6. TESTS WHOSE OUTCOME I CHANGED — NAMED, WITH THE OLD ASSERTIONS QUOTED

Six assertions in `test_source_band_c_vertical.py` encoded the collapsed population. **None was
weakened; the discriminators got stronger.**

- fixture `len(trades) == 1` → `== 3`; `total_trades 1` → `3`; `"1 signal exits"` → `"3 signal exits"`
  (the counter DEFECT is unchanged — it still files source target hits under "signal exits").
- **discriminator 16** and **discriminator 14**: `len == 1` was a *positive witness that the event
  survived*. Now `== 3` **and a loop asserting the rule on all three trades** — three independent
  witnesses where there was one. 14 additionally keeps its meaning explicitly: a Style-C partial
  would show up as **more** than three records.
- `test_only_one_of_three_signals_becomes_a_trade_and_that_is_DISCLOSED` → **replaced** by
  `test_every_source_signal_now_becomes_a_trade_F4_CLOSED`, which **quotes the three old assertions
  verbatim in its docstring** rather than deleting them, and asserts `vectorbt drop: 0%` — ⚠️ the
  drop line is **not gone**, it now reads zero, because a missing line is indistinguishable from a
  renamed diagnostic while a line reading `0%` is a positive witness the same instrument still
  measures the same quantity.

**I am asking the grader specifically whether any of these lost discriminating power.**

---

## 7. STOP CONDITIONS — NONE FIRED

`9.1` no second backtester (reused the `:3597` slot) · `9.2` no future-looking exit · `9.3` vectorbt
given no exit authority · `9.4` single-run only, the walk-forward refusal at `:9202` untouched ·
`9.5` legacy/overlay population identical by member-list diff · `9.6` event↔trade identity 1:1
(asserted in P4) · `9.7` one arithmetic, two callers.

---

## 8. WHAT I DID **NOT** MEASURE

- **Real market data.** Everything here is the 3-session synthetic fixture.
- **A non-vacuous executing legacy control through this block** (§6 above — my weakest point).
- **The short side.** Symmetric code exists; on this source it is unreachable, so it is
  **UNPROVEN**, not proven.
- **Scale.** The grade measured `40 events → 1 trade`; I have **not** re-run a 40-session frame to
  show `40 → 40`. My N is 3 (your P1 floor), and I am not claiming the larger number.
- **DST / half-session / gap frames**, and post-RTH bars sharing an ET date.
- ⚠️ **The manifest does not contain my new test file** (`grep -c` = `0`), and it imports
  `spec_condition_compiler`, so a regeneration would move the denominator from 107. **I did not
  regenerate it** — changing the acceptance denominator inside the unit being accepted is the wrong
  order of operations. The guard that detects this staleness is red at the baseline too. Standing
  condition, carried forward from AR-1086, not fixed under cover of this unit.
- **No performance claim of any kind.** Your §7 forbids it and §5 is why: I have repaired the
  population, and §5 above says the P&L on it is still dominated by house sizing.

---

## 9. STATE

**F-4 mechanically GREEN at `45e4ca84`.** 174 green across all source suites; canonical population
identical by member-list diff in both directions; ablation restores the collapse.

**Your §10 step 2 is DISPATCHED** (DISPROVE, ≥1 novel attack required, four questions where I may
simply be wrong, durable receipt path). §10 steps 3–5 await its verdict.

**No sVkm performance/edge backtest has been run and none is authorized.**

**Pin `45e4ca84`.**
