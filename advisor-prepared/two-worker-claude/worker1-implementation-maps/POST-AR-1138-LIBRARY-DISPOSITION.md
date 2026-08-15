# Worker 1 Ready-to-Edit Map — Post-AR-1138 Library Disposition

## Gate
Do not execute until ONE real strategy has passed Graph closure + Compiler vertical + Strategy Factory vertical under GPT review.

## Owner
Worker 1 / COMPILER-FACTORY only.

## Goal
Run the real strategy library through the proven production compile/factory path and produce an honest disposition ledger:

`COMPILED | REFUSED(reason_code, evidence)`

This is a census, not a repair marathon.

## First move
1. Pin the proven vertical SHA and executable/refusal contract.
2. Enumerate the canonical strategy library exactly once.
3. Run each candidate through the SAME production path and configuration.
4. Save deterministic per-strategy disposition + refusal reason + source/provenance identifier.

## Rules
- no hand edits to make a row pass;
- no retry hunting until one extraction happens to compile;
- no midpoint/default parameter invention;
- no silent dropping of unsupported conditions;
- same input + same code => same disposition;
- compiled means factory-executable under the proven contract, not merely schema-valid;
- refused is a valid safe outcome.

## Required controls
- exact library count before and after;
- no missing/duplicate strategy IDs;
- deterministic rerun sample;
- one known-compiled positive control;
- one intentionally unsupported negative control;
- refusal reason counts sum exactly to total refused.

## Output
Machine-readable ledger plus short summary:
- total candidates;
- compiled;
- refused;
- top refusal reason codes;
- any new refusal class not seen in the one-strategy vertical;
- hash/SHA of code and library snapshot.

## Stop conditions
STOP and report if:
- a previously proven compiled fixture now refuses;
- output depends on iteration/declaration order;
- same input changes disposition across reruns;
- a strategy compiles only by approximation not authorized by source;
- library count does not conserve.

## Forbidden detours
Do not repair every refusal during this census. Do not start Context Observer, qualification, PAPER, or broker work. New common blockers become separate bounded packets after GPT grades the census.

## Completion receipt
Pinned SHA/library hash; exact command; counts; controls; ledger path/hash; commit/push if code changed; STOP GPT.