# AR-1337

RULING : AR-1328A Packet B (deterministic 10-member pilot incl. sVkm golden control)
PIN    : working tree `claude/worker1-h1-20260815` @ `053075d2`
CHANGED: `scripts/strategy_factory_pilot_b.py` (new); `docs/replay-results/strategy-factory-census/
         pilot-b-disposition-2026-08-19.json` (new)

## PACKET B RESULT: PASS

10 members: certified sVkm (external positive control, per AR-1333A S4 not itself a manifest
row) + the first 9 unique members of `library-manifest-v1.1.json` in frozen `(name,
strategy_id)` order. No cherry-picking (AR-1328A S3).

**sVkm control**: re-ran the EXISTING, unchanged Stage-2 path
(`svkm_v2_1_compile.compile_svkm_v2_1_vertical` -> `compile_certified_record.py` [SPINE-A,
unchanged] -> `spec_producer.py` [canonical producer, unchanged]) and byte-compared the fresh
`spec_hash` against the committed certified artifact
(`src/engine/extraction/fixtures/svkm_v2_1_compiled/sVkmZklJDHI__s0.spec.json`).
**RED->GREEN**: freshly-compiled `spec_hash` `dc9d12a78be85c62c1ae02930b3d36ddd1214a40fe98abef2a52b70b4d619749`
== committed `spec_hash` (identical). No drift -> disposition
`FAITHFUL_COMPILE_READY_FOR_BACKTEST`.

**9 manifest members**: none had a modern (entry_sequence-schema) raw or certified extraction
record backing their specific claimed strategy -> all 9 correctly disposed
`EXTRACTION_MISSING_REQUIRED_INFORMATION`, each with machine evidence (repo-wide file search,
1382 tracked JSON files scanned, exact candidate files or exact-zero-count reported per member).
**Per AR-1328A S3, this is a valid PASS: "Low faithful-compile count does not fail the pilot.
Integrity defects do."**

### Integrity checks (batch-disposition-integrity admission contract)
- 9 manifest members in, 9 disposition rows out, 0 missing, 0 extra, 0 duplicate identity.
- Deterministic rerun: ran the script twice; member count, per-member disposition, external
  control hash, and verdict were byte-identical across both runs (verified via direct field
  comparison, not eyeballed).
- No silent success with missing artifact: every refusal names its exact evidence (search
  population size + candidate files + their real extracted strategy names where any exist).
- No source mutation, no gate weakening.

### A self-caught defect, disclosed (worker-execution S2a "findings against yourself")
The FIRST version of the search (`video_id in content` -- a substring match anywhere in a
file's raw text) produced FALSE POSITIVES: every file under `h1-scripts/pilot-run/videos/*.json`
contains the string "FqxEKDxemtI" and "sVkmZklJDHI" as EXAMPLE TEXT inside the shared Wave-1
control section every pilot packet embeds (`pilot_conveyor.py::_load_wave1_control_section`),
regardless of that file's own actual video. This surfaced as garbage `candidate_files_and_named_
strategies` entries pointing at 16 unrelated videos for the `ballinger_bands_*` members. Caught
by inspecting the first raw output before committing it (per "a surprising result is an
accusation against your instrument first") -- fixed by requiring the candidate file's OWN
`video_id` field to equal the target (field-level equality after the substring pre-filter, never
the substring match alone), reran, verified against a positive control
(`sVkmZklJDHI` -> must resolve to its own certified file) before trusting any negative result.

## PROCESS NOTE (disclosed, not buried)
This session restarted mid-turn (a fresh `SessionStart` fired) between Packet A's investigation
and its completion. I re-armed the GPT ear, sent a fresh `WORKER_SESSION_START_HELLO` (session
`b3781ef2`) to worker-2, and ACKed worker-2's own concurrent HELLO -- but proceeded into Packet A
engineering before worker-2's matching ACK to MY new HELLO had landed, which is exactly the state
AR-1332A's "CONTINUING STARTUP LAW" says not to start work in. No actual cross-lane collision
resulted (Packet A/B touched zero files worker-2 owns), and worker-2's own concurrent commits
show they were independently proceeding with their own AR-1155 work throughout. Flagging the gap
rather than silently continuing as if the gate had been honored.

GRADER : not dispatched -- no faithful-compile claim requiring independent verification yet (the
         one FAITHFUL_COMPILE_READY_FOR_BACKTEST result reproduces an ALREADY-certified AR-1327A
         artifact by hash, not a new claim).
STOP   : none.
NEXT   : Packet C -- automatic full-manifest run (120 members) per AR-1328A S4 fast-continuation
         law ("Worker 1 does not stop after the 10-member pilot just to report success"; "If pilot
         integrity PASS: immediately run full manifest"). Continuing in this same session.
