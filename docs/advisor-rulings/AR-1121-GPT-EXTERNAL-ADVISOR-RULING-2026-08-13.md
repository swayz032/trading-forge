# GPT EXTERNAL ADVISOR RULING — AR-1121 / AR-1120 ACCEPTED / R1 AUTHORIZED / sVkm CERTIFICATION FIRST / PARALLEL SPINE ALLOWED / PERFORMANCE BLOCKED

**Seat:** GPT external advisor
**Date:** 2026-08-13
**Governing report:** AR-1120 (`d2f7c76243704e397266c671482448aaaf1dd905`)
**Engineering head independently inspected:** `d8fa19580da49fbfd4490ccaa0f2c5a326619939`

## 1. RULING

AR-1120 is **ACCEPTED**.

The STOP was correct.

I independently verified the load-bearing repository facts:

- `sVkmZklJDHI` is a real corpus video.
- The committed Tier-A provenance population contains 13 frozen extraction records and does **not** contain `sVkmZklJDHI`.
- The control `st5e-YJRfKc` is present in the same population.
- The Tier-A compile census contains no `sVkmZklJDHI`.
- `st5e-YJRfKc__s0` is a different 5/15/30 opening-range lesson; it is not a valid substitute for the sVkm 5m-window / 1m-execution contract.
- `from_compiled_spec()` is defined in `src/engine/spec_condition_compiler.py` and currently does not transport `source_timeframe_roles` or `opening_range_source_frame`, while `SpecConditionStrategy.__init__` accepts both.
- The engineering branch did not move; AR-1120 made no code claim to inspect.

The worker's read-only DB probe is acceptable as pre-flight evidence. It does **not** become certification authority. A raw transcript is not the certified extraction object the compiler is allowed to trust.

## 2. DECISION ON R1 / R2 / R3

### R1 — AUTHORIZE CERTIFIED EXTRACTION OF `sVkmZklJDHI`

**AUTHORIZED. THIS IS THE MAIN PATH.**

Use the existing certified-reader / sealed extraction machinery. Do not manually author the record and do not create a one-off shortcut parser.

The source must be the real `sVkmZklJDHI` transcript already present in the archive.

The resulting durable record must preserve enough provenance to identify:

- source video id,
- transcript identity/fingerprint,
- certified reader identity,
- prompt/enumerator identity,
- evidence spans/quotes,
- the extracted strategy object actually consumed by `produce_spec_artifact_from_record()`.

### R2 — RE-POINT TO AN EXISTING TIER-A RECORD

**REJECTED.**

Do not substitute `st5e-YJRfKc` or any other old record merely to keep the compiler moving.

A different teacher with different timeframe semantics is not a golden witness for sVkm.

### R3 — SPLIT THE UNIT

**MODIFIED, NOT ACCEPTED AS SEPARATE COMPLETION.**

Parallel implementation is authorized for speed, but §9.2 remains **ONE acceptance boundary**.

The worker may land the record-independent spine while the sVkm certification lane runs, but may not report a partial compiler breakthrough or close §9.2 until the real certified sVkm artifact traverses the whole path.

## 3. DO NOT REWRITE HISTORY

The old Tier-A provenance directory and its R-588 manifest/census are historical frozen evidence.

Do **not** insert sVkm into that old population and make the historical counts look as if it had always been there.

Create a new durable sVkm golden-source certification artifact/manifest in a clearly named new location, or another existing location whose semantics explicitly permit newly certified golden records.

The old Tier-A census stays historically truthful.

## 4. PARALLEL SPINE — AUTHORIZED NOW

While R1 runs, the following record-independent work may proceed on the engineering branch.

### A. Thin reachable Python compile entry

Create ONE thin production entry point that invokes the existing canonical Python producer.

Required shape:

`certified record -> canonical Python producer -> .spec.json`

No duplicated compiler logic.

No TypeScript recreation of Python source semantics.

### B. TypeScript transport

Teach the live TypeScript artifact contract/parser to preserve `source_timeframe_roles` without interpreting its trading meaning.

TypeScript may validate schema/shape.

TypeScript may **not** manufacture role values from:

- `recoverSpecTimeframe()`,
- lowest-timeframe logic,
- `strategy.timeframe`,
- `trigger_tf`,
- confidence 0.4 recovery,
- hardcoded sVkm constants.

### C. Correct factory file scope

The worker's locator correction is accepted.

The relevant factory definition is:

`src/engine/spec_condition_compiler.py::from_compiled_spec`

That file is explicitly authorized for §9.2 wiring.

Thread the validated persisted roles into the exact `SpecConditionStrategy` instance that executes.

### D. Real direct 5m frame supplier

Wire a real production supplier for `opening_range_source_frame` using the existing data loader and direct stored 5m series.

No generic MTF framework.

No 1m->5m resampling in this unit.

For this golden path:

- 1m = execution frame
- 5m = opening-range source frame

## 5. CERTIFIED sVkm ROLE FACTS

The producer may emit the four-role carrier **only if the new certified sVkm evidence actually supports it**.

The intended contract remains:

- `OPENING_RANGE_WINDOW = 5m / EXPLICIT`
- `BREAKOUT_CONFIRMATION = 1m / EXPLICIT`
- `FVG_DETECTION = 1m / SOURCE_RESOLVED_BY_CONTINUITY`
- `ENTRY_COMPLETION = 1m / SOURCE_RESOLVED_BY_CONTINUITY`

But these values are **acceptance expectations, not permission to hardcode them**.

If the new certified extraction cannot support any one of those four bindings with the required evidence grade and source evidence, **STOP AND REPORT THE CONTRADICTION**.

Do not use AR-1109/AR-1110 prose as a substitute for the certified source record.

## 6. HASH OWNERSHIP

`source_timeframe_roles` is strategy semantics.

It belongs inside the certified `spec` body **before** `spec_hash` is computed.

Therefore changing any load-bearing role value/evidence must change the hash or refuse compilation.

Candidate identity remains separate from this rule; do not move per-candidate identity inside the certified spec merely because timeframe roles belong there.

## 7. REQUIRED RED PROOFS FOR §9.2

Before §9.2 may close, prove all of these:

1. Remove/bypass the new Python compile entry -> the real sVkm golden path fails.
2. Drop `source_timeframe_roles` in TypeScript parsing -> the vertical witness fails/refuses.
3. Remove the carrier before persistence/reload -> SOURCE_FAITHFUL refuses.
4. Leave legacy scalar `timeframe='1m'` and confidence-0.4 evidence in place while deleting the role carrier -> it still refuses; the scalar cannot rescue it.
5. Remove the `from_compiled_spec` role pass-through -> the production-path test goes red.
6. Remove the direct 5m frame supplier -> SOURCE_FAITHFUL refuses rather than falling back to 1m.
7. Change only the real 5m source highs/lows while holding 1m execution bars constant -> ORH/ORL must move.
8. Existing causal lock proof remains green: pre-lock 1m bars cannot see the final 5m range.
9. Legacy/no-role paths remain unchanged.
10. Hash mutation: change a role value or evidence grade -> `spec_hash` changes or compile refuses.

## 8. §9.2 ACCEPTANCE WITNESS

§9.2 closes only when ONE real source traverses:

`real sVkm transcript`
`-> existing certified extraction machinery`
`-> new durable certified sVkm record`
`-> reachable canonical Python producer`
`-> hashed source_timeframe_roles`
`-> .spec.json`
`-> TypeScript parser/transport`
`-> real strategy persistence`
`-> reload`
`-> Band C`
`-> from_compiled_spec`
`-> SpecConditionStrategy receives the roles`
`-> real direct 5m source frame supplied`
`-> source_role_driven == true`
`-> opening range actually reads the 5m frame`

No synthetic fixture may stand in for that final witness.

## 9. WHAT COMES AFTER

After §9.2 passes:

- §9.3: prove the execution candidate belongs to the exact persisted source/spec.
- §9.4: full source-to-trade deterministic witness.
- independent grade after §9.4.
- performance/edge testing only after the compiler/money-path proof is certified.

## 10. STATUS

- AR-1120 pre-flight: ✅ ACCEPTED
- Missing certified sVkm record: ✅ VERIFIED BLOCKER
- R1 certify real sVkm: ✅ AUTHORIZED
- R2 use wrong existing teacher: ❌ REJECTED
- Parallel record-independent spine: ✅ AUTHORIZED
- Separate partial §9.2 victory: ❌ NOT AUTHORIZED
- Historical Tier-A rewrite: ❌ FORBIDDEN
- §9.2 full real persistence + ingress: 🟡 ACTIVE
- §9.3 exact candidate pairing: 🔒 NEXT
- §9.4 full real trade proof: 🔒 AFTER §9.2 + §9.3
- Independent grade: 🔒 NOT YET
- Performance testing: 🔒 BLOCKED

**Fastest robust path:** certify the real sVkm source while landing the generic transport/wiring spine in parallel, then join them into one real vertical proof. Do not wait to build the generic plumbing, and do not fake the missing source semantics to save time.
