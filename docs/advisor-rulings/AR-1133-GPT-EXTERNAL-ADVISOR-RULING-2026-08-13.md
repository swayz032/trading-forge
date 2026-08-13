# GPT EXTERNAL ADVISOR RULING — AR-1133 / AR-1132 ACCEPTED / STOP AUDITOR DEFECT FOUND / C-a APPROVED / REAL-5m PREDICATE RULED / §9.2 STILL OPEN

**Seat:** GPT external advisor  
**Date:** 2026-08-13  
**Reviewed worker report:** AR-1132 at `b6f60a74132126a92163dda195c51ba1fe44a327`  
**Reviewed engineering head:** `83c6fa411e31dce1244a30d103c563117592362e` (implementation `4727dbaacb7d7267fb4c8cb61ba3e4bc43c1b941`)

## 1. RULING

**AR-1132 is ACCEPTED as a stop-and-report.** The newly transported `source_risk` correctly activates the source-owned stop path. Do **not** revert B-RISK-1.

However, the worker's framing of the collision is corrected:

> **There is NOT a standing CLAUDE.md rule requiring every stop to be ATR. The auditor is stale.**

Measured repository evidence:

- `CLAUDE.md` §4 is titled **"Stop Loss — structural, NEVER fixed-point"**.
- `CLAUDE.md` §13 says **"Don't use fixed-point stops ... structural with ATR bounds."**
- `framework-overlay.ts` already has an explicit SOURCE-RISK-HANDOFF branch that preserves `ownership === "source"` and documents that AR-1059 superseded the historical replacement policy for `SOURCE_FAITHFUL`.
- `framework-overlay-source-faithful.test.ts` already regression-tests that exact rule and explicitly records that the old "non-ATR = fixed-point" warning inverted CLAUDE.md.
- `graduated-strategy-auditor.ts` still does `if (sl?.type !== "atr") -> B3_FIXED_POINT_STOP` and therefore misclassifies a structural source stop as a fixed-point stop.

So this is **not a new stop-loss design decision**. It is a stale auditor rule blocking an already-authorized source-faithful contract.

## 2. STOP-LOSS HISTORY — THE OPERATOR WAS RIGHT

AR-1056 / AR-1059 did build the teacher-stop path. The problem was integration:

1. `source_risk` was dropped by the TypeScript parser.
2. Because it was dropped, `resolveSpecStopLoss()` always saw no source contract and returned ATR 1.5.
3. Therefore the stale B3 auditor never encountered `source_structural` and the contradiction stayed hidden.
4. B-RISK-1 fixed the transport defect.
5. That exposed the old auditor defect.

**Do not describe the earlier teacher-stop work as if it never existed.** The feature existed; it was dead on the onboarding path because another bug prevented its contract from reaching it.

## 3. ORDER S-A+ — REPAIR B3, BUT NARROWER THAN THE WORKER PROPOSED

**AUTHORIZED NOW.**

Do **not** merely whitelist `type === "source_structural"` because a caller could counterfeit the strings `ownership:"source"` / `source_exact:true`.

The auditor must use the existing canonical source contract as the authority.

### 3.1 Framework-owned stop

If `strategy.stop_loss.type === "atr"`:

- preserve the existing B1/B2 multiplier checks byte-for-byte;
- legacy/framework behavior remains unchanged.

### 3.2 Source-owned structural stop

If `strategy.stop_loss.type === "source_structural"`:

1. require `config.compiled_spec.spec.source_risk.mode === "SOURCE_FAITHFUL"`;
2. call the existing pure canonical `resolveSpecStopLoss(config.compiled_spec.spec)`;
3. it must successfully resolve to `type:"source_structural"`;
4. the resolved canonical stop must match the final audited `strategy.stop_loss` on the complete semantic payload — at minimum `type`, `anchor`, `required_anchor`, `include_wick`, `source_exact`, `ownership`, and `span`;
5. any resolver refusal, missing source contract, mismatch, changed anchor, changed required-anchor, fake ownership stamp, or extra unsupported stop type remains a **B3 defect**.

This preserves the actual safety rule:

> **No arbitrary fixed-point stop. No source-owned stop unless it is provably the canonical output of the certified source contract.**

Do not create a second anchor mapping inside the auditor. Reuse `resolveSpecStopLoss()` / its existing authority.

### 3.3 Documentation correction

Correct the stale B3 comment/message so it no longer claims CLAUDE.md says "ATR only". Do **not** rewrite CLAUDE.md into a new policy; the current CLAUDE.md text is already directionally correct.

### 3.4 Required tests

Must prove:

- compliant ATR remains green;
- `points`, `fixed_point`, and any unrelated non-ATR stop still fail B3;
- a source-looking structural stop with no `compiled_spec.spec.source_risk` fails;
- fake `ownership:"source"` fails;
- altered anchor fails;
- altered `required_anchor` fails;
- altered span fails;
- canonical `resolveSpecStopLoss()` output from a valid SOURCE_FAITHFUL contract passes;
- ablate the source-contract comparison and at least one counterfeit-stop test goes red.

## 4. B-DB-ROUNDTRIP-1 — RESUME IMMEDIATELY AFTER B3 REPAIR

The worker's five-case round-trip proof is still required. Finish it; do not weaken it.

The DB witness must prove:

1. valid `source_timeframe_roles` **and** `source_risk` parse → onboard → INSERT → SELECT/reload with byte/semantic identity preserved;
2. the reloaded `compiled_spec.spec.source_timeframe_roles` contains the same four role facts;
3. the reloaded `compiled_spec.spec.source_risk` contains the same teacher stop + `FIXED_R` target;
4. malformed-present role carrier creates **no row**;
5. legacy artifact with both source contracts absent remains legacy-compatible.

Then cross the language boundary:

- build the real Python `SpecConditionStrategy` from the reloaded config;
- `_bind_source_timeframe_roles()` must consume the persisted role carrier;
- `_resolve_source_fixed_r()` must return the persisted teacher R value — **2.0 for the current sVkm expectation only if the certified record actually proves 2R**;
- no default may manufacture 2.0.

## 5. D-REAL-1 — REAL 5m DATA IS NOW AUTHORIZED

The worker corrected the environment finding: the AWS credentials existed in `.env` but were not exported; the production loader now reportedly returns real MES 5m rows. Treat that as **candidate evidence until an executable real-data witness is committed**. Never print, log, commit, or include credential values in a report.

### 5.1 `verify_spacing()` ruling

The current predicate `every gap == timeframe` is invalid for futures because legitimate CME maintenance/session gaps exist.

**AUTHORIZED predicate:**

- timestamps remain timezone-aware;
- timestamps remain strictly ascending;
- duplicates remain forbidden;
- every adjacent gap must be a **positive integer multiple** of the declared timeframe;
- **AND at least one adjacent gap must equal exactly the declared timeframe**.

Why the exact-gap witness is required: a pure 10m series mislabeled `5m` has gaps that are multiples of 5; it must not pass merely because `10 % 5 == 0`.

Required controls:

- `5m,5m,...,65m,...,5m` passes;
- real direct MES 5m production-loader frame passes;
- 1m series labeled 5m refuses;
- pure 10m series labeled 5m refuses;
- 7m/other non-multiple gap refuses;
- duplicate and out-of-order remain red.

This spacing predicate proves cadence/grid compatibility, **not bar-content provenance**. The bar-content provenance comes from `_supply_opening_range_source_frame()` calling the production loader with the role's own `"5m"` timeframe and from the existing no-resampling guard.

### 5.2 Real witness

After the predicate repair:

`load_ohlcv("MES", "5m", ...)`
→ real non-empty direct 5m series
→ `RoleFrame(timeframe="5m")`
→ `verify_spacing()` passes
→ attached to the same strategy executing on real 1m data
→ opening-range behavior depends on the 5m source frame.

No resampling. No fixture may satisfy the real-data acceptance step.

## 6. LANE C DECISION — C-a APPROVED

**Approve C-a. Do not spend the sealed-exam SEAL-GO token for sVkm.**

The repo contains a real production extraction/certification surface outside the sealed exam apparatus. For §9.2 we need genuine source evidence from the pinned transcript bytes; we do **not** need to pretend sVkm participated in the historical blind Tier-A exam.

Use the active production extraction lane on the pinned sVkm transcript bytes:

`sVkm transcript bytes`
→ current production extraction orchestrator (prefer the existing two-phase Phase-A → Phase-B path where applicable; do not regress to a weaker single-phase path merely for convenience)
→ extraction vault / extraction hash
→ `pilot_conveyor` grounding + tiering + real certification
→ durable **EXTRACTION_CERTIFIED** record
→ `compile_certified_record`
→ `.spec.json`.

Hard rules:

- transcript identity remains pinned to the already-measured sVkm bytes/hash; a fresh fetch that differs must REFUSE;
- no hand-authored strategy JSON;
- no synthetic Tier-3 verdicts;
- no `dry_run=True` certificate may satisfy R1;
- if the real certificate cannot pass its actual grading contract, STOP and report rather than relabeling it certified;
- store it in a new golden/extraction-certified population, **not** the frozen historical Tier-A directory;
- stamp the provenance class explicitly as **EXTRACTION_CERTIFIED / NOT EXAM_CERTIFIED**;
- do not fabricate `reader_identity`, `dispatch_record`, `coaching_notes`, or sealed-exam metadata that this lane did not produce;
- retain transcript sha, extraction sha, extractor-version pin, and certificate result as durable provenance.

The old SEAL-GO token remains untouched. C-b is rejected as unnecessary for this vertical proof.

## 7. R1 OUTPUT ACCEPTANCE

The newly certified sVkm record must answer the source facts. The expected table remains a validator, not an author:

- `OPENING_RANGE_WINDOW` expected 5m;
- `BREAKOUT_CONFIRMATION` expected 1m;
- `FVG_DETECTION` expected 1m only if source continuity supports it;
- `ENTRY_COMPLETION` expected 1m only if source continuity supports it;
- teacher structural stop must come from certified source evidence;
- fixed-R target must come from certified source evidence.

If the real certification disagrees with any expectation, **the certification wins and the worker stops for ruling.** Do not hardcode our expected answer into the extractor/compiler.

## 8. ORDER OF EXECUTION — FASTEST ROBUST PATH

Run in parallel where independent:

**Lane 1 — stop/persistence**
1. repair stale B3 auditor;
2. finish B-DB-ROUNDTRIP-1;
3. prove Python reload consumes the persisted roles + source risk.

**Lane 2 — real data**
1. repair `verify_spacing()` using §5.1;
2. run D-REAL-1 with direct MES 5m + 1m data.

**Lane 3 — source evidence**
1. execute C-a on pinned sVkm bytes;
2. produce EXTRACTION_CERTIFIED record;
3. compile with Spine-A;
4. inspect the actual role/stop/target evidence before allowing §9.2 closure.

Then join the three lanes into ONE vertical witness.

## 9. §9.2 CLOSURE BAR — UNCHANGED

Do not close §9.2 until one real persisted sVkm strategy proves:

SOURCE BYTES
→ REAL EXTRACTION/CERTIFICATION
→ PYTHON COMPILER
→ HASHED SPEC
→ TYPESCRIPT TRANSPORT
→ DATABASE SAVE/RELOAD
→ BAND C
→ SAME ROLE OBJECT ON EXECUTING INSTANCE
→ DIRECT REAL 5m OPENING-RANGE FRAME
→ REAL 1m EXECUTION FRAME
→ CAUSAL LOCK
→ TEACHER STRUCTURAL STOP
→ TEACHER FIXED-R TARGET.

Only then move to §9.3 candidate/source pairing, then §9.4 full deterministic trade proof.

**Independent grade remains locked until §9.4. Performance/edge testing remains blocked.**

## 10. STATUS

- B-FAILCLOSED-1: ✅ accepted
- B-RISK-1 transport: ✅ accepted; do not revert
- B3 auditor: 🔴 stale defect; repair authorized now
- B-DB-ROUNDTRIP-1: 🟡 resume after B3 repair
- Lane C enumeration: ✅ accepted
- C-a extraction-certified path: ✅ approved
- C-b sealed exam path: ❌ not required
- SEAL-GO token: 🔒 do not spend
- `verify_spacing()` exact-gap-only rule: ❌ obsolete for futures
- new multiple+exact-witness spacing rule: ✅ authorized
- D-REAL-1: 🟡 execute after spacing repair
- R1 sVkm certification: 🟡 execute now through C-a
- §9.2: 🔴 OPEN
- §9.3: 🔒
- §9.4: 🔒
- performance: 🔒 BLOCKED
