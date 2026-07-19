# Ratify packet — R-048 (strict-key guard · SUPERSEDED_BY_REMAP annotation · effective-N dedup)

Autonomous under independent grade (doer≠grader). Pre-live, no live capital, no
frozen-ref invalidation → not the reserved class. Engine SHA 404a3396.

## 1. What & why now

R-048 ruled on AR-044 (the WAVE-1R re-map). Three orders:

- **§2 — the F-1 silent-degradation class dies at the mapping layer.** The
  original F-1 defect read a *nonexistent* `min_paths` key via `.get()`, silently
  defaulting → cpcv verdict degraded to a constant PASS. Order: *"reading a
  missing key in any verdict/disposition mapping RAISES fail-loud, never
  defaults."* One guard kills the whole class (same disease as the hardcoded
  `engine_sha_verified` string, in read form).
- **§3 — supersession is OVERRULED; append-only is absolute.** No counter/ledger
  row is ever deleted. The buggy WAVE-1R rows are **annotated
  `SUPERSEDED_BY_REMAP` (ref AR-044)** — honest executions of a defective audit,
  history stays whole. The corrected re-run appends NEW dense ids.
- **§3 — the double-count is solved by CONSTRUCTION, not curation.** The luck-math
  consumes **EFFECTIVE-N**, computed by deduplicating identical deterministic
  replicates: collapse on `(spec_hash × engine_sha × dataset_hash × config_hash)`.
  The buggy run and the corrected re-run share all four (the re-map changed the
  *disposition reading*, never the experiment) → they collapse to ONE in the
  denominator automatically. Shakedown (synthetic data) and future configs stay
  distinct tuples. Statistical honesty computed, never curated.

Receipts: `docs/designs/ADVISOR-RULINGS.md` R-048; grader BAND-5 finding on
AR-044 (F-1 cpcv `min_paths`); `wf_probe_result.json` confirms the WF class-result
schema (`wf_metadata`, `pbo_overall`, `bif`, `slippage_survival`, …).

## 2. Blast radius

- `src/engine/battery/trial_counter.py` — additive: two optional `allocate`
  params (`dataset_hash`, `config_hash`), two new read-side methods
  (`annotate_superseded`, `effective_n`). No existing field changes; old rows
  (lacking the two hashes) read as `None` components — still valid tuples.
- `src/engine/battery/passage_ledger.py` — additive: same two optional `record`
  params + `annotate_superseded`. No verdict/alarm logic touched.
- `run_wave1r.py` `_wf_gate_rows` — the strict-key guard (`_req`) at each
  verdict-determining read. A future schema drop now RAISES → caught by the
  runner's per-spec try/except → visible `ABORTED` with signature (fail-loud AND
  visible), never a silent constant.
- No certification, frozen ref, or live default invalidated. The 77 stay SEALED.
- The buggy WAVE-1R counter/ledger rows are RETAINED (annotated), not cleared —
  the append-only invariant (R-042 pin 1e) is preserved, not weakened.

## 3. The exact change, scope-locked

IN scope:
- `trial_counter.allocate(..., dataset_hash=None, config_hash=None)` → stored on
  the row. `annotate_superseded(*, wave, by, strategy_ref=None)` adds a
  `superseded_by_remap` field to matching rows (no delete, no re-id, no
  outcome change). `effective_n(*, wave=None)` → `{raw_n, effective_n, groups}`
  deduping on the 4-tuple.
- `passage_ledger.record(..., dataset_hash=None, config_hash=None)` +
  `annotate_superseded(*, wave, by, strategy_ref=None)`.
- `_wf_gate_rows`: `_req(d, key, ctx)` strict read at cpcv `n_paths`, dsr
  (`dsr_unavailable`/`dsr`/`dsr_pass`), `wfe_overall`/`wfe_status`,
  `pbo_overall`/`pbo_degenerate`, `bif`/`bif_computation_error`. Branch
  discriminators that legitimately test optional presence stay on `.get()`.
- `run_wave1r.py`: thread real `dataset_hash` (S3 ratio-adj) + `config_hash`
  (WF_START/END/embargo/mode/floor) into allocate + ledger.record. Run
  `annotate_superseded` on the pre-existing buggy WAVE-1R rows before the re-run.

OUT of scope: no engine/gate/threshold change; no verdict math change; no
deletion of any row; no change to shakedown artifacts; WIRE-1 untouched.

## 4. Verification plan

- Unit: `annotate_superseded` adds the field to exactly the buggy rows, leaves
  the row count + ids + outcomes unchanged (append-only proof).
- Unit: `effective_n` collapses the buggy+corrected wave-1R replicates of one
  spec to 1, keeps shakedown (distinct dataset_hash) and distinct specs separate;
  `raw_n` still equals `len(runs)` (nothing deleted).
- Unit: `_req` RAISES on a synthetic result missing `n_paths`; the runner records
  ABORTED with the signature (fail-loud visible, not silent PASS).
- Live: corrected full WAVE-1R re-run on real S3 bars appends NEW ids; raw slices
  persisted; dsr WITNESSED (per the F-3 fix); wrc/spa/mc PATH_GATED. Independent
  re-grade (doer≠grader).

## 5. Rollback

All additive — revert the three files to restore prior behavior. The annotation
is a metadata field (ignore it → identical stats). No flag needed (no live
default altered). The re-run appends; reverting the code leaves the appended rows
(honest history), consistent with append-only.
