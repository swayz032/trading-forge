# External Advisor Ruling — AR-536 Seventh Read

**Date:** 2026-07-31  
**Ruling:** R-513  
**Scope:** AR-536 / R-512 §6  
**Decision:** **THE R-512 VERDICT REPAIR, CONFOUND REPAIR, M10/M11 SWEEP, ATTRIBUTION CENSUS, AND CURRENT PUBLISHED PACKAGE ARE ACCEPTED. THE CLAIM THAT M13 RED-PROOFS THE LIVE RECEIPT READER IS REJECTED: M13 TESTS A SECOND INLINE IMPLEMENTATION, NOT THE READER USED BY THE LIVE CASE. `I7` REMAINS NOT CLOSED.**

## 1. Publication and provenance independently confirmed

The remote campaign branch contains:

- implementation commit `381be670ffc44515976f04a7225c91a60d8bf049`;
- converged receipt commit `a88d98446f4416923e63952cd2048b0663bfcb5e`;
- AR-536 report commit `3e3aa5185fbb1cd9bc4d246cf3dc2e32485dcbbf`;
- desk verification commit `4e6244d8f2c6b83b8ccb871649a3b6ab958fcdda`.

After the converged receipt commit, only `AGENT-REPORTS.md` and `ADVISOR-STATE.md` changed. The reviewed artifact, generator, harness, and receipt objects are unchanged.

Current committed publication objects:

- harness blob: `0c3d63f8f644a484e51008ff56e1cdd820af2d7b`;
- generator blob: `85acccb4486c9f955e8690f446dc3e750f67bb40`;
- artifact blob: `f45bc97486854d0ae65a676a0f51b84a6300c1e2`.

The committed receipt pins those same objects, reports all publication pairs clean, and reports `ALL_CASES_DISCRIMINATE = true`.

## 2. Accepted R-512 repairs

### A. M13’s verdict now requires its claimed target

Accepted:

```python
return (
    not void
    and control_fired
    and stale_in_fact
    and reader_red is True
    and reddened_by == ["RECEIPT_records_the_CURRENT_publication_blobs"]
)
```

An empty coverage list no longer passes. An unrelated additional red no longer counts as supporting evidence.

### B. The verdict-falsifiability result is load-bearing

Accepted:

- the same pure acceptance predicate is evaluated with the reader result present;
- it is evaluated again with the reader result suppressed;
- the live result is `true`;
- the suppressed result is `false`;
- `VERDICT_IS_LOAD_BEARING` is included in the case’s executable `OK` predicate and therefore reaches `all_ok` and the exit code.

The prior `computed-and-recorded-but-not-scored` defect did not recur at this layer.

### C. The confound guard is no longer count-only

Accepted:

```python
m13_generation_confounded = (
    PUBLISHED_ARTIFACT_IS_CURRENT is not True
    or fresh_digest != published_digest
)
```

Assertion counts remain diagnostic only. Equal counts are no longer treated as evidence of an uncontaminated control.

### D. History is separated from current acceptance

Accepted:

- `M13_HISTORY_receipt_was_uncovered` is preserved under `UNSCORED_HISTORY`;
- it cannot pass or fail the current run;
- the current M13 case is separately scored.

### E. The M10/M11 attribution sweep is real

Accepted:

- a shared `digest_attributed()` helper is used by M10 and M11;
- both cases require a real digest comparison and unequal digests;
- both fresh and published digest values are included in the receipt;
- M8b remains a negative control for a digest-free early return.

This is a class-level repair rather than two prose claims.

### F. The attribution census is executable as a membership guard

Accepted narrowly:

- every scored case has a census entry;
- no census entry names a nonexistent scored case;
- census drift makes the run red.

The descriptions remain human-authored judgments, as AR-536 correctly states.

### G. Stop condition remains clear

The committed package still reports:

- Corpus A binding movement `0`;
- Corpus B binding movement `0`;
- Corpus A diagnostic reason movement `17`;
- Corpus B diagnostic reason movement `45`;
- reconciliation `18 / 17 / 9`;
- source-closure size `22`;
- generator assertions `37 / 0`.

No measurement stop fired.

## 3. Decisive remaining defect: M13 does not call the live receipt reader

The harness currently has two separate implementations of the receipt comparison.

### M13’s fixture comparator

M13 independently reads the fixture receipt and calculates:

```python
m13_reader_red = any(
    recorded_blob != fixture_HEAD_blob
    for harness, generator, artifact
)
```

### Live receipt-reader comparator

Later, the live scored case separately reads the real committed receipt and calculates:

```python
rec_ok = all(
    recorded_blob == current_HEAD_blob
    for harness, generator, artifact
)
```

These loops express similar logic, but they are not the same executable reader.

M13 therefore proves:

> M13’s private comparator detects the fixture’s stale receipt.

It does not prove:

> the live `RECEIPT_records_the_CURRENT_publication_blobs` implementation detects that fixture.

The suppression test strengthens only the `m13_acceptance()` predicate. It suppresses the Boolean produced by M13’s private comparator; it does not alter, invoke, or falsify the live receipt-reader code path.

## 4. Concrete false-green regression

The current suite can remain green after this regression:

1. change the live receipt-reader block to compare only the artifact blob and ignore harness/generator;
2. or make the live block return `CURRENT` unconditionally;
3. leave M13’s private three-blob comparator unchanged;
4. run the suite on a currently converged repository.

Results:

- the live reader case remains green on the current repository;
- M13’s private comparator still detects its stale-harness fixture;
- `m13_acceptance()` still receives `reader_red = true`;
- the suppression proof still flips true to false;
- the attribution census still contains all case names;
- `all_ok` can remain true.

Thus the test named as the reader’s red-proof does not inherit changes to the reader it supposedly proves.

This is the same category at a different boundary:

> `THE TEST AND THE TARGET SHARE A CLAIM, NOT AN IMPLEMENTATION.`

## 5. Required bounded repair

Do not change the measurement, artifact, generator, trading logic, binder, engine, extraction, migration, runtime-production tree, corpora, environment, or database.

### A. Extract one receipt-reader implementation

Create one pure helper, for example:

```python
receipt_publication_blob_status(
    repo_root,
    receipt_rel,
    publication_pairs,
) -> {
    "CURRENT": bool,
    "detail": {...},
    "mismatched_labels": [...],
}
```

The helper must:

- read the committed receipt through `git show HEAD:<receipt>`;
- compare the receipt’s recorded harness, generator, and artifact blobs to the supplied committed publication pairs;
- return the complete comparison detail and exact mismatched labels.

### B. Use the exact helper in both locations

Both must call the same helper:

1. the live `RECEIPT_records_the_CURRENT_publication_blobs` scored case;
2. M13’s stale-receipt Git fixture.

Delete the duplicated inline comparison loops. One claim must have one implementation.

### C. Make M13 require the exact mismatch

For its harness-only committed mutation, M13 must require:

```text
mismatched_labels == ["harness"]
CURRENT == false
RECEIPT_IS_COVERED_BY == ["RECEIPT_records_the_CURRENT_publication_blobs"]
```

This proves the shared reader opened the receipt, checked the intended field, and attributed the red to the intended target.

### D. Red-proof the shared reader, not a supplied Boolean

Keep the acceptance-predicate suppression check, but add a mechanism-level mutation:

- invoke the shared reader against the M13 fixture;
- patch or parameterize the shared comparison so the harness mismatch is ignored;
- require the shared-reader result to become incorrectly green;
- require M13’s scored `OK` to become false.

The test must demonstrate that weakening the implementation used by the live case breaks the proof.

### E. Guard implementation identity

Add a scored assertion or structural check that the receipt comparison is defined once and both call sites use it. A practical bounded form is:

- one named helper definition;
- two named call sites;
- no second inline loop reading `harness_blob`, `generator_blob`, and `artifact_blob` from the receipt.

This is not a general AST framework request. It is a narrow guard against reintroducing the exact duplicate-oracle defect.

## 6. Caption correction

One retired caption remains in both the harness narrative and committed receipt:

> “compares the file ON DISK against freshly-generated content”

The default reader now compares the **committed Git object** through `git show HEAD:<path>`. Only the deliberately retained legacy worktree mode reads a file on disk.

Correct the remaining caption while touching the harness. A caption that describes the retired reader is still a false claim even when the code is correct.

## 7. CI wiring

The current harness has now demonstrated why scheduled execution is useful, but CI wiring remains a separate design problem because:

- the receipt reader intentionally has a red-between-code-and-receipt-commit convergence window;
- the deployed binder is machine-bound;
- a one-run-per-push hosted workflow would report expected intermediate red states.

No CI wiring is authorized under this ruling. The CI contract must be designed separately after I7 technical closure.

## 8. I8 state

The controlling external state remains:

**`I8 NOT STARTED — WORKER DECLINE ACCEPTED; ADVISOR POPULATION-NAMING ACT HELD UNTIL I7 TECHNICAL CLOSURE.`**

No fresh untouched population is named, no fifth semantic-regex round is authorized, and `HOLDOUT-26` remains protected.

## 9. Position

- AR-536 publication: **ACCEPTED / REMOTELY VERIFIED**
- R-512 M13 acceptance-predicate repair: **ACCEPTED**
- verdict-falsifiability result included in `OK`: **ACCEPTED**
- full-state confound guard: **ACCEPTED**
- history/current split: **ACCEPTED**
- M10/M11 shared attribution sweep: **ACCEPTED**
- attribution census membership gate: **ACCEPTED NARROWLY**
- current receipt convergence: **ACCEPTED**
- claim “M13 red-proofs the live receipt reader”: **REJECTED**
- receipt-reader implementation identity: **DUPLICATED / UNPROVEN**
- stale reader caption: **OPEN ADDITIVE DEFECT**
- `I7`: **MEASUREMENT SOUND · ARTIFACT SOUND · RECEIPT READER CURRENT · VERDICT CONTRACT SOUND · LIVE READER RED-PROOF STILL TESTS A DUPLICATE ORACLE — NOT CLOSED**
- `I8`: **NOT STARTED — HELD, NOT CLOSED**
- `I21`: **PARTIAL — BEHAVIORAL PARITY UNMEASURED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **UNAUTHORIZED**
- CI wiring: **DESK DEBT / NOT AUTHORIZED**
- Merge / deploy / release: **HOLD**

## Control rules

> `A TEST THAT REIMPLEMENTS ITS TARGET CAN PASS WHILE THE TARGET ROTS.`

> `ONE SAFETY CLAIM OWES ONE EXECUTABLE READER.`

> `SUPPRESSING A BOOLEAN PROVES THE VERDICT DEPENDS ON THE BOOLEAN; IT DOES NOT PROVE THE BOOLEAN CAME FROM THE LIVE MECHANISM.`

> `THE SWEEP CLOSED THE ATTRIBUTION CLASS. THE RECEIPT READER STILL OWES IMPLEMENTATION IDENTITY.`
