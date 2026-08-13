# GPT EXTERNAL ADVISOR RULING — AR-1119 / ROUTE PROOF ACCEPTED / §9.1 REMAINS CLOSED AT THE CONSUMER BOUNDARY / B2-LIVE SELECTED / §9.2 EXPANDED TO PRODUCER→ARTIFACT→PERSISTENCE→INSTANCE→5M FRAME / PERFORMANCE BLOCKED

**Desk:** GPT External Advisor  
**Date:** 2026-08-13  
**Governing worker report:** AR-1118  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head independently inspected:** `d8fa19580da49fbfd4490ccaa0f2c5a326619939`  
**GPT/report branch head re-fetched immediately before this ruling:** `8a8d4c6547c15d03607b54289e21f41a4e3a62c6`  
**Prior GPT authority:** AR-1117

## 1. RULING

AR-1118 is **ACCEPTED** as a read-only route proof.

The stop condition in AR-1117 fired for the correct reason: `produce_spec_artifact_from_record()` is not on a measured live entry-point chain. SYSTEM-INVENTORY classifies the defining module as unreachable and the function itself has no non-test caller. Meanwhile the actual onboarding path reads already-produced `*.spec.json` files in TypeScript, `onboardSpecArtifact()` rebuilds the accepted artifact shape, assembles `compiled_spec`, and inserts the `strategies` row.

The worker also found a second, load-bearing break: even a perfectly persisted `source_timeframe_roles` carrier cannot currently control production execution because the typed constructor inputs introduced in §9.1 have zero non-test suppliers. `from_compiled_spec()` threads `opening_range_candidate` but does not accept or pass `source_timeframe_roles` or `opening_range_source_frame`. `run_class_backtest()` separately parses the persisted role payload into `_cls_source_timeframe_roles`, but that local is never handed to the strategy instance. Therefore the validated persisted carrier and the executing instance are disconnected.

**§9.1 remains CLOSED at the boundary it actually proved:** the role-aware opening-range consumer is correct and fail-closed when supplied the contract. I am not reopening that code. The newly discovered defect is an ingress/reachability defect and belongs to §9.2.

**Architecture decision: choose B2, with a mandatory “B2-LIVE” amendment.**

- Python remains the semantic authority that produces source-owned role facts.
- The role carrier travels in the certified portable SpecArtifact JSON.
- TypeScript validates and transports it; TypeScript does **not** infer or manufacture the four source roles.
- The existing `recoverSpecTimeframe()` 0.4 “lowest execution-grade TF” heuristic remains a legacy scalar recovery mechanism only. It can never satisfy a SOURCE_FAITHFUL role contract.
- Because the current Python producer is unreachable, B2 is not complete until one thin deterministic compile entry point makes that canonical producer actually reachable.
- The two downstream broken arrows found in AR-1118 are **part of §9.2**, not a separate pre-unit. Persistence that cannot reach the executing instance is not persistence of executable semantics.

**B1 is REJECTED.** TypeScript does not own the transcript-derived evidence grades or the continuity judgment, so teaching TypeScript to manufacture the carrier would create a second semantic compiler.

**B3 is REJECTED for this slice.** Routing every live TypeScript onboarding call through a Python subprocess adds a runtime cross-language dependency and orchestration surface that is unnecessary when the existing system already consumes portable `.spec.json` artifacts. The faster robust path is to make the canonical Python compiler a real artifact-producing entry point and keep the existing JSON handoff.

Performance remains **BLOCKED**.

---

## 2. WHAT I INDEPENDENTLY VERIFIED

### 2.1 The current onboarding boundary consumes files, not the Python producer

`scripts/onboard-compiled-specs.ts` reads `*.spec.json` files from a directory and passes the parsed JSON directly to `onboardSpecArtifact()`.

`spec-onboarding-service.ts` imports and calls the TypeScript binding-plan/timeframe logic inline. It assembles `compiled_spec` into `finalConfig`, then inserts `strategies` with that config.

That means the current live onboarding route starts with a portable artifact that is assumed to have already been compiled somewhere else.

### 2.2 The canonical Python producer really is currently unreachable

SYSTEM-INVENTORY reports every symbol in `src/engine/extraction/spec_producer.py` as unreachable from the measured entry-point graph, and specifically reports `produce_spec_artifact_from_record` as having no non-test caller.

That is not a cosmetic inventory label. If we added the new carrier only there today, we could again build and test correct code that no production artifact path invokes.

### 2.3 The existing TypeScript scalar recovery is exactly the heuristic we must not promote

`recoverSpecTimeframe()` contains the fallback:

```text
exec = lowest execution-grade TF across roles
```

and can assign `confidence = 0.4`.

That is useful legacy recovery metadata, but it is not source authority for the four semantic roles. A correct scalar `1m` produced by this path remains a heuristic answer and cannot be wrapped in `SOURCE_TIMEFRAME_ROLES/1` and called faithful.

### 2.4 The TypeScript artifact parser will silently drop a new role field unless explicitly changed

`parseSpecArtifact()` reconstructs a new `SpecArtifact` / `SpecArtifactBody` object from a fixed set of recognized keys. Unknown fields do not automatically survive.

Therefore B2 requires an explicit TypeScript contract/parser change. Merely adding `source_timeframe_roles` to Python output is insufficient; the current parser would discard it before persistence.

### 2.5 The carrier belongs inside the certified spec body

The Python producer computes `spec_hash` as SHA-256 over the canonical `spec_body`.

The timeframe-role carrier is source-owned strategy semantics, not execution-instance identity. Therefore it belongs **inside `spec`** and must be covered by `spec_hash`.

This is deliberately different from `execution_candidate_id` / candidate receipt, which stay siblings of `compiled_spec` because they identify which execution instance of a certified strategy is being run rather than changing the strategy's source semantics.

A mutation to a role timeframe, evidence grade, quote, condition id, missing role, or role set must therefore either refuse compilation or move the certified spec hash. It must never leave a hash claiming unchanged semantics.

### 2.6 The first downstream arrow is genuinely missing

`SpecConditionStrategy.__init__()` accepts:

- `source_timeframe_roles`
- `opening_range_source_frame`

But `from_compiled_spec()` accepts and forwards only `opening_range_candidate`; it has no parameters for the two role inputs.

The Band C branch in `backtester.py` therefore cannot currently construct a role-driven production strategy instance.

### 2.7 The second downstream arrow is genuinely missing

`run_class_backtest()` validates the persisted carrier for SOURCE_FAITHFUL by assigning `_cls_source_timeframe_roles = _resolve_source_timeframe_roles(strategy)`, but the local is not used to select/build/pass the 5m source frame or to populate `strategy.source_timeframe_roles`.

The correct consumer exists. Its activating inputs do not.

---

## 3. AUTHORIZED §9.2 UNIT — `SVKM-REAL-PERSIST-AND-INGRESS-1`

Do this as one vertical unit. Do not split “saved correctly” from “actually reaches execution” into separate victories.

### 3.1 Make the canonical Python producer reachable without duplicating it

Add one thin deterministic compile entry point around the existing `produce_spec_artifact_from_record()` / canonical producer path.

Preferred shape:

```text
certified record on disk
→ thin Python CLI/entry point
→ existing canonical producer function
→ portable *.spec.json
```

The wrapper may do I/O and argument parsing. It may **not** duplicate semantic classification, opening-range lowering, timeframe-role extraction, hashing, or source evidence logic.

Required proof:

- SYSTEM-INVENTORY changes the canonical producer path from unreachable to reachable through the new entry point.
- A positive control proves the entry point actually calls the canonical producer rather than a copy.
- An ablation/removal of that call breaks the production artifact proof.

Do **not** make TypeScript spawn Python during onboarding for this unit.

### 3.2 Produce the real sVkm carrier in Python from certified evidence

For the real sVkm source, the certified artifact must contain:

```text
source_timeframe_roles.schema = SOURCE_TIMEFRAME_ROLES/1
OPENING_RANGE_WINDOW   = 5m / EXPLICIT
BREAKOUT_CONFIRMATION  = 1m / EXPLICIT
FVG_DETECTION          = 1m / SOURCE_RESOLVED_BY_CONTINUITY
ENTRY_COMPLETION       = 1m / SOURCE_RESOLVED_BY_CONTINUITY
```

Each binding must retain its source quote and condition id.

Forbidden production mechanisms:

- `strategy.timeframe`
- `trigger_tf`
- `recoverSpecTimeframe()` as role authority
- “lowest timeframe”
- confidence-0.4 backfill
- hardcoded sVkm values inserted after compilation
- test fixture injection

The narrow sVkm expected-role table in `svkm_role_execution.py` remains a **validator**, never a producer.

### 3.3 Put the carrier inside `spec` and under the certified hash

`source_timeframe_roles` must be a field of the certified `spec_body` emitted by Python before `_spec_hash(spec_body)` is computed.

Required mutations:

1. Change only `OPENING_RANGE_WINDOW 5m → 15m` and prove the spec hash changes or compilation refuses.
2. Change only an evidence grade and prove the spec hash changes or compilation refuses.
3. Remove one role and prove SOURCE_FAITHFUL cannot produce an accepted artifact.
4. Remove/alter a source quote and prove the typed carrier refuses.

Do not store the carrier as an unhashed metadata sibling.

### 3.4 Extend TypeScript as a transport/firebreak, not as a semantic compiler

Extend `SpecArtifactBody` and `parseSpecArtifact()` so `source_timeframe_roles` survives explicitly.

TypeScript may perform structural firebreak checks such as:

- envelope is an object;
- schema string is exactly `SOURCE_TIMEFRAME_ROLES/1`;
- bindings is an array;
- expected key names are present;
- values are strings / closed role names / closed evidence-grade names if mirrored exactly.

TypeScript may **not** choose a timeframe, upgrade an evidence grade, fill a missing role, or call `recoverSpecTimeframe()` to manufacture the carrier.

Required parser mutation:

```text
Python artifact contains carrier
→ parseSpecArtifact
→ persisted compiled_spec.spec contains byte/canonical-equivalent carrier
```

A parser version that omits the field must make the test RED.

### 3.5 Persist and reload the real carrier

Onboard the real sVkm artifact through the actual TypeScript path and prove the stored row reloads with all four role bindings unchanged under:

```text
config.compiled_spec.spec.source_timeframe_roles
```

Do not satisfy this with an object built directly in a Python test.

Required negative controls:

- source-faithful artifact with carrier removed → refuse/quarantine before performance;
- scalar `strategies.timeframe='1m'` still present → must not rescue it;
- legacy `metadata.timeframe_recovery.confidence=0.4` still present → must not rescue it.

### 3.6 Close the persisted-carrier → executing-instance arrow

Thread the persisted role contract through the Band C construction path.

The key invariant is:

```text
THE ROLE OBJECT VALIDATED FOR SOURCE_FAITHFUL
==
THE ROLE OBJECT USED BY SpecConditionStrategy TO SELECT THE SOURCE FRAME
```

Do not leave a “validated local” and a separate “constructor object” that can drift.

Preferred implementation:

- parse the persisted carrier exactly once into `SourceTimeframeRoles` at the Band C/factory ingress;
- pass that typed object through `from_compiled_spec()` into `SpecConditionStrategy`;
- make `_resolve_source_timeframe_roles()` validate/use that same typed object (and, if it also reads the raw payload for provenance equality, require canonical equality rather than constructing a second independent authority);
- remove the present dead-local shape where `_cls_source_timeframe_roles` is assigned and then ignored.

Required mutation:

- remove the factory pass-through while leaving persistence intact → SOURCE_FAITHFUL proof must fail.

### 3.7 Build the real 5m source frame on the production path

The second activating input, `opening_range_source_frame`, must be supplied by a non-test production caller.

For this sVkm slice only:

- execution series = real `1m` source data;
- opening-range source series = real direct `5m` source data from the existing data loader;
- no 1m→5m resampling;
- construct `RoleFrame(timeframe='5m', timestamps, highs, lows)` from the actual loaded 5m series;
- verify spacing through the existing `RoleFrame` guard;
- pass it into the same strategy instance that received the persisted role object.

If the direct 5m frame cannot be loaded, is empty, is mislabeled, is gapped at the required source window, or conflicts with the persisted role, SOURCE_FAITHFUL must refuse.

Do not broaden this into generic MTF orchestration.

Required mutation:

- leave the persisted role contract intact but remove the 5m frame supplier → the run must refuse rather than fall back to the 1m execution frame.

### 3.8 One real vertical acceptance witness

The acceptance witness for §9.2 is not “the DB row has a field.” It is:

```text
REAL certified sVkm record
→ reachable canonical Python producer
→ real portable SpecArtifact with role carrier under spec_hash
→ TypeScript parser/transport
→ real persisted strategy row
→ reload
→ Band C factory
→ SAME typed role contract on SpecConditionStrategy
→ direct 5m RoleFrame supplied
→ source_role_driven == true
→ opening range reads 5m source frame
```

At this stage you do not need to prove the full breakout/FVG/entry/stop/2R chain; that remains §9.4. But the role carrier must demonstrably alter the production chart source, not merely pass validation.

---

## 4. REQUIRED RED-PROOF POPULATION FOR THIS UNIT

Minimum discriminators:

1. **Producer reachability red:** break the thin entry point's call to the canonical producer.
2. **Role-hash red:** mutate a role fact and demonstrate hash/refusal movement.
3. **TS parser-drop red:** delete the transport line and prove the persisted carrier disappears / test fails.
4. **Persistence-loss red:** delete carrier before DB write and prove reload fails the contract.
5. **Scalar-fallback red:** keep `timeframe=1m` and confidence-0.4 metadata while deleting roles; SOURCE_FAITHFUL still refuses.
6. **Factory-hop red:** persist roles but remove `from_compiled_spec` pass-through; production acceptance witness fails.
7. **Frame-hop red:** keep roles but remove 5m source frame supplier; hard refusal.
8. **Behavior witness:** change only 5m source highs/lows; production ORH/ORL follows 5m while 1m execution frame stays byte-identical.
9. **Causality preservation:** existing production lock proof remains green.
10. **Legacy preservation:** legacy/no-role strategy remains on its existing path.

A test that constructs `SpecConditionStrategy(...source_timeframe_roles=..., opening_range_source_frame=...)` directly is useful unit coverage but **cannot satisfy** this vertical acceptance unit.

---

## 5. §9.3 AND §9.4 ORDER

After `SVKM-REAL-PERSIST-AND-INGRESS-1` is green and independently inspected:

### §9.3 — exact source/candidate pairing

Prove the execution candidate belongs to the exact persisted source/spec. The existing candidate receipt/sibling identity path is the natural seam; do not invent a second candidate identity system.

### §9.4 — real end-to-end source event

Then prove:

```text
certified source evidence
→ compiler
→ persisted real strategy
→ 5m opening range
→ causal lock
→ 1m close breakout
→ 1m directional FVG
→ 1m third-candle-close entry
→ source wick stop
→ fixed 2R
→ deterministic trade event
```

Only after §9.4 should the independent grade/performance gate be considered.

---

## 6. STATUS

```text
AR-1118 route proof                       ✅ ACCEPTED
§9.1 role-aware consumer                  ✅ CLOSED AT CONSUMER BOUNDARY
B1 TS manufactures carrier                ❌ REJECTED
B2 Python produces / TS transports        ✅ SELECTED, WITH B2-LIVE AMENDMENT
B3 TS invokes Python compiler at runtime   ❌ REJECTED FOR THIS SLICE
§9.2 real persistence + runtime ingress    🟡 AUTHORIZED AS ONE VERTICAL UNIT
§9.3 source/candidate pairing              🔒 NEXT
§9.4 real end-to-end trade proof           🔒 AFTER §9.2 + §9.3
Independent grade                         🔒 NOT YET
Performance / edge testing                🔒 BLOCKED
```

## 7. FASTEST ROBUST ENGINEERING ORDER

Do not create an intermediate “persistence complete” report if the executing instance is still unreachable.

The shortest robust sequence is:

```text
1. thin Python compile entry point
2. Python emits hashed source_timeframe_roles
3. TS parser transports it
4. DB round-trip proves it survives
5. Band C passes SAME typed roles to instance
6. production loads direct 5m frame and passes it
7. one vertical role-driven production witness
8. bounded regressions + red proofs
9. report
```

That is one engineering unit. No generic MTF framework. No TypeScript semantic re-compiler. No Python subprocess inside onboarding. No performance run yet.
