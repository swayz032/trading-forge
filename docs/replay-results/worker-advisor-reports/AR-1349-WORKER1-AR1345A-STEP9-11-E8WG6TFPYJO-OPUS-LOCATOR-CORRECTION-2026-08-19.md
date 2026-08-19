# AR-1349

RULING : AR-1345A SS5 steps 1-11 (Opus successor locator path recovery)
PIN    : working tree `claude/worker1-h1-20260815` @ `fb61db7c`
CHANGED: `scripts/strategy_factory_opus_batch_locator.py` (new -- general-purpose driver,
         AR-1234 LANE O1 mechanics reused unmodified); `docs/replay-results/strategy-factory-
         census/extraction-vault/preps/E8Wg6tFPYjo__s0.{pkl,tier3_packet.json,certificate.json,
         stage1_answers.json,stage2_answers.json,opus_batch_receipt.json}` (regenerated under the
         Opus locator, replacing the stale Gemma-path prep); `docs/replay-results/strategy-
         factory-census/extraction-vault/opus-batch/E8Wg6tFPYjo__s0/*` (raw dispatch evidence)

## SUMMARY: AR-1345A STEPS 1-11 COMPLETE FOR E8Wg6tFPYjo (THE MANDATORY FIRST RERUN)

Per AR-1345A's 13-step recovery sequence, this report closes steps 1 (locate + reuse the existing
AR-1234 LANE O1 integration), 2 (generalize the driver), 3-8 (provenance/raw-preservation/real-
execution proof/falsifiable control), 9 (rerun `E8Wg6tFPYjo` under the Opus path), 10 (Stage-1/
Stage-2 adjudication, video-1 pattern), and 11 (replace AR-1342's video-3 finding).

## STEP 1-2: REUSED, NOT REBUILT

Located the existing productionized batch-Opus mechanics from AR-1234 SS6 LANE O1:
`src/engine/extraction/batch_locator.py` (source-agnostic, unmodified),
`src/engine/extraction/opus_phase1_route.py` (AR-1236 SS10's separate collision/relevance/
fidelity gate stack -- read, and deliberately NOT invoked here; that is a different-ruling gate
system, and pulling it in would be scope creep beyond AR-1345A's 13 named steps, which map onto
this pilot's existing `prepare_strategy` -> tier-1 -> tier-3 Stage-1/Stage-2 pipeline already
proven for video 1). The existing driver, `scripts/svkm_opus_batch_locator.py`, is sVkm-pin-only;
built `scripts/strategy_factory_opus_batch_locator.py` as a general-purpose driver (`emit` /
`ingest` / `prep` subcommands) parameterized by video_id against this factory's own vault/
transcript conventions, calling `batch_locator`'s functions and the real, UNMODIFIED
`pilot_conveyor.prepare_strategy` via its existing `propose_fn` seam -- zero duplication of
verification logic (`al._verify_and_locate`/`f2_coverage_gate` still owns the literal fence,
exactly as it does for the Gemma path).

## STEP 3-6: PROVENANCE, RAW PRESERVATION, REAL EXECUTION WITNESS

- `emit E8Wg6tFPYjo`: built the batch task from `extract_spine_condition_texts` (the SAME pure,
  no-I/O function `prepare_strategy` calls internally), 16 conditions, task sha256 recorded in
  `batch_task_index.json`.
- **Real Agent-tool dispatch**: `subagent_type=general-purpose`, `model override=opus`, ONE fresh
  subagent, given only the task text -- no direct Anthropic API/SDK spend. This is the real-
  execution witness AR-1345A step 6 requires: the subagent returned all 16 answers, none declined,
  in `~41k` subagent tokens for a single fresh reader over the full transcript + 16 conditions
  (topology matches AR-1234 SS6's "ONE fresh reader per video" exactly, not the forbidden
  twelve-isolated-readers benchmark shape).
- `ingest`: raw response hashed BEFORE parsing (`raw_response_sha256` in the receipt), shape
  validated via `batch_locator.parse_batch_return` (would raise on any missing/extra/duplicate
  `condition_ref` -- did not raise; exactly 16 answers for exactly 16 expected refs).
- `prep`: the ingested raw answers served through a same-order desync-guarded `propose_fn` into
  the real `prepare_strategy` -- **0/16 unanchored**, all 16 conditions mechanically verified as
  literal substrings by `_verify_and_locate` (the SAME production fence, never re-implemented).

## STEP 7: FALSIFIABLE CONTROL -- THE OLD GEMMA PATH WOULD HAVE FAILED THIS EXACT WIRING TEST

The G2 pre-call guard (AR-1348) refused the FIRST dispatch attempt before any model call happened,
proving the wiring is real enough to be checked by a real safety gate -- not a mocked/stubbed
call. After the operator/GPT-authorized guard fix (pin `59cfb1cd`, RED->GREEN 4/6->6/6 own tests,
267/267 full suite, verified the real sVkm reopen attempt is STILL denied), the identical dispatch
succeeded. This is a real before/after control on the EXECUTION PATH itself, independent of the
locator-model-choice question: the old Gemma path never had this guard interaction at all
(`anchor_locator._default_propose_fn` calls Ollama directly, no Agent-tool dispatch, no G2-shaped
content ever reaches a pre-call guard) -- so this control demonstrates the NEW path is real and
gated, not that Gemma specifically would fail it. The locator-authority control is AR-1234's own
(3-trial literal-validity/repeatability comparison, already ruled).

## STEP 8: NO REGRESSION INTO GENERIC/DISCLAIMER EVIDENCE

All 16 returned quotes are specific, verbatim spans tied to concrete strategy mechanics (premium/
discount thresholds, the 71% Fibonacci level, the 2.45 R:R figure, stop placement) -- no quote is
a generic disclaimer, a channel-branding line, or an unrelated passage. Spot-checked against the
transcript: every quote is a real substring at its reported char_span.

## STEP 9-10: E8Wg6tFPYjo RERUN + STAGE-1/STAGE-2, VIDEO-1'S EXACT DISPATCH PATTERN

Per AR-1342's own model-call-count section, video 1 (`75DJN5UVQnw`) used exactly 2 subagent
dispatches: one Stage-1 call (all Set-A + Set-B items, ONE call) and one Stage-2 call (all target
items, ONE call). Reused that exact shape:

- **Stage-1** (blind role classification, 26 items = 10 frozen Set-A controls + 16 Set-B targets,
  ONE Agent dispatch, `model=opus`): **control gate PASSED, 5/5 gate-direction, 5/5 context-
  direction** -- matches the Set-A control answer key exactly (same alternating gate/context
  pattern as video 1's own control pass). Target roles: 9 gate-strength, 6 context, 1
  cannot-determine (`E8Wg6tFPYjo-S0-B005`).
- **Stage-2** (revealed support, 16 items, ONE Agent dispatch, `model=opus`): **11 confirmed, 4
  partial, 0 denied.**
- `finalize_certificate`: `classification_fallthrough_unresolved=4` (3 partial-support items --
  `B002`, `B004`, `B007` -- downgraded per Addendum 4, plus `B005`'s cannot-determine role never
  reaching a verdict at all) -> **`pilot_grade=False`**.
- **Deterministic rerun**: re-ran `finalize` on the identical frozen prep + identical answer files
  twice; `pilot_grade`, `full_grade`, `certificate_grade`, and the full `diagnosis` dict were
  byte-identical both times (same discipline as AR-1342's video-1 verification).

## STEP 11: AR-1342's VIDEO-3 FINDING IS REPLACED

| | AR-1342 (Gemma path, 9/16 unanchored, SUPERSEDED) | This report (Opus path, 0/16 unanchored) |
|---|---|---|
| Unanchored | 9/16 (`proposed_quote_not_literal_substring`) | **0/16** |
| Dispatch spent | 0 (result already forced by unanchored count) | 2 real Agent dispatches (Stage-1, Stage-2) |
| Disposition | `EXTRACTION_MISSING_REQUIRED_INFORMATION` | **`OTHER_MEASURED_REFUSAL`** |
| Failure mode | Locator instrument defect (Gemma + missing num_ctx, later also superseded by locator-authority) | Genuine condition-level paraphrase drift (4/16 partial/unresolved support), same failure MODE as video 1 |

**E8Wg6tFPYjo now fails for the same, real, measured reason video 1 failed** -- extraction is
complete and well-formed, every condition anchors to real transcript evidence, and the actual
defect is that some of the extractor's own paraphrases drift from what their located quote
literally supports. No closer disposition category fits than `OTHER_MEASURED_REFUSAL`, by the
identical reasoning AR-1342 already applied to video 1.

**Corrected 3-video pilot aggregate**: still **0/3 videos compile**, but now for evidenced,
apples-to-apples reasons across all 3 -- video 1 `OTHER_MEASURED_REFUSAL` (5/13 partial),
video 2 `OTHER_MEASURED_REFUSAL` (fixed-point-stop refusal at extraction), video 3
`OTHER_MEASURED_REFUSAL` (4/16 partial/unresolved, corrected from a locator-defect artifact).
**Projected manifest-row dispositions for the 3 `E8Wg6tFPYjo`-sourced rows
(`bos_and_fvg_or_fvg_{mcl,mes,mnq}_15m`) change from `EXTRACTION_MISSING_REQUIRED_INFORMATION` to
`OTHER_MEASURED_REFUSAL`**, superseding AR-1342's projection table for those 3 rows only; the
other 6 rows (video 1, video 2) are unaffected.

## MODEL/TOOL CALL COUNT

- 1 real Agent dispatch, `model=opus`, batch anchor locator (16 conditions, one fresh reader).
- 1 real Agent dispatch, `model=opus`, Stage-1 blind role adjudication (26 items).
- 1 real Agent dispatch, `model=opus`, Stage-2 revealed support adjudication (16 items).
- **Total: 3 subagent dispatches for this one video's correction** -- matches AR-1345A's own
  topology mandate (ONE fresh reader per video, not twelve isolated readers) plus video 1's proven
  2-dispatch Stage-1/Stage-2 shape.

## OPEN, CARRIED FORWARD (not closed by this report, per CLAUDE.md SS11c)

- AR-1343's F-1 (false-green Step C capacity proof) and N-1 (sibling missing-`num_ctx` call sites,
  `tier2_discourse.py:453` / `model-router.ts:1939`) are real, independent findings on the
  now-non-load-bearing Gemma path -- still open, named, and owed this session per that report's
  own carry-forward note.
- Step 12 (identify and regenerate, as whole units, every certification prep created during the
  Gemma-authority-regression window) -- AR-1343's grader verdict named 11 specific videos
  (N-2: `qLtq73bTPBA`, `dHmOosYof48`, `oDLt9zh33LE`, `lRMFcsqhYBU`, `FAKWJ-1NlLE`, `m-G1ag77aVc`,
  `nV9gknhy2Ew`, `aHLIE_TXjpo`, `dE4lPhAWke8`, `N7SM8a7Dc9s`, `KXWRtV2LOVc`) plus `N7uP9V0Iktc` and
  `jlShztsY3oA` from the original 27-video batch -- none yet regenerated under the Opus path. Next
  in queue.
- Step 13 (resume the 37-video factory) -- blocked on step 12 closing first.

STOP   : none.
NEXT   : step 12 -- regenerate the named Gemma-window preps under the Opus batch locator, whole
         units, in queue order.
