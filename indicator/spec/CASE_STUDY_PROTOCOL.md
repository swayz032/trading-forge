# Case Study / Golden Fixture Protocol

Purpose: use real chart examples without turning screenshots into anecdotal proof or allowing hindsight to rewrite the rules.

## 1. Three libraries

### A. Golden qualify cases
Setups the user confirms should qualify under the frozen semantics.

Examples to capture from supplied material:
- bearish overall direction + short continuation + successful Push-2 entry;
- bearish overall direction + meaningful bullish intraday alternative proof level;
- conservative target reached inside a prior upper/lower reaction zone before the far wick;
- strong with-trend move where a very close minor pool is intentionally skipped.

### B. Golden reject cases
Charts that look tempting but should not qualify.

Required examples:
- nearest tiny countertrend wick;
- proof level too far from useful structure;
- doji/indecision reference;
- break followed by hard recoil;
- weak/slow Push 2;
- signal on delayed/stale/gapped feed;
- unconfirmed future swing.

### C. Adversarial cases
Cases designed to expose discrepancies rather than demonstrate good-looking trades.

Required examples:
- giant one-update spike;
- repeated equal lows/highs;
- two nearly identical reaction pools;
- multiple nested 5m/15m/4h pools;
- big displacement candle with intermediate historical reaction zones;
- contract roll;
- DST boundary;
- provider Daily-candle mismatch;
- Pine live state that changes after reload.

## 2. Screenshot rule

A screenshot is a visual annotation source, not numeric ground truth.

For a fixture to become executable it must eventually contain:
- exact symbol/contract;
- exact timestamp range and timezone;
- market-data provider/platform;
- 5m OHLC plus lower-timeframe/tick sequence when intrabar behavior matters;
- Daily/Weekly native-bar references if PDH/PDL/PWH/PWL are involved;
- user-approved red overall direction;
- expected candidate reaction zones;
- expected yellow proof candidates and selected level;
- expected rejected candidates + reason codes;
- expected momentum transition sequence;
- expected target zone and conservative target semantics.

If numeric source data is unavailable, keep the case as `VISUAL_ONLY` and never count it as a passing executable fixture.

## 3. Blind annotation process

To reduce hindsight leakage:
1. freeze only data visible up to decision time;
2. annotate expected setup/entry state without viewing later outcome;
3. hash/freeze the annotation;
4. reveal forward prices;
5. grade outcome separately.

The entry logic must never use the later outcome to decide whether a level was "really important".

## 4. Dual annotation

For difficult semantic cases, maintain:
- `USER_LABEL`: what the user's discretionary method says;
- `ENGINE_LABEL`: what the frozen deterministic rule says.

Disagreement is not silently corrected. It becomes one of:
- specification defect;
- calibration gap;
- acceptable discretionary-only nuance;
- engine defect;
- user reclassification after blinded review.

Every reclassification is versioned.

## 5. Negative controls

Each positive case should have at least one matched negative/control where possible:
- similar volatility;
- similar time of day;
- similar distance traveled;
- similar overall direction;
- no qualified reaction zone/proof structure.

This prevents the research from concluding that any random old price area is special.

## 6. Outcome taxonomy

Do not reduce everything to WIN/LOSS. Record:
- no entry;
- false break/reclaim;
- stop-first;
- target-first;
- target zone entered but configured target not reached;
- close pool reaction then continuation;
- full reversal;
- pullback then original move continues;
- ambiguous because lower-timeframe path unavailable.

Record MAE/MFE and time-to-event where real data permits.

## 7. Sampling plan

Case studies are explanatory evidence, not the primary statistical sample.

Required mix:
- random trading days;
- high-volatility days;
- low-volatility/chop;
- strong trend;
- reversal;
- countertrend pullback;
- opening period;
- midday;
- major news/event windows where allowed by the research protocol;
- contract-roll vicinity.

No deleting a day because the chart is ugly.

## 8. Fixture versioning

Each fixture has:
- fixture ID;
- semantic spec version;
- data fingerprint;
- expected-output version;
- provenance;
- review status;
- reason for any later amendment.

A fixture changed after a code failure is a specification change, not a test fix, unless independent evidence shows the original fixture was wrong.

## 9. Promotion thresholds

- `VISUAL_ONLY`: screenshot/photo but insufficient exact data.
- `ANNOTATED`: user/engine semantics frozen, outcome may remain hidden.
- `EXECUTABLE`: exact market data and expected machine states available.
- `CROSS_PLATFORM`: Python/Pine/FXR all run it.
- `GOLDEN_LOCKED`: no changes without explicit semantic-version amendment.

## 10. Case-study review questions

For every reviewed trade ask:
1. Was the overall red-direction context known before the move?
2. Which reaction zones existed before the move?
3. Why was this yellow candidate selected over nearer/farther alternatives?
4. Was the level selection using any future information?
5. What exact live events created BREAK/PUSH_1/PUSH_2?
6. Was Push 2 genuinely stronger by frozen measurements or just visually impressive?
7. What nearby reaction pools existed at entry time?
8. Why was Pool 1 used or skipped?
9. Was the conservative TP inside the near side of the destination pool?
10. Could the same rule be applied to an unseen day without human reinterpretation?
