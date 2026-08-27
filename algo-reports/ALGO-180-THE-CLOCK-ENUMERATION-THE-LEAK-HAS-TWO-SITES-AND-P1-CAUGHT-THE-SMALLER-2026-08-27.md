# ALGO-180 — THE CLOCK ENUMERATION. **The leak has TWO call sites, and P1 caught the smaller one.**

**Strategy head:** `9b1cbf3a` — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic files modified: NONE. Measurement only — nothing repaired, as ordered.**

**ALGO-179 order item 1.** Your §1 reasoning did not stop at one component, and it was right not to.

---

## 1. THE ENUMERATION, BY KEY

| clock | site | verdict |
|---|---|---|
| `TRADE_START 08:00` | `v2_2:43`, `kernel:136/259` | **not a hazard** — compares `ts` against itself; decisions never start earlier |
| `LAST_ENTRY 12:00` | `v2_2:44`, `kernel:209` | **not a hazard** — a ceiling on `ts`; slices no data |
| `PRE_START 04:00` | `v2_2:602`, `levels:257` | **not a hazard** — a lower bound, always `≤ ts` |
| `RTH_END 15:59` | `v2_2:834` `exit_1m_realistic` | **not on the decision path** — called at `v2_2:997`, **after** the entry is committed; forward-looking *by design*, because it simulates the exit |
| `09:30 / 15:55` | `v2_2:350` `data_quality_gate` | **not on the decision path** — callers are the runner, the shards and the preflight only |
| `15:59` | `v2_2:880/882` `prepare` | **not a hazard** — runs once before any decision; every consumer re-slices by `ts` |
| `09:30` `warmup_ref` | `kernel:226` | **not a hazard** — proven by AST taint analysis to reach no builder argument |
| `OVERNIGHT_START 18:00` | `v2_2:650` | prior-day half always past; **the same-day half at `:651` is bounded by `PRE_END`** ⇒ same hazard |
| 🛑 **`PRE_END 09:29`** | `v2_2:602`, `v2_2:651`, `levels:258` | **THE HAZARD — and it has two consuming call sites** |

## 2. 🛑 TWO CALL SITES, AND THE ONE P1 FOUND IS THE SMALLER

```
levels.py:252   build_premarket_plan_v24(full5, dte)   <- UNANCHORED
                feeds pm_structure, gating _range_room_authorization at levels:253

kernel.py:232   build_premarket_plan_v24(full5, dte)   <- UNANCHORED, built ONCE per session
                OUTSIDE the bucket loop and consumed INSIDE it at
                  kernel:355  (REV)
                  kernel:392  (BRK5)
                  kernel:406  (BRK15)
                via plan_allows_v24, which gates DIRECTION on every setup family
                through plan.primary
```

**MEASURED — 14 sessions × 4 anchors, every anchor before `PRE_END`:**

| field | differs | what it gates |
|---|---|---|
| **`plan.primary`** | **10 of 56** | **DIRECTION, on every setup family** |
| `plan.pm_structure` | 2 of 56 | `_range_room_authorization` — *the one P1 caught* |

**P1 STRUCTURALLY CANNOT SEE THE SECOND SITE.** P1 exercises `build_entry_locations_v24` and
nothing else, so `kernel.py:232` is outside its reach entirely. **The leak P1 found fires at one
fifth the rate of the leak it was blind to.**

**A property test is only as wide as the call it makes.** P1 was the right instrument and it was
never going to find this; the enumeration you ordered is what found it.

### The flips, by key

| session | anchor | field | full | truncated |
|---|---|---|---|---|
| `2026-03-25` | `08:30` | primary | `NEUTRAL` | `BULL` |
| `2026-03-25` | `08:30` | pm_structure | `DOWN` | `UP` |
| `2026-03-25` | `09:00` | pm_structure | `DOWN` | `MIXED` |
| `2026-03-31` | `08:30` | primary | `NEUTRAL` | `BULL` |
| `2026-04-01` | `08:05` | primary | `NEUTRAL` | `BULL` |
| `2026-04-01` | `08:30` | primary | `NEUTRAL` | `BULL` |
| `2026-04-06` | `08:05` | primary | `BEAR` | `NEUTRAL` |
| `2026-04-06` | `08:30` | primary | `BEAR` | `NEUTRAL` |
| `2026-04-06` | `09:00` | primary | `BEAR` | `NEUTRAL` |
| `2026-04-07` | `08:05` | primary | `NEUTRAL` | `BEAR` |
| `2026-04-07` | `09:00` | primary | `NEUTRAL` | `BEAR` |
| `2026-04-13` | `08:05` | primary | `BULL` | `NEUTRAL` |

**It cuts both ways.** `NEUTRAL → BULL` and `BEAR → NEUTRAL` both appear, so this is **not** a
uniformly permissive or uniformly restrictive bias. `plan_allows_v24` returns `True` immediately on
`NEUTRAL`, so a leaked non-`NEUTRAL` **blocks** counter-direction candidates the truthful data would
have allowed — and a leaked `NEUTRAL` **admits** ones it would have blocked.

## 3. WHY THIS CHANGES THE REPAIR YOU AUTHORIZED

Your spec — *"the plan available at `T` uses bars completed by `min(T, PRE_END)`"* — is right, and
**it must be applied at BOTH sites, not just the one P1 convicted.** Repairing `levels.py:252`
alone would fix `2 of 56` and leave `10 of 56` live, **while P1 returned `56 of 56` and certified
it** — a green that would have been earned honestly and meant nothing.

**`PRE_END = 09:29` stays.** It is the definition of the premarket session, not a parameter.

## 4. WHAT I HAVE NOT DONE

**No repair.** **No PnL, no MC, no re-score, no map build, no adoption.** `warmup_ref` not moved.
**The `37.1%` exposure figure is yours, `[MEASURED HERE]` at your desk; I have not re-derived it and
am not restating it as mine.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
