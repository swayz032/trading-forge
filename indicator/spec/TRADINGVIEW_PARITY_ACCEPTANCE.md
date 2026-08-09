# TradingView Pine v6 Platform-Parity Acceptance Gate

Status: ACTIVE GATE. This document governs promotion of the Pine implementation from code-present to platform-parity evidence.

The Pine script is not a second source of trading truth. The Python reference remains authoritative until this gate passes.

## 1. Scope of the first vertical slice

The first Pine port intentionally covers only semantics that can be compared without inventing unresolved market calibration:

- NQ/MNQ + 5-minute operating envelope
- 0.25-point tick-grid validation
- manual active plan (`LONG` / `SHORT`)
- manual overall direction context (`BULLISH` / `BEARISH` / `UNKNOWN`)
- manual yellow proof level for platform-parity testing
- platform-native prior completed Daily/Weekly levels (`PDH`, `PDL`, `PWH`, `PWL`)
- realtime reference-candle arming
- DOJI_LIKE reference veto with explicit configurable threshold
- `WAIT_BREAK -> BREAK -> PUSH_1 -> ENTRY_READY` state sequence
- one realtime execution -> at most one forward momentum-stage transition
- recoil reset
- slow-push reason codes
- failed-live-candle -> next-candle reference promotion/reset
- non-actionable reason-coded visual/debug output

Automatic reaction-zone detection, structural proof-level ranking, target selection, and calibrated composite momentum quality remain separate gates. They are not silently approximated in this port.

## 2. Safety classification

The Pine source MUST hard-code:

- build classification = `PLATFORM_PARITY_ONLY`
- live-decision-support approval = `false`

No input may override that release classification.

The parity engine itself MUST default OFF.

Unknown/delayed live-feed status MUST NOT be represented as trusted realtime. Pine does not expose a reliable entitlement/delay classification for this purpose, so LIVE mode requires explicit operator feed attestation and remains non-actionable until a later release gate changes the hard-coded approval constant.

## 3. Compile gate

A human operator must paste the exact committed `.pine` source into TradingView Pine Editor v6 and preserve evidence of:

1. successful compilation with zero errors;
2. exact source commit SHA;
3. TradingView symbol used;
4. timeframe used;
5. screenshot or exported log showing the build-classification dashboard;
6. Pine/TradingView version/date context where available.

Any compiler modification made in the UI must be committed back to GitHub before further parity testing. The UI copy may never become an untracked fork.

## 4. Runtime guard cases

The following must be demonstrated independently:

| Case | Expected result |
|---|---|
| ES or other wrong root | `WRONG_SYMBOL`, state cleared |
| NQ/MNQ on non-5m chart | `WRONG_EXECUTION_TIMEFRAME`, state cleared |
| proof level unset | `PROOF_LEVEL_NOT_SET`, state cleared |
| proof level off tick grid | `OFF_TICK_GRID_PROOF`, state cleared |
| parity engine disabled | `PARITY_ENGINE_DISABLED`, state cleared |
| LIVE + feed attestation UNKNOWN | live path blocked |
| LIVE + feed attestation DELAYED | live path blocked |
| historical bar execution | no claim that historical intrabar tick order is exact |

## 5. Golden state-transition cases

For every case below, run the same ordered event path through Python reference and Pine realtime capture. Compare state and reason code after each distinct update.

Required cases:

1. clean LONG sequence;
2. clean SHORT sequence;
3. one giant favorable update — may advance only one stage;
4. equal-price reprint — may not manufacture a fresh push;
5. hard recoil after BREAK — reset to WAIT_BREAK against same reference;
6. hard recoil after PUSH_1 — reset to WAIT_BREAK against same reference;
7. slow PUSH_1 — stage may not advance;
8. slow PUSH_2 — stage may not advance;
9. Candle 2 fails -> Candle 3 starts from Candle-2 completed extreme;
10. DOJI_LIKE completed proof candle — reference veto;
11. opposite direction mirror of every directional case.

Expected acceptance: zero unexplained semantic mismatches.

## 6. Event-identity limitation

The Python reference accepts explicit `event_id` and rejects duplicate/out-of-order event identifiers. Pine does not provide an exchange/provider tick identifier to the script.

Therefore:

- Pine execution sequence is observable, but provider-event identity parity is not claimed.
- duplicate-provider-tick rejection remains a reference/runtime-integration requirement, not a Pine-script capability claim.
- this limitation must remain visible in the parity report and may not be converted into a fake test.

## 7. Realtime / reload / repaint campaign

Capture the following for at least 20 candidate sessions before parity promotion:

- realtime transition ledger before reload;
- chart state immediately after reload;
- whether transient intrabar markers disappear or change;
- prior completed D/W levels before/after reload;
- reference level before/after reload;
- any alert vs plotted-state disagreement.

Expected behavior:

- realtime intrabar `varip` state is allowed to be unreconstructable after reload; this is a documented Pine execution-model limitation, not permission to fabricate historical states;
- confirmed higher-timeframe prior D/W levels must not retrospectively change on the same underlying platform feed;
- no historical plot may imply exact tick ordering that was not available.

## 8. Cross-environment numeric parity

For each captured golden case, record at minimum:

- symbol/root;
- contract;
- bar start time;
- side;
- proof level;
- reference;
- anchor;
- stage;
- transition reason;
- minimum break;
- minimum push;
- maximum recoil;
- maximum push seconds;
- doji threshold;
- PDH/PDL/PWH/PWL;
- Pine `syminfo.mintick`;
- source commit SHA.

Price equality rule for NQ/MNQ structural levels: exact quarter-point equality unless the discrepancy is explicitly attributed to different underlying platform data. An unexplained one-tick difference is a defect, not tolerance.

## 9. Negative case-study requirement

At least as many `SHOULD_REJECT` cases as `SHOULD_QUALIFY` cases must be preserved. This protects against a visually impressive but permissive indicator.

Minimum reject corpus before platform promotion: 20 distinct sessions/cases covering fake pushes, wick spikes, recoil, dojis, near-proof noise, bar resets, incorrect chart context, and feed/runtime blocks.

## 10. Promotion rule

`TradingView Pine parity = PASS` only when all are true:

- committed source compiles unchanged;
- runtime guard cases pass;
- golden state-transition cases show zero unexplained mismatches;
- LONG/SHORT mirrors agree;
- reload/repaint campaign is documented;
- alert/visual disagreement count is zero or every discrepancy is dispositioned and fixed;
- no calibration placeholder is represented as a proven NQ/MNQ trading setting;
- no live-decision-support approval is implied.

Passing this document advances only the TradingView portion of `PLATFORM_PARITY`. It does not prove market edge, profitability, or 69-tick-stop protection.
