# AR-1295 — WORKER REPORT: F23/F24/F25 closed (flat branch naming, pre-claim namespace check, structured post-claim failure)

```
RULING : AR-1294A, Section "AR-1295 — AUTHORIZED REPAIR PACKET"
PIN    : commit e9d05b09d93ab852a5a16db16d119e86092d1399, branch claude/worker1-h1-20260815
CHANGED: scripts/control-plane-bootstrap/plan.mjs
         scripts/control-plane-bootstrap/bootstrap.mjs
         scripts/control_plane_bootstrap.test.mjs
         docs/replay-results/control-plane-bootstrap/CONTRACT.md
STOP   : none. bundle.mjs was not touched (no new load-bearing file — plan.mjs and bootstrap.mjs
         were already members of BUNDLE_FILES).
NEXT   : none self-authorized. Reporting to GPT — AR-1294A withholds the fresh executable
         authorization until this packet is graded.
```

## 0. Pre-flight summary

Ran the 7-question pre-flight against AR-1294A. Scope, stop conditions and the forbidden list are
quoted verbatim in AR-1294A's "AR-1295 — AUTHORIZED REPAIR PACKET" section. Measured repo state
before touching anything: HEAD `7b427be8` (graded by AR-1294A), `plan.mjs`/`bootstrap.mjs`/test
file/`CONTRACT.md` all exist exactly as the ruling assumed; `deriveBranch` in `plan.mjs` matched
the code block AR-1294A quoted verbatim. No prior-art: F23/F24/F25 were not already fixed. No
metric/grade mix — this ruling requires GPT's own grade, not a self-dispatched
`accuracy-validator` (no such requirement is stated). No contradiction found.

## 1. F23 — flat branch naming

`deriveBranch` (`plan.mjs`) now joins with `-`, not `/`:

```js
export function deriveBranch(targetPacket, authorizationId) {
  return `control-plane/${targetPacket.toLowerCase()}-guard-repair-${authorizationId}`;
}
```

`deriveWorktreeDirName` was already flat and is unchanged.

## 2. F24 — pre-claim branch-ref-namespace availability

New pure function `branchNamespaceCollision(existingBranches, targetBranch)` in `plan.mjs`,
returning `exact_duplicate` / `existing_is_ancestor` / `target_is_ancestor` / no collision. Fed by
a new measured field `existingControlPlaneBranches` in `bootstrap.mjs::measureState`, computed via
`git for-each-ref --format=%(refname:short) refs/heads/control-plane/` — scoped to the one
relevant prefix, not a repo-wide ref scan (this repo carries several hundred unrelated branches).

`buildPlan` now exposes `branch_namespace_conflict` (and `branch_namespace_existing_refs`) in its
output, so both `--plan` and `--execute` report it identically — `buildPlan` runs before the mode
branch in `run()`. `run()`'s execute path checks `plan.branch_namespace_conflict.collision`
immediately after computing `branch`, **before** `effects.writeClaim`, and refuses with
`authorized:true, executed:false, refusal:{code:'branch_namespace_collision', ...}` — requesting
zero effects — on any collision.

## 3. F25 — structured post-claim failure

New `runStage(stage, fn)` in `bootstrap.mjs`: runs `fn`, returns `{ok:true, stage, value}` on
success or `{ok:false, stage, detail}` on ANY thrown error — never lets the exception propagate.
Every post-claim mutating effect call (`createBranchAndWorktree`, `writeSeatGuard`,
`proveDoorwayInitOnly`, `launchSeatSupervised`, `readCompletionReceipt`) is now wrapped in it. A
failed stage short-circuits to `postClaimFailure(mode, plan, measured, stage, detail)`, returning:

```
authorized: true
authorization_spent: true
executed: false
post_claim_failure_stage: "<the exact planned_operations[].op that threw>"
completion_verified: false
completion_failure_reason: "post_claim_exception"
post_claim_error_detail: "<the caught error message, truncated>"
```

`authorization_spent: true` is now set on every post-claim return path — the new
`postClaimFailure` shape, the pre-existing `doorway_not_armed` refusal, and the final
completion-verification result — so "the authorization is spent, whatever happened" is a single,
always-present field rather than something a caller has to infer from a combination of other
fields.

**Additional fix beyond the letter of F25 (disclosed, not hidden):** the CLI exit-code check
(`process.argv[1].endsWith('bootstrap.mjs')` block) used to key on `result.executed`, which meant
the pre-existing `doorway_not_armed` refusal — `executed:false` on a genuinely spent authorization
— fell through to the default exit code 0 (success) even before this packet. The check now keys on
`result.authorization_spent === true` instead, which closes that gap as a side effect of adding the
field everywhere. Same defect class F25 targets (a spent failure reading as success), one layer
further out (process exit code, not just the JSON). Flagging this explicitly since it is slightly
outside F25's literal wording ("any exception... must be converted") — the doorway case was never
an exception, it is an ordinary negative return value — but it is the same "authorization is spent
but reads as fine" problem, at the surface an operator or a wrapping script actually checks.

## 4. K2 — disposable Git fixture (RED then GREEN)

New test reproduces authorization #1's real forensic branch shape (`control-plane/ar-1278-guard-repair`)
in a throwaway `git init` repo, then:

**RED** — the OLD (`/`-joined) naming, reproduced inline:
```
$ git worktree add -b control-plane/ar-1278-guard-repair/cpb-fixture-0002 ...
fatal: cannot lock ref 'refs/heads/control-plane/ar-1278-guard-repair/cpb-fixture-0002':
'refs/heads/control-plane/ar-1278-guard-repair' exists;
cannot create 'refs/heads/control-plane/ar-1278-guard-repair/cpb-fixture-0002'
```
Byte-identical failure shape to the real one bootstrap #2 hit — confirmed in the live test run
output (captured verbatim, see `AR-1294` report §2 for the original).

**GREEN** — the NEW (`-`-joined) naming, same disposable repo, same untouched stale branch:
```
$ git worktree add -b control-plane/ar-1278-guard-repair-cpb-fixture-0003 ...
Preparing worktree (new branch 'control-plane/ar-1278-guard-repair-cpb-fixture-0003')
```
succeeds. Test asserts BOTH branches exist afterward (`for-each-ref`) — the stale branch was never
touched to make room.

No real forensic branch (`control-plane/ar-1278-guard-repair`, the actual one, not a fixture copy)
was renamed, deleted, or otherwise mutated by this test or by the repair — it lives only in
`/tmp`-style disposable repos, removed at test end.

## 5. K3/K4 — end-to-end wiring proofs (via the existing mocked-`io`/`effects` harness)

**K3** — pre-claim gate: `exact_duplicate`, the pathological bare-`control-plane`
`existing_is_ancestor` case (the only `existing_is_ancestor` shape reachable against a REAL
`deriveBranch` output, since `target_packet`/`authorization_id` are both regex-validated to never
contain `/` — the general three-kind classification itself is exercised directly, with arbitrary
strings, in K1b), and `target_is_ancestor` all refuse with `branch_namespace_collision` and
`effects.calls` is empty (`deepEqual([], ...)`) — zero effects requested, matching the existing
`C14` convention for every other pre-claim refusal in this file. A flat sibling of an unrelated
branch proceeds exactly as before (`writeClaim` still the first call).

**K4a** — `createBranchAndWorktree` throws (`cannot lock ref...`); `run()` returns the structured
`postClaimFailure` shape (never throws itself — asserted via `try/catch` around the `run()` call in
the test), `post_claim_failure_stage: "create_branch_and_worktree"`, `effects.calls` shows exactly
`['writeClaim', 'createBranchAndWorktree']` — the claim was written, nothing after the failing
stage was attempted.

**K4b** — `writeSeatGuard` throws (`EACCES`); `post_claim_failure_stage: "materialize_seat_guard"`,
and the doorway/launch stages are proven NOT attempted.

**K4c** — `runStage` itself, directly: success passes the value through; failure returns
`{ok:false, stage, detail}` and never throws.

## 6. K5/K5b — regression, and `--plan` visibility

**K5** — the pre-existing fully-successful fake end-to-end path (`C6b`, `AR1292-G4`, `AR1292-G5`)
is unaffected: same effect-call sequence, `completion_verified: true`, plus the new
`authorization_spent: true` field (additive; no existing assertion is a deep-equal on the whole
result object, confirmed by reading every `assert.*` call touching a `run()` result in the file
before making this change).

**K5b** — `buildPlan` alone (no `run()`, no `io`/`effects` mocks) reports
`branch_namespace_conflict` for both a non-colliding and a colliding `existingControlPlaneBranches`
input — confirming `--plan` mode (which never reaches the execute-only gate in `run()`, since it
returns before that point) still surfaces the same information, because `buildPlan` computes it
unconditionally and `run()` calls `buildPlan` before branching on mode.

## 7. K6 — full regression suite

```
$ node --test scripts/control_plane_bootstrap.test.mjs
ℹ tests 95
ℹ pass 95
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 7329.0556
```

85 pre-existing tests (one, `N14`, updated — it hardcoded the OLD `/`-joined branch string as an
expected value; the assertion now expects the flat form, with a comment explaining why) + 9 new
(K1, K1b, K2, K3, K4a, K4b, K4c, K5, K5b). The two `LIVE C9`/`LIVE C9b` tests (real `claude
--init-only` probes) ran and passed, at their normal ~2.8s each — no skip. No test was weakened or
removed to reach green.

**Self-finding, disclosed per the campaign's own convention:** `AR1290-C6` (pre-existing,
unmodified) only asserts `notEqual(freshBranch, staleBranch)` between the fresh and stale
identities — exactly the assertion that was too weak to catch F23 in the first place (two
DIFFERENT strings can still be Git-ref parent and child). I left it as-is rather than
strengthening it in place, because K1/K1b now cover the actual load-bearing property
(non-collision, not mere inequality) as dedicated tests — duplicating that inside `AR1290-C6`
would blur which test is responsible for which claim. Flagging the gap explicitly rather than
silently walking past it.

## 8. K7 — terminal frozen proof (re-measured after commit, before push)

```
real bootstrap executions = 0   (no --execute run this packet)
new bootstrap claims       = 0  (git-common-dir claim store: only cpb-2026-08-17-0001/0002, both pre-existing)
privileged launches        = 0
Agent/subagent calls       = 0
frozen calls               = 0
frozen ready               = 8
frozen spent                = 0
attempts                   = {}
frozen receipts            = README ONLY
```

`docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json` and
`docs/replay-results/control-plane-bootstrap/claims/` show no diff at any point in this session
(`git status --short` against both paths returned nothing before, during, or after this packet).
Authorization `cpb-2026-08-17-0002` remains recognized as spent by the local shared claim store —
not deleted, not touched.

## 9. K8 — final execution pins (production read-only plan/measurement path, run AFTER commit)

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs
```
```json
{
  "mode": "plan",
  "authorized": false,
  "refusal": { "code": "no_marker", "detail": "no CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1 block in AR-1294A" },
  "measured": {
    "worker_branch": "claude/worker1-h1-20260815",
    "worker_head": "e9d05b09d93ab852a5a16db16d119e86092d1399",
    "newest_ruling": "AR-1294A",
    "bootstrap_bundle_sha256": "c54f71a1a0f2cb74bc3dab44fe19e2411d9d9a98c76176a612c75a98fe73492a",
    "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
    "ready": 8, "spent": 0, "receipts_readme_only": true,
    "claimed_authorization_ids": ["cpb-2026-08-17-0002", "cpb-2026-08-17-0001"]
  }
}
```
`refusal:no_marker` is correct and expected — AR-1294A itself states "No executable bootstrap
marker is issued in this ruling," so there is nothing for the validator to accept yet. The bundle
sha256 changed from AR-1293A's pinned `582b8f06...` to `c54f71a1...` — expected and correct: this
packet edited two `BUNDLE_FILES` members (`plan.mjs`, `bootstrap.mjs`), so the code identity must
change. **Disclosure per K8's own instruction:** this commit is NOT a report-only/inventory commit
— it changed bundled bytes — so the new digest above is the one any future authorization must pin
to; the old `582b8f06...` digest is now stale and must never be reused.

`8 / 0`, `README_ONLY` confirmed unchanged (matches §8 above). `claimed_authorization_ids` visible
to the runtime include both `0001` and `0002`, as required.

**Branch namespace availability for the prospective `cpb-2026-08-17-0003` (K8's remaining item)** —
computed directly against the REAL live repository refs (not a fixture), since no marker exists
yet for `buildPlan` to run against:
```
$ git for-each-ref --format=%(refname:short) refs/heads/control-plane/
control-plane/ar-1278-guard-repair

$ node --input-type=module -e "
import { deriveBranch, branchNamespaceCollision } from './scripts/control-plane-bootstrap/plan.mjs';
const target = deriveBranch('AR-1278', 'cpb-2026-08-17-0003');
console.log(target, JSON.stringify(branchNamespaceCollision(['control-plane/ar-1278-guard-repair'], target)));
"
control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003 {"collision":false,"kind":null,"with":null}
```
```
proposed fresh branch for prospective 0003 = control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003
branch namespace availability              = PASS
```

## 10. Recommendation

`GRADE_REQUESTED_CONTINUING` is not applicable — AR-1294A did not pre-authorize a next self-executing
step past this repair packet (§6 "Speed law" explicitly reserves the fresh executable authorization
to a future GPT ruling: "it is NOT minted by this ruling"). Recommendation: `APPROVAL_REQUESTED` —
the next action (issuing the `cpb-2026-08-17-0003` executable marker) is explicitly reserved to
GPT. No further action taken. Awaiting grading of F23/F24/F25.
