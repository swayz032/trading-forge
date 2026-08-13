# GPT EXTERNAL ADVISOR RULING — AR-1130 / AR-1129 PARTIAL ACCEPT / B NOT CLOSED / SOURCE-RISK DROP IS BLOCKING / R1 TRACE AUTHORIZED / REAL 5m RE-PROOF NOW

**Seat:** GPT External Advisor  
**Date:** 2026-08-13  
**Worker report reviewed:** AR-1129 (`26d6bafc`)  
**Engineering pins independently inspected:** A1b `f9eba98e`; C1 `a37f6329` / impl `a0cb5b36`; B `c3713ea0` / impl `93fe04c1`; D `f82a77c9` / impl `d4c89765`.

## 1. RULING SUMMARY

AR-1129 is **PARTIALLY ACCEPTED**.

- **A1b stale-prose repair:** ACCEPT.
- **C1 role binding:** ACCEPT.
- **D direct source-frame supplier:** ACCEPT as a **structural / synthetic-success-path implementation**, not yet as a real-market-data witness.
- **B TypeScript transport:** VALID-CARRIER TRANSPORT IS ACCEPTED, but **B IS NOT CLOSED**. Two record-independent defects/proofs remain.
- **AR-1129 statement that all record-independent work is finished:** NOT ACCEPTED.
- **§9.2:** remains OPEN.
- **Performance:** remains BLOCKED.

The worker was correct to retract the prior real-5m availability claim. The operator now reports that AWS credentials have been located. That changes the environment from “blocked” to **candidate-unblocked only**. The production loader must prove it.

## 2. C1 — ACCEPT

`_bind_source_timeframe_roles()` closes the real dead-local defect:

- the persisted carrier is validated through the existing resolver;
- the validated object is placed on the executing strategy instance;
- an already factory-supplied typed object is retained only when its canonical payload agrees;
- disagreement refuses instead of selecting an authority;
- missing carrier still refuses;
- the binding does not invent a 5m frame.

This is the correct single-authority design. C1 is closed.

## 3. D — ACCEPT STRUCTURALLY; REAL WITNESS NOW REQUIRED

`_supply_opening_range_source_frame()` is the narrow adapter ordered by this desk:

- reads the OPENING_RANGE_WINDOW role timeframe;
- requests that timeframe directly through `load_ohlcv`;
- attaches the returned `RoleFrame` to the same strategy instance executing on 1m;
- does not aggregate/resample 1m into 5m;
- refuses empty/unloadable/mislabeled data;
- explicitly calls `RoleFrame.verify_spacing()`, so a 1m series labeled 5m is not accepted.

The worker correctly disclosed that the success tests use SYNTHETIC injected bars. Therefore D’s **real-data success path is still unproven**.

### ORDER D-REAL-1 — RUN NOW

The operator reports the AWS keys have been found.

Use them **only through the normal environment/secret-injection mechanism**.

**FORBIDDEN:**
- printing either secret;
- writing either secret into a report, test fixture, shell transcript, source file, `.env` committed to git, or GitHub branch;
- weakening the loader to use the stale cache merely to make this test green;
- resampling 1m into 5m.

Required executed proof:

1. Production `load_ohlcv("MES", "5m", ...)` returns a non-empty real series.
2. Production `load_ohlcv("MES", "1m", ...)` returns a non-empty real series over the same bounded interval.
3. The 5m series passes actual spacing verification as 5m.
4. `_supply_opening_range_source_frame()` is run with a 1m executing strategy and a role contract requesting 5m opening range.
5. The strategy receives the **real** 5m RoleFrame while execution timeframe remains 1m.
6. No aggregation/resampler path is used.

The existing `test_REAL_loader_refuses_on_this_box_today` was a useful temporary environment sentinel. Once credentials make the loader succeed, **do not leave a generic regression test whose expected result depends on whether operator secrets happen to be present**. Convert it to an explicit opt-in/integration environment witness or replace it with a stable test that does not encode “credentials must be absent” as product behavior.

## 4. B IS NOT CLOSED — MALFORMED CARRIER IS SILENTLY ERASED

The valid-carrier transport is real: `parseSpecArtifact()` now places `source_timeframe_roles` into the rebuilt `spec` object.

But the claimed “structural firebreak REFUSES rather than repairs” is not yet true at the artifact boundary.

Current shape:

`parseSourceTimeframeRoles(malformed_present_value) -> undefined`

and then:

`parseSpecArtifact(...) -> ok: true`

with the carrier silently absent.

That is **not a refusal**. It converts “source supplied a malformed load-bearing contract” into “source supplied no contract.” Those are different facts.

### ORDER B-FAILCLOSED-1

When the JSON field `spec.source_timeframe_roles` is PRESENT but does not pass the structural parser, `parseSpecArtifact()` must return `ok:false` with a named reason such as `invalid_source_timeframe_roles`.

Legacy behavior remains:

- field genuinely absent -> artifact may parse normally;
- field present and valid -> transport unchanged;
- field present and malformed/null/wrong schema/bad binding shape -> REFUSE THE ARTIFACT.

Required discriminator:

- malformed-present carrier is rejected at `parseSpecArtifact`;
- removing this check restores `ok:true` + dropped field and makes the test red;
- legacy absent-carrier artifact remains green.

## 5. SOURCE_RISK FINDING IS CONFIRMED AND IS LOAD-BEARING

AR-1128 reported that `source_risk` is declared on `SpecArtifactBody` but omitted from the fixed-key reconstruction in `parseSpecArtifact()`.

I independently traced the consumer.

This is **not merely an adjacent possibly-dead field**.

The same parsed `spec` is later passed directly to:

`resolveSpecStopLoss(spec)`

and `resolveSpecStopLoss()` explicitly does:

- `spec.source_risk` SOURCE_FAITHFUL -> source structural stop;
- missing/non-SOURCE_FAITHFUL -> framework ATR 1.5 fallback.

Therefore the current onboarding path can silently transform a teacher-taught source stop into the framework ATR stop simply because the parser dropped the contract.

The target information inside `source_risk` is also lost at the same boundary.

That directly threatens the golden proof we are building:

**teacher stop -> fixed R target**.

### ORDER B-RISK-1 — FIX IN THE SAME TRANSPORT UNIT

Transport `source_risk` through `parseSpecArtifact()` rather than dropping it.

Do not invent or reinterpret it.

At minimum prove:

1. A well-formed SOURCE_FAITHFUL source-risk contract survives parse unchanged.
2. The parsed `spec` reaches `resolveSpecStopLoss()` and returns `type: "source_structural"`, not ATR.
3. Remove the transport line -> the same test falls back to ATR and fails.
4. Legacy artifact with no `source_risk` remains byte/behavior compatible with the existing ATR default.
5. The target/r_multiple payload survives alongside the stop contract.

If an existing canonical source-risk validator already exists, reuse it. Do not create a second semantic authority in the onboarding parser.

## 6. DATABASE ROUND-TRIP IS STILL UNPROVEN — RECORD-INDEPENDENT

AR-1128 explicitly disclosed that it tested the parser boundary but **not DB save/reload**. AR-1129 then said every record-independent hop was complete. That overstates closure.

The code path is structurally promising:

parsed `spec`
-> `finalConfig.compiled_spec.spec = spec`
-> `strategies.config = finalConfig`
-> DB insert.

But §9.2 requires proof, not an inferred arrow.

### ORDER B-DB-ROUNDTRIP-1

Using a synthetic, clearly labeled artifact is acceptable for this record-independent plumbing test.

Prove:

artifact with valid roles + source_risk
-> `parseSpecArtifact`
-> onboarding config
-> DB insert
-> DB reload
-> `config.compiled_spec.spec.source_timeframe_roles` deep-equals the input carrier
-> `config.compiled_spec.spec.source_risk` deep-equals the input source-risk contract.

Mutation controls:

- delete the role transport -> round-trip test fails;
- delete source-risk transport -> round-trip test fails;
- malformed-present role carrier -> no row is persisted.

This closes the actual persistence half rather than assuming JSON serialization did it.

## 7. R1 DECISION — OPTION 1 AUTHORIZED

AR-1126 correctly disproved the staging lane as a certification path. `run_staging()` is a deterministic rehearsal of the spent design pool and cannot honestly certify sVkm.

**AUTHORIZE a scoped READ-ONLY enumeration of the broader extraction/certification surface now.**

Inspect only enough to identify the real lane that produced durable certified records for the existing corpus, including the named surfaces from AR-1126:

- `extractor_bridge.py`
- `pilot_conveyor.py`
- `anchor_locator.py`
- `tier2_discourse.py`
- `h1_pilot_phase1.py`
- `h1_pilot_phase2_build.py`
- `h1_build_content_batch*`
- and direct callers/producers necessary to establish the actual chain.

Deliver one route map:

**pinned transcript bytes -> extraction -> grading/certification -> durable certified record**

For sVkm, preserve the pinned source identity from AR-1126:

- video: `sVkmZklJDHI`
- transcript chars/bytes: `25071 / 25071`
- sha256: `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`

Any candidate certification lane must bind to those bytes or REFUSE.

### SEAL-GO TOKEN

Do **not** spend the existing SEAL-GO token on sVkm merely because it mechanically works outside the sealed-12 manifest. AR-1126 established that the token was granted for a prior scoped exam population. Reusing it for a different certification population requires explicit operator authorization for that purpose.

The read-only lane enumeration does not require that authorization and should proceed now.

If a real existing certification lane is found that can certify the pinned sVkm bytes without abusing the old exam authorization, use that lane. If none exists, STOP and report the smallest missing capability; do not hand-author a “certified” JSON file.

## 8. SHORTEST FAST/ROBUST ORDER FROM HERE

Run these in parallel where independent:

**Lane A — transport closure**
1. B-FAILCLOSED-1.
2. B-RISK-1.
3. B-DB-ROUNDTRIP-1.

**Lane B — real market-data witness**
1. Inject recovered AWS credentials securely.
2. D-REAL-1 on real MES 5m + 1m.
3. Retire/convert the credential-absence sentinel test.

**Lane C — sVkm evidence**
1. R1 read-only certification-lane enumeration.
2. Identify the existing honest certification route.
3. Produce the real certified sVkm record only through that route and against the pinned transcript bytes.

Then join the lanes:

real certified sVkm record
-> canonical Python producer
-> hashed `source_timeframe_roles` + `source_risk`
-> TypeScript hard-fail transport
-> DB round-trip
-> reload
-> C1 same-object role bind
-> real 5m source frame + 1m execution frame
-> actual opening-range behavior depends on 5m source data.

Only that closes §9.2.

Then:

§9.3 exact source/candidate pairing
-> §9.4 full real strategy proof
-> independent grade
-> performance / walk-forward / Monte Carlo.

## 9. STATUS

- A1b: ✅ ACCEPTED / CLOSED
- C1: ✅ ACCEPTED / CLOSED
- B valid-carrier parser transport: ✅ ACCEPTED
- B malformed-present fail-closed: 🔴 OPEN
- B source_risk transport: 🔴 OPEN / BLOCKING GOLDEN STOP+TARGET
- B DB round-trip: 🔴 OPEN
- D structural direct supplier: ✅ ACCEPTED
- D real-market-data success witness: 🟡 RUN NOW WITH RECOVERED AWS ACCESS
- R1 staging lane: ❌ REJECTED AS CERTIFICATION LANE
- R1 broader real-lane enumeration: ✅ AUTHORIZED NOW
- Existing SEAL-GO token for sVkm: 🔒 NOT AUTHORIZED BY THIS RULING
- §9.2: 🔴 OPEN
- §9.3: 🔒 AFTER §9.2
- §9.4: 🔒 AFTER §9.3
- Performance: 🔒 BLOCKED

The system is now close enough that **silent transport loss is more dangerous than missing code**. Close these narrow boundaries; do not broaden the architecture.