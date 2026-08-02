# AR-606 / AR-607 external GPT review and V4 graph correction — 2026-08-02

**Objects read:** campaign `bfb54ede` (AR-607 plus its pin bump), `AR-606`, and ruling `R-569`.
**External decision:** **AR-607 is a sound partial for item (5); keep the worker serial order. Adopt graph engineering as two independent lanes, not as a three-worker repair diamond.**

This document is external advice only. It is neither a campaign ruling nor an independent grade.

## The graph-engineering result

The fake-edge test has now been run on the real file ownership, and it rejects the tempting repair fan-out:

```text
MONEY PATH (serial; shared implementation surfaces)

P0PC anchor
  -> (5) set-of-sets                         DONE at bfb54ede
  -> (2) F-3 substituted diagnostic
  -> (3) Proxy design/repair
  -> corpus additions + ONE pin dance
  -> combined clean/red battery
  -> ONE fresh accuracy-validator grade
  -> P0PG

INDEPENDENT DESK LANE (parallel; disjoint file ownership)

V4 candidate
  -> copy graph + validator + mutation suite
  -> make the epoch contract executable in the campaign tree
  -> clean validator GREEN
  -> P1/P2 re-entry mutations RED
  -> named adoption ruling with path + hash
```

AR-606 measured the hidden edges inside P0PC: three of four items converge on `membership.mjs`, two on `corpus.mjs`, and two on `run.mjs`. Those are real data/write dependencies. Isolated worktrees would prevent byte collisions but would not remove the semantic merge dependency; three parallel patches would merely move the serialization cost to integration and increase rework risk.

The safe concurrency is the one R-569 opened: the worker owns `prototypes/p0-vnext-admission/*`; the desk owns `scripts/*`, `docs/designs/*`, and its two relay files. Their artifact dependency is empty. Their hidden shared resource is the worktree index, so both lanes must use path-scoped commits and must not use `git add -A`, stash, checkout, reset, or amend.

**Expected speed effect:** this does not make the serial P0PC code repair itself faster. It removes the otherwise-idle 40–60 minute V4-adoption task from the critical path by running it beside P0PC. Any larger speed claim would be fabricated until durations are measured.

## AR-607 external read

The repair targets the right class. Before the fix, both enforcement populations could shrink while denominators shrank with them:

- deleting an `EXPECT` row could still report all surviving red proofs complete;
- deleting the `collection_shape` `FAILURE_CLASSES` row could remove the check and leave the gate green;
- the two deletions compose, retiring both the protection and its proof.

The shipped mechanism is materially stronger than another local count:

- expected table membership is read from a prior Git object;
- module-level collections are enumerated through the TypeScript AST, not regex;
- on `corpus.mjs`, the static enumerator is compared with the executable runtime enumerator on the same pinned blob;
- the check runs before and outside `FAILURE_CLASSES`, so deleting an entry from that table cannot downgrade this verdict;
- AR-607 preserves the result as `FAN-IN 1/4`, so the partial does not read as the whole batch.

I confirmed those mechanisms at the executable lines in `module-collections.mjs` and `run.mjs`. My attempted five-gate re-run exceeded a 120-second local command budget and produced no admissible result, so I do **not** independently certify AR-607's green table. Its execution claims remain worker measurements until the desk re-runs or grades them.

The artifact also states its honest residual: `PINNED_MODULE_COLLECTIONS` and `PINNED_BLOBS` cannot pin themselves. `COVERED_FILES` makes a single-entry shrink loud, but a coordinated edit to both declarations remains a review-time boundary. That is acceptable only as a named limit; it is not closure of all future self-authored collections.

## Exact V4 revision to adopt

The V4 plan should encode these rules, and the worker/advisor onboarding text should point to them after adoption:

1. Run the fake-edge test against **artifact reads, writes, and shared resources**, not prompt wording.
2. Parallelize only nodes with disjoint inputs/outputs or isolated outputs with a named integrator.
3. A shared implementation file is a hard edge unless a sole integrator owns all merging and semantic reconciliation.
4. Every node declares bounded job, input pins, structured output, owner, write surface, acceptance, stop behavior, and first observable.
5. Every fan-in counts expected versus received node receipts; partial input cannot synthesize a complete report.
6. Worker and verifier use fresh contexts. The verifier consumes artifacts, not worker chat.
7. Deterministic reducers run before model synthesis. One independent grade remains serial and reserved for the money path.
8. Mutable relay files are epoch evidence, not durable authority. Do not content-pin a relay in a topology that rewrites that relay; use an executable epoch/join contract.
9. A graph schedules nothing until the named adoption ruling records its path and hash.
10. Graph engineering buys width, not judgment. When the real graph is a chain, keep the chain.

## Advice to the main advisor now

- Receive AR-607 as item (5) complete **subject to the desk's own execution/grade**, not as P0PC completion.
- Let the worker continue the already-ratified serial order without a round trip.
- Continue the V4 adoption lane in parallel; do not spend the money-path grade slot on it.
- Do not create a second P0PC worker or a second watcher for either channel.
- When the four-item batch lands, require the combined battery on the one integrated object, then dispatch exactly one fresh `accuracy-validator` with a novel false-green hunt.

**Phase-1 truth remains unchanged:** this is prerequisite hardening. It does not complete the compiler and does not produce a trading-ready strategy. The Phase-1 breakthrough still requires P0 closure, the remaining deterministic compiler path, and one Tier-A spec passing the compile-fidelity exit gate.
