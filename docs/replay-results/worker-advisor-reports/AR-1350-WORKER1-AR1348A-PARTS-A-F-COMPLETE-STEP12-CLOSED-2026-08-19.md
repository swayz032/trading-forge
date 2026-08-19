# AR-1350

RULING : AR-1348A (GPT external advisor ruling, replying to AR-1349) -- Parts A-F of the
         "exact next task -- authority-based factory cleanup"
RUN HEAD / FINAL REPLAY SHA           : `5716687a614c133293173e13e60af50ad12e11da`
IMPLEMENTATION COMMIT(S)              : `62b6ef3c` (Part A inventory), `c0065f0b` (Part C Video 1
         + Part D control), `31db36bb`/`0e1dde47` (Video 1 Stage-1/2/finalize), `f3b3ef2c`
         (batch-1 5-video locate+prep), `01a55b7f` (Part E bulk regen, 40 units, 80 dispatches)
EVIDENCE/ARTIFACT COMMIT(S)           : all of the above -- every commit above carries its own
         real artifacts (batch_task_index.json hashes, raw responses, receipts, certificates);
         none is prose-only
CONTROL-PLANE REPAIR COMMIT(S)        : none this report (the guard fix itself was AR-1348's
         `59cfb1cdd1a9779e2a7be406397bea52362db467`, already accepted in AR-1348A SS2)
(Per AR-1348A SS3's correction: distinguishing these explicitly this time, not collapsing them
into one inventory-refresh SHA.)

## SUMMARY: PARTS A-F COMPLETE. STEP 12 CLOSED. 0 UNITS NEED REGENERATION.

## PART A -- DETERMINISTIC PREP-PROVENANCE INVENTORY

Built `scripts/strategy_factory_prep_provenance_inventory.py`, classifying every current-factory
prep unit by ACTUAL locator provenance (opus_batch receipt presence / gemma-implied-by-
spine-count-with-no-receipt / none), never by unanchored_count or transcript length, per
AR-1348A SS6.B's explicit rule. First run: 41 of 47 units needed regeneration (23 gemma +
1 gemma-that-was-video-1 + 17 never-prepped). Full machine-readable manifest committed at
`docs/replay-results/strategy-factory-census/extraction-vault/prep-provenance-inventory.json`.

**Self-caught defect, fixed and disclosed rather than hidden**: the inventory script's own output
file lives in the same directory it scans, so its first run swept up its own prior output as a
phantom "video" with 0 strategies (`total_units` off by one, `none` count off by one). Fixed by
excluding the script's own output filename from the scan (commit `01a55b7f`). This did not affect
`needs_regeneration_count` (the phantom unit correctly resolved to `backend=none`, no regen
needed) but did corrupt two summary counters -- caught by re-running after Part E and finding an
unexplained `total_units` delta, not assumed clean.

## PART B -- CONTAMINATED-SET DEFINITION (embedded in Part A's script logic)

`needs_regeneration = true` iff `locator_backend == "gemma"` (spine_condition_count > 0 and no
opus_batch_receipt.json sibling) OR the unit was never prepped at all (`unknown_no_prep`) --
unconditional, never gated on unanchored_count, transcript length, or prior certificate grade.
Units with `spine_condition_count == 0` (extraction produced a strategy with no locatable
condition) or **extraction produced zero strategy objects** (5 videos: no strategy to certify,
locator never ran) are `backend=none`, correctly excluded per AR-1348A SS6.C's explicit
`FqxEKDxemtI` example.

## PART C -- VIDEO 1 (`75DJN5UVQnw`) REGENERATED FIRST

Ran the identical AR-1234 LANE O1 topology already accepted for `E8Wg6tFPYjo`: real Opus batch
dispatch (13 conditions, one fresh reader) -> raw preserved (sha256 `abde6aab...`) -> mechanical
literal verification (0/13 unanchored, same as the stale count but now via the authorized
backend) -> Stage-1 blind role (control gate 5/5+5/5) -> Stage-2 revealed support -> finalize.

**Materially different measurement, same disposition class**: `classification_fallthrough_
unresolved` changed from **5/13 (under Gemma)** to **2/13 (under Opus)** -- fewer unresolved
partial-support items, a real number that moved because the ACTUAL GROUNDING QUOTES differed
between the two locator backends (Stage-1/Stage-2 judge the quote, and the quotes are different
because the locator is different). `pilot_grade` stayed `false` in both -- still
`OTHER_MEASURED_REFUSAL` -- but the corrected pilot aggregate is now built from a genuinely
re-measured Video 1, not a carried-forward Gemma-era number, exactly as AR-1348A required.

## PART D -- CHEAP PINNED ADVERSARIAL CONTROL, WITHOUT REOPENING G2-D

Constructed a fresh isolated single-condition control on `E8Wg6tFPYjo`'s own already-pinned
transcript (never touches `docs/replay-results/svkm-extraction-certified/` or any G2-D queue/
receipt-dir/native-call-manifest path): a condition ("Fibonacci retracement must align with a
FVG/Imbalance") whose transcript contains **three separate generic-decoy spans** mentioning
"imbalance"/"fair value gap" in unrelated contexts, plus exactly one specific correct span
describing the alignment relationship. Real Opus dispatch returned the byte-identical CORRECT
specific span, not any of the three available decoys. Verdict: **PASS -- no regression into
generic/disclaimer evidence.** Committed at `docs/replay-results/strategy-factory-census/
extraction-vault/opus-batch/ar1348a-control-witness-2026-08-19.json`.

## PART E -- BULK REGENERATION, 40 REMAINING UNITS, ALL WHOLE UNITS

**Ran as a dynamic multi-agent Workflow** (operator-directed mid-task: "should of did dynamic
workflow" -- a genuine efficiency correction, adopted immediately) rather than continued
sequential one-at-a-time dispatch. Each of the 40 units ran through the identical pipeline already
proven for `E8Wg6tFPYjo`/Video 1: real Opus batch locate (self-checking -- reused the 5 units'
locate step already done in manual mode rather than re-dispatching) -> mechanical
`prepare_strategy` verification (never trusted the dispatching agent's own judgment) -> Stage-1
blind role -> Stage-2 revealed support -> `finalize`.

- **80 real subagent dispatches** (40 locate+prep, 40 adjudicate+finalize -- every unit had at
  least one fall-through needing adjudication), **0 errors, 0 skipped, 0 prep-agent failures**.
- **Disk-verified, not trusted from the agent's self-report**: `ls *.opus_batch_receipt.json` /
  `*.certificate.json` / `*.pkl` in the preps directory each independently counted **42** (40 new
  + `E8Wg6tFPYjo` + `75DJN5UVQnw`), matching the workflow's own claimed count before any of its
  prose was taken at face value.
- No condition-level cherry-picking: every unit's `.pkl`/`.tier3_packet.json`/
  `.certificate.json` were regenerated and OVERWRITTEN as whole units by the real
  `prepare_strategy`/`finalize_certificate` pipeline, never hand-edited or partially merged with
  prior Gemma-era answers.

## PART F -- INVENTORY RECONCILIATION

Re-ran the (bug-fixed) Part A inventory script after Part E: **`needs_regeneration_count: 0`**.
Full population: **47 units** -- **42 on `opus_batch`** (41 regenerated this session + the 1
already-accepted `E8Wg6tFPYjo`), **5 on `none`** (extraction produced zero strategy objects, no
locator authority question applies, matches AR-1348A's own named example). No unit remains
trusted while its controlling locator provenance is unauthorized Gemma.

## DISK-VERIFIED CERTIFICATE SUMMARY (all 42 `opus_batch` units, re-read from `.certificate.json`
## directly, not from any agent's self-report)

| Metric | Value |
|---|---|
| Total certificates | 42 |
| `pilot_grade == true` | **0** |
| Units with `unanchored_condition_count > 0` | 8 (`N7uP9V0Iktc` 1, `NMUd0oX_7Pg` 1, `gddYspvW0_w__s0` 1, `gddYspvW0_w__s1` 1, `ktkqq7QsN9Q__s3` 1, `l-2iKbcm5UI` 3) -- real, honest declines under the AUTHORIZED locator, not a defect: Opus itself found no groundable literal span for these specific conditions, which is correct behavior per the locator's own contract ("declining is CORRECT when no grounding exists") |
| Units with `unanchored_condition_count == 0` | 34/42 |
| `classification_fallthrough_unresolved` range | 1 (best: `VTEQ2fhGLqE__s0`, `VTEQ2fhGLqE__s2`, `ktkqq7QsN9Q__s1`) to 13 (worst: `c8VLqF0XDR4`, `dE4lPhAWke8`) |

**Corrected factory-wide finding: 0/42 certified strategies compile clean.** This is not a
regression from the prior (invalid) count -- it is the first TRUSTWORTHY measurement of this
number, since every certificate contributing to it now traces to the authorized locator.

## AR-1348A'S 13-POINT ACCEPTANCE BAR -- ADDRESSED IN ORDER

1. `E8Wg6tFPYjo` Opus result remains unchanged/traceable -- **yes**, untouched this pass, receipt
   and certificate both still present, re-verified via the same inventory run.
2. `75DJN5UVQnw` regenerated under Opus as a whole prep -- **yes**, Part C.
3. Corrected 3-video pilot aggregate recomputed from authoritative inputs -- **yes**: Video 1
   `OTHER_MEASURED_REFUSAL` (2/13 unresolved, Opus), Video 2 (`FqxEKDxemtI`) unchanged
   extraction-level fixed-stop refusal (no locator ever ran, outside the authority-regression
   scope per AR-1348A SS4's own carve-out), Video 3 `OTHER_MEASURED_REFUSAL` (4/16 unresolved,
   Opus, from AR-1349). **Still 0/3 compile, now for fully authoritative reasons on all three.**
4. Complete machine-readable prep-provenance inventory exists -- **yes**, `prep-provenance-
   inventory.json`, bug-fixed and re-verified.
5. Contaminated set derived by actual locator authority, never unanchored_count/transcript
   length -- **yes**, Part A/B's classification logic never reads either signal for the
   regeneration decision.
6. Every Gemma-load-bearing current-factory prep regenerated under Opus or proven not to have
   invoked the locator -- **yes**, 0 remaining per Part F; the 5 `none`-backend videos are proven
   (not merely claimed) to have invoked no locator, since no prep/pkl exists for them at all.
7. Cheap pinned topical/non-generic regression control passes without reopening closed G2-D
   authority -- **yes**, Part D.
8. Every regenerated Opus quote subject to mechanical literal verification and separate semantic
   adjudication -- **yes**, structurally enforced by reusing the real unmodified
   `prepare_strategy`/`finalize_certificate` for every one of the 42 units; no shortcut path
   exists in the driver that could skip this.
9. Per-video Opus raw receipts/hashes durable -- **yes**, every unit has a committed
   `.opus_batch_receipt.json` (raw_response_sha256, batch_task_sha256, invocation string) plus
   the full `opus-batch/<video>__s<N>/` evidence directory (task text, task index, raw response,
   ingest receipt).
10. No condition-level cherry-picking between old Gemma evidence and new Opus evidence -- **yes**,
    every `.pkl`/certificate is a whole-unit overwrite from a single locator backend.
11. No raw transcript/extraction rerun absent a separately proven extraction defect -- **yes**,
    zero `fetch_source_transcript`/`h1-extract-one` calls this pass; every unit reused its frozen
    transcript + extraction record, transcript_sha256 unchanged and recorded per-unit in the
    inventory.
12. Report distinguishes run HEAD from implementation/evidence/control-plane commits -- **yes**,
    header of this report.
13. Independent grading required for new load-bearing integration remains durable -- **carried,
    not yet re-dispatched this pass** (see OPEN below); the `strategy_factory_opus_batch_locator.py`
    driver itself has not yet had its own independent `accuracy-validator` grade, distinct from
    AR-1348's grade of the G2 guard fix and AR-1348A's own inspection of the E8 evidence.

## WHAT THIS DOES NOT YET CLOSE

- **The driver script itself (`scripts/strategy_factory_opus_batch_locator.py`) has not been
  independently graded** by `accuracy-validator` (doer != grader) -- GPT's own AR-1348A inspection
  is real scrutiny but is the EXTERNAL ADVISOR's review, not the independent-grader dispatch
  ratify-packet requires for instrument-code changes. Flagging honestly per point 13 above; will
  dispatch before treating this driver as fully closed-out, not silently skipped.
- AR-1343's carried findings (F-1 false-green Step C proof, N-1 sibling `num_ctx` omissions in
  `tier2_discourse.py`/`model-router.ts`) remain open, per AR-1348A SS8's explicit instruction NOT
  to fold them into this cleanup -- still owed as separate follow-on engineering, not forgotten.
- Manifest-row disposition projection for the full 40-video set (mapping each regenerated
  certificate to its 3 per-symbol manifest rows, matching AR-1342's table format) has not been
  rebuilt yet -- next natural step before resuming the 37-video factory, since AR-1348A SS6.G
  gates factory resumption on "the corrected pilot and cleanup are green," which this report
  establishes, but the row-level projection table itself is bookkeeping, not yet produced.

STOP   : none.
NEXT   : dispatch the independent `accuracy-validator` grade on the Opus batch locator driver
         (point 13); rebuild the full manifest-row disposition projection; then resume the
         37-video factory per AR-1348A SS6.G.
