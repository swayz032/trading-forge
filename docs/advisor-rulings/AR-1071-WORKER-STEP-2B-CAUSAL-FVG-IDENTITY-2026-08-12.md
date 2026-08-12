# AR-1071 — WORKER — **STEP 2B BUILT (AR-1068 §10 NEXT UNIT 2).** The qualifying-zone identity now exists as a selector over the existing detector's zones. 🛑 **I SHIPPED A FALSE GREEN AND CAUGHT IT WITH AN ABLATION MATRIX — THAT STORY IS THE MOST USEFUL PART OF THIS REPORT.** ⚠️ **BUILT-UNREACHABLE: ZERO PRODUCTION CALLERS.**

```
RULING  : AR-1068 (gpt-rulings 06d63e2b) §5, §6, §10 NEXT UNIT 2, §11 discriminators 1,2,3,4,6,7,9,10
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712        [MEASURED HERE]
PIN OUT : 651b2eb6   [MEASURED] pushed, re-read from origin via git ls-remote
COMMITS : 4f0d4bac STEP 2B · 651b2eb6 SYSTEM-INVENTORY regenerate
NEW     : src/engine/context/source_entry_events.py · src/engine/tests/test_source_entry_events.py
CHANGED : nothing. `git status --porcelain src/engine/indicators/ src/engine/spec_condition_compiler.py` -> EMPTY.
```

---

## 1. 🛑 THE FALSE GREEN — READ THIS FIRST

My first version of the suite was **23/23 GREEN**. It was **wrong**, and it was wrong in the
shape this desk keeps convicting.

A suite that large passing on the first run is an accusation against the tests, so I ran an
**ablation matrix** — delete one guard, run the *unchanged* suite, restore, repeat:

| ablation | first suite | after repair |
|---|---|---|
| **A** drop the direction-match check | 🛑 **23 passed** | ✅ 1 failed |
| **B** drop the outside-the-range check | 2 failed | ✅ 2 failed |
| **C** drop the post-breakout ordering check | 🛑 **23 passed** | ✅ 1 failed |
| **D** breakout by membership, not transition | 5 failed | ✅ 5 failed |
| **E** stop from the gap boundary, not the displacement candle | 4 failed | ✅ 4 failed |
| **F** loosen `outside` from `>` to `>=` | — | ✅ 1 failed |
| restored | 23 passed | ✅ **25 passed** |

**Why A and C were both green: they were masking each other.** On my primary fixture every
wrong-side zone was *also* pre-breakout. So deleting the direction check changed nothing — the
ordering check still rejected those zones — and deleting the ordering check changed nothing,
because the direction check still rejected them. **Both guards were real. Neither was proven.**

★ **`TWO GUARDS THAT REJECT THE SAME OBJECT PROVE ONLY THAT SOMETHING REJECTED IT.`**

**The repair was two isolating fixtures, each containing a zone exactly one guard can reject:**
- a **BEARISH** FVG forming **AFTER** a long breakout and **ABOVE** ORH — ordering accepts it,
  outside accepts it, **only direction rejects it**;
- a **BULLISH** FVG forming **BEFORE** the breakout and **ABOVE** ORH — direction accepts it,
  outside accepts it, **only ordering rejects it**. (This is §5 item 5's "old gap from earlier
  in the session", in its hardest form: right side, right place, wrong time.)

**Had I stopped at the first green I would have reported §5's required negative controls as
satisfied while two of them were decorative.**

## 2. WHAT WAS BUILT

`src/engine/context/source_entry_events.py`. **It is a SELECTOR, not a detector** — it computes
no imbalance and reuses `compute_fvg_signal(...).zones` (§5: *"Do not add a second FVG detector"*).

An event is emitted for bar `b` iff: a zone has `start_idx == b` · a breakout occurred at
`k <= b` · the zone direction matches that breakout's side · the zone lies **wholly** outside the
same OR side (near edge, strict `>`) · the breakout was a **close** crossing.

**Four properties are STRUCTURAL rather than conventional** — the shape of the code forbids the
failure, so no test can rot into a rubber stamp:
1. `find_breakout_events(close, …)` **takes no `high`/`low`**. A wick-only OR breach is not
   "unused", it is **unreachable** (§11-2).
2. `source_stop_price(event, high, low)` **takes no `zones` list**. A nearest-FVG re-scan is
   impossible because there is nothing else to scan (§5 item 8). A test asserts the signature.
3. `SourceEntryEvent.__post_init__` **refuses** `bar_idx != zone.start_idx` — the decision bar and
   the zone that justified it cannot drift apart — and refuses `breakout_idx > bar_idx`.
4. The event carries the detector's **own frozen object**, asserted with `is`, not `==`. ★ **A
   copy is how a re-scan sneaks back in without any test noticing.**

**Breakout = a TRANSITION, not membership.** After a break, many bars close outside; treating each
as a breakout would make "post-breakout" vacuous. Ablation D (5 RED) proves that bites.

## 3. THE ONE PLACE I REFUSED TO INVENT

**No maximum distance is imposed between the breakout and the FVG.** The source teaches the
sequence — *"we have our break to the upside… let's take a look and see if we got our fair value
gap"* — but **never states a bar limit**, and inventing one would be fabrication.

**The consequence, stated rather than hidden:** a qualifying FVG arbitrarily long after the
breakout still qualifies, provided no opposite breakout has intervened (the governing breakout is
the most recent one at or before the bar, so an up-break followed by a down-break cannot leave a
stale LONG regime alive). **If you rule that the source bounds it, that is a one-value change.**

## 4. PROOF

**25 passed.** Focused regression with the STEP 1/2A suites: **78 passed**. Every guard
independently red-proofed by the matrix in §1. **`git status --porcelain` over
`src/engine/indicators/` and `spec_condition_compiler.py` is EMPTY** — this unit modified nothing.

**The fixture is self-verifying.** Every test runs the **real** `compute_fvg_signal()` and asserts
which zones the detector actually produced, rather than hand-asserting zones the fixture was
*assumed* to contain. The primary fixture is deliberately loaded: four real pre-breakout bearish
zones, a genuine wick-only breach at bar 7, and a decline that makes an EMA proxy read bearish.

**On §6 / §11-3, and I want to be exact about what I proved.** There is no EMA input to this
module, so "flip the EMA and observe no change" would pass on a module with no direction logic at
all — the both-arms-read-zero trap. So the control has **a positive control of its own**: the test
first asserts `fast[10] < slow[10]` on the fixture — i.e. that an EMA-slope proxy genuinely reads
**BEARISH** at the decision bar — and only then asserts the emitted direction is **LONG**.
**What that proves: the SELECTOR answers from the breakout side.** **What it does NOT prove: that
the COMPILER has stopped consulting the EMA proxy.** `_eval_fvg` is untouched and its docstring
still routes `direction="both"` through the slope. Removing it on the source path needs the source
mode threaded, which is your §10 NEXT UNIT 3.

## 5. ⚠️ THE LIMIT THAT MATTERS MOST

**THIS UNIT IS BUILT-UNREACHABLE. ZERO PRODUCTION CALLERS.** `_eval_fvg` still returns
`any_active` and nothing calls the selector. **CORROBORATED by an independent instrument:**
regenerating `system_inventory.py` across this commit moved **BUILT-UNREACHABLE `1545` → `1549`**,
19/19 positive controls passing. The map counted my own module as unreachable.

★ **`A CORRECT PRIMITIVE WITH NO CALLER CHANGES NOTHING THAT EXECUTES.`** This campaign has been
convicted on the "built, zero callers" species four times, so I am naming it before anyone asks.
**No money path is crossed. No source-faithful backtest is claimed. No trade has moved.**

## 6. NOT DONE

- **NEXT UNIT 3 (STEP 5+4)** — the narrow SOURCE_FAITHFUL execution-policy plumbing from
  `compiled_spec.spec.source_risk.mode`. **UNSTARTED. This is what makes §2's work reachable.**
- **NEXT UNIT 4 (STEP 6)** — the production-path RED→GREEN. UNSTARTED.
- **Short side** — the selector handles short *selection* because the causal structure is
  symmetric and I did not want every long assertion resting on a hard-wired LONG. **That is not a
  claim the short STOP is resolved** — it is not (§3.2/§12), and `displacement_candle_high` stays
  unmapped, so a short stop still refuses.
- **The bounded visual question** — not run. Not mine to run unilaterally; say the word.
- **AR-1070 §4** — my declared narrowing (mapping `displacement_candle_low` only) is **still
  unruled**. UNIT 3 will stack on it.

## 7. NEXT, WITHOUT WAITING

Starting **NEXT UNIT 3 / STEP 5+4**: thread the persisted `source_risk.mode` into the class
backtest path so the source-faithful exceptions bind at the points that otherwise change source
semantics — exact stop, whole-position fixed R, source-owned direction, no Style-C/time-stop
substitution, no eligibility-gate deletion of source entries, no house floor/ceiling mutation.
Reusing the `exit_policy` plumbing precedent. **Not building a new risk engine** (§7).
