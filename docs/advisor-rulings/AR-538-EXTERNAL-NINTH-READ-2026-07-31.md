# External Advisor Ruling — AR-538 Ninth Read

**Date:** 2026-07-31  
**Ruling:** R-515  
**Scope:** AR-538 / R-514 §5  
**Decision:** **R-514 IS DELIVERED. THE I7 MEASUREMENT, ARTIFACT, PUBLICATION, RECEIPT, AND RED-PROOF PACKAGE ARE TECHNICALLY CLOSED FOR THEIR CLAIMED NARROW SCOPE. `I7` IS CLOSED.**

## 1. Publication independently confirmed

The final converged receipt is published at:

`2ef9441fa97eef6865a412c1e2e800c6c619376f`

AR-538 is published at:

`f76db28faaccd59d0d508817c8eccd02c02591cb`

After the converged receipt, the only AR-538 change is `AGENT-REPORTS.md`; the artifact, generator, harness, and receipt package remains unchanged.

The current committed objects are:

- artifact blob: `f45bc97486854d0ae65a676a0f51b84a6300c1e2`;
- generator blob: `85acccb4486c9f955e8690f446dc3e750f67bb40`;
- harness blob: `6d9b322fa8c2fc260b61773de0c1961abc618c58`;
- receipt blob: `7f4439404f5ddad6f5dfe977afe80948ac4a7ffe`.

The committed receipt records the artifact, generator, and harness blobs exactly, and all three worktree/HEAD publication pairs are recorded as identical.

## 2. Accepted: the disabling argument is removed by construction

The production reader is now:

```python
receipt_publication_blob_status(repo_root, receipt_rel, pairs)
```

Independent source inspection confirms:

- three positional parameters;
- zero defaults;
- no `ignore_labels` argument;
- no caller-accessible option that can disable a required receipt comparison.

This satisfies R-514’s preferred design. The former false-green path is absent from the production interface rather than merely watched.

## 3. Accepted: the real mechanism remains red-proofed

M13 still weakens the exact reader used by the live receipt case.

It does so by temporarily narrowing the module-level `RECEIPT_BLOB_LABELS` set inside `try/finally`, invoking the same production reader, and restoring the original set afterward.

The committed receipt reports:

```text
weakened reader went incorrectly green = true
M13 acceptance under weakened mechanism = false
MECHANISM_IS_LOAD_BEARING = true
```

The M13 scored verdict requires:

- the real shared reader to detect exactly the harness mismatch;
- no absent fields;
- the receipt-reader case to be the exact coverage source;
- predicate suppression to fail;
- mechanism weakening to fail.

The proof is joined to the live mechanism and reaches `all_ok` and the exit code.

The unmeasured exception-path restoration note is non-blocking: Python’s `finally` executes during exception unwinding, and an exception before assignment would fail the harness loudly rather than certify a false green.

## 4. Accepted: the identity guard now has a shipped red path

`receipt_reader_identity_status(source_text)` is the single evaluator used for both:

1. the real harness source;
2. the M14 mutated source.

The committed M14 case plants a second comparator in an in-memory source copy and reports:

```text
clean source OK = true
mutated source OK = false
planted comparator detected = true
```

The named planted function is:

`_M14_planted_second_comparator`

M14 is a scored case, appears in the attribution census, and reaches `all_ok` and the process exit code.

The guard’s stated limitation is accepted: it is a narrow structural guard over the known blob-template shape, not a universal semantic duplicate detector.

## 5. Accepted: captions and case-count truth

Confirmed:

- the retired statement that the default object under test is “the file on disk” is removed;
- committed mode is correctly described as reading the Git object at `HEAD`;
- the attribution census identifies `receipt_reader_identity_status()` as the implementation joining the clean identity case and M14;
- the receipt derives `n_scored_cases` from `len(results)`;
- the committed receipt reports `21` scored cases and one unscored historical record;
- `ALL_CASES_DISCRIMINATE` is true.

The disclosed crash at `7eaa6072` is accepted as a contained intermediate defect. It produced no artifact or campaign measurement, was corrected before the converged receipt, and is not present in the reviewed package.

## 6. Accepted I7 measurement

The authoritative artifact remains unchanged and reports:

- generator assertions: `37 / 37` passing;
- Corpus A binding movement: `0`;
- Corpus B binding movement: `0`;
- Corpus A diagnostic reason movement: `17 / 155`;
- Corpus B diagnostic reason movement: `45 / 6450`;
- reconciliation: `18 recognized / 17 reason-changed / 9 computed zones`;
- source-closure size: `22`;
- shared top-level structural differences: `7 / 33`;
- resolved deployed HEAD: `9af37b8ff36a13c05fb0ec26752c42a97fc300d7`.

No pre-registered stop condition moved.

The accepted narrow conclusion remains:

- the session-role resolver creates **zero binding movement** on both measured corpora;
- it creates **diagnostic refusal-reason movement** on 17 Corpus A rows and 45 Corpus B rows;
- Corpus A and Corpus B remain reported separately;
- the Corpus B C2 population remains an explicitly weaker OFF-control-derived surrogate;
- the 18/17/9 identity reconciliation is preserved;
- the measurement is a campaign-lane flag-ON hypothetical, not evidence that production deployment is enabled.

## 7. I7 closure

The chain from source identity to measured artifact to committed publication to receipt to executable red-proof is now complete for I7’s stated scope.

**`I7 CLOSED — NARROW MEASUREMENT SOUND.`**

This closure does not claim:

- strategy profitability;
- deployed behavioral parity;
- production enablement;
- engine-wide capability absence;
- universal assertion-class red-path coverage;
- CI enforcement;
- merge, deployment, or release readiness.

## 8. I8 state after I7 closure

The prior condition holding the advisor’s population-naming act behind I7 technical closure is now discharged.

However, this ruling does **not** name a fresh untouched population and does **not** authorize semantic-regex expansion, extraction migration, or a fifth tuning round.

The controlling state becomes:

**`I8 NOT STARTED — I7 HOLD DISCHARGED; FRESH UNTOUCHED POPULATION NOT YET NAMED; NO ADVANCEMENT AUTHORIZED.`**

`HOLDOUT-26` remains untouched and protected.

## 9. Remaining project states

- `I21`: **PARTIAL — BEHAVIORAL PARITY UNMEASURED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **UNAUTHORIZED**
- CI wiring: **DESK DEBT — SEPARATE DESIGN RULING REQUIRED**
- Merge / deploy / release: **HOLD**

CI remains separate because the harness has a deliberate red-between-code-and-receipt-commit convergence window and a machine-bound deployed-binder dependency. I7 closure does not authorize a permanently-red hosted workflow.

## 10. Position

- AR-538 publication: **ACCEPTED / REMOTELY VERIFIED**
- production disabling seam: **REMOVED**
- shared reader implementation: **ACCEPTED**
- mechanism-level falsifiability: **ACCEPTED**
- M14 identity-guard red path: **ACCEPTED / SCORED**
- captions: **CORRECTED**
- case count: **DERIVED / CONSISTENT**
- publication blobs and receipt joins: **ACCEPTED**
- campaign measurements: **ACCEPTED / UNCHANGED**
- `I7`: **CLOSED — NARROW MEASUREMENT SOUND**
- `I8`: **NOT STARTED — AWAITING SEPARATE ADVISOR POPULATION-NAMING ACT**
- Merge / deploy / release: **HOLD**

## Control rules

> `SAFETY BY CONSTRUCTION OUTRANKS SAFETY BY DETECTION WHEN THE BYPASS CAN BE REMOVED.`

> `A PROOF THAT RAN ONCE BECOMES EVIDENCE ONLY WHEN ITS PLANT, RESULT, AND VERDICT ARE PERSISTED.`

> `I7 CLOSURE CERTIFIES THE MEASUREMENT CHAIN, NOT THE DEPLOYMENT CHAIN.`

> `A CLOSED MEASUREMENT DOES NOT AUTOMATICALLY AUTHORIZE THE NEXT EXPERIMENT.`
