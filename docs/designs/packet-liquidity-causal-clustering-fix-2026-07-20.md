# RATIFY PACKET — causal clustering fix for `detect_buyside/sellside_liquidity`

**STATUS: STAGED.** Engine-instrument class. Authorization: **R-115 (fix packet UNBLOCKED)**.
Pre-live; no live default altered; the sealed 77 untouched. Independent grade is the gate.

---

## 1. What & why now — with receipts

`detect_buyside_liquidity` / `detect_sellside_liquidity` (`indicators/liquidity.py:33-52`, `76-95`)
cluster over the **entire** swings table with a greedy `used`-set pass. **A future swing can
retroactively absorb an earlier, already-confirmed swing** into a differently-anchored cluster,
so **whether a level exists at bar *i* can be decided by data at bar >> *i***.

**Mutation-validated** (AR-096 F-1): truncation mismatches on **4 of 5 seeds, up to 84/185 probe
bars**; concrete trace — a swing at **bar 73**, visible when only bars 0–100 are known,
**vanishes** on the full 220-bar frame because it merges into a cluster anchored at **bar 135**.

**Observed downstream** (AR-104): `detect_sweep` is pure per-bar and clean in isolation
(0/1120), yet **156/1120 at real call sites** — **bar 1 classified a sweep against a level formed
~296 bars later.** Inherited, not a second defect.

**Confined, not systemic** (AR-104, pre-registered hypothesis resolving to the ONE-OFF arm): the
same-file siblings `detect_equal_highs`/`detect_equal_lows` (no `used` set) and `detect_fvg` all
probe CLEAN at 0/1120 each, every verdict behind a fired plant-catch. **The mechanism was not
copy-pasted.**

## 2. Blast radius — AST-derived (`bsl-ssl-consumer-census-AST.json`)

**7 production consumers**, one definition site (`liquidity.py`):
`strategies/{eqhl_raid, ict_2022, ict_scalp, ict_swing, quarterly_swing, turtle_soup}.py`
(the six barred archetypes) + `spec_condition_compiler.py` (the Population-A resolver).

**`paper_bridge.py` is NOT a consumer** — independently confirmed by this AST census and by
AR-105's liveness check. **No live paper path consumes the defect.**

**Door law (R-110 §3):** exactly **ONE** definition site — `grep -rln "def detect_buyside_liquidity"`
returns `liquidity.py` only. The re-export doors were a false finding (AR-101); the packet still
verifies import-not-copy at land time.

## 3. The exact change, scope-locked

**IN:** make clustering **causal** in both functions — a cluster visible at bar *i* is computed
from swings known as of *i*, so no later swing can re-anchor or absorb an earlier one.

**PROHIBITED, not merely out of scope:** post-hoc slicing of a full-history clustering result.
**The cluster MEMBERSHIP is what is computed non-causally**, so slicing its output preserves the
defect while looking like a fix — and would pass a naive truncation probe run on the sliced
output. This is the most plausible wrong fix; it is banned by name.

**OUT:** `detect_sweep` (clean; cured by inheritance — do not touch) · `detect_equal_highs/lows` ·
`detect_fvg` · the other 14 detectors · the six archetypes' own logic · narration/session lanes ·
fill/P&L/sizing · promotion gates · any `approximation=False`.

## 4. Verification plan — RETURN CHECKLIST (blocking)

Each item returns a receipt or an explicit "could not, because…". A silent omission halts the lane.

1. **Truncation probe on both fixed functions** — 0 mismatches across >=5 seeds x >=50 probe bars.
2. **PLANT-CATCH per function** — reinstate the F-1 absorption shape, show the probe FIRES, then
   show the fixed code PASSES. A probe that cannot fail proves nothing.
3. **CONSUMPTION-WIDE VERIFICATION (R-114 §2) — the half that is easy to skip:** re-probe the
   **sweep-consuming strategies** under fixed levels via call-site truncation probes. The defect
   was *observed* at call sites; **unit tests on the two functions do not cover where it showed.**
4. **Comparisons align on the RECORD-KNOWABILITY index** (R-114 §3) — *when is this record
   complete?* — before any mismatch counts. A middle-candle vs third-candle misalignment already
   manufactured one false 7/39 reading.
5. **Behaviour-change disclosure:** the fix WILL change historical backtest output for the seven
   consumers. That is the point — they were reading the future — but it must be **stated, not
   discovered**, and no existing certified number may be silently re-baselined.
6. Any rate cited carries its **null** (R-100 §2), or the stated reason none is defined.

## 5. Rollback

Single-commit revert; pure-function change, no migration, no persisted state, no flag (the fix is
strictly more-correct, not opt-in). Reverting restores the defect — therefore **the archetype bar
stays until the fix is GRADED, not merely landed.**
