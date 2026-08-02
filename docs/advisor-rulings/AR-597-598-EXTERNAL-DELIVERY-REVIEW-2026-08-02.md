# AR-597 / AR-598 external GPT review — 2026-08-02

**Object reviewed:** `53e809356791707bf08feea4c000d291d753801e`, detached from the campaign worktree.  
**External decision:** **REVISE; do not spend the independent grade yet.** The founding ownership and original-52 rename attacks are closed, but the expanded corpus can still silently shrink. R-557 separately proves the same-code/inside-anchor ownership false green; this review adds a different membership false green.

This document is external advice only. It is neither a campaign ruling nor an independent grade.

## Evidence reproduced

On the exact object, all five shipped gates are genuinely green:

- `run.mjs`: exit `0`, expanded corpus `64`, original partition `44 + 3 + 0 + 0 + 5 + 0 = 52`.
- `red-proof.mjs`: exit `0`, control green and `29/29` registered classes red.
- `type-value-proof.mjs`: exit `0`, `15/15`.
- `emitted-freeze.mjs`: exit `0`, `39` expected source rows compared.
- `module-tuple.mjs`: exit `0`.

The two R-548 founding attacks now fail for the intended reasons: unrelated diagnostics no longer buy credit, and renaming an original member names both the missing and undeclared identities. Those repairs are real.

## New false green — declared additions may disappear

The membership function computes this field:

```text
declared_but_absent = DECLARED_ADDITIONS absent from the live corpus
```

But `run.mjs:444-449` fails the membership class only for `missing`, `undeclared`, or `duplicated`. It never consumes `declared_but_absent`.

I changed the existing `membership_delete` mutation target from original row `38` to declared post-baseline guard row `56(a)`, leaving the original 52 and every expectation unchanged. Measured result:

```text
expanded total: 64 -> 63
original partition: still sums to 52
missing_ids: []
undeclared_ids: []
duplicate_ids: []
declared_but_absent: ["56(a)"]
GATE: PASS
DIRECT_EXIT=0
```

The clean control returned to exit `0` after restoring the one-line test mutation, and the detached tree returned clean. This is discriminating evidence, not an always-red instrument.

### Why it matters

Rows `56(a)`–`56(d)` and `57` are the guards added for the grader's module-edge and heritage findings. The gate now protects the historical 52 while allowing one of those new guards to vanish silently. Item 15 therefore closes identity drift only for the old population, not for the corpus it currently reports as `64 rows`.

Simply adding `declared_but_absent` to `FAILURE_CLASSES` closes the demonstrated deletion when the declaration remains. It does not close coordinated deletion of both the row and its declaration, because `DECLARED_ADDITIONS` is mutable code in the same delivery. The durable property is an independently pinned expanded-membership artifact. A repair commit can derive the expected expanded identities from the already-committed `53e80935` object and check both directions plus uniqueness; it must include a deletion of a declared addition as a permanent red-proof.

## AR-598 / R-557

AR-598 correctly identified anchor slack as a hypothesis. R-557 executed it: renaming the `34(d-u)` parameter creates an extra same-code `TS2304` inside the broad declared expression, both diagnostics receive the same credit, and the gate exits `0`. That is a separate live false green from the expanded-membership deletion above. Both must be repaired in the same replacement object before grade dispatch.

## Advice to the campaign desk

- Keep `P0PC` at **delivered-but-revision-required**, not delivered-pending-grade.
- Hold the one independent grade channel.
- Repair same-code diagnostic multiplicity/identity without making the observed diagnostic span the self-authored oracle.
- Pin and enforce the complete expanded corpus membership, including the post-AR-589 guard additions; red-proof deletion of `56(a)` with the original 52 unchanged.
- Re-run the original two attacks, the R-557 anchor-slack attack, this declared-addition deletion, and a clean control on the single replacement object.
- Keep `runtime-admission.mjs` in the later independent hunt; it remains ungraded.

The V4 graph candidate remains **not adopted** and no graph node advances on this object.
