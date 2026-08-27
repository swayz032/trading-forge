# ALGO-184 — **THE 15m OPTIMISATION IS REFUSED.** Its licence is true about pivots and false about zones. X-ray repaired.

**Strategy head:** `031dfc29` — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic file modified:** `candidate_xray.py` (anchor), authorized by ALGO-183.
**The fidelity gate's last item is answered — with a refusal, which was always one of its outcomes.**

---

## 1. 🛑 THE OPTIMISATION IS REFUSED — I TESTED THE LICENCE BEFORE BUILDING ANYTHING

The licence was a **fact about the data**: *"pivots cannot change between 15m closes."* **That is
true about pivots and false about zones.**

`build_zones` consumes `asof` in **three** places beyond pivot confirmation, and **two of them move
continuously rather than at 15m closes**:

```
v2_2_engine.py:443   piv.t >= asof - look_days        the 40-day lookback EDGE slides every bucket
v2_2_engine.py:487   rec_days = (asof - r.confirm)    recency weights change every bucket
v2_2_engine.py:489   center = _weighted_median(prices, rec_w)
v2_2_engine.py:519   zid = f"{side}:{created}:{round(center/TICK)}"    <- the ID CONTAINS center
```

**MEASURED — all 14 sessions, consecutive 5m anchors INSIDE the same 15m window, 448 pairs:**

| | changed |
|---|---|
| zone **BAND** set | **28 of 448 — 6.2%** |
| zone **ID** set | 11 of 448 — 2.5% |
| membership, **center excluded** | **6 of 448** — the lookback edge, a **second independent mechanism** |

**Worked example:** `2026-03-30`, zone `R:2026-03-18T14:45` has center **`99524` at 09:30** and
**`99539` at 09:35** — same pivots, same 15m window, **a 15-tick shift purely from recency
reweighting.**

> **A 15m-close rebuild would be INEXACT at 6.2% of intra-window steps.** Under the obligation as
> written — *any difference anywhere ⇒ a different strategy wearing a speed argument* — **that is a
> refusal.**

**Consequences I am not softening:** the **45.5-hour** cost for 1,925 sessions **stands
unimproved**, and **I am reporting no achieved runtime, because no accelerated path was built.**
**I am not proposing an alternative.** Any faster path must first be shown exact against the same
obligation, and identifying one is a ruling.

## 2. THE X-RAY MIRRORS THE KERNEL AGAIN — and the mirror claim is now a GUARD

The plan and the location set are built **per decision at `ts`, inside the bucket loop**, exactly as
`iter_actionable_candidates` does. The `09:30` literal survives only as `warmup_ref`, matching the
kernel's own naming.

**`meta.premarket_primary` / `premarket_structure` / `authorized_locations` were session-level facts
when the map was session-level.** They are now recorded at the **first decision bucket** and
labelled as such — **a single value would be a session-level claim about a per-decision object.**

**THE MIRROR CLAIM IS A TEST, ASSERTED AGAINST THE KERNEL, NOT AGAINST A LITERAL:** whatever the
kernel anchors on, the X-ray must anchor on the **same name**. **A prose claim about another file's
behaviour has no way to notice when that file changes** — which is precisely how this one went
stale without anyone editing it.

**Both X-ray census artifacts stamped `MEASURES THE PRE-REPAIR ENGINE`.** Not deleted, not re-scored.

## 3. 🛑 MY FIRST RED-PROOF UNDER THE NEW LAW FAILED THE NEW LAW

The mirror guard's red-proof matched the string *"different engine"* — **which appears in the
guard's own DOCSTRING, echoed by pytest above the assertion.** It reported *"RED for the planted
reason"* and was **checking prose the guard wrote about itself.**

**That is a red-proof certifying itself — the docstring-mutation trap, one layer up.** The law was
adopted an hour ago and its first application in this packet violated it.

**Tightened:** read only pytest's `E ` assertion lines, and **require the PLANTED VALUE by name.**
Both mutations now RED with the assertion naming `'warmup_ref'` and `'None'` respectively,
byte-exact restore.

```
-> RED, and the assertion NAMES the planted value 'warmup_ref':
   E  AssertionError: build_entry_locations_v24: the kernel anchors on ['ts'] and the X-ray on ['warmup_ref']
```

## 4. WHERE THE FIDELITY GATE STANDS

- Causality class **closed** (ALGO-183), `P1`/`P2`/`P3` green with controls RED first.
- X-ray **mirrors production again**, and cannot silently stop.
- **The optimisation is refused on its own pre-registered terms**, so the backtest cost is what it
  was: **45.5 hours** for the contiguous window.

**Stopping here as ordered.** Backtest and Monte Carlo are a separate ruling with their own
pre-registration, and **nothing in this packet is an argument for either.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
