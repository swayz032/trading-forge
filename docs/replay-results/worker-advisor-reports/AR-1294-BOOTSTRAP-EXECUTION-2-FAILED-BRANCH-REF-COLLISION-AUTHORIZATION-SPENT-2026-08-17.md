# AR-1294 — WORKER REPORT: bootstrap authorization #2 EXECUTED, FAILED at branch/worktree creation, authorization now SPENT

```
RULING : AR-1293A, Section 4 (EXECUTABLE marker cpb-2026-08-17-0002) + Section 5 (AR-1294 execution order)
PIN    : worker HEAD 158543dd1ecc876317fedec4ceaec5980be096c1, branch claude/worker1-h1-20260815
CHANGED: none in this worktree. ONE external mutation: shared claim file written
         (see below). No branch, no worktree, no seat guard, no seat launch, no commit, no push.
STOP   : YES — post-claim failure at git ref creation. No second --execute attempted (forbidden by
         AR-1293A and by bootstrap.mjs's own one-shot design).
NEXT   : none self-authorized. Reporting to GPT for a new ruling — see §7 below.
```

## 0. Pre-flight (advisor-ruling, worker mode) — summary

Ran the mandatory 7-question pre-flight against AR-1293A before touching anything:
- **SCOPE**: quoted `allowed_paths` from the marker; single command
  `node scripts/control-plane-bootstrap/bootstrap.mjs --execute`, exactly once.
- **STOP CONDITIONS**: HEAD-drift refusal, no-retry-on-failure, doorway-failure=stop,
  completion-failure=stop, §7 forbidden list.
- **PROHIBITED**: §7 of AR-1293A (frozen G2 calls, Tier-3 work, money-path, Phase-2 calibration,
  model-router code, forensic-state cleanup, second use of `cpb-2026-08-17-0002`).
- **REQUIRED PROOFS**: J1–J9 of AR-1293A §6. No independent-grader dispatch was required by this
  specific ruling text (GPT itself grades AR-1294 next).
- **MEASURED REPO STATE**: ran `node scripts/control-plane-bootstrap/bootstrap.mjs` (default
  `--plan`, read-only, no side effects) BEFORE executing. It independently confirmed
  `authorized: true` with every frozen field matching (bundle sha, frozen-queue sha,
  worker HEAD, ready=8/spent=0/receipts=README_ONLY, no replay — `claimed_authorization_ids`
  contained only `cpb-2026-08-17-0001`). Cross-checked the frozen queue file by hand
  (`docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json`):
  8 queue entries, `attempts: {}` — matches the tool's own measurement via a second, independent
  read path.
- **ALREADY LANDED?**: no. `cpb-2026-08-17-0002` was unclaimed before execution.
- **METRIC/GRADE MIX**: N/A — execution task, not a metric report.

**No contradiction found → executed per `0-CTRL.1` with no permission round-trip.**

## 1. What I ran

```
node scripts/control-plane-bootstrap/bootstrap.mjs --execute
```

Exactly once. No second attempt.

## 2. RED — the failure, verbatim

```
Preparing worktree (new branch 'control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002')
fatal: cannot lock ref 'refs/heads/control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002': 'refs/heads/control-plane/ar-1278-guard-repair' exists; cannot create 'refs/heads/control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002'

Error: Command failed: git -C C:/Users/tonio/Projects/wt-claude-worker1-20260815 worktree add -b control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002 C:/Users/tonio/Projects/wt-control-plane-ar-1278-cpb-2026-08-17-0002 158543dd1ecc876317fedec4ceaec5980be096c1
    at Object.createBranchAndWorktree (.../scripts/control-plane-bootstrap/bootstrap.mjs:228:7)
    at run (.../scripts/control-plane-bootstrap/bootstrap.mjs:390:11)
```
Process exited with an **uncaught exception** (Node's default crash exit, not either of the
script's own documented exit codes 3=refused/4=executed-not-verified). The wrapper `EXIT_CODE=$?`
echo read `1`.

## 3. Root cause

`deriveBranch(target_packet, authorization_id)` for `AR-1278` nests the authorization id under a
FIXED literal prefix: `control-plane/ar-1278-guard-repair/<auth-id>`. Authorization **#1**
(`cpb-2026-08-17-0001`, ruled at AR-1288A, pre-AR-1289A shared-store fix) used the **bare prefix
itself** as its branch name — `control-plane/ar-1278-guard-repair` (no suffix), confirmed by
reading the legacy committed claim
(`docs/replay-results/control-plane-bootstrap/claims/cpb-2026-08-17-0001.json`, `branch` field).
That branch (and its worktree, `wt-control-plane-ar-1278`) is preserved as spent-authorization
forensic evidence — correctly, per AR-1293A §7's explicit ban on "cleanup/deletion of spent
authorization forensic state," and per the general campaign law against destroying forensic state.

Git's ref storage cannot hold a ref at `refs/heads/X` and another at `refs/heads/X/Y`
simultaneously — one must be absent. **This is structural, not a one-off:** as long as the
forensic branch from authorization #1 exists at the bare prefix (which it must, by the
no-cleanup rule), **every future authorization for target_packet `AR-1278` using the current
`deriveBranch` scheme will hit the identical `cannot lock ref` failure.** A third authorization
attempt with the current code would fail exactly the same way.

**Secondary defect:** none of the mutating effects from `createBranchAndWorktree` onward are
wrapped in try/catch in `run()`/the CLI block, so a failure at this step crashes with a raw stack
trace instead of returning the structured `{authorized:true, executed:false, refusal:{...}}`
object the tool already uses cleanly for the `doorway_not_armed` case. This makes a post-claim
failure harder to diagnose than it needs to be, though it did not hide anything here — the state
was still independently measurable via a fresh `--plan` run.

## 4. What actually happened to state — MEASURED

- **Claim WRITTEN** (step 5 of 10, the first mutating step): confirmed present at
  `C:/Users/tonio/Projects/trading-forge/trading-forge/.git/tf-control-plane-claim-cpb-2026-08-17-0002.json`,
  `claimed_at: "2026-08-17T16:41:30.589Z"`, body matches the marker (`authorization_id`,
  `ruling_id: AR-1293A`, `target_packet: AR-1278`, `branch`, `worktree`, `source_worker_head`,
  `bootstrap_bundle_sha256` all correct).
- **Branch: NOT created.** `git for-each-ref refs/heads/control-plane` shows only the pre-existing
  `refs/heads/control-plane/ar-1278-guard-repair` at `949282ae...` — no `.../cpb-2026-08-17-0002`
  ref exists.
- **Worktree: NOT created.** `git worktree list` shows only the pre-existing
  `C:/Users/tonio/Projects/wt-control-plane-ar-1278`. The target path
  `C:/Users/tonio/Projects/wt-control-plane-ar-1278-cpb-2026-08-17-0002` does not exist on disk
  (`git worktree add` failed atomically before creating anything).
- **Seat guard, doorway proof, seat launch, completion receipt: NONE occurred** — execution
  stopped at step 6 of the planned 10 operations; steps 7–10 never ran.
- **No commit, no push, no privileged seat was ever launched.**
- **Old claim `cpb-2026-08-17-0001` untouched**: re-read from the committed tree
  (`git show HEAD:docs/replay-results/control-plane-bootstrap/claims/cpb-2026-08-17-0001.json`,
  which is immutable by construction) — unchanged.
- **Frozen G2 queue untouched**: re-measured via `bootstrap.mjs`'s own read-only `--plan` path
  AND by hand-reading the queue JSON directly — `ready: 8`, `spent: 0`, `attempts: {}`,
  `receipts_readme_only: true`, `frozen_queue_sha256` unchanged
  (`5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`). No frozen G2 model call
  occurred (`agent_model_executions: 0` — by construction, this process dispatches no Agent).
- **This worktree (`wt-claude-worker1-20260815`) is unchanged** except the pre-existing governed
  dirty exception (`docs/wave25-exit-engine-ab-report.md`, AR-1265 §4) — no new modifications.

## 5. GREEN — replay-guard confirmed correctly fail-closed

Re-ran `node scripts/control-plane-bootstrap/bootstrap.mjs` (read-only `--plan`) after the failed
execute:

```
{
  "mode": "plan",
  "authorized": false,
  "refusal": {
    "ok": false,
    "code": "all_markers_refused",
    "detail": "replayed_authorization: authorization_id cpb-2026-08-17-0002 has already been claimed — one authorization is one execution"
  },
  "measured": { ..., "claimed_authorization_ids": ["cpb-2026-08-17-0002", "cpb-2026-08-17-0001"], ... }
}
```
Exit code 3 (correctly the documented "refused" code — this path IS wrapped and clean, unlike the
crash above). **The one-shot / no-replay contract held**: the tool itself now correctly refuses
any further attempt on this authorization id. `cpb-2026-08-17-0002` is **permanently spent** per
its own designed semantics ("whether the later execution succeeds or fails").

## 6. CONTROL — no second execute attempted

Per AR-1293A ("No silent retry is authorized") and `bootstrap.mjs`'s own one-shot design, I did
**not** run `--execute` a second time. The refusal in §5 is offered as confirmation the guard
holds, not as a retry.

## 7. FINDINGS

**Against myself:** my pre-flight's "measured repo state" step checked whether the target
**worktree directory** already existed (it did not — verified via `git worktree list` and
`--plan`'s `proposed_target_worktree`) but did **not** check the target **git branch ref
namespace** for a prefix collision against the preserved forensic branch from authorization #1.
That is the same class of error this campaign has repeatedly convicted (`worker-execution` §2a):
I verified the adjacent surface (directory existence) and not the one the actual failure lived on
(ref-namespace hierarchy). `--plan`'s own `authorized: true` output did not surface this either —
it validates the marker against frozen/measured fields, not against live git-ref availability at
the derived branch name, which is a gap in the tool, not only in my check.

**Against the instrument (`bootstrap.mjs`):**
1. **F23 candidate — structural branch-ref collision.** `deriveBranch()` for packet `AR-1278`
   nests every authorization's branch under the literal bare-prefix name that authorization #1
   already occupies as its OWN (forensic, undeletable) branch. Every future authorization for
   this packet will collide identically unless the naming scheme changes (e.g. never reuse the
   bare packet slug as a real branch name — always require at least the authorization-id
   segment, even for the first attempt) or GPT explicitly authorizes moving the old ref out of
   the way (e.g. `git branch -m` to an `archive/` prefix — a rename, not a deletion, preserving
   the forensic commit and its history).
2. **Uncaught exception on post-claim mutation failure.** `createBranchAndWorktree` (and likely
   the later mutating effects) are not try/catch-wrapped in `run()`, so a failure here crashes
   raw instead of returning the same clean `{executed:false, refusal:{...}}` shape the
   `doorway_not_armed` path already demonstrates is achievable. Recommend wrapping steps 6–9 the
   same way, so a post-claim failure is always diagnosable from the JSON alone.

## 8. J1–J9 (AR-1293A §6), as measured

- **J1**: authorization `cpb-2026-08-17-0002` — marker accepted by the validator (confirmed by
  the pre-execution `--plan` run showing `authorized:true`); claim WAS written (§4); durable
  claim path `C:/Users/tonio/Projects/trading-forge/trading-forge/.git/tf-control-plane-claim-cpb-2026-08-17-0002.json`;
  old `0001` claim proven untouched (§4); no second execution attempt (§6).
- **J2**: expected identities per the marker's mechanical derivation —
  branch `control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002`,
  worktree `C:/Users/tonio/Projects/wt-control-plane-ar-1278-cpb-2026-08-17-0002`. **Neither was
  created** (§4) — reporting the measured (absent) values, not hand-creating them.
- **J3**: doorway `--init-only` proof — **never reached.** Execution failed at step 6, before
  step 7 (seat guard) or step 8 (doorway).
- **J4**: privileged Phase-1 boundary — **N/A, no seat was ever launched.**
- **J5**: repair deliverables — **N/A, no repair occurred.** AR-1278's control-plane objectives
  remain open.
- **J6**: terminal finalize/publication — **N/A, no commit, no push, no receipt.**
  `completion_verified` is trivially false; this report supplies the failure reason the crashed
  process did not (see §3 secondary defect).
- **J7**: changed-path audit — **no paths changed** in any tracked tree. The only mutation
  anywhere is the untracked claim file in the shared git-common-dir (§4).
- **J8**: frozen terminal proof — re-measured, unchanged: `ready=8`, `spent=0`, `attempts={}`,
  `receipts=README ONLY` (§4).
- **J9**: stop after Phase 1 — moot (Phase 1 never started); in any case, no Phase-2 Agent
  calibration was run.

## 9. Recommendation

`BLOCKED`. `cpb-2026-08-17-0002` is spent with nothing delivered. AR-1278's control-plane repair
remains un-executed. A **new GPT ruling / new authorization** is required, and it should either
(a) change `deriveBranch` so packet `AR-1278`'s branch names never collide with the bare-prefix
forensic branch left by authorization #1 (make the bare-prefix-as-branch-name case a
never-again rule, not just this instance), or (b) explicitly authorize a non-destructive rename
(not deletion) of the stale `control-plane/ar-1278-guard-repair` ref to an archive namespace so
the nested name becomes available, or both. I have not chosen between these — that is an
architecture decision reserved to GPT (`advisor-ruling` §0.0 / worker-execution §6).

No further action taken. Awaiting the next GPT ruling.
