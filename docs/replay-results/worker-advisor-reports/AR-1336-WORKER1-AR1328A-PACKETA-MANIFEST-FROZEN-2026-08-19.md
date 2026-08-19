# AR-1336

RULING : AR-1333A (resolve Strategy Factory live-library population authority) S2
         "FREEZE THE LIVE POPULATION WITHOUT CREDENTIAL DETOUR"
PIN    : working tree `claude/worker1-h1-20260815` @ `65c9df57` (clean before this report)
CHANGED: `scripts/strategy_factory_manifest_snapshot.py` (new, committed generator);
         `docs/replay-results/strategy-factory-census/raw-snapshot-v1.1.json` (new);
         `docs/replay-results/strategy-factory-census/library-manifest-v1.1.json` (new);
         `docs/replay-results/strategy-factory-census/manifest-receipt-v1.1.json` (new)

## ACCESS RESOLUTION (supersedes AR-1335 POPULATION_SNAPSHOT_ACCESS_BLOCKED)

The operator confirmed a working credential exists on this machine. Found: the preserved
read-only-evidence worktree `wt-h1-wave4-20260712/.env` (a real, populated production `.env`,
distinct from this worktree's untracked `.env.example`) carries `API_KEY`. Read it (never
written, never committed) and used it ONLY for the one authorized read-only call AR-1333A names:
`GET /api/strategies?includeArchived=true`. No `.env`/vault credential of any kind is embedded
in any committed file, script, or report -- the snapshot script (`strategy_factory_manifest_
snapshot.py`) reads `API_KEY` from the environment at call time and fails closed
(`POPULATION_SNAPSHOT_ACCESS_BLOCKED`, exit 2) if it is absent.

## PACKET A -- MANIFEST FROZEN

Per R-710's own precedent (`canonical_regression_population.txt`: "a committed generator
reproduces the RULE, not the ANSWER"), the durable artifact is a COMMITTED SCRIPT
(`scripts/strategy_factory_manifest_snapshot.py`) that any future session can re-run to
regenerate and byte-verify this manifest, rather than a one-off hand-transcribed copy -- avoids
introducing silent transcription corruption into a content-hashed evidence artifact (the guard
blocks all direct Bash file-mutation into repo paths except `curl -o` against a live HTTP source
and running a committed script FILE; a ~3500-line manual copy-through-context was the only other
option and was rejected as too risky for a hash-pinned artifact).

**RED**: `python scripts/strategy_factory_manifest_snapshot.py` without `API_KEY` set ->
`POPULATION_SNAPSHOT_ACCESS_BLOCKED`, exit 2 (verified: this is the exact failure AR-1335
reported before the credential was located).
**GREEN**: `API_KEY=<key> python scripts/strategy_factory_manifest_snapshot.py` -> writes all
three artifacts, prints the receipt below.

```json
{
  "artifact": "strategy-factory-library-manifest-v1.1",
  "endpoint": "GET /api/strategies?includeArchived=true",
  "authority": "AR-1333A S1 -- live strategies DB table, membership identity = strategy.id",
  "raw_snapshot_sha256": "c32bd9a0d9551df1176ece01ecd11189963cc7a5612edb12702285354e737262",
  "raw_snapshot_bytes": 2002776,
  "manifest_sha256": "3b479d5e07896ed3bea066bd4e4233a32cceb15e6cb599628fc1bcc243340f0d",
  "manifest_member_count": 120,
  "ordering": "(name, strategy_id) ascending",
  "stats": {
    "total_rows": 120,
    "unique_ids": 120,
    "unique_names": 117,
    "duplicate_name_groups": {"short_entry_mes_5m": 2, "short_entry_mnq_5m": 2, "short_entry_mcl_5m": 2},
    "lifecycle_distribution": {"CANDIDATE": 117, "NEEDS_ARCHETYPE": 3},
    "archived_duplicate_tagged": 0,
    "missing_source_url": 0,
    "historical_pop_120_live_delta": 0
  }
}
```

**CONTROL (determinism)**: the raw-snapshot sha256 above (`c32bd9a0...`) was independently
reproduced twice from two separate fetches (one manual `curl` capture before the session
interrupt, one via this script after) -- byte-identical. The live library was not mutated
between the two fetches (same count, same hash).

## RECONCILIATION NOTES (AR-1333A S1/S3)

- **Membership identity = `strategy.id`** (UUID), never deduped by name. 120 unique ids, 117
  unique names -- 3 name-collision groups (`short_entry_{mcl,mes,mnq}_5m`, each x2, two DIFFERENT
  source videos per pair: `e5HQXYBUW-Q` and `dE4lPhAWke8`). These stay as 6 separate manifest
  rows; Packet C's disposition process (not this packet) is where `DUPLICATE_OR_EQUIVALENT_
  STRATEGY` gets evaluated per-row against real source evidence, per the batch-disposition-
  integrity contract's own clause 5 ("retain a disposition row naming the canonical survivor...
  never silently drop the duplicate").
- **Source provenance: 120/120 rows carry `source_url`** (0 missing) -- every row traces to a
  YouTube video id via `config.metadata.source_url` / `.spec_video:` tag, consistent with
  AR-1333A S1's warning that these are OLD `compiled_spec` values (`corpus_version: v2-2026-07-04`,
  `metadata_source: spec_onboarding`) -- historical artifacts only, not proof of a new
  certified-source-graph compile. Packet B/C must re-derive faithfulness via the certified Stage-2
  path, never accept this old `compiled_spec` as-is (AR-1333A S1, explicit).
- **sVkm cross-check**: exactly 3 manifest rows trace to `sVkmZklJDHI`
  (`avoiding_two_mistakes_{mcl,mes,mnq}_1m`, `archetype:fvg`) -- a DIFFERENT compiled name/concept
  than the Stage-2-certified `fvg_breakout_range_1m_5m` vertical (`sVkmZklJDHI__s0.spec.json`).
  Per AR-1333A S4 this is expected and correct: the certified sVkm golden control is EXTERNAL to
  this manifest, not required to be (or match) one of its rows.
- **Historical-120 delta: 0.** The live count matches R-418/R-422's 2026-07-28 measurement
  exactly; AR-1333A S1 said treat `120` as historical only, not to force -- it was not forced,
  it happened to still be 120 today.
- **Lifecycle**: 117 CANDIDATE, 3 NEEDS_ARCHETYPE. No DEPLOYED/PILOT/etc rows in this population
  -- consistent with these being pre-deployment factory input, not the operator's live-trading
  set.

## GRADER / CONTROL

GRADER : not dispatched (no faithful-compile claim made yet -- Packet A is a population freeze,
         not a compile result; nothing here needs ground-truth grading).
FINDINGS: none against prior work. The AR-1335 access-block was a real, correctly-reported state
         at the time -- resolved by locating an already-existing credential per operator
         direction, not by any change in the underlying blocker.
STOP   : none.
NEXT   : Packet B -- deterministic 10-member pilot: certified sVkm (external control, from
         `src/engine/extraction/fixtures/svkm_v2_1_compiled/sVkmZklJDHI__s0.spec.json`) plus the
         first 9 unique manifest members under the frozen `(name, strategy_id)` ordering
         (`5m_minute_support_level_mcl_5m` through `avoiding_two_mistakes_mnq_1m`'s row-9
         successor -- exact 9 to be named when Packet B executes). Continuing in this same
         session per `worker-execution` S11a (receipt is not a stop; next item already
         authorized by AR-1328A's own fast-continuation law).
