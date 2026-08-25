# ALGO-095 — R2 **CLOSES**: at his clocks Route A never reaches the gate R2 retires. The untaught site is **FORCE**.

**Strategy head:** `5bf5170ca51759611de00ce9d6460a4817b29f78` (pushed, `ls-remote` verified)
**PR #38:** DRAFT / DO NOT MERGE · **Nothing landed**, no number moved, no exam run.
**Advisor seat:** noted — `trading-forge-cf` is seated; this packet is past `6ab2b7dd`.

---

## 0. Two corrections before the trace, both material

**(1) R2 was never built.** ALGO-094 states it "has sat in the worktree since 08-23". Measured:
the worktree is **clean**, there is **no stash**, **no commit**, and **no binary-rejection
predicate anywhere in `research/`**. Route A still calls `_control(last, direction, body_frac,
close_loc)`. R2 was *authorized* on ALGO-071 and **never implemented**. Nothing was waiting to
land — which changes the "pace failure" framing, and the effort estimate for anyone planning
around it.

**(2) My own first trace read the wrong field** and concluded Route A was never asked on any
session *including the control*. `route_refusals` only ever carries the **break** family; Route A
records its refusal in `killed_at` / `authority_refusal`. Caught and corrected before
publication — it would have aimed a repair at a route the trace claimed does not run.

## 1. The trace at his five clocks (order 1)

| session | Route A first refusal | provenance |
|---|---|---|
| 03-23 11:21 S | **`FORCE_NOT_CONFIRMED`** | **UNTAUGHT** — `body_frac 0.62` |
| 04-09 11:35 L | **`FORCE_NOT_CONFIRMED`** | **UNTAUGHT** — `body_frac 0.62` |
| 03-24 09:32 L | `MERE_APPROACH_WITHOUT_TOUCH` *(some candidates also die at force)* | TAUGHT |
| 03-31 09:49 L | `MERE_APPROACH_WITHOUT_TOUCH` | TAUGHT |
| 04-06 10:04 S | `MERE_APPROACH_WITHOUT_TOUCH` | TAUGHT |
| **04-14 control** | `MERE_APPROACH_WITHOUT_TOUCH` (85 of 88) — **1 survives** via `B_NORMAL_BREAKOUT` / `FIRST_BREAK_PRINT_THEN_INTRA5_FORCE` | TAUGHT |

Break-family refusals on 03-24 / 03-31 / 04-06 are `NO_COMPLETED_PRINT_BEYOND_THE_ZONE` (taught,
structural) and `ORDINARY_MOMENTUM_IS_NOT_TRUE_DISPLACEMENT` (taught shape, untaught gate).

## 2. R2 closes — structurally, not by degree

R2 retires `min_wick` / `body_frac` / `close_loc` from Route A's **story** gate
(`_control`, `derivation.py:160`).

> **At no clock does Route A reach that gate.** On 03-23 and 04-09 **force kills first**; on
> 03-31, 04-06 and the control **price never touches the band at all**.

So R2 cannot satisfy its own pre-registered expectation (iii) — a Route A candidate surviving to
ranking on 03-23/04-09 — and cannot change any of the five outcomes. **Landing it would have been
a no-op that consumed a guard run to prove it.** I did not build it.

## 3. The untaught magnitude, named (order 3)

```
force.py:123   efficient = bool(progress > 0 and efficiency >= float(p.body_frac))
```

`body_frac = 0.62` gates **path efficiency** inside the **force** module. It is the **same
untaught number** R2 targets, at a **different site R2 does not touch**, and it is what kills
Route A at his clock on **03-23, 03-24 and 04-09**. The module's own docstring confirms the
reuse: *"already-frozen Params.body_frac and Params.close_loc values … PATH_EFFICIENCY >=
Params.body_frac"*.

**Citation status:** no citation found in the spec, the video-evidence docs, or the addendum —
stated as *"no citation found in the surfaces named"*, **not** as proof of absence. That is the
ALGO-076 lesson applied: my last absence claim was published with a control that only exercised
the surface I had already searched.

## 4. What I deliberately did not do

No repair is proposed or scoped here. **Re-pointing R2 at the force site is a different repair
than the one authorized**, and the operator's pace pressure is not a reason to land a repair at a
site nobody has ruled on. Re-exam #3 is not run — it was ordered *after* R2 lands, and R2 does
not land.

## 5. Asks

1. R2: close it formally, or re-scope to the **force** site as a new land-or-close?
2. `MERE_APPROACH_WITHOUT_TOUCH` on three of five sessions says price **never reached his band**
   at his own entry clock. That is a **location/band** question, not an entry-authority one —
   and it is the same shape as the census finding that four of seven machine zones are not
   drawable under his rule. Worth a lane?

Artifact at `5bf5170c`: `..._refusal_trace_five_clocks_2026_08_24.json`.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
