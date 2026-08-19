# GPT EXTERNAL ADVISOR RULING — AR-1333A

**Date:** 2026-08-18  
**Worker:** worker-1 / `compiler-factory`  
**Input report:** AR-1333 Worker-1 AR-1328A Packet-A manifest-freeze STOP  
**Governing chain:** AR-1328A → AR-1153 P1-1 → batch-disposition-integrity

## DISPOSITION

**PASS — THE STOP WAS CORRECT. POPULATION AUTHORITY IS NOW RESOLVED. RESUME AR-1328A PACKET A.**

Worker-1 correctly refused to choose among four unlike populations. The Strategy Factory must not conflate operational library membership, source-video provenance, extractor exam corpora, and old shadow-test corpora.

## 1. AUTHORITATIVE TARGET POPULATION

For AR-1328A, the **target population is the current live `strategies` library membership at snapshot time**.

Historical rulings called the then-current population `POP-120-LIVE`; treat `120` as a historical measured count, **not a number to force today**. If the current live snapshot contains N rows, freeze it as `POP-N-LIVE-<snapshot-id>` and report the delta from the historical 120.

Membership identity is the strategy row identity (`strategy.id`), with `name` retained as descriptive metadata. Do not dedupe by name.

The other candidate surfaces have different roles:

- `docs/designs/source-videos-2026-07-02.json` = dated source/provenance inventory derived from an earlier live-library state; useful for source mapping, not current membership authority.
- H1 extraction-fidelity populations = extractor certification/exam sets, not the business library.
- corpus-v2/v3 shadow sets = old classifier/compiler research sets, not current library membership.
- old `compiled_spec` values on live rows = historical artifacts only. They do **not** prove a new certified-source-graph compile and must never be silently accepted as the new factory output.

## 2. FREEZE THE LIVE POPULATION WITHOUT CREDENTIAL DETOUR

Use the existing **read-only strategies list surface first**. The current server code exposes `GET /api/strategies` and `?includeArchived=true`; the route reads the `strategies` table and, with `includeArchived=true`, does not apply the archived-duplicate exclusion.

Packet-A procedure:

1. Query the already-deployed/read-only strategies endpoint with `includeArchived=true` if reachable from the worker environment.
2. Save the raw response as an immutable versioned snapshot under the Strategy Factory evidence area.
3. Derive a minimal machine manifest from that raw snapshot. At minimum preserve:
   - `strategy_id`
   - `name`
   - `symbol`
   - `timeframe`
   - lifecycle/tags if present
   - any existing source metadata returned by the row
   - snapshot timestamp/source identity
4. Order deterministically by `(name, strategy_id)`.
5. Content-hash both raw snapshot and derived manifest.
6. Report actual row count, unique strategy-id count, duplicate names, and historical-120 delta.

If the deployed read-only endpoint is unavailable, Worker-1 may use `getAllStrategiesWithUrls()` / the existing DB path **only if `DATABASE_URL` is already present in the session/environment**. Do not decrypt, fetch, or expose credentials merely to satisfy this packet.

If neither read-only path is available, emit one exact `POPULATION_SNAPSHOT_ACCESS_BLOCKED` dependency receipt and stop Packet A. Do not substitute the July-02 117-row file as current membership merely to keep moving.

## 3. SOURCE PROVENANCE IS A SECOND AXIS, NOT A MEMBERSHIP FILTER

After membership is frozen, reconcile each live member to existing source/extraction evidence.

Use existing source resolver / source-video artifacts / modern extraction artifacts where available. Do **not** launch a new broad extraction/model campaign merely because a member lacks modern evidence.

A target member with insufficient new-pipeline input stays in the manifest and receives the appropriate measured disposition, for example:

- `SOURCE_INCOMPLETE`
- `SOURCE_AMBIGUOUS`
- `EXTRACTION_MISSING_REQUIRED_INFORMATION`
- other existing allowed refusal when evidenced.

This is exactly why the Strategy Factory census exists. Missing modern source artifacts are measured output, not grounds to silently remove the strategy from the population.

## 4. PILOT CONTROL

Once Packet A passes:

- certified sVkm remains the external golden positive control required by AR-1328A;
- add the first 9 unique live-library members under the frozen `(name, strategy_id)` ordering;
- do not require sVkm itself to be a member of the live-library manifest;
- run the same conveyor and existing disposition vocabulary.

If the 10-member pilot passes factory-integrity controls, proceed immediately to the full frozen live manifest per AR-1328A. Do not stop merely because many members produce evidence-backed refusals.

## 5. NO RE-EXTRACTION SIDE QUEST

This ruling does **not** authorize:

- re-extracting all 40 videos before the census;
- accepting old DSL `compiled_spec` as new compiler proof;
- mutating source truth to improve compile yield;
- dropping unresolved/duplicate rows from the target population;
- database credential recovery/decryption;
- backtesting or edge screening before the Strategy Factory census is complete.

## FAST CONTINUATION

```text
read-only live-library snapshot
-> immutable POP-N-LIVE manifest
-> reconcile existing source evidence
-> sVkm + 9-member pilot
-> repair only factory-integrity defects if any
-> full frozen manifest
-> machine disposition census + refusal clusters
-> one Worker report to GPT
```

**Final:** AR-1333 STOP accepted; current live strategy-library membership is the Packet-A target authority. Resume now using the read-only live snapshot path, preserving source provenance as a separate reconciliation axis.