# ALGO-178 — P1 WIDENED TO ALL 14 SESSIONS AND **FOUND A SECOND CAUSALITY LEAK.**

**Strategy head:** `ce3acfca` — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic file modified: `current_mnq_strategy_v2_4_kernel.py`, authorized by ALGO-174.**
Repair committed at `b9b87b61` **before** its acceptance existed, per ALGO-176 §1.
**Gate:** the full suite's failure set is now **BYTE-IDENTICAL TO THE REVERTED-KERNEL BASELINE** —
the same 8 members, verified by `comm`, not by count. **Zero net regressions.**
Touched-file suites: `24 passed` — `window_bound_census` (14, includes both updated guards) · `kernel_location_causality_P1_P2` (5) · `kernel_warmup_ref_never_reaches_the_location_builder` (5). (before P1 was widened; see §2A).

---

## 1. THE REPAIR

The location set is rebuilt **inside the bucket loop, at each decision's own `ts`**. The `09:30`
literal is gone from the decision path. **No fixed anchor replaced it** — `08:00` would have been
the same defect with a friendlier number. **There is no constant left to choose, so there is
nothing to fit: this removes a degree of freedom rather than adding one.**

**Cost, measured before the edit so no runtime number could choose the semantics:** 96
buckets/session × `0.887 s` = `85 s`/session → **19.9 min for the 14 sessions**, **45.5 hours for a
1,925-session backtest.** The naive rebuild was implemented *because it is the most correct one*;
the 15m-close optimisation was costed and **not adopted**.

## 2. ACCEPTANCE — `P1 ∧ P2`, each with its control RED **first**

| | property | result |
|---|---|---|
| **P1** | `build(env, T)` **==** `build(env truncated to bars completed by T, T)`, by key | **55 of 56** — see §2A |
| **P2** | the anchor argument is the bucket loop variable; no literal reaches it | **PASS** |

**P1 is not tautological** — the two calls take **different inputs**. **Not a reimplementation** — it
calls the production builder twice.

**Truncation is BY COMPLETION, not by index.** A 15m bar stamped `09:15` has not completed at
`09:20`; truncating by index would have left a forming bar in the input and **made P1 pass for the
wrong reason.**

**CONTROLS, RED BEFORE EITHER WAS REPORTED:**
- P1 — a future-bar peek (zones built one hour past the anchor) → **RED**
- P1 — a peek in the **ATR reference line alone** → **RED**. *P1 is sensitive to a one-line peek,
  not merely a gross one.*
- P2 — a clock literal back in place of the loop variable → **RED**

**`P1 ∧ P2` entails the property for every decision, including ones never run** — which is exactly
what a per-decision predicate could not do.

## 2A. 🛑 WIDENING P1 FROM 3 SESSIONS TO 56 ANCHOR-PAIRS FOUND A **SECOND, DIFFERENT LEAK**

Per ALGO-177 §ORDER-1, P1 now runs **all 14 sessions × 4 fixed anchors** (`08:05 / 09:00 / 09:25 /
11:30`). **`55 of 56` pass. One fails, and it is not the anchor defect.**

```
P1 VIOLATED at 2026-03-25 09:00
  only with future bars: R:2026-03-24T15:15  R:2026-03-25T08:45  S:2026-03-25T06:30
                         SWING:S:2026-02-17T01:15  SWING:S:2026-02-17T11:15
  only when truncated  : []
```

**All five have `created` BEFORE the anchor, so the full build includes them legitimately.** The
difference is *authorization*, and the mechanism is measured, not inferred:

| at `2026-03-25 09:00` | `pm_structure` |
|---|---|
| built from **all** bars | **`DOWN`** |
| built from bars completed by `09:00` | **`MIXED`** |

**`core.PRE_END = 09:29`.** The premarket plan windows to `09:29` **regardless of the decision
clock**, so a decision at `09:00` consults a structure label computed from **6 bars that had not
printed.** And `MIXED` is exactly the branch that gates `_range_room_authorization`
(`if str(plan.pm_structure) != "MIXED": return locations`) — **so future bars switch an entire
authorization gate on or off.**

### 🛑 AND THIS DEFECT WAS UNREACHABLE BEFORE MY REPAIR — I MADE IT LIVE

**Pre-repair the only anchor was `09:30`, which is AFTER `PRE_END = 09:29`, so the premarket window
was always complete and the leak could never fire.** Making decisions consult the builder at their
own earlier clock is what put anchors *inside* the premarket window for the first time.

**That is a consequence of the authorized repair, not a pre-existing failure I inherited and not a
regression against prior behaviour** — the old code was non-causal in a way that happened to mask
this one. **I am naming it in the direction that costs me, because "my fix exposed a second bug" is
exactly the sentence a worker is tempted to leave out.**

**NO REPAIR IS PROPOSED.** Bounding the premarket window by the decision clock changes which
mornings read `MIXED`, which changes authorization, which changes trades. **That is a ruling.**

**Scope, stated honestly:** `1 of 56` anchor-pairs shows an *outcome* difference. The leak is
STRUCTURAL at every anchor before `09:29`; it only changes the answer when the label flips. At
`08:05` and `09:25` on the same session it does not. **A latent leak with a low firing rate is
still a leak, and I am not quoting `1 of 56` as if it bounded the risk.**

## 3. `warmup_ref` — PROOF, NOT REASONING

```
call sites            : build_entry_locations_v24(env, dte, ts, p)      <- exactly one
taint closure of      : ['warmup_ref']                                  <- flows nowhere
  `warmup_ref` (fixed point over assignments)
builder args          : ['dte', 'env', 'p', 'ts']
INTERSECTION          : EMPTY
```
**Red-proofed three ways** — direct pass · **alias chain** (`x = warmup_ref; y = x; f(y)`) · clock
literal — **all RED, byte-exact restore.** The taint tracker carries **its own positive control**
that plants an alias chain and requires it to be followed, so a tracker returning `{seed}` could
not pass.

## 4. 🛑 CORRECTION TO MY OWN ALGO-173: THE NUMBER IS **3 of 12**, NOT 5

Each flagged bullet tested against the build at **its own `ts`** (controls `22/37/45/44/46`
authorized locations, all non-empty):

| decision | producible at its own `ts`? | verdict |
|---|---|---|
| `2026-03-30 08:05` | **no** | **REAL** |
| `2026-04-02 08:05` | **no** | **REAL** |
| `2026-04-06 08:25` | **no** | **REAL** |
| `2026-03-23 08:10` | yes | **NOT A DEFECT** — predicate A false positive |
| `2026-04-14 09:15` | yes | **NOT A DEFECT** — predicate A false positive |

**Cause: predicate A referenced a FIXED `08:00`**, so a level that legitimately became available
between `08:00` and the decision scored as affected. `04-14`'s zone has `created == decision ts` to
the second. **This is the over-strictness I flagged before the run, now quantified against my own
headline.**

**Corroborated independently by the walks:** both false positives are **unchanged** post-repair —
same clock, same level — while all three real ones moved off the offending level.

## 5. DISPOSITIONS — every bullet, per ALGO-176 §5

**TOTAL BULLETS: `14 of 14` sessions before AND after. None lost, none gained.**

| | |
|---|---|
| identical (same clock **and** same level) | **10** |
| moved | **4** |

| session | pre | post | disposition |
|---|---|---|---|
| `2026-03-30` | `08:05` REV `S:…T08:45` | `08:05` REV `S:2026-03-27T13:15` | **same clock, different level** — the future-stamped zone replaced by an available one |
| `2026-04-02` | `08:05` REV `SWING:…T08:45` | `08:55` BRK5 `SWING:2026-03-27` | **moved clock, level and setup** |
| `2026-04-06` | `08:25` REV `SWING:…T03:30` | `08:45` REV `S:2026-04-01` | **moved clock, level and family** |
| `2026-03-31` | `09:00` BRK5 `R:…T07:45` | `10:15` REV `FVG15:…T10:15` | **knock-on — moved OUT of the window entirely** |

**`2026-03-31` was never one of the five.** Its own location was available at its own clock; **what
changed is the competition** — locations present in the `09:30` set are absent at `09:00`, so a
different candidate wins. **That is the in-window bullet that vanished: `12 → 11` in-window, while
total trades held at 14.** Expectation 2 did not fire — bullets did not go up.

## 6. TEST IMPACT — BY MEMBERSHIP, NEVER BY COUNT

Against a **full-suite baseline with the kernel reverted**: baseline **8** failures, with-repair
**10**. `comm -13` → **exactly 2 regressions, both anchor guards.** `comm -23` → **nothing was
accidentally fixed.**

**My earlier "4 regressions" was wrong**: I had compared at a different **SCOPE** — 10 selected
tests versus the full suite. **The population error, in my own bookkeeping, on the same day I
published a law about it.**

**Both guards UPDATED and RED-PROOFED, never deleted.** The first one's own message said *"update
this test deliberately, do not delete it"* — the author anticipated this case. **The original
hazard is still guarded in its other direction:** the anchor must not follow `TRADE_START` either,
and planting `TRADE_START` as the anchor goes **RED**.

## 7. WHAT IS NOT CLAIMED

- **No re-score.** `-$21,075 / 42%` is untouched. Old numbers are **marked** `MEASURED AGAINST A
  NON-CAUSAL MAP`, not deleted and not recomputed.
- **ALGO-141's `8 of 14` may not be quoted bare** — 4 of 14 bullets moved.
- **No PnL, no Monte Carlo, no map build, no adoption decision.** `warmup_ref` not moved.
- **14 sessions.** The generalisation is not measured, only now *possible*.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
