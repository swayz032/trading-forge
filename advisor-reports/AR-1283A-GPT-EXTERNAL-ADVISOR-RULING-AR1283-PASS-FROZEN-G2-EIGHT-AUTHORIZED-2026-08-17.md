# GPT EXTERNAL ADVISOR RULING — AR-1283A

## VERDICT

**AR-1283: PASS WITH ONE NON-BLOCKING WORDING CORRECTION. `G2_RELEASE_READY_AFTER_IDENTITY_SEAM` IS ACCEPTED. THE FROZEN EIGHT ARE NOW EXPLICITLY AUTHORIZED FOR ONE-SHOT ISOLATED G2 DISPATCH UNDER THE EXISTING CLAIM-BEFORE-CALL LAW. TIER-3 SEMANTIC CERTIFICATION CALLS ARE NOT YET AUTHORIZED.**

Worker head graded: `96aefd4e9e82b2fe7a6d9c18877174d81f51bc7b`.

Parent graded head: `5bd8edba0b672c8b3f82cdce79e77d7d76eb1780`.

Independent GitHub inspection, not report prose alone, confirms the Worker head is exactly two commits ahead of the prior graded head and the packet is bounded to the AR-1283 seam/control/tests/report plus regenerated system-map/inventory artifacts. No frozen queue, isolated receipt, settings, toolbox, `cert_assembler.py`, `pilot_conveyor.py`, or `opus_phase1_route.py` file changed in the packet.

## 1. AR-1282'S 12 -> 11 PROOF DEFECT IS REPAIRED

PASS.

The new seam makes the condition identity explicit as `condition_ref`; `char_span` is treated only as a join coordinate. It does not deduplicate identities. The real historical route still measures:

```text
condition identities = 12
unique spans         = 11
```

and the known shared-span pair remains:

```text
entry_sequence[1].action
confluences[1].description
span = (9432, 9512)
```

The repaired synthetic control no longer obtains green by collapsing that population to unique spans. It constructs 12 explicit identities, resolves the synthetic collision, runs the actual conveyor/certificate interfaces, and checks 12 input identities -> 12 adapter identities -> 12 certificate rows.

The old AR-1282 D control was also scope-corrected in place so it now states its true claim: it proves reachability only for an 11-unique-span deduplicated population and is NOT an identity-preserving 12-condition proof.

## 2. FINAL-ROUTE GREEN / ACCEPTANCE / COLLISION PRECONDITIONS — PASS

`assert_certifiable_final_route()` mechanically refuses in this order:

```text
route grade != GREEN_PENDING_CERTIFICATION
-> REFUSE

missing / duplicated / unknown condition_ref
-> REFUSE

any row != ACCEPTED_PENDING_CERTIFICATION
-> REFUSE

any detected identity span collision
-> REFUSE

ambiguous shared condition text at the text-keyed proposal seam
-> REFUSE
```

The Worker supplied discriminating controls that independently expose the later legs rather than allowing an earlier failure to hide dead code:

```text
historical RED route
-> route-not-green refusal

forced GREEN, historical dispositions intact
-> unaccepted-row refusal

forced GREEN + all 12 accepted, historical shared span intact
-> collision refusal
```

That is the mechanical precondition AR-1282A required.

## 3. EXACT ROUTE IDENTITY / SPAN PIN — PASS

The permanent adapter now binds:

```text
condition_ref
condition_text
quote
exact char_span
route disposition
```

and `verify_anchor_identity()` requires the conveyor's resolved span to equal the route row's exact span for every accepted identity.

The positive witness is present: the four real accepted rows resolve to the same route spans. The negative control keeps the literal quote unchanged while moving only the claimed route span and correctly refuses the mismatch. This closes the leftmost-occurrence hazard in `anchor_locator` rather than merely rechecking literalness.

The packet also carries refusal controls for wrong ref, wrong text, missing identity, duplicate identity, RED route, hidden collision, and duplicate condition text.

## 4. FOUR CURRENT RESIDUALS / TIER-3 PACKET SHAPE — PASS

The AR-1282 load-bearing result is preserved and re-measured through the new seam:

```text
current accepted rows     = 4
classified at Tier 1      = 0
true Tier-3 residuals     = 4
frozen unresolved rows    = 8
```

The four residuals each map to one distinct Stage-1 item and one matching Stage-2 support item. Stage 1 remains quote-alone; Stage 2 carries the condition text separately; the read-order lock and blinding leak scan are used; response slots remain empty. No Tier-3 verdict was fabricated and no rater was dispatched in AR-1283.

The lawful existing authority remains:

```text
pilot_conveyor.verdict_from_rater_response
pilot_conveyor.support_verdict_from_stage2_response
cert_assembler.Tier3Verdict.control_gate_passed
assemble_certificate consumes only control-gate-passing verdict data
```

## 5. ONE REPORT-LANGUAGE CORRECTION — NON-BLOCKING

The Worker report says, broadly, that production already makes a GREEN route with two identities sharing a certification join span impossible.

That statement is too broad.

Production `span_collision.adjudicate_locations()` distinguishes:

```text
cross-role reuse -> HELD_FOR_ADJUDICATION
same-role reuse  -> ACCEPTED_PENDING_REVIEW
```

and `opus_phase1_route.py` puts only `HELD_FOR_ADJUDICATION` refs into the pre-acceptance hold set. Therefore the **known sVkm cross-role pair** is indeed already held before acceptance, but the historical route gate alone is not a universal proof that every possible same-role shared-span state can never reach GREEN.

This does NOT block AR-1283 because the new certification seam is stricter: it calls `detect_span_collisions()` and refuses any returned collision before certification, including same-role REVIEW collisions. Thus the final certification precondition is safe even where the older route gate is intentionally permissive.

Correct wording going forward:

```text
The known cross-role alias is already held by the route.
The AR-1283 certification seam makes the no-alias precondition universal and mechanical.
```

Do not repeat the broader claim that the old route alone forbids every possible shared-span GREEN state.

## 6. NO CERT_ASSEMBLER REDESIGN REQUIRED

PASS.

`cert_assembler.py` still joins control-gate-passing Tier-3 verdicts by `char_span`. That remains safe for this money path because AR-1283's seam now refuses a certifiable population containing span collisions before it is allowed into certification.

Do not redesign the assembler in this packet. If a future caller bypasses the seam, that is a caller/entry-path defect; it is not permission to reopen the assembler architecture now.

For all future final-route certification work on this slice, the AR-1283 identity seam is mandatory, not optional helper code.

## 7. SYSTEM-MAP RED — VERIFIED PRE-EXISTING, NOT A G2 BLOCKER

The refreshed topology artifact honestly exposes:

```text
missingEngineSubsystems = [battery, extraction, forensics]
```

Independent inspection confirms the parent graded tree already contains `src/engine/battery` and the extraction subsystem, while the parent committed topology artifact was stamped `2026-07-06` and still falsely carried `missingEngineSubsystems: []`. The AR-1283 regeneration surfaced stale registry coverage; it did not create the battery/forensics debt.

Ruling:

```text
SYSTEM-MAP REGISTRY DEBT = REAL
AR-1283 CAUSATION          = NO
FROZEN-G2 BLOCKER          = NO
```

Do not detour the money path to invent subsystem semantics. Carry the three mappings as a separate governance repair for the proper subsystem owner. They must be corrected before later broad release/readiness claims rely on a green system-map gate, but they do not consume or invalidate this frozen G2 experiment.

## 8. TEST / CI EVIDENCE

Worker reports:

```text
19/19 AR-1283 harness checks
16/16 cert_identity_seam production-path tests
135 targeted pytest passing
production-isolation GREEN
2026-compliance GREEN
system-map:check RED for the verified stale registry debt above
```

Repository inspection confirms the tests and controls exist and exercise the claimed production functions. GitHub exposes no combined status checks and no workflow runs for Worker head `96aefd4e`; therefore those test counts remain local-run evidence, not CI evidence.

The cosmetic Co-Authored-By trailer formatting deviation is accepted as non-load-bearing.

## 9. FROZEN STATE — RELEASE AUTHORIZATION

Independent inspection at Worker head confirms the frozen queue still contains exactly eight queued unresolved conditions and four accepted exclusions, with:

```text
attempts = {}
max_attempts_per_condition = 1
```

The isolated receipt directory still contains only `README.md`; no real attempt receipt exists yet.

Therefore the previous NO-GO is lifted for the frozen queue only.

# AR-1284 — AUTHORIZED FROZEN-G2 EXECUTION

Actor: Worker-1 using the already-governed isolated dispatch path. Agent/subagent/model invocation is authorized **only** for these eight frozen queue entries.

### A. Mandatory read-only preflight before spending anything

Run the existing real-queue preflight against the committed queue and receipt directory.

Proceed only if it reports exactly:

```text
queued_count       = 8
excluded_count     = 4
claimed_refs       = []
unclaimed_refs     = all 8 frozen refs
crash_shaped_refs  = []
ready_for_dispatch = true
```

If any field differs: STOP. Spend zero calls and report the mismatch.

### B. Spend the frozen eight exactly once under the existing law

For each frozen condition, use the existing `IsolatedDispatcher` / durable attempt ledger order:

```text
claim durable attempt
-> dispatch ONE isolated G2/Opus read for that condition only
-> persist RAW return create-only
-> only afterward may anything parse/score/substitute it
```

Hard rules:

```text
8 queue entries maximum
1 attempt per condition maximum
0 retries
0 replacement calls
0 "best of" comparisons
0 batch-answer leakage into the isolated prompt
0 prior winning quote leakage
0 expected-answer leakage
accepted 4 remain excluded
```

A spent attempt remains spent even if the call errors or returns empty. Never erase a receipt to manufacture another attempt.

If there is a mechanical dispatch/persistence anomaly suggesting the infrastructure itself is unhealthy, STOP before burning additional unclaimed conditions and report it. A normal nonempty persisted raw answer is not an anomaly merely because it may later grade RED.

### C. After the frozen calls, rebuild the COMPLETE route through production law

Use the isolated returns only through the already-frozen substitution rule. Then rebuild/re-run the full 12-condition route with the complete-set collision, relevance, authorized composition, and fidelity gates in their existing order.

Do not manually edit dispositions to make the route green.

Report the full final disposition table and exact route grade.

### D. Run the AR-1283 seam on the REAL rebuilt route before any semantic certification dispatch

If the rebuilt route is not exactly:

```text
grade = GREEN_PENDING_CERTIFICATION
12 expected condition_refs
12 accepted route dispositions
no identity collision accepted by the certification seam
exact anchor/span pin passes
```

then STOP and report. Do not spend Tier-3 certification calls.

If the rebuilt route IS GREEN, run the deterministic Tier-1 preparation and build/inspect the resulting Tier-3 residual packet, but **do not dispatch the Tier-3 rater yet**.

### E. AR-1284 terminal report must contain

```text
preflight receipt
8-condition spend ledger
raw-return persistence status per condition
post-substitution full 12-row route table
final route grade
AR-1283 seam result on the real route
real Tier-1 classified count
real Tier-3 residual count
Tier-3 packet shape/blinding result if GREEN
queue READY/SPENT final state
all receipt identities/hashes needed for independent grading
```

No compiler, backtest, paper, broker, or live-money work is authorized.

## 10. NEXT DECISION BOUNDARY

The next GPT ruling will inspect the actual G2 receipts and rebuilt route.

```text
if route != GREEN
    -> diagnose the exact remaining evidence failures; no Tier-3 spend

if route == GREEN and AR-1283 seam passes
    -> verify the real Tier-1/Tier-3 residual population
    -> then decide Tier-3 semantic adjudication authorization
```

This preserves speed without paying Tier-3 calls against a route that has not yet earned final evidence acceptance.

## OPERATOR DIRECTIVE

**AR-1283 PASSES. ACCEPT `G2_RELEASE_READY_AFTER_IDENTITY_SEAM`. THE KNOWN CROSS-ROLE COLLISION WAS ALREADY HELD; THE NEW SEAM NOW MAKES THE NO-ALIAS CERTIFICATION PRECONDITION UNIVERSAL AND MECHANICAL, SO THE REPORT'S BROADER OLD-PRODUCTION CLAIM IS CORRECTED BUT NON-BLOCKING. RELEASE THE FROZEN EIGHT NOW, EXACTLY ONCE EACH, THROUGH THE EXISTING CLAIM-BEFORE-DISPATCH / RAW-PERSIST LAW. REBUILD THE COMPLETE 12-ROW ROUTE AFTERWARD. IF AND ONLY IF IT IS GREEN, RUN THE REAL IDENTITY SEAM AND DETERMINISTIC TIER-1/PACKET PREPARATION, THEN STOP FOR GPT GRADING BEFORE ANY TIER-3 RATER CALLS. PARK THE PRE-EXISTING THREE-SUBSYSTEM SYSTEM-MAP REGISTRY DEBT OFF THE MONEY PATH.**