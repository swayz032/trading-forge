# Worker 1 Ready-to-Edit Map — Post-AR-1138 Compiler Vertical

## Gate
AR-1138 GPT PASS first. Graph closure for the accepted strategy must be green or proven already sufficient.

## Owner
Worker 1 / COMPILER-FACTORY only.

## Goal
Prove ONE real accepted source strategy lowers deterministically from the canonical graph/AR-1138 artifact into the production compiler representation without changing source meaning.

## Source of truth
- accepted AR-1138 commit and its actual changed files/tests;
- existing DecisionAtom/canonical graph output;
- production compiler path reached by the accepted AR-1138 tests;
- pinned source/transcript evidence, not paraphrased `action` text.

Do not guess a compiler filename from this card. AR-1138's accepted trace determines the real production seam.

## First move
1. Start from accepted AR-1138 SHA.
2. Re-run the narrow accepted production-path compiler test.
3. Trace ONE strategy only from graph/artifact input to compiler output/refusal.
4. Freeze the input artifact bytes/hash and output/refusal reason.

## Required RED witnesses
At least one real control must prove the compiler refuses or changes outcome when:
- a required source decision is removed;
- an unsupported/ambiguous term is introduced;
- a required parameter/geometry is missing;
- source evidence conflicts with paraphrase;
- a dependency/order edge is mutated.

## PASS contract
Successful compile must conserve:
- side/direction authority;
- timing/session semantics;
- ordered entry sequence;
- required conditions/confluence;
- invalidation;
- source-owned exit semantics;
- numeric parameters actually grounded by source;
- provenance back to source evidence.

Unsupported or ambiguous meaning => exact refusal. No midpoint/default guessing, retry hunting, or silent approximation.

## Forbidden detours
- no Strategy Factory batch work yet;
- no context/qualification/PAPER/runtime work;
- no source JSON hand edits;
- no sanitizer/default repair that changes source semantics;
- no broad vocabulary expansion unless the accepted strategy's RED requires it.

## GREEN
Focused production-path compiler test + relevant compiler regression suite named by AR-1138. Preserve byte/determinism control where available.

## Mutation control
Change one source-authoritative fact or compiler binding and prove output/refusal changes or test fails.

## Expected touched-file boundary
Prefer the exact compiler seam + focused tests/fixtures only. If more than one subsystem needs redesign, STOP and publish the measured blocker.

## Completion receipt
Starting SHA; exact production path; frozen input hash; RED; minimal repair; GREEN; mutation; output/refusal artifact hash; commit/push; known limit; STOP GPT.