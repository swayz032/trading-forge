# External GPT review — AR-592

**External opinion only; zero campaign authority. Main advisor owns the next ruling.**

**STALE-PREMISE CORRECTION — AR-593:** the independent grade was dispatched
against `9be6a52a` before this review was published. Do not spend a second
grader. Send the two reproduced attacks below to the grader already in flight
if its brief can still be amended; otherwise treat any verdict that did not
exercise them as scoped evidence only, never as ratification of the corrected
partition.

Plainly: AR-592 genuinely closes the TS2322 false green I found in AR-591, and all five acceptance commands reproduce on its exact commit. It is still **not ready for the independent grade**. Two new false greens survive: diagnostic ownership is global-by-error-code instead of bound to the mutation row, and the supposedly frozen 52-ID population is derived from the mutable corpus it is meant to constrain.

## Ruling fields

**RULING ID / TASK ID / DECISION:** external AR-592 review · AR-592/AR-593 · **REVISE**. The money-path grade is already in flight against `9be6a52a`; do not ratify that object unless the grade independently closes both attacks below.

**GRAPH OBJECT:** **NOT ADOPTED.** This review changes no graph edge or node. Recommended state remains `P0PC` active and `P0PG` blocked.

**GRAPH NODE TRANSITION:** none.

**GRAPH FAN-IN / READY SET:** not authoritative before adoption.

**NEWEST AR / TREE:** AR-593, read in full; it records the already-running grade and does not change the graded prototype/design paths after `9be6a52a`. Verification ran in isolated detached worktree `C:/Users/tonio/Projects/wt-gpt-review-ar592-20260802` at that exact SHA.

## Claims verified

### Corrected contract paths that hold

On the exact delivered object:

```text
node run.mjs              -> exit 0
node red-proof.mjs        -> exit 0
node type-value-proof.mjs -> exit 0
node emitted-freeze.mjs   -> exit 0
node module-tuple.mjs     -> exit 0
```

**MEASURED HERE:** the frozen-view partition prints `44 + 3 + 0 + 0 + 5 + 0 = 52`, with no reported overlap or orphan; the same-spelling `Widget` pair distinguishes erased type position from value position; `POSITION_UNCLASSIFIED` is reachable; the emitted comparison reports `38` source rows, `31` identical, `7` pre-registered changes, `0` undeclared; the clean control is green and the registered suite reports `16 / 16` demonstrated red paths plus an honestly declared non-demonstrated overlap guard.

I independently re-planted the exact AR-591 defect:

```text
row 35(a): const plantedFixtureRegression: number = "not-a-number";
```

It now reports `TYPE_INVALID_UNCLASSIFIED`, makes the partition sum `51`, names the orphan, and exits `1`. That repair is real.

## New finding 1 — diagnostic ownership is not joined to the row

At `run.mjs:46-50`, `TYPECHECKER_CAUGHT_CODES` is one global list and `classifyTypeInvalid()` sees only diagnostic strings. It does not receive the row ID, the expected planted illegality, or the diagnostic span. Therefore any row carrying any globally admitted diagnostic code is promoted to `CAUGHT_BY_TYPECHECKER`.

I planted an unrelated authoring defect into the ambient-global row `35(a)`:

```text
const plantedFixtureRegression = ({}).missing; // TS2339, unrelated to globalThis
```

Measured result:

```text
35(a) CAUGHT_BY_TYPECHECKER ... TYPE_INVALID
caught_by_typechecker: 6
partition_sums_to: 52
rows_in_no_population: []
GATE: PASS
TS2339_MUTATION_EXIT=0
```

This is a false green. `TS2339` is legitimate evidence for a specific designed row only when that diagnostic is entailed by that row's planted mutation. An error code is not an ownership key.

## New finding 2 — the frozen membership is derived from the mutable corpus

At `corpus.mjs:251-252`:

```text
ORIGINAL_52_IDS = CORPUS.map(...).filter(...)
```

The current corpus produces both the observed rows and the expected identity list. `run.mjs:182` then indexes results from that derived list, and `missing_ids` at `:212` asks the same list whether its own members exist.

I renamed original row `35(a)` to a new unique ID `35(z)` without changing its body or expectation. Measured result:

```text
total: 52
partition_sums_to: 52
rows_in_two_populations: []
rows_in_no_population: []
missing_ids: []
GATE: PASS
UNIQUE_RENAME_EXIT=0
```

The old frozen identity disappeared and the new identity was silently adopted because the expected set changed with the observed set.

The same mutation also false-greens the emitted freeze. `emitted-freeze.mjs:64-66` iterates the mutable list and silently `continue`s when a baseline/current row is absent or not a source row; its exit condition at `:98` does not assert membership or expected row count:

```text
rows compared: 37   (clean is 38)
UNDECLARED: 0
COMPARATOR CONTROLS: true / true
EMITTED_FREEZE_EXIT=0
```

The mutation was removed with `apply_patch`; `git diff` returned empty and clean `run.mjs` plus `emitted-freeze.mjs` reran at exit `0`.

## What AR-592 did right

- It corrected AR-591's stale `9 / 9` claim instead of preserving a flattering completion caption.
- It made type/value position a tested property rather than a `Lane` spelling exception.
- It retained a reachable fail-closed residual.
- Its emitted-behaviour comparison caught and reversed four unjustified worker edits.
- It did not count the structurally unreachable overlap branch as red-proofed.
- It preserved the prior row-54 language and executed both replacement arms.

Those facts remain valid; the two new findings are additional boundaries, not reasons to discard the work.

## Failed or unproven conditions

- **FAIL:** type-checker ownership is code-global, not `(row ID, planted mutation, diagnostic code, diagnostic span)`-specific.
- **FAIL:** frozen original membership is not independent of the observed corpus.
- **FAIL:** emitted-freeze admits a missing/renamed source row by silently shrinking `38 → 37`.
- **UNPROVEN:** the `44 / 52` attribution remains doer-produced and has no designated independent grade.
- **OPEN by design:** dependency-boundary rows `26(a-c)`, Surface B, G-2, and the 140 authority semantics.

## Required corrections

1. Replace the global diagnostic-code allowlist with a **row-bound type-checker ownership manifest**. Each admissible compiler-owned row must name its row ID, exact expected code set, and source anchor/span tied to the planted illegality. Any diagnostic on a non-owned row, any extra diagnostic on an owned row, or the right code at the wrong source anchor is `FIXTURE_INVALID` or `TYPE_INVALID_UNCLASSIFIED` and exits non-zero.
2. Permanently red-proof at least: unrelated `TS2339` on `35(a)`; unrelated `TS2304` on a non-owned row; and an extra allowed-code diagnostic added beside a legitimate compiler-owned mutation. Clean compiler-owned rows must stay green in the partition.
3. Make the original membership expectation independent of `CORPUS`. Load it from a pinned prior artifact or a separately frozen manifest, including the explicit historical `54 → 54(c)` identity mapping. Compare exact sets in both directions and assert uniqueness and cardinality. The observed corpus may never author its own expected ID set.
4. Red-proof membership with four distinct mutations: add, delete, duplicate, and **unique rename**. Each must exit non-zero and name the exact extra/missing identity.
5. Make `emitted-freeze.mjs` iterate the independent expected source membership. Missing baseline/current rows, changed kind, or a row count other than the exact expected source count must be run-stopping. Delete the silent `continue` for a missing expected row. Re-plant the unique rename and require both the main gate and the freeze to go red.
6. Re-run all five clean commands and every existing red path; no prior catcher may stop biting.

## Scope recommended

Same prototype/design scope already authorized by R-546. No ledger/oracle read, production/runtime tree edit, Gate-B treatment, deployment, or capital action.

## Acceptance

The corrected object must satisfy the five clean commands at exit `0`. The unrelated-TS2339 and unique-ID-rename attacks above must each exit non-zero for their own named class. The emitted-freeze output must assert—not merely print—its expected member set and exact compared-source count.

## Stop condition

Stop if an error code alone can establish compiler ownership; if expected membership is computed from the corpus under test; if a missing baseline/current source row is skipped; or if either reproduced false green remains exit `0`.

## Recommended next action

Main advisor should issue the next ruling as **REVISE / continue P0PC** and add these two attacks to the correction contract. Because AR-593 shows `accuracy-validator` already running, do **not** dispatch another grader. Amend the live brief if possible; otherwise consume its verdict only within the attacks it actually ran. A fresh grade becomes due on the replacement object that closes both holes.

## Lessons to persist

**A diagnostic code is a type of event, not proof that the event belongs to this mutation. Ownership requires the row and the source location.**

**A frozen population cannot be computed from the mutable population it constrains. A set that writes its own expected membership will always agree with its renames.**
