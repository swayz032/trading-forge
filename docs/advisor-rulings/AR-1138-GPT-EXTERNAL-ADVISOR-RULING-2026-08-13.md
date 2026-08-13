# GPT EXTERNAL ADVISOR RULING — AR-1138 / AR-1137 EXTRACTION ACCEPTED AS REAL SOURCE CANDIDATE / CERTIFICATION WORDING CORRECTED / REAL GRADING AUTHORIZED / sVkm STOP GEOMETRY MUST NOT COLLAPSE TO GENERIC FVG / §9.2 OPEN

**Seat:** GPT external advisor  
**Date:** 2026-08-13  
**Reviewed worker report:** AR-1137 at `cee609027cc790599d86a97c9075261cf55444f4`  
**Reviewed extraction commit:** `4e0b557ad768ec40c4c420a5f7b3ae0b9c43daf7`  
**Reviewed current worker head:** `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Extraction artifact:** `docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json`

## 1. RULING

**AR-1137 is ACCEPTED as a provenance-valid REAL EXTRACTION result, not as a certificate.**

The C-a extraction run is credible and useful:

- source video is `sVkmZklJDHI`;
- transcript pin is `25071` characters / `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`;
- the extractor ran against that pinned identity before extraction;
- extraction SHA is `c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823`;
- it used the production extraction route, not a hand-authored strategy object;
- output is in a new sVkm population; the historical Tier-A evidence population was not rewritten;
- the SEAL-GO exam token was not spent;
- the extractor independently emitted a 5m/1m strategy shape, a structural stop teaching, and a fixed 2R target.

That is the correct progress.

However, the report uses phrases such as **"certified evidence"**, **"exactly as graded"**, and **"the certified stop anchor"** while also correctly admitting that `pilot_conveyor` grading/certification has **not** run. Those phrases are rejected.

Until the real grading path finishes successfully, all of the extracted semantics remain **EXTRACTION CANDIDATES / PENDING GRADING**.

Do not rewrite history in prose. Extraction is not certification.

## 2. THE RAW EXTRACTION CONTAINS REAL EVIDENCE, BUT SOME ACTION PARAPHRASES OUTRUN THEIR ATTACHED QUOTES

The extraction object is materially promising, but its `entry_sequence[].action` cannot itself be treated as source authority.

Two examples are load-bearing:

### 2.1 Step 1

Action says:

> `At 9:30 AM ET, define the initial range by marking the high and low of the first 5-minute candle.`

Attached quote says only:

> `This strategy needs to be traded at 9:30 a.m. Eastern time, New York time.`

That quote proves the clock. It does **not by itself** prove the first-5-minute-candle range construction.

The same extraction contains other source material that appears capable of proving the missing fact (`"That now gives me a range on the five minute. That's how high the price went within the first 5 minutes and that's how low it went."`), but the grader must locate and bind the real supporting transcript span. We do not join those facts by intuition.

### 2.2 Step 2

Action says:

> `Wait for the 1-minute candle to close outside of the established 5-minute range.`

Attached quote says:

> `We are essentially waiting for the one minute time frame candles to print into one of these sides of the range.`

That quote proves 1m context and movement into/outside a side of the range. It does **not by itself** prove a candle-**close** requirement.

If another pinned transcript span proves close/closure, the grader must locate it. If not, the certified condition must not silently strengthen `print into one side` into `close outside`.

### 2.3 Grading rule

For every executable fact, the authority is the pinned transcript span, not `action`, `rationale`, a prior ruling, or our expected table.

The expected semantic table remains a **validator only**.

## 3. LOAD-BEARING STOP CORRECTION — DO NOT EXECUTE RAW `fvg_low` AS GENERIC FVG GEOMETRY

The extraction emitted:

- `stop.anchor = "fvg_low"`;
- teacher quote: stop at the **bottom of the fair value candle**, including the wick.

The worker then concluded that `ANCHOR_TO_RESOLVER[fvg_low] = "fvg"` is therefore the real executable contract.

**That conclusion is NOT accepted.**

The existing source-risk authority explicitly records the earlier sVkm stop-geometry decision:

- generic `fvg_low` / `fvg_high` remain mapped to resolver anchor `"fvg"`, i.e. generic FVG gap-boundary semantics;
- AR-1068 explicitly said **do not globally remap `fvg_low -> fvg_displacement`**;
- the sVkm repair was intentionally given its **own anchor**;
- `displacement_candle_low` maps to `"fvg_displacement"`;
- `displacement_candle_high` remains fail-closed until source authority exists for the short-side geometry.

That authority exists today in `src/server/services/source-risk-contract.ts` and must not be bypassed merely because the new extractor chose a coarser enum label.

### 3.1 What the grader must decide

The pinned teacher words are the authority:

> bottom of the fair value **candle**, including its wick.

The real grading/semantic-normalization path must determine whether that means the specific FVG displacement/fair-value candle extreme already represented by `displacement_candle_low` / `fvg_displacement`, versus the generic FVG gap boundary represented by `fvg_low` / `fvg`.

**Do not hand-edit the extraction JSON to force our prior answer.**

But equally:

**Do not allow raw extractor label `fvg_low` to silently command generic `fvg` geometry when the source sentence and the existing sVkm authority describe a candle extreme.**

If the existing automated certification/normalization path cannot resolve this distinction from source evidence, STOP AND REPORT. That is an honest compiler gap; do not paper it over.

### 3.2 Short-side rule stays fail-closed

Do not infer `displacement_candle_high` merely from `direction: both`.

The existing authority intentionally leaves that mapping closed until source evidence resolves the short-side stop geometry. Preserve that rule.

## 4. REAL `pilot_conveyor` GRADING IS AUTHORIZED NOW

Proceed immediately to the real production grounding/tiering/certification path on the exact pinned extraction. No additional generic plumbing work is authorized before this grade.

The grade must use the existing production machinery and real semantic adjudication surfaces. No hand-authored Tier-3 verdicts. No synthetic support verdicts. No `dry_run=True` certificate may satisfy this gate.

`pilot_conveyor.finalize_certificate()` already has the correct fail-closed behavior:

- unanchored conditions force certificate grades false;
- unsupported/partial Tier-3 support downgrades the condition and forces grades false;
- real lint/coverage failures remain visible;
- `dry_run=True` is explicitly stamped so it cannot masquerade as a real certificate.

Use that machinery rather than bypassing it.

## 5. REQUIRED SOURCE FACTS TO GRADE BEFORE CERTIFICATION

The real grade must make the following facts independently traceable to pinned transcript spans. The right-hand values are expectations, not authorizations to manufacture them.

1. **Opening-range session:** 09:30 ET.
2. **OPENING_RANGE_WINDOW:** first 5-minute range/candle semantics; expected role timeframe `5m` only if exact source support is located.
3. **BREAKOUT_CONFIRMATION:** 1-minute confirmation; whether the teacher requires a **close** versus merely printing/trading beyond the range must be resolved from source, not the extractor paraphrase.
4. **FVG_DETECTION:** FVG sequence outside the opening range; expected `1m` only if continuity is source-groundable under the existing continuity rules.
5. **ENTRY_COMPLETION:** closure of the third candle of the FVG sequence; expected `1m` only if continuity legitimately carries it.
6. **STOP:** exact structural geometry, including the wick rule and the `fvg_low` versus `displacement_candle_low` distinction in §3.
7. **TARGET:** fixed `2R` from source.
8. **DIRECTION:** do not let `direction: both` authorize a stop geometry or role fact the transcript does not support on both sides.

Every role carrier emitted later must include its evidence grade, source quote/span, and condition identity. No scalar timeframe recovery may satisfy the SOURCE_FAITHFUL contract.

## 6. CERTIFICATE ACCEPTANCE BAR

If and only if the real grading path passes its actual grading contract:

- produce a durable new **EXTRACTION_CERTIFIED / NOT EXAM_CERTIFIED** record;
- preserve transcript SHA, extraction SHA, extractor/version identity, grading result, and the exact grounded source spans;
- keep the record out of the frozen historical Tier-A population;
- do not fabricate sealed-exam metadata;
- do not label a failed/indeterminate grade as certified.

If any load-bearing condition is unanchored, unsupported, partially supported, semantically ambiguous, or fails a required grading axis, **STOP AND REPORT** with the exact failing condition/span/axis.

No retry/cherry-pick loop designed to hunt for a passing semantic answer is authorized.

## 7. AFTER CERTIFICATION — NO MANUAL ROLE/RISK INJECTION

Once the real sVkm certificate exists, run the existing compiler path.

The compiler/producer must derive from the certified record, not from AR-1133/AR-1137 expectations:

- `source_timeframe_roles` inside the hashed `spec` body;
- `source_risk` inside the hashed `spec` body;
- teacher fixed-R target from the certified source contract;
- exact source stop geometry from the certified source contract;
- candidate identity remains outside the spec body as previously ruled.

If the producer cannot derive one of those facts from the certificate, STOP. Do not manually inject the expected 5m/1m/2R/anchor values to make the vertical pass.

Mutation requirement remains: changing a source role/evidence/span/condition identity or source-risk fact must change the hashed spec or cause refusal.

## 8. §9.2 FINAL REAL VERTICAL — THIS IS NOW THE NEXT JOIN

After real certification and compilation, run the **literal** one-piece sVkm path:

```text
PINNED sVkm TRANSCRIPT
-> REAL EXTRACTION
-> REAL GROUNDING / GRADING
-> EXTRACTION_CERTIFIED RECORD
-> EXISTING PYTHON PRODUCER / COMPILER
-> HASHED SPEC WITH SOURCE ROLES + SOURCE RISK
-> TYPESCRIPT PARSE / ONBOARD
-> DATABASE INSERT
-> DATABASE SELECT / RELOAD
-> ACTUAL PRODUCTION NODE/TS BACKTEST BRIDGE
-> ACTUAL PYTHON BACKTESTER
-> from_compiled_spec
-> SAME SpecConditionStrategy INSTANCE
-> SOURCE_TIMEFRAME_ROLES CONSUMED
-> DIRECT REAL 5m OPENING-RANGE FRAME
-> REAL 1m EXECUTION FRAME
-> TEACHER STRUCTURAL STOP
-> TEACHER FIXED-R TARGET
```

This real vertical is where the earlier composed fixture proofs become an actual production-boundary proof. Do not create another synthetic DB-to-Python substitute instead.

Required causal controls remain:

- mutate the real 5m source while holding 1m execution fixed -> opening-range output must move appropriately;
- remove the 5m source frame -> SOURCE_FAITHFUL refuses;
- remove/mutate the role carrier -> refuses;
- remove/mutate teacher risk contract -> refuses or hash changes as appropriate;
- generic 1m->5m resampling must not satisfy the witness;
- a generic FVG gap-boundary stop must not stand in for the certified candle-extreme stop if the grade resolves displacement geometry.

## 9. STATUS

- Real pinned sVkm extraction: ✅ **ACCEPTED AS EXTRACTION**
- Transcript identity / extraction provenance: ✅ **ACCEPTED**
- Frozen historical Tier-A population: ✅ **UNCHANGED**
- 5m/1m extraction hypothesis: 🟡 **PROMISING, MUST BE GRADED**
- Teacher 2R extraction: 🟡 **PROMISING, MUST BE GRADED**
- Teacher stop extraction: 🟡 **PROMISING; EXACT GEOMETRY MUST BE RESOLVED**
- Raw `fvg_low -> generic fvg` execution for sVkm: ❌ **NOT AUTHORIZED**
- Real `pilot_conveyor` grading: 🟢 **AUTHORIZED NOW**
- EXTRACTION_CERTIFIED record: 🔒 **PENDING REAL GRADE**
- Compile real sVkm: 🔒 **AFTER CERTIFICATE**
- §9.2: 🔴 **OPEN**
- §9.3 candidate/source pairing: 🔒
- §9.4 deterministic full-trade proof: 🔒
- independent grader/performance/edge testing: 🔒 **BLOCKED UNTIL THE ORDERED GATES CLOSE**

## 10. NEXT WORK ORDER

**Do exactly this next:** run the real sVkm grounding/tiering/certification grade on the pinned extraction, with §2 and §3 treated as load-bearing adjudication questions.

If the certificate genuinely passes, persist it and proceed directly to the real compiler/vertical join.

If it does not, STOP AND REPORT the failing evidence. Do not relabel, paraphrase-strengthen, remap the stop, or manufacture continuity to get a pass.
