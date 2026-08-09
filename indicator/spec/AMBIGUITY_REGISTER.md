# Ambiguity Register

Goal: zero hidden discretion in executable code.

| Concept | Status | Why ambiguous | Required resolution |
|---|---|---|---|
| Reaction-zone boundaries | CALIBRATION_REQUIRED | Human sees clusters; code needs exact bounds | Sweep clustering radius / wick-density rules on real NQ/MNQ, require stable out-of-sample plateau |
| "Meaningful" swing | CALIBRATION_REQUIRED | Not every wick is structural | Define confirmed pivot family + timeframe-weighted reaction evidence |
| Goldilocks proof-level distance | CALIBRATION_REQUIRED | Too close fakes out; too far becomes late | Normalize by volatility + structure; evaluate false-break vs reachability tradeoff |
| Good Push 2 momentum | CALIBRATION_REQUIRED | Human sees speed/hold/recoil | Fit deterministic components: distance/time/recoil/wick/hold/acceleration |
| Doji veto threshold | CALIBRATION_REQUIRED | Doji is a family, not one universal number | Sweep body/range threshold and require stable result |
| Conservative TP penetration | CALIBRATION_REQUIRED | "middle/top of pool" varies by zone | Measure penetration depth distribution before reactions; test stable quantile/percentage |
| Minor close pool vs skippable pool | CALIBRATION_REQUIRED | Depends on momentum/context | Define zone-quality + distance + with-trend/countertrend rules, then ablate |
| Big-candle intermediate zone | CALIBRATION_REQUIRED | Need objective displacement definition | Define normalized displacement and internal reaction-zone eligibility |
| Trendline anchors | USER_INPUT_V1 | User uses red line for overall direction | In V1 user selects anchors/direction; auto-anchor logic deferred |
| Overall trend reversal | OUT_OF_SCOPE_V1 | User does not use trendline break alone | Keep separate; no automatic flip |
| Platform-native daily candle mismatch | EXPECTED_EXTERNAL_VARIANCE | Feeds may build daily candles differently | Use local platform candle; log mismatch in parity harness |

No item in `CALIBRATION_REQUIRED` may silently receive a production default and then be described as proven.
