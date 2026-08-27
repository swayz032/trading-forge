# Video corpus custody receipt (operator-supplied full set, 2026-08-21)

Status: **LANDED.** The operator authorized the addition (*"and it gets added"*) and
then handed this seat the landing (*"do it yourself"*). All eight of his videos are
bound into the unified fidelity evidence registry, which is build-fingerprinted.

**This file is rendered by `research/gen_video_corpus_receipt.py` and verified by
re-rendering inside the test suite.** That mechanism is real and you can check it:
the test imports `render()`, rebuilds this document in memory from the registry, and
compares byte-for-byte against the committed file. Editing the registry without
regenerating goes red; editing this file by hand goes red.

It was not always real. An earlier version of this receipt asserted in bold that it
was generated from the registry when NO generator existed anywhere in the repository.
A fresh independent grader with no lineage in the work found it: the text happened to
be faithful, but the mechanism was fiction and the failure class it claimed to have
removed was still live. A false mechanism claim inside a custody document is worse
than the drift it was covering for, because it stops the next reader looking.

---

## 1. Custody — all 8 files, hash-verified on disk

| # | File | Location | sha256 | Duration | Provenance |
|---|---|---|---|---|---|
| 1 | `Desktop 2026.08.19 - 02.12.06.01.mp4` | `C:/Users/tonio/Videos/NVIDIA/Desktop/` | `1e39083c6a807802…` | — | SEALED_2026_08_20_NO_PROVENANCE_RECORDED |
| 2 | `Desktop 2026.08.19 - 02.13.19.02.mp4` | `C:/Users/tonio/Videos/NVIDIA/Desktop/` | `95bcbb3f7bf38933…` | — | SEALED_2026_08_20_NO_PROVENANCE_RECORDED |
| 3 | `Desktop 2026.08.20 - 20.37.47.04.mp4` | `C:/Users/tonio/Videos/NVIDIA/Desktop/` | `218ca9bb827db2c5…` | — | SEALED_2026_08_20_NO_PROVENANCE_RECORDED |
| 4 | `Desktop 2026.08.19 - 19.49.23.03.mp4` | `C:/Users/tonio/Videos/NVIDIA/Desktop/` | `74b1585768e77dc3…` | 31.8s | OPERATOR_STATED |
| 5 | `Desktop 2026.08.15 - 17.13.57.01.mp4` | `C:/Users/tonio/Pictures/` | `7dbc51c72d8b638a…` | 14027.6s | DERIVED_NOT_OPERATOR_STATED |
| 6 | `Desktop 2026.08.16 - 23.06.30.02.mp4` | `C:/Users/tonio/Pictures/` | `8f4020a8aa7dd6fa…` | 98.3s | DERIVED_NOT_OPERATOR_STATED |
| 7 | `Desktop 2026.08.21 - 10.40.34.05.mp4` | `C:/Users/tonio/Videos/NVIDIA/Desktop/` | `08e87682f683db1b…` | 385.7s | OPERATOR_STATED |
| 8 | `Desktop 2026.08.16 - 23.34.40.03.mp4` | `C:/Users/tonio/Pictures/` | `da8b6c2e4f53f26c…` | 1.5s | NO_EVIDENCE_VALUE |

Hashes were verified by two independent implementations and re-verified from disk by
two independent graders. The hash is the real binding; the path is recorded so the
verification is re-locatable, since three of the eight files are not where the other
five are.

## 2. Roles, and who said them

`OPERATOR_STATED` is the trader's own words, quoted verbatim and pinned by test.
`DERIVED_NOT_OPERATOR_STATED` is an engineer's reading of the frames — outranked by
any later direct trader clarification, and never to be mistaken for his words.

### `Desktop 2026.08.19 - 19.49.23.03.mp4` — OPERATOR_STATED

Roles: `1m_causal_decomposition_only`, `forming_5m_force_path`

> i entry on 5 minute; the 1 minute chart is to show what the candles and trade looks like in 1 minute cause the bot uses 1 min candles to equal 5 minute candles; that is already in my files.

FX Replay MNQ 1m view of replayed Tue 10 Jun 2025. The 1m chart is a DEMONSTRATION view of the same trade, not the execution view; entry authority remains 5m. Observed on tape: short, 15 contracts, entry/BE 21839.25, stop 21856.50 (=17.25 points, -517.50 USD), target 21804.25 (+1050.00 USD) filled, price continued to 21787.00; operator then circled the entry cluster near 21855. Audio is silent (max -66.2 dB), full-track. ENUMERATION 2026-08-21, closing the gap both graders listed as never counter-sampled: the clip's arc is now mapped end to end at 3.8% frame coverage - trade open with lines on the right edge through t=12s; the fill occurs between t=9s (unrealized +802.50) and t=13s (realized 126353.25, unrealized 0.00), bracketing the scene transition at t=12.61s; a tool menu opens around t=19-21s; the red circle is drawn and then present in every frame from t=24s to the end. The figures above remain MINE ALONE - no independent party has counter-sampled them at any pin. The trade facts are measured; the clip is registered ONLY for the 1m-vs-5m decomposition role the operator stated, and may not be cited as a TP-hierarchy example.

### `Desktop 2026.08.15 - 17.13.57.01.mp4` — DERIVED_NOT_OPERATOR_STATED

Roles: `extended_replay_session_mixed_timeframes`

FX Replay MNQ, 3h53m48s, 6.03 GB. CONTENT IS UNENUMERATED - 9 frames sampled in total and this entry may NOT be cited for any specific rule until enumerated. CORRECTED 2026-08-21 after independent grading: an earlier role of extended_5m_zone_replay_session and a claim of a continuous 5m session were REFUTED - at t=12600s the chart is on the 1D DAILY timeframe (header reads 1D), and at t=6800s a Symbol Search dialog is open, so the recording mixes timeframes and contains idle UI navigation rather than continuous trading. Realized PnL is identical at t=1200 and t=6800, so nothing closed across that ~1h33m span; PnL climbing end-to-end says nothing about activity density. Traded at 17 contracts, not the frozen 15; no tick/dollar arithmetic from these frames may be normalised at 15. A PDH text label is drawn on the layout - see pdh_label_disposition.

### `Desktop 2026.08.16 - 23.06.30.02.mp4` — DERIVED_NOT_OPERATOR_STATED

Roles: `zone_long_entry`, `momentum_after_zone_reaction`, `frozen_17_25_stop_in_situ`, `target_reached_full_tp`, `multi_timeframe_15m_and_5m_views`

FX Replay MNQ, 15 contracts, order id 480. A COMPLETE long trade start to finish. Entry/BE 19005.50; stop 18988.25 = 17.25 points exactly (-517.50 USD); TARGET 19143.50 = 138.00 points (+4140.00 USD, and 138 x 2 x 15 = 4140 checks out). The target FILLED on tape: realized PnL steps 76972.00 -> 81112.00, a delta of exactly 4140.00, with unrealized returning to 0.00. Entry was taken off a drawn zone box (~18920-18960, dashed midline 18940) after a green momentum push. CORRECTED 2026-08-21 after full enumeration: an earlier reading called this an MNQ 5-minute clip and recorded only the entry and stop. Both were incomplete - the clip SWITCHES timeframes (15m at t=0-20s, 5m from t=40s), and the whole target leg was missed. The same over-narrow-timeframe error was made on item 5; it is a pattern in frame-sampled readings, not a one-off. The tape ends at t=96s on the FX Replay Analytics/Backtesting dashboard (win-rate donut, performance-by-session New York, Avg RR, Profit), i.e. the operator reviewing aggregate stats - which is NOT strategy evidence and may not be cited as such. A PDH text label is drawn at 19165.75 on both the 15m and 5m layouts - see pdh_label_disposition.

### `Desktop 2026.08.21 - 10.40.34.05.mp4` — OPERATOR_STATED

Roles: `rejection_at_key_level_without_momentum_candle_wait`, `doji_indecision_cluster_is_not_an_entry`, `live_forward_session`, `later_breakout_after_failed_rejection_story`

> this video i was showing how price reject key level but the candle stick patterns was terrible to take a trade you see the first candle sellers was still in control as for the second one and the other ones was doji/indecision candles it wasnt until later probably 15 mins it was a break out

A WAIT / NO-ENTRY teaching example, and the highest-value item in this extension: it is a LIVE worked instance of two of the operator's four frozen WAIT reasons - rejection-without-a-momentum-candle and doji-without-the-second-strong-candle. The key level was genuinely rejected, but the candle STORY never qualified: the first candle after the rejection still had sellers in control, and the following candles were doji/indecision. Pattern location alone is not entry authority; the story and the force must both qualify. The breakout came roughly 15 minutes later, AFTER the recording ends - so the later breakout is the operator's account, not something visible on this tape. CORRECTED 2026-08-21: an earlier DERIVED reading of this clip as zones_marked_no_trade_observation was replaced by the operator's own statement; the passive no-trade framing missed that this is an ACTIVE demonstration of why the setup was refused. Measured context, scoped honestly - the following describes chart HISTORY rendered on screen, readable from any single frame, NOT events observed unfolding across the recording: TradingView LIVE (not FX Replay), symbol MNQU2026 (Sep 2026 front month), 5m, Paper Trading mode, real session 2026-08-21 10:40:33-10:46:59 ET. CORRECTED - an earlier version published this span as 10:40:38-10:46:53, which is the span of my SIX SAMPLED FRAMES (t=5s and t=380s), not of the recording. The file runs 385.7s and both true endpoints are read directly off the TradingView wall clock at t=0 and t=385.5. This was the SIXTH instance of the sample-as-population defect, and it was minted INSIDE the sentence written to scope such claims honestly - a wall-clock SPAN needs two frames and is not "readable from any single frame". Found by the fresh independent grader and reproduced here before correcting. Session context, inside the 09:30-12:00 window. Two drawn S/R zone boxes (upper ~29360-29420 dashed 29380; lower ~29200-29237.75 dashed 29237.75); price sold from the upper band into the lower one, wicked below ~29225 and bounced, and the candles after the bounce are small-bodied. No order placed across the sampled span; the quantity widget reads 17 but no order ticket was filled. Forward-dated: post-dates the 2026-08-17 development-contamination boundary and is therefore fidelity evidence only, NOT edge evidence.

### `Desktop 2026.08.16 - 23.34.40.03.mp4` — NO_EVIDENCE_VALUE

Roles: *none — carries no teachable content*

1.5-second fragment of the FX Replay 5m layout, 15 contracts, zone boxes visible. No trade event and no annotation. Registered for custody completeness only; carries no teachable content and may not be cited as evidence for any rule.

### The three videos sealed on 2026-08-20

**Their provenance is NOT RECORDED — not by the seal, and not here.** Their entries
carry exactly three fields (name, roles, sha256) with no method, coverage or
derivation basis. They are listed separately for that reason: a reader must not take
the most authoritative evidence in this corpus for the trader's own words, because
nothing says whether it is.

- `Desktop 2026.08.19 - 02.12.06.01.mp4` — `forming_5m_directional_force`, `tug_of_war_giveback`, `entry_before_5m_close_when_force_is_real`
- `Desktop 2026.08.19 - 02.13.19.02.mp4` — `forming_5m_directional_force`, `tug_of_war_giveback`, `entry_before_5m_close_when_force_is_real`
- `Desktop 2026.08.20 - 20.37.47.04.mp4` — `exact_200_dollar_unsafe_tp_example`, `tp1_reaction`, `retest_then_later_momentum_continuation`, `no_blind_tp1_to_tp2_leapfrog`

## 3. Coverage — frames read of frames total

A derived role is only as good as the coverage behind it. Every claim states its
denominator in the same sentence, and EXHAUSTIVE requires literal 100%:

- `Desktop 2026.08.19 - 19.49.23.03.mp4` — 31.8s, 1907 frames total, 73 frames read = 3.8% coverage (9 high-resolution reads plus a 64-frame contact sheet at 2fps spanning the whole clip). UNENUMERATED - 3.8% is not enumeration and this row does not claim it is. Coverage is bounded from the other side as well: scene-change detection at default verbosity finds exactly SIX layout transitions in the clip, at t=6.49, 9.96, 12.61, 12.64, 18.81 and 20.66s, and the 2fps walk has frames bracketing all six. Caveat, measured elsewhere in this block: scene detection catches CUTS, not gradual change, so a slow price drift between frames would not register. Role is OPERATOR_STATED so enumeration is not load-bearing for the role; the trade figures below ARE frame-derived at this coverage.
- `Desktop 2026.08.15 - 17.13.57.01.mp4` — 14027.6s, ~841700 frames total (60fps x duration, derived not counted - counting would require decoding 6.03 GB), 9 frames read = ~0.001% coverage. UNENUMERATED. Not citable for any specific rule until enumerated.
- `Desktop 2026.08.16 - 23.06.30.02.mp4` — 98.3s, 5898 frames total, 25 frames read at 4s spacing = 0.42% coverage, plus a full-track audio pass. ENUMERATED for the trade lifecycle: entry, timeframe switch, target fill and the analytics tail were each witnessed on a read frame. 0.42% is NOT exhaustive and this row does not claim it is.
- `Desktop 2026.08.21 - 10.40.34.05.mp4` — 385.7s, 23137 frames total, 6 frames read = 0.026% coverage - UNENUMERATED, and 0.026% does not get called anything else. Role is OPERATOR_STATED, so enumeration is not load-bearing for the role. The price-action sentences in its notes describe chart HISTORY rendered on screen and readable from any single frame, not events observed unfolding, so they do not depend on frame density; they are scoped in the notes accordingly.
- `Desktop 2026.08.16 - 23.34.40.03.mp4` — 1.5s, 90 frames total, 90 frames read = 100% coverage, EXHAUSTIVE. Read as a single 10x9 contact sheet of every decoded frame. All 90 are the same FX Replay 5m layout; the ONLY variation across the clip is the 'Recording has started' toast fading out over roughly the first 8 frames. No trade event, no annotation, no dialog.

## 4. Audio

No video in the corpus carries spoken explanation, so no role can be recovered from a soundtrack. Every role is either OPERATOR_STATED in chat or DERIVED from frames - there is no third source.

**Retracted over-claim.** An earlier version of this field said the corpus is silent and that there is NO audio anywhere, based on volumedetect over THREE 60-second windows of item 5. That was an absence claim over ~4h of footage licensed by 3 minutes of it, and MY OWN INSTRUMENT REFUTED IT on re-measurement. Retracted and replaced by the full-track measurement below. Self-caught before the independent grader re-ran.

Method: volumedetect over the COMPLETE audio track of all 8 files (-vn, no video decode; the 3h53m file measures in 6.3s, so the earlier sampling was never necessary), plus silencedetect at -50dB / 0.3s minimum to locate every non-silent span. [MEASURED 2026-08-21]

- Silent end to end, 7 of 8: mean_volume -83 to -84 dB, max_volume -65.7 to -71.2 dB. Dither-floor noise, no content.
- **The exception:** `Desktop 2026.08.20 - 20.37.47.04.mp4` — THIS IS ONE OF THE THREE SEALED VIDEOS and it is NOT silent. Full-track mean_volume -52.9 dB, max_volume -12.2 dB, integrated loudness -22.5 LUFS. Audible span 571.13s→572.3s = 1.17s. silent from 0.02 to 571.13 and from 572.30 to 613.64.
- Reading: Two steady narrowband tones a musical fifth apart - a designed notification chime. MEASURED on my own instrument (ffmpeg extraction to 16 kHz mono WAV, numpy FFT over the active span, all local): dominant bins 197 Hz and 292 Hz, ratio 1.486 where a perfect fifth is 1.500; 99.9% of spectral energy in 100-400 Hz; 0.0% in 1-4 kHz and 0.0% in 4-8 kHz; centroid 249 Hz; active span 0.88s, peak -12.2 dBFS. Intelligible speech REQUIRES substantial 1-4 kHz energy (F2/F3 formants) and consonant energy above 4 kHz. There is none. The content was NOT transcribed and was NOT sent to any external service. Held as HYPOTHESIS for what the chime IS; the exclusion of speech is MEASURED.
- **Retracted reasoning:** An earlier version of this block justified the no-speech conclusion by DURATION - '1.17 seconds cannot carry a spoken explanation'. The independent grader refuted that and it is accepted: conversational English runs 4-6 syllables per second, so 1.17s carries 4-7 syllables, which is easily 'that's the retest' or 'there's the entry' - a complete teaching statement about a TP. Duration does NOT rule out speech. The right answer was reached by the wrong reason, and the reason has been replaced by the spectral measurement above. This is the same defect as the retraction it was correcting.
- Consequence: No video carries spoken explanation. That now rests on a spectral measurement of the only audible span in the corpus, not on its duration and not on an assumption of silence - three different claims that earlier versions of this block conflated in turn.
- Positive control: A synthesised tone at speech level measures -36.1 dB on the same detector versus -65 to -71 dB for the silent files, so the instrument discriminates content from floor.
- Operator: ANSWERED 2026-08-21. He was asked whether he remembered making a sound or speaking on the 2026.08.20 recording. His answer: he explained nothing in any video. No further listen is owed and none is requested.

## 5. Independent grading (doer ≠ grader)

First grader, commit `5341bb6e` — **band 6 BOUNDED**.
Defects it convicted, which the doer had published:

- semantics_hash AFTER value was published as 77d4a9a9... - REFUTED; the reproducing value at 5341bb6e is bee2303b6...; the BEFORE value c764cdda4... does reproduce
- red-proof ROW1 was published as 3 failed / 4 passed against an 8-test suite (3+4=7); the reproducing count is 4 failed / 4 passed - the guard is STRONGER than advertised
- the instrument note was one-sided: PYTHONUTF8=1 removes 5 cp1252 artifacts but manufactures one of its own (tests/python/test_golden_snapshots.py::TestGoldenSnapshots::test_quantum_mc). Genuinely-failing tests at head = 8, not 9
- item 5 was over-graded MEASURED on frame-sampled inferences - see its corrected notes
- CORRECTED - item 8 was DERIVED as a passive zones_marked_no_trade_observation; the operator then stated it is an ACTIVE why-I-refused-this-setup demonstration. A derived reading was not merely thin here - it was the wrong shape. Recorded as evidence for the role_provenance_law.

False-green routes it found, since closed:

- PROBE-A: new-video hashes were format-checked only, not identity-checked - now pinned to constants
- PROBE-B: enumerated:false gated nothing; a fabricated role could be appended to the unenumerated entry - roles are now pinned
- PROBE-E: a DERIVED entry could be relabelled OPERATOR_STATED and given invented operator_words - the OPERATOR_STATED set is now closed and pinned
- duration_seconds was falsifiable with no cross-check - now pinned

**Scope:** The first grader's band 6 BOUNDED is scoped to commit 1c6fb449 and EXPIRES THERE. It stated explicitly that it has not verified, and cannot verify, anything at f9c536ff or later - including the suite figures and the receipt guard - because its last measurement pin predates them. Its band must not be read as covering commits it never touched. A fresh grader with no lineage holds the verdict on the current head.

The grader flagged its own instrument error back to me unprompted, found the root cause, and asked me to correct the registry entry that had retired a working tool on its behalf. The denominator rule it minted applies to graders identically: '0 scene changes' reported with no stated control is itself a conclusion at the confidence of an unverified method. Recorded because a grading loop where only the doer is corrected is not a grading loop.

Re-grade at `1c6fb449` — band 6 BOUNDED, HELD.

> The re-grade was performed by the SAME grader that convicted the first pass, so it was certifying the closure of its own findings and said so itself. That is not a neutral certification. A FRESH grader with no lineage is dispatched against the head that carries this block.

- F-8 HIGH: operator_words CONTENT was unpinned - only its truthiness was checked, so a quote could be rewritten to say the opposite of what the trader said while provenance, roles, hash and duration all stayed valid. The exact text is now pinned.
- F-9 HIGH: the 3 SEALED videos' roles were truthiness-only - a sealed role list could be replaced with a banned concept and stay green. Sealed roles are now pinned field-for-field, matching the 5 added ones.
- F-11 HIGH: the custody receipt's BODY was never corrected and contradicted the registry, still tagged MEASURED HERE. Root cause named by the grader and accepted: the registry has a guard and the receipt does not, so corrections flowed to the guarded artifact and stopped at the unguarded one - and the unguarded one is the custody document. The receipt is now rewritten AND read by a test.
- F-10 MODERATE: enumeration_status could drift freely from reality - a video could be marked ENUMERATED with no method, the map could contradict the entry, or carry rows for files that do not exist. Now pinned and cross-checked.
- F-12 MODERATE: 'tamper-evident via the fingerprint' was weaker than both of us wrote - semantics_hash moves but its value is anchored nowhere and no tests/ path is fingerprinted, so a consistent registry+test edit reds nothing. Scoped anchor added; see fingerprint_anchor.

Fresh grader, no lineage, commit `f9c536ff` — **band 6 BOUNDED**.

- F-1 HIGH: the receipt claimed to be GENERATED FROM THE REGISTRY and to have removed a failure class, while no generator existed in the repo. False mechanism claim inside the custody document. A real generator now exists and the test derives from it.
- F-2 HIGH: the sixth false-green. `notes` was the last substantive field with no third location - falsifying item 6's target price and PnL step, then re-anchoring, passed every test. Load-bearing figures are now pinned with their arithmetic.
- F-3 MODERATE: the enumeration cross-check keyed on an `enumerated` boolean that five of eight entries did not carry, so neither branch fired. Now required on every added entry.
- F-5 MODERATE: a guard PINNED THE WEAKER CLAIM - asserting HYPOTHESIS in the audio reading meant a genuine improvement to that field went RED. Relaxed so the field can get stronger without editing the guard.
- F-6 MODERATE: the three sealed videos' roles carry no provenance label and the guard skips them. Labelled explicitly rather than guessed.
- F-7 LOW: no file paths were recorded, so 'hash-verified on disk' was not re-locatable. Three of eight files are in Pictures, not Videos/NVIDIA/Desktop. Paths now recorded.

What it verified closed: Item 4 fully counter-sampled for the first time by anyone - every figure confirmed to the cent, including the 17.25-point stop, the 35-point target, the exact 1050.00 fill and the 125303.25 -> 126353.25 step, plus a 1-second header enumeration across all 32s confirming no timeframe switch. The audio disposition reproduces to the digit. Three red-proof arms reproduce the published counts exactly. Zero introduced failures confirmed via a stronger path: git diff over src/ is empty.

Its own retractions, recorded because a grader that corrects itself in public is
worth more than one that does not: It retracted three of its own findings mid-grade - a registry/receipt contradiction that was an artifact of reading the moving worktree against its pinned tree; a spectral refutation that was its own magnitude-vs-power basis error; and two absence answers biased by `-v error` and by files being in another directory. It caught all of them with positive controls.

## 5b. Session-span arithmetic

The published wall-clock span was 375s while the file is 385.7s. Nothing checked that a stated session span equals the recording it describes. Now it must close.

- `Desktop 2026.08.21 - 10.40.34.05.mp4` — 10:40:33→10:46:59 (386s) against a file duration of 385.7s. Read at t=0 and t=385.5, cropped to the clock and read directly. **Retracted:** 10:40:38-10:46:53 (375s) - the span of 6 sampled frames.

## 6. The denominator rule

**Every MEASURED claim about a video states its denominator IN THE SAME SENTENCE - frames read of frames total, seconds scanned of seconds total. A claim that cannot state its denominator is not MEASURED.**

Named by the independent grader after five convictions, and it is not 'sampling'. All five share one move: STATE THE CONCLUSION AT THE CONFIDENCE OF THE METHOD YOU WISH YOU HAD USED, then record the method actually used somewhere else, or not at all.

- item 5: 9 frames read, a continuous-5m property asserted of the whole clip - refuted, it contains 1D daily segments
- item 6: 25 frames read only on the second pass; the first pass asserted entry-and-stop as the whole trade and missed the entire 138-point target leg
- audio: 3 windows of 60s, silence asserted of ~4 hours - refuted, one sealed video is not silent
- item 7: 1 frame of 90 labelled 'ENUMERATED by exhaustion' - 1.1% coverage described with the word exhaustive
- the burst: duration reasoned, spectrum never measured - right answer, wrong reason, inside the retraction that was correcting the same defect
- item 8: the published session wall-clock span 10:40:38-10:46:53 was the span of the SIX SAMPLED FRAMES, not of the 385.7s recording, which runs 10:40:33-10:46:59. Minted inside the sentence written to scope the other instances honestly.

Instances 4, 5 and 6 were found INSIDE the corrections for the earlier ones. The defect has now survived its own repair THREE times - an earlier version of this note said twice, which was itself an undercount published before instance 6 was found. That is why it is a rule with tests and arithmetic, and not a resolution to be careful.

## 7. Instruments

A blind detector and a true negative are the same output. Recorded so the next seat does not re-run these and believe them - and CORRECTED once, because the first version of this block retired a working tool.

**Correction:** An earlier version of this block recorded ffmpeg scene-change detection as a FAILED, BLIND instrument. That was WRONG and it was a false claim landed in this registry. The independent grader caught it, found the root cause in its own invocation, and sent it back; I reproduced the fix before accepting it. The tool works. Retiring a working detector on the strength of a broken flag would have cost the next seat a real instrument.

**The actual trap.** `-v error` silences filters that report through the LOG at info level. The command succeeds, prints nothing, and a grep -c returns 0. A blank output is indistinguishable from a genuine zero. Affected: `showinfo`, `volumedetect`, `silencedetect`, `ebur128`, `blackdetect`, `signalstats + metadata=print`. Identical scene-detect command on item 6, which is KNOWN to change (it switches 15m -> 5m on tape): with `-v error` -> 0 hits. With default verbosity -> 264 hits. Same file, same filter, same threshold. The only difference is the verbosity flag. Three times in one session, across two different people and three different filters. It was diagnosed twice and then made again on a third filter without re-checking. This trap is worth more recorded than any tool it appeared to discredit.

- Scene detection: WORKS. Not retired. select='gt(scene,0.003)' with showinfo at DEFAULT verbosity discriminates cleanly: item 6 (known to change) 264 hits, item 7 (the 1.5s fragment) 0 hits. It detects scene CUTS, not ACTIVITY. The 08-21 live chart returns 0 across its whole 6m26s even though price is ticking, because tick updates are not cuts. A 0 from this tool means 'no layout change', NOT 'nothing happened'. Reading it as the latter is the mistake to avoid.
- Pixel difference: PARTLY CONFOUNDED, not blind. The grader's counter-hypothesis was correct and I tested it. Item 7 measures 0.0093 across all 90 frames but 0.0049 over frames 15-90. That drop correctly detects the 'Recording has started' toast fading over roughly the first 8 frames - real change that is not a scene cut. My original reading was a TRUE reading of genuinely different content. Item 7 after the toast still measures 0.0049 against 0.0003 for a live ticking chart - 16x higher for the more static clip. The metric is dominated by per-file encoder noise, so absolute values are NOT comparable between recordings. Use it within one file, never to rank two.
- MSYS-style paths (/c/Users/...) silently produce ZERO frames when passed to ffmpeg from Windows Python. The failure looks like an empty clip, not an error. Same shape as the verbosity trap: a blank result reading as a measured zero.

## 8. Finding against the 2026-08-20 seal — recorded, NOT repaired

MEASURED at commit 7e79d082, by vocabulary enumeration over the seal registry. 'sha256' returns 17 hits, so the enumeration instrument works.

Zero-hit terms: `audio`, `sound`, `narrat`, `transcri`, `examin`, `exhaust`, `coverage`, `sampled`, `method`, `enumerat`.
Sealed entry shape: `name`, `roles`, `sha256`.

- Does NOT convict: The seal never CLAIMED full examination, so discovering unexamined audio in a sealed video convicts it of no false statement.
- DOES establish: Audio was never considered for ANY video at seal time - the word appears zero times across the registry and both manifests it references. The hypothesis that the original sealing looked at pictures only is now MEASURED, not inferred.
- The real gap: The seal asserts semantic ROLES for three videos with no recorded method, coverage, or derivation basis of any kind. That is not a false claim, it is an UNFALSIFIABLE one - there is nothing to check it against. The key name 'verified_video_evidence' is a caption doing unearned work.
- Asymmetry: The 5 videos added 2026-08-21 carry role_provenance, enumeration_status with denominators, and a stated method. The 3 sealed ones carry none. The founding evidence is the least accountable evidence in the file.
- Disposition: Recorded, NOT repaired. Re-deriving the sealed roles is a separate packet and is not this seat's to authorise - it would mean re-opening three videos the operator already sealed. Flagged for the roadmap.

## 9. What this receipt does not claim

- No evidence bytes are committed — only names, paths, hashes, durations and roles.
- No file left this machine. No audio was transcribed or sent to any external service.
- Video evidence is fidelity evidence, never edge evidence.
- Adding these videos did NOT reopen manual replay collection.
- PR #38 remains DRAFT / DO NOT MERGE.
