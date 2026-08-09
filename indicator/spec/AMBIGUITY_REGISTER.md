# Slumdawg Indicator — Ambiguity Register

Status: ACTIVE / RELEASE BLOCKING
Date: 2026-08-09

Goal: zero hidden discretion in executable code.

Rule: if a term below has no approved measurable definition, it is **NOT CODE-READY** for live-decision support. Tests may use placeholders only when explicitly labeled TEST-ONLY.

| Concept | Status | Why ambiguous | Required resolution |
|---|---|---|---|
| BIG DIRECTION | CALIBRATION_REQUIRED | Multiple Daily/4H/1H/15m/5m red/green lines can agree or conflict | Define deterministic aggregation/conflict/UNKNOWN rules without using a single line cross as reversal |
| CURRENT MOVE | CALIBRATION_REQUIRED | Lower-timeframe move may oppose BIG DIRECTION temporarily | Define lower-timeframe classification that distinguishes with-trend move vs temporary pullback |
| Valid trendline | USER_INPUT_V1 / AUTO_DEFERRED | Human can see a legitimate line; code needs exact anchors and intersection rules | V1 explicit time+price anchors, color/side, slope sign, touch/intersection policy, recency/staleness and lineage; auto-anchor research later |
| Trendline ladder relevance | CALIBRATION_REQUIRED | Lower-TF lines do not erase higher-TF lines, but showing all lines clutters chart | Define active/relevant/hidden rules across Daily -> 4H -> 1H -> 15m -> 5m |
| Reaction-zone boundaries | CALIBRATION_REQUIRED | Human sees clusters; code needs exact bounds | Sweep clustering radius / wick-density / reaction rules on real NQ/MNQ; require stable out-of-sample plateau |
| "Meaningful" swing / wick | CALIBRATION_REQUIRED | Not every wick is structural | Define confirmed pivot family + timeframe-weighted reaction evidence + age/confluence |
| Goldilocks GO LINE distance | CALIBRATION_REQUIRED | Too close fakes out; too far becomes late | Normalize by volatility + structure + remaining room; evaluate false-break vs reachability tradeoff |
| Stronger countertrend proof | CALIBRATION_REQUIRED | Temporary move against BIG DIRECTION needs higher burden | Define explicit score/threshold delta vs with-trend candidate |
| NEXT WALL | CALIBRATION_REQUIRED | Several trendlines/levels/zones may sit between price and target | Deterministic candidate scan and tie-break across opposing trendlines, D/W levels, swings, reaction zones |
| Multiple red/green lines close by | CALIBRATION_REQUIRED | Human sees clustered walls but code needs exact closeness | Define price-distance clustering normalized by tick/volatility and line relevance |
| Safer middle target | CALIBRATION_REQUIRED | User targets conservatively inside multiple opposing walls, not farthest wall | Derive deterministic interval from ordered opposing walls + reaction-zone geometry; do not eyeball midpoint |
| Conservative SAFE TARGET penetration | CALIBRATION_REQUIRED | "middle/top of pool" varies by zone | Measure penetration-depth distribution before reactions; test stable quantile/percentage and wall-aware cap |
| Good Push 2 momentum | CALIBRATION_REQUIRED | Human sees speed/hold/recoil | Fit deterministic components: distance/time/recoil/wick/hold/body/acceleration |
| Slow push | TEST_PLACEHOLDER_ONLY | Time threshold is not yet market-calibrated | Calibrate elapsed-time threshold and sensitivity on real NQ/MNQ |
| Hard recoil | TEST_PLACEHOLDER_ONLY | Reset distance is not yet market-calibrated | Define recoil distance/fraction/volatility-normalized threshold and sensitivity |
| Doji veto threshold | CALIBRATION_REQUIRED | Doji is a family, not one universal number | Sweep body/range threshold and require stable result |
| Minor close pool vs skippable pool | CALIBRATION_REQUIRED | Depends on momentum/context | Define zone-quality + distance + with-trend/countertrend rules, then ablate |
| Strong with-trend move | CALIBRATION_REQUIRED | Needed before safely skipping a nearby minor destination | Define trend alignment + momentum quality + remaining room + zone significance |
| Big-candle intermediate zone | CALIBRATION_REQUIRED | Need objective displacement definition | Define normalized displacement and internal reaction-zone eligibility |
| Stale trendline | CALIBRATION_REQUIRED | Old line may still matter or may be obsolete | Define age, intervening structure, intersection/invalidation and lineage rules |
| Overall trend reversal | OUT_OF_SCOPE_V1 | User does not use trendline break alone | Keep separate; no automatic flip from a trendline cross |
| Market closed | CALIBRATION_REQUIRED | Weekend/holiday/no-new-bar states can look stale without being faulty | Explicit session/calendar/feed-state rules and golden cases |
| Platform-native daily/weekly candle mismatch | EXTERNAL_VARIANCE_NEEDS_PROOF | Feeds/session construction can differ and Sunday pre-open semantics are tricky | Use platform-local candle only after Friday->Sunday pre-open->reopen and holiday parity tests; log discrepancies |
| Feed realtime | PARTIAL | Pine cannot prove every entitlement state by itself | Operator/platform attestation + freshness/runtime guard where observable |
| Chart sync 100% | DEFINED_CONTRACT | Literal market/future certainty is impossible; observable parity is testable | Must satisfy `PLATFORM_SYNC_CERTIFICATION.md` exactly |

## Deterministic tie-break requirement
Whenever two candidates are otherwise equal, production code must use an immutable documented ordering. Candidate tie-break dimensions may include calibrated score, timeframe precedence, reaction evidence, recency, structural distance, and stable ID. Final ordering is not approved until tests prove permutation invariance.

## Forbidden implementation shortcuts
- Do not invent a fixed candle-count distance for GO LINE.
- Do not use the nearest wick automatically.
- Do not use a trendline cross as a direction flip.
- Do not call UNKNOWN "with trend" or "countertrend".
- Do not choose the farthest opposing trendline as the default temporary-pullback target.
- Do not equate candle reaction zones with proven resting order-book liquidity.
- Do not infer exact historical intrabar tick ordering from ordinary 5m OHLC.
- Do not certify D/W weekend freshness from a generic `[1]` assumption without session-specific evidence.
- Do not hide chart-scale/autoscale defects behind UI settings.
- Do not tune a production threshold on the final holdout.

## Promotion rule
A row may move from CALIBRATION_REQUIRED/UNRESOLVED to CODE-READY only when:
1. measurable variables are defined;
2. deterministic unit/property tests exist;
3. golden human-approved examples qualify/reject correctly;
4. sensitivity testing shows a stable region rather than one magic value;
5. walk-forward/holdout evidence does not show obvious overfit;
6. Python/Pine/FXR implementations agree where applicable.

No item in CALIBRATION_REQUIRED may silently receive a production default and then be described as proven.
