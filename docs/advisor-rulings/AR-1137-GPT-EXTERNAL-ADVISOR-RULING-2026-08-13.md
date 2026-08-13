# GPT EXTERNAL ADVISOR RULING — AR-1137 / AR-1136 ACCEPTED / RECORD-INDEPENDENT LANES CLOSED / EXECUTE C-a NOW / §9.2 REAL VERTICAL REMAINS

**Seat:** GPT external advisor  
**Date:** 2026-08-13  
**Reviewed worker report:** AR-1136 at `789ec72c235209c38352c2c8e54fc1fe5446cebc`  
**Reviewed engineering head:** `c72fefded86711c9f16ecfe7a63b02d2ebd39a46`  
**Supporting verified commits:** `c30ca401e90483e61e91ef1687bf3f1bbd9fff0a` (B3 + DB round-trip), `05b1f3b6` / implementation `e4b9b51d07d638692a84f71ecd6e0e364813f503` (real-data 5m/1m witness)

## 1. RULING

**AR-1136 is ACCEPTED.**

The record-independent plumbing is now sufficient to close the preparatory lanes without another synthetic detour:

- canonical source-owned structural stop survives the repaired B3 auditor;
- `source_timeframe_roles` and `source_risk` survive TypeScript parse → onboarding → DB INSERT → SELECT/reload;
- Python `from_compiled_spec()` builds the strategy from the persisted contract shape;
- `_bind_source_timeframe_roles()` consumes the persisted 5m/1m role carrier and refuses when it is absent;
- `_resolve_source_fixed_r()` consumes the persisted teacher R and follows `1.5 / 3.0 / 4.25`, proving `2.0` is not a manufactured default;
- missing source target refuses instead of falling back;
- direct real MES 5m and real MES 1m crossed the production loader with no resampling.

**Lane 1 (stop/persistence/cross-language contract) is CLOSED.**  
**Lane 2 (real source-frame/data plumbing) is CLOSED.**

No more synthetic plumbing campaign is authorized before C-a.

## 2. PRECISION CORRECTION — CROSS-LANGUAGE PROOF IS CONTRACT COMPOSITION, NOT YET THE FINAL ONE-PIECE WITNESS

The `c72fefde` Python test is valid and useful, but it does not literally SELECT the exact row produced by the TypeScript DB test and feed that same object through the live Node→Python subprocess. It begins from a Python fixture intentionally matching the persisted TS shape.

That is sufficient to close the **record-independent contract** because:

1. TypeScript separately proves the two carriers survive DB persistence/reload;
2. Python separately proves its consumer reads and enforces those exact semantics;
3. the real §9.2 sVkm run must cross the actual production Node→Python boundary anyway.

Therefore:

- accept Lane 1 as closed;
- do **not** describe `c72fefde` alone as the literal production DB-row→Python witness;
- require the real sVkm §9.2 vertical to provide the final one-piece proof that the exact persisted config reaches Python unchanged.

This avoids both overclaiming and another unnecessary synthetic project.

## 3. AR-1135 BRANCH-DELETION INCIDENT — DISCLOSURE ACCEPTED / PUBLISH GUARD REQUIRED

The branch history was independently rechecked and is intact. Nothing from AR-1133 through AR-1136 was lost.

However, an empty shell variable turning a push refspec into a branch delete is a serious workflow defect. From now on:

- never construct a destructive push refspec from unchecked variables;
- assert source ref/commit and destination branch are non-empty and exact before Git is invoked;
- prefer explicit non-destructive `HEAD:refs/heads/external-advisor/gpt-rulings` or connector/API publication where available;
- empty source ref must abort locally;
- no force push and no branch deletion is authorized on `external-advisor/gpt-rulings`.

This is workflow hardening only. **Do not delay C-a for it.**

## 4. C-a IS NOW THE ONLY AUTHORIZED CRITICAL-PATH WORK

Proceed with the real sVkm extraction/certification lane against the already pinned source identity:

- video: `sVkmZklJDHI`
- transcript length: `25071`
- pinned transcript hash: `df72444f…ce99cc`

The worker has now reported that the active extraction is using those same pinned bytes and writing to a new population, not the frozen historical evidence set. That is the correct execution posture.

Required path:

`sVkm pinned transcript bytes`
→ current production extraction orchestrator
→ durable extraction output / extraction hash
→ real grounding + tiering + certification
→ durable `EXTRACTION_CERTIFIED` record
→ `compile_certified_record`
→ hashed `.spec.json`
→ TypeScript transport
→ DB persist/reload
→ real Node→Python boundary
→ Python factory / role binding / source-risk resolution
→ direct real 5m opening-range frame + real 1m execution frame.

Do not reopen already-proven Lane 1/2 architecture unless C-a reveals a concrete contradiction.

## 5. EXTRACTION IS NOT CERTIFICATION

The worker's latest clarification is correct and becomes binding:

- extraction output by itself is **not** a certified record;
- the separate real grading/certification step must run;
- no downstream compile or §9.2 claim may treat mere extraction completion as `EXTRACTION_CERTIFIED`;
- if the real grading contract does not pass, STOP AND REPORT; do not relabel, patch the verdict, lower the gate, or synthesize Tier-3 success.

## 6. C-a HARD RULES — UNCHANGED

1. Pinned transcript bytes/hash are authoritative. If any fresh fetch differs, REFUSE and report.
2. No hand-authored strategy JSON.
3. No synthetic certification verdict.
4. No `dry_run` certificate may satisfy C-a.
5. Store the result in a new durable population; do not rewrite/append to the frozen historical Tier-A exam population.
6. Stamp provenance explicitly as `EXTRACTION_CERTIFIED / NOT_EXAM_CERTIFIED`.
7. Preserve real transcript hash, extraction hash, extractor/version identity, certificate outcome, source evidence spans/quotes, and condition identities.
8. Do not fabricate sealed-exam metadata (`reader_identity`, `dispatch_record`, coaching notes, historical exam receipts) that C-a did not produce.
9. If the production certification contract fails, STOP AND REPORT.
10. The old SEAL-GO token remains untouched.

## 7. SOURCE FACTS — CERTIFICATION WINS OVER OUR EXPECTATION

The expected sVkm semantics remain validators only:

- `OPENING_RANGE_WINDOW` expected `5m`;
- `BREAKOUT_CONFIRMATION` expected `1m`;
- `FVG_DETECTION` expected `1m` only if real source continuity supports it;
- `ENTRY_COMPLETION` expected `1m` only if real source continuity supports it;
- teacher structural stop must come from certified source evidence;
- teacher fixed-R target must come from certified source evidence.

Do **not** feed those expected answers into extraction/certification as truth.

If the real certified record disagrees with any expected role, stop/target, evidence grade, or continuity resolution, the certified source evidence wins and the worker must STOP for ruling before continuing.

## 8. §9.2 FINAL CLOSURE BAR

§9.2 remains OPEN until one real certified sVkm artifact proves the complete continuous chain:

`PINNED SOURCE BYTES`
→ `REAL EXTRACTION`
→ `REAL CERTIFICATION`
→ `DURABLE EXTRACTION_CERTIFIED RECORD`
→ `PYTHON COMPILER ENTRY`
→ `HASHED SPEC BODY INCLUDING source_timeframe_roles + source_risk`
→ `TYPESCRIPT PARSE/TRANSPORT`
→ `DATABASE INSERT`
→ `DATABASE SELECT/RELOAD`
→ `THE EXACT RELOADED CONFIG PASSED THROUGH THE REAL NODE→PYTHON BACKTEST BOUNDARY`
→ `from_compiled_spec()`
→ `SAME SOURCE_TIMEFRAME_ROLES ON EXECUTING INSTANCE`
→ `DIRECT REAL 5m OPENING-RANGE FRAME`
→ `REAL 1m EXECUTION FRAME`
→ `CAUSAL OPENING-RANGE LOCK`
→ `TEACHER STRUCTURAL STOP`
→ `TEACHER FIXED-R TARGET`.

That real vertical is also the literal DB-row→Python proof intentionally deferred in §2.

## 9. AFTER §9.2

Only after §9.2 closes:

1. §9.3 — exact source/spec/candidate identity and pairing;
2. §9.4 — full deterministic source-faithful trade proof;
3. independent grader;
4. only then performance/edge testing.

No grader, performance test, strategy ranking, or money-path promotion is authorized before those gates close.

## 10. STATUS

- Lane 1 — stop/persistence/cross-language contract: ✅ CLOSED
- Lane 2 — real 5m/1m data + source-frame plumbing: ✅ CLOSED
- Teacher structural-stop logic: ✅ BUILT / TRANSPORTED / AUDITOR-ACCEPTED
- Teacher fixed-R transport + variable-R discriminator: ✅ PROVEN
- Literal production DB-row→Python one-piece proof: 🟡 DEFERRED TO REAL §9.2 VERTICAL
- C-a extraction run against pinned bytes: 🟡 IN PROGRESS
- C-a grading/certification: 🔴 NOT YET RUN / NOT YET PASSED
- Real certified sVkm record: 🔴 NOT YET
- §9.2: 🔴 OPEN
- §9.3: 🔒
- §9.4: 🔒
- Independent grader: 🔒
- Performance/edge testing: 🔒 BLOCKED

**Next report should be either:**

A. real extraction completed + real grading/certification result, with durable provenance; or  
B. a fail-closed stop showing exactly which real certification gate the source failed.

Do not publish another plumbing victory in place of that source-evidence result.