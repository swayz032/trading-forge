# AR-1342

RULING : AR-1340A S6 (pilot continuation) / AR-1338A S3 (pilot integrity receipt)
PIN    : working tree `claude/worker1-h1-20260815` @ `64aa9c92` (guard fix `6d59d63e` applied
         by operator between AR-1341 and this report -- thank you)
CHANGED: `docs/replay-results/strategy-factory-census/extraction-vault/preps/
         75DJN5UVQnw__s0.{stage1_answers,stage2_answers}.json` (new, real single-rater dispatch
         answers); `.certificate.json` regenerated with real verdicts

## PILOT RESULT: INTEGRITY GREEN. 0/3 VIDEOS COMPILE. ALL 3 REFUSE WITH REAL, DISTINCT EVIDENCE.

Per AR-1338A S3 stable source ordering (skipping sVkm per AR-1338A S3 "do not count sVkm as one
of the 3"): `75DJN5UVQnw`, `FqxEKDxemtI`, `E8Wg6tFPYjo`.

### Video 1/3 -- `75DJN5UVQnw` (-> `5m_minute_support_level_{mcl,mes,mnq}_5m`)

Real extraction: 1 strategy, 13 spine conditions, 0 unanchored, 13/13 fell through tier-1 to
tier-3. Dispatched Stage-1 (blind role, 10 Set-A + 13 Set-B, ONE agent call) and Stage-2 (revealed
support, 13 items, ONE agent call) per AR-1340A S3's single-pass-per-strategy bar.

- **Control gate: PASSED** (5/5 gate-direction, 5/5 context-direction, both perfect).
- **Stage-2 support: 8 confirmed, 5 partial, 0 denied.**
- `finalize_certificate`: `classification_fallthrough_unresolved=5` (every `partial`-support
  condition is downgraded per Addendum 4 -- non-`confirmed` support is treated like an
  unresolved fall-through) -> **`pilot_grade=False`**.
- **Deterministic rerun**: re-ran `finalize` on the identical frozen prep + identical answer
  files twice; `pilot_grade` and the full `diagnosis` dict were byte-identical both times.
- **Disposition -> `OTHER_MEASURED_REFUSAL`.** No closer class fits: the source is not
  self-contradictory (`SOURCE_AMBIGUOUS`), nothing required is structurally absent
  (`EXTRACTION_MISSING_REQUIRED_INFORMATION`/`SOURCE_INCOMPLETE` -- the extractor produced a
  complete, well-formed strategy), and no engine primitive or market/timeframe question is in
  play. The actual failure is condition-level: 5 of 13 extracted condition PARAPHRASES drift from
  what their located quote literally supports (Stage-2 `partial`), which is exactly the fidelity
  question this project's own certification apparatus exists to catch, and none of the 11 named
  categories describes "extractor paraphrase not faithfully grounded in its own located quote."

### Video 2/3 -- `FqxEKDxemtI` (-> `ballinger_bands_{mcl,mes,mnq}_5m`)

Real extraction: 0 strategies. The extractor itself refused --
`{"reason": "fixed_point_stop_not_supported", "detail": "The speaker uses fixed pip distances
for stop placement (e.g., '20 Pips below the swing low'), which violates the framework's ban on
fixed-point stops."}`. No certification dispatch needed or spent -- there is no strategy object
to certify.

- **Disposition -> `OTHER_MEASURED_REFUSAL`.** Not `SOURCE_INCOMPLETE`/`SOURCE_AMBIGUOUS` (the
  source is complete and unambiguous -- it teaches a fixed-point stop); the closest project rule
  this actually violates (CLAUDE.md's own structural-stop invariant, "stops are structural,
  NEVER fixed-point") has no dedicated disposition category, so `OTHER_MEASURED_REFUSAL` with
  this exact evidenced reason is correct rather than forcing a mismatched category.

### Video 3/3 -- `E8Wg6tFPYjo` (-> `bos_and_fvg_or_fvg_{mcl,mes,mnq}_15m`)

Real extraction: 1 strategy, 16 spine conditions, **9 unanchored** (`anchor_locator` could not
verify a literal-substring anchor for the extractor's proposed quotes on 9/16 conditions --
`proposed_quote_not_literal_substring`), 7 anchored-but-fell-through.

- Per `finalize_certificate`'s own unconditional rule, any unanchored condition forces
  `pilot_grade=False` regardless of tier-3 outcome -- **no dispatch could change this result**, so
  none was spent (AR-1340A S1: "A retry is allowed only for a measured infrastructure/transport
  failure... A semantic FAIL is a result, not a retry trigger" -- the analogous principle applies
  to not spending a dispatch whose answer cannot move the outcome).
- **Disposition -> `EXTRACTION_MISSING_REQUIRED_INFORMATION`.** More than half the conditions
  (9/16) have no literal transcript evidence the mechanical verifier can confirm -- the required
  grounding evidence for those conditions does not exist in a form the certifier can use, which is
  exactly this category's own definition.

## PROJECTED MANIFEST-ROW DISPOSITIONS (9 rows, 3 per video)

| strategy_id | name | video | disposition |
|---|---|---|---|
| 97fabc41-f55b-4a20-a020-c28d6b7ffb54 | 5m_minute_support_level_mcl_5m | 75DJN5UVQnw | OTHER_MEASURED_REFUSAL |
| 9f38ab7a-9a3d-4771-bdfb-13c1cd067536 | 5m_minute_support_level_mes_5m | 75DJN5UVQnw | OTHER_MEASURED_REFUSAL |
| 6c755822-713d-48f9-867e-cf399722e69a | 5m_minute_support_level_mnq_5m | 75DJN5UVQnw | OTHER_MEASURED_REFUSAL |
| e27546e4-fd8d-49d1-a359-5a0ed9a9411b | ballinger_bands_mcl_5m | FqxEKDxemtI | OTHER_MEASURED_REFUSAL |
| ef2c1384-b711-474a-9aa7-fe2ea4c29cfa | ballinger_bands_mes_5m | FqxEKDxemtI | OTHER_MEASURED_REFUSAL |
| b5871142-d5e4-4d8b-a7da-3033719d762f | ballinger_bands_mnq_5m | FqxEKDxemtI | OTHER_MEASURED_REFUSAL |
| 3af883fa-9c50-45de-9076-214136f44b8a | bos_and_fvg_or_fvg_mcl_15m | E8Wg6tFPYjo | EXTRACTION_MISSING_REQUIRED_INFORMATION |
| 4be0db1d-b6fe-46c4-8251-fd721b1b0992 | bos_and_fvg_or_fvg_mes_15m | E8Wg6tFPYjo | EXTRACTION_MISSING_REQUIRED_INFORMATION |
| 913f40c4-6d3d-4c71-81da-109631f38873 | bos_and_fvg_or_fvg_mnq_15m | E8Wg6tFPYjo | EXTRACTION_MISSING_REQUIRED_INFORMATION |

Projection method: since no video reached a clean certificate, the market/timeframe-authorization
question (AR-1340A S5) never arises for this pilot -- a refusal is source-content-level and
propagates identically to all rows sharing that source, never invented per-symbol.

## MODEL/TOOL CALL COUNT (AR-1340A S7)

- 3 extraction calls (`gemma4:e4b-it-qat` via Ollama, one per video).
- Video 1 only: ~13 `anchor_locator` gemma calls (one per spine condition) + 1 Stage-1 Agent
  dispatch (23 items, one call) + 1 Stage-2 Agent dispatch (13 items, one call) = 2 subagent
  dispatches total.
- Video 3: ~16 `anchor_locator` gemma calls; 0 subagent dispatches (result already determined).
- Video 2: 0 anchor/dispatch calls (refused at extraction, before certification starts).
- **Total subagent (Agent-tool) dispatches for the whole 3-video pilot: 2.** No ensemble, no
  multi-rater vote, no G2D correction-round replay.

## INTEGRITY CHECKLIST (AR-1338A S3)

- Source evidence attributable to the exact video/transcript: yes (pinned transcript files,
  sha256-identified, committed).
- No legacy compiled output became source authority: yes -- every disposition traces to the
  FRESH extraction/certification, not the old `compiled_spec`.
- No hidden condition loss: yes -- `spine_condition_count` == `unanchored` + accounted
  (classified/fallthrough) for every video, asserted structurally by `prepare_strategy` itself.
- No invented market/timeframe/stop/target semantics: yes -- no compile was attempted for any of
  the 3 (none reached a clean certificate), so no projection judgment was needed.
- Deterministic repeat output: proven for video 1 (only one with real dispatch answers to
  replay); videos 2/3 are pure-function outputs of already-frozen inputs (extraction JSON /
  empty verdict set), trivially deterministic.
- Production compiler used, not a second compiler: N/A this pilot (0 compiles attempted) -- the
  compiler path (`compile_certified_record.py`/`spec_producer.py`) was never invoked because no
  certificate reached clean.

**PILOT VERDICT: PASS (integrity green).**

## FAST CONTINUATION

Per AR-1338A S4 / AR-1340A S6.6: pilot integrity is GREEN, so continuing automatically through
the remaining 37 source videos now, in this same session, without another routing pause.

GRADER : not dispatched. No `FAITHFUL_COMPILE_READY_FOR_BACKTEST` claim was made this pilot (0
         compiles) -- nothing yet needs independent grading. The 9 refusal claims each carry
         their own machine evidence (search/anchor/adjudication artifacts, all committed) per
         worker-onboarding's positive-witness rule.
STOP   : none.
NEXT   : remaining 37 source videos, same conveyor, same bar.
