# AR-1090 (worker) — F-2 CLOSED, AND YOUR §4 CORRECTION ACCEPTED

**Governing:** AR-1089 §4, §7 STEP 1 · **Pin:** `9d6f2352` (pushed)

## 1. YOUR §4 CORRECTION IS RIGHT AND I WAS TOO STRONG

I wrote that items 11 and 14 were "ablation-shaped" and therefore could not be committed tests. **That conclusion was wrong, and the error is worth naming precisely:** I reasoned from *how I had been proving them* rather than from *what would have to change if the defect returned*. A committed test never needed to mutate production code — it needed a FIXTURE whose observable result moves. You supplied both shapes (taught risk larger than the house ceiling; a price path that would trip a Style-C TP1 before the teacher's target) and both are ordinary tests.

★ `I CLASSIFIED THE GUARD BY MY OWN METHOD INSTEAD OF BY THE DEFECT.`

Item 15 CLOSED by the existing vertical guard — accepted; a duplicate would add nothing.

## 2. F-2 — CLOSED, ONE NARROW COMMIT

`backtester.py:8051`'s block overwrote `Avg Exit Price`, `Exit Idx`, `exit_reason` and P&L and left `Exit Timestamp` at vectorbt's value. On the source arm every vectorbt trade is `Status:"Open"`, so that stale value is the **last bar of the frame**, and `prop_sim.py:84-94` reads it — my own 3-session fixture reported `overnight_violation: true` for a fifteen-minute trade.

**Stamped from `close_pd.index` at that exact `exit_idx`** — the same object `ts_to_idx` was built from, so it is that map's **exact inverse** and the two fields cannot disagree by construction. Not parsed, not rebuilt from strings: a second derivation would be free to drift. `.isoformat()` mirrors the column loop, so the field's REPRESENTATION is unchanged and only its VALUE is corrected. Entry timestamp untouched, with its own control.

**The legacy correction is deliberate and named.** This block is generic, so every class backtest with a managed exit now gets the corrected timestamp — the old value was wrong there too. It carries a **legacy control**, not a source-arm-only assertion, per §7.1.

**PROOF:** 4 tests, 21 green in the file, 94 across the four source suites. Ablation: removing the stamp turns both timestamp tests red. **Adjacent regression measured, not asserted** — I swapped `backtester.py` to HEAD content and back and ran the same `backtest/trade-management/pnl/accuracy/prop` selection both ways: `14 failed / 577 passed` on BOTH sides, **failure sets identical, both diff directions empty.** That includes `test_prop_compliance.py`, the surface I was most worried about touching.

## 3. ADJACENT FINDING — REPORTED, NOT FIXED

**`run_backtest`'s own override site (`backtester.py:5663`) has a LARGER version of the same inconsistency:** it updates `Avg Exit Price` and `exit_reason` but **neither `Exit Idx` NOR `Exit Timestamp`**. Repairing it would change legacy trade timing on that path — your §9 stop conditions 1 and 7. **Left for a named ruling rather than folded into a micro-fix.**

## 4. TWO INSTRUMENT FAILURES OF MINE, BOTH CAUGHT

- My first attribution script decoded `git show` as **cp1252** and died on a star glyph; because the decode returned `None`, the `write_text` that would have **overwritten `backtester.py` with nothing** raised instead of succeeding. I verified the file was intact before continuing rather than assuming. Re-ran with explicit UTF-8.
- Earlier this session the same class cost me a mangled `sed` path and a stdout-vs-stderr capture. **Three instrument failures, zero code defects, in one session.**

## 5. NEXT, PER YOUR §8 — PROCEEDING WITHOUT A ROUND-TRIP

STEP 2: permanent guards for **11** (taught risk > house ceiling survives as `source_exact`), **14** (price path trips a Style-C TP1 before the target; result must stay one whole-position `source_fixed_r_target`), **12** (fail-closed at the source-authority boundary, with a positive witness that the same boundary resolves a valid anchor). Then the monotonic-order premise **measurement** — measure the canonical data contract first, no sorting subsystem, no silent sort.

Then **F-4**, pre-registering your six proof points before editing.

**Pin `9d6f2352`.**
