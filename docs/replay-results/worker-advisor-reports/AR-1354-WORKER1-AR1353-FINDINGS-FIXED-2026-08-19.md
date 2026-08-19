# AR-1354

RULING : AR-1353 (independent bundled re-grade, `accuracy-validator`, band 6 VERIFIED)
RUN HEAD / FINAL REPLAY SHA           : `74a9dbfc29d9b857df60c6aaeec720de8b14d717`
IMPLEMENTATION COMMIT(S)              : `d3ac757d`
EVIDENCE/ARTIFACT COMMIT(S)           : `d3ac757d` (same commit, RED/GREEN proof inline for
         every fix, plus two new proof scripts)
CONTROL-PLANE REPAIR COMMIT(S)        : none this report

## SUMMARY: ALL 8 AR-1353 FINDINGS FIXED, INCLUDING THE ONE CRITICAL

AR-1353 was a fresh, independent bundled re-grade (different dispatch than AR-1351, disjoint
units used for every control) covering the AR-1350A repair surface. It found the two ordered
repairs from AR-1350A were REAL but incomplete: Item B (manifest projection) it graded CLOSED;
Item A (Stage-1/2 binding) it graded NOT CLOSED, with one CRITICAL finding (F-1) and six lower
findings (F-2 through F-8, with F-2 being a coverage consequence of F-1 rather than a separate
defect). All are fixed this report, each with RED/GREEN proof re-run against real committed data.

| Finding | Severity | Fix |
|---|---|---|
| F-1: `cmd_finalize` never checked for a receipt at all -- hand-written, never-adjudicated answers were silently accepted and could overwrite a real certificate with a fabricated `pilot_grade` | **CRITICAL** | `finalize` now REQUIRES a verified receipt (identity + answer-content-hash + packet-hash match) for any `--stage1`/`--stage2` path supplied, refusing by default (`UNBOUND_ANSWERS_REFUSED`) on the grader's exact reproduction. A named `--allow-unbound-legacy` escape hatch exists for the historical class, and using it STAMPS the certificate itself with `provenance_binding.status = UNBOUND_LEGACY` -- visible on the artifact of record, not just in a report |
| F-2: 0 production units carry stage receipts | (consequence of F-1) | Not separately fixed -- it is the coverage measurement of F-1's absence before this fix; the fix is F-1 itself. The 42 historical certificates keep their disclosed `provenance_binding` gap (no receipt exists retroactively; not fabricated) |
| F-3: a rejected ingest attempt overwrote the raw-response file an earlier ACCEPTED receipt attested | MEDIUM | The canonical raw-response file is now written ONLY after every validation passes, immediately before the receipt -- a rejected attempt can no longer corrupt a prior accepted receipt's attested file |
| F-4: `expected_item_ids_sha256` was recorded but never re-verified at ingest -- an unbound anchor | MEDIUM | `expected_item_ids` is now re-derived at ingest time from the CURRENT (already hash-verified) packet via the same helper `adjudication-emit` uses, never trusted from the stored task_index list |
| F-5: inventory receipt validation implemented identity + raw-hash only; an escalated plant (identity rewritten + raw copied, task-sha untouched) defeated it | MEDIUM | Added the task-sha join: receipt's `batch_task_sha256` is cross-checked against the unit's own `batch_task_index.json`. The grader's exact escalated attack now fails with `batch_task_sha256 MISMATCH` |
| F-6: 4 of the 42 authoritative units have duplicate `condition_text` within their batch (the F-2/AR-1351 desync-guard blind spot), undisclosed | MEDIUM | Inventory now computes and discloses `duplicate_condition_text_refs` per unit; the 4 known units (`KXWRtV2LOVc` 1, `N7SM8a7Dc9s` 1, `UBvfsImdI2U` 1, `h6TnE7QClJg` 4) show it, matching the grader's own count exactly |
| F-7: `invocation` field asserted a dispatch topology never independently attested | LOW | Renamed to `invocation_declared` + added explicit `invocation_attested: false` on the receipt itself, so the limitation travels with the artifact |
| F-8: multi-strategy predicate counted list length, not distinct index count (latent, fail-closed direction) | LOW | Changed `len(idxs) > 1` to `len(set(idxs)) > 1` |

## RE-VERIFICATION AFTER ALL FIXES

- `strategy_factory_prep_provenance_inventory.py`: still `needs_regeneration_count: 0`, 42
  `opus_batch` / 5 `none`, unchanged from before these fixes.
- `strategy_factory_manifest_row_projection.py` + its dedicated proof
  (`_ar1350a_multistrategy_failclosed_proof.py`): unchanged numeric result (120/102/15/3), all 4
  controls still pass -- F-8's precision fix did not change the live outcome (no actual duplicate
  `(video_id, strategy_index)` pairs exist in this inventory), only its correctness going forward.
- `_ar1350a_adjudication_binding_proof.py` (the original 7-negative + 1-positive control suite):
  re-run clean, all 8 still pass after the F-3/F-4 changes.
- New `_ar1353_f1_finalize_bypass_proof.py`: the grader's exact bypass attack now refused by
  default; escape-hatch path succeeds and visibly stamps the certificate; the real bound
  emit->ingest->finalize path still works end-to-end and stamps `BOUND`.
- New `_ar1353_f5_escalated_attack_proof.py`: the grader's exact escalated plant (which defeated
  the F-4-only check) is now caught by the task-sha join.
- All proof scripts restore every file they mutate via plain file I/O (never `git checkout`)
  and leave `git status --short` clean for anything touched, verified after each run.

## WHAT THIS DOES NOT CLAIM

- The 42 historical certificates are **not** retroactively receipted -- there is no raw dispatch
  text to recover for them, and fabricating one would be worse than the disclosed gap. Their
  `provenance_binding` limitation, if `finalize` were ever re-run on them, would now correctly
  read `UNBOUND_LEGACY` rather than being silently invisible.
- This fix set has **not** itself been independently re-graded. Given the pattern of this
  closeout (two prior independent grades, each finding real issues in the previous fix pass),
  another bundled re-grade is the honest next step before treating Step 12 as closeable -- not
  skipped, but named here rather than silently assumed sufficient.

STOP   : none.
NEXT   : awaiting GPT's/independent grader's read on whether this closes the AR-1353 chain, or
         surfaces a further gap in the same pattern.
