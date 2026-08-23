# ALGO-036 — Routes B/C/D derived. §7 closes 15/15. Route C has never fired on real data.

**Strategy head:** `f8de3233` (pushed, verified by `ls-remote`) · PR #38 **DRAFT / DO NOT MERGE**
· still **BUILD ONLY** · kernel/entries/force/engine **byte-identical to `068bb24a`** · grade
still out.

ALGO-035 §2 item 1 is done. Below is what moved, what I got wrong, and the two things I want
you to rule on.

---

## 1. The three routes, and why the refusals are the deliverable

    B   first completed print beyond -> the FOLLOWING forming 5m must take out its extreme
    D   genuinely broken AND ACCEPTED -> retested as the opposite role -> live force
    C   exception #1: true displacement into the level, third candle still holding control
    D'  exception #2: real prior test -> meaningful reset -> true return attack

The spec fixes each trigger in one line and then spends most of its words on what must NOT
trigger. §7 plants exactly those, so each refusal is named after the item it enforces and each
test after the defect it kills. Every route reads **completed bars plus a separate live
trigger** — the split you ruled in ALGO-033 for Route A. That is what makes §7.14 *unreachable*
rather than merely refused: nothing here ever receives the forming parent's finished OHLC.

---

## 2. The state machine was accepting breakouts on rejection evidence

`decide` took a `route` argument and then ran the rejection story whatever it was asked for.
**Its own test fed the rejection fixture to all four routes and asserted each granted — and
passed, because the defect made that true.** The green was an artifact of the bug, so I replaced
the test rather than adjusting it: four route-specific fixtures, four positive witnesses, and a
**measured** 4×4 route-by-evidence matrix.

**One off-diagonal grant survives, and it is real.** The Route C fixture displaces into the zone,
closes back *inside* it and reclaims — a genuine `failed_breakout_back_inside_with_control`
rejection *as well as* a displacement sequence. Real price can satisfy two routes at once. It is
pinned as a named overlap, with a second test that fails if a pinned overlap ever stops
occurring, so an unused licence gets deleted instead of accumulating.

---

## 3. §7: 16 mutations across 15 of 15 items, all killed

Items 6–14 were deferred **by name** while the routes did not exist. They now run. The
denominator grew; the numerator was never shrunk to meet it, and the arithmetic is asserted in
both directions.

**The harness caught my own regression.** §7.4 reported `TARGET NOT UNIQUE (0)` — adding route
dispatch had moved the block it targets. It refused rather than quietly reporting a smaller
campaign. Re-pointing it, I gave item 4 a **second door**: routes B/C/D have their own evidence
gate, and killing only the Route A door would have closed the instance I was shown and left the
condition open. Mutations (16) now exceed items (15), and a test asserts that gap exists.

**Item 14 carries a caveat in the artifact.** Its defence is architectural, so the kill proves
the completed/trigger split is load-bearing — *not* that some other layer refuses a backdated
entry clock. That belongs to the kernel and is not built. A kill whose scope is overstated is a
false green.

---

## 4. Two invented numbers, one of which I had no business inventing

`range_ratio` is **frozen** as `Params.range_ratio`, and my default of `1.25` happened to equal
it. That is luck, and luck rots the first time the frozen value moves. Route C now **refuses**
without it instead of defaulting, and the test reads the value from `Params` rather than typing
its own copy.

`acceptance_bars = 2` is genuinely **not** frozen. The spec refuses
`break_retest_without_prior_durable_acceptance` and calls the property *durable*, but names no
count anywhere. Two consecutive completed closes beyond is **my derivation of "durable"**, not a
value read off the spec. It is declared in `UNFROZEN_CHOICES`, with a test proving the spec is
actually silent. **→ This is the first thing I want you to rule on.**

---

## 5. The checkpoint — and the Route A number deliberately did not move

Route A stayed at **8 of 128**. That is not a result; the checkpoint was only measuring Route A,
so an unchanged number after building three routes would have looked like a finding when it was
an *absence of measurement*. A second census now runs, through a new X-ray hook rather than a
re-walked loop.

| | kernel grants | derivation grants | route agreement |
|---|---|---|---|
| **B_NORMAL_BREAKOUT** | 11 | 11 | 11 — exact |
| **D_PREBREAK_RETEST** | 28 | 12 | 12 |
| **C_PREBREAK_DISPLACEMENT** | **0** | — | **never exercised** |
| total | 39 | 23 | 23 of 23 |

**Where the two implementations both grant, they never once disagreed about which route it is.**

**ROUTE C HAS NEVER FIRED ON REAL DATA.** The kernel granted zero displacement candidates across
all fourteen sessions, and my derivation refuses all 39 with
`ORDINARY_MOMENTUM_IS_NOT_TRUE_DISPLACEMENT`. Whether exception #1 is too strict or simply rare
cannot be answered from this, and must not be tuned on outcomes. I am flagging it rather than
letting 23/39 imply coverage. **→ Second thing I want you to rule on.**

The 16 Route D refusals are specific, not a wall: 6 × `BREAK_NOT_ACCEPTED_BEFORE_RETEST`, 10 ×
no completed print beyond paired with a failing repeat-test requirement. A disagreement is not
automatically my error — the kernel's route choice is an `elif` chain, and which read is right
is a semantics question, which is why I am asking rather than conforming to it.

---

## 6. The hooks had no test at all

Including the **rejection** hook, which has been carrying the checkpoint's central claim since
ALGO-029. Both are now proven on the AST: optional, `None`-defaulted, called only in statement
position, so nothing can read what they return. With a discriminating fixture that catches a
hook whose result gates `survivors.append` — a checker that never fires proves nothing.

---

## 7. What remains

- **Window amendment** (ROLE-1 only, `kernel.py:132` anchor untouched) — still deferred while
  the independent grader is live in this tree grading pinned files. Minutes of work the moment
  the grade renders, or the moment you tell me the risk is worth taking.
- **BRK15**, the Route B variant, is not derived in this machine. It is recorded in
  `NOT_DERIVED_HERE` with a test, because an unbuilt variant reported as "Route B handled" is a
  false green. The kernel and the X-ray both carry it.
- **Item 2:** the exam on the finished brain, then FREEZE. **Item 4:** deployment path to the
  offline line.
- The re-dispatched grade against pin `4d786333ccee` has still not rendered. No output received
  — that is not the same as failed.

Suite **7 failed / 1420 passed**, enumerated; same 7, all outside this lane. **No PnL, realized
outcome, winner/loser label or clean-edge result participated in any decision in this packet.**
