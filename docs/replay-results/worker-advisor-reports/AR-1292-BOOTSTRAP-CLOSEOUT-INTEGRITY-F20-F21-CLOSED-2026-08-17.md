# AR-1292 — BOOTSTRAP CLOSEOUT-INTEGRITY REPAIR: F20/F21 CLOSED, AUTHORING/TESTING ONLY

**Both closeout-integrity defects AR-1291A found are repaired. F20 (the transient commit-message
file was stageable) is a categorical Bash-shape refusal, narrow to the one path and the one shape —
Edit/Write still allows creating the file. F21 (a failed push could still read as
`completion_verified: true`) is fixed with one pure, directly-tested function requiring launch
success, receipt identity, the derived branch, a real 40-hex commit SHA, and `pushed === true`, all
conjunctive. 83/83 tests pass (76 pre-existing + 7 new AR-1292 controls). Zero bootstrap executions,
zero privileged launches, zero Agent/subagent calls, zero frozen G2 spend. Frozen eight untouched:
8 READY / 0 SPENT.**

**Model:** Sonnet 5, HIGH effort, per AR-1291A's routing law ("no special model-switch packet is
required unless the runtime itself reports a contradiction" — none did).

---

## 1. WHAT WAS BROKEN, AND WHAT CHANGED

### F20 — the transient commit-message file was stageable

`scripts/control-plane-bootstrap/.cp-commit-msg.tmp` must be in `allowed_paths` so Edit/Write can
create it (`cp-finalize.mjs` — unmodified, out of scope — hard-requires it to exist). But
`allowed_paths` is also what the `git-add` Bash shape checks, through the *same*
`classifyControlPlanePath` function Edit/Write uses. So `git add
scripts/control-plane-bootstrap/.cp-commit-msg.tmp` was a legal command, and `cp-finalize.mjs`
deleting the working-tree copy of the message file does not unstage an already-staged addition — a
literal reading of "stage the allowed paths one at a time" (the old prompt's own words) could carry
the transient file into the final control-plane commit.

**Fix:** `control-plane-guard.mjs` now exports `NEVER_STAGEABLE_PATHS = [COMMIT_MSG_FILE_REL]`
(the constant itself now lives in `plan.mjs`, exported, so the guard and the prompt-builder share
one literal rather than two that could drift). Inside `classifyControlPlaneBash`, the `git-add`
shape specifically — not the general path classifier, not Edit/Write — checks this list *before*
the ordinary allowlist rule and refuses categorically. `AR1292-G1` proves all three required
directions with the real functions: Edit/Write still ALLOWs the path; `git add` on that exact path
DENYs even though the path is in `allowedPaths`; `git add` on an ordinary authorized path still
ALLOWs through the same shape. The generated prompt (`buildPacketPrompt`) now has an explicit line
telling the seat never to stage it (`AR1292-G2`).

### F21 — a failed push could still verify as a complete closeout

`bootstrap.mjs`'s supervising `run()` computed `completion_verified` from only
`authorization_id`/`ruling_id`/`target_packet` on the completion receipt. `cp-finalize.mjs`
(unmodified) already records `pushed`/`push_detail`/`commit_sha`/`branch` correctly and exits
non-zero on a push failure — but nothing on the supervisor side required `pushed === true`, checked
`branch`, or validated `commit_sha`'s shape, and nothing required the supervised launch itself to
have succeeded. A local-only commit (network blip, bad credentials, wrong remote) could therefore
produce an identity-correct receipt that still verified TRUE, stranding the repair in a worktree
nobody reads while the one-shot authorization was already permanently spent.

**Fix:** new exported pure function `bootstrap.mjs:verifyCompletion({ launch, completion, marker,
branch })`, used by `run()` in place of the old inline boolean. It requires, conjunctively: launch
succeeded; the receipt exists; `authorization_id`/`ruling_id`/`target_packet` match; `branch`
matches the derived authorized branch; `commit_sha` is a real 40-lowercase-hex shape; `pushed ===
true`. `AR1292-G3` exercises all seven negative directions plus the positive directly against the
pure function — no process/git/fs plumbing needed to prove the logic. `AR1292-G3b`/`G3c` exercise
the same thing end-to-end through `run()` with a failed-push receipt and a failed launch
respectively, each producing a distinct `completion_failure_reason`.

**G4 — no false success wording.** `run()`'s result now also carries `completion_failure_reason`
(`'launch_failed' | 'no_completion_receipt' | 'completion_receipt_did_not_verify' | null`), so
`executed: true` (which correctly still means "the one-shot was attempted — the claim is already
spent") can never be silently read as "succeeded." The CLI section now emits a distinct non-zero
exit (4) and a stderr message when execution happened but verification did not, separate from the
existing `authorized: false` refusal path (exit 3). `AR1292-G4` proves the fully-correct path still
verifies TRUE with `completion_failure_reason: null`.

**A real false-positive the fixture itself was carrying.** `recordingEffects()`'s default
`readCompletionReceipt` — the POSITIVE control every existing end-to-end test builds on
(`C6b`, and now `AR1292-G5`) — returned `commit_sha: 'deadbeef'` and no `branch` field at all. Under
the OLD (loose) check this passed, because nothing looked at either field: it was itself an instance
of the exact false-green class F21 named, just in test fixture form rather than production. Fixed to
a genuinely valid receipt (`branch: deriveBranch('AR-1279', 'cpb-2026-08-16-0001')`, `commit_sha:
'a'.repeat(40)`) — `AR1292-G5` re-asserts `C6b`'s exact original claim (the effects-call sequence
and `completion_verified === true`) now holds under the *stricter* check, which is the
discriminating proof that the fixture upgrade repaired a real gap rather than merely satisfying a
new assertion.

**Files touched**, exactly the authorized surface (AR-1291A §"Scope"), nothing else:

```
MOD    scripts/control-plane-bootstrap/control-plane-guard.mjs
MOD    scripts/control-plane-bootstrap/plan.mjs
MOD    scripts/control-plane-bootstrap/bootstrap.mjs
MOD    scripts/control_plane_bootstrap.test.mjs
MOD    docs/replay-results/control-plane-bootstrap/CONTRACT.md
```

`git diff --stat`: 5 files changed, 227 insertions(+), 13 deletions(-). `bundle.mjs` was **not**
touched — no new load-bearing file was introduced, matching AR-1291A's "modify bundle membership
only if... not expected." `[MEASURED HERE]` — reviewed the full diff of every touched file before
staging; `authorization.mjs`, `cp-finalize.mjs`, `cp-commit.mjs`, `claim-store.mjs` and
`control-plane-seat-hook.mjs` are untouched.

---

## 2. G1–G6 — EACH PROOF, WITH ITS COMMAND

Command for the full suite: `node --test scripts/control_plane_bootstrap.test.mjs`

```
tests 83
pass  83
fail  0
```

| Proof | What it shows | Test |
|---|---|---|
| G1 | Edit/Write ALLOW on the msg path; `git add` on that exact path DENY; `git add` on an ordinary path ALLOW | `AR1292-G1` |
| G2 | the generated prompt states the temp file is never staged | `AR1292-G2` |
| G3 | `verifyCompletion` is conjunctive across all 6 required conditions, direct unit proof | `AR1292-G3` |
| G3 (end-to-end) | a failed-push receipt refuses through `run()`, with reason `completion_receipt_did_not_verify` | `AR1292-G3b` |
| G3 (end-to-end) | a launch failure refuses through `run()`, with reason `launch_failed` — distinct from a bad receipt | `AR1292-G3c` |
| G4 | `executed: true` never reads as success alone; the fully-correct path verifies TRUE with reason `null` | `AR1292-G4` |
| G5 | all 76 pre-existing controls, including the exact `C6b` claim, remain green under the stricter check | `AR1292-G5` + full-suite count above |
| G6 | zero executions/launches/Agent calls/frozen calls this packet; frozen 8/0 unchanged | this report §3 |

---

## 3. TERMINAL FROZEN PROOF (unchanged by this packet, re-measured)

This packet made no filesystem or git change to the real frozen queue/receipt/manifest tree — every
new test constructs its own fake `io`/`effects` (`fakeIo`, `recordingEffects`) exactly as every prior
control in this suite does; nothing in AR-1292's scope touches
`docs/replay-results/svkm-extraction-certified/`.

```
real bootstrap executions = 0
privileged launches       = 0
Agent/subagent calls      = 0
frozen calls               = 0
frozen ready               = 8
frozen spent                = 0
attempts                    = {}
frozen receipts             = README ONLY
```

`76/76` (AR-1291) and now `83/83` (AR-1292) are reported as **local tests**, not CI — GitHub exposes
no combined status checks or workflow runs for this branch, matching AR-1291A's own instruction not
to mislabel local evidence as CI.

---

## 4. WHAT THIS PACKET DID NOT DO (forbidden list, AR-1291A §"Explicitly forbidden")

`bootstrap --execute` — never invoked. New executable marker — none issued. New bootstrap claim —
none. Privileged seat launch — never. `Agent`/`Task` calls — zero. Frozen G2 call or retry — none.
Tier-3 semantic work — none. Compiler/backtest/paper/broker/live-money work — none. Model-router
repository implementation — not started (queued). `cpb-2026-08-17-0001`'s forensic branch/worktree/
claim — untouched.

## END STATE

```
F20 commit-message stageability   = CLOSED (categorical git-add refusal, Edit/Write unaffected)
F21 push-success verification     = CLOSED (verifyCompletion, conjunctive, directly tested)
tests                             = 83/83 (76 pre-existing + 7 new)
frozen G2                         = 8 READY / 0 SPENT, unchanged
next executable marker            = NOT MINTED — GPT's to issue after grading this packet
```
