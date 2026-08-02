# External GPT review — `P0-vNext` design after `AR-571`

**Reviewed object:** worker delivery commit `a6f1426ffddb11db7b14cc0192b5ec557de9e1db`; design blob `52431447baf5c7f7400b07f396953b414bb63c9d`, working-file SHA-256 `91ADDDB8447E8678D2B0786CC171D8BE10C3FD6960E0E6208B67E6451E036994`; Blueprint blob `fa1ce96007967dc82638fd9e885f1fd84c50e303`, working-file SHA-256 `A30B115B2DD1DC9650479104905045C12085D201209A19CB17E74370D0D900FA`.

**Newest worker report read before publication:** `AR-571` (`AR-570` is its start receipt).

**RULING ID / TASK ID / DECISION:** external review of `AR-571` · **REVISE**. The nine requested corrections are present and the design is materially stronger. Keep implementation blocked and do **not** dispatch the implementation grade yet. Two remaining contradictions would rebuild Claim A's ledger dependence or make the mapping contract impossible to apply, and the new digest slogan overstates what a mutation can prove.

## CLAIMS VERIFIED

- **[MEASURED HERE, exact design blob]** Claim A now reports 215 unique projection fields; the 301-cell ledger frame is separated and the `{1:172, 3:43}` multiplicity is disclosed in both the design and Blueprint.
- **[MEASURED HERE]** the false omitted-parameter slogan is retired; five structural requirements replace it.
- **[MEASURED HERE]** the stale derived-axis projection sentence is no longer operative.
- **[MEASURED HERE]** destination-wire membership and per-lane emitted-ID uniqueness are now named as separate boundaries.
- **[MEASURED HERE]** §10 contains exactly 30 contiguous numbered rows: 29 mutations and row 30 as the sole clean control.
- **[MEASURED HERE]** census provenance is narrowed to temporary/non-durable but presently readable; Blueprint labels `11/99/53 @ be194136` historical and the current Surface-B N unknown.
- **[MEASURED HERE]** the populations are now described as distinct and presently unjoined, which matches the evidence.

## F-1 — Claim A still reads a ledger classification to decide whether a projection participates

The new architecture says:

- Claim A's entire input is five raw projected fields;
- projections are sealed **before the ledger is parsed**;
- Claim A may not read ledger state to decide whether a cell participates.

But the unchanged presence matrix says both lanes missing a projected field is a failure **unless that exact cell is authority-classified `NOT-APPLICABLE`**. Proof row 7 likewise requires both lanes missing an exact `NOT-APPLICABLE` cell to stay green.

That exception cannot be evaluated over the new 215-field Claim-A frame without consulting the 301-cell ledger classification. It also asks for an “exact cell” after the design has correctly established that one projected `reason` field feeds three different ledger cells. Claim A is therefore independent of `cell.value` but still dependent on `cell.classification` and participation state.

This is the same coupling one field to the left.

**Required correction:** keep applicability exclusively in Claim B/C. For Claim A's closed five-field projection, either:

1. require all five keys to be emitted for every row, using JSON `null` for a semantically inapplicable value, so `MISSING/MISSING` is always `PROJECTION_MISSING_BOTH`; or
2. derive allowed absence from a separate frozen, ledger-independent projection schema keyed by raw field—not from `NOT-APPLICABLE` cells.

The first is simpler and safer. Remove the Claim-A `NOT-APPLICABLE` exception and replace §10 row 7 with a Claim-B-only skip test that runs **after** the already-sealed Claim-A projection. Add a classification-only ledger mutation; Claim A's projection **and verdict** must remain byte-identical while Claim B/C may change.

## F-2 — the pinned binding map has 10 fields, while Contract 2b freezes only five

The design cites the pinned `BINDING_KEY_MAP` and `projectExhaustively()` as the source-side boundary, then freezes the destination wire schema to:

`{bindable, session_zone, approximation, primitive, reason}`.

**[MEASURED HERE, `c304b098:scripts/check-spec-binding-plan-parity.ts:259–270`]** the actual exhaustive binding map contains **10** source/destination pairs:

`conditionId/condition_id`, `type`, `role`, `object`, `bindable`, `primitive`, `approximation`, `executed`, `reason`, `sessionZone/session_zone`.

This creates an unimplemented middle boundary:

- pass the full raw `ConditionBinding` through a five-entry map and `projectExhaustively()` flags the other five legitimate raw keys as extra;
- pass the full 10-entry map and the five-key destination schema rejects five legitimate destinations;
- pre-pick five raw keys before `projectExhaustively()` and an extra/renamed raw field can be silently dropped by the picker before the supposedly exhaustive guard sees it.

The design needs an explicit two-stage contract:

1. **Full binding normalization:** validate the complete 10-field raw TS object against the complete 10-entry source map and the complete 10-key wire destination schema.
2. **Claim-A selection:** from that already-validated normalized object, select the exact five projection keys; validate that five-key selection in both directions and seal it.

`condition_id` remains the row identity and is checked for per-lane uniqueness before stage 2. `type`, `role`, `object`, and `executed` are explicitly outside Claim A but not silently discarded before the full boundary is validated.

Add separate mutations for a sixth/unknown raw field, a unique wrong destination, and a wrong five-field selector. Each must name its own catcher. Without this split, Contract 2b and row 28 cannot both be implemented literally.

## F-3 — an unchanged digest under one mutation does not prove absence of coupling

AR-571 promotes the whole-expectation mutation as load-bearing and states: *“A capability argument can be wrong about the mechanism; a digest that did not move cannot.”*

The digest can be accurately unchanged while a coupling still exists. For example, a forbidden projection can read:

- the ledger's classification counts while the mutation changes only expected values;
- ledger length, schema version, citations, or scope digest;
- a particular expectation invariant preserved by the chosen mutation;
- a branch not reached by the 43-row fixture population.

The unchanged digest proves exactly this: **the named mutation did not change the projection on the exercised population.** It does not prove that ledger state was unreachable.

Keep the mutation—it is a strong behavioral control—but remove the absolute slogan and make structural isolation the authority. Prefer the separate-process form: pass only the serialized lane output and closed plain-data projection contract; deny filesystem/network/environment access to ledger/oracle paths; return the sealed five-field projection. If a same-process module remains allowed, the design must specify how dynamic imports, generic filesystem reads, `globalThis`, environment variables, and transitive dependencies are denied, not merely how named imports are scanned.

## EVIDENCE INDEPENDENTLY CHECKED

- Verified the exact worker commit, both blobs, working-file hashes, and that later campaign commits do not change either reviewed file.
- Recomputed the ledger frame independently: 301 cells, 43 rows, 215 unique five-field projections, multiplicity `{1:172, 3:43}`.
- Parsed §10 between its section boundaries: rows `1..30` are contiguous and unique; only row 30 is the clean control.
- Read the executable `BINDING_KEY_MAP`: 10 entries, not five. Read `projectExhaustively()` and confirmed it validates source sets and destination collisions but does not perform five-key selection.
- Located every operative `NOT-APPLICABLE` reference. The Claim-A presence exception and proof rows 6–7 remain active in the exact reviewed blob.
- No implementation exists; `49/49` is a design-text probe result and cannot resolve either runtime contract above.

## TESTS RERUN

- Ledger parser: `cells=301`, `rows=43`, `unique_projection_fields=215`, histogram `{1:172, 3:43}`.
- Proof-matrix parser: `count=30`, `unique=30`, `contiguous=True`, `control_rows=[30]`.
- Exact source read: `BINDING_KEY_MAP` lines 259–270 emits 10 wire keys; positive control `sessionZone → session_zone` is present.
- Census source probe: the recorded temporary path remains readable with 13 children; the corrected wording is sustained.

## ARCHITECTURE INVARIANTS TOUCHED

- Claim A agreement must not use Claim B/C classification, expectation, applicability, or scope.
- Exhaustive normalization and selective projection are different stages with different schemas.
- A mutation proves its exercised relation, not universal non-reachability.
- `MISSING`, `null`, and value remain distinct; semantic inapplicability should not be represented by deleting a required wire key.

## FAILED OR UNPROVEN CONDITIONS

- Claim A's verdict remains classification-coupled despite its projection digest being ledger-independent.
- No implementable full-10-field → selected-5-field normalization pipeline is specified.
- The dependency boundary has not yet defined how same-process ambient capabilities are denied.
- No implementation, runtime mutation suite, CI execution, current Surface-B membership, or authority-semantic verification exists.

## REQUIRED CORRECTIONS

1. Remove `NOT-APPLICABLE` from Claim A participation and from the both-missing exception; move its skip proof wholly to Claim B.
2. Pre-register a classification-only ledger mutation requiring Claim A projection **and verdict** byte identity.
3. Specify full 10-field normalization followed by closed five-field Claim-A selection, with separate schemas and catchers.
4. Replace the digest absolutism with its measured scope; make process/dependency isolation the actual capability proof.
5. Recompute the proof caption after adding the required mutations.

## FILES / SCOPE ALLOWED

Design-only revision: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md`, the narrow Blueprint §15.6a addendum only if its Surface-A wording must change, and the normal worker report. Do not implement P0-vNext, edit the ledger/oracle/census, touch engine/runtime/extraction/DB/Gate B, or dispatch an implementation grade.

## ACCEPTANCE COMMANDS / OBSERVABLES

1. Active-text parse finds no Claim-A decision dependent on `NOT-APPLICABLE`, `classification`, `cell.value`, citations, scope, or any ledger field.
2. The presence matrix says both-missing is always a Claim-A failure for the five required wire keys; Claim B emits the nine named N/A skip witnesses separately.
3. Full source/destination maps each contain 10 exact keys; the Claim-A selector contains five exact keys. Bidirectional set differences are empty at both stages.
4. Three mapping/selection mutations hit three pre-named catchers, with the clean control green.
5. A classification-only ledger mutation and a whole-ledger mutation both leave Claim A projection and verdict byte-identical.
6. The process/dependency boundary names how ambient filesystem, environment, dynamic-import, and global-state reads are denied or fail closed.
7. The matrix count is re-parsed after edits; no carried count is accepted.

## STOP CONDITION

If Claim A must parse the ledger to decide that a missing field is acceptable, stop: projection participation is still authority-coupled. If the implementation validates only five keys from a 10-key raw binding without first proving the full boundary, stop: the selector has become the new silent-drop surface. If an unchanged digest is offered as proof of universal non-reachability, stop and label it as one mutation over one exercised population.

## LESSON TO PERSIST

> **Moving dependence from `cell.value` to `cell.classification` does not make a claim independent; it moves the coupling one field to the left.**

> **Validate the full object before selecting the measured subset, or the selector becomes the omission mechanism.**

> **An unchanged digest proves invariance under the mutation you ran, not the impossibility of every coupling you did not run.**

**External recommendation:** sustain all nine AR-571 corrections, revise these three remaining contracts, keep implementation blocked, and return the corrected exact design object for external review before any grade or implementation authorization.
