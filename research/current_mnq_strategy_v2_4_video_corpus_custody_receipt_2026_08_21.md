# Video corpus custody receipt (operator-supplied full set, 2026-08-21)

Status: **LANDED.** The operator authorized the addition (*"and it gets added"*) and then
handed this seat the landing (*"do it yourself"*). All eight of his videos are bound into
`research/current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json`,
which is build-fingerprinted, and guarded by
`tests/test_current_mnq_strategy_v2_4_video_corpus_registry.py`.

**This file is GENERATED FROM THE REGISTRY and read by a test.** That is deliberate. An
independent grader found that an earlier hand-maintained version of this receipt still
carried claims the registry had already retracted - still tagged `[MEASURED HERE]` - because
the registry had a guard and this document did not. Corrections flowed to the guarded
artifact and stopped at the unguarded one, and the unguarded one is the custody document.
Regenerating from the registry and testing the result removes that whole failure class.

---

## 1. Custody table - all 8 files, hash-verified on disk

| # | File | sha256 | Duration | Status |
|---|---|---|---|---|
| 1 | `Desktop 2026.08.19 - 02.12.06.01.mp4` | `1e39083c6a807802...` | - | SEALED 2026-08-20 |
| 2 | `Desktop 2026.08.19 - 02.13.19.02.mp4` | `95bcbb3f7bf38933...` | - | SEALED 2026-08-20 |
| 3 | `Desktop 2026.08.20 - 20.37.47.04.mp4` | `218ca9bb827db2c5...` | - | SEALED 2026-08-20 |
| 4 | `Desktop 2026.08.19 - 19.49.23.03.mp4` | `74b1585768e77dc3...` | 31.8s | OPERATOR_STATED |
| 5 | `Desktop 2026.08.15 - 17.13.57.01.mp4` | `7dbc51c72d8b638a...` | 14027.6s | DERIVED_NOT_OPERATOR_STATED |
| 6 | `Desktop 2026.08.16 - 23.06.30.02.mp4` | `8f4020a8aa7dd6fa...` | 98.3s | DERIVED_NOT_OPERATOR_STATED |
| 7 | `Desktop 2026.08.21 - 10.40.34.05.mp4` | `08e87682f683db1b...` | 385.7s | OPERATOR_STATED |
| 8 | `Desktop 2026.08.16 - 23.34.40.03.mp4` | `da8b6c2e4f53f26c...` | 1.5s | NO_EVIDENCE_VALUE |

The three videos sealed on 2026-08-20 re-verify byte-exact. Five were unregistered and were
added under the operator's authorization. Verified by two independent hash implementations
(coreutils `sha256sum` and Python `hashlib`) and again by the independent grader.

## 2. Roles, and who said them

`OPERATOR_STATED` means the trader's own words, quoted verbatim below and pinned by test.
`DERIVED_NOT_OPERATOR_STATED` means an engineer's reading of the frames - outranked by any
later direct trader clarification, and never to be mistaken for his words.

### `Desktop 2026.08.19 - 19.49.23.03.mp4` - OPERATOR_STATED

Roles: `1m_causal_decomposition_only`, `forming_5m_force_path`

> i entry on 5 minute; the 1 minute chart is to show what the candles and trade looks like in 1 minute cause the bot uses 1 min candles to equal 5 minute candles; that is already in my files.

FX Replay MNQ 1m view of replayed Tue 10 Jun 2025. The 1m chart is a DEMONSTRATION view of the same trade, not the execution view; entry authority remains 5m. Observed on tape: short, 15 contracts, entry/BE 21839.25, stop 21856.50 (=17.25 points, -517.50 USD), target 21804.25 (+1050.00 USD) filled, price continued to 21787.00; operator then circled the entry cluster near 21855. Audio is silent (max -66.2 dB). The trade facts are measured; the clip is registered ONLY for the 1m-vs-5m decomposition role the operator stated, and may not be cited as a TP-hierarchy example.

### `Desktop 2026.08.15 - 17.13.57.01.mp4` - DERIVED_NOT_OPERATOR_STATED

Roles: `extended_replay_session_mixed_timeframes`

FX Replay MNQ, 3h53m48s, 6.03 GB. CONTENT IS UNENUMERATED - 9 frames sampled in total and this entry may NOT be cited for any specific rule until enumerated. CORRECTED 2026-08-21 after independent grading: an earlier role of extended_5m_zone_replay_session and a claim of a continuous 5m session were REFUTED - at t=12600s the chart is on the 1D DAILY timeframe (header reads 1D), and at t=6800s a Symbol Search dialog is open, so the recording mixes timeframes and contains idle UI navigation rather than continuous trading. Realized PnL is identical at t=1200 and t=6800, so nothing closed across that ~1h33m span; PnL climbing end-to-end says nothing about activity density. Traded at 17 contracts, not the frozen 15; no tick/dollar arithmetic from these frames may be normalised at 15. A PDH text label is drawn on the layout - see pdh_label_disposition.

### `Desktop 2026.08.16 - 23.06.30.02.mp4` - DERIVED_NOT_OPERATOR_STATED

Roles: `zone_long_entry`, `momentum_after_zone_reaction`, `frozen_17_25_stop_in_situ`, `target_reached_full_tp`, `multi_timeframe_15m_and_5m_views`

FX Replay MNQ, 15 contracts, order id 480. A COMPLETE long trade start to finish. Entry/BE 19005.50; stop 18988.25 = 17.25 points exactly (-517.50 USD); TARGET 19143.50 = 138.00 points (+4140.00 USD, and 138 x 2 x 15 = 4140 checks out). The target FILLED on tape: realized PnL steps 76972.00 -> 81112.00, a delta of exactly 4140.00, with unrealized returning to 0.00. Entry was taken off a drawn zone box (~18920-18960, dashed midline 18940) after a green momentum push. CORRECTED 2026-08-21 after full enumeration: an earlier reading called this an MNQ 5-minute clip and recorded only the entry and stop. Both were incomplete - the clip SWITCHES timeframes (15m at t=0-20s, 5m from t=40s), and the whole target leg was missed. The same over-narrow-timeframe error was made on item 5; it is a pattern in frame-sampled readings, not a one-off. The tape ends at t=96s on the FX Replay Analytics/Backtesting dashboard (win-rate donut, performance-by-session New York, Avg RR, Profit), i.e. the operator reviewing aggregate stats - which is NOT strategy evidence and may not be cited as such. A PDH text label is drawn at 19165.75 on both the 15m and 5m layouts - see pdh_label_disposition.

### `Desktop 2026.08.21 - 10.40.34.05.mp4` - OPERATOR_STATED

Roles: `rejection_at_key_level_without_momentum_candle_wait`, `doji_indecision_cluster_is_not_an_entry`, `live_forward_session`, `later_breakout_after_failed_rejection_story`

> this video i was showing how price reject key level but the candle stick patterns was terrible to take a trade you see the first candle sellers was still in control as for the second one and the other ones was doji/indecision candles it wasnt until later probably 15 mins it was a break out

A WAIT / NO-ENTRY teaching example, and the highest-value item in this extension: it is a LIVE worked instance of two of the operator's four frozen WAIT reasons - rejection-without-a-momentum-candle and doji-without-the-second-strong-candle. The key level was genuinely rejected, but the candle STORY never qualified: the first candle after the rejection still had sellers in control, and the following candles were doji/indecision. Pattern location alone is not entry authority; the story and the force must both qualify. The breakout came roughly 15 minutes later, AFTER the recording ends - so the later breakout is the operator's account, not something visible on this tape. CORRECTED 2026-08-21: an earlier DERIVED reading of this clip as zones_marked_no_trade_observation was replaced by the operator's own statement; the passive no-trade framing missed that this is an ACTIVE demonstration of why the setup was refused. Measured context, scoped honestly - the following describes chart HISTORY rendered on screen, readable from any single frame, NOT events observed unfolding across the recording: TradingView LIVE (not FX Replay), symbol MNQU2026 (Sep 2026 front month), 5m, Paper Trading mode, real session 2026-08-21 10:40:38-10:46:53 ET, inside the 09:30-12:00 window. Two drawn S/R zone boxes (upper ~29360-29420 dashed 29380; lower ~29200-29237.75 dashed 29237.75); price sold from the upper band into the lower one, wicked below ~29225 and bounced, and the candles after the bounce are small-bodied. No order placed across the sampled span; the quantity widget reads 17 but no order ticket was filled. Forward-dated: post-dates the 2026-08-17 development-contamination boundary and is therefore fidelity evidence only, NOT edge evidence.

### `Desktop 2026.08.16 - 23.34.40.03.mp4` - NO_EVIDENCE_VALUE

Roles: *none - carries no teachable content*

1.5-second fragment of the FX Replay 5m layout, 15 contracts, zone boxes visible. No trade event and no annotation. Registered for custody completeness only; carries no teachable content and may not be cited as evidence for any rule.

### The three sealed videos

- `Desktop 2026.08.19 - 02.12.06.01.mp4` - `forming_5m_directional_force`, `tug_of_war_giveback`, `entry_before_5m_close_when_force_is_real`
- `Desktop 2026.08.19 - 02.13.19.02.mp4` - `forming_5m_directional_force`, `tug_of_war_giveback`, `entry_before_5m_close_when_force_is_real`
- `Desktop 2026.08.20 - 20.37.47.04.mp4` - `exact_200_dollar_unsafe_tp_example`, `tp1_reaction`, `retest_then_later_momentum_continuation`, `no_blind_tp1_to_tp2_leapfrog`

Their role lists are now pinned field-for-field too. They previously had only a non-empty
check, which meant a sealed role could be replaced with a banned concept and stay green.

## 3. Coverage - how much of each file was actually looked at

A DERIVED role is only as good as the coverage behind it, and nine frames of a 3h54m file is
not a viewing. Coverage is a declared, tested field, not a footnote:

- `Desktop 2026.08.19 - 19.49.23.03.mp4` - 31.8s, 9 frames - role is OPERATOR_STATED so enumeration is not load-bearing
- `Desktop 2026.08.15 - 17.13.57.01.mp4` - 14027.6s, 9 frames - UNENUMERATED, not citable for any specific rule
- `Desktop 2026.08.16 - 23.06.30.02.mp4` - 98.3s, 25 frames at 4s spacing - ENUMERATED
- `Desktop 2026.08.21 - 10.40.34.05.mp4` - 385.7s, 6 frames - role is OPERATOR_STATED so enumeration is not load-bearing. The price-action sentences in its notes describe chart HISTORY that is visible in every frame, not events unfolding during the recording, so they do not depend on frame density; they are scoped in the notes accordingly.
- `Desktop 2026.08.16 - 23.34.40.03.mp4` - 1.5s, 1 frame - ENUMERATED by exhaustion

## 4. Audio

No video in the corpus carries spoken explanation, so no role can be recovered from a soundtrack. Every role is either OPERATOR_STATED in chat or DERIVED from frames - there is no third source.

**Retracted overclaim.** An earlier version of this field said the corpus is silent and that there is NO audio anywhere, based on volumedetect over THREE 60-second windows of item 5. That was an absence claim over ~4h of footage licensed by 3 minutes of it, and MY OWN INSTRUMENT REFUTED IT on re-measurement. Retracted and replaced by the full-track measurement below. Self-caught before the independent grader re-ran.

Method: volumedetect over the COMPLETE audio track of all 8 files (-vn, no video decode; the 3h53m file measures in 6.3s, so the earlier sampling was never necessary), plus silencedetect at -50dB / 0.3s minimum to locate every non-silent span. [MEASURED 2026-08-21]

- Silent end to end, 7 of 8: mean_volume -83 to -84 dB, max_volume -65.7 to -71.2 dB. Dither-floor noise, no content.
- **The exception:** `Desktop 2026.08.20 - 20.37.47.04.mp4` - THIS IS ONE OF THE THREE SEALED VIDEOS and it is NOT silent. Full-track mean_volume -52.9 dB, max_volume -12.2 dB, integrated loudness -22.5 LUFS. Audible span 571.13s to 572.3s = 1.17s. silent from 0.02 to 571.13 and from 572.30 to 613.64.
- Reading of that burst: A single 1.17-second burst near the end of a 613.7s file. 1.17 seconds cannot carry a spoken explanation; consistent with a UI or notification sound. HYPOTHESIS, not measured as such - the content was not transcribed and was NOT sent to any external service.
- Consequence: The no-spoken-explanation claim survives, but only because 1.17s is too short to be narration - NOT because the corpus is silent. Those are different claims and the earlier field conflated them.
- Positive control: A synthesised tone at speech level measures -36.1 dB on the same detector versus -65 to -71 dB for the silent files, so the instrument discriminates content from floor.

## 5. Independent grading (doer != grader)

First pass graded `5341bb6e` at **band 6 BOUNDED**. It confirmed the
packet was substantively sound and convicted four defects I had published:

- semantics_hash AFTER value was published as 77d4a9a9... - REFUTED; the reproducing value at 5341bb6e is bee2303b6...; the BEFORE value c764cdda4... does reproduce
- red-proof ROW1 was published as 3 failed / 4 passed against an 8-test suite (3+4=7); the reproducing count is 4 failed / 4 passed - the guard is STRONGER than advertised
- the instrument note was one-sided: PYTHONUTF8=1 removes 5 cp1252 artifacts but manufactures one of its own (tests/python/test_golden_snapshots.py::TestGoldenSnapshots::test_quantum_mc). Genuinely-failing tests at head = 8, not 9
- item 5 was over-graded MEASURED on frame-sampled inferences - see its corrected notes
- CORRECTED - item 8 was DERIVED as a passive zones_marked_no_trade_observation; the operator then stated it is an ACTIVE why-I-refused-this-setup demonstration. A derived reading was not merely thin here - it was the wrong shape. Recorded as evidence for the role_provenance_law.

Four false-green routes it found were closed:

- PROBE-A: new-video hashes were format-checked only, not identity-checked - now pinned to constants
- PROBE-B: enumerated:false gated nothing; a fabricated role could be appended to the unenumerated entry - roles are now pinned
- PROBE-E: a DERIVED entry could be relabelled OPERATOR_STATED and given invented operator_words - the OPERATOR_STATED set is now closed and pinned
- duration_seconds was falsifiable with no cross-check - now pinned

Re-grade at `1c6fb449`: **band 6 BOUNDED - HELD, not raised.**

> The re-grade was performed by the SAME grader that convicted the first pass, so it was certifying the closure of its own findings and said so itself. That is not a neutral certification. A FRESH grader with no lineage is dispatched against the head that carries this block.

Second-pass findings, closed here:

- F-8 HIGH: operator_words CONTENT was unpinned - only its truthiness was checked, so a quote could be rewritten to say the opposite of what the trader said while provenance, roles, hash and duration all stayed valid. The exact text is now pinned.
- F-9 HIGH: the 3 SEALED videos' roles were truthiness-only - a sealed role list could be replaced with a banned concept and stay green. Sealed roles are now pinned field-for-field, matching the 5 added ones.
- F-11 HIGH: the custody receipt's BODY was never corrected and contradicted the registry, still tagged MEASURED HERE. Root cause named by the grader and accepted: the registry has a guard and the receipt does not, so corrections flowed to the guarded artifact and stopped at the unguarded one - and the unguarded one is the custody document. The receipt is now rewritten AND read by a test.
- F-10 MODERATE: enumeration_status could drift freely from reality - a video could be marked ENUMERATED with no method, the map could contradict the entry, or carry rows for files that do not exist. Now pinned and cross-checked.
- F-12 MODERATE: 'tamper-evident via the fingerprint' was weaker than both of us wrote - semantics_hash moves but its value is anchored nowhere and no tests/ path is fingerprinted, so a consistent registry+test edit reds nothing. Scoped anchor added; see fingerprint_anchor.

What the grader confirmed as sound after deliberate attack: the completeness property that stops a pin being silently deleted; the WAIT-witness guard (5 attacks, all red); the audio retraction guard (5 arms, all red); the item 6 re-enumeration - every load-bearing figure survived independent frame-level attack and first-principles arithmetic.

Still NOT measured by any grader: item 4's frame readings remain RELAYED and have never been counter-sampled by anyone but me; the 1.17s burst's actual content - HYPOTHESIS on both instruments, deliberately not transcribed and not sent to any external service.

## 6. Build fingerprint

The registry is in `fingerprinted_files()`, so its bytes are part of the release identity.
Recorded values, human-checkable, at the commits named:

- `7e79d082` -> `c764cdda4007a5d07ca79f65b3d7e6c56fef77190ea39579165afa81f697fb8f`
- `5341bb6e` -> `bee2303b69fc682f3c4f69ff21cfc061576d1313255ecad9593999d85862715a`

**Retracted:** commit `5341bb6e` originally published the second value as
`77d4a9a916818f52...` and tagged it a measured positive control. It reproduces from no state
either the grader or I could rebuild - a stale value computed mid-edit. The mechanism claim
survives (the hash does move); the number was wrong and is withdrawn.

Anchor scope: The sha256 of THIS registry file's own bytes, pinned in the test file as a third location. Anchoring the whole build fingerprint would red on every unrelated engine edit among its 73 files, and a guard that reds routinely gets its constant updated reflexively - which trains people to ignore it. Scoping the anchor to this file catches the tamper case the grader actually found (a consistent registry + test-constant edit) without coupling to 72 unrelated files.

**Honest limit:** A determined editor can still update all three locations. This does not make tampering impossible; it removes the SILENT property, which is what was claimed and was not true.

## 7. What this receipt does not claim

- No evidence bytes are committed. Only names, hashes, durations, roles and receipts.
- No file left this machine. No audio was transcribed or sent to any external service.
- Video evidence is fidelity evidence, never edge evidence.
- Adding these videos did NOT reopen manual replay collection.
- PR #38 remains DRAFT / DO NOT MERGE.
