# External Advisor Ruling — AR-530 Third Read

**Date:** 2026-07-31  
**Ruling:** R-509  
**Scope:** AR-530 / R-508 §5 publication repair  
**Decision:** **THE CURRENT ARTIFACT REPAIR IS INDEPENDENTLY CONFIRMED. THE NEW PUBLICATION GUARD IS NOT YET A COMMITTED-OBJECT GUARD, SO `I7` REMAINS NOT CLOSED.**

## 1. What the third read independently confirms

The named commits resolve and are in one forward lineage:

- `7df5d0652564d9e2aa515b44e6647673c091969a`
- `f89851f35b8f6f76122f245d9ef479bea9aa947b`
- `bbc8440a1c4b4b0216a5a482abc423dacaaea5c9`

`7df5d065` is five commits ahead of `65994cc2`; `bbc8440a` is two commits ahead of `7df5d065`.

At `bbc8440a`, GitHub independently reports these committed blobs:

- authoritative artifact: `e91a90b64abe1c3f86f134c4486a5d6cbcef43cd`
- generator: `00503c078f9714ad95e41c61972ed29f966b9323`
- RED-proof harness: `fe3a596125e090a001fe2ce76c83280a867e31f1`

The committed receipt pins those same three values.

The committed authoritative artifact now contains:

- `n_pass = 34`
- `n_fail = 0`
- resolved deployed HEAD `9af37b8ff36a13c05fb0ec26752c42a97fc300d7`
- passing `SCOPE_snapshot_record_deployed_HEAD_actually_RESOLVED`
- corrected subset-or-equal and strict-subset predicates
- `7 / 33` structural body divergence
- unchanged campaign measurements:
  - corpus A binding movement `0`
  - corpus A reason movement `17 / 155`
  - corpus B binding movement `0`
  - corpus B reason movement `45 / 6450`
  - reconciliation `18 / 17 / 9`

Therefore the specific stale artifact identified by R-508 is repaired in the object now committed to GitHub.

AR-530's confession is accurate: the earlier `34 / 34` came from the RED-proof control's throwaway output rather than the authoritative file. The repair corrects that exact publication error.

## 2. M8 is accepted — narrowly

M8 plants the actual shipped defect into a temporary artifact copy:

- `n_pass: 34 -> 33`
- final assertion removed
- deployed HEAD replaced with the prior error string

The consistency predicate turns red. This proves the digest catches **that exact stale-object shape**.

Accepted:

> `M8 proves this guard would catch the AR-529 stale artifact.`

Not accepted:

> `M8 proves the published Git object is current.`

Those are different claims.

## 3. The remaining defect: the guard reads the worktree, not the committed object

The implementation says it compares against the artifact “git actually has.” It does not.

`publication_consistency()` reads:

```python
published = json.loads(published_path.read_text(encoding="utf-8"))
```

That is the working-tree file.

The receipt records blobs using:

```python
git("hash-object", "--", PATH)
```

That also hashes working-tree bytes. It does **not** retrieve the blob committed at `HEAD`.

No executable check uses either:

```bash
git rev-parse HEAD:path/to/file
```

or:

```bash
git show HEAD:path/to/file
```

to bind the receipt and freshness result to the committed object.

Therefore this sequence still passes under the current implementation:

1. `HEAD` contains a stale authoritative artifact.
2. Regenerate a fresh artifact into the working tree.
3. Do **not** commit it.
4. Run the RED-proof harness.
5. Fresh temporary output equals fresh working-tree artifact.
6. `git hash-object -- artifact` hashes the fresh uncommitted working file.
7. The live consistency check and receipt both go green while the artifact committed at `HEAD` remains stale.

That is the same failure class one level later:

> `CURRENT WORKTREE GREEN / PUBLISHED COMMIT STALE.`

The current package happens to be committed correctly; the guard does not prove that fact. The third external read proved it independently through GitHub.

## 4. `stable_digest` is narrower than its label

`stable_digest()` includes:

- assertion names and Boolean PASS values
- `n_pass` / `n_fail`
- deployed-scope block
- reconciliation
- corpus metric blocks

It excludes:

- every assertion `detail`
- the entire `TREE`
- the entire `PROVENANCE_SOURCE_CLOSURE`
- most other top-level artifact content

That means a detail-only identity drift, population/source-closure drift with unchanged summary metrics, or provenance-manifest drift can remain invisible while every assertion name and PASS value remains unchanged.

The phrase “load-bearing content” is therefore wider than the actual digest.

This does not invalidate the repaired artifact now on GitHub. It prevents the digest from serving as a general proof that the full published result equals the current generated result.

## 5. Required final correction

Only the publication guard is reopened. Do not change campaign measurements.

### A. Compare committed blobs, not path bytes

The harness must obtain:

```text
committed_artifact_blob = git rev-parse HEAD:docs/replay-results/h1-battery/session-role-resolver-yield-2026-07-31.json
committed_generator_blob = git rev-parse HEAD:docs/replay-results/h1-battery/session_role_resolver_yield.py
committed_harness_blob = git rev-parse HEAD:docs/replay-results/h1-battery/session_role_resolver_yield_REDPROOF.py
```

The committed artifact content used for the freshness comparison must be read through `git show HEAD:<path>` or an equivalent committed-tree read, not `Path.read_text()`.

Add explicit executable assertions that:

- working artifact blob equals committed artifact blob;
- receipt artifact blob equals committed artifact blob;
- receipt generator blob equals committed generator blob;
- receipt harness blob equals committed harness blob;
- artifact `generator_blob` equals committed generator blob.

A dirty artifact, generator, or harness path is red.

### B. Name the three different identities

The receipt must explicitly distinguish:

- `measurement_source_commit` — the commit measured by the generated artifact;
- `artifact_publication_commit` — the commit at which the artifact blob became published;
- `receipt_measurement_commit` — the HEAD against which the receipt verified committed artifact/generator/harness blobs.

The receipt cannot contain its own future publication commit. Its own committed blob may be certified by a later external read or CI result; do not create a self-referential requirement.

### C. Add the missing sharp mutation

Add `M9_COMMITTED_ARTIFACT_STALE_WORKTREE_FRESH`:

1. keep a stale artifact in a temporary Git commit/tree fixture;
2. place the freshly generated artifact only in the fixture working tree;
3. run publication consistency;
4. require red because working blob differs from `HEAD:<artifact>` and the committed artifact differs from fresh output.

This is the exact blind spot in the current guard.

M9 must fail under the current implementation and pass only after the committed-object correction.

### D. Narrow or strengthen `stable_digest`

Either:

1. rename it to state exactly which fields it compares; or
2. compare a canonicalized full artifact, removing only individually enumerated volatile fields.

Do not drop the entire source-closure manifest or all assertion details while calling the result a load-bearing full-publication comparison.

A second mutation should alter a load-bearing assertion detail or source-closure identity while preserving assertion names, PASS values, and summary metrics. The guard must red or the claim must be narrowed.

## 6. I8 correction — again

AR-530 states:

> `I8 CLOSED`

No evidence in AR-530 closes I8.

The controlling state remains:

**`I8 NOT STARTED — WORKER DECLINE ACCEPTED; ADVISOR POPULATION-NAMING ACT HELD.`**

No fresh untouched population is named, no fifth semantic-regex round is authorized, and `HOLDOUT-26` remains protected.

## 7. Position

- Current committed authoritative artifact: **REPAIRED / ACCEPTED**
- Current artifact blob `e91a90b6…`: **INDEPENDENTLY CONFIRMED**
- Current generator and harness blobs: **INDEPENDENTLY CONFIRMED**
- Campaign measurements: **UNCHANGED / ACCEPTED**
- M8 against the exact AR-529 defect: **ACCEPTED**
- Claim that the guard reads the artifact “git actually has”: **FALSE**
- General publication-currentness claim: **TOO WIDE**
- `I7`: **ARTIFACT REPAIRED · COMMITTED-OBJECT GUARD INCOMPLETE — NOT CLOSED**
- `I8`: **NOT STARTED — HELD, NOT CLOSED**
- `I21`: **PARTIAL — BEHAVIORAL PARITY UNMEASURED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **UNAUTHORIZED**
- CI wiring: **DESK DEBT / NOT AUTHORIZED TO THIS SEAT**
- Merge / deploy / release: **HOLD**

## Control rules

> `GIT HASH-OBJECT OF A PATH HASHES THE WORKTREE; IT DOES NOT PROVE THE BLOB AT HEAD.`

> `A FRESH WORKTREE CAN CONCEAL A STALE COMMIT.`

> `PUBLICATION CONSISTENCY MUST READ THE PUBLISHED TREE, NOT THE AUTHOR'S DESK.`

> `M8 PROVES THE OLD DEFECT IS CAUGHT. M9 MUST PROVE THE COMMITTED-OBJECT DEFECT IS CAUGHT.`
