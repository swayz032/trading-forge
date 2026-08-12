# GPT EXTERNAL ADVISOR RULING — AR-1079 / AR-1078 CLEAN STOP ACCEPTED / HOUSE-GATE STOP MAP FORBIDDEN / SOURCE-EVENT VERTICAL MONEY-PATH JOIN AUTHORIZED

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1078  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head independently observed:** `b609f03977fccf7183b24c58dcfe41425fe8e5eb`  
**Prior GPT authority:** AR-1074 (`d8497100519619d17f4fe9262a19c8347925c2ff`)  
**Governing blueprint:** `docs/designs/TRADING-FORGE-EXTRACTION-COMPILER-BLUEPRINT-v4-2026-08-12.md`

## 1. RULING

**AR-1078 is ACCEPTED AS A CLEAN STOP AND A HIGH-QUALITY HANDOFF.**

The worker was correct **not** to begin B/C/D/F and leave a half-wired execution path. I independently inspected the actual engineering tree at `b609f039...`, not only the report. The central blocker is real:

```text
SOURCE_FAITHFUL correctly bypasses apply_eligibility_gate()
        ↓
that same house gate is currently the producer of structural_stop_map
        ↓
SOURCE_FAITHFUL therefore receives an empty stop map
        ↓
AR-1073's fail-closed exact-stop resolver refuses every source trade
```

Two local repairs are individually correct and jointly non-functional. **The repair is NOT to send SOURCE_FAITHFUL back through the Trading Forge eligibility gate.** That would restore a stop map by reintroducing the exact house overlay whose trade-population rewrite we intentionally removed.

The following status now governs:

- **A — Band C source-risk mode ingress: CLOSED.** The real Band C single-run path now passes the persisted `compiled_spec.spec.source_risk.mode` into `run_class_backtest`.
- **E — source-faithful house-population bypasses: CLOSED at component level.** Eligibility/confluence, E.3 house stop ceiling, E.5 15:55 flatten, E.4 DLL entry halt, max-trades-per-day, rollover suppression, and the MES floor route are not allowed to rewrite SOURCE_FAITHFUL research. Legacy/overlay behavior remains governed by its existing paths.
- **G — unresolved short stop authority: CLOSED FAIL-SAFE.** Python now refuses source-faithful short stop construction rather than mechanically mirroring `high[start_idx-1]`. Short event observation may remain available; short **stop execution** remains refused until source authority resolves it.
- **B/C/D/F — OPEN AND MUST LAND ATOMICALLY.** They are one vertical execution unit.
- **SOURCE-RISK-HANDOFF-1 / first faithful deterministic trade — STILL OPEN.**

AR-1076's real Band C harness result is accepted only as a **route witness**: it proves the production route can carry a trade population under deterministic data. It is not sVkm fidelity evidence and may not be cited as proof of the teacher's entry, direction, stop, or target.

---

## 2. THE AR-1078 STOP-MAP DIAGNOSIS IS CONFIRMED

At the inspected tree, `run_class_backtest` does this on the source arm:

```python
if skip_eligibility_gate or _source_faithful:
    empty_stats = {"total": 0, "take": 0, "reduce": 0, "skip": 0, "skip_reasons": {}}
```

The source arm therefore never receives the `structural_stop_map` normally created inside `apply_eligibility_gate`. Later, `_cls_structural_stop_map` reads missing keys as `{}`.

That is exactly why the locally correct exact-stop resolver cannot currently execute a source trade.

### Governing correction

**Do not repair this by calling `apply_eligibility_gate` in SOURCE_FAITHFUL.**

The source stop command must be produced from the **source entry event itself**:

```text
exact breakout-side source event
-> exact qualifying FVG identity
-> that same FVG's displacement-candle wick extreme
-> exact source stop price / distance
-> existing structural_stop_map transport
-> source-exact stop consumer
```

The existing map plumbing through trade management is reusable. **Only the map's producer changes on SOURCE_FAITHFUL.** No parallel generic stop engine is authorized.

---

## 3. MATERIAL CORRECTION TO AR-1078'S JOIN MAP — OPENING RANGE IS PER SESSION

AR-1078 correctly located the FVG identity loss, but one production fact must be added before B is implemented.

`SpecConditionStrategy._h_opening_range()` already recomputes the taught opening range **for every trading day**. It groups bars by the source timezone's local date, calls the existing `opening_range_adapter.compute_opening_range_state(...)` exactly once per `(candidate, session_date)`, obtains the exact `OpeningRangeState`, and then currently collapses that state into a boolean availability array.

`OpeningRangeState` already carries:

```text
opening_range_high
opening_range_low
opening_range_complete
opening_range_window_status
```

Therefore:

**B MUST NOT call a second opening-range calculator and MUST NOT apply one scalar ORH/ORL across a multi-day frame.**

The source event join must reuse the exact per-session `OpeningRangeState` already computed by `_h_opening_range()` and the exact lock boundary for that same session. A minimal per-compute carrier on `SpecConditionStrategy` is acceptable, following the class's existing `last_*` diagnostic/state pattern, provided it is reset at the beginning of every `compute()` call.

For each session independently:

```text
that session's exact completed OR state
-> that session's close breakout
-> that session's matching-direction FVG
-> source entry event
```

An incomplete/refused OR session produces **no source event for that session** and may not borrow the previous or next day's range.

---

## 4. B — JOIN THE EXISTING FVG RESULT TO THE SOURCE EVENT; DO NOT RE-DETECT

The current `_eval_fvg()` executes the real `compute_fvg_signal(...)` and then throws away the identity-bearing output by returning only `result.any_active`.

The source path needs the already-computed `FVGResult.zones`.

### Required shape

Preserve the existing FVG result (or its exact zones) from the same evaluation that serves the condition. Do not implement a second FVG detector and do not substitute a later nearest-FVG scan.

The source event must be built with the already-existing `select_source_entry_events(...)` semantics:

- opening range locked;
- **close**, not wick, breaks ORH/ORL;
- breakout side owns direction;
- matching-direction FVG;
- FVG is outside that same OR side;
- the third candle is the decision event;
- the exact `FVGZone` that qualified the event survives to stop construction.

For SOURCE_FAITHFUL, retire the current semantic route:

```text
FVG any_active boolean + EMA-slope proxy direction
```

for this source event. **EMA may not choose the side when the source rule says breakout side chooses the side.**

Legacy/other compiled specs stay unchanged unless separately authorized.

### Trigger-safety boundary remains authoritative

The new source event does not get to bypass the existing strategy execution-refusal / trigger-safety boundary. A strategy whose required trigger is not faithfully bound still refuses before a performance result is produced.

---

## 5. THE EVENT CARRIER IS AUTHORIZED — BUT NAKED BAR INDEXES ARE NOT

AR-1078 correctly observed that B/C/D/F need more than a boolean entry array and that the strategy object is the narrowest existing carrier boundary.

**A minimal per-compute source-event carrier on `SpecConditionStrategy` is authorized.** Follow the class's existing discipline: initialize/reset it every `compute()` call; never let stale events survive into another run.

However, there is a load-bearing indexing trap the report did not name:

```text
strategy.compute() may run on warmup + OOS rows
then run_class_backtest strips warmup rows
```

An event recorded only as a pre-strip integer `bar_idx` can therefore point at a different candle after the strip. The FVG's `start_idx`, the stop wick, the entry bar, and the trade manager can all become internally consistent around the **wrong row**.

### Requirement

The carrier must preserve a **stable bar identity** across that boundary — e.g. the exact decision-bar timestamp plus the source event/zone identity, or an equivalently proven deterministic rebase. Do not rely on a naked integer surviving a frame slice.

The deterministic test suite must include a nonzero-warmup case proving the same source event, entry timestamp, stop candle, and target survive warmup stripping unchanged.

---

## 6. C — SOURCE STOP MAP COMES FROM THE SAME EVENT

For the authorized LONG path:

```text
source event.zone
-> source_stop_price(event, high, low)
-> displacement candle = zone.start_idx - 1
-> full wick LOW
-> no buffer
-> no floor
-> no ceiling clamp
-> no ATR replacement
```

Build the SOURCE_FAITHFUL stop-map entry from that event. The same map transport already used by `_apply_trade_management` may carry it downstream.

At minimum the source entry must preserve enough information to audit:

- decision bar identity;
- direction;
- qualifying FVG identity / start index;
- exact source stop price;
- exact source risk distance;
- source-exact ownership/basis.

**No nearest generic FVG, sweep, order block, or swing scan may replace this map producer.**

If the required long event/zone/stop cannot be produced, refuse. No ATR fallback.

For SHORT, `source_stop_price()` must continue to refuse until the source evidence question is resolved. Do not mechanically mirror the long wick low into a short wick high merely because the geometry is calculable.

---

## 7. D — ENTRY MEANS THE THIRD CANDLE'S CLOSE; LEGACY +1 ROLL STAYS LEGACY

The governed source authority says the entry is on completion/closure of the third FVG candle. The current class path unconditionally rolls entry signals forward one bar.

For the source-event path, that changes the strategy.

### Required SOURCE_FAITHFUL convention

```text
signal / decision event = third FVG candle complete
entry bar              = that same third candle
entry price            = that candle's CLOSE
```

The SOURCE_FAITHFUL source-event branch must therefore not inherit the legacy `np.roll(..., 1)` convention.

**Do not globally remove the roll.** Legacy and TF overlay behavior stay unchanged.

### No lookahead loophole

Entering at the third candle's close does **not** authorize using that candle's earlier intrabar high/low as though they occurred after the entry. For OHLC-bar fidelity, stop/target evaluation for this at-close entry must begin only after the decision-bar close unless a separately authorized intrabar data path proves event order.

The deterministic fixture must prove all three:

1. entry timestamp is exactly the third-candle timestamp;
2. entry price is exactly its close;
3. a stop/target touched earlier inside that same candle cannot retroactively exit a position that did not exist until the close.

The `_resolve_stop_risk_points` signal-bar lookup must also become mode-aware: source-at-close has no legacy `entry_idx - 1` relationship. The source map must resolve against the actual source entry bar.

---

## 8. F — USE THE EXISTING WHOLE-POSITION FIXED-R PRIMITIVE

`compute_source_fixed_r_target(...)` already exists and has the correct source-faithful semantics:

```text
LONG  target = entry + R * abs(entry - source_stop)
SHORT target = entry - R * abs(entry - source_stop)
position_fraction = 1.0
```

**Do not build another target engine.**

The sVkm persisted source contract already rides on `SpecConditionStrategy.spec`, so the runtime has access to `spec.source_risk.target`. Prefer consuming that existing contract through the strategy instance rather than inventing an unrelated target configuration channel.

For this source:

- target type must be `FIXED_R`;
- consume the persisted taught `r_multiple`;
- use the exact source stop as the R basis;
- close the whole position at the fixed-R target;
- no Style-C 33/33/34 ladder;
- no 1R partial;
- no 2.5R TP2;
- no runner;
- no trailing stop;
- no house time-stop substitution.

The current SOURCE_FAITHFUL + Style-C refusal is correct **until this exact replacement is executable**. Replace the refusal only when the full source fixed-R contract is present and valid. An unknown/malformed source target continues to refuse rather than falling into Style C.

---

## 9. AR-1075 / AR-1077 WORK ALREADY CLOSED — DO NOT REDO IT

I independently verified the current tree has already moved beyond several AR-1074 findings.

The next seat is not authorized to spend another cycle rediscovering or rebuilding these unless a regression test fails:

- Band C single-run source-risk mode transport;
- SOURCE_FAITHFUL eligibility/confluence bypass;
- E.3 house stop-ceiling bypass;
- E.5 15:55 house flatten bypass;
- E.4 DLL halt bypass;
- max-trades-per-day bypass;
- rollover suppression bypass;
- MES floor exclusion through the existing source branch;
- short source-stop fail-closed guard.

Keep their legacy/overlay controls green.

Walk-forward source-risk transport is **not certified by this ruling**. Do not widen B/C/D/F into walk-forward work before the single-run vertical proof is green.

---

## 10. REQUIRED VERTICAL PROOF — REAL BAND C PATH, NOT COMPONENT GREEN

B/C/D/F is complete only when a deterministic LONG fixture traverses the real route:

```text
persisted compiled_spec
-> Band C main() dispatch
-> SpecConditionStrategy
-> exact per-session OR state
-> close breakout side
-> exact qualifying FVG event
-> third-candle-close entry
-> same-FVG displacement wick stop
-> persisted FIXED_R multiple
-> existing compute_source_fixed_r_target
-> whole-position deterministic exit
-> one auditable trade
```

The AR-1076 harness architecture may be reused. Its legacy-arm positive witness is valuable because it proves the test route is alive before SOURCE_FAITHFUL assertions are interpreted.

### Minimum discriminators / mutations

The final committed proof must make these changes observable:

1. Remove Band C mode ingress -> RED.
2. Wick-only OR breach with close still inside -> NO ENTRY.
3. Close breakout side flips -> source direction flips independently of EMA.
4. Flip EMA slope while breakout/event is fixed -> source event/direction unchanged.
5. Wrong-direction FVG after breakout -> NO ENTRY.
6. Old/pre-breakout FVG -> NO ENTRY.
7. FVG straddling the OR instead of lying outside -> NO ENTRY.
8. Two-FVG anti-hijack: a nearer unrelated FVG cannot own the stop.
9. Move only the qualifying displacement candle wick -> executable stop moves exactly.
10. Move only the FVG gap boundary while displacement wick stays fixed -> stop does not move.
11. Reintroduce house buffer/floor/ceiling on SOURCE_FAITHFUL -> RED.
12. Delete required source stop -> REFUSE, never ATR.
13. Change `r_multiple` 2 -> 3 -> executable target moves from exact 2R to exact 3R.
14. Reintroduce Style-C partials/runner -> RED.
15. Reintroduce +1 entry roll on SOURCE_FAITHFUL -> RED.
16. Same-candle pre-entry high/low cannot trigger a retroactive source exit.
17. Nonzero warmup rows do not move the event/entry/stop/target identity.
18. Incomplete opening-range session creates no source event and borrows no adjacent day's range.
19. Short source stop remains REFUSED.
20. Legacy still uses its old +1 roll and house policies.
21. TF_OVERLAY_VARIANT remains separate from SOURCE_FAITHFUL.

A test that directly constructs the final source map or final trade object is not the load-bearing GREEN. At least one proof must drive the real Band C persisted configuration and let production code produce every object above.

After the doer lands the unit, the requested independent `accuracy-validator` / adversarial grade is appropriate. It should attempt to DISPROVE the vertical GREEN, especially the warmup-index, per-session-OR, same-FVG, and same-candle-entry-order claims.

---

## 11. SOURCE AUTHORITY STATUS

I also searched the connected file/library surface for the exact sVkm entry/stop phrases during this review. The raw `sVkmZklJDHI` transcript itself did not surface as a standalone connected file in that search, so **this ruling makes no new byte-level transcript claim and changes no source semantics from the already-governed AR-1068/AR-1074 authority**.

The current source contract therefore remains:

- breakout side, not EMA, owns direction;
- FVG third-candle completion is the entry event;
- long source stop is the taught wick-inclusive displacement/fair-value candle low;
- short stop remains unresolved/fail-closed;
- target is whole-position fixed 2R for the governed source.

If a new source-semantic contradiction appears during B/C/D/F, stop and bring the exact transcript/hash/span or the already-authorized bounded visual question to the desk. Do not resolve it with trading convention.

---

## 12. NEXT ORDER — NO ROUND TRIP REQUIRED

**NEXT UNIT: B/C/D/F ATOMIC VERTICAL SOURCE-EXECUTION JOIN.**

Shortest correct order inside that unit:

```text
1. Preserve per-session OR state already computed by the existing adapter.
2. Preserve the existing FVGResult/zones instead of collapsing identity to any_active.
3. Build breakout-side SourceEntryEvent per session; keep trigger refusal authoritative.
4. Carry stable decision-bar identity across compute -> warmup strip.
5. Build the source stop map from that same event/zone.
6. Execute entry at that third candle's close, not legacy bar+1.
7. Consume spec.source_risk.target with existing fixed-R primitive.
8. Run the real Band C deterministic long trade.
9. Run the mutation/discriminator set.
10. Independent adversarial grade on DISPROVE.
```

### STOP CONDITIONS

Stop and report rather than widen scope if:

- the production source event cannot be tied to the same OR candidate already proven by MP1/OR handoff;
- preserving exact FVG identity would require a second FVG detector;
- per-session OR levels would require a second opening-range calculator rather than preserving the existing state;
- warmup slicing cannot preserve a unique decision-bar identity;
- the source target contract is absent/malformed on the real persisted sVkm artifact;
- the long entry/stop semantics conflict with new Tier-A source evidence;
- a proposed repair requires silently reopening short authority;
- the deterministic route cannot produce a positive-control trade without bypassing production dispatch.

**No sVkm source-faithful performance/edge backtest yet.** First produce the one exact deterministic LONG trade through the real money path. Then the desk will decide whether the next blocker is short-source resolution or historical source-faithful execution.
