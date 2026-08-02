# AR-599 / AR-600 external GPT review — 2026-08-02

**Objects reviewed:** `46d6b7decd632567c3f4010278549daf7030fac6` and its caption-only child `8a40f8991e37fd48a3a7447bfed6065a319a9ba3`, in an isolated detached worktree.  
**External decision:** **REVISE; do not dispatch the independent grade.** AR-599 closes the two attacks it names, but the replacement still lets a load-bearing green control disappear while every shipped gate stays green.

This document is external advice only. It is neither a campaign ruling nor an independent grade.

## Evidence independently reproduced

On `8a40f899`, the clean controls are genuine:

- `run.mjs`: exit `0`, `GATE: PASS`.
- `red-proof.mjs`: exit `0`, control green, `31/31` registered classes red-proofed.
- `type-value-proof.mjs`: exit `0`, `15/15`.
- `emitted-freeze.mjs`: exit `0`.
- `module-tuple.mjs`: exit `0`.

The two AR-599 repairs also bite for their intended reasons:

- `PROTO_INJECT=own_extra_inside_anchor` exits `1`; the plant witness prints first, the unchanged broad anchor sees the second `TS2304`, and the join reports it as an `EXTRA diagnostic`.
- `PROTO_INJECT=membership_delete_guard` exits `1`; membership names `56(a)` as missing from the pinned expanded corpus.

Those are real repairs. The new finding is on a different population.

## New false green — the green controls have no membership oracle

`membership.mjs` derives `EXPECTED_EXPANDED_IDS` from the frozen pin's `CORPUS`. It does not derive or enforce the pin's `GREEN` identities. `run.mjs` only checks:

```text
green_admitted === green_total
```

Both operands come from the same mutable `GREEN` array. That proves all surviving controls were admitted; it does not prove the required controls survived.

I deleted only this row from the live corpus:

```text
G-src-implements-erased
```

The plant was checked first: the identity occurred zero times. Measured result:

```text
run.mjs              exit 0  green_admitted=7  green_total=7  GATE: PASS
red-proof.mjs        exit 0  CONTROL GREEN  31/31
type-value-proof.mjs exit 0  15/15
emitted-freeze.mjs   exit 0  member failures 0
module-tuple.mjs     exit 0
```

After restoring the exact row, `git diff` returned empty and the clean runner returned to exit `0` with the control present. The mutation therefore discriminates; it is not an always-red or dead-path result.

### Why this is load-bearing

`G-src-implements-erased` and `G-src-interface-extends-erased` were added because the earlier corpus had zero coverage for a real over-correction. Removing either recreates that structural blindness. Yet the current output simply changes `8/8` to `7/7` and calls it clean.

This is the same self-authorship class AR-599 correctly removed from the red population, still alive one array beside it:

> A mutable population cannot certify its own complete membership by counting only its surviving members.

The frozen `53e80935:corpus.mjs` pin already contains all eight green identities, including both heritage controls. No new authority is needed. The repair should derive and enforce a second frozen set from `expandedBaseline.GREEN`, with both-direction membership and uniqueness over the live `GREEN` array. It needs permanent deletion, addition, duplicate, and clean controls; deletion of `G-src-implements-erased` is the decisive regression fixture.

Do not combine red and green identities into one untyped set: the disposition is part of the contract. Moving an id from `GREEN` to `CORPUS`, or the reverse, must also fail.

## AR-600 pin disposition

The `46d6b7de..8a40f899` diff is exactly one description string in `red-proof.mjs`. It removes a stale reference to deleted `DECLARED_ADDITIONS`; no predicate, expected class, assertion, or exit path changes. Both objects are green.

If AR-599 had otherwise been gradeable, `8a40f899` would be the honest pin: a known-false caption should not be handed to a HUNT grader as if it were current. The new false green now requires another replacement object anyway. Build that replacement on top of `8a40f899`, retain the caption correction, and pin the resulting commit. There is no reason to grade either superseded object.

## Advice to the campaign desk

- Keep `P0PC` at **revision-required**; hold `P0PG` and the independent grade.
- Preserve the bijective diagnostic/anchor join and the frozen expanded red membership; both independently reproduced correctly.
- Extend the frozen membership contract to the `GREEN` population, preserving red-vs-green disposition.
- Red-proof deletion, addition, duplicate identity, and red/green migration. Re-run the two AR-599 attacks and a clean control on the single replacement object.
- Route AR-599's unwitnessed `AMBIGUOUS` branch, vanished-plant case, editable pin residual, and `runtime-admission.mjs` to the later independent hunt unchanged.

The V4 graph candidate remains **not adopted** and no graph node advances on these objects.
