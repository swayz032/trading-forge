# External Advisor Ruling — AR-529 Second Read

**Date:** 2026-07-31  
**Scope:** R-507 §6 additive completion package  
**Decision:** **SOURCE-LEVEL CORRECTIONS ACCEPTED; SHIPPED `I7` CLOSURE REJECTED. THE AUTHORITATIVE RESULT ARTIFACT IS STALE RELATIVE TO THE FINAL INSTRUMENT PACKAGE.**

## 1. Evidence reviewed

The three named commits resolve publicly:

- `a83a04e440c87f2756bc1c03286b651bb31b8c49` — corrected scope predicates, snapshot metadata, shared-symbol body comparison, C2 identity assertion, narrowed scope claims.
- `d8e9b2cf2cc0352c306d2b49e4eca05ca16667c0` — corrected deployed repository root and added the resolved-HEAD assertion.
- `65994cc2cca20c8931f6f1edbfd3bd5435370191` — repaired M6 after the `top_level_nodes` refactor and expanded RED-proof provenance.

AR-529 and the result receipts were then published at `989f6a39fa543f06be8ab0c4dc6e017c3cbc3758`.

The source changes are real. The final publication package is internally inconsistent.

## 2. Decisive contradiction

The committed authoritative artifact:

`docs/replay-results/h1-battery/session-role-resolver-yield-2026-07-31.json`

still records:

- `TREE.head = a83a04e440c87f2756bc1c03286b651bb31b8c49`
- `ASSERTIONS.n_pass = 33`
- `deployed_repo_head = <unavailable: ... exit status 128>`
- no passing `SCOPE_snapshot_record_deployed_HEAD_actually_RESOLVED` assertion

That artifact was generated after `a83a04e4` but before the fixes in `d8e9b2cf` and `65994cc2` became part of the complete instrument package.

The committed RED-proof receipt reports a corrected dynamic run with `34 / 34` assertions and seven mutations, but its own `artifact_blob` is:

`57a8bb3486a84774a857c6ed2242b833d9213123`

That blob resolves to the same stale 33-assertion authoritative artifact carrying the unresolved deployed HEAD.

Therefore the receipt proves both facts at once:

1. the corrected generator can produce a green 34-assertion temporary run; and
2. the committed authoritative result was not regenerated from that corrected state.

A dynamic control run does not refresh a committed artifact.

## 3. Findings accepted

### A. The predicate correction is sound

Accepted:

- `DEPLOYED_IS_SUBSET_OR_EQUAL = dep <= camp`
- `DEPLOYED_IS_STRICT_SUBSET = dep < camp`
- strictness requires zero deployed-only names and at least one campaign-only name.

The original AR-528 independence claim is correctly withdrawn. Under the corrected predicate, M5 reddens both the capability tripwire and strict-subset assertion. M6 and M7 provide the more honest complementary blast-radius evidence:

- M6: deployed-only name makes subset-or-equal and strict-subset red while capability absence remains green.
- M7: equal sets make strict-subset and the capability tripwire red while subset-or-equal remains green.

### B. The `7 / 33` structural-divergence finding is accepted

Accepted as a structural snapshot:

- 33 shared top-level names
- 7 shared definitions with differing normalized AST bodies
- differing names include `FAMILY_META`, `FamilyMeta`, `_bind_condition_dispatch`, `_session_phrase_hit`, `refused_session_zone`, `resolve_session_keyword`, and `session_refusal_reason`.

This conclusively retires all claims that the campaign/deployed divergence is “purely subtractive,” “one lineage with only removals,” or a port requiring no reconciliation.

It does **not** establish behavioral divergence for all seven definitions. The honest state is:

> `7 / 33 shared top-level definitions differ structurally; behavioral parity is unmeasured.`

### C. The narrowed scope language is accepted in source

Accepted in the corrected generator:

- six named top-level capability symbols are absent from the measured deployed binder symbol table;
- this does not rule out aliases, renames, nested implementations, tuple-bound names, or equivalent logic elsewhere;
- the artifact is a static snapshot and requires regeneration after any deployed-binder change;
- the deployed binder is hashed separately because it belongs to a different Git tree.

### D. The RED-proof correction is accepted in source

Accepted:

- the obsolete hard-coded assertion count was replaced by a computed count;
- universal mutation-coverage language was withdrawn;
- demonstrated and undemonstrated assertion classes are separately enumerated;
- full mutation blast radii are published;
- M6 was repaired after the helper refactor;
- the receipt carries branch, HEAD, blobs, and reproduction metadata.

These corrections do not cure the stale committed main artifact.

## 4. AR-529 completion claim rejected

The statement **“all twelve items delivered”** is not accepted as a shipped-package claim.

The code required to satisfy the items is substantially present, but the authoritative result object that readers quote was generated from an earlier state and contradicts the final receipt on load-bearing fields:

- 33 assertions versus 34
- unresolved deployed HEAD versus claimed resolved deployed HEAD
- pre-`d8e9b2cf` measurement source versus the final corrected package

The new failure class is:

> `CURRENT CODE GREEN / PUBLISHED RESULT STALE.`

This is the artifact equivalent of testing one object and publishing another.

## 5. Required publication repair

Only an additive publication repair is authorized:

1. From a committed source state containing `a83a04e4`, `d8e9b2cf`, and `65994cc2`, run:
   - `python docs/replay-results/h1-battery/session_role_resolver_yield.py`
   - `python docs/replay-results/h1-battery/session_role_resolver_yield_REDPROOF.py`
2. Commit the regenerated authoritative main artifact and regenerated RED-proof receipt.
3. The authoritative main artifact must show:
   - the corrected measurement-source commit at or after `65994cc2`;
   - the current computed assertion count, expected `34`, all passing;
   - a genuinely resolved deployed repository HEAD;
   - the passing resolved-HEAD assertion;
   - both subset predicates and the strictness components;
   - the explicit C2/`WAIT_SESSION` identity equality assertion;
   - the `7 / 33` shared-body structural comparison;
   - deployed binder SHA-256 and all snapshot metadata;
   - the static-snapshot/rerun warning.
4. The RED-proof receipt must pin the exact blob of that newly committed authoritative artifact, not `57a8bb3486a84774a857c6ed2242b833d9213123`.
5. Add an executable publication-consistency assertion proving:
   - receipt-declared artifact blob equals `git hash-object` of the committed authoritative artifact;
   - receipt-declared generator blob equals the committed generator blob;
   - receipt-declared harness blob equals the committed harness blob.
6. Separate two identities explicitly:
   - `measurement_source_commit`: the commit whose generator and inputs produced the result;
   - `artifact_publication_commit` or `artifact_publication_tree`: the later Git object that publishes the generated artifact.

Do not require a generated artifact to contain its own future publication commit SHA; that is self-referential and impossible without another commit. Bind the publication using its blob/tree receipt instead.

No metric may be changed merely to make the regenerated artifact green. Any changed binding count, reason-movement count, identity set, route partition, body-difference set, or population count is a STOP and requires a new report.

## 6. `I8` correction

AR-529 states that `I8` was closed by R-507 §5. That is incorrect.

The external ruling held `I8` as:

`NOT STARTED — WORKER DECLINE ACCEPTED; ADVISOR POPULATION-NAMING ACT HELD UNTIL I7 TECHNICAL CLOSURE.`

It did not close the lane. No fresh untouched population has been named, no fifth semantic-regex round is authorized, and `HOLDOUT-26` remains protected.

Current `I8` state:

**`NOT STARTED — DECLINE ACCEPTED; ADVISOR PREREQUISITE HELD.`**

## 7. Position

- AR-529 source-level corrections: **ACCEPTED**
- M5 independence retraction: **ACCEPTED**
- M6/M7 replacement discrimination: **ACCEPTED**
- `7 / 33` shared-body structural divergence: **ACCEPTED**
- Purely-subtractive / additive-only port claim: **RETIRED**
- AR-529 authoritative main artifact: **STALE / NOT ACCEPTED AS FINAL**
- AR-529 “all twelve delivered” package claim: **REJECTED PENDING REGENERATION**
- `I7`: **DELIVERED · SOURCE-CORRECTED · PUBLICATION-INCONSISTENT — NOT CLOSED**
- `I8`: **NOT STARTED — HELD, NOT CLOSED**
- `I21` semantic follow-up: **PARTIAL — STRUCTURAL DIVERGENCE PROVEN, BEHAVIORAL PARITY UNMEASURED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND, UNCHANGED**
- `P0-v5`: **UNAUTHORIZED**
- Merge / deploy / release: **HOLD**

## Control rules

> `A DYNAMIC CONTROL RUN DOES NOT REFRESH A COMMITTED ARTIFACT.`

> `A RECEIPT THAT PINS A STALE ARTIFACT PROVES THE STALENESS; IT DOES NOT CURE IT.`

> `TEST THE OBJECT YOU PUBLISH, AND PUBLISH THE OBJECT YOU TESTED.`
