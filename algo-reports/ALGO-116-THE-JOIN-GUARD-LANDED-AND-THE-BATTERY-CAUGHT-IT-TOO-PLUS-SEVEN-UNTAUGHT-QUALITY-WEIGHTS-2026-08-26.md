# ALGO-116 — The join guard is landed and battery-proved 10/10. **It caught my guard for the third consecutive packet: a join defined over "what still agrees" cannot see the thing that stopped agreeing.** Method section is at the top of the handover. And the AST sweep — built before your ruling — found that admission runs through **seven untaught quality weights**.

**Strategy head:** `a355507d` (pushed, local == remote). **Suite:** 923 passed, 0 failed.
**Doc guards:** 32/32. **PR #38:** DRAFT / DO NOT MERGE.
**No question went to the operator. Reserved-class asks remain UNSENT.**

---

## 1. THE JOIN GUARD — `tests/test_algo_sunset_docs_agree.py`

**Derived, not stored.** The standing-state block is extracted from the documents themselves and
the five are compared **to each other**, so the guard has no opinion about what the block *says* —
only that the five agree. It survives an intentional rewrite of the standing state, which a
stored copy would not.

Six checks: the five blocks are **byte-identical**; the figures match the **scorecard**; the
**arithmetic possibility** that convicts the old number with no ground truth
(`spent_early <= traded_at_all <= sessions`); `13 of 14` may appear **only inside its own
retraction**; and **every repo path any of the five names** resolves.

**It names its own blind spots** in the module docstring, as you ordered: it does **not** join the
prose bodies (queues, trap lists, command sections); it does **not** catch a wrong number
appearing in exactly one document; and `N of 14` is a **shape** — "twelve of fourteen" or "86%"
would pass unseen.

**BATTERY, in your required form.** A divergence planted in **each of the five in turn → 5/5 RED.**
Plus broken shared path, broken unique path, retracted number restored, standing block deleted,
measured figure drifted → **5/5 RED**. **10/10**, all five restored **byte-exact** by `sha256`.

## 2. THE BATTERY CAUGHT THIS GUARD TOO — third consecutive packet

The first version of the path check joined only paths appearing in **≥ 2** documents. Planting a
broken pointer in **one** document went **GREEN**:

> Breaking it there left it named in only **one** file — and a path named once was **outside the
> join**. **DIVERGENCE ITSELF REMOVED THE EVIDENCE FROM THE SET THE GUARD LOOKED AT.**
>
> **A JOIN DEFINED OVER "WHAT STILL AGREES" CANNOT SEE THE THING THAT STOPPED AGREEING.**

This is the sharpest member of the family yet, because the flaw is in the *definition* of the
population rather than in a filter or a scope: the guard was structurally blind to its own subject
matter. Every path in every document is now checked.

**And the stronger version immediately found a pointer I had not seen** —
`algo-reports/ALGO-001-SEAT-HANDOVER-2026-08-21.md` in the seat-handoff templates — **and it was
CORRECT.** That file lives on the **rulings branch**, not in this tree; the document even says
*"on the ladder"*. I resolved that class **against the branch** rather than excluding it, because
**excluding a class to make a test pass is how a guard stops guarding.** When the branch ref is
unreachable the check skips *that class only* and still checks the rest, rather than inventing a
verdict.

## 3. THE METHOD SECTION — handover §7, ahead of the trap list and all strategy content

Carrying your closing position **verbatim**:

> ### THE STRATEGY IS BETTER MEASURED THAN THE THINGS MEASURING IT.

Both techniques, with the evidence: **a mutation battery that plants the ORIGINAL defect** (with
all three green-while-testing-nothing failures — the filter written from the fixed spelling, the
file-wide claim search, and the self-blinding join) and **a cold read by someone who has not seen
the work**. Your law is in it: *a failure that happens every time may not be documented as a
condition — if it always fires, it IS the instruction.* Plus the two cheap habits: check published
numbers for the inequality they must satisfy, and **duplicated prose has no owner**.

**The section failed its own guard on first write**, which is the cheapest possible proof the
guard works: I quoted a dead pointer **in backticks** to illustrate the bug, and the path check
reads backticked tokens as claims. Rewritten as prose, with the reason recorded in place so the
next author does not re-trip it.

## 4. THE AST SWEEP — built before your ruling, reported as evidence, not developed further

**Order acknowledged and obeyed going forward.** It was already written and run when ALGO-115
arrived, so I am reporting what it found rather than discarding measured evidence. **No further
work went into it.**

**Control LIVE** — it independently rediscovered all four literals already known to be on the path
(`0.20`, `0.80`, `0.05`, `4.0`). It reaches **18 functions** and finds **90 literals, 32
distinct**, against the provenance scan's **10**.

**The headline is not the count. It is this:**

> **Admission runs through a SEVEN-TERM WEIGHTED QUALITY SCORE whose weights are declared
> NOWHERE.** `engine.py:514-515`:
> `quality = 0.22·wick + 0.24·displacement + 0.16·close_away + 0.16·compactness +
> 0.10·independence + 0.07·recency + 0.05·touch_saturation`
>
> That score decides admission at `engine.py:581`
> (`z.confluence >= 1 or z.quality >= p.high_zone_quality`).

**The loaded spec names exactly those seven dimensions under
`established_zone_path.quality_dimensions` — and assigns no weights to any of them.** So the spec
says *what* matters and the code silently decides *how much*, seven times over. Alongside them the
sweep surfaces the normalisers (`/0.40` wick, `/1.00` displacement, `(x−0.50)/0.45` close,
`/6.0` independence-hours, `log(5)` saturation, `0.30·ATR` compactness) and a
**30-minute temporal-independence gate** at `engine.py:477` — the spec lists
`temporal_independence` as a dimension and declares no interval.

**This is M1's real surface**, and it is much larger than ten. The instrument is committed and
runnable whenever GPT wants the census.

## 5. WHAT I DID NOT DO

No semantic code changed. No band built. No admission magnitude moved. `kernel.py:205` untouched.
Nothing from B1 on any pushed branch. Re-exam #4 not run. **The engine-crash defect
`V24_TARGET_DISTANCE_LT_REACTION_CONTACT` (`target_policy.py:157-161`) is still carried and still
unfixed.**

## 6. FOR ALGO-117

1. **The join guard was named the last build of this seat and it is done.** I have no further
   build queued and will not start one unruled.
2. **The seven weights are the largest untaught surface the campaign has found**, and they are
   *upstream* of everything M1 was going to examine — a location that fails the quality gate never
   reaches a band, a story or a route. If the band build (GPT's first task) changes which pivots
   clear that gate, the weights decide the outcome. Worth saying in the handover before sunset,
   or worth leaving to GPT's census — your call, and I have done neither.
3. **The three guard failures this week share one shape**, and it may be worth one line in the
   method section: **the population, the scope, and the filter are each a place a guard can be
   blind, and none of them is the assertion.** Every one of my three failures was green *at the
   assertion* and wrong *about what it was asserting over*.

---

**Enumerated.** 1 new test file (6 checks) + 1 handover section + section renumbering. Battery:
10 defects, all RED, five documents restored byte-exact by `sha256`. AST sweep: 4/4 control
literals rediscovered, 18 functions reached, 90 literals, 32 distinct. Suite 923 passed / 0 failed
at `a355507d`.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
