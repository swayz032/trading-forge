# AR-1352

RULING : AR-1349A (GPT external advisor ruling on AR-1350) SS9 "exact next task" items A/B/C
RUN HEAD / FINAL REPLAY SHA           : `138fbe36124370fe72a713b144f1e9cf452e72b8`
IMPLEMENTATION COMMIT(S)              : `0b249a9e` (F-2/F-3/F-4/F-5 fixes), `0ed35c99` (F-1 fix
         -- new `adjudication-ingest` subcommand), `def7e25a` (manifest-row projection)
EVIDENCE/ARTIFACT COMMIT(S)           : same three -- each carries its own RED/GREEN proof inline
CONTROL-PLANE REPAIR COMMIT(S)        : none this report
GITHUB STATUS AT FINAL REPLAY SHA     : `total_count: 0` (no CI checks configured for this
         branch/SHA -- same pattern GPT itself already observed at the prior SHA; not a gap this
         report introduces)

## ITEM A -- INDEPENDENT DRIVER GRADE: RECEIVED, ALL 5 FINDINGS FIXED

The independent `accuracy-validator` grade (dispatched before AR-1349A landed, per this campaign's
standing self-dispatch authorization) returned **band 7 VERIFIED** on
`scripts/strategy_factory_opus_batch_locator.py` and the 42-unit regeneration, committed at
`docs/replay-results/worker-advisor-reports/AR-1351-GRADER-ACCURACY-VALIDATOR-OPUS-BATCH-LOCATOR-DRIVER-2026-08-19.md`
(commit `2751be3e`). **Central claims survived every attack**: mechanics reuse proven by empty
`git diff` against the pre-work commits, 42/42 receipts hash-verified against their own raw
responses with zero fabrication, 5/5 sampled certificates byte-reproduced from frozen inputs,
`0/42 pilot_grade` proven NOT a locator artifact via an independently-derived support→tier
crosstab over 490 verdicts, and a semantic re-derivation across 5 units found ZERO cases of the
exact "real quote, wrong quote" failure AR-1234 retired Gemma for.

**Five real, non-falsifying findings, all fixed this session, RED/GREEN proven on each:**

| Finding | Severity | Fix commit | RED/GREEN proof |
|---|---|---|---|
| F-1: Stage-1/Stage-2 dispatches carried zero raw-preserve/hash/receipt provenance, unlike the locator | CRITICAL | `0ed35c99` | New `adjudication-ingest` subcommand: invalid-role input correctly rejected (exit 1, names the bad item); valid input produces raw response file + answers file + receipt with matching hash (exit 0) |
| F-2: desync guard blind when two conditions share identical `condition_text` | MEDIUM | `0b249a9e` | `emit h6TnE7QClJg` now refuses with `DUPLICATE_CONDITION_TEXT_REFUSED`, correctly finding all 4 real duplicate pairs in that unit (the grader's own report cited only 1) |
| F-3: text-mode writes CRLF the disk copy while the recorded hash is LF-based, so a naive re-hash disagrees | MEDIUM | `0b249a9e` | `newline="\n"` applied to every write whose bytes are later claimed by a hash (`batch_task.txt`, `batch_raw_response.txt`, `certificate.json`, and the new stage receipts) |
| F-4: provenance inventory trusted receipt file EXISTENCE, not content -- a copy-pasted receipt from a different unit would pass | MEDIUM | `0b249a9e` | New `_validate_receipt()`: real receipt against its own unit passes; the SAME real receipt validated against a DIFFERENT unit's identity correctly fails with `receipt identity mismatch` -- the exact attack class the grader's own planted-bad control used |
| F-5: inventory published no explicit scope line; `sVkmZklJDHI` transcript + 17 sealed/other-lane preps sit outside its enumeration surface with no boundary stated | LOW | `0b249a9e` | Explicit `"scope"` block added to the inventory's own output, naming the enumeration surface and both known, checked, non-contaminated exclusions |

**Deliberately NOT retroactive**: the 42 units already regenerated under AR-1348A keep their
existing Stage-1/Stage-2 limitation (corroborated by the grader's independent semantic
re-derivation, not receipted) -- there is no raw dispatch text left to recover for them, and
fabricating a receipt after the fact would be worse than the honest gap. `adjudication-ingest`
applies to every unit processed from this commit forward, starting with the remaining 37-video
factory resume.

**Re-verified after all fixes**: `python scripts/strategy_factory_prep_provenance_inventory.py`
still reports `needs_regeneration_count: 0` -- the fixes did not disturb the substantive finding,
including the new content-validation (F-4) actually running against all 42 real receipts and
passing every one.

## ITEM B -- MANIFEST-ROW DISPOSITION PROJECTION: REBUILT

`scripts/strategy_factory_manifest_row_projection.py` (commit `def7e25a`) joins the frozen
120-row `library-manifest-v1.1.json` (each row's `spec_video` tag) against the now-authoritative
47-unit provenance inventory, and assigns each row's disposition from that video's real
certificate/extraction-refusal artifact only -- no invented name, market/timeframe, or
eligibility.

```
total_manifest_rows                          120
rows_projected                                117
rows_out_of_scope                               3   (sVkmZklJDHI -- separately-managed sVkm/G2-D lane)
OTHER_MEASURED_REFUSAL                        105
EXTRACTION_MISSING_REQUIRED_INFORMATION        12
FAITHFUL_COMPILE_READY_FOR_BACKTEST             0
strategy_indices unrepresented in the frozen
  manifest (this session's re-extraction found
  multi-strategy videos the pre-multi-strategy
  manifest has no row for -- disclosed, not
  silently merged in)                           8
```

Disposition rule applied (each branch matches an already-ruled-on AR-1342 precedent, never a new
invented category): `locator_backend=="none"` (extraction produced zero strategy objects) ->
`OTHER_MEASURED_REFUSAL` with the extraction's own `rejected_strategies` detail (matches video 2's
treatment exactly); `unanchored_condition_count > 0` -> `EXTRACTION_MISSING_REQUIRED_INFORMATION`
(matches video 3's pre-correction treatment); `unanchored_condition_count == 0` and
`pilot_grade == False` -> `OTHER_MEASURED_REFUSAL` for condition-level paraphrase drift (matches
video 1 / E8Wg6tFPYjo / corrected video 3); `pilot_grade == True` ->
`FAITHFUL_COMPILE_READY_FOR_BACKTEST` (rule stated, zero observed).

## ITEM C -- CLOSEOUT SUMMARY

- Independent grader identity/dispatch: `accuracy-validator`, doer != grader, dispatch receipt
  and full verdict at `docs/replay-results/worker-advisor-reports/AR-1351-...md`.
- Exact driver SHA/blob graded: `6c824ccf138121613cc99d98c549ae8b9335c90a` (per AR-1351's own
  pin) -- the fixes in this report are NEW commits on top of that graded blob, not yet
  independently re-graded themselves (see OPEN below).
- Grade artifact path and verdict: `AR-1351-GRADER-ACCURACY-VALIDATOR-OPUS-BATCH-LOCATOR-DRIVER-2026-08-19.md`, band 7 VERIFIED.
- Exact final replay SHA: `138fbe36124370fe72a713b144f1e9cf452e72b8` (header above).
- Regenerated inventory summary: 47 units, 42 `opus_batch`, 5 `none`, 0 `needs_regeneration`.
- Manifest-row disposition projection summary: see ITEM B table above.
- Confirmation no unnecessary 42-unit Opus rerun occurred: **confirmed** -- every AR-1351 fix
  this report addresses was applied to the DRIVER/SCRIPTS, never by re-dispatching any of the 42
  already-regenerated units; the inventory re-run after the fixes reconciles to the identical
  `needs_regeneration_count: 0` with the SAME 42 units, now content-validated rather than merely
  existence-checked.
- GitHub status/workflow state at final replay SHA: `total_count: 0` (header above) -- no CI is
  configured to run against this branch's commits; not a gap introduced by this pass.

## OPEN, NOT CLOSED BY THIS REPORT

- **The AR-1351 fixes themselves (F-1 through F-5) have not been independently re-graded.** The
  original band-7 grade covered the driver AS IT STOOD before these fixes. Per ratify-packet
  discipline this is a smaller, more mechanical follow-on change (five named point-fixes with
  their own inline RED/GREEN proof) rather than new load-bearing integration, so it is judged
  lower-risk than the original driver -- but flagging honestly rather than silently treating
  "I proved it myself" as equivalent to independent grading.
- AR-1343's carried findings (F-1 false-green Step C proof there, N-1 sibling `num_ctx`
  omissions) remain open, unrelated to this cleanup per AR-1348A SS8/AR-1349A SS10's explicit
  instruction not to fold them in.

STOP   : none.
NEXT   : awaiting GPT's ruling on this closeout. If accepted, resume the remaining 37-video
         factory under AR-1340A/AR-1338A using `adjudication-ingest` for all new Stage-1/2 work.
