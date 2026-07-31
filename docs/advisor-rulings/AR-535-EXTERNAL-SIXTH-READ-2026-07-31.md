# External Advisor Ruling — AR-535 Sixth Read

**Date:** 2026-07-31  
**Ruling:** R-512  
**Scope:** AR-535 / R-511 §6 and §6.8  
**Decision:** **THE RECEIPT READER, THE WORKER’S REFUSAL, THE PUBLICATION-PAIR GATE, AND THE CURRENT CONVERGED PACKAGE ARE ACCEPTED. THE CLAIM THAT `M13` IS NOW ITS OWN RED-PROOF IS FALSE UNDER ITS EXECUTABLE VERDICT. `I7` REMAINS NOT CLOSED.**

## 1. Publication status

The evidence is no longer local-only.

The remote campaign branch contains:

- artifact regeneration commit `8e0cbbf4c312a35edb7aacbc8fd82d2d9c00bb41`;
- receipt publication commit `f5350c09fbf0696ced5ecf0bdb6678c479c0940b`;
- converged receipt commit `375ed9449c90ac148f8d638de8c10655143547ac`;
- AR-535 report commit `987a22072c382827126d377037af7930ae46a0ba`.

The branch has advanced only through the report and advisor-state update after `375ed944`; the generator, artifact, harness, and receipt package is unchanged from the reviewed position.

The publication gate is discharged.

## 2. Accepted findings

### A. The receipt was previously a decoration

The pre-remedy M13 result is accepted:

- the committed receipt recorded an obsolete harness blob;
- the harness mutation was committed, leaving the fixture worktree clean;
- the publication-path pair guard remained green;
- the generation-confound guard was clear;
- the dirty-harness positive control fired;
- `RECEIPT_IS_COVERED_BY` was empty.

That is valid evidence that the receipt had no executable consumer before the remedy.

### B. The worker’s refusal is correct

The instruction to add the receipt to the ordinary `worktree_blob == HEAD_blob` publication tuple is withdrawn.

The receipt records run-time HEAD identities. Running the harness rewrites those identities; committing the receipt advances HEAD again. Therefore a receipt-path equality gate would be structurally unable to reach a stable green state.

The refusal is not avoidance. It prevents a permanently-red alarm that users would learn to ignore.

### C. The replacement reader is sound as a mechanism

`RECEIPT_records_the_CURRENT_publication_blobs` reads the **committed** receipt and compares its recorded:

- harness blob;
- generator blob;
- artifact blob;

against the corresponding committed blobs at current HEAD.

The convergence sequence is accepted:

1. stale committed receipt → reader red;
2. regenerate and commit receipt → reader green;
3. independent Git-object comparison confirms all three joins.

The current committed receipt correctly describes the current committed harness, generator, and artifact.

### D. The remaining R-511 package is accepted

Accepted:

- `PUBLICATION_PATHS_worktree_equal_committed` is scored before `all_ok` and reaches the exit code;
- M12 separates clean-commit currentness from dirty-worktree refusal;
- `measurement_source_commit` is read from the committed artifact;
- M8’s `EXACT` wording was withdrawn and the fixture made internally consistent;
- the dead `stable_digest` alias was removed;
- the prefix exclusion resolves to a named set of seven and is assertion-guarded;
- the artifact reports `37 / 37` assertions passing;
- the six stop-condition measurements were re-derived and remain unchanged:
  - Corpus A binding movement `0`;
  - Corpus B binding movement `0`;
  - Corpus A diagnostic reason movement `17`;
  - Corpus B diagnostic reason movement `45`;
  - reconciliation `18 / 17 / 9`;
  - source-closure size `22`.

## 3. Decisive remaining defect: M13 does not require the reader to catch the stale receipt

The M13 code computes:

```python
m13_reader_red = ...
if m13_reader_red:
    reddened_by.append("RECEIPT_records_the_CURRENT_publication_blobs")
```

But its verdict is:

```python
m13_ok = (not m13_void) and control_fired and receipt_is_stale_in_fact
```

`m13_ok` does **not** require:

- `m13_reader_red` to be true;
- `RECEIPT_IS_COVERED_BY` to be non-empty;
- the receipt reader to be the exact assertion that reddened.

Therefore this regression still produces `OK=True`:

1. delete or break the receipt reader;
2. keep the M13 fixture valid;
3. preserve the stale receipt fact;
4. let the dirty-harness positive control fire;
5. `RECEIPT_IS_COVERED_BY` becomes empty;
6. M13 still reports `OK=True` and does not make `all_ok` red.

That is the original decoration defect surviving inside the proof of its repair.

The prose says M13 is now the reader’s red-proof. The executable verdict does not enforce that claim.

## 4. The confound guard is also too narrow

M13 currently declares generation confounded only when:

```python
fresh_n_pass != published_n_pass
```

Equal assertion counts do not prove equal generated artifacts.

A real-tree change can alter:

- an identity;
- a route partition;
- a source-closure blob;
- a deployed-scope value;
- another digest-covered field;

while leaving `n_pass` unchanged. `PUBLICATION_CONSISTENCY` would then redden for an unrelated reason, and M13 could falsely report that the stale receipt was already covered.

For M13, any red publication-consistency result is a confound because the experiment is intended to vary only receipt staleness.

The void condition must require the complete control to be green, not merely equal assertion counts.

## 5. Required bounded repair

Do not change the receipt-reader mechanism, measurements, artifact, engine, extraction, migration, runtime, corpora, environment, or database.

Repair only the M13 verdict contract.

### A. Require the exact expected reader result

The valid post-remedy expectation is:

```python
expected_coverage = ["RECEIPT_records_the_CURRENT_publication_blobs"]
```

M13 passes only when all are true:

```python
not m13_void
control_fired
receipt_is_stale_in_fact
m13_reader_red is True
reddened_by == expected_coverage
```

An empty coverage list is now a failure, not a valid experiment result.

An extra unrelated red is also a failure or void, not supporting evidence.

### B. Strengthen the confound guard

Replace count-only confound detection with full control-state validation:

```python
m13_generation_confounded = (
    m13_pc["PUBLISHED_ARTIFACT_IS_CURRENT"] is not True
    or m13_pc["fresh_digest"] != m13_pc["published_digest"]
)
```

The `fresh_n_pass` and `published_n_pass` fields may remain as diagnostics, but they are not the validity predicate.

### C. Separate historical diagnosis from current acceptance

Preserve the pre-remedy empty-list finding as historical evidence, but do not let the pre-remedy semantics govern the post-remedy `OK` field.

Recommended split:

- `M13_HISTORY_receipt_was_uncovered` — recorded evidence, not scored in current `all_ok`;
- `M13_READER_catches_committed_stale_receipt` — current scored red-proof requiring the exact reader result.

### D. Prove the verdict can fail

Add a local evaluator mutation that suppresses the reader result while leaving the stale receipt fact and fixture validity intact. The corrected M13 acceptance must become false.

This does not need to alter production code. It proves the verdict is load-bearing rather than descriptive.

## 6. CI wiring

The repeated receipt rot establishes that scheduled execution would be valuable. It does not authorize wiring a machine-bound harness into hosted CI before the harness contract closes.

CI wiring remains desk debt and must not begin under this ruling.

After the M13 verdict repair passes an independent read, the desk may issue a separate CI design ruling that accounts for the machine-bound deployed-binder dependency rather than creating a permanently-red hosted check.

## 7. I8 state

The controlling external state remains:

**`I8 NOT STARTED — WORKER DECLINE ACCEPTED; ADVISOR POPULATION-NAMING ACT HELD UNTIL I7 TECHNICAL CLOSURE.`**

No fresh untouched population is named, no fifth semantic-regex round is authorized, and `HOLDOUT-26` remains protected.

## 8. Position

- AR-535 publication: **ACCEPTED / REMOTELY VERIFIED**
- Pre-remedy receipt-decoration finding: **ACCEPTED**
- Worker refusal to add receipt to the equality tuple: **ACCEPTED**
- Receipt reader implementation: **ACCEPTED**
- Current receipt-to-HEAD three-blob join: **ACCEPTED**
- Publication-pair gate and M12: **ACCEPTED**
- Artifact `37 / 37` and six unchanged measurements: **ACCEPTED**
- Pre-registration/confound lesson: **ACCEPTED**
- Claim “M13 is now its own red-proof”: **REJECTED**
- M13 current `OK` predicate: **FALSE-GREEN**
- M13 count-only confound guard: **INSUFFICIENT**
- `I7`: **MEASUREMENT SOUND · ARTIFACT SOUND · RECEIPT READER SOUND · READER RED-PROOF VERDICT INCOMPLETE — NOT CLOSED**
- `I8`: **NOT STARTED — HELD, NOT CLOSED**
- `I21`: **PARTIAL — BEHAVIORAL PARITY UNMEASURED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **UNAUTHORIZED**
- CI wiring: **DESK DEBT / NOT AUTHORIZED YET**
- Merge / deploy / release: **HOLD**

## Control rules

> `A RED RESULT RECORDED BESIDE OK IS NOT LOAD-BEARING UNLESS OK REQUIRES IT.`

> `A RED-PROOF THAT PASSES WHEN ITS TARGET DOES NOT REDDEN IS A DECORATION WITH A TEST NAME.`

> `EQUAL ASSERTION COUNTS DO NOT PROVE AN UNCONFOUNDED ARTIFACT.`

> `THE WORKER’S REFUSAL STANDS: DO NOT BUILD A GATE THAT CANNOT EVER BECOME GREEN.`
