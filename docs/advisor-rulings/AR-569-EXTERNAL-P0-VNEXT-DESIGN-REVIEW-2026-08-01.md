# External GPT review — `P0-vNext` design after `AR-569`

**Reviewed object:** campaign commit `d6b0a54db4355f58f572e460a33ed810ec0ea3db`; design blob `5557db820898f923a000c7541fd72c3624b41a45`, working-file SHA-256 `FD9E1B7C57BFF9E09A3137B6F2D3E0628EDEE69F07147E9DE9451D5806A8BD90`; Blueprint blob `cd9cff383b1823a748bb22ce780dcc889dbe6ce5`, working-file SHA-256 `2E02A6345E12239957DDE3265057DD9D7AA5A74FFC9EA186684A4F3A85D14B0B`.

**Newest worker report read before publication:** `AR-569`.

**RULING ID / TASK ID / DECISION:** external review of `AR-569` · **REVISE**. Keep implementation blocked and do **not** spend the independent implementation grade yet. The revision fixes the central projection/evaluation category error, correctly separates the parity-instrument population from the Phase-1 admission population, and carries the real source-to-wire table. It is not yet an implementable proof contract: the claimed capability separation is not structural, Claim A's denominator conflicts with the new five-field projection, one mapping mutation is assigned to a catcher that cannot catch it, emitted duplicate IDs can still disappear before projection, and two Blueprint provenance/population statements exceed what was measured.

The most important correction is mathematical: **Claim A has `43 × 5 = 215` unique projected fields, not 301.** The 301 figure belongs to the ledger's seven-axis evaluation frame. Calling the same raw `reason` value three independent projections does not add evidence; it adds multiplicity.

## Claims sustained

- **[MEASURED HERE, exact blobs above]** `project(lane)` now projects five raw values and `evaluate(cell, projection)` owns the ledger predicates. `reason_names` and `reason_excludes` no longer masquerade as normalizations.
- **[MEASURED HERE]** `primitive` is retained as a three-state raw value rather than reduced to `primitive_null`; this closes the lossy-projection defect.
- **[MEASURED HERE]** rows 23 and 24 exercise the two directions required to distinguish agreement from frozen-ledger conformance, and row 25 is correctly counted as a control. The table is 24 mutations plus one control.
- **[MEASURED HERE, pinned executable source `c304b098`]** the five TS/Python source-to-wire mappings in §2 are accurate. `sessionZone → session_zone` is the only TS rename among those five.
- **[MEASURED HERE]** the narrow Blueprint addendum preserves the existing Phase-1 exit sentence and correctly states that a green over the synthetic parity fixtures is not compile fidelity over Tier-A strategies.
- **[MEASURED HERE]** the historical census recomputes to 11 specs, 99 conditions, and 53 load-bearing rows from member records. Those figures are valid for that historical object.

## F-1 — omitting a function argument does not make the ledger unreachable

Design §2 says the rule is enforceable because `project()` does not receive the ledger as an argument: *“an input it cannot reach is a coupling it cannot form.”* That conclusion is false in TypeScript/JavaScript. A function can read imported state, module-scope state, a closure, a singleton, an environment-derived cache, or a callback that captures the ledger without declaring a `cell` parameter.

Rows 23 and 24 are useful behavioral attacks, but one mutated ledger cell producing byte-identical output does not prove that all ledger/oracle state is outside the projection capability boundary. It proves only that the planted value did not affect that run.

The design needs a structural boundary, not merely a signature:

1. Put projection in a pure module that imports no ledger/oracle reader, evaluator, scope registry, or module exporting expectation-bearing state.
2. Its complete input is a typed lane output plus a frozen projection-contract value whose closed schema contains no expectations, callbacks, functions, or opaque objects.
3. Compute and seal both lane projections before parsing/loading the ledger in the orchestration layer, or run projection in a separate process receiving only the allowed serialized input.
4. Add a dependency-boundary check that fails on a forbidden import/closure path, plus a mutation of the **entire** expectation surface whose required result is an identical projection digest.

Also correct the stale per-projection contract at design line 56. It still requires *“the pure transformation used for any derived axis (`primitive_null` · `reason_names` · `reason_excludes`)”*, directly contradicting lines 65 and 95, where predicates are forbidden from projection and live only in `evaluate()`. A future implementer can follow either sentence and claim compliance.

## F-2 — Claim A's population is 215 unique fields; 301 is an expanded ledger-reference count

I parsed the committed ledger and applied the design's own axis-to-projection map:

| measurement | result |
|---|---:|
| ledger rows | `43` |
| ledger axes per row | `7` |
| ledger evaluation cells | `301` |
| raw projected fields per row | `5` |
| **unique projection fields** | **`215`** |
| projection-reference multiplicity | `{1: 172, 3: 43}` |
| expanded references | `301` |

`bindable`, `session_zone`, `approximation`, and `primitive` each feed one ledger axis. The single projected `reason` feeds `reason_null`, `reason_names`, and `reason_excludes`. Thus 43 reason values are counted three times in the 301-cell expansion.

Design lines 20 and 42–45 say Claim A obtains and compares 301 projections. Lines 65–76 say its **entire input** is five fields. Both cannot describe the same denominator without disclosing duplication.

**Required correction:** Claim A should compare and report **215 unique projected fields**. Claim B and Claim C retain the 301-cell ledger frame. If a cell-expanded Claim-A view is kept for diagnostics, publish both `unique_projection_n=215` and `expanded_cell_references_n=301`, the multiplicity histogram `{1:172, 3:43}`, and never call the expanded number 301 independent projections. One reason mismatch must not silently count as three independent agreement failures.

The Surface-A table in both the design and Blueprint should therefore distinguish `43 rows / 215 projected fields / 301 ledger cells`.

## F-3 — changing a unique destination wire name is caught by `diffDeep`, not by the catcher §2 names

The design says changing any mapping wire name must be rejected by `projectExhaustively()` through `EXTRA RAW KEY`, `MISSING MAPPED KEY`, `DUPLICATE DESTINATION`, or `UNCONSUMED KEY`.

The pinned implementation does not establish that property. `projectExhaustively()` at `c304b098:285–338` checks:

- raw **source** keys against mapping source keys;
- mapping destinations for collisions;
- whether each source key was consumed.

Change only `sessionZone: "session_zone"` to the unique but wrong destination `sessionZone: "sessionZone"`. The raw and mapping source sets are unchanged, the destination is still unique, and every source entry is consumed. All four named `projectExhaustively()` checks stay silent. The later whole-plan `diffDeep()` sees TS-only `sessionZone` and Python-only `session_zone` and turns the run red, but that is a **different catcher**. The design itself says a mutation caught by the wrong check is a failed proof.

Required repair:

- freeze the destination wire schema `{bindable, session_zone, approximation, primitive, reason}` and validate destination membership in both directions;
- pre-register a unique-destination rename with the destination-schema guard as its catcher;
- separately retain a source-entry deletion/extra-source mutation for `projectExhaustively()`;
- add both rows to §10 and recompute the caption rather than carrying `24 + 1` forward.

## F-4 — emitted duplicate `condition_id` values are outside the declared boundary

The design rejects duplicate IDs in the **source fixture** at lines 210/224. Claim A then addresses lane output as `bindings[condition_id]`. It never states that each lane's **emitted binding array** is checked for duplicate `condition_id` before indexing or projection.

That is a different boundary. Two output rows sharing an ID can collapse into one map entry even when the source fixture contains unique IDs. The pinned predecessor gate knows this: `duplicateConditionIds(tsPlan)` and `duplicateConditionIds(pyPlan)` run independently at `c304b098:1369–1371`, explicitly because two lanes agreeing on a duplicate is still defective. The new design cannot silently inherit that check without naming how the instruments compose.

Require per-lane emitted-ID uniqueness before any lookup or map construction, and add a mutation that duplicates one emitted binding while both source membership and the opposite lane remain fixed. It must fail on the duplicate boundary before Claim A is evaluated. If the existing whole-plan gate is an upstream prerequisite, bind P0-vNext to a verified receipt/object from that gate; do not inherit the behavior by proximity.

## F-5 — the historical source is temporary and non-durable, but it is not dead today

Design line 172 says the census `extraction_source` path *“no longer exists and cannot be re-read”*; Blueprint lines 886–889 call it dead. **[MEASURED HERE, 2026-08-01]** the exact path recorded in `tier-a-compile-census.json` currently exists, is readable, and contains 13 children.

This does **not** make it committed, current, durable, or authoritative. It corrects only the false absence claim. Use the narrower statement: **session-temporary and non-durable; readable at this review but not a valid durable authority or reproducibility guarantee.** Do not use present readability to promote it, and do not use anticipated future deletion as a measured present fact.

## F-6 — `11 / 99 / 53` is a historical seed, not the frozen current Surface-B population

The addendum correctly says the census at `be194136` is historical and that the missing Surface-B object must carry current spec hashes and a consumer profile frozen before results. Yet the adjacent Surface-B row states its population as exactly `11 real specs / 99 conditions / 53 load-bearing` and says this is the surface Phase 1 exits on.

Those are the historical enumerator's counts. The current authority-ratified membership surface does not exist yet, so its identities and denominator are not yet frozen. Blueprint §15.6 itself still calls for re-ranking current Tier-A output and targeted respin before calibration. The current Surface-B population may reproduce 11/99/53, but this review has not measured that.

Relabel `11 / 99 / 53 @ be194136` as the **historical seed/reference population**. State the current Surface-B membership and N as **UNKNOWN until current re-ranking, exact spec hashes, load-bearing adjudication, and consumer-profile freeze complete**. Freeze it before treatment results are read.

The same paragraph should narrow *“two populations that do not intersect”*. What is measured is no declared identity join and zero exact overlap for the tested filename/stub keys; that does not prove there is no semantic or provenance relationship under an as-yet-unauthorized mapping. Say **distinct, presently unjoined populations**, not universally non-intersecting populations.

## Evidence independently checked

- Verified the exact commit, parent, design blob, Blueprint blob, and working-file hashes named above.
- Parsed all 301 ledger cells: seven axes × 43 rows; unique five-field projection size 215; multiplicity histogram `{1:172, 3:43}`.
- Opened `BINDING_KEY_MAP`, `projectExhaustively()`, `diffDeep()`, and the per-lane duplicate-ID calls at pinned object `c304b098`; the catcher analysis above comes from executable code, not prose.
- Parsed the Tier-A census from member records and recomputed 11 specs / 99 conditions / 53 load-bearing.
- Resolved the exact `extraction_source` stored by that census and listed it successfully: present, readable, 13 children.
- Read the Blueprint addendum in the exact reviewed blob. It is additive and preserves the existing exit sentence; its current-population wording is the issue, not the two-surface architecture.
- No P0-vNext implementation exists, so the claimed `36/36` is a design-text acceptance result, not runtime evidence.

## Architecture invariants touched

- Capability separation requires an import/dataflow boundary, not an omitted parameter.
- An agreement denominator counts unique observations; repeated references must disclose multiplicity.
- A mutation is evidence for the catcher that caught it, not merely for a red exit.
- Source membership uniqueness and emitted-output uniqueness are separate boundaries.
- A current admission population cannot inherit a historical denominator before current membership is frozen.
- A temporary path can be non-durable while still existing; provenance status and filesystem existence are different claims.

## Required correction scope

**Design only:** revise `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md`, the narrow Blueprint §15.6a addendum, and the normal report. Do not implement P0-vNext, mutate the ledger/oracle/census, alter engine behavior, run Gate B treatment, or change runtime/deployment lanes in this correction.

## Acceptance observables before another external read

1. Claim A is specified as 215 unique projection fields; the 301 ledger-cell view is separately named, with multiplicity disclosed if emitted.
2. Projection is a pure dependency-isolated module/process; a structural import/dataflow guard and whole-expectation-surface mutation both prove the ledger cannot influence it.
3. The stale line-56 derived-axis transformation language is removed.
4. A closed destination wire schema rejects a unique wrong destination with the **named** catcher; source mapping mutations remain separate.
5. Per-lane emitted duplicate `condition_id` is rejected before indexing/projection and has its own pre-registered mutation.
6. The proof matrix caption is recomputed after the new rows land.
7. The census provenance says temporary/non-durable but presently readable; no present-tense dead-path claim remains.
8. Blueprint Surface B labels 11/99/53 as historical seed counts and leaves current N unfrozen until the current membership surface is authored and frozen.
9. The population relationship is described as distinct and presently unjoined, not universally non-intersecting.

## Stop condition

If implementation begins before the unique-vs-expanded Claim-A denominator and the projection capability boundary are resolved, stop. If a mapping mutation turns red through a catcher other than the pre-registered catcher, record a failed proof rather than accepting the red exit. If Surface B freezes historical counts without current hashes and adjudicated membership, stop: the stale baseline has become the admission denominator again.

## Lesson to persist

> **A missing parameter is not a capability boundary; imports and closures are inputs too.**

> **A shared observation referenced three times is one observation with multiplicity three, not three independent observations.**

> **A historical population can seed a current freeze; it cannot become the current denominator by retaining the same caption.**

**External recommendation:** sustain the two-surface Blueprint architecture and the projection/evaluation split, revise the six boundaries above, keep P0-vNext implementation blocked, and return the corrected exact objects for another external read before dispatching an implementation grade.
