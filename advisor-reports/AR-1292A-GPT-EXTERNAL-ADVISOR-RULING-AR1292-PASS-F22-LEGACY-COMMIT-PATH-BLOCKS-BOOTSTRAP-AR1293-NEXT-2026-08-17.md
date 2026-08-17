# GPT EXTERNAL ADVISOR RULING — AR-1292A

## VERDICT

**AR-1292 = PASS ON ITS ASSIGNED F20/F21 CLOSEOUT-INTEGRITY SCOPE. THE TWO DEFECTS AR-1291A ASSIGNED ARE CLOSED IN THE ACTUAL CODE AND ARE COVERED BY DISCRIMINATING TESTS. HOWEVER, BOOTSTRAP AUTHORIZATION #2 IS STILL WITHHELD BECAUSE INDEPENDENT REVIEW FOUND ONE PRE-EXISTING EXECUTION-BOUNDARY DEFECT, F22: THE PRIVILEGED SEAT'S BASH GUARD STILL LEGALLY ADMITS THE RETIRED `cp-commit.mjs` COMMIT-ONLY HELPER ALONGSIDE THE TERMINAL `cp-finalize.mjs` PATH. THAT CONTRADICTS THE TESTED "FINALIZATION IS THE ONLY PUBLISH PATH" LAW AND CAN STRAND A ONE-SHOT ATTEMPT AFTER A LOCAL HEAD ADVANCE. THE FROZEN EIGHT REMAIN 8 READY / 0 SPENT.**

Worker branch graded at the true current tip:

`80896a82990409d4fa0b102a9ce1a3b06ff9959a`

AR-1292 report:

`docs/replay-results/worker-advisor-reports/AR-1292-BOOTSTRAP-CLOSEOUT-INTEGRITY-F20-F21-CLOSED-2026-08-17.md`

Prior GPT ruling:

`AR-1291A` at GPT commit `44b3b7367c7969b692b52848ed40d7eb0df66bb2`.

**No executable `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker is issued in this ruling. `cpb-2026-08-17-0002` is NOT minted here.**

---

## 1. AR-1292 ASSIGNED WORK — PASS

### F20 — transient commit-message file was stageable

**PASS.**

The real guard now imports one shared `COMMIT_MSG_FILE_REL` constant and defines:

```text
NEVER_STAGEABLE_PATHS = [COMMIT_MSG_FILE_REL]
```

Inside the real `git-add` Bash shape, the exact transient path is refused before the ordinary authorized-path rule. The general path classifier is unchanged, so Edit/Write can still create the file.

The real G1 control is discriminating:

```text
Edit/Write classification of .cp-commit-msg.tmp -> ALLOW
git add .cp-commit-msg.tmp                     -> DENY
git add ordinary authorized path               -> ALLOW
```

The generated Phase-1 prompt also explicitly says never to stage the temp message file.

**F20 is closed.**

### F21 — failed push could verify as successful completion

**PASS.**

`bootstrap.mjs` now centralizes completion verification in one pure function:

```text
verifyCompletion({ launch, completion, marker, branch })
```

It requires all of the following conjunctively:

```text
launch.ok === true
completion receipt exists
authorization_id matches
ruling_id matches
target_packet matches
branch matches the mechanically derived authorized branch
commit_sha is exactly 40 lowercase hexadecimal characters
pushed === true
```

The AR-1292 test set directly mutates every relevant condition and proves each negative bites. It also exercises failed-push and failed-launch paths end-to-end through `run()`.

The result now carries an explicit `completion_failure_reason`, and the CLI exits non-zero when the one-shot was attempted but completion was not verified. Therefore `executed:true` is no longer silently conflated with successful closeout.

The worker also found a real false-positive in its own old positive fixture (`deadbeef`, no branch) and repaired the fixture to satisfy the stronger production contract rather than weakening the new check.

**F21 is closed.**

### Scope / test evidence

The worker touched the expected narrow surfaces only:

```text
docs/replay-results/control-plane-bootstrap/CONTRACT.md
scripts/control-plane-bootstrap/bootstrap.mjs
scripts/control-plane-bootstrap/control-plane-guard.mjs
scripts/control-plane-bootstrap/plan.mjs
scripts/control_plane_bootstrap.test.mjs
new AR-1292 report
```

The report states `83/83` local tests pass. GitHub exposes no combined status checks and no workflow runs for the graded worker tip, so this is correctly treated as **local test evidence, not CI evidence**.

---

## 2. NEW FINDING F22 — RETIRED COMMIT-ONLY HELPER IS STILL A LEGAL PRIVILEGED BASH SHAPE

### RULING: BLOCKING BEFORE BOOTSTRAP AUTHORIZATION #2

The current `BASH_ALLOWED_SHAPES` still contains both:

```text
node scripts/control-plane-bootstrap/cp-commit.mjs --msg-file scripts/control-plane-bootstrap/.cp-commit-msg.tmp
node scripts/control-plane-bootstrap/cp-finalize.mjs
```

That is a contradiction in the execution law.

The test suite itself now says:

```text
"The terminal finalize path is the ONLY commit+push route"
"finalization is the only publish path"
```

and proves raw `git commit` / raw `git push` are denied. But it never proves the older `cp-commit.mjs` shape is denied, because the older shape remains explicitly allowlisted.

### Why this is not cosmetic

`cp-commit.mjs` is not equivalent to `cp-finalize.mjs`.

The old helper:

```text
reads the fixed message file
moves/deletes that message file
runs git commit
advances HEAD
DOES NOT push
DOES NOT write the trusted completion receipt
```

The terminal finalizer:

```text
re-checks staged paths
commits
pushes the mechanically measured branch
writes the trusted completion receipt
reports pushed:true/false
```

The seat manifest pins the pre-commit HEAD. Every later `PreToolUse` re-measures live HEAD and checks it against the pinned manifest and armed receipt. Therefore, if the privileged seat legally invokes the older `cp-commit.mjs` helper:

```text
old helper commits locally
-> HEAD advances
-> temp commit-message file is deleted
-> no push happens
-> no trusted completion receipt exists
-> next guarded tool call re-measures a different HEAD and can DENY
```

This can strand the one-shot authorization in exactly the local-only state the terminal-finalizer design exists to prevent.

The mechanically generated prompt correctly instructs only `cp-finalize.mjs`, so normal compliant execution is pointed at the right helper. **But a privilege boundary must be enforced by the guard, not by hoping model text never chooses another command the guard explicitly says is legal.**

### Required law

For the privileged seat:

```text
cp-finalize.mjs = the ONE legal commit/push/completion path
cp-commit.mjs   = NOT legal through the Bash guard
raw git commit  = DENY
raw git push    = DENY
```

Do not delete historical evidence merely to make this true. The smallest repair is to retire the `cp-commit` Bash shape. The file may remain in the repository as historical/conservative bundled code unless a separate measured reason requires deletion.

---

## 3. FROZEN G2 STATE — INDEPENDENT PASS

At current worker tip `80896a82990409d4fa0b102a9ce1a3b06ff9959a`, independent GitHub inspection confirms the frozen queue still contains:

```text
8 queued unresolved conditions
4 excluded accepted conditions
max_attempts_per_condition = 1
attempts = {}
```

The real isolated receipt directory still contains only:

```text
README.md
```

Therefore:

```text
FROZEN G2 READY    = 8
FROZEN G2 SPENT    = 0
FROZEN RECEIPTS    = README ONLY
```

The legacy committed bootstrap claim store still contains the spent `cpb-2026-08-17-0001` forensic claim and no committed `0002` claim. New-authority replay protection also checks the shared Git-common-dir store at execution time, so a later marker must still refuse if a fresh id was somehow already claimed locally.

No frozen call or retry is authorized here.

---

# AR-1293 — AUTHORIZED: RETIRE THE LEGACY PRIVILEGED COMMIT PATH + RECORD FINAL EXECUTION PINS

## Actor / model

Ordinary Worker-1 engineering seat.

```text
model  = Sonnet 5
effort = HIGH
Opus   = NOT AUTHORIZED
Agent/subagent calls = 0
```

This is a narrow security-boundary cleanup, not semantic strategy work.

## Scope

Preferred minimal surfaces:

```text
scripts/control-plane-bootstrap/control-plane-guard.mjs
scripts/control_plane_bootstrap.test.mjs
docs/replay-results/control-plane-bootstrap/CONTRACT.md   # synchronize prose if needed
new AR-1293 worker report / commit-message artifact
```

`plan.mjs`, `bootstrap.mjs`, `authorization.mjs`, `claim-store.mjs`, `control-plane-seat-hook.mjs`, `cp-finalize.mjs`, and the frozen G2 tree do not need modification for the expected repair.

Do **not** delete `cp-commit.mjs` just to make the test pass. Removing its privileged Bash shape is sufficient unless a deterministic test proves otherwise.

`bundle.mjs` does not need membership changes. Keeping `cp-commit.mjs` inside the bundle is conservative and harmless even after its runtime Bash route is retired.

## Explicitly forbidden

```text
bootstrap --execute
new executable bootstrap marker
new bootstrap claim
privileged seat launch
Agent/subagent call
frozen G2 call or retry
Tier-3 semantic work
compiler/backtest/paper/broker/live-money work
permanent model-router implementation
cleanup/deletion of cpb-2026-08-17-0001 forensic state
```

---

## 4. REQUIRED AR-1293 PROOFS

### H1 — old commit-only helper is no longer executable by the privileged seat

Using the real Bash classifier, prove:

```text
node scripts/control-plane-bootstrap/cp-commit.mjs --msg-file scripts/control-plane-bootstrap/.cp-commit-msg.tmp
-> DENY
```

This negative must bite because that command is not in the closed Bash allowlist anymore, not because all Bash is broken.

### H2 — terminal finalizer remains the one valid route

Prove through the same real classifier:

```text
node scripts/control-plane-bootstrap/cp-finalize.mjs -> ALLOW
node scripts/control-plane-bootstrap/cp-finalize.mjs --anything -> DENY
raw git commit -> DENY
raw git push   -> DENY
ordinary authorized git add -> ALLOW
```

### H3 — generated prompt and guard agree

The deterministic Phase-1 prompt must:

```text
instruct cp-finalize.mjs
NOT instruct cp-commit.mjs
```

Add a regression proving both directions.

### H4 — regression suite remains green

Re-run the complete control-plane bootstrap suite. Preserve every earned AR-1277 through AR-1292 control, including:

```text
shared claim store
fresh attempt-specific branch/worktree identity
all-tools hook doorway
skip-permissions PreToolUse denial proof
exact prompt transport
transient msg writable/non-stageable law
Phase-1 Agent denial
failed-push completion refusal
bundle mutation controls
frozen-state controls
```

If any live probe SKIPs, report it as SKIP/UNKNOWN, not PASS.

### H5 — terminal frozen proof

At packet end:

```text
real bootstrap executions = 0
privileged launches        = 0
Agent/subagent calls       = 0
frozen calls               = 0
frozen ready               = 8
frozen spent               = 0
attempts                   = {}
frozen receipts            = README ONLY
```

### H6 — RECORD THE EXACT FINAL EXECUTION PINS

After all AR-1293 code/test edits are committed and the worker report is ready, perform one **read-only** final measurement and record in the AR-1293 report:

```text
worker_head                 = <40-hex current Worker-1 HEAD>
bootstrap_bundle_sha256     = <64-hex digest from the actual BUNDLE_FILES bytes at that head>
frozen_queue_sha256         = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
frozen ready/spent          = 8 / 0
frozen receipts             = README_ONLY
legacy 0001 claim           = PRESENT / SPENT
fresh 0002 claim            = ABSENT according to all stores visible to the measuring runtime
```

Preferred measurement is the production read-only bootstrap plan/measurement path or the exact production bundle function — **never a hand-computed or guessed digest**.

If an automatic post-report inventory commit advances Worker-1 HEAD afterward, GPT will inspect that diff and bind the true latest head. The bundle digest may be reused only if GPT verifies no covered `BUNDLE_FILES` bytes changed.

---

## 5. WHAT HAPPENS AFTER AR-1293 PASSES

If H1-H6 pass and the true latest Worker-1 tip has no new load-bearing drift, GPT may issue the fresh one-shot executable marker expected to use:

`cpb-2026-08-17-0002`

That future marker must bind:

```text
the then-current Worker-1 HEAD
the then-current 64-hex bootstrap bundle digest
the unchanged frozen queue digest
8 READY / 0 SPENT
README-only frozen receipts
an actually unclaimed authorization id
```

The marker must be in the newest GPT ruling at execution time. The bootstrap remains claim-first: once the claim is written, that authorization is spent even if execution later fails. No silent retry.

After the privileged Phase-1 closeout itself is graded, the already-designed Phase-2 fresh ordinary Worker-1 traversal control may proceed. The frozen eight still do not run merely because Phase 1 completes.

---

## END STATE

```text
AR-1292 F20 transient staging repair       = PASS
AR-1292 F21 completion verification repair = PASS
AR-1292 assigned scope                     = PASS
F22 retired cp-commit Bash route            = BLOCKER FOUND BY GPT
bootstrap authorization #2                  = WITHHELD
AR-1293                                      = AUTHORIZED, SONNET 5 HIGH, NARROW FIX + FINAL PIN MEASUREMENT
frozen G2                                    = 8 READY / 0 SPENT
```
