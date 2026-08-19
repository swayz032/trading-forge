# Slumdawg Indicator — Platform Sync Certification Gate

Status: REQUIRED / NOT YET CERTIFIED
Date frozen: 2026-08-09
Scope: NQ/MNQ TradingView Pine v6 first, then FX Replay parity.

## Certification language

No build may be called **CERTIFIED**, **100% SYNCED**, **LIVE READY**, or equivalent until every mandatory gate below has executable evidence.

"100% synced" means **100% agreement inside the explicitly defined observable contract** — symbol, timeframe, timestamps, confirmed levels, drawing geometry, state transitions, alerts, reload behavior, and displayed prices. It does NOT mean future price prediction is certain, that a trendline or reaction area must hold, or that an entry must win.

Any unknown, stale, delayed, contradictory, missing, unconfirmed, off-grid, or unsupported input MUST fail closed and surface a plain-English reason.

## Observable chart-sync contract

### 1. Symbol contract
- Accepted live execution roots: NQ and MNQ only.
- Exact active contract identity must be visible in diagnostics.
- Contract changes invalidate live state until re-established.
- No silent carryover of reference candle, GO LINE, target, or momentum state across symbol/contract changes.

### 2. Execution timeframe contract
- Live execution state machine operates on 5-minute chart context only.
- Detected timeframe must be shown in the beginner coach when invalid.
- Daily -> 4H -> 1H -> 15m -> 5m is the top-down trendline ladder; those higher timeframes are context inputs, not alternate execution clocks.
- A wrong timeframe may display map/context data but MUST NOT show READY or actionable-looking state.

### 3. Price-grid contract
- All NQ/MNQ production prices must lie on the platform-reported valid tick grid.
- GO LINE rounding may never make proof easier.
- SAFE TARGET rounding may never make a conservative target farther/harder.
- Any platform metadata mismatch blocks certification until explained by platform/instrument evidence.

### 4. Time/session contract
- New York market/session logic uses America/New_York semantics and must survive DST transitions.
- Weekend and holiday behavior must be explicit.
- Required golden sequence: Friday close -> Sunday pre-open -> Sunday 18:00 ET reopen -> Monday session.
- Required holiday/no-new-bar sequence: latest completed D/W values must not silently shift because the next session has not opened.

### 5. PDH / PDL / PWH / PWL contract
- Human meaning: previous completed Daily candle high/low and previous completed Weekly candle high/low for the next trading context.
- TradingView values are not certified until weekend/open-session/holiday cases agree with that meaning.
- Compare script labels with platform-native completed D/W bars to the exact tick.
- Never use an unconfirmed active higher-timeframe candle merely to make the number appear fresh.

### 6. Trendline geometry contract
- Trendline ladder supports BOTH:
  - GREEN bullish lines from valid rising-low structure.
  - RED bearish lines from valid falling-high structure.
- Analysis order: Daily -> 4H -> 1H -> 15m -> 5m.
- At every timeframe, the operator/system may add a new valid line; lower-timeframe lines do not erase still-valid higher-timeframe lines.
- Script-owned lines must be defined by explicit time + price anchor pairs so geometry is stable across zoom, bar density, reload, and contract history length.
- Trendline crossing alone MUST NOT flip BIG DIRECTION, generate GO, or create READY.
- Lines are context / possible walls. Market reaction is probabilistic, never guaranteed.

### 7. Structure map contract
- Blue map sources in V1: 5m, 15m, 4H structural swing/wick areas plus PDH/PDL/PWH/PWL.
- No Asia/London expansion in V1 without separate evidence.
- A swing/level used for GO LINE or SAFE TARGET must carry provenance: timeframe, source bars, side, price/zone bounds, confirmation state, stable ID.
- Equal highs/lows and future confirmation bars may not create arbitrary or future-leaking pivots.

### 8. GO LINE contract
- Beginner label: GO LINE. Internal semantic: PROOF_LEVEL.
- GO LINE is distinct from blue structure and from red/green trendlines.
- Primary with-trend and alternative temporary-pullback GO LINE candidates are separate.
- No fixed "1–3 candles away" rule.
- Reject candidates that are noise-close or impractically far.
- Countertrend/temporary-pullback GO LINE requires stronger proof than with-trend.
- In a bearish BIG DIRECTION, bullish alternative proof may need to clear a lower red wall and meaningful wick/key structure before it can qualify.
- Mirror exactly for bearish pullback inside bullish BIG DIRECTION.

### 9. NEXT WALL / path contract
Before READY can be considered, scan the route from current price through GO LINE toward SAFE TARGET for:
- opposing red/green trendlines,
- PDH/PDL/PWH/PWL,
- qualified swing/key structure,
- reaction/target zones.
The nearest relevant obstacle must be explainable in beginner language as NEXT WALL.

### 10. SAFE TARGET contract
- Beginner label: SAFE TARGET. Internal source: qualified REACTION_ZONE / map structure.
- Conservative target sits inside the reaction area, not automatically at the far wick.
- Temporary/countertrend moves are target-conservative by default.
- Critical multiple-wall rule:
  - Bullish pullback inside bearish BIG DIRECTION + multiple RED walls overhead -> SAFE TARGET must remain in the safer nearer/middle reaction area and MUST NOT default to the farthest upper red line.
  - Bearish pullback inside bullish BIG DIRECTION -> mirror with GREEN walls below.
- Strong with-trend moves may consider a farther qualified destination only under calibrated, tested rules.

### 11. 5-minute live timing contract
Required state sequence:
1. WAIT FOR REFERENCE
2. REFERENCE SET
3. BREAK
4. PUSH 1
5. QUALITY PUSH 2
6. READY

Mandatory invariants:
- one accepted realtime update advances at most one forward stage;
- one spike cannot manufacture BREAK + PUSH 1 + READY;
- equal favorable extrema do not count as a new push;
- hard recoil resets;
- DOJI_LIKE reference is vetoed;
- Candle-2 failure -> Candle-3 promotes completed Candle-2 extreme and starts a fresh measurement;
- no stale push state crosses candles, symbols, sessions, or restart boundaries without explicit persistence semantics.

### 12. Realtime vs historical contract
- Realtime intrabar state and historical OHLC are different evidence classes.
- Historical OHLC must never be presented as if exact intrabar tick order were known.
- If lower-timeframe/tick evidence is used for research, its source and limitations must be recorded.
- Reload must not rewrite confirmed historical map/state in a way that was impossible live.

### 13. Reload / restart / reconnect contract
Golden tests required for:
- indicator reload,
- browser/chart reload,
- process restart/reference snapshot restore,
- duplicate update,
- out-of-order update,
- data gap,
- reconnect after gap,
- stale feed,
- contract switch,
- DST transition.
Confirmed state must be deterministic; unsafe uncertainty fails closed.

### 14. Chart-scale / Reset Chart View contract — P0
The indicator MUST NOT make TradingView Reset Chart View remain artificially zoomed out or tiny.

Acceptance evidence must prove:
- adding/removing the indicator does not materially alter the normal visible price range when only UI/context objects are enabled;
- hidden/debug plots do not affect autoscale;
- decorative/coach UI uses non-price-space UI constructs wherever possible;
- no sentinel/zero/off-screen placeholder price is left visible to scale;
- line/label/box coordinates are bounded to legitimate market prices;
- optional distant higher-timeframe levels can be hidden without changing the state engine;
- Reset Chart View before/after indicator is captured as a golden visual test.

A scale bug is a RELEASE BLOCKER, not cosmetic.

### 15. Beginner UI contract
Normal mode must show only information needed to answer:
- BIG DIRECTION
- CURRENT MOVE
- NEXT WALL
- GO LINE
- SAFE TARGET
- NOW
- SYSTEM

Engineering diagnostics are OFF by default.
Normal mode must not expose raw codes such as anchorFavorable, WAIT_BREAK, or internal enum names.
UNKNOWN cannot be translated into WITH TREND / COUNTERTREND.

### 16. Visual clutter contract
- Full trendline ladder may exist under the hood.
- Only currently relevant line(s), GO LINE(s), target area(s), and required D/W/map levels should be prominent.
- Secondary/inactive context is hidden or de-emphasized.
- No uncontrolled historical stair-step plots.
- No decorative element may consume enough chart area to impair candle reading.

### 17. Premium Slumdawg coach contract
- Pine UI may emulate the high-end Slumdawg 3D/glass/metal/neon-green brand through tables, borders, typography, and restrained accents.
- The generated mascot art is a brand reference/asset; production Pine must not depend on an unsupported arbitrary image-embedding mechanism.
- Branding may never alter market scale or cover the active candle/price decision area.

### 18. Alert parity contract
Every alert must correspond to the same state/reason as the visible coach and reference engine.
No alert may fire for a state that the chart UI rejects.
Parity/debug alerts remain clearly NON-ACTIONABLE until live approval.

### 19. Cross-engine parity contract
Required sequence:
- Python reference verified.
- Exact committed Pine source compiles unchanged.
- Python <-> Pine golden cases match.
- FXR is independently implemented from the same rulebook.
- Python <-> Pine <-> FXR parity passes.

No "close enough" for deterministic prices, stages, reason codes, anchor geometry, or confirmed D/W/map values unless a documented platform-data difference explains it.

### 20. Ambiguity contract
No production rule may depend on undefined words such as:
- strong,
- weak,
- close,
- far,
- important,
- big candle,
- good momentum,
- middle,
- major,
- too much recoil.

Each must either:
1. be mapped to measurable features + calibrated thresholds with sensitivity evidence, or
2. remain explicitly UNRESOLVED and unavailable to live-decision support.

No engineer may silently invent a threshold to unblock coding.

## Mandatory certification evidence

A release candidate must ship an evidence manifest containing at least:
- git commit/tree fingerprint;
- exact Pine/FXR source fingerprints;
- platform/compiler versions when observable;
- symbol/contract/timeframe/feed/session metadata;
- deterministic unit/property test totals;
- mutation score and surviving mutants;
- golden chart parity cases;
- weekend/holiday D/W cases;
- trendline anchor/geometry parity cases across all five timeframes;
- GO LINE qualify/reject cases;
- multiple-opposing-wall SAFE TARGET cases;
- 5m state transition and reset cases;
- reload/repaint cases;
- chart Reset View/autoscale before/after cases;
- latency/resource/capacity results;
- real NQ/MNQ research provenance;
- walk-forward/holdout results;
- live-shadow evidence before any live-decision-support promotion.

## Release ladder
1. SPEC_ONLY
2. REFERENCE_VERIFIED
3. PLATFORM_PARITY
4. RESEARCH_VERIFIED
5. SHADOW_VERIFIED
6. LIVE_DECISION_SUPPORT

No gate may be skipped or self-certified by assertion.
