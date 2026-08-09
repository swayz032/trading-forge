# Market Data / Replay Contract

Purpose: prevent data-source differences, hidden gap filling, session reconstruction, or continuous-contract artifacts from being mistaken for strategy behavior.

## 1. Dataset identity

Every research/shadow run must record:
- provider;
- dataset/schema type (tick, trade, BBO, 1s aggregate, etc.);
- symbol and exact contract;
- continuous vs individual contract;
- back-adjustment setting if applicable;
- start/end UTC;
- timezone used only for presentation/session mapping;
- raw file/object fingerprints;
- normalization code version;
- known gaps;
- delayed/realtime classification;
- corporate/exchange calendar version if used.

No result is reproducible without this manifest.

## 2. Intrabar truth hierarchy

For the 5-minute Push sequence:
1. event/tick stream when available;
2. one-second ordered aggregates when tick is unavailable;
3. lower-timeframe bars with explicit approximation label;
4. 5-minute OHLC is **insufficient** for exact Push/recoil path ordering.

Never infer a favorable path through a 5-minute bar solely because its high/low contains the required prices.

## 3. Bar construction

When building 5m/15m/4h from lower-timeframe data, freeze:
- interval boundary convention;
- timestamp meaning (event time vs receive time; bar open vs close label);
- timezone/session alignment;
- inclusion/exclusion at exact boundary;
- missing-second policy;
- zero-trade interval policy;
- late-event correction policy.

Same normalized stream + same builder version must produce byte-equivalent bars.

## 4. Platform-native Daily/Weekly levels

The user's PDH/PDL and PWH/PWL workflow is based on the prior completed native Daily/Weekly candle shown by the active platform.

Therefore:
- TradingView parity tests use TradingView's prior completed native Daily/Weekly values;
- FX Replay parity tests use FX Replay's native values;
- the research store records provider-native values used by each fixture;
- if two platforms disagree, record `PLATFORM_LEVEL_MISMATCH` rather than silently forcing equality;
- no custom 09:30-16:00 reconstruction may replace the native candle without a new semantic version.

## 5. Contract roll

Required:
- exact contract ID on every event;
- active setup cleared at contract change unless a later frozen rule explicitly proves cross-roll continuity;
- continuous/back-adjusted series may be used for structural research only under a declared policy;
- live proof/target prices must be tied to the actual traded contract's price grid;
- roll-window case studies are mandatory.

## 6. Price grid

NQ/MNQ production price levels use the explicit contract tick grid.

Adapter policy:
- validate incoming prices against provider precision;
- tradable levels/alerts are normalized to the declared instrument grid;
- off-grid production values fail closed by default;
- any platform-specific rounding is logged before parity comparison.

## 7. Gaps and corrections

A data gap is not equivalent to "nothing happened."

For exact intrabar research:
- gap crossing an active setup invalidates exact state unless the missing range is recovered;
- corrected/revised source data creates a new dataset version/fingerprint;
- no forward fill of trade prices to manufacture Push states;
- no interpolation to claim stop-first/target-first ordering.

## 8. Event ordering

Primary ordering key must be provider-defined event time/sequence where available.

Reject or explicitly quarantine:
- duplicate event sequence;
- backward event time;
- impossible future time beyond allowed clock-skew policy;
- cross-contract interleaving without symbol identity;
- unclassified late corrections.

Receive time may be retained separately for latency studies; it must not silently replace event time.

## 9. Split integrity

Research datasets must maintain immutable chronological partitions:
- development/calibration;
- validation;
- walk-forward folds;
- final untouched holdout;
- later live-shadow period.

The final holdout's raw outcome fields must not be exposed to parameter search code.

## 10. Cost/execution companion data

The indicator's edge study should record both pure-price signal quality and executable assumptions.

At minimum:
- commission schedule version;
- slippage scenarios;
- entry/target/stop tick prices;
- whether fill ordering is known exactly from lower-timeframe data;
- unresolved same-event ambiguity marked rather than guessed.

If later tied to order execution, use BBO/trade-aware fill evidence rather than candle-only fills.

## 11. Replay determinism

A recorded normalized event stream is considered trustworthy for regression only if replay:
- reproduces event count;
- reproduces 5m/15m/4h bars;
- reproduces reaction-zone candidates;
- reproduces proof/target selection;
- reproduces every momentum transition/reason code;
- reproduces final state hash/manifest.

## 12. Provider comparison study

Before live-decision-support promotion, run shared dates through at least the live platform feed and research feed where possible.

Classify discrepancies:
- harmless display rounding;
- tick-level price difference;
- bar boundary difference;
- Daily/Weekly session difference;
- missing event/gap;
- contract mapping difference;
- material semantic difference.

Material differences must be visible to the user or make the affected rule fail closed.
