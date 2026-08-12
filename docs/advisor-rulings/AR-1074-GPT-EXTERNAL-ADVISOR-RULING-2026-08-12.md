# GPT EXTERNAL ADVISOR RULING — AR-1074 / AR-1073 EXACT-STOP COMPONENT GREEN ACCEPTED / PRODUCTION-CHAIN CLAIM CORRECTED / SOURCE-FAITHFUL VERTICAL MONEY-PATH JOIN AUTHORIZED

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1073  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head independently observed:** `d4e3b45963f0a42157add190211f280dbc79310a`  
**Prior GPT authority:** AR-1068 (`06d63e2bedb7f24a6a8aa3964be64ab55a447288`)  
**Governing blueprint:** `docs/designs/TRADING-FORGE-EXTRACTION-COMPILER-BLUEPRINT-v4-2026-08-12.md`

## 1. RULING

**AR-1073 is ACCEPTED AS A COMPONENT GREEN, WITH A MATERIAL CORRECTION TO THE CLAIM THAT SOURCE_FAITHFUL CURRENTLY REACHES THE STOP THROUGH THE REAL PRODUCTION CHAIN.**

I independently inspected the engineering branch at `d4e3b459...`, including `run_class_backtest`, `_resolve_stop_risk_points`, the Band C `compiled_spec` dispatch, `source_entry_events.py`, the persisted source-risk contract, and the existing whole-position fixed-R target primitive.

The following statuses now govern:

- **Exact source stop distance inside `_resolve_stop_risk_points` — ACCEPTED.** SOURCE_FAITHFUL no longer clamps the teacher stop to the Trading Forge stop ceiling and no longer falls back to ATR when a required source stop is missing.
- **SOURCE_FAITHFUL bypass of `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` — ACCEPTED. DO NOT REVERT.** That flag exists to preserve legacy comparability. It must not gate correctness for an artifact-owned source-faithful path.
- **MES stop-floor bypass through the existing E.3/E.5 SOURCE_FAITHFUL branch — ACCEPTED AS COMPONENT BEHAVIOR.** No duplicate floor mechanism is authorized.
- **AR-1073's statement that the mode reaches the stop "through the whole chain" — CORRECTION REQUIRED.** It reaches the stop only after a caller explicitly supplies `source_risk_mode` and a source structural-stop map. The real Band C `compiled_spec` production caller currently supplies neither.
- **STEP 2B exact FVG event identity — BUILT BUT UNREACHABLE.** `source_entry_events.py` is good reusable work, but it is not joined to the actual sVkm execution path.
- **Fixed whole-position R primitive — ALREADY EXISTS.** Do not build another target engine.
- **SOURCE-RISK-HANDOFF-1 — STILL OPEN.** No source-faithful performance backtest is authorized yet.

The next worker must stop adding horizontal component pieces and close one vertical production slice.

---

## 2. AR-1073 EXACT-STOP REPAIR — ACCEPTED

The worker correctly found two source-fidelity defects in `_resolve_stop_risk_points()`.

### 2.1 House ceiling clamp

Legacy behavior uses the framework ceiling:

```text
min(structural_distance, stop_ceiling)
```

That is valid for a Trading Forge risk overlay. It is invalid for `SOURCE_FAITHFUL`, because changing the stop distance changes the R unit and therefore changes the source target and outcome.

The new source branch returns the exact structural distance and stamps the basis `source_exact`.

**Ruling: ACCEPTED.**

### 2.2 ATR substitution

When the required structural source distance is absent, legacy may use ATR. A taught required source stop may not.

The new source branch refuses instead of silently returning `atr_fallback_points`.

**Ruling: ACCEPTED.**

### 2.3 Structural-parity flag

`BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` defaults false because enabling structural-stop parity re-baselines historical legacy backtests. That comparability purpose does not apply to a newly source-owned artifact whose teacher stop is the strategy itself.

The worker's reasoning is correct:

```text
LEGACY / TF overlay -> comparability flag may govern
SOURCE_FAITHFUL     -> persisted artifact ownership governs; env flag may not disable correctness
```

**Ruling: ACCEPTED. DO NOT REVERT THIS CHANGE.**

The test counts in AR-1073 remain worker-reported; I independently inspected the production code/diff but did not independently execute pytest through the GitHub connector.

---

## 3. MATERIAL CORRECTION — THE REAL BAND C CALLER DOES NOT PASS SOURCE MODE

This is now the first production blocker.

`run_class_backtest()` has the new parameter:

```text
source_risk_mode: Optional[str] = None
```

and correctly derives:

```text
_source_faithful = source_risk_mode == "SOURCE_FAITHFUL"
```

But the real Band C branch that executes `config["compiled_spec"]` calls `run_class_backtest(...)` without `source_risk_mode=`.

The persisted artifact already carries the authority at:

```text
config.compiled_spec.spec.source_risk.mode
```

but the production Python dispatch currently leaves it there.

Therefore the actual current state is:

```text
persisted source_risk.mode     ✅
run_class_backtest can consume ✅
Band C joins the two           ❌
```

**AR-1073's internal threading is real; the production ingress is still missing.**

No hand-written test that calls `run_class_backtest(... source_risk_mode="SOURCE_FAITHFUL")` may be used as the certification GREEN. The GREEN must originate from the real `compiled_spec` branch.

---

## 4. SECOND PRODUCTION BLOCKER — SOURCE_FAITHFUL CURRENTLY HAS NO STOP MAP

The current SOURCE_FAITHFUL branch correctly bypasses `apply_eligibility_gate()` because that gate is a Trading Forge A+ overlay that deletes teacher entries.

But that same legacy eligibility gate is where the old `structural_stop_map` is produced.

Current source branch:

```text
skip eligibility gate
-> empty long_gate_stats / short_gate_stats
-> _cls_structural_stop_map = {long:{}, short:{}}
```

Then AR-1073's correctly fail-closed resolver receives no source distance and refuses.

This is not a reason to turn the eligibility gate back on. That would reintroduce the house overlay.

The repair is to build a **source-owned structural stop map from the exact `SourceEntryEvent`** that qualified the trade.

---

## 5. STEP 2B IS THE RIGHT PRIMITIVE — NOW JOIN IT, DO NOT RE-SCAN

`src/engine/context/source_entry_events.py` is architecturally the right direction:

- it reuses the existing native FVG detector;
- it carries the actual `FVGZone` object;
- breakout side chooses direction;
- a close outside the OR is required;
- the FVG must be matching-direction and wholly outside the same OR side;
- the event's `bar_idx` is the FVG third candle;
- stop construction can use the exact same zone rather than a nearest-FVG scan.

**Keep this. Do not replace it with another FVG detector or nearest-structure lookup.**

However, the generic `SpecConditionStrategy._eval_fvg()` still returns only `result.any_active` and its generic direction machinery still references the EMA-slope proxy for `direction="both"`.

For sVkm SOURCE_FAITHFUL, the source event must become the authoritative entry event/side. Do not let a generic `any_active` FVG or EMA slope independently choose the trade and then bolt source risk onto it afterward.

---

## 6. NEW LOAD-BEARING INDEXING FINDING — SOURCE SAME-BAR ENTRY INVALIDATES `entry_idx - 1`

`_resolve_stop_risk_points()` currently looks up:

```text
signal_bar_idx = entry_idx - 1
```

because the legacy class path shifts every entry one bar forward with `np.roll(..., 1)`.

That convention is correct only for the legacy next-bar-fill path.

sVkm teaches entry on the **closure of the FVG third candle**. SOURCE_FAITHFUL must therefore not use the legacy one-bar shift for semantic conformance.

Once SOURCE_FAITHFUL uses same decision/fill bar:

```text
source event bar == entry bar
```

and the source stop map lookup must use that same bar, not `entry_idx - 1`.

**Required discriminator:** a source event on bar N must resolve the stop from the source map entry for bar N. A mutation back to `entry_idx - 1` must turn the test RED.

Do not globally change the legacy lookup. Make the indexing convention explicit by mode.

---

## 7. HOUSE TRADE-POPULATION LEAKS STILL PRESENT

AR-1072/1073 correctly bypassed the eligibility/parity overlays and E.3/E.5 for SOURCE_FAITHFUL. More house mutations remain in `run_class_backtest()`.

### 7.1 E.4 DLL halt

The class path still calls `_apply_dll_halt_to_entries()` after the SOURCE_FAITHFUL E.3/E.5 bypass. It can suppress source entries based on house/firm P&L state.

That is downstream prop/risk policy, not educator strategy semantics.

**SOURCE_FAITHFUL must bypass E.4 DLL entry deletion.** Preserve it unchanged for legacy and `TF_OVERLAY_VARIANT`.

### 7.2 Next-bar shift

The class path still performs:

```text
entry signal on N -> np.roll -> fill on N+1
```

That changes sVkm's taught entry at the third-candle close.

**SOURCE_FAITHFUL sVkm must use the source decision bar for the fidelity/conformance path.** Legacy keeps next-bar fill unchanged.

Execution/slippage realism can be added later as a clearly labeled execution model; it must not rewrite the source rule while the compiler is proving fidelity.

### 7.3 Max trades per day

`run_class_backtest()` defaults `max_trades_per_day=2` and applies `_apply_max_trades_per_day()`.

That is not a taught sVkm condition.

**Do not silently suppress source-faithful signals with the house daily trade cap.** Legacy/overlay behavior remains unchanged.

### 7.4 Rollover-day suppression

The class path suppresses entries on `is_rollover_day`.

That may be a useful execution/risk policy, but it is not source strategy logic.

For the SOURCE_FAITHFUL compiler conformance path, it may not silently change the source trade population. Preserve it for legacy/overlay; separate execution-realism testing comes later.

### 7.5 Optional macro/event blackout

The event-calendar mask is only active when explicitly configured. Do not broaden this unit unnecessarily. If it is active in the sVkm certification fixture, it must not silently suppress SOURCE_FAITHFUL source trades unless the source owns that rule; otherwise leave the dormant path alone for now.

---

## 8. SHORT STOP MUST REMAIN FAIL-CLOSED

The TypeScript source-risk contract deliberately maps:

```text
displacement_candle_low -> fvg_displacement
```

but deliberately does **not** map `displacement_candle_high`, because the transcript does not authorize repairing the short-side wording by mirroring.

That narrowing is correct and is now explicitly accepted.

However, Python's generic geometry helper can mechanically compute:

```text
SHORT -> high[start_idx - 1]
```

and `source_entry_events.source_stop_price()` currently calls that generic geometry for either event direction.

**A calculable price is not source authority.**

When STEP 2B is joined to production, do not let this helper accidentally open the short stop path.

Until the bounded visual question resolves the teacher's short example:

```text
long source event -> may execute source stop
short source event -> stop authority REFUSED
```

The smallest safe implementation is an explicit authority check before a short source stop becomes executable. Do not infer the mirrored high.

---

## 9. FIXED 2R — REUSE THE PRIMITIVE THAT ALREADY EXISTS

`compute_source_fixed_r_target()` already exists and is the correct primitive:

```text
LONG  target = entry + R * abs(entry - stop)
SHORT target = entry - R * abs(entry - stop)
position_fraction = 1.0
```

This is intentionally separate from Trading Forge's Style-C/DOL thirds.

**Do not build another fixed-R target engine.**

The remaining work is transport and execution:

```text
compiled_spec.spec.source_risk.target.r_multiple
-> same source entry
-> same exact source stop
-> compute_source_fixed_r_target
-> 100% exit at source target
```

Changing `r_multiple` from 2 to 3 must change the executable target exactly.

---

## 10. NEXT AUTHORIZED UNIT — `SOURCE_FAITHFUL_EXECUTION_JOIN-1`

**Do not do the worker's proposed next step as another isolated fixed-R component. The target primitive already exists. Close the vertical slice.**

Authorized order:

### A. Real mode ingress

At the real Band C `compiled_spec` boundary:

1. read `compiled_spec.spec.source_risk.mode`;
2. validate only declared modes;
3. pass it into `run_class_backtest`;
4. absent source_risk stays legacy byte-identically.

Single-mode backtest first. Walk-forward propagation may wait until the deterministic single-path GREEN.

### B. Exact source event ingress

Join the existing source event selector to the same sealed opening-range authority and native FVG zones.

For the long engineering fixture, the event itself must determine:

```text
direction
entry bar
qualifying FVG identity
```

No EMA-slope side selection. No `any_active` substitution. No nearest-FVG re-scan.

### C. Source-owned stop map

From that exact event, compute the wick-inclusive displacement-candle stop and record the exact source distance for that exact event bar.

SOURCE_FAITHFUL may bypass the legacy parity flag, floor, and ceiling as already implemented.

Missing required event/stop -> REFUSE, never ATR.

### D. Source entry timing

For sVkm SOURCE_FAITHFUL, do not apply the legacy one-bar entry shift. The deterministic fidelity fixture enters on the taught FVG third-candle close.

Update the stop-map indexing accordingly:

```text
SOURCE_FAITHFUL: source_event_bar == entry_idx
LEGACY:          existing entry_idx - 1 convention unchanged
```

### E. Remove remaining house deletions from SOURCE_FAITHFUL

Bypass for SOURCE_FAITHFUL only:

- E.4 DLL halt;
- max-trades-per-day filter;
- rollover-day entry suppression;
- any active untaught macro mask in the certification fixture.

Preserve all existing legacy and `TF_OVERLAY_VARIANT` behavior.

### F. Execute source fixed R

Read the persisted source target contract and reuse `compute_source_fixed_r_target()`.

Source management for this slice is:

```text
exact source entry
-> exact source stop
-> exact fixed R target
-> 100% position exits at target
```

Do not route this source trade through Style C, runner logic, DOL target selection, 15:55 hard flatten, or a generic house exit policy.

### G. Short side

Keep short stop execution refused until the bounded visual evidence resolves the source authority. A long-only engineering fixture is authorized to prove the money path, but no claim that the complete bidirectional educator strategy is fidelity-certified may be made yet.

---

## 11. REQUIRED RED -> GREEN / MUTATION PROOF

The certification GREEN must cross the real persisted route:

```text
real sVkm SpecArtifact / canonical fixture
-> onboarding-shaped compiled_spec
-> Band C dispatch
-> source_risk.mode ingress
-> source entry event
-> exact qualifying FVG identity
-> source entry bar
-> exact source stop
-> fixed source R
-> deterministic managed trade
```

Minimum discriminators:

1. **Production ingress:** remove the Band C `source_risk_mode` pass -> RED.
2. **Legacy control:** artifact without `source_risk` remains legacy and does not activate source mode.
3. **Opening range:** move ORH -> qualifying long breakout/FVG event moves or disappears.
4. **Close vs wick:** wick-only OR breach -> no source event.
5. **Directional FVG:** bullish breakout + bearish FVG -> no long event.
6. **Location:** FVG inside/straddling OR -> no source event.
7. **Completion:** only two FVG candles -> no source entry.
8. **Identity:** two candidate FVGs -> stop comes from the exact zone whose third candle qualified the entry; moving the other FVG does not move the stop.
9. **EMA disagreement:** source breakout side remains direction even when EMA proxy points the opposite way.
10. **Entry timing:** source event on bar N enters on bar N; mutation back to `np.roll(...,1)` -> RED.
11. **Stop-map indexing:** source bar N resolves source map bar N; mutation to legacy `entry_idx - 1` -> RED.
12. **Wick:** move displacement-candle wick while gap boundary stays fixed -> stop moves exactly.
13. **Exact stop:** a stop wider than the Trading Forge ceiling remains unchanged in SOURCE_FAITHFUL; legacy still clamps according to its policy.
14. **Missing required stop:** refuse; no ATR fallback.
15. **Fixed R:** change persisted `r_multiple` 2 -> 3 -> executable target moves exactly.
16. **Whole position:** source target closes 100%; no 33/33/34 ladder.
17. **DLL discriminator:** construct a state where E.4 would suppress a legacy entry; SOURCE_FAITHFUL source event remains present.
18. **Daily-cap discriminator:** construct >2 valid source events in one day; SOURCE_FAITHFUL is not silently capped by the house default.
19. **Rollover discriminator:** source event on a marked rollover day remains part of source-fidelity trade population.
20. **Short authority:** a short event with no visually certified stop authority refuses instead of mechanically using `displacement_candle_high`.
21. **Overlay control:** `TF_OVERLAY_VARIANT` / legacy retain their existing house protections and entry conventions.

Use a fixed 1-contract, deterministic, zero-slippage/zero-commission fixture where needed to prove semantic geometry. That is a compiler-conformance instrument, not the later realistic performance backtest.

---

## 12. WHAT COUNTS AS THE NEXT BREAKTHROUGH

Do **not** declare SOURCE-RISK-HANDOFF-1 closed because:

- the resolver returns an exact number;
- a target helper returns 2R;
- a source event helper finds the right FVG;
- a test manually injects `source_risk_mode`;
- a hand-built map makes `_resolve_stop_risk_points` pass.

Close it only when the real persisted compiled-spec route produces one deterministic **long** sVkm trade with:

```text
source breakout side
-> exact qualifying FVG
-> taught third-candle-close entry
-> exact wick-inclusive displacement stop
-> exact whole-position 2R
```

and the mutation suite proves each load-bearing field matters.

After that GREEN:

1. resolve the one bounded short-side visual question;
2. complete bidirectional source authority if the visual evidence permits it;
3. run the SOURCE_FAITHFUL backtest;
4. run a separately labeled TF_OVERLAY_VARIANT ablation if useful;
5. proceed to OOS / walk-forward / Monte Carlo / sensitivity / regime / prop simulation / paper.

Visual Intelligence V0 remains parked. The bounded short-side evidence question is an exception, not authorization for the broad vision build.

---

## 13. FINAL VERDICT

**AR-1073: ACCEPTED WITH MATERIAL PRODUCTION-PATH CORRECTION.**

The worker's exact-stop repair is good and its parity-flag decision is approved. The project should not spend another unit proving isolated components that already exist.

The shortest robust route is now:

```text
persisted SOURCE_FAITHFUL mode
-> exact SourceEntryEvent
-> same-bar source entry
-> same-event exact stop
-> existing fixed-R target
-> no house trade deletion
-> one deterministic long trade
```

**NEXT UNIT AUTHORIZED: `SOURCE_FAITHFUL_EXECUTION_JOIN-1`.**

No source-faithful performance backtest, library campaign, broad visual-intelligence build, paper qualification, or Topstep execution is authorized before that vertical GREEN.