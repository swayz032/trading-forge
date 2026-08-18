# GPT EXTERNAL ADVISOR RULING — AR-1317A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Prior executable authority:** AR-1316B / `cpb-2026-08-18-0006`  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**Pre-execution Worker source:** `1e65bc5b5b313485927026ea212be48af6d548c3`  
**F36 target toolbox remains accepted:** `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198` / `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`  
**Verdict:** **AR-1317 PASS AS A FAIL-CLOSED EXECUTION OUTCOME. LIVE F36 PROPAGATION DID NOT OCCUR. `cpb-2026-08-18-0006` IS SPENT AND MUST NEVER BE REUSED. THE WORKER DIAGNOSIS FOUND ONE REAL BLOCKER BUT MISSED A SECOND EARLIER GIT_TREE COMPATIBILITY FAILURE. AUTHORIZE ONE NARROW OFF-LIVE REPAIR PACKET THAT CLOSES BOTH COPIES TOGETHER, THEN RETURN FOR A FRESH ONE-SHOT LIVE KEY.**

## 1. EXECUTIVE RULING

The attempted AR-1316B bootstrap execution behaved safely:

- the one-shot authorization passed the top-level bootstrap preflight and was claimed;
- the bootstrap created only its isolated control-plane branch/worktree and local seat-guard material;
- `claude --init-only` did not mint a durable armed receipt;
- the bootstrap stopped before `launch_seat_supervised`;
- no privileged `claude -p` seat ran;
- no live `.claude/settings.json`, live Worker guard manifest, or live toolbox pin was propagated;
- the Worker branch moved only by the AR-1317 diagnostic report commit over the previously reviewed source;
- no new Agent/Task/Opus/model call is authorized or needed.

That is a correct fail-closed result. Do not clean up or rewrite the failed attempt merely to make the history prettier. Treat authorization `cpb-2026-08-18-0006` as permanently spent even though its local claim cannot be independently inspected from GitHub.

## 2. THE REPORT'S ROOT-CAUSE FINDING IS REAL BUT INCOMPLETE

AR-1317 correctly found a stale second README-only check in `control-plane-guard.mjs::verifySeatIdentity()`:

```js
if (observed.ready !== 8 || observed.spent !== 0 || observed.receiptsReadmeOnly !== true) {
  ... frozen_state_drift ...
}
```

That must be repaired.

However independent code inspection finds a second GIT_TREE incompatibility that the report did not identify:

`control-plane-seat-hook.mjs::verifyAuthorityIndependently()` recomputes `queueSha256`, `ready`, `spent`, and `receiptsReadmeOnly`, then calls the newly extended `validateAuthorization()` without supplying `receiptsGitTreeSha` or `receiptsClean`.

For an AR-1316B marker carrying:

`require_receipts: "GIT_TREE:c11966868f8a511554e1f26bf6e5555c59833d04"`

`validateAuthorization()` therefore compares the pinned tree to an undefined `measured.receiptsGitTreeSha` and refuses. On SessionStart, `decide()` checks `authority.ok` before `identity.ok`, so this independent-authority refusal is an earlier blocker than the report's `verifySeatIdentity()` README-only branch.

Because `proveDoorwayInitOnly()` discarded successful child stdout when no armed receipt appeared, AR-1317 could not observe the actual SessionStart refusal text and inferred the later static blocker as the runtime root cause. The later blocker is real, but fixing it alone would spend another authorization for nothing.

**Do not implement a one-location patch. Close both receipt-state verification paths in one packet.**

## 3. NEXT PACKET — AR-1318, ONE BOUNDED OFF-LIVE GIT_TREE SEAT-COMPATIBILITY REPAIR

This is the only authorized engineering packet before the next GPT ruling.

### Lane A — one receipt-state law, reused by both authorization and seat identity

In `scripts/control-plane-bootstrap/authorization.mjs`, extract the current `README_ONLY` / `GIT_TREE:<40-hex>` decision into one exported pure helper. The helper must preserve the existing refusal semantics:

- `README_ONLY` requires `receiptsReadmeOnly === true`;
- `GIT_TREE:<sha>` requires exact `receiptsGitTreeSha === sha`;
- GIT_TREE also requires `receiptsClean === true`;
- malformed forms refuse;
- no wildcard, prefix, directory-count, "contains these files", or ignore-untracked relaxation.

`validateAuthorization()` must call that same helper rather than maintaining a private copy.

### Lane B — independent seat authority verification must measure the GIT_TREE inputs

In `control-plane-seat-hook.mjs::verifyAuthorityIndependently()`:

1. measure the committed receipt-tree identity independently from Git using the same repository path:
   - `git rev-parse HEAD:<receipt-dir>`;
2. measure receipt-path cleanliness independently:
   - `git status --porcelain -- <receipt-dir>` must be empty;
3. pass `receiptsGitTreeSha` and `receiptsClean` to `validateAuthorization()`;
4. keep the legacy `receiptsReadmeOnly` measurement because old README_ONLY markers remain supported;
5. do not take any of these observed values from the local manifest.

Required negative controls:

- correct GIT_TREE + clean -> authority verifier can pass;
- wrong tree -> refuses;
- tracked dirty receipt -> refuses;
- untracked receipt -> refuses;
- README_ONLY legacy behavior remains unchanged.

### Lane C — seat identity / every-tool-call frozen-state check must use the same law

The privileged seat must continue verifying the frozen receipt state at SessionStart and on every PreToolUse, not only once at bootstrap authorization time.

Implement the smallest robust contract:

1. carry the validated marker's exact `require_receipts` value into the immutable control-plane seat manifest generated by `bootstrap.mjs`;
2. during independent SessionStart authority verification, require the manifest's receipt requirement to equal the current GPT marker's `require_receipts` exactly;
3. extend `measureObservedIdentity()` to measure:
   - `receiptsReadmeOnly`;
   - `receiptsGitTreeSha`;
   - `receiptsClean`;
4. extend `expectationsFrom(manifest)` with the exact receipt requirement;
5. replace `verifySeatIdentity()`'s hard-coded README-only condition with the SAME exported receipt-state helper from Lane A, after the unchanged `ready === 8` and `spent === 0` checks;
6. a wrong tree or dirty receipt path must deny every privileged tool call even if the seat armed earlier.

Do not create a second GIT_TREE parser in `control-plane-guard.mjs`. The point of this repair is to remove the two drifting receipt-state laws, not add a third.

### Lane D — tiny doorway diagnostic repair

`bootstrap.mjs::proveDoorwayInitOnly()` currently executes `claude --init-only` with piped stdout but discards the successful process output before checking whether an armed receipt exists.

Make the smallest non-authority-changing improvement: if `--init-only` exits normally but no armed receipt is found, include a bounded tail of its captured stdout in the returned refusal detail. Do not change launch arguments, settings sources, timeout, arming law, or execution order. This is diagnostic evidence only.

Add one test proving a no-receipt refusal surfaces the SessionStart guard message instead of only `no durable armed receipt`.

## 4. REQUIRED RED/GREEN PROOF

Before the fix, add tests that demonstrate BOTH independent failures:

1. GIT_TREE marker rejected by `verifyAuthorityIndependently()` because receipt-tree/clean measurements are absent from the validator input;
2. GIT_TREE-valid observed state rejected by `verifySeatIdentity()` because of the hard-coded README-only check.

Then GREEN must prove:

1. top-level bootstrap authorization accepts the exact GIT_TREE snapshot;
2. independent receiving-seat authority verification accepts that same exact snapshot;
3. receiving-seat identity accepts that same exact snapshot;
4. wrong tree fails at both independent authority verification and seat identity;
5. tracked dirty and untracked dirty receipt paths fail;
6. README_ONLY legacy tests remain green;
7. armed receipt / PreToolUse continues to deny if receipt state drifts after SessionStart;
8. existing claim/replay, branch namespace, allowed-path, no-Agent, and completion safeguards remain green;
9. full `scripts/control_plane_bootstrap.test.mjs` suite green;
10. any focused control-plane seat/guard suites green.

Use synthetic/local fixtures only. **ZERO Claude Agent/Task/model calls and ZERO bootstrap `--execute` calls in this repair packet.** `claude --init-only` may only be exercised by an existing or purpose-built zero-conversation test fixture if already supported; do not spend a new authorization.

## 5. REPORT THE EXACT NEXT-KEY VALUES

AR-1318 closeout must report:

- exact Worker HEAD before repair;
- exact repair/report commit and remote Worker tip;
- exact changed paths;
- exact new bootstrap bundle SHA-256 from the production 10-file `BUNDLE_FILES` algorithm;
- exact preserved receipt Git tree; expected current value is `c11966868f8a511554e1f26bf6e5555c59833d04`, but re-measure it rather than hard-code it;
- receipt path clean = true;
- exact test counts and RED control counts;
- live toolbox pin/bundle still unchanged at `4c5f9d4a...` / `59d95f3c...`;
- F36 target still `bbf2e6c2...` / `ca0b3a70...`;
- live `.claude/settings.json` still has no `SubagentStop` registration;
- zero Agent/Task/model calls;
- no compiler/backtest/paper/broker/live-money work.

After that exact report, GPT's next action is the fresh executable key. Do not add another architecture review.

## 6. HARD LIMITS

- **DO NOT reuse `cpb-2026-08-18-0006`.**
- **NO bootstrap `--execute` until a new GPT executable marker exists.**
- **NO live toolbox re-pin.**
- **NO live `.claude/settings.json` or Worker manifest edit.**
- **NO deletion/reset/rewrite of the failed control-plane branch/worktree/claim as a shortcut.**
- **NO receipt deletion or normalization.**
- **NO new Agent/Task/Opus/model call.**
- **NO F36 architecture redesign.**
- **NO grader/gate weakening.**
- **NO compiler/backtest/paper/broker/live-money detour.**

## 7. BOTTOM LINE

**F36 itself remains accepted. The live propagation failed safely before privilege launch. The next problem is not F36; it is a two-copy control-plane receipt-state compatibility gap. Fix both copies once, share one receipt-state law, expose the real `--init-only` refusal text, measure the new bootstrap bundle, and return immediately for a fresh one-shot key.**
