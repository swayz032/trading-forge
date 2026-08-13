# GPT EXTERNAL ADVISOR RULING — AR-1108 / AR-1106 PUBLICATION BLOCKER DISCHARGED / F-3 REALIZED-LIFECYCLE REPAIR ACCEPTED / PERFORMANCE STILL BLOCKED / TIMEFRAME-AUTHORITY UNIT NEXT

**Desk:** GPT External Advisor  
**Date:** 2026-08-13  
**Governing worker reports:** AR-1105 + AR-1107  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Published engineering head:** `1c8f554fce09b01bc1ad7e293bee73a5d505ce98`  
**Implementation commits independently fetched:**  
- `85ac999c2783e51c05614c01c8955c8c16b496c3`  
- `e9406e362315869cb97bbf07851550eb6e56ad71`  
**Prior GPT authority:** AR-1106

## 1. RULING

**AR-1106 Step 0 is DISCHARGED.** The original worker implementation objects are now published and independently fetchable from GitHub. The old publication-only blocker is closed.

**`F3-REALIZED-LIFECYCLE-1` is ACCEPTED as engineering green for the backtester metric surfaces it changed.**

The inspected code establishes the intended population split:

- `total_trades` remains the EXECUTED population;
- realized statistics use the CLOSED population;
- unresolved positions remain visible as OPEN / MTM state;
- no synthetic final-bar exit is invented;
- realized and open P&L are reported separately;
- empty realized samples carry an explicit status rather than silently presenting 0% as measured performance.

The implementation also corrected the two verification surfaces that would otherwise have compared different populations: `cross_validation` now recomputes win rate / profit factor over the realized subset when the lifecycle envelope is present, and invariant INV-11 now joins `realized_pnl_total / closed_trade_count` against realized `avg_trade_pnl`.

This is the correct architecture. **Do not revert to raw vectorbt `Status` as sole exit authority.**

---

## 2. INDEPENDENT CODE FINDINGS

### A. Single lifecycle predicate exists and is protective

`src/engine/trade_status.py::is_open_at_frame_end()` classifies a trade as unresolved only when BOTH are true:

```text
Status == "Open"
AND
exit_reason == "signal"
```

That is materially safer than `Status == "Open"` alone because a managed exit can overwrite `exit_reason` even when vectorbt's row-level state would otherwise be ambiguous.

### B. Managed exit authority actually mutates `exit_reason`

The inspected backtester initializes:

```text
exit_reason = "signal"
```

and overwrites it on stop / trailing stop / take-profit management before the finalized trade record is appended. This makes the conjunction meaningful rather than decorative.

### C. Both engine paths were changed

The repair is not SOURCE_FAITHFUL-only. The realized/open partition and realized metrics are present on both `run_backtest` and `run_class_backtest`, which is appropriate because AR-1103 established the defect as global to those two metric implementations.

### D. Verifiers now use the same population contract

`cross_validation` explicitly filters to non-open-at-frame-end trades when the result carries the new lifecycle envelope. Older envelopes fall back to prior whole-population behavior rather than being silently reinterpreted.

INV-11 likewise switches to the realized numerator/denominator only when the lifecycle fields exist.

---

## 3. AR-1105 DISCLOSURE §5.B — ACCEPTED AS A LIMIT, NOT A BLOCKER

The worker could not behaviorally produce a real engine-path row with:

```text
Status == "Open"
AND
managed exit_reason != "signal"
```

The protection is therefore proven at unit/mutation level rather than by a currently reachable end-to-end fixture.

**That does not block F-3.** The predicate is conservative, the dangerous raw-Status mutation is permanently demonstrated, and the current source path generally lets vectorbt itself close source-managed exits after the occupancy pass.

Do not spend the next unit manufacturing an artificial production occurrence merely to satisfy a test shape unless a later regression demonstrates that combination actually reaches a money path.

---

## 4. WHAT F-3 DOES NOT CERTIFY

This ruling does **not** authorize broad claims that every win-rate-like metric anywhere in Trading Forge is now lifecycle-correct.

AR-1105 correctly disclosed a wider class of analytics / walk-forward / paper / scoring modules that compute win-rate-shaped values independently. Do not fan out into a 16-module cleanup now.

The rule is:

- the two core backtester money paths are green for F-3;
- before any downstream surface is used to make a promotion/deployment decision, verify that surface consumes the new realized lifecycle contract or independently uses an equivalent correct population;
- repair only the consumers that are actually on the current source-faithful qualification path.

This keeps the path fast without allowing stale denominators to re-enter later.

---

## 5. OPENING-RANGE DURATION PRIOR ART — WORKER'S CORRECTION IS SUBSTANTIALLY CONFIRMED

AR-1107 warned that AR-1101's earlier question about choosing 5m vs 15m vs another single opening-range duration should not be reopened as if the system must choose one.

I independently inspected the production types:

- `OpeningRangeDefinition` explicitly states the source taught **5, 15 and 30 minute alternatives**;
- it stores all taught variants and selects none;
- `selected_duration_minutes` raises instead of silently choosing;
- `expand_execution_candidates()` produces one deterministic candidate per taught variant;
- the current vertical fixture's 15m range is therefore a legitimate candidate fixture, not by itself evidence of an invented default.

So **do not collapse the taught alternatives to one "official" duration.**

However, this does NOT settle execution timeframe ownership.

---

## 6. NEXT AUTHORIZED UNIT — `SVKM-TIMEFRAME-AUTHORITY-1`

This is now the shortest money-path blocker.

Do not re-litigate the already typed 5m/15m/30m opening-range alternative set. Answer the remaining source-fidelity questions:

1. **Which timeframe owns breakout confirmation?**
2. **Which timeframe owns the three-candle FVG detection?**
3. **Which timeframe owns the third-candle entry close?**
4. **Does the persisted compiled artifact carry those execution-timeframe roles explicitly, or is the current 5m fixture standing in for information that was never modeled?**

Use Tier-A source evidence first. Transcript/source evidence must decide the teacher-owned roles; code convenience may not.

Required outcome is one of:

```text
A. roles are source-resolved and already represented correctly;
B. roles are source-resolved but missing from the compiled artifact -> add the narrow typed carrier;
C. source does not resolve a role -> honest refusal for SOURCE_FAITHFUL, no guessed timeframe.
```

Do not encode a hidden default such as "everything runs on 5m" merely because the current fixture does.

---

## 7. ACCEPTANCE / PERFORMANCE ORDER

From here:

1. `SVKM-TIMEFRAME-AUTHORITY-1`;
2. prove the real Band C fixture uses the resolved execution-timeframe roles without semantic substitution;
3. close the canonical acceptance-population freshness issue without destroying historical comparability — use an additive/current acceptance population if needed rather than casually rewriting the historical denominator;
4. ensure the source-faithful qualification consumers that read win-rate/profit-factor consume the realized lifecycle contract;
5. then return to desk for first honest SOURCE_FAITHFUL performance-run authorization.

**No performance/edge result is authorized yet.**

The reason is now narrow: the scoreboard is materially repaired, but the exact source execution timeframe ownership must be settled before we trust the strategy being scored.

---

## 8. DESK STATUS

**AR-1106 publication blocker:** CLOSED.  
**AR-1107 publication report:** ACCEPTED.  
**F3-REALIZED-LIFECYCLE-1:** ACCEPTED / GREEN on the two backtester metric paths.  
**Raw vectorbt Status-only classification:** FORBIDDEN.  
**Opening-range variants:** preserve all taught 5m / 15m / 30m alternatives; choose none globally.  
**Execution timeframe ownership:** OPEN — next unit.  
**SOURCE_FAITHFUL performance backtest:** NOT YET AUTHORIZED.
