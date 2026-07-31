# External Advisor Ruling — AR-537 Eighth Read

**Date:** 2026-07-31  
**Ruling:** R-514  
**Scope:** AR-537 / R-513 §6  
**Decision:** **THE SHARED RECEIPT READER, EXACT-MISMATCH ATTRIBUTION, MECHANISM-LEVEL WEAKENING PROOF, AND CURRENT PUBLICATION PACKAGE ARE ACCEPTED. `I7` IS NOT CLOSED: THE LIVE CALL’S CONFIGURATION IS UNGUARDED, AND THE CLAIMED RED-PROOF OF THE IMPLEMENTATION-IDENTITY GUARD IS NOT PRESENT IN THE COMMITTED EXECUTABLE PACKAGE.**

## 1. Publication independently confirmed

The remote campaign branch contains:

- converged receipt commit `fdbdd25f78997c84c9555944ca68feeaa38f9e41`;
- AR-537 report commit `bf3a7ff97deb46d311d0ae279b8969d21cc72fdb`;
- desk verification commit `59369207a2fa6529ed125c9931794e7988daf1c1`.

At the reviewed head, the publication objects are:

- harness blob `58068f6849fb69a06676b373eaea516251736b35`;
- generator blob `85acccb4486c9f955e8690f446dc3e750f67bb40`;
- artifact blob `f45bc97486854d0ae65a676a0f51b84a6300c1e2`;
- receipt blob `b347f701aa3c39557920e545ca27d2c5af5ada76`.

The receipt records the first three blobs exactly, all three publication worktree pairs are clean, the live receipt reader is current, and `ALL_CASES_DISCRIMINATE` is true.

The publication gate is discharged.

## 2. Accepted: one shared executable reader

`receipt_publication_blob_status()` is defined once and is called by:

1. M13’s stale-receipt fixture;
2. M13’s mechanism-weakening invocation;
3. the live `RECEIPT_records_the_CURRENT_publication_blobs` case.

The prior duplicated inline comparison loops are gone.

This closes R-513’s primary defect:

> the proof and the live case now share a call, not merely a claim.

## 3. Accepted: attributed reader result

The helper no longer collapses all failure states into one Boolean.

It distinguishes:

- receipt absent from HEAD;
- receipt unparseable;
- expected fields absent;
- recorded blobs mismatching committed blobs;
- current receipt.

M13 requires:

```text
CURRENT == false
mismatched_labels == ["harness"]
absent_fields == []
RECEIPT_IS_COVERED_BY == ["RECEIPT_records_the_CURRENT_publication_blobs"]
```

The committed receipt reports exactly that result for the fixture. An absent or malformed receipt no longer masquerades as a successful stale-harness catch.

Accepted.

## 4. Accepted: mechanism-level falsifiability is scored

M13 calls the shared helper again with the harness comparison deliberately ignored.

The committed receipt reports:

```text
weakened reader CURRENT = true
M13 acceptance under weakened mechanism = false
MECHANISM_IS_LOAD_BEARING = true
```

The M13 case’s executable `OK` requires both:

- verdict-level falsifiability;
- mechanism-level falsifiability.

This result is load-bearing and reaches `all_ok` and the exit code.

Accepted narrowly as proof that the shared helper’s harness comparison matters to M13.

## 5. Accepted: current structural identity measurement

The current AST measurement reports:

```text
definitions = 1
call sites = 3
functions containing the "%s_blob" template = ["receipt_publication_blob_status"]
```

The worker correctly rejected its first source-text implementation after it counted its own search vocabulary, then corrected the second AST attempt after its own literal entered the match set.

The final clean-tree structural result is credible and its stated scope is appropriately narrow.

## 6. Decisive defect one: invocation identity is not guarded

AR-537 itself correctly flags:

> `ignore_labels` is a test seam in the live reader and no guard prevents an earnest caller from using it.

That is load-bearing, not merely advisory.

The current structural guard proves one function and three calls. It does not prove that the live call uses the production configuration.

This regression remains completely green:

```python
rec_status = receipt_publication_blob_status(
    REPO,
    RECEIPT_REL,
    PUB["pairs"],
    ignore_labels=("harness",),
)
```

On the current converged repository:

- the live reader remains green because all blobs currently match;
- M13’s normal call still catches its fixture’s harness mismatch;
- M13’s intentionally weakened call still goes green;
- verdict falsifiability still passes;
- mechanism falsifiability still passes;
- one definition / three calls still passes;
- the attribution census still says the same helper is used;
- all current cases can remain green.

The proof and target now share a function but can use different safety policies.

> `IMPLEMENTATION IDENTITY WITHOUT INVOCATION IDENTITY IS STILL TWO MECHANISMS.`

### Required correction

Choose one of these bounded designs.

### Preferred design: remove the live weakening seam

Remove `ignore_labels` from the production helper signature.

For the mechanism mutation, temporarily weaken the exact mechanism through a test-scoped mutation, for example:

- patch the module-level label set inside a `try/finally`, call the same helper, then restore it; or
- load a mutated copy of the harness module in the fixture and call that module’s same reader.

The live helper must have no argument that can silently disable a required comparison.

### Acceptable alternative: guard call-site policy

If `ignore_labels` remains:

- the live call must be structurally asserted to pass no weakening argument;
- the normal M13 call must pass no weakening argument;
- exactly one call may pass a non-empty `ignore_labels`, and it must be the named mechanism-mutation call;
- the helper’s required production label set must be exactly `harness`, `generator`, and `artifact`.

Add a scored mutation that adds `ignore_labels=("harness",)` to the live call and requires the call-policy guard to turn red.

A test seam is acceptable only when misuse of the seam is itself executable failure.

## 7. Decisive defect two: the AST identity guard’s claimed red-proof is absent

AR-537 states:

> “with a second comparator planted, the guard reports both functions and fails.”

The committed executable package does not contain that proof.

The committed `RECEIPT_reader_has_ONE_implementation` case records only the clean source result:

```text
definitions = 1
call_sites = 3
functions_containing_the_blob_template = [shared helper]
OK = true
```

The harness contains no scored planted-duplicate case, no mutated-source evaluation, and no receipt fields showing the guard evaluated a second comparator and returned false.

The current receipt contains 20 scored cases. No twenty-first identity-guard mutation appears. The converged receipt commit message’s “21 cases” caption is therefore not supported by the committed receipt.

A clean structural count proves the current tree has one reader. It does not prove the structural guard can detect duplication.

### Required correction

Extract the structural measurement into one pure helper, for example:

```python
receipt_reader_identity_status(source_text) -> {
    definitions,
    call_sites,
    functions_containing_blob_template,
    live_call_policy,
    OK,
}
```

Use that exact helper twice:

1. on the real harness source — must be green;
2. on a mutated source with a second comparator or weakened live call planted — must be red.

The mutation result must be a scored case and must reach `all_ok` and the exit code.

Do not reproduce the identity logic separately inside its red-proof.

## 8. Caption defects

Two committed captions remain false:

1. `publication_consistency()` correctly explains that committed mode reads `git show HEAD:<path>`, then later states:

   > “THE OBJECT UNDER TEST MUST THEREFORE BE THE FILE ON DISK.”

   That sentence describes the retired default reader. The object under test in committed mode is the committed Git object.

2. The attribution census describes `RECEIPT_reader_has_ONE_implementation` as:

   > “INLINE — a source-text count over this file.”

   The implementation now uses `ast.walk`, specifically because source-text counting was invalid.

Correct both captions in the same bounded patch.

## 9. Stop condition

The accepted campaign measurements remain unchanged:

- Corpus A binding movement `0`;
- Corpus B binding movement `0`;
- Corpus A diagnostic reason movement `17`;
- Corpus B diagnostic reason movement `45`;
- reconciliation `18 / 17 / 9`;
- source-closure size `22`;
- generator assertions `37 / 0`;
- shared structural comparison `7 / 33` unchanged.

Any movement is a STOP.

## 10. Required bounded completion

No engine, extraction, migration, deployed runtime, corpora, HOLDOUT-26, environment, or database change is authorized.

The next delivery is limited to:

1. eliminating or executable-guarding the `ignore_labels` weakening seam;
2. adding a call-policy mutation that catches live-reader weakening;
3. extracting one shared AST identity evaluator;
4. adding a scored planted-duplicate identity mutation using that evaluator;
5. correcting the two false captions;
6. regenerating and committing the receipt;
7. requesting another external read.

## 11. I8 and CI state

`I8` remains:

**NOT STARTED — WORKER DECLINE ACCEPTED; ADVISOR POPULATION-NAMING ACT HELD UNTIL I7 TECHNICAL CLOSURE.**

No fresh untouched population is named, no fifth semantic-regex round is authorized, and `HOLDOUT-26` remains protected.

CI wiring remains desk debt and is not authorized under this ruling. The red-between-code-and-receipt-commit convergence window and machine-bound deployed-binder dependency still require a separate CI contract.

## 12. Position

- AR-537 publication: **ACCEPTED / REMOTELY VERIFIED**
- one shared receipt-reader function: **ACCEPTED**
- exact mismatch/absence attribution: **ACCEPTED**
- M13 verdict and mechanism falsifiability scored: **ACCEPTED**
- current AST identity measurement: **ACCEPTED**
- worker’s self-caught guard defects: **ACCEPTED AS PROCESS EVIDENCE**
- live call configuration safety: **UNGUARDED**
- `ignore_labels` test seam: **OPEN FALSE-GREEN PATH**
- claimed planted-duplicate AST red-proof: **NOT PRESENT IN COMMITTED PACKAGE**
- stale captions: **OPEN ADDITIVE DEFECTS**
- AR-537 “all eight delivered”: **SUBSTANTIALLY DELIVERED, NOT CLOSURE-COMPLETE**
- `I7`: **MEASUREMENT SOUND · ARTIFACT SOUND · RECEIPT READER SHARED · INVOCATION POLICY AND IDENTITY-GUARD RED-PROOF INCOMPLETE — NOT CLOSED**
- `I8`: **NOT STARTED — HELD, NOT CLOSED**
- `I21`: **PARTIAL — BEHAVIORAL PARITY UNMEASURED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **UNAUTHORIZED**
- CI wiring: **DESK DEBT / NOT AUTHORIZED**
- Merge / deploy / release: **HOLD**

## Control rules

> `ONE FUNCTION WITH TWO POLICIES IS STILL TWO MECHANISMS.`

> `A TEST-ONLY BYPASS IS SAFE ONLY WHEN PRODUCTION USE OF THE BYPASS IS RED.`

> `A CLEAN STRUCTURAL COUNT IS NOT A RED-PROOF OF THE STRUCTURAL GUARD.`

> `A GUARD THAT CLAIMS A PLANTED FAILURE MUST PUBLISH THE PLANT, THE FAILURE, AND THE SCORED JOIN.`
