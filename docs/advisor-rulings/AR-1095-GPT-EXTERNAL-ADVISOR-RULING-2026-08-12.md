# GPT EXTERNAL ADVISOR RULING — AR-1095 / AR-1094 WORKER GREEN ACCEPTED CONDITIONALLY / F-4 ARCHITECTURE APPROVED / SIZING-INGRESS DEFECT FOUND / PERFORMANCE STILL BLOCKED

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker reports:** AR-1093 + AR-1094  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Worker F-4 pin:** `45e4ca840c45762b68569d31c4b246352377b21e`  
**Observed engineering branch head during review:** `055f7c698c33161c7bcb7da8dcc538041b965ca4`  
**Prior GPT authority:** AR-1092 (`fb4e9ce9fb8501d1f94594a6122d3549b7b43068`)

## 1. RULING

**AR-1094 is ACCEPTED AS WORKER-GREEN, NOT YET FINAL-CERTIFIED.**

The F-4 repair is architecturally sound in the inspected tree:

- the source-managed exit arithmetic was extracted once into a shared resolver;
- a pre-vectorbt SOURCE_FAITHFUL occupancy pass now writes source-owned exits into the signal arrays;
- later separated source events can therefore execute after the prior source-managed position closes;
- the same shared resolver remains the post-portfolio pricing authority;
- vectorbt was not given independent stop/target authority;
- legacy and `TF_OVERLAY_VARIANT` do not enter the new SOURCE_FAITHFUL occupancy branch;
- the worker's P1/P3/P4/P5 proof shapes are materially meaningful, including the controlled mutation that restores the old 3->1 collapse.

This is the correct repair direction. **Do not replace it with a second source backtester or delegate source exits to vectorbt.**

However, the independently dispatched F-4 grade has not yet been published in the inspected branches. Therefore F-4 is **mechanically GREEN / awaiting independent final grade**, not performance-certified.

No SOURCE_FAITHFUL performance/edge claim is authorized yet.

---

## 2. MATERIAL CORRECTION TO AR-1094 §5 — THE 1→15 CONTRACT SWING EXPOSES A REAL SIZING-INGRESS DEFECT

The worker correctly states the ownership principle:

> source owns the taught entry/stop/target; Trading Forge owns capital allocation / position sizing.

But the conclusion **"this is not a defect" is incomplete for the actual Band C fixture that produced the 1→15 sizes.**

I independently inspected the persisted vertical configuration. It explicitly carries:

```text
strategy.fixed_contracts = 1
```

in `src/engine/tests/test_source_band_c_vertical.py::_config()`.

I then inspected the real Band C single-run dispatch. Its call to `run_class_backtest(...)` passes source-risk mode, commission, firm key, exit engine, etc., **but it does not pass `fixed_contracts` at all.**

Inside `run_class_backtest`, the sizing rule is:

```text
if fixed_contracts is not None:
    fixed sizing
else:
    PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500.0)
```

Therefore the measured:

```text
trade 1 Size=1
trade 2 Size=15
trade 3 Size=15
```

is not proof that the intended Trading Forge scaling plan ran. It is proof that **Band C ignored an explicit persisted fixed-size instruction and fell through to the class backtester's default ATR sizing.**

**Disposition: NEW MONEY-PATH DEFECT — `BAND-C-SIZING-INGRESS-1`.**

This must be corrected before any P&L / expectancy / Sharpe / drawdown number from the source-faithful path is interpreted.

---

## 3. OWNERSHIP RULE — KEEP STRATEGY SEMANTICS AND CAPITAL SCALING ORTHOGONAL

The architecture is now:

### A. Source strategy semantics

`SOURCE_FAITHFUL` owns/preserves:

- source entry;
- source direction rule;
- taught source stop;
- taught source target / management;
- source trade population / overlap policy.

### B. Trading Forge capital allocation

Trading Forge owns:

- contract quantity / micro quantity;
- account-level risk budget;
- scaling up/down;
- portfolio / account exposure limits;
- downstream prop/account execution constraints.

**Sizing must not rewrite the source entry, stop or target.**

Do not solve the current issue by reclassifying the teacher strategy as `TF_OVERLAY_VARIANT` merely because Trading Forge later chooses contract quantity. Risk/exit semantics and capital allocation are separate axes.

Prefer an explicit additive sizing ownership contract / audit surface rather than overloading the strategy-fidelity mode. Minimum truthful fields should make it possible to answer:

```text
strategy_semantics_mode = SOURCE_FAITHFUL | TF_OVERLAY_VARIANT
sizing_owner = FIXED_RESEARCH | TRADING_FORGE
sizing_mode / sizing_plan_id
requested_contracts or requested risk budget
executed_contracts
```

Do not invent a broad new sizing subsystem if an existing persisted scaling-plan contract already exists. Search and reuse prior art first.

---

## 4. TWO SEPARATE RESULT SURFACES ARE REQUIRED

### Surface 1 — EDGE / FIDELITY BENCHMARK

Purpose: answer **"does the strategy itself have edge?"**

Use a normalized, explicit size so capital scaling cannot manufacture the answer.

For the current sVkm proof/backtest, the smallest clean benchmark is:

```text
1 micro / 1 fixed contract per accepted source trade
```

or another already-governed normalized research size if one exists.

The key requirement is not the number `1`; it is that the size is **explicit, stable and provenance-stamped**, not an accidental dynamic fallback.

Report strategy geometry in size-independent terms too:

- trades;
- R outcomes;
- win/loss sequence;
- expectancy in R;
- stop/target fidelity;
- MAE/MFE where applicable.

### Surface 2 — TRADING FORGE SIZING / SCALING

Purpose: answer **"how should Trading Forge deploy this edge across capital/accounts?"**

Only after the strategy benchmark is honest, apply the actual Trading Forge scaling plan as a separate capital-allocation run.

This is where contract/micro scaling belongs.

**Do not call the current implicit `$500 dynamic_atr` fallback the Trading Forge scaling plan unless the persisted plan explicitly says that it is.**

---

## 5. NEXT AUTHORIZED UNIT — `BAND-C-SIZING-INGRESS-1`

This should be small and surgical.

Before editing, inventory the already-existing sizing/scaling contracts and determine which persisted field is authoritative at Band C.

For the current fixture, prove at minimum:

1. persisted `strategy.fixed_contracts=1` reaches the real Band C `run_class_backtest` call;
2. returned trades are all size 1 on the 3-session source fixture;
3. changing only the persisted fixed size from 1→2 moves only quantity/P&L, not entry, stop, target, event count or exit reason;
4. removing the fixed-size command invokes the explicitly documented fallback path rather than silently pretending a scaling plan was supplied;
5. legacy / overlay behavior is unchanged except where the same previously-ignored persisted sizing command is intentionally corrected and disclosed;
6. the returned result exposes which sizing owner/mode actually ran.

**Do not hard-code one contract inside the source strategy.** The correction belongs at the Band C sizing ingress / execution boundary.

After this is green, re-run the F-4 three-trade fixture under explicit fixed research sizing so every trade's strategy P&L is comparable.

---

## 6. F-4 NOVEL ATTACK REQUIRED BEFORE FINAL CERTIFICATION — EXIT-BAR RE-ENTRY BOUNDARY

I found one boundary the current worker matrix does not appear to settle.

`_apply_source_faithful_occupancy` suppresses a new source event when:

```text
i <= occupied_until
```

That includes an event on the **same bar that closes the prior source trade**.

For sVkm, a new source entry is defined at the decision candle **close**. A prior trade whose stop/target was touched during that same bar may already be flat by that close. Whether a new close-entry is allowed on that exact exit bar is therefore an execution-ordering question, not merely an occupancy count.

Before F-4 is called final, require one bounded test / explicit policy:

- prior trade exits on bar `k`;
- a valid new source entry also exists at bar `k` close;
- prove whether the system intentionally accepts or rejects it;
- disclose that policy in audit metadata;
- do not let vectorbt's implicit same-bar conflict convention decide source semantics silently.

If the source does not teach re-entry and the bar ordering cannot be resolved from the available bar model, fail closed / disclose the conservative policy rather than inventing a favorable same-bar fill.

This is a bounded discriminator, not authorization for a new intrabar simulator.

---

## 7. GRADE / PERFORMANCE ORDER

Order from here:

1. receive and inspect the independent F-4 DISPROVE grade;
2. close any grade finding plus the exit-bar re-entry boundary above;
3. close `BAND-C-SIZING-INGRESS-1`;
4. rerun the source-faithful deterministic population at explicit normalized research size;
5. only then authorize the first honest sVkm source-faithful performance backtest;
6. after source edge is measured, run Trading Forge sizing/scaling as a separate capital-allocation layer;
7. source-faithful walk-forward remains refused until separately certified.

No broad visual work or library-scale campaign should interrupt these steps.

---

## 8. DESK STATUS

**AR-1094:** ACCEPTED AS WORKER-GREEN / FINAL GRADE PENDING.  
**F-4 architecture:** ACCEPTED.  
**F-4 final certification:** PENDING independent grade + exit-bar boundary.  
**New defect:** `BAND-C-SIZING-INGRESS-1` — OPEN.  
**Trading Forge sizing ownership:** CONFIRMED as capital-allocation/scaling authority, separate from source strategy semantics.  
**Source-faithful performance backtest:** NOT YET AUTHORIZED.
