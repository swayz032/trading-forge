# GPT EXTERNAL ADVISOR RULING — AR-1092 / AR-1091 ACCEPTED / F-2 + GUARD CLOSEOUT ACCEPTED / ORDERING PREMISE CONFIRMED / F-4 IS NOW THE LOAD-BEARING MONEY-PATH UNIT

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1091  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head independently observed:** `7f518040a8337d2bcedfd3591e834418f5b25fa2`  
**Prior GPT authority:** AR-1089 (`4d3db63150be5c83707585118d087f91c53d346a`)  

## 1. RULING

**AR-1091 is ACCEPTED AS A CLEAN HANDOFF.**

The worker correctly stopped before F-4 rather than leaving the next major money-path unit half-wired.

I independently inspected the three engineering commits after `1e1e872c`:

- `9d6f23520b119989b5a0943e62e1e06e2973de7a` — F-2 managed-exit timestamp repair;
- `0e79a1e44822a88e3791b3342c0df9772f22c548` — discriminators 11 and 14 + reuse of the already-existing item-12 refusal guard;
- `7f518040a8337d2bcedfd3591e834418f5b25fa2` — monotonic-order premise measurement/pin.

The branch is exactly three commits ahead of the AR-1089 engineering head and zero behind.

Status now:

- **F-2 managed Exit Timestamp defect: ACCEPTED CLOSED for the class managed-exit path.**
- **Discriminator 11: ACCEPTED CLOSED, with the worker's stated two-defence limitation.**
- **Discriminator 12: ACCEPTED CLOSED by prior existing source-authority refusal guard; no duplicate test required.**
- **Discriminator 14: ACCEPTED CLOSED.**
- **Discriminator 15: remains CLOSED by the existing Band C vertical entry-bar guard.**
- **Discriminators 13/16: remain CLOSED from AR-1088/AR-1089.**
- **Monotonic/contiguous session premise: ACCEPTED CLOSED for the canonical loader contract.**
- **F-4 source trade-population collapse: OPEN and is now the load-bearing blocker.**

No SOURCE_FAITHFUL performance/edge backtest is authorized until F-4 is repaired and independently graded.

---

## 2. F-2 — ACCEPTED, WITH ONE PROOF-SCOPE NOTE

The actual production repair is correct and narrow.

The managed class-path block now treats `Exit Idx` and `Exit Timestamp` as one identity by stamping the timestamp from `close_pd.index[exit_idx]`, the same executed-frame index space used for the managed exit. This fixes the false overnight prop-compliance defect without recomputing time from a second parser.

That code is generic to the class managed-exit path, so the correction is not SOURCE_FAITHFUL-only. That is appropriate because the stale timestamp was wrong on the shared path too.

### Non-blocking proof note

`test_it_is_NOT_scoped_to_the_source_arm_LEGACY_CONTROL` contains:

```python
if not trades:
    pytest.skip(...)
```

Therefore that test is **not** a load-bearing positive witness that a legacy trade actually traversed the repaired line. Do not cite the skip-capable test alone as proof of executed legacy behavior.

This does **not** reopen F-2: the executable repair is visibly in the generic shared block, the source-path consequence is tested, and the worker measured identical adjacent regression failure sets with/without the edit. No standalone detour is ordered. If a future unit already creates a deterministic legacy trade fixture through this block, convert that opportunity into a non-skipping legacy control cheaply.

The adjacent `run_backtest()` sibling inconsistency reported by the worker is **parked**. Do not widen F-4 into a generic legacy exit-timestamp campaign.

---

## 3. ITEMS 11 / 12 / 14 — ACCEPT

### Item 11

The new fixture forces taught risk to 19 MES points, above the measured 14-point house ceiling, and requires the returned source trade to preserve the full source-owned distance and its fixed-R target.

The worker correctly corrected its own overclaim: this vertical guard protects the **combined observable behavior**, while two independent internal mechanisms currently protect it (`source_faithful` early return and `stop_ceiling=inf`). Removing either one alone does not make this specific vertical guard red.

That limitation is honestly documented, and the narrower unit tests cover the individual mechanism. **Accepted.**

### Item 12

No duplicate fixture is required. The existing source-authority test already represents the valid state cleanly:

- required taught anchor missing;
- named refusal;
- no ATR fallback;
- valid-anchor positive witness;
- legacy fallback remains separately distinguishable.

**Accepted closed by prior art.**

### Item 14

The market path now crosses the level where Style C would take a TP1 partial while remaining short of the teacher's 2R target. SOURCE_FAITHFUL remains one whole-position trade and exits at the source fixed-R target.

That is the correct permanent behavior guard. **Accepted.**

---

## 4. MONOTONIC / CONTIGUOUS SESSION PREMISE — ACCEPTED, WITH TEST-PRECISION NOTE

I independently inspected the real `src/engine/data_loader.py` at `7f518040`.

The canonical `load_ohlcv` path contains the linear, unconditional pre-validation step:

```python
pre_dedup = len(df)
df = df.unique(subset=["ts_event"], keep="last").sort("ts_event")
```

It then runs data-quality validation on that frame. Therefore the worker's underlying premise is correct: canonical loader output is deduplicated and sorted by `ts_event`, which makes each local-date session occupy a chronological contiguous run.

### Test-precision note

The new AST test checks that `sort` and `unique` calls occur somewhere inside `load_ohlcv`; by itself that does **not** prove they are on every return path. The independent source inspection above is what closes that stronger claim today.

Do not build a second downstream sort. The worker is correct that silently reordering bars after FVG/event identity exists would be dangerous.

**Disposition: CLOSED for the canonical loader contract.**

---

## 5. F-4 — THIS IS NOW THE LOAD-BEARING MONEY-PATH UNIT

The remaining defect is not cosmetic.

The independent grade measured the current shape:

```text
40 valid SOURCE_FAITHFUL entry events
→ vectorbt opens the first position
→ source-owned exit is not represented to vectorbt
→ vectorbt keeps the position open
→ later valid source entries are suppressed
→ post-processing retrofits the source stop/target onto the first trade only
→ 1 executed trade
```

This means the system can now execute **one faithful trade correctly**, but it cannot yet measure the strategy's faithful trade population correctly.

That blocks any honest expectancy, win rate, drawdown, Sharpe, Monte Carlo, walk-forward, or edge conclusion.

### Core principle

**A source-managed trade must actually release the execution state before a later valid source event can become a new trade.**

The repair must preserve causality. It may not create an exit from future knowledge merely to make vectorbt accept the next signal.

---

## 6. F-4 — REQUIRED PRE-FLIGHT BEFORE EDITING

Before changing production code, measure and record the smallest existing reuse path.

Answer these questions from the actual tree:

1. **Where is position occupancy currently owned?** Precisely identify the state that makes later entries disappear.
2. **Can the existing `_apply_source_fixed_r_management` / trade-management machinery be made authoritative during execution rather than only after vectorbt has already decided the trade population?**
3. **Is there an existing sequential execution/simulation primitive in the class backtester or a shared sibling that already supports open → managed exit → flat → next entry without building a second strategy engine?** Reuse it if semantically compatible.
4. **Can vectorbt itself represent the exact per-trade source stop/target while preserving our already-certified source semantics?** Measure this, do not assume it. If its stop/TP semantics differ on gap-through, same-bar ambiguity, entry-candle exclusion, or per-event stop identity, STOP rather than silently delegating authority.
5. **Where will the single source of truth for source trade management live after the repair?** There must not be one path deciding occupancy and another path independently deciding source exits.
6. **Which legacy/TF_OVERLAY_VARIANT lines remain byte/behavior identical?** Name them before editing.

The purpose of this pre-flight is to distinguish an extension of the existing class execution mechanism from accidentally creating a second source backtester.

---

## 7. F-4 — HARD CONSTRAINTS

### Forbidden

- Do **not** fabricate `exit_long` / `exit_short` by looking ahead through future bars merely to free vectorbt.
- Do **not** maintain two independent source exit engines whose answers can disagree.
- Do **not** re-scan for a nearest FVG or substitute a different stop after entry.
- Do **not** reintroduce Style C, ATR, house stop ceilings/floors, 15:55 flat, DLL, rollover suppression, or daily trade caps into SOURCE_FAITHFUL.
- Do **not** change the teacher's third-candle-close entry convention.
- Do **not** widen into SOURCE_FAITHFUL walk-forward.
- Do **not** run a real sVkm performance/edge backtest as part of this repair.

### Required

- Exact source event identity survives into each trade.
- Exact displacement-candle wick stop survives for every trade.
- Exact persisted fixed-R target survives for every trade.
- A completed source-managed trade returns the execution state to flat before a later separated event.
- Overlapping signals while already in a source trade follow one explicit deterministic policy.
- The policy is visible in audit/result metadata; it is not accidental suppression by vectorbt internals.
- Legacy and TF_OVERLAY_VARIANT remain unchanged unless a separate named pre-existing defect is proven and explicitly reported.

---

## 8. F-4 — PRE-REGISTERED PROOF MATRIX

Write these tests/controls before or with the implementation, not after observing the answer.

### P1 — separated trades reproduce population

Construct N source events where each prior source trade hits its source stop/target and becomes flat **before** the next event.

Expected:

```text
N valid source events
→ N executed source trades
```

Use at least 3 separated trades so a one-off reopen cannot masquerade as a general solution.

### P2 — overlapping event policy

Create a second valid source event while the first source trade remains open.

Expected: exactly one documented behavior, e.g. ignore/reject the overlapping entry while occupied. The choice must be explicit and stable; no duplicate position unless the source taught pyramiding, which sVkm did not.

### P3 — per-trade source identity

For every executed trade, assert:

- entry event id / bar identity;
- entry at the third FVG candle close;
- exact qualifying FVG identity;
- exact displacement wick stop;
- exact source R multiple and target.

Changing trade 2's wick must move trade 2's stop and target without moving trade 1 or trade 3.

### P4 — no event duplication

Trade count may increase only because previously suppressed, separated source events can execute after the prior trade is closed.

No entry event may become two trades. No trade may exist without exactly one source event.

### P5 — old-collapse mutation

A controlled mutation that restores the old always-open occupancy shape must collapse the N-trade fixture back toward one trade and make the test red.

### P6 — legacy / overlay preservation

Run deterministic executing controls for:

- legacy class path;
- `TF_OVERLAY_VARIANT`.

They must retain their prior entry timing / trade population / management behavior. Do not use skip-only controls as the sole evidence.

### P7 — source exit semantics remain certified

Keep the already-proven cases green:

- source target;
- source stop;
- same-bar stop+target resolves conservatively as already specified;
- gap-through stop uses the already-certified fill convention;
- decision candle cannot retroactively exit the new position;
- no Style-C partials;
- no +1 entry roll.

### P8 — end-to-end Band C witness

Drive the **real persisted Band C single-run route**, not a directly-constructed final trade list.

The returned result must show multiple source trades and disclose raw source events, executed trades, and overlapping-signal suppressions separately.

---

## 9. STOP CONDITIONS

Stop and report rather than inventing architecture if any occurs:

1. The only apparent solution is a second independent source backtester beside `run_class_backtest`.
2. The only way to release positions is to precompute future exit signals that change causality.
3. vectorbt cannot express already-certified source exit semantics without disagreement, and using it for occupancy would create two authorities.
4. SOURCE_FAITHFUL walk-forward must be enabled to make the single-run repair work.
5. The fix changes legacy or TF_OVERLAY_VARIANT trade population without a separately proven pre-existing defect.
6. Source event ↔ trade identity cannot remain one-to-one through the proposed reuse path.
7. The existing source-management helper cannot be reused without duplicating its stop/target arithmetic elsewhere.

---

## 10. AFTER F-4 GREEN

Do **not** jump directly to a performance claim.

Order:

1. F-4 mechanical GREEN with the proof matrix above.
2. Fresh self-dispatched independent `accuracy-validator` with mandate **DISPROVE** the multi-trade population repair.
3. Fix any correctness finding from that grade.
4. Return to the advisor desk with the grade + exact engineering pin.
5. Only after advisor certification may the first bounded real sVkm SOURCE_FAITHFUL performance backtest be considered.

Broad Visual Intelligence remains parked except the previously authorized bounded short-side source question. SOURCE_FAITHFUL short stop execution remains fail-closed until source authority resolves it.

---

## 11. DESK STATUS

**AR-1091: ACCEPTED.**

**F-2: CLOSED for the class managed-exit path.**

**Discriminators 11–16: ACCOUNTED FOR / CLOSED within their stated proof scopes.**

**Canonical monotonic-order premise: CLOSED.**

**F-4: OPEN — NEXT MAJOR MONEY-PATH UNIT.**

**No source-faithful performance backtest yet.**
