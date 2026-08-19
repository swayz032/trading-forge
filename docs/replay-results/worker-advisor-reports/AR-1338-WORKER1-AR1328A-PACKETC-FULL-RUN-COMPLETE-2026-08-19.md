# AR-1338

RULING : AR-1328A Packet C (automatic full-library run) + S8 required full-run receipt
PIN    : working tree `claude/worker1-h1-20260815` @ `0f6d57f9`
CHANGED: `scripts/strategy_factory_pilot_c_full_run.py` (new);
         `docs/replay-results/strategy-factory-census/pilot-c-full-run-2026-08-19.json` (new)

## AR-1328A -- COMPLETE. FACTORY VERDICT: PASS.

Full fast-continuation chain executed in one session, per S4's exact ordering: freeze manifest
(AR-1336) -> 10-member pilot PASS (AR-1337) -> immediate full run, no routing pause (this AR).

### Required receipt (AR-1328A S4.8)

1. **Manifest pin**: `docs/replay-results/strategy-factory-census/library-manifest-v1.1.json`,
   sha256 `3b479d5e07896ed3bea066bd4e4233a32cceb15e6cb599628fc1bcc243340f0d`, 120 members, frozen
   `(name, strategy_id)` order (AR-1336).
2. **Input/output/unique identity sets**: 120 in, 120 out, 120 unique input ids, 120 unique
   output ids.
3. **Missing/extra/duplicate sets**: all empty (`missing_ids: []`, `extra_ids: []`,
   `duplicate_output_ids: false`).
4. **Per-disposition membership** (not counts alone -- full strategy_id lists are in the
   committed `pilot-c-full-run-2026-08-19.json`'s `per_disposition_membership` field):
   - `FAITHFUL_COMPILE_READY_FOR_BACKTEST`: 0 manifest members (the 1 faithful compile in this
     run is the EXTERNAL sVkm control, not a manifest row -- AR-1333A S4).
   - `EXTRACTION_MISSING_REQUIRED_INFORMATION`: 120/120 manifest members.
5. **Faithful-compile artifact hashes/provenance**: sVkm external control only --
   `spec_hash dc9d12a78be85c62c1ae02930b3d36ddd1214a40fe98abef2a52b70b4d619749`, reproduced
   byte-identical against the AR-1327A-certified committed artifact via the unchanged Stage-2
   path (`svkm_v2_1_compile.py` -> `compile_certified_record.py` [SPINE-A] -> `spec_producer.py`).
6. **Refusal evidence and exact failed seam**: uniform across all 120 -- no repo-tracked
   modern-schema (`entry_sequence`) extraction record exists that both (a) carries the row's
   source video as its own `video_id` field and (b) names the row's specific claimed strategy.
   The failed seam is identical for every row: **raw/certified extraction input, not the
   compiler**. `compile_certified_record.py`/`spec_producer.py` were never invoked for any of
   the 120 (there is nothing to hand them) -- only the sVkm control, which already had a
   certified input, reached the compiler.
7. **Deterministic repeat result**: Packet B and Packet C were each run twice; member count,
   per-member disposition, disposition_counts, cluster count, and the external-control hash were
   byte-identical across both runs of each packet (verified by direct field comparison, not
   eyeballed -- see AR-1337 and this packet's own run log).
8. **Reusable refusal-capability clusters, ranked**: 40 distinct source videos, EACH blocking
   exactly 3 manifest rows (the corpus's uniform x3-symbol MES/MNQ/MCL expansion). No cluster
   outranks another by count -- all 40 are tied at 3. Full ranked list (video_id ->
   [blocked strategy_ids]) is in the committed report's `refusal_capability_clusters_ranked`
   field. Practically: **a single new modern extraction for any one of these 40 videos unlocks
   exactly 3 manifest rows at once** -- this is the concrete, evidence-backed prioritization
   input for whatever downstream extraction-investment decision comes next (not made here; out
   of this packet's scope).
9. **Final factory verdict**: **PASS**. No integrity defect fired: 0 missing/extra/duplicate
   identities, 0 invalid dispositions, external control reproduced without drift, search
   methodology positive control passed on every run.

### Honest headline, scoped correctly (worker-execution S11b 4a)
**0 of 120 live-library manifest members produced a faithful new-pipeline compile. 120/120
received the evidenced refusal `EXTRACTION_MISSING_REQUIRED_INFORMATION`.** Per AR-1328A S3 this
is explicitly NOT a factory failure: *"Low faithful-compile count does not fail the pilot.
Integrity defects do."* The census MEASURED the library honestly -- the entire 120-row live
library was extracted/compiled under an OLDER pipeline (`corpus_version: v2-2026-07-04`,
`metadata_source: spec_onboarding`) that predates the certified-source-graph discipline Stage 1/2
proved on sVkm; none of it has been re-extracted under the modern schema. That gap is the
measured finding, not a defect in this packet's own execution.

### What this packet does NOT claim
- Does not claim any of the 120 rows are bad strategies, wrong, or should be removed --
  `EXTRACTION_MISSING_REQUIRED_INFORMATION` is a statement about available INPUT, not about the
  strategy's trading merit.
- Does not launch, and this packet did not authorize, any new extraction/model/Agent/Opus
  campaign to close the gap (AR-1328A S5, explicit).
- Does not touch backtesting, edge screening, or qualification -- those are the NEXT gate
  (AR-1328A S8), not this one.

## GRADER
Not dispatched. The one FAITHFUL_COMPILE_READY_FOR_BACKTEST result reproduces an
ALREADY-independently-certified (AR-1327A) artifact by exact hash match -- not a new claim
needing ground-truth grading. The 120 refusals are each a NEGATIVE/absence claim with a positive
witness (the search ran, found N candidate files, named them) -- consistent with worker-onboarding
S3's "a negative assertion still owes a positive witness that the path executed."

STOP   : none.
NEXT   : AR-1328A's own S8 names the next gate as GPT's to authorize from this census ("GPT will
         inspect the full factory census and authorize the next bounded gate from repository
         evidence") -- cheap source-faithful edge screening on survivors, deepened only for
         those. With 0 manifest survivors and the sVkm external vertical already ahead of this
         census, that next-gate decision is GPT's, not self-authorized here. Holding for GPT's
         disposition on AR-1328A's completion and whatever it names next.
