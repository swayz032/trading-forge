# Worker 1 Ready-to-Edit Map — Post-AR-1138 Graph Closure

## Gate
DO NOT EXECUTE before AR-1138 is completed, pushed, reported, and independently accepted by GPT.

## Owner
Worker 1 / COMPILER-FACTORY only.

## Goal
Take the exact AR-1138 accepted source strategy and prove its source decisions are represented by the EXISTING Graph Engineering backbone with conserved provenance, dependencies, ordering, state transitions, invalidations, entry requirements, and source exits.

## Canonical prior art — reuse, do not replace
- `src/server/lib/decision-atom.ts`
- `docs/designs/decision-atom-v1.1.md`
- `scripts/atomize-transcript.ts`
- `src/server/lib/__tests__/conservation-ledgers.test.ts`
- the actual files/fixtures touched by the accepted AR-1138 commit

## First move
1. Checkout the accepted AR-1138 commit/worktree.
2. Read ONLY the accepted AR-1138 changed files + the four canonical prior-art surfaces above.
3. Identify the exact graph/closure object AR-1138 already feeds or should feed.
4. Add ONE RED fixture proving a source-authoritative AR-1138 fact is lost, reordered, strengthened, weakened, or unrepresented if the gap still exists.

If no gap exists, do not create a cosmetic change. Publish a proof receipt and move to the compiler vertical map.

## Required RED witness
A mutation or removal of one required AR-1138 decision/dependency must make graph closure/conservation fail.

Examples of valid failure classes:
- source quote/decision disappears;
- dependency edge disappears;
- ordering changes;
- invalidation is omitted;
- source exit is not conserved;
- unsupported geometry is silently invented.

## Smallest repair
Extend the existing DecisionAtom / canonical decision graph / conservation-ledger path only as needed for the accepted AR-1138 strategy.

## Forbidden detours
- no second graph representation;
- no new generic ontology unless the RED proves the existing backbone cannot represent the fact;
- no Context Observer, qualification, PAPER, broker, or runtime changes;
- no hand-editing extracted strategy JSON to make the test pass;
- no inferred short geometry from `direction=both` without source authority;
- no prose paraphrase overriding pinned transcript/source evidence.

## GREEN
Run the focused graph/conservation tests identified by AR-1138 plus the existing conservation-ledger suite. Then run the compiler-focused regression lane required by the accepted AR-1138 packet.

## Mutation control
Delete or alter one conserved decision/dependency and prove the focused test turns RED.

## Expected touched-file boundary
Prefer:
- one existing graph/atom/closure production file if a real gap exists;
- one focused test/fixture;
- no schema or migration.

Any broader architectural change => STOP and report why existing backbone is insufficient.

## Completion receipt
Return: starting SHA, exact source fact tested, RED command/result, changed files, GREEN command/result, mutation witness, commit SHA, push proof, known limit, STOP for GPT.