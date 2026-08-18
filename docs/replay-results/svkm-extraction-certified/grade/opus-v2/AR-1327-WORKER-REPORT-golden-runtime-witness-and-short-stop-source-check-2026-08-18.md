# AR-1327 -- WORKER REPORT: F61 golden runtime witness (GREEN), F62 short-stop source check (STOP, fail-closed preserved)

RULING : AR-1326A (gpt-rulings `a23f929b7311ce7ca63cd7894dfabf29fff6d841`), section 7 packet A-H, executed in full.
PIN    : working tree `claude/worker1-h1-20260815`, prior HEAD `70ba328cc7daa51d672f0599515b24b73300694d`.

## CHANGED

- **New:** `src/engine/tests/test_svkm_v2_1_golden_runtime_witness.py` (10 tests) -- the F61 exact-artifact golden runtime witness.
- **Regenerated (benign, timing text only):** `docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1_certificate.json` (Stage-1 certifier re-run).
- **Not changed:** `d26dd40a`'s adapter/artifact (kept as baseline per packet item A). No production compiler file was edited -- see FINDINGS for an authorized-scope refusal this produced.
- **Not changed:** `src/engine/extraction/fixtures/svkm_source_risk_canonical.json` (frozen AR-1068 contract) -- the short side did not resolve; F62's own instruction is "do not change the frozen artifact in place" on a non-resolution.

## RED (the exact gap AR-1326A named)

`test_svkm_v2_1_compile.py::test_PRODUCTION_real_artifact_drives_the_5m_range_off_the_5m_frame` calls only `SpecConditionStrategy._h_opening_range()` with the compiled artifact -- it does not drive the artifact through `compute()` / `_build_source_entry_events()` / the real FVG detector / the real stop-map / the real target resolver together. Before this packet, no test exercised the committed `sVkmZklJDHI__s0.spec.json` artifact through the full breakout -> FVG -> third-candle -> stop -> 2R vertical.

## REPAIR

Added `test_svkm_v2_1_golden_runtime_witness.py`. It drives the REAL committed artifact (via `compile_svkm_v2_1_vertical()`, not a hand-built stand-in) through the REAL production consumers: `SpecConditionStrategy(compiled_spec=compiled_artifact, timeframe="1m", opening_range_source_frame=<5m RoleFrame>).compute()`, `_build_source_stop_map()`, `_resolve_source_fixed_r()`. The 1-minute price table reuses `test_source_vertical_join.py`'s already-adversarially-tested OHLC values bar-for-bar (only re-spaced to 1-minute and re-indexed behind a 5-bar pre-lock lead-in) rather than authoring a second numeric fixture from scratch. No second breakout/FVG/stop/target calculator was written (R-736 section 5-1 respected).

Covers, by AR-1326A section 2's own numbering:
1. range from the 5m source frame, not the 1m execution frame (pre-lock 1m bars set to 200/205/195 -- if the engine ever mis-sourced the range from execution bars this would corrupt or_high/or_low and fail loudly);
2. close breakout, not wick (mutation: wick pierces, close does not -> breakout event moves to the next bar);
3. breakout side owns direction, not EMA -- the named EMA-disagreement control: SOURCE_FAITHFUL artifact vs the SAME artifact with `source_risk` stripped (legacy arm), same frame, EMA lean forced bearish; source arm keeps LONG, legacy arm diverges (or the control is void by its own assertion);
4. pre-breakout FVG does not qualify;
5. opposite-direction FVG does not qualify;
6. straddling FVG does not qualify;
7. no entry column bit set before the third candle (`np.flatnonzero(entry_long) == [DECISION_BAR]`);
8. executable long event on the third candle's CLOSE;
9. stop == displacement candle's wick low, tracked exactly under 3 mutated wick values, and shown NOT to track the gap boundary instead;
10. the 2R target is derived by calling the REAL `_resolve_source_fixed_r(strategy)` (reads `spec.source_risk.target.r_multiple` off the actual artifact) and the REAL `_build_source_stop_map(strategy, df)` distance -- not a hard-coded `2.0`/test-local number.

## GREEN

```
python -m pytest src/engine/tests/test_svkm_v2_1_golden_runtime_witness.py -q
10 passed in 1.38s

python -m pytest src/engine/tests/test_svkm_v2_1_golden_runtime_witness.py src/engine/tests/test_svkm_v2_1_compile.py src/engine/tests/test_source_vertical_join.py -q
60 passed in 1.82s

python scripts/source_graph_projection_v2_1_certify.py
overall_status: GREEN_ALL_ITEMS_DONE  (A-I all DONE; J EXTERNAL_NOT_CHECKED_BY_THIS_RUNNER, unchanged)
```

Pre-existing, out-of-scope, unchanged (per AR-1326A section 6, "not ordered into this packet"):
```
python -m pytest src/engine/tests/test_source_band_c_vertical.py -q
12 failed, 11 passed, 7 errors   (identical failure set to what AR-1326 disclosed before this change)
```

## CONTROL

Every negative-control test embeds its own positive-witness assertion (mirroring `test_source_vertical_join.py`'s own discipline) -- e.g. the breakout-attribution test first asserts the UNMUTATED frame attributes the breakout to bar 7 before trusting the mutated result; the EMA control asserts the legacy and source arms actually DIVERGE before trusting either result alone; the gap-boundary test asserts the boundary actually moved before trusting the stop stayed put.

**FINDING AGAINST MYSELF, disclosed rather than hidden:** I attempted one additional production-code mutation kill (temporarily inverting `_REQUIRED_ZONE_DIRECTION` in `src/engine/context/source_entry_events.py`, to prove the new suite catches a real implementation regression, not only input mutations) as an extra rigor step beyond what AR-1326A required. **The worker-1 guard correctly refused the edit**: `source_entry_events.py` is production compiler surface outside this packet's authorized scope (baseline-unchanged per item A). I did not attempt a workaround. I consider the embedded input-mutation positive-witnesses (above) sufficient red-proofing for this packet and did not substitute another mechanism.

## GRADER

Not dispatched. AR-1326A's section 7 packet (A-H) does not itself require an independent grade, and ends at "H. return to GPT" -- GPT is this packet's next reviewing authority per the standing control model (0-CTRL), consistent with how AR-1325A reviewed AR-1326's delivery directly from commit `d26dd40a`. Available on request if GPT rules one is owed.

## FINDINGS

- The refused production-code mutation attempt above (guard enforcement working as intended, not a defect).
- Deselected-test count in the regenerated Stage-1 certificate shifted (9334 -> 9366) purely because this packet's new file added to test collection; not a behavior change, not investigated further.

## F62 -- THE ONE BOUNDED SHORT-STOP SOURCE QUESTION

AR-1326A section 3 asked: for the teacher's SHORT worked example (`click the short tool here`, transcript char ~13320; stop rule span ~13912-14135), what exact price feature does the visible stop line/short-position tool place the stop on? Preferred evidence order: (1) already-archived deterministic frame/screenshot/video evidence in the repo; (2) if absent, retrieve the smallest necessary frame window; (3) if unavailable/unreadable/conflicting/non-unique, keep `UNRESOLVED_SOURCE_AMBIGUITY` and STOP.

**Step (1) found the answer already archived**, and it is on-point: `docs/replay-results/svkm-extraction-certified/grade/visual-stopA/VISUAL-MICRO-PROOF.md` and `.../paired-hires/PAIRED-GEOMETRY-PROOF.md` (AR-1204/AR-1208/AR-1210, both pre-dating this packet). Their frame at caption timestamp `00:12:44.560` carries the caption text *"just going to put it at the bottom of the fair value candle. Really simple. If"* -- the identical sentence anchoring `svkm_source_risk_canonical.json`'s span `{13912,14135}`. Confirmed same worked example; no re-derivation performed (prior-art check, section 0.-0.5).

**Their own conclusion is CONFLICTING / non-unique, exactly the STOP branch of AR-1326A's decision tree:**
- direction is resolved: the TradingView short-position tool's own rendered labels (`Stop:` above the entry line, `Target:` below) confirm a correctly-oriented short, and a paired long example independently corroborates the taught `Risk/Reward Ratio: 2` from the tool's own printed text;
- the ANCHOR is not resolved: at the available resolution (360p and 1080p re-shoots), the stop line sits at the FVG rectangle's upper edge / the highlighted candle's upper extreme, and the archived proof states outright it **cannot separate** two live readings -- `displacement_candle_high` (candle extreme) vs `fvg_high` (gap boundary) -- "the stop line and the rectangle edge are close enough that I will not call it";
- **the teacher's WORDS and his own SHORT CHART disagree**: he says *"bottom of the fair value candle"* while his own tool places the stop **above** entry -- a wording/ASR-artifact possibility the archived proof explicitly declines to resolve either way;
- the archived proof's own conclusion: *"promoting it to source authority is a ruling, not a worker call"* -- and no such ruling has landed; `svkm_source_risk_canonical.json.short_side.status` remains `UNRESOLVED_SOURCE_AMBIGUITY` today, unchanged by this packet.

**Disposition: F62 does NOT resolve.** No short-side anchor is invented, `displacement_candle_high` remains unmapped, the frozen AR-1068 artifact is untouched, and the short arm stays fail-closed exactly as AR-1326A's F62 required on a non-resolution. This is a genuine STOP, not a deferral: the bounded question was asked and answered "conflicting, non-unique" by evidence already in the tree, and re-shooting frames would re-open an already-run, already-inconclusive visual investigation rather than answer anything new.

## STOP

F62 (short-stop anchor): the bounded evidence question returns CONFLICTING/non-unique, per already-archived visual evidence. Preserved fail-closed. No further visual/extraction work is authorized by this finding -- promoting the archived evidence to source authority (were it ever to resolve) is a ruling, not a worker call.

## NEXT

Returning to GPT per packet item H. No self-authorized next item: AR-1326A's packet ends at "H", and Stage 3 (Strategy Factory) remains explicitly LOCKED pending GPT's read of this delivery.
