# Archetype Look-Ahead — independent doer≠grader trace (2026-07-07)

**Trigger:** Fable-5's deep engine-coverage grader claimed F-1/F-2/F-3 = CRITICAL look-ahead in
breaker.py / mitigation.py / unicorn.py — "zone validity computed from a window extending past the
earliest entry bar → backtest admits trades using future bars (inflated edge)." Independently traced
(read-only; NOT accepted at face value — grader claims are claims until the code is checked).

## FACTS (checkable code trace — breaker.py path)
1. **Swing layer is CLEAN — contradicts the grader's "swing window" framing.** `detect_swings`
   (`market_structure.py:22`) uses a CENTERED `rolling_max/min(window=2*lookback+1, center=True)` BUT then
   shifts every swing index forward by `half_window`: `(pl.col("index") + half_window)` with the explicit
   comment "so the swing is only visible after the confirmation window completes (**eliminates lookahead
   bias**)" + line 321 "these functions never read ahead." So a centered swing at bar i is re-indexed to
   i+lookback (its confirmation bar). NO look-ahead in swing detection.
2. **OB anchors at the swing bar (shift removed):** `detect_bullish/bearish_ob` (`order_flow.py:129/162`)
   does `raw_indices = np.maximum(raw_indices - lookback, 0)` — anchors the OB zone at the swing candle
   (correct — that's where the OB is drawn). The zone ANCHOR is correct; usability-before-confirmation would
   only leak if a consumer uses the OB before swing_bar+lookback (NOT yet traced end-to-end).
3. **THE REAL CANDIDATE — breaker.py:141 BOS-near-break validation searches a FORWARD window:**
   `for check_bar in range(max(0, broken_at - 3), min(n, broken_at + 4))` — checks BOS in [broken_at-3,
   broken_at+3], i.e. 3 bars PAST the break point. The breaker is marked valid if ANY BOS is in that window;
   that validity gates ALL retest entries on the zone. IF a retest entry occurs within [broken_at, broken_at+3],
   its admission used BOS bars from its own future.

## VERDICT (partial — doer≠grader)
- The grader's SPECIFIC mechanism ("swing window extends past entry bar") is **NOT what the code does** —
  the swing layer is shifted/clean. To that extent the F-1/2/3 framing is a **likely false positive**.
- BUT a NARROWER real candidate exists: the ±3-bar FORWARD BOS-near-break validation window. NOT dismissed.
- **PARKED (materiality judgment — fresh eyes / backtest-core, the fix owner):** is the ±3-forward window a
  MATERIAL look-ahead? Needs: (a) confirm retest entries are reachable within [broken_at, broken_at+3]; (b)
  whether the forward BOS actually flips validity vs a trailing-only [broken_at-3, broken_at] window; (c)
  magnitude on real data (A/B the window bound). ±3 bars is small — could be immaterial or a rounding artifact.
- **mitigation.py / unicorn.py NOT yet traced** — they share the clean shifted-swing layer (so the grader's
  swing framing is likely a false positive there too), but each has its own validation loop to trace the same way.

## Standing-order note
Facts recorded (checkable). Materiality = judgment = parked (not resolved tired). Do NOT fix tired: a
look-ahead "fix" that tightens the window without confirming materiality could silently change every archetype
backtest — same class as the H5 structural-stop-parity flag (default OFF until A/B'd). This is pre-live must-fix
TRIAGE data, not a fix.

## COMPLETION — mitigation.py + unicorn.py traced (2026-07-07)
- **mitigation.py — likely CLEANEST.** `_identify_mitigation_blocks` documents `bos_bar` = "bar index where
  BOS confirmed the MB (**entry only valid after this**)". The design GATES entry to after the confirmation bar —
  the look-ahead guard is explicit. (Design intent verified via the contract comment; line-level enforcement of
  "entry index > bos_bar" NOT yet asserted — a 1-test check for the fix owner.)
- **unicorn.py — same narrow forward-window candidate as breaker.** Displacement validation
  `range(max(0, b_broken_at-1), min(n, b_broken_at+2))` (±1 forward) + FVG proximity `abs(f_bar - b_broken_at) > 5`
  (±5, includes forward). Both reach PAST the break point; unicorn is anchored `formed_at = b_broken_at`.

## FINAL VERDICT (all 3 traced, doer≠grader)
- **Grader's "swing window extends past the entry bar" = FALSE POSITIVE across all 3** — the shared swing layer is
  shifted/clean ("eliminates lookahead bias"); mitigation additionally gates entry-after-BOS explicitly.
- **Real (narrow) candidates, materiality PARKED:** breaker ±3-forward BOS-near-break window; unicorn ±1 displacement
  + ±5 FVG forward windows. These are SMALL (1–5 bars) — plausibly immaterial or rounding-tolerant, plausibly a real
  edge-inflator if entries land in-window. The fix owner (backtest-core) resolves materiality: (a) assert entry index
  > confirmation bar in each; (b) A/B the window bound (forward vs trailing-only) on real data before any change.
- **Grade correction:** "F-1/F-2/F-3 = 3 CRITICAL look-aheads" is OVERSTATED as written. Corrected: 0 confirmed
  CRITICALs; 2 narrow forward-window CANDIDATES (breaker, unicorn) pending materiality; mitigation likely clean. This
  is the doer≠grader value — a claimed CRITICAL is claims until the code is checked, and here the code mostly checks out.
