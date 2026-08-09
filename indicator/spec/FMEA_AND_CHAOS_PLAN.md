# Failure Mode and Effects Analysis (FMEA) + Chaos Plan

Purpose: identify ways the indicator can be wrong even when the chart looks plausible, then require a detection/control/test for each one.

Severity scale: `S1` cosmetic, `S2` misleading but non-actionable, `S3` could alter setup selection, `S4` could produce/withhold live entry or materially change target.

| ID | Failure mode | Effect | Severity | Detection/control | Required test |
|---|---|---|---|---|---|
| FM-001 | Feed is delayed but UI appears live | late entry timing | S4 | runtime feed-state gate + visible banner | delayed-live block |
| FM-002 | Feed gap after disconnect | missing Push/recoil sequence | S4 | gap detector, invalidate active state | reconnect/gap chaos |
| FM-003 | Duplicate updates | fake extra pushes | S4 | monotonic event ID | duplicate event test |
| FM-004 | Out-of-order timestamps | retroactive momentum | S4 | event-time monotonicity | reorder fuzz |
| FM-005 | One large update counts as several pushes | fake `ENTRY_READY` | S4 | one-event/one-stage invariant | giant-spike mutation |
| FM-006 | Candle 2 state leaks into Candle 3 | premature entry | S4 | bar-boundary reset | Candle-3 regression |
| FM-007 | Hard recoil ignored | stale momentum entry | S4 | recoil invalidation | recoil mutation |
| FM-008 | Slow move labeled strong because distance eventually met | fake momentum quality | S3/S4 | elapsed-time/speed component | slow-push test |
| FM-009 | NQ/MNQ off-grid level | platform mismatch/fill discrepancy | S3 | strict 0.25 grid | off-grid rejection |
| FM-010 | Float NaN enters candidate score sort | input-order dependent selection | S4 | finite/bounds validation | NaN selector test |
| FM-011 | Candidate order changes selected proof level | nondeterminism | S4 | fixed score/tie sort | permutation property |
| FM-012 | Nearest tiny wick auto-selected countertrend | fakeout-prone entry | S4 | min distance + structure gate | nearest-wick mutant |
| FM-013 | Farther is always considered safer | late/missed entry | S3 | max distance / missed-move study | too-far test |
| FM-014 | Trendline cross flips intraday bias | semantic corruption | S4 | red authority limited to overall context | mutation/golden case |
| FM-015 | Future swing used before confirmation | impossible historical performance | S4 | confirmation timestamp | lookahead mutation |
| FM-016 | HTF unfinished candle used as confirmed level | repaint after close | S4 | confirmed HTF policy | Pine live/reload fixture |
| FM-017 | Platform-native PDH/PDL silently replaced by custom session | different yellow/target map | S3/S4 | source provenance + parity | daily-candle fixture |
| FM-018 | Contract roll resets price basis without state reset | stale levels/state | S4 | symbol/contract reset | roll chaos |
| FM-019 | DST shifts expected market timestamps | wrong session/date reference | S3 | America/New_York tests | DST fixtures |
| FM-020 | Reaction-zone merge over-clusters unrelated levels | giant false pool | S3 | width/merge limits | cluster adversary |
| FM-021 | Reaction-zone split fragments one real pool | wrong target/proof candidate | S3 | calibrated merge study | clustering sensitivity |
| FM-022 | One wick becomes a pool | noise promoted to structure | S3 | minimum reaction evidence | single-wick test |
| FM-023 | Far wick used as conservative TP | lower target hit rate | S3 | near-side penetration rule | far-wick mutant |
| FM-024 | Strong-move skip logic skips a major close pool | over-aggressive TP | S4 | major-zone exemption | target mutation |
| FM-025 | Countertrend TP uses next far pool | ignores bigger-trend resume risk | S3/S4 | countertrend conservative rule | target context test |
| FM-026 | Big-candle intermediate liquidity invented without evidence | curve-fit entries/TP | S3 | separate preregistered calibration | hold blocked until study |
| FM-027 | Snapshot restored under incompatible schema/config | ghost state | S4 | schema/config version gate | snapshot corruption |
| FM-028 | Alert fires before plotted state updates | UI/alert discrepancy | S4 | same reason-coded event source | Pine alert parity |
| FM-029 | Pine resource limit silently drops zones | missing key structure | S3/S4 | resource telemetry, fail closed | capacity test |
| FM-030 | FXR/Pine and Python disagree | untrusted cross-platform behavior | S4 | differential fixture harness | parity gate |
| FM-031 | Historical 5m OHLC used to infer exact intrabar order | false backtest edge | S4 | lower-TF/tick requirement | research-policy gate |
| FM-032 | Final holdout reused for tuning | selection bias | S4 | preregistration/version reset | research audit |
| FM-033 | Commission/slippage omitted | overstated edge | S3 | cost sensitivity | research gate |
| FM-034 | Only trending days retained | regime survivorship | S4 | complete-date manifest | dataset audit |
| FM-035 | Screenshot case cherry-picked | anecdotal validation | S3 | systematic case library + random sampling | case-study protocol |
| FM-036 | UI score hides conflicting evidence | user overtrust | S4 | component breakdown + warnings | human-factors review |
| FM-037 | Delayed TradingView signal looks identical to realtime | dangerous misuse | S4 | hard visual mode distinction | UI acceptance test |
| FM-038 | Config changes without semantic version bump | unreproducible results | S3/S4 | config fingerprint + changelog | release audit |
| FM-039 | Dependency/workflow compromise | untrusted build/test | S4 | least privilege, pinning/scanning | secure-SDLC gate |
| FM-040 | Logging fails silently | no postmortem/edge evidence | S3 | durable ledger health check | observability chaos |

## Chaos campaign

Run these campaigns against the platform-agnostic engine first, then Pine/FXR where the platform permits.

### C1 — event-stream chaos
Randomly inject duplicates, reorder windows, time gaps, stale periods, invalid prices, off-grid prices, and bursty updates. Expected: same valid events produce the same states; invalid context is rejected or causes explicit reset.

### C2 — process chaos
Checkpoint after every transition and kill/restart at every possible point. Expected: exact continuation or explicit safe reset; never duplicate `ENTRY_READY`.

### C3 — market-structure chaos
Feed hundreds of almost-equal wick clusters, isolated spikes, broad ranges, nested zones, overlapping 5m/15m/4h zones, and equal highs/lows. Expected: deterministic bounded candidate set.

### C4 — platform-data chaos
Change provider/session construction, contract symbol, Daily/Weekly bar source, and timezone. Expected: provenance difference is detected; parity exceptions are explicit rather than silently tolerated.

### C5 — resource chaos
Force candidate counts and history length toward Pine/FXR limits. Expected: warning/fail-closed behavior, never silently truncated logic.

### C6 — research chaos
Perturb costs, latency, target penetration, momentum thresholds, zone widths, and train/test windows. Expected: claimed edge survives a broad parameter neighborhood or the version is rejected.

## Defect conversion rule

Every observed production/shadow defect must be converted into:
1. minimized reproducer;
2. FMEA entry/update;
3. permanent regression test;
4. mutation or adversarial twin when practical;
5. root-cause note and affected requirement IDs.
