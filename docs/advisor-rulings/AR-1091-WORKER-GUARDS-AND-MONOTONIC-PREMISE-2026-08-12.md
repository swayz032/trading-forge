# AR-1091 (worker) — STEP 2 AND STEP 3 CLOSED. F-4 IS NEXT AND I AM NOT STARTING IT.

**Governing:** AR-1089 §4, §5, §6, §8 · **Pin:** `7f518040` (pushed)

---

## 1. CORRECTION FIRST

**My commit message on `7f518040` says "101 across the four source suites". The measured number is `98`.** The run is in the same terminal output I read it from; I transcribed it wrong. No test, assertion or conclusion depends on it — but a number in a commit record is a claim, and this one is wrong. Correcting it here since the commit is already pushed.

---

## 2. ITEMS 11, 14 — PERMANENT BEHAVIOR GUARDS (`0e79a1e4`)

**11.** The displacement wick drops to 100.0, making the taught risk **19.0** against a `[MEASURED]` MES ceiling of **14.0**. The full distance must survive with the 2R target measured off it.

**The canonical fixture could never have witnessed this** — its taught risk is 7.5, sitting between the 6.0 floor and the 14.0 ceiling, so neither clamp is reachable. ★ `A FIXTURE THAT NEVER CROSSES THE THRESHOLD CANNOT WITNESS THE THRESHOLD.`

**14.** Bar 10's high is raised to 127.0 — past 1R (126.5), short of 2R — so Style C would take its first partial there. The result must remain **one whole-position record** exiting at the teacher's 2R target. The market discriminates the two behaviours; no mutation harness, exactly as you specified.

### 🛑 HONEST SCOPE ON 11 — MEASURED, AND IT CORRECTS MY OWN FIRST FRAMING

I wrote 11 as though it witnessed the house clamp being refused. **It does not.** Ablating told me so:

| ablation | result |
|---|---|
| remove the `source_faithful` early return in `_resolve_stop_risk_points` | **GREEN** — the source path passes `stop_ceiling=inf` anyway |
| pass the real ceiling instead of `inf` on the source management path | **GREEN** — the early return fires first |
| remove **both** | **RED** |

So the taught risk is protected by **two independent mechanisms**, and this test witnesses only their combination; a single-mechanism regression is caught by the unit-level suite, not by this test. The docstring now says exactly that.

★ `A GUARD BEHIND TWO INDEPENDENT DEFENCES WITNESSES NEITHER OF THEM ALONE — AND IT WILL READ AS THOUGH IT WITNESSES BOTH.`

---

## 3. ITEM 12 — ALREADY CLOSED. CITED, NOT REBUILT.

`test_source_faithful_execution_mode.py:266` already holds the exact shape your §5 requires, at the narrowest source-authority boundary: **missing required anchor → named refusal, no ATR fallback**, with positive witnesses in the same class (the taught stop resolves; legacy still falls back). **Ablating the refusal turns it red** — verified, not assumed.

Building a second one would have been precisely the duplicate work the prior-art rule exists to prevent.

---

## 4. STEP 3 — THE MONOTONIC PREMISE: MEASURED, PINNED, NOTHING BUILT (`7f518040`)

`[MEASURED]` `data_loader.load_ohlcv` ends its return path with

```python
df = df.unique(subset=["ts_event"], keep="last").sort("ts_event")
```

**unconditionally.** The canonical class-path frame is therefore both deduplicated and sorted, and grouping a sorted frame by local date yields contiguous runs — which is exactly what makes `min(indices)`..`max(indices)` a valid session bound. **The premise holds upstream**, so your first branch applies: pin it and close the hypothesis.

Two tests: an **`ast`** assertion reading the executable statement inside the real `load_ohlcv` body (a comment mentioning `sort` would not satisfy it), and the join that actually closes it — the real handler's own per-session ranges are contiguous and non-overlapping across three sessions. Removing the loader's sort+dedup turns the first red.

**No second sort, deliberately.** Your §6: silent sorting could invalidate already-derived event/index identity — it would renumber bars that zones and events were already built against. ★ `THE FIX FOR AN UNVERIFIED PREMISE IS TO VERIFY IT, NOT TO ENFORCE IT TWICE.`

**Honest limit, stated in the test:** the Band C harness PATCHES `load_ohlcv`, so it *inherits* this guarantee rather than exercising it. That is why it is pinned against the real loader's source rather than inferred from a green vertical run.

---

## 5. DISCRIMINATOR LEDGER — ALL SIX NOW ACCOUNTED FOR

| item | state |
|---|---|
| 11 | CLOSED — permanent guard, scope limit documented |
| 12 | CLOSED — pre-existing guard, cited and re-verified |
| 13 | CLOSED (AR-1088) |
| 14 | CLOSED — permanent guard |
| 15 | CLOSED by the existing vertical guard (your §4) |
| 16 | CLOSED (AR-1088) |

---

## 6. F-4 — PRE-REGISTERED, AND DELIBERATELY NOT STARTED

Your §7 STEP 3 calls it "the next MAJOR money-path unit", and your §7 design constraint requires measuring the smallest reuse path before editing. **This seat has spent most of its context; starting a unit of that size now would produce exactly the half-wired state AR-1078 refused to leave.** So I am handing it over cleanly rather than beginning it.

**What the next seat inherits, so nothing is re-derived:**

- **The cause, as the grader measured it:** vectorbt opens on the first source entry, sees no source-owned signal exit (`exit_long` is framework-owned and never set by a strategy), stays open while the other source events occur, and Trading Forge only later retrofits the source stop/target onto that one record. The managed exit never releases the simulation. `40 source entry events → 1 executed trade`.
- **Your six pre-registered proof points**, unchanged and to be written down BEFORE editing.
- **Your two hard constraints:** no fabricating `exit_long` from future knowledge; no second source strategy engine beside the class backtester. Prefer extending the existing management/execution mechanism.
- **Your stop conditions 3, 4, 6** are the ones most likely to fire on this unit.
- **Fixture traps this seat paid for:** the body key is `entry_conditions`; every condition needs `role: "spine"`; `load_ohlcv` must be patched on **both** modules; `main()` prints its result to stdout and diagnostics to **stderr**; a plain `git worktree add` of an old pin fails on Windows MAX_PATH.

**Nothing is half-written in the tree; no sub-agent is outstanding; the ear dies with this seat, re-arm from `7f518040`.**

**Pin `7f518040`.**
