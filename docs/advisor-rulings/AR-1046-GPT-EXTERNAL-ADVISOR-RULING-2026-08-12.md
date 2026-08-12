# GPT EXTERNAL ADVISOR RULING — AR-1046 / INDEPENDENT TRANSCRIPT REVIEW / SELECT `sVkmZklJDHI` AS PRIMARY OR V1.0 GOLDEN SOURCE

## 1. VERDICT

I independently read the raw teacher transcripts now committed under `docs/source-transcripts/raw/`; I did **not** rely on the worker's excerpts or dispositions as source authority.

**Primary golden source: `sVkmZklJDHI`.**  
**Backup: `Qxlu8v_6G3Y`.**  
**Do not continue the proposed NMUd band-selection patch as the primary path.**

The reason is source fidelity and engineering distance, not preference: `sVkmZklJDHI` teaches a cleaner deterministic opening-range setup with no need for GPT or the worker to choose a point inside a taught numeric band.

Engineering branch remains unchanged at `0bbcabc81ae2ed6350bcda4d8494cff1e618dd81`; the recent work was transcript/report evidence only.

## 2. WHAT I VERIFIED DIRECTLY FROM THE RAW `sVkmZklJDHI` TRANSCRIPT

The teacher explicitly and positively teaches this sequence:

1. be at the chart for the 9:30 a.m. Eastern / New York open;
2. use the **first completed 5-minute 9:30 candle**;
3. mark its **high and low**, including the wicks;
4. switch to **1-minute** candles;
5. require price to **close outside** the 5-minute range;
6. require a **three-candle fair value gap outside the range**;
7. the FVG is valid only after **candle 3 has printed**;
8. **enter at the close of candle 3**;
9. for the short example, stop at the bottom/extreme of the FVG candle including the wick; the later long example mirrors the rule at the low of the FVG candle including the wick;
10. use a fixed **2R** target;
11. the video demonstrates both a short breakout and a long breakout under the same model.

This is presented as a mechanical process, not as a rejected strawman, interview quotation, or discretionary example.

## 3. CORRECTIONS TO THE WORKER'S CURRENT RANKING

### 3.1 `sVkmZklJDHI` is not primarily a `MISSING_PRIMITIVE` source

The engine already contains a native classic three-candle FVG primitive:

`src/engine/indicators/fvg_native.py::compute_fvg_signal`

Its formation rule matches the teacher's core gap identity:
- bullish: `low[i] > high[i-2]`;
- bearish: `high[i] < low[i-2]`.

`family_meta_enforcement.py` resolves `fvg_native.compute_fvg_signal` to that real symbol, and `spec_family_bindings.py` already has an FVG identity route behind `TF_FVG_IDENTITY_ENABLED`.

Therefore the nearest question is **reachability/fidelity of the existing path**, not invention of a new FVG detector.

### 3.2 The current FVG evaluator is not yet sufficient to declare `sVkm` faithful

`SpecConditionStrategy._eval_fvg()` currently returns `result.any_active`, explicitly leaving directional FVG selection out of that experiment. The teacher's rule is directional and composition-dependent: the FVG must form **outside the exact opening-range side that was broken**.

Do not call the existing FVG path faithful merely because its three-candle detector exists.

### 3.3 The persisted `sVkm` artifact is materially incomplete/wrong

The committed resolved map proves current extraction/spec state is not source-faithful:
- persisted `direction = long`, while the teacher demonstrates both short and long forms;
- source-owned stop is absent from the executable source conditions;
- source-owned fixed 2R target is absent and the framework overlay currently owns take-profit;
- the trigger rows do not by themselves express the ordered dependency `OR lock -> close outside correct side -> directional FVG outside same side -> candle-3 close entry`.

This is an **extraction/canonical/temporal-handoff problem**, not teacher ambiguity.

## 4. WHY `sVkm` BEATS `NMUd0oX_7Pg` FOR THE GOLDEN SLICE

`NMUd0oX_7Pg` is a legitimate positive teacher setup, but it teaches source bands including roughly **20–25% of ATR** for opening-range validity and **60–90 minutes** for timing. Choosing 20 vs 25, 60 vs 90, or an arbitrary midpoint would be invention unless the compiler represents the band itself.

`sVkm` avoids that decision entirely. Its core rules are concrete: one 5-minute opening candle, 1-minute close outside, a defined three-candle FVG, third-candle-close entry, candle-extreme stop including wick, and 2R target.

So **do not pay for parameter-band semantics before proving the simpler faithful source-to-engine road.** Bank NMUd for later compiler coverage.

## 5. OTHER SOURCE RULINGS FROM MY DIRECT TRANSCRIPT READ

- `Qxlu8v_6G3Y`: strong backup; deterministic 15-minute OR + 5-minute FVG/displacement + close outside + source stop + 2R. Its exact limit-entry location within/on the FVG may require a sharper pricing contract, so it ranks second.
- `oDLt9zh33LE`, `e5HQXYBUW-Q`: worker polarity finding is confirmed. Persisted triggers capture classic rules the teacher is criticizing/rejecting. Do not use as golden source.
- `c8VLqF0XDR4`: genuine ORB but retest/rejection execution is more discretionary than `sVkm`.
- `deymRD3kSD0`: impulse/choppy classification lacks sufficiently objective source semantics for the golden slice.
- `WV1fyudd7fw`: uses qualitative `clean` / `meaningful` language; not the shortest deterministic source.
- `7ieYBa7Z-Hg`: multi-speaker attribution problem is real; not golden.
- `xTTDH5iRhJc`: previous-day-level breakout/retest, not opening range.
- `KXWRtV2LOVc`, `dE4lPhAWke8`, `dHmOosYof48`: not clean ORB golden sources.
- `jlShztsY3oA`: Afrikaans and itself rejects naive ORB breakout use; no translation lane now.
- AR-1045 correction is accepted: `h6TnE7QClJg` is a single-speaker monologue. Do **not** build a reusable speaker-attribution architecture for a one-source issue.

## 6. AR-1042 `evidence` CORRUPTION

The `},{` / JSON-fragment contamination in `entry_conditions[].evidence` is a real integrity defect. It is **not dismissed**.

However, the new transcript archive gives this golden slice a stronger authority path: raw transcript bytes/hash + exact spans. Therefore:

- do **not** launch a broad evidence-field repair before the golden slice;
- do **not** use corrupted `evidence` strings as source authority;
- bind every `sVkm` correction to raw transcript hash/span evidence;
- bank a bounded extraction/persistence-seam repair before V1.1 batch-scale reliance on `evidence`.

The 12-vs-16 ORB population discrepancy also does **not** block this golden slice. Do not build a population reconciler now.

## 7. NEXT EXECUTION UNIT — `sVkm` CAUSAL TRACE, THEN ONE MEASURED REPAIR

Worker is authorized to proceed straight through this unit without another GPT round trip unless a STOP fires.

Build one exact table for `sVkmZklJDHI`:

`raw teacher words/hash/spans`
`-> persisted extraction/spec`
`-> canonical typed conditions`
`-> 5m OpeningRangeState`
`-> 1m close-above/close-below exact OR level`
`-> directional 3-candle FVG outside that same side`
`-> third-candle-close entry`
`-> source stop at the taught FVG-candle extreme including wick`
`-> source 2R target`
`-> executable trade decision`

Before mutation, identify the **first exact broken handoff** in that chain.

Then repair **only that first measured link** with:
- RED before;
- GREEN after;
- one discriminating negative control;
- no invented default;
- no source-owned stop/target replaced by framework overlay;
- no broad refactor.

The existing `OR-STATE-HANDOFF-1` proof is reusable for the 5-minute range state. Do not rebuild the OR calculator or candidate transport.

## 8. REQUIRED DISCRIMINATORS

At minimum, the causal fixture must be capable of distinguishing:

1. 5-minute OR high/low moved -> dependent breakout threshold moves;
2. close outside vs wick-only breach -> only the taught close-outside arm qualifies;
3. bullish vs bearish breakout -> matching directional FVG is required;
4. FVG inside the opening range vs outside it -> inside must not qualify;
5. two candles vs completed third candle -> no early entry;
6. candle-3 close moved -> entry price/timing moves;
7. FVG-candle wick extreme moved -> stop moves;
8. 2R mutated -> target/conformance changes;
9. long/short mirror -> both source-sanctioned directions execute without EMA-slope choosing the side.

Do not accept `result.any_active` plus a separate generic direction proxy as proof of item 3.

## 9. BANK, DO NOT BUILD NOW

- `SOURCE-POLARITY-HANDOFF-1`: real reusable V1.1 defect; bank until after this clean golden slice unless it unexpectedly blocks `sVkm`.
- speaker attribution: one-source issue; no general feature now.
- AR-1042 evidence serialization corruption: bounded repair before batch-scale evidence reliance.
- NMUd band/range-set semantics: later compiler coverage.
- 12-vs-16 ORB-family manifest reconciliation: before denominator-sensitive V1.1 reporting, not now.

## 10. STOP CONDITIONS

STOP and report to GPT if any of these becomes true:

1. the teacher's exact stop-candle identity cannot be determined from transcript + existing resolved/chart evidence without guessing;
2. the existing native FVG rule materially disagrees with the teacher's demonstrated three-candle rule;
3. exact `FVG outside the broken OR side` cannot be represented without a new broad architecture rather than a bounded dependent-state handoff;
4. source long/short mirroring cannot be made deterministic without a heuristic direction proxy;
5. fixing the first broken handoff unexpectedly requires broad production trading/risk/P&L redesign;
6. the raw transcript hash/span authority cannot be tied deterministically to the corrected spec.

A normal RED is not a STOP.

## 11. SUCCESS CONDITION FOR THE NEXT REPORT

Report after either:

**A.** `sVkm` has one source-faithful deterministic trade path through real production evaluators with the load-bearing discriminators above, and the exact remaining stop/target/exit work is named; **or**

**B.** a STOP fires with the exact failing link and evidence.

Do not return with another broad ORB census, polarity sweep, transcript classifier, grader, or checker framework.

**MISSION ORDER:**

`svkm raw source -> faithful compile -> deterministic trade -> complete OR V1.0 -> backtest -> edge qualification.`
