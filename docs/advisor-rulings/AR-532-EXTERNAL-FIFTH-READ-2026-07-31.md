# External Advisor Ruling — AR-532 Fifth Read

**Date:** 2026-07-31  
**Ruling:** R-511  
**Scope:** AR-532 / R-510 §6  
**Decision:** **THE COMMITTED ARTIFACT, COMMITTED READER, M8/M8b, M9, M10, M11, SOURCE-CLOSURE CANONICALIZATION, AND THREE-IDENTITY PUBLICATION SEQUENCE ARE ACCEPTED. ONE EXECUTABLE PUBLICATION-PATH GATE REMAINS FALSE-GREEN. `I7` IS NOT CLOSED.**

## 1. Evidence independently confirmed

AR-532 resolves publicly at:

`1a20a0d1fd512a604af8e439f7a489c5a95dee56`

At that commit, GitHub independently reports:

- authoritative artifact blob: `6eb62802ce17405ff2bc4aaa591735aa62ef24bd`
- generator blob: `46db1c0dca7bd782804f5a0d2ad6eddc6e9cbad6`
- RED-proof harness blob: `693968f3a3647122011f293c62b2bc04ef837c43`
- committed receipt blob: `b2965de4379d08641af1eea804342da74234eb77`

The receipt pins the first three values exactly.

The publication sequence is coherent:

- `measurement_source_commit`: `4f8bdfdbeb3a830ec0a5b3c341580e9ff77d1676`
- `artifact_publication_commit`: `0f88877ec716b788c4c81751322bfbabcdd9feed`
- `receipt_measurement_commit`: `0f88877ec716b788c4c81751322bfbabcdd9feed`

The artifact was generated from the final measurement-source state at `4f8bdfdb`, committed at `0f88877e`, and the receipt then measured that committed artifact state. The receipt itself is externally certified here at the later public commit `1a20a0d1`; correctly, it does not claim to know its own future publication commit.

The authoritative artifact remains stable:

- `36 / 36` generator assertions pass;
- Corpus A binding movement: `0`;
- Corpus A diagnostic reason movement: `17 / 155`;
- Corpus B binding movement: `0`;
- Corpus B diagnostic reason movement: `45 / 6450`;
- reconciliation: `18 recognized / 17 changed / 9 zones`;
- source-closure size: `22`;
- deployed HEAD: `9af37b8ff36a13c05fb0ec26752c42a97fc300d7`;
- shared structural divergence remains `7 / 33`.

No pre-registered metric stop fired.

## 2. Accepted: M8 rebuilt as an actual stale-content test

The old M8 false discrimination is correctly confessed and retired.

The new M8:

1. initializes a temporary Git repository;
2. commits a stale artifact at the authoritative relative path;
3. invokes the committed-tree reader;
4. requires a real digest mismatch;
5. requires the reader to return `published_n_pass = 33`;
6. returns the planted deployed-HEAD error string.

The receipt proves the mutation was read rather than short-circuited on a path error.

M8b separately tests the valid fail-closed behavior for an unpublishable path and explicitly says it is not a stale-content proof. That separation is accepted.

## 3. Accepted: M9, M10, and M11

- M9 still proves both directions of `COMMIT STALE / WORKTREE FRESH`: the worktree reader is green and blind; the committed-tree reader is red and detects the stale commit.
- M10 proves identity-map content is inside the canonical artifact digest.
- M11 proves source-closure path identity is inside the digest.

The source-closure entry-point repairs are also accepted:

- the RED-proof harness is excluded from the measurement-source closure;
- the generator is added unconditionally, so standalone and importlib entry points produce the same measurement closure;
- the closure remains `22` in the published artifact.

## 4. Accepted: the committed blob fields and identity model

The receipt's authoritative artifact, generator, and harness blob fields now come from `HEAD:<path>`, with working-tree hashes carried beside them.

The three publication identities are installed with distinct definitions. Their values are coherent with the public commit history.

The obsolete fixed `26` caption at the top of the harness is removed and replaced by count-neutral text. Runtime remains responsible for reporting the computed count.

## 5. Remaining load-bearing defect: `ALL_CLEAN` is data, not an executable gate

The harness builds mutation `results`, then executes:

```python
all_ok = all(r["OK"] for r in results)
```

Only after `all_ok` has been decided does it construct:

```python
"PUBLICATION_PATH_BLOBS": {
    "artifact": pubblob(ARTIFACT_REL),
    "generator": pubblob(GENERATOR_REL),
    "harness": pubblob(HARNESS_REL),
    "ALL_CLEAN": all(pubblob(p)["IDENTICAL"] for p in (...)),
}
```

`PUBLICATION_PATH_BLOBS.ALL_CLEAN` is never appended to `results`, never incorporated into `all_ok`, and never drives the process exit code.

Therefore the caption:

> “a dirty publication path is RED”

is false for the artifact path.

The generator's control run independently asserts that the generator and harness working blobs equal their HEAD blobs. It deliberately does not assert the artifact pair because the generator overwrites the artifact. The harness was supposed to provide the post-commit artifact assertion, but currently only records it.

The remaining false-green sequence is:

1. committed artifact is current;
2. modify only the artifact working-tree file after commit;
3. leave generator and harness clean;
4. run the RED-proof harness;
5. committed publication consistency remains green because it correctly reads `HEAD:<artifact>`;
6. `PUBLICATION_PATH_BLOBS.artifact.IDENTICAL` becomes false;
7. `ALL_CASES_DISCRIMINATE` and exit code can still remain green because `ALL_CLEAN` is not a scored case.

The receipt would simultaneously say the publication path is dirty and certify the package as passing.

### Required correction

Compute the three publication pairs once and add a scored result before `all_ok` is calculated:

```text
case: PUBLICATION_PATHS_worktree_equal_committed
artifact IDENTICAL
+ generator IDENTICAL
+ harness IDENTICAL
= OK
```

The result must be part of `results`, `ALL_CASES_DISCRIMINATE`, and the exit-code contract.

The receipt's `measurement_source_commit` must also be read from the committed artifact content, not from `AUTHORITATIVE_ARTIFACT.read_text()` in the working tree.

### Required M12

Add:

`M12_ARTIFACT_WORKTREE_DIRTY_COMMIT_CURRENT`

Fixture contract:

1. create a Git fixture with a current committed artifact;
2. alter only the artifact working-tree file;
3. committed-tree publication consistency should remain green, proving the committed object is current;
4. the new publication-path equality gate must go red, proving the receipt refuses a dirty desk;
5. generator and harness publication pairs must remain green.

This separates two valid questions:

- Is the committed artifact current?
- Is the receipt being generated from a clean publication worktree?

Both must pass; neither substitutes for the other.

## 6. M8 is a valid stale-content test, but not the exact historical object claimed

The rebuilt M8 starts from the current `36`-assertion artifact, sets `n_pass` to `33`, and removes one assertion. That leaves `35` assertion records, not the historical AR-529 `33`-assertion object.

Therefore the new M8 validly proves:

> committed stale content with `published_n_pass = 33` and the deployed-HEAD error string is detected.

It does not yet prove:

> the exact AR-529 stale artifact was replayed byte-for-byte or structurally.

Either narrow the caption and `WHAT_WAS_PLANTED`, or load the actual historical stale artifact/blob and assert:

```text
n_pass == 33
len(checks) == 33
n_fail == 0
error string present
```

This issue does not invalidate the committed-reader mechanism. It invalidates only the word **exact**.

## 7. Caption corrections still required

Several source captions still describe retired behavior:

1. `publication_consistency()` says it compares against the artifact “ON DISK” and “the file on disk,” although committed mode now reads through `git show HEAD:<path>`.
2. `stable_digest()` still says `PROVENANCE_SOURCE_CLOSURE` is stripped, although the closure is now canonicalized and included.
3. The `VOLATILE_EXCLUSIONS` explanatory text still groups `TREE / PROVENANCE_SOURCE_CLOSURE` as though both whole blocks are removed.
4. `PROVENANCE_RAW_closure_INCLUDING_generator_and_any_harness_is_clean` claims the raw closure includes the harness, but the harness is deliberately excluded from the measurement closure and checked separately.

These do not change the measured counts, but they are claims in a system whose governing rule is `A CAPTION IS A CLAIM`. Correct them in the same bounded patch.

## 8. Required final bounded patch

No measurement, engine, extraction, migration, deployed runtime, corpus, environment, or database change is authorized.

The remaining patch is limited to:

1. score publication-path cleanliness as an executable result before `all_ok`;
2. source receipt identities from the committed artifact;
3. add M12;
4. narrow or reconstruct M8's “exact historical shape” claim;
5. correct the four stale captions;
6. regenerate and publish the receipt;
7. request one final independent read.

Any movement in campaign metrics, identities, route partitions, population counts, closure membership, or deployed-scope results is a STOP.

## 9. `I8` state

AR-532 labels I8 as blocked on an operator extraction authorization. This external desk has not adopted that ownership transfer.

The controlling external state remains:

**`I8 NOT STARTED — WORKER DECLINE ACCEPTED; ADVISOR POPULATION-NAMING ACT HELD UNTIL I7 TECHNICAL CLOSURE.`**

No fresh untouched population is named, no fifth semantic-regex round is authorized, and `HOLDOUT-26` remains protected.

## 10. Position

- AR-532 committed artifact: **ACCEPTED**
- current artifact/generator/harness/receipt blobs: **INDEPENDENTLY CONFIRMED**
- publication sequence and three identities: **ACCEPTED**
- M8 committed stale-content detection: **ACCEPTED, WITH “EXACT SHAPE” CLAIM NARROWED**
- M8b fail-closed path test: **ACCEPTED**
- M9: **ACCEPTED**
- M10: **ACCEPTED**
- M11: **ACCEPTED**
- source-closure canonicalization and entry-point repairs: **ACCEPTED**
- publication-path `ALL_CLEAN` enforcement: **NOT EXECUTABLE / FALSE-GREEN**
- stale captions: **OPEN ADDITIVE DEFECTS**
- AR-532 “all seven delivered”: **SUBSTANTIALLY DELIVERED, NOT CERTIFICATION-COMPLETE**
- `I7`: **MEASUREMENT AND COMMITTED ARTIFACT SOUND · RECEIPT CLEAN-WORKTREE GATE INCOMPLETE — NOT CLOSED**
- `I8`: **NOT STARTED — HELD, NOT CLOSED**
- `I21`: **PARTIAL — BEHAVIORAL PARITY UNMEASURED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **UNAUTHORIZED**
- CI wiring: **DESK DEBT**
- Merge / deploy / release: **HOLD**

## Control rules

> `A BOOLEAN WRITTEN INTO A RECEIPT AFTER ALL_OK IS DECIDED IS A NOTE, NOT A GATE.`

> `COMMITTED-CONTENT CURRENTNESS AND WORKTREE CLEANLINESS ARE TWO DIFFERENT ASSERTIONS.`

> `A TEST THAT READS THE MUTATION IS VALID; A TEST THAT CALLS A 35-ROW OBJECT THE EXACT 33-ROW OBJECT IS OVERCAPTIONED.`

> `THE RECEIPT MUST REFUSE A DIRTY DESK EVEN WHEN THE COMMITTED OBJECT IS SOUND.`
