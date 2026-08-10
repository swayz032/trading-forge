# Slumdawg Indicator — Ambiguity Register

Status: ACTIVE / RELEASE BLOCKING  
Date: 2026-08-10

Goal: zero hidden discretion in executable code.

Rule: if a term below has no approved measurable definition, it is **NOT CODE-READY** for live-decision support. Tests may use placeholders only when explicitly labeled TEST-ONLY.

| Concept | Status | Why ambiguous | Required resolution |
|---|---|---|---|
| BIG DIRECTION | CALIBRATION_REQUIRED | A strong pullback can temporarily make lower timeframes point opposite the larger market; a weighted timeframe vote can flip too easily | Implement persistent higher-timeframe protected-structure state; define Daily/4H conflict handling, structural invalidation, reversal confirmation, and UNKNOWN rules; do not use a simple weighted vote or lower-timeframe rally as reversal |
| BIG DIRECTION protected structure | CALIBRATION_REQUIRED | Human sees the larger bearish/bullish structure that remains valid through pullbacks | Define protected swing family, confirmation depth, close-vs-wick invalidation, and opposite-structure confirmation; regression-test bearish market -> bullish pullback -> bearish resumption and mirror |
| CURRENT MOVE | CALIBRATION_REQUIRED | Latest-pivot timestamp can misclassify a small bounce as a new move | Define 15m structural-leg state from confirmed swing sequence plus 5m live evidence; DOWN persists until meaningful lower-high structure is invalidated, mirrored for UP |
| ACTIVE PLAN | CALIBRATION_REQUIRED | Both entry lines may exist while only one plan should drive the live state machine and TP box | Define deterministic mapping from CURRENT MOVE to plan, countertrend burden, unresolved-state behavior, and reset rules |
| Valid trendline | USER_INPUT_V1 / AUTO_DEFERRED | Human can see a legitimate line; code needs exact anchors and intersection rules | Automatic trendlines remain deferred. If reopened later: define anchors, slope, touch/intersection policy, recency/staleness and lineage |
| Trendline ladder relevance | DEFERRED | Automatic trendline lane is not active | Do not block current entry/TP work on automatic trendline display |
| Reaction-zone boundaries | CALIBRATION_REQUIRED | Human sees clusters; code needs exact bounds | Sweep clustering radius / body-wick overlap / reaction rules on real NQ/MNQ; require stable out-of-sample plateau |
| Reaction shelf evidence | CALIBRATION_REQUIRED | Requiring two nearly identical pivots misses visually obvious shelves; allowing any wick creates noise | Define multi-lane evidence: 15m clustered interactions, dense 5m fallback, major 1H/4H reaction, D/W confluence; define merge rules and lane precedence |
| Major single higher-timeframe reaction | CALIBRATION_REQUIRED | One strong 4H reaction may matter more than two tiny 15m pivots | Define significance / timeframe / displacement / confluence burden for a major reaction to qualify without ordinary multi-touch count |
| TP visibility / missing target | ENGINEERING_REQUIRED | Current experimental builds can return `na` and silently remove TP lines even when chart structure is visibly present | Exhaust all approved candidate lanes before `NO QUALIFIED SHELF`; distinguish no-market-candidate from detector/data failure; panel must show explicit reason |
| TP2 / TP3 discovery | CALIBRATION_REQUIRED | A narrow TP1 cluster algorithm can fail to find deeper shelves | Re-run full multi-lane search beyond prior selected shelf; require distinct-zone separation and explicit no-shelf reason |
| "Meaningful" swing / wick | CALIBRATION_REQUIRED | Not every wick is structural | Define confirmed pivot family + timeframe-weighted reaction evidence + age/confluence + room-to-target |
| Clean pullback before Entry Zone | CALIBRATION_REQUIRED | User waits for enough pullback/BOS structure to avoid entering inside the pullback | Define measurable pullback development / structural reset / swing confirmation before a new Entry Zone may replace the old one |
| Entry Zone auto-adjustment | CALIBRATION_REQUIRED | New structural swings can legitimately move the yellow line, but unconfirmed pivots would repaint | Define confirmed replacement rule, stale-level invalidation, and golden replay tests |
| Goldilocks Entry Zone distance | CALIBRATION_REQUIRED | Too close fakes out; too far becomes late | Normalize by volatility + structure + remaining room; evaluate false-break vs reachability tradeoff |
| Stronger countertrend proof | CALIBRATION_REQUIRED | Temporary move against BIG DIRECTION needs higher burden | Define explicit score/threshold delta vs with-direction candidate |
| NEXT WALL | CALIBRATION_REQUIRED | Several levels/zones may sit between price and target | Deterministic candidate scan and tie-break across D/W levels, swings, reaction zones, and any future reintroduced wall sources |
| Multiple red/green lines close by | DEFERRED | Automatic trendline lane is inactive | Preserve concept for later; do not invent a current threshold |
| Safer middle target | CALIBRATION_REQUIRED | User targets conservatively inside reaction structure, not farthest wick | Derive deterministic interval from reaction-zone geometry and opposing walls; do not eyeball midpoint |
| Conservative SAFE TARGET penetration | CALIBRATION_REQUIRED | User prefers top/top-middle for SHORT and bottom/bottom-middle for LONG; exact depth varies | Measure penetration-depth distribution before reactions; test stable quantile/percentage and wall-aware cap; far wick is evidence only |
| Candle pattern labels | RESEARCH_REQUIRED | Textbook names vary by definition and can create false confidence | Detect geometry first: body/range, wick fractions, close location, displacement, sequence relation; pattern names are display labels only |
| Rejection -> engulf sequence | RESEARCH_REQUIRED | Positive user example exists, but winning example alone does not prove a general rule | Define doji/indecision geometry, rejection geometry, engulf/displacement relationship, structure/context/room gates; collect failed look-alikes and ablate |
| Qualified momentum entry | RESEARCH_REQUIRED | A first strong engulfing candle through the Entry Zone may justify earlier entry, but could overfit winners | Keep as a separate lane from standard BREAK/PUSH1/PUSH2; define candle strength, close location, wick, displacement, context, room-to-TP, recoil and negative fixtures |
| Engulfing definition | CALIBRATION_REQUIRED | Body-only, full-range, and close-through definitions differ | Compare explicit variants on NQ/MNQ and freeze only a stable definition if evidence supports it |
| Hammer / rejection definition | CALIBRATION_REQUIRED | Wick/body ratios and location vary; direction depends on context | Define direction-normalized wick/body/close features rather than textbook name alone |
| Good Push 2 momentum | CALIBRATION_REQUIRED | Human sees speed/hold/recoil | Fit deterministic components: distance/time/recoil/wick/hold/body/acceleration |
| Slow push | TEST_PLACEHOLDER_ONLY | Time threshold is not yet market-calibrated | Calibrate elapsed-time threshold and sensitivity on real NQ/MNQ |
| Hard recoil | TEST_PLACEHOLDER_ONLY | Reset distance is not yet market-calibrated | Define recoil distance/fraction/volatility-normalized threshold and sensitivity |
| Doji veto threshold | CALIBRATION_REQUIRED | Doji is a family, not one universal number | Sweep body/range threshold and require stable result |
| Minor close pool vs skippable pool | CALIBRATION_REQUIRED | Depends on momentum/context | Define zone-quality + distance + with-trend/countertrend rules, then ablate |
| Strong with-trend move | CALIBRATION_REQUIRED | Needed before safely skipping a nearby minor destination | Define trend alignment + momentum quality + remaining room + zone significance |
| Big-candle intermediate zone | CALIBRATION_REQUIRED | Need objective displacement definition | Define normalized displacement and internal reaction-zone eligibility |
| Stale trendline | DEFERRED | Automatic trendline lane is inactive | Resolve only if trendlines are reintroduced |
| Overall trend reversal | CALIBRATION_REQUIRED_V2 | V1 kept reversal out of scope; V2 needs automatic BIG DIRECTION without false flips | Define persistent protected-structure state and explicit reversal confirmation; trendline cross alone remains forbidden |
| Market closed | ENGINEERING_DEFINED_NORMAL_GAP / HOLIDAY_UNRESOLVED | Normal weekend/maintenance can be bounded, but holiday/no-new-bar states need separate proof | v0.4 permits a 72-hour normal closed-gap bridge only when current HTF time_close is already past; longer gaps fail closed pending holiday golden cases |
| Platform-native daily/weekly candle mismatch | EXTERNAL_VARIANCE_NEEDS_PROOF | Feeds/session construction can differ and Sunday pre-open semantics are tricky | Use platform-local candle only after Friday->Sunday pre-open->reopen and holiday parity tests; log discrepancies |
| Feed realtime | PARTIAL | Pine cannot prove every entitlement state by itself | Operator/platform attestation + freshness/runtime guard where observable |
| Chart sync 100% | DEFINED_CONTRACT | Literal market/future certainty is impossible; observable parity is testable | Must satisfy `PLATFORM_SYNC_CERTIFICATION.md` exactly |

## Deterministic tie-break requirement
Whenever two candidates are otherwise equal, production code must use an immutable documented ordering. Candidate tie-break dimensions may include calibrated score, timeframe precedence, reaction evidence, recency, structural distance, and stable ID. Final ordering is not approved until tests prove permutation invariance.

## Forbidden implementation shortcuts
- Do not invent a fixed candle-count distance for Entry Zone.
- Do not use the nearest wick automatically.
- Do not use a trendline cross as a direction flip.
- Do not use a weighted timeframe vote as the final BIG DIRECTION reversal rule.
- Do not let the latest 15m pivot timestamp alone define CURRENT MOVE.
- Do not call UNKNOWN "with trend" or "countertrend".
- Do not choose the farthest opposing structure as the default temporary-pullback target.
- Do not equate candle reaction zones with proven resting order-book liquidity.
- Do not infer exact historical intrabar tick ordering from ordinary 5m OHLC.
- Do not let one candle secretly satisfy multiple stages in the standard momentum path.
- Do not use a candlestick pattern name alone as an entry.
- Do not silently hide TP lines when a detector lane returns `na`.
- Do not treat `NO QUALIFIED SHELF` and `DETECTOR/DATA UNAVAILABLE` as the same state.
- Do not certify D/W weekend freshness from a generic `[1]` assumption without session-specific evidence.
- Do not hide chart-scale/autoscale defects behind UI settings.
- Do not tune a production threshold on the final holdout.

## Promotion rule
A row may move from CALIBRATION_REQUIRED/RESEARCH_REQUIRED/UNRESOLVED to CODE-READY only when:
1. measurable variables are defined;
2. deterministic unit/property tests exist;
3. golden human-approved examples qualify/reject correctly;
4. negative/look-alike fixtures are included when the concept is a setup/entry detector;
5. sensitivity testing shows a stable region rather than one magic value;
6. walk-forward/holdout evidence does not show obvious overfit;
7. Python/Pine/FXR implementations agree where applicable.

No unresolved item may silently receive a production default and then be described as proven.
