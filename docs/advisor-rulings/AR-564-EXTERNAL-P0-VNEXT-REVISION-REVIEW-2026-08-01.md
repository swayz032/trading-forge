# External GPT review — `P0-vNext` revised design (`AR-562` / `AR-564`)

**Reviewed object:** campaign commit `00eeac673c2c91d0526be304980819e73e4cade3`, design blob `3b580d86aa6f39ba82a865f5429ad19affc109fb`, SHA-256 `a8913b937a0990dd1ca6f66ee10cabc30dd311c05c3465fabc20daf7ae8bf620`.

**Newest worker report read before publication:** `AR-564`. Its one-line correction is included in the object above.

**Decision: REVISE.** The four requested ideas are substantially present, and `AR-564` correctly removes the stale `ORACLE.json` caption. Implementation should remain blocked. The revised prose added new safety properties without revising the pre-registered proof contract that is supposed to demonstrate those properties, and two caller-independent objects still exist only as promises rather than frozen definitions.

## Claims verified

- **[MEASURED HERE, campaign tree]** Claim B is now `FROZEN-LEDGER CONFORMANCE`; its operative failure is `LEDGER_DIVERGENCE`; the design universally requires `AUTHORITY_SEMANTICS_UNVERIFIED` on every green aggregate.
- **[MEASURED HERE, campaign tree]** The four-case presence matrix exists. It distinguishes `MISSING` from JSON `null` and makes both-lanes-absent fail as `PROJECTION_MISSING_BOTH` except for the exact authority-classified `NOT-APPLICABLE` cell.
- **[MEASURED HERE, campaign tree]** Runtime-authored scope membership is forbidden. The design requires registered `scope_id` values, exact member sets and digests, five fail-closed registry checks, and consumer-side id+digest matching.
- **[MEASURED HERE, campaign tree]** `AR-564` replaced the §7 oracle caption with the accurate three-part role. The schema key sets did not change in that commit.
- **[MEASURED HERE, Blueprint v4]** Phase 1 still exits only when at least one tier-A spec has every load-bearing condition concretely bound **and** compile-fidelity calibration passes. This design is a prerequisite instrument; neither Claim A nor frozen-ledger conformance is that phase exit.

## F-1 — the proof contract is still the old design

Section 10 says every rule owes a red mutation, but its matrix was not revised with the design:

- `INCORRECT` occurs once in §10; `LEDGER_DIVERGENCE` occurs zero times there.
- `scope_id`, scope digest mismatch, `PROJECTION_MISSING_BOTH`, JSON `null`, and `AUTHORITY_SEMANTICS_UNVERIFIED` each occur zero times in §10.
- Test 5 says to corrupt an `ASSERTED` expectation. That primarily attacks ledger integrity. It does **not** prove Claim B is independent of Claim A.

The decisive Claim-B attack is: make TS and Python emit the **same wrong value** for one `ASSERTED` cell. Required result: Claim A remains green, Claim B alone emits `LEDGER_DIVERGENCE`, and the citation is printed. Without that control, an implementation can make Claim B an alias of agreement and still satisfy the current matrix.

The matrix also needs pre-registered attacks for:

1. both lanes missing a non-`NOT-APPLICABLE` cell → `PROJECTION_MISSING_BOTH`;
2. both lanes missing an exact `NOT-APPLICABLE` cell → the named skip witness, without a Claim-B predicate;
3. `MISSING` on one side versus present JSON `null` on the other → red;
4. unknown scope, registered-empty scope, added member, removed member, and scope-digest mismatch → red and named;
5. consumer-required scope id or digest mismatch → consumer rejection;
6. removal of `AUTHORITY_SEMANTICS_UNVERIFIED` from any green aggregate → invalid output/non-zero;
7. one clean control proving the suite is not always red, with the actual catcher attributed per mutation.

**Why this is load-bearing:** the implementation acceptance suite is the executable meaning of the design. New prose with an old mutation matrix is a correction that no test is obliged to enforce.

## F-2 — the Phase-1 denominator is promised, not pre-registered

The document contains generic `scope_id` rules, but it contains **no actual Phase-1 scope id, exact member set, digest, or required-claim vector**. No scope line contains a digest literal. Therefore the sentence “the Phase-1 admission scope is pre-registered before any implementation result exists” is presently a future requirement, not a completed pre-registration.

Line 104 also retains the old escape in a new caption: *“Promotion decisions that need C must either narrow their scope explicitly — and print it — or wait.”* Explicit narrowing plus printing was the rejected design. A promotion consumer may use only the exact profile frozen for that consumer; it may not select a friendlier registered scope at decision time.

Before implementation begins, freeze a committed profile containing at least:

`consumer_id · required_claim_set · scope_id · exact sorted cell-id set · scope digest · derivation authority · out-of-frame exclusions`.

The Phase-1 consumer must reject every other profile. If no independent authority can define that set now, record `NO SOUND PHASE-1 PROFILE AVAILABLE`; do not let the implementer author the exam it will immediately pass.

## F-3 — presence is specified; projection meaning is not

The presence matrix is sound, but §11 still says the TS/Python invocation and extraction mechanics are unspecified and calls them implementation. That is not merely implementation detail: Claim A's meaning is determined by which raw path represents each axis and by its normalization.

“Record the pure transformation used” is disclosure after the choice. It does not constrain the choice. Before code, freeze a seven-axis projection contract containing, per lane and axis:

`raw source path · presence rule · canonical type · normalization/derivation function · failure on unsupported shape`.

Bind that table by a committed digest and add a mutation that changes one path or normalizer and must fail. Otherwise two lanes can agree because the implementation projected the same convenient surrogate from both.

## Evidence independently checked

- `git log` and `git hash-object` pinned the committed design object above; the design path is clean in the campaign tree.
- A section-scoped token audit of §10 found: `INCORRECT=1`, `LEDGER_DIVERGENCE=0`, `scope_id=0`, `digest mismatch=0`, `PROJECTION_MISSING_BOTH=0`, `JSON null=0`, `AUTHORITY_SEMANTICS_UNVERIFIED=0`. Positive controls in the same section found `INCOMPLETE_AUTHORITY=1` and `DISAGREEMENT=1`, proving the section extraction was live.
- The full design has only generic scope language and no concrete Phase-1 scope/digest pair.
- The corrected §7 oracle caption at line 122 and the three-clause explanation at §12 now agree.
- Blueprint v4 lines 80–82 and 585–593 preserve the real phase exit and state explicitly that a green prerequisite is not a compiled strategy.

## Architecture invariants touched

- Compiler fidelity remains separate from ledger conformance.
- A prerequisite closing is not Phase 1 exiting, and Phase 1 exiting is not a trading-ready strategy.
- Callers and implementations may not choose their own denominator or their own projection meaning after seeing results.
- No runtime, engine, ledger, oracle, corpus, DB, Gate-B, deployment, or live-capital surface should change in this correction.

## Required correction / allowed scope

**Design-only revision:** `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` plus the normal worker report. Update §10, replace line 104's explicit-narrowing permission, and freeze the Phase-1 consumer profile plus seven-axis projection contract before any implementation result exists. No implementation code yet.

**Acceptance:** structural sweep shows no retired `INCORRECT` verdict; every newly added contract has a named red mutation and clean neighbour; the exact Phase-1 profile and projection-contract digests are present; no wording permits a consumer to choose a different scope; the design remains explicit that authority semantics over the 140 cells are unverified.

**Stop condition:** if either the Phase-1 cell set or an axis projection must be chosen from the result-producing implementation or from the ledger/oracle being judged, stop and report `NO SOUND DESIGN AVAILABLE` for that boundary.

## Failed or unproven conditions

- No implementation exists, so none of these contracts has executed.
- The 140 authority semantics remain unverified.
- CI execution remains unproven.
- The exact Phase-1 admission profile and the exact seven-axis projection mapping are not yet frozen.

**External recommendation:** preserve the architecture, revise these three boundaries, and keep implementation blocked until the revised design receives another exact-object read.
