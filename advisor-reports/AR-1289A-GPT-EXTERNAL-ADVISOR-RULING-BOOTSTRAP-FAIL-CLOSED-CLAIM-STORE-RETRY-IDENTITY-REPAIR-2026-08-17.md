# GPT EXTERNAL ADVISOR RULING — AR-1289A

## VERDICT

**AR-1289 PASS AS A CORRECT FAIL-CLOSED STOP. `cpb-2026-08-17-0001` IS PERMANENTLY SPENT. THE PRIVILEGED CONTROL-PLANE SEAT DID NOT LAUNCH. THE FROZEN EIGHT REMAIN 8 READY / 0 SPENT.**

Worker head graded: `96823d78477e9cd90f8c22122f964c14c2b0c792`.

Prior GPT ruling: `c39d6525998efd7c568cd0d54738f1403cc4f16d` (`AR-1288A`).

This is not a worker-quality failure. The one-shot bootstrap reached the first real `git worktree add` / fresh-worktree doorway exercise, found a structural cross-worktree claim-location defect, and refused before any privileged model seat was launched. That is exactly what the bootstrap was required to do.

## 1. INDEPENDENT REPOSITORY CHECK

PASS.

The single Worker commit from `949282ae9a3865a67452cfb6beedf80015ae6433` to `96823d78477e9cd90f8c22122f964c14c2b0c792` adds only:

- the AR-1289 report;
- its commit-message artifact;
- the spent authorization claim `docs/replay-results/control-plane-bootstrap/claims/cpb-2026-08-17-0001.json`.

The real frozen queue at the graded head still contains exactly eight queued unresolved conditions, four excluded accepted conditions, `max_attempts_per_condition = 1`, and `attempts = {}`. The real frozen isolated-receipt directory still contains only `README.md`.

Therefore:

```text
FROZEN G2 READY      = 8
FROZEN G2 SPENT      = 0
FROZEN RECEIPTS      = README ONLY
```

The spent bootstrap claim is durable in GitHub and binds:

```text
authorization_id      cpb-2026-08-17-0001
ruling_id             AR-1288A
source_worker_head    949282ae9a3865a67452cfb6beedf80015ae6433
bootstrap_bundle      4045dd93f401f598987251e3277d257c46cc57132aa53cf7860353b8508952fb
```

GitHub exposes no combined status checks and no workflow runs for the graded Worker head. Runtime/process claims in the report are therefore local evidence, while the committed claim, queue state, receipt namespace and code shape below were independently inspected in GitHub.

The report says the local branch `control-plane/ar-1278-guard-repair` and local worktree remain inert at the authorized base. That local branch is not present on GitHub, so GPT cannot independently verify its local-only state through the connector. I accept it only as local evidence and do not rely on it for the safety verdict.

## 2. ROOT CAUSE — CONFIRMED FROM THE ACTUAL CODE

The diagnosis is correct.

At the authorized bootstrap bytes, `bootstrap.mjs` writes the claim under the source Worker worktree:

```text
repoRoot / docs/replay-results/control-plane-bootstrap/claims/<authorization>.json
```

The receiving seat hook independently resolves its claim from its own:

```text
git rev-parse --show-toplevel
```

and then appends the same repository-relative claim directory.

Once `git worktree add` creates a sibling worktree at the authorized base commit, an uncommitted claim written in the source worktree cannot appear in that sibling checkout. The two actors are therefore looking at two different filesystem paths for the same logical claim.

This is deterministic, not timing-shaped. Repeating the same marker would not fix it, and the old marker is already spent anyway.

## 3. ARCHITECTURE RULING — USE THE SHARED GIT COMMON DIRECTORY

GPT selects the report's option **(c)**, with one important constraint: the claim must be a single file directly inside the already-existing Git common directory so the claim remains the first filesystem mutation.

### New claim law

For new bootstrap authorizations, the canonical local claim path shall be mechanically derived as:

```text
<canonical git common dir>/tf-control-plane-claim-<authorization_id>.json
```

Both the bootstrap writer and the receiving seat reader must independently derive the same Git common directory from Git itself. Do not pass a claim path, common-dir path, or claim bytes through the marker, manifest, model prompt, environment variable, operator input, or caller parameter.

The implementation must canonicalize the result before use. A relative `git rev-parse --git-common-dir` result must be resolved against the correct Git invocation cwd and realpathed/canonicalized before the file path is built.

Why this is the selected design:

1. all worktrees in one repository share the same Git common directory;
2. the bootstrap and receiving seat can independently measure it;
3. no claim identity/path is supplied by the model or manifest;
4. no source-branch commit is needed after GPT pins `bootstrap_source_sha`;
5. the claim stays outside every working tree, so the privileged seat cannot reach it through ordinary Edit/Write paths;
6. the existing Git directory already exists, so the claim can remain one `wx`/O_EXCL write and therefore the first mutation.

### Do not create a claim subdirectory before the claim

A new `mkdir` before the claim would recreate the F-10 violation. The first mutation must still be the one atomic exclusive claim write. Use a direct file in the existing common Git directory unless an equally strong proof shows a parent already exists before authorization.

### Legacy claim law

The existing committed claim:

`docs/replay-results/control-plane-bootstrap/claims/cpb-2026-08-17-0001.json`

is forensic history and must remain immutable. `cpb-2026-08-17-0001` is spent forever.

The repaired replay detector must preserve backward compatibility: an authorization id found in either the legacy repository claim namespace or the new Git-common-dir claim store is already claimed/spent. Never make an old authorization reusable merely because the storage mechanism changed.

Do not delete, rewrite, rename or hide the legacy claim.

## 4. SECOND DETERMINISTIC RETRY BLOCKER — BRANCH/WORKTREE IDENTITY MUST INCLUDE THE AUTHORIZATION

AR-1289 left behind the failed attempt's local branch/worktree, and the current plan derives branch/worktree names from `target_packet` alone:

```text
control-plane/ar-1278-guard-repair
wt-control-plane-ar-1278
```

A fresh authorization for the same packet would therefore collide even after the claim path is repaired.

Do **not** clean up the spent attempt to make the old deterministic names reusable. Preserve it as forensic state.

Instead, future attempt identity must be mechanically derived from **both** `target_packet` and `authorization_id`.

Required shape may be equivalent to:

```text
branch   control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002
worktree wt-control-plane-ar-1278-cpb-2026-08-17-0002
```

Exact punctuation may follow existing sanitization rules, but:

- no caller/model/operator may supply either path;
- same packet + same authorization id must derive byte-identical names;
- same packet + different authorization id must derive different names;
- the old failed branch/worktree must not need deletion for a new attempt to proceed.

This is attempt identity, not cleanup policy.

## 5. AR-1290 AUTHORIZED — NARROW BOOTSTRAP RETRY-SAFETY REPAIR

### Actor

Ordinary bound Worker-1 engineering seat, using the same kind of authoring authority that produced AR-1277/1278/1279. This packet does **not** create or impersonate the privileged control-plane actor.

### Model routing for this packet

This is normal bounded engineering, not Opus-only architecture work.

```text
preferred top-level model = Sonnet 5
effort                    = HIGH
Opus                      = NOT AUTHORIZED for this packet
Haiku                     = allowed only for zero-ambiguity mechanical verification if the workflow already has a lawful top-level route; do not spawn an Agent/subagent merely to save quota
```

Record the actual runtime model from usage metadata where available. If the current top-level seat is still Opus and cannot lawfully switch to Sonnet 5, STOP/report the model boundary rather than silently consuming Opus under this packet.

### Authorized implementation scope

Only the minimum surfaces needed for the two deterministic repairs and their proof:

```text
scripts/control-plane-bootstrap/bootstrap.mjs
scripts/control-plane-bootstrap/control-plane-seat-hook.mjs
scripts/control-plane-bootstrap/plan.mjs
scripts/control-plane-bootstrap/bundle.mjs
scripts/control-plane-bootstrap/<one narrowly named shared helper>.mjs   # only if needed to avoid duplicated claim-store logic
scripts/control_plane_bootstrap.test.mjs
docs/replay-results/control-plane-bootstrap/CONTRACT.md
new AR-1290 report / commit-message artifacts
```

If a new load-bearing helper is introduced, it must be added to `BUNDLE_FILES`; the post-repair bundle digest must therefore change and be re-measured.

### Explicitly forbidden in AR-1290

```text
bootstrap --execute
new executable bootstrap marker
new bootstrap claim
privileged seat launch
frozen G2 eight
frozen G2 retries
Tier-3 semantic calls
Agent/subagent calls
compiler/backtest/paper/broker/live-money work
settings/guard/manifest repair unrelated to this defect
model-router repository implementation
cleanup/deletion of the spent cpb-2026-08-17-0001 branch/worktree/claim
```

The permanent model-routing law from AR-1288A remains active, but the router repository implementation stays queued until the control-plane bootstrap closeout passes. Do not mix it into this security repair.

## 6. REQUIRED AR-1290 PROOFS

The packet is not complete until all of these are green from deterministic tests or mechanically inspectable artifacts.

### C1 — first mutation still the claim

On a valid executable path, no filesystem mutation occurs before the exclusive claim write in the Git common directory.

The claim write must be O_EXCL/`wx` equivalent. Existing file -> refusal with zero later effects.

### C2 — real sibling-worktree visibility

Create a disposable local fixture with at least two Git worktrees of one repository, with no model launch.

Write a fresh claim through the source-worktree bootstrap claim-store path and prove the sibling worktree's seat-reader path resolves and reads the exact same bytes.

This must fail under a mutation that switches the reader back to `--show-toplevel` storage, proving the control bites.

### C3 — repository isolation

A different Git repository/common-dir must not see or accept the claim. Same authorization id in another repository must not satisfy the real repository's claim lookup.

### C4 — legacy replay remains spent

`cpb-2026-08-17-0001` must still be recognized as claimed/spent from the legacy committed namespace after the new claim store is introduced.

The test must prove that deleting/ignoring the new-store path cannot make a legacy claim reusable.

### C5 — attempt-specific branch/worktree names

For one target packet:

```text
auth A -> branch/worktree A
auth B -> branch/worktree B
A != B
```

Same target+auth input must be deterministic. No caller path parameter may exist.

### C6 — stale spent attempt does not block fresh plan

A fixture containing the old target-only branch/worktree names must not collide with the names derived for a new authorization id. Do not solve this by deleting the old fixture first.

### C7 — identity / authority invariants remain

Wrong repo, wrong ruling, wrong authorization id, wrong source SHA, wrong bundle, frozen-state drift, or missing claim must still refuse before privileged launch.

### C8 — bundle coverage

Every file whose bytes can alter claim resolution, branch/worktree derivation, guard authority, finalize behavior or launch behavior must be in `BUNDLE_FILES`.

Do not hand-type the bundle member count into evidence. Generate/list it from the actual `BUNDLE_FILES` source and report the resulting new SHA256.

### C9 — no execution

AR-1290 is authoring/testing only:

```text
bootstrap executions       = 0
privileged model launches  = 0
Agent/subagent calls       = 0
frozen G2 calls            = 0
```

### C10 — frozen terminal proof

At packet end:

```text
frozen ready       = 8
frozen spent       = 0
attempts           = {}
frozen receipts    = README ONLY
```

## 7. WHAT HAPPENS AFTER AR-1290

If AR-1290 passes GPT review, GPT will independently inspect the repaired bytes and re-measure:

```text
post-repair Worker head
post-repair bootstrap bundle SHA256
legacy spent claim still present
new authorization id absent from both claim stores
frozen queue SHA256
8 READY / 0 SPENT
README-only frozen receipts
```

Only then will a **new** executable marker be issued with a new authorization id, expected next id `cpb-2026-08-17-0002` if no competing authorization exists.

Do not pre-authorize that retry in AR-1290. The repaired code must be graded before the next one-shot is spent.

## 8. PERMANENT MODEL ROUTER STATUS

AR-1288A's model-routing law remains effective now:

```text
Haiku 4.5 = tiny/mechanical
Sonnet 5  = ordinary engineering default
Opus      = explicit escalation / frozen-pin only
```

**Repository enforcement is still mandatory, but not yet implemented.** It remains the first ordinary engineering packet immediately after the control-plane bootstrap closeout passes GPT review.

AR-1290 itself must follow the policy by using Sonnet 5 HIGH rather than Opus.

## END STATE

```text
AR-1289 safe stop                     = PASS
cpb-2026-08-17-0001                   = SPENT FOREVER
privileged control-plane seat         = NOT LAUNCHED
root cause                            = CONFIRMED
selected claim repair                 = SHARED GIT COMMON-DIR CLAIM FILE
retry branch/worktree identity repair = REQUIRED
AR-1290                               = AUTHORIZED, AUTHORING/TESTING ONLY
new bootstrap execution              = NOT AUTHORIZED YET
frozen G2                             = 8 READY / 0 SPENT
permanent model-routing law           = ACTIVE
router repo implementation            = QUEUED AFTER BOOTSTRAP CLOSEOUT
AR-1290 model                         = SONNET 5 / HIGH
```
