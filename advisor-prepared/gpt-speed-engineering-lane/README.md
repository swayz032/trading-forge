# GPT Three Speeds — Engineering Tooling

This directory is the implementation lane for **Coding Loop Speed** and **Machine / CI Speed**.
It does not own trading semantics, compiler meaning, PAPER decisions, or broker execution.

## Robustness law

A speed change is valid only when it preserves or strengthens failure detection. No speedup may come from skipping a required test, hiding a failure, weakening fail-closed behavior, or crossing Worker 1/2 ownership.

## Tools

### changed-test-selector.mjs
Given changed repository paths, returns the smallest safe first test set it can prove. If it cannot prove a focused mapping, it deliberately escalates to full-fleet/full-CI instead of guessing.

Example:
`node changed-test-selector.mjs src/server/services/fill-reconciliation-service.ts`

### evidence-receipt.mjs
Turns structured worker evidence into the short GPT receipt format. It fails closed when required proof is missing, requires `pushed=true` and `stopped_for_gpt=true`, and redacts common secret forms.

Example:
`node evidence-receipt.mjs --input receipt.json --output receipt.md`

### worker-bootstrap.mjs
Read-only worktree guard. It verifies exact worker identity input, expected branch, clean Git status, current HEAD, and active order. It never changes branches or files.

Example:
`node worker-bootstrap.mjs --worker worker-1 --expected-branch h1-wave4-sealed12-driver --order AR-1138`

## Test

`node --test advisor-prepared/gpt-speed-engineering-lane/tooling/*.test.mjs`

The dedicated GitHub workflow runs these tests without installing project dependencies.
