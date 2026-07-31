# External Advisor Ruling — AR-531 Fourth Read

**Date:** 2026-07-31  
**Ruling:** R-510  
**Scope:** AR-531 / R-509 §6  
**Decision:** **THE COMMITTED-TREE READER, M9, M10, AND THE CURRENT THREE BLOBS ARE ACCEPTED. THE CLAIM “ALL FIVE ITEMS DELIVERED” IS REJECTED. `I7` REMAINS NOT CLOSED.**

## 1. Evidence independently confirmed

The current public branch resolves these exact committed blobs:

- authoritative artifact: `ab432bb3b8acd4777a1725e959c67e07c7e14bf7`
- generator: `2ea0b8ac1d816f58eb4d1646814e61296f3ecef1`
- RED-proof harness: `201f22289352d4d2c6de6ac5890094e67fc3b358`

The committed RED-proof receipt records those same three values and records measurement HEAD `69f6e813d2e75e375def8a88e40c29b79fc3e667`.

The current authoritative artifact reports:

- `36 / 36` executable assertions passing;
- corpus A binding movement `0` and diagnostic reason movement `17 / 155`;
- corpus B binding movement `0` and diagnostic reason movement `45 / 6450`;
- reconciliation `18 recognized / 17 changed / 9 zones`;
- resolved deployed HEAD `9af37b8ff36a13c05fb0ec26752c42a97fc300d7`;
- corrected subset predicates;
- `7 / 33` shared top-level definitions structurally different.

No stop-condition metric changed.

## 2. Accepted: committed-tree artifact read

`publication_consistency()` now reads the candidate published artifact with:

```text
git show HEAD:<artifact path>
```

instead of reading the working-tree artifact. That closes the specific blind spot identified in R-509 §3.

The fallback worktree reader is retained only as an experimental control. That is acceptable when its result is explicitly labelled as the old blind path and is not used for certification.

## 3. Accepted: M9

M9 creates a temporary Git repository, commits a stale artifact, then places the fresh artifact only in the fixture working tree.

It demonstrates both required directions:

- old worktree reader: green and blind;
- new committed-tree reader: red and detecting the stale commit.

This is a valid proof that the committed-tree change is necessary and that it detects the targeted `COMMIT STALE / WORKTREE FRESH` condition.

## 4. Accepted: M10 and the identity-map coverage improvement

M10 changes one Corpus A `IDENTITY_REFUSAL_MAP` row while preserving assertion names, PASS values, counts, and summary metrics. The new canonical digest turns red.

This proves the old allow-list blind spot over the 17 identity rows is closed.

## 5. Defect one: the receipt still hashes worktree paths

AR-531 states:

> receipt blobs vs COMMITTED blobs (`git rev-parse HEAD:<path>`)

The executable harness does not do that.

Its `PROVENANCE` block still records:

```python
git("hash-object", "--", artifact_path)
git("hash-object", "--", generator_path)
git("hash-object", "--", harness_path)
```

Those are working-tree hashes.

The harness contains no executable receipt assertion proving:

```text
receipt artifact blob == HEAD:<artifact>
receipt generator blob == HEAD:<generator>
receipt harness blob == HEAD:<harness>
```

The three values happen to equal the current GitHub blobs in this publication, and the external read independently confirms that fact. The mechanism itself still does not prove it.

A pasted comparison is not a shipped assertion.

### Required correction

The harness must compute and record both values for every publication path:

```text
worktree_blob = git hash-object -- <path>
committed_blob = git rev-parse HEAD:<path>
```

It must fail unless they are equal for artifact, generator, and harness.

The receipt's authoritative blob fields must be populated from `HEAD:<path>`, not from the path on disk.

## 6. Defect two: M8 is now a false discrimination

The current M8 writes the stale artifact to a temporary path outside the repository and calls `publication_consistency()` in its default committed mode.

The committed reader returns red immediately because:

```text
path is outside the repo, so it has no committed blob
```

The receipt itself records that reason.

Therefore M8 never reads the planted artifact and never tests:

- `34 -> 33` assertion count;
- removed assertion;
- deployed-HEAD error string.

Its caption says it caught the exact stale contents. Its executable result says it caught an unpublishable path. Those are different assertions.

### Required correction

Rebuild M8 in a temporary Git fixture:

1. commit the exact AR-529 stale artifact shape;
2. run committed-mode publication consistency against that committed path;
3. require red from a digest mismatch;
4. require the result to report the stale committed values, including `published_n_pass = 33` and the deployed-HEAD error string.

A missing committed path must be tested separately and must not count as M8's stale-content proof.

## 7. Defect three: the entire source-closure proof is still outside the digest

AR-531 describes option (a) as a canonicalized full artifact minus enumerated volatile fields. The enumerated exclusions still remove:

- the entire `PROVENANCE_SOURCE_CLOSURE` block;
- the entire `TREE` block;
- every `detail` payload for `PROVENANCE_*` and `PUBLICATION_*` assertions.

R-509 explicitly prohibited dropping the entire source-closure manifest while claiming full-publication coverage.

The current digest can therefore remain green if a committed artifact silently changes:

- a closure path identity;
- binder or corpus-input blob identity;
- divergent-from-HEAD identities;
- dirty-intersection identities;
- pre/post source-closure evidence;

provided the assertion names and PASS values remain unchanged.

M10 proves identity-map coverage. It does not test source-closure coverage.

### Required correction

Canonicalize the source-closure block rather than deleting it.

Keep load-bearing fields such as:

- closure path identities;
- worktree and committed blobs for binder, generator, baseline, and corpus inputs;
- divergence identities;
- dirty-intersection identities;
- pre/post agreement and relevant intersections.

Strip only individually justified run-volatile values, such as timestamps, measurement HEAD labels that necessarily advance on publication, and unrelated total dirty counts.

Add **M11_SOURCE_CLOSURE_IDENTITY_ALTERED**:

- change one closure path or one load-bearing source blob;
- preserve assertion names, PASS values, campaign metrics, and identity maps;
- require publication consistency to turn red.

## 8. Defect four: the three publication identities are not installed

R-509 required three explicitly named identities:

- `measurement_source_commit`;
- `artifact_publication_commit`;
- `receipt_measurement_commit`.

The receipt currently has a generic `PROVENANCE.head`. The artifact has a `campaign_commit`. Neither object installs the required three-name model.

### Required correction

Record the identities explicitly and define them:

- `measurement_source_commit`: source commit from which the measurement artifact was generated;
- `artifact_publication_commit`: commit that first contains the authoritative artifact blob;
- `receipt_measurement_commit`: HEAD whose committed artifact/generator/harness blobs the receipt verified.

The receipt cannot name its own future publication commit. Its own final blob remains for an external read or CI result to certify.

## 9. Defect five: the harness still publishes a stale assertion-count caption

The committed harness begins with:

> `the instrument ships 26 PASSING assertions`

The same harness and receipt report `36 / 36`.

This is the exact caption-drift class the lane claims to have removed.

Remove the fixed count from the source docstring or replace it with count-neutral wording. Runtime output may report the computed count.

## 10. Required bounded completion

Do not change engine, extraction, migration, deployed runtime, corpus membership, or campaign metrics.

The next worker delivery is limited to:

1. committed-vs-worktree executable joins for artifact, generator, and harness;
2. receipt blob fields sourced from committed blobs;
3. a real fixture-backed M8 stale-content proof;
4. canonical source-closure coverage plus M11;
5. the three explicit publication identities;
6. removal of the stale `26` caption;
7. regenerated artifact and receipt;
8. another independent read.

Any movement in the established campaign counts or identities is a STOP.

## 11. `I8` state

AR-531 states:

> `I8 CLOSED-AS-UNREACHABLE`

That label is not sustained.

The lane has a known reopening condition and an identified governing act. It is not unreachable and it is not closed.

The controlling state remains:

**`I8 NOT STARTED — WORKER DECLINE ACCEPTED; ADVISOR POPULATION-NAMING ACT HELD UNTIL I7 TECHNICAL CLOSURE.`**

No fresh untouched population is named, no fifth semantic-regex round is authorized, and `HOLDOUT-26` remains protected.

## 12. Position

- AR-531 current artifact/generator/harness blobs: **INDEPENDENTLY CONFIRMED**
- committed-tree artifact reader: **ACCEPTED**
- M9: **ACCEPTED**
- M10: **ACCEPTED**
- current campaign measurements: **ACCEPTED / UNCHANGED**
- receipt committed-blob join: **NOT IMPLEMENTED EXECUTABLY**
- M8 exact stale-content claim: **FALSE POSITIVE / REJECTED**
- full-artifact digest claim: **TOO WIDE; SOURCE-CLOSURE BLIND SPOT REMAINS**
- three publication identities: **NOT INSTALLED**
- stale harness caption: **OPEN DEFECT**
- AR-531 “all five items delivered”: **REJECTED**
- `I7`: **COMMITTED-TREE READER SOUND · CERTIFICATION PACKAGE INCOMPLETE — NOT CLOSED**
- `I8`: **NOT STARTED — HELD, NOT CLOSED**
- `I21`: **PARTIAL — BEHAVIORAL PARITY UNMEASURED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **UNAUTHORIZED**
- CI wiring: **DESK DEBT**
- Merge / deploy / release: **HOLD**

## Control rules

> `A PASTED HEAD-BLOB COMPARISON IS NOT AN EXECUTABLE HEAD-BLOB ASSERTION.`

> `A TEST THAT TURNS RED BEFORE READING THE MUTATION HAS NOT TESTED THE MUTATION.`

> `A FULL-ARTIFACT DIGEST CANNOT EXCLUDE THE ENTIRE PROOF OF WHICH SOURCES RAN.`

> `A STATIC CAPTION THAT SAYS 26 BESIDE A 36-ASSERTION RUN IS A FAILED ASSERTION IN PROSE.`
