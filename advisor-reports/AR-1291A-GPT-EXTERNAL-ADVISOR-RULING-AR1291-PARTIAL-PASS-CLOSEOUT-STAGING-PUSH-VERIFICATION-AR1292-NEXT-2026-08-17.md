# GPT EXTERNAL ADVISOR RULING — AR-1291A

## VERDICT

**AR-1291 = PARTIAL PASS. F16/F18/F19 ARE SUBSTANTIVELY CLOSED AND THE F17 WRITE PATH EXISTS, BUT THE EXECUTABLE BOOTSTRAP RETRY REMAINS ON HOLD. TWO NEW DETERMINISTIC CLOSEOUT DEFECTS WERE FOUND IN THE ACTUAL CODE: THE FIXED COMMIT-MESSAGE TEMP FILE IS STAGEABLE, AND THE SUPERVISING BOOTSTRAP CAN MARK A COMPLETION RECEIPT VERIFIED WITHOUT REQUIRING A SUCCESSFUL PUSH. THE FROZEN EIGHT REMAIN 8 READY / 0 SPENT.**

Worker branch graded at the true current tip after the post-report system-inventory commit:

`81b9d59740c55bb8f295409a8b08b0e3cf4f84d0`

AR-1291 report commit:

`0c49dca24870b8f334343dd4134405edab021d01`

Prior GPT ruling:

`8dde6c16f25631b6a0337987b9668b51d3ea4cff` (`AR-1290A`).

No executable `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker is issued in this ruling.

---

## 1. WHAT AR-1291 GOT RIGHT

Independent GitHub inspection confirms the packet made the intended execution-plumbing changes rather than merely reporting them.

### F16 — report path

PASS.

The deterministic Phase-1 prompt now requires the control-plane seat to write its closeout report under:

`docs/replay-results/worker-advisor-reports/`

and that directory is in the planned authorization surface.

### F18 — exact frozen-prompt transport helper

PASS, subject to final execution grading later.

The new helper:

`scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py`

is a fixed no-argument command. It imports/reuses the canonical native-call derivation, checks the committed frozen native-call manifest, writes byte-oriented `.prompt.bin` transport artifacts plus an index, uses create-only/idempotent semantics, and refuses mismatched pre-existing bytes.

The control-plane Bash law admits exactly the fixed helper command, not arbitrary Python arguments.

The helper is included in the load-bearing bootstrap bundle. The bundle member list is now generated from the actual `BUNDLE_FILES` source and contains ten files.

### F19 — Phase 1 / Phase 2 separation

PASS.

The generated privileged-seat prompt now explicitly says Phase 1 only and explicitly forbids Agent/subagent dispatch and live calibration. This is the correct architecture: the privileged repair seat repairs/configures/materializes; a later fresh normal Worker-1 session performs the one cheap discriminating `Agent -> PreToolUse` control.

The control-plane guard itself also continues to categorically deny `Agent`, `Task`, and `PowerShell`, preserving the privileged seat's smaller blast radius.

### F17 — fixed commit-message path

PARTIAL PASS.

The exact temp path now exists in the authorization plan and the prompt sequences creation before finalization. That closes the original inability to create the message file. However, the same choice exposed a second-order staging defect described below.

### Test evidence

AR-1291 reports `76/76` local tests passing. The test source contains the new AR-1291 controls and the expected fixed-command/phase-split assertions.

GitHub exposes **no combined status checks and no workflow runs** for the current worker tip. Therefore `76/76` is accepted as local worker evidence, not mislabeled as CI.

---

## 2. NEW FINDING F20 — TRANSIENT COMMIT-MESSAGE FILE IS STAGEABLE

### RULING: BLOCKING BEFORE BOOTSTRAP RETRY

Current policy puts:

`scripts/control-plane-bootstrap/.cp-commit-msg.tmp`

inside the same `allowed_paths` set used by both Edit/Write path checks **and** the generic `git add <path>` Bash shape.

That means the privileged seat may legally do:

`git add scripts/control-plane-bootstrap/.cp-commit-msg.tmp`

The Phase-1 prompt currently says to stage allowed paths one at a time. Nothing load-bearing excludes this transient file.

`cp-finalize.mjs` then measures staged paths before deleting the worktree copy of the message file. Removing the working-tree file does not remove an already-staged addition from the index. Therefore the supposedly transient commit-message file can ride into the final control-plane commit.

This is deterministic and requires no malicious model behavior; a literal reading of “stage allowed paths” is enough.

### Required law

The fixed message file must be:

```text
writable by the seat = YES
stageable by the seat = NO
committable by finalizer = NO
```

Do not solve this by removing the path from Edit/Write authority, because the seat must still create it.

Preferred minimal repair: keep the path writable, but make the `git-add` classifier categorically refuse that exact transient path before applying the ordinary authorized-path rule. Also make the generated prompt explicitly say **never stage the commit-message temp file**.

---

## 3. NEW FINDING F21 — FAILED PUSH CAN STILL LOOK “COMPLETION VERIFIED”

### RULING: BLOCKING BEFORE BOOTSTRAP RETRY

`cp-finalize.mjs` correctly records whether publication succeeded:

```text
pushed
push_detail
commit_sha
```

and exits non-zero on push failure.

But the supervising `bootstrap.mjs` currently computes `completion_verified` from only:

```text
authorization_id
ruling_id
target_packet
```

It does **not** require `pushed === true`.

Therefore this execution is currently possible:

```text
control-plane seat commits locally
-> push fails
-> cp-finalize writes an identity-correct receipt with pushed:false
-> supervising bootstrap reads it
-> completion_verified becomes true
```

That is unacceptable for a one-shot bootstrap whose authorization is permanently spent once claimed. The repair could be stranded only in a local worktree while the supervisor reports the receipt as verified.

### Required law

A trusted completion must require, at minimum:

```text
launch succeeded
receipt schema/identity matches authorization
receipt branch matches the derived authorized branch
commit_sha is a real 40-lowercase-hex SHA shape
pushed === true
```

If any of those fail, `completion_verified` must be false and the result must not be presented as successful closeout.

Do not “repair” this by retrying push invisibly inside the supervisor. One execution remains one execution; expose the failure and require the next GPT decision if the authorization has already been claimed.

---

## 4. FROZEN G2 STATE — INDEPENDENT PASS

At current worker tip `81b9d597...`, the real queue still contains exactly eight queued unresolved conditions, four excluded accepted conditions, `max_attempts_per_condition = 1`, and:

`attempts = {}`

The real isolated receipt directory still contains only `README.md`.

Therefore:

```text
FROZEN G2 READY    = 8
FROZEN G2 SPENT    = 0
FROZEN RECEIPTS    = README ONLY
```

No new frozen authorization is issued here.

The historical bootstrap authorization `cpb-2026-08-17-0001` remains permanently spent. Nothing in AR-1291 changes that.

---

# AR-1292 — AUTHORIZED: FINAL BOOTSTRAP CLOSEOUT-INTEGRITY REPAIR

## Actor / model

Ordinary Worker-1 engineering seat.

```text
model  = Sonnet 5
 effort = HIGH
Opus   = NOT AUTHORIZED
Agent/subagent calls = 0
```

The user's Claude Code default is now Sonnet 5, so no special model-switch packet is required unless the runtime itself reports a contradiction.

## Scope

Only the minimum surfaces necessary to close F20/F21 and prove them:

```text
scripts/control-plane-bootstrap/control-plane-guard.mjs
scripts/control-plane-bootstrap/plan.mjs
scripts/control-plane-bootstrap/bootstrap.mjs
scripts/control_plane_bootstrap.test.mjs
docs/replay-results/control-plane-bootstrap/CONTRACT.md   # only if contract prose needs synchronization
new AR-1292 report / commit-message artifacts
```

`bundle.mjs` need not change merely because covered file bytes change; the bundle digest will naturally change. Modify bundle membership only if a genuinely new load-bearing file is introduced, which is not expected.

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
model-router repository implementation
cleanup/deletion of cpb-2026-08-17-0001 forensic state
```

---

## 5. REQUIRED AR-1292 PROOFS

### G1 — writable but non-stageable temp message

Prove all three with the real classifiers:

```text
Edit/Write target scripts/control-plane-bootstrap/.cp-commit-msg.tmp -> ALLOW
Bash: git add scripts/control-plane-bootstrap/.cp-commit-msg.tmp      -> DENY
Bash: git add <ordinary authorized Phase-1 output>                    -> ALLOW
```

The negative must bite specifically because the path is the transient message file, not because all `git add` is accidentally disabled.

### G2 — generated prompt cannot invite staging the temp file

The mechanically generated Phase-1 prompt must state that the temp commit-message file is never staged.

Add a test that fails if the prompt loses that instruction.

### G3 — failed push is not verified

Factor completion verification into a testable deterministic function if useful; do not duplicate the logic.

Required controls:

```text
identity-correct receipt + pushed:false                  -> completion_verified FALSE
identity-correct receipt + pushed:true + bad/missing SHA -> FALSE
wrong branch                                             -> FALSE
wrong auth/ruling/packet                                 -> FALSE
launch failure                                           -> FALSE
fully correct receipt + pushed:true + valid SHA          -> TRUE
```

### G4 — no false success wording

If the supervised launch/finalize path fails, the returned bootstrap result must make the failure visible. `executed:true` may truthfully mean the one-shot execution was attempted, but it must not be conflated with successful completion.

### G5 — regressions remain green

Re-run the complete control-plane bootstrap suite after the fixes. Preserve all AR-1277 through AR-1291 negative controls, including shared claim-store, attempt-specific names, fixed transport helper, Phase-1 Agent denial, and bundle mutation checks.

### G6 — no execution / frozen terminal proof

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

Report local tests honestly as local tests. Do not call them CI unless GitHub Actions/status evidence exists.

---

## 6. AFTER AR-1292 PASSES

GPT will re-read the **true worker branch tip after the report and any automatic inventory commit**, not a pre-report SHA.

Then GPT will independently re-measure:

```text
worker head
bootstrap bundle SHA256
legacy spent cpb-2026-08-17-0001 claim
absence of fresh cpb-2026-08-17-0002 claim according to available evidence
frozen queue SHA256
8 READY / 0 SPENT
README-only frozen receipts
```

If those remain clean and AR-1292 grades PASS, the next ruling may issue the fresh one-shot bootstrap authorization expected to use:

`cpb-2026-08-17-0002`

That marker must bind the then-current head and then-current bundle, not any SHA written in this ruling.

The permanent model-router repository implementation remains queued immediately after the control-plane/bootstrap closeout. The routing law itself remains active now:

```text
Haiku 4.5 = tiny/mechanical
Sonnet 5  = ordinary engineering default
Opus      = explicit hard/frozen escalation only
```

---

## END STATE

```text
AR-1291 F16 report path                  = PASS
AR-1291 F18 prompt transport             = PASS
AR-1291 F19 phase split                  = PASS
AR-1291 F17 temp-message creation        = PARTIAL PASS
F20 temp-message stageability            = BLOCKER
F21 push-success verification            = BLOCKER
AR-1291 overall                          = PARTIAL PASS
fresh bootstrap marker #2                = WITHHELD
AR-1292                                  = AUTHORIZED, SONNET 5 HIGH, AUTHORING/TESTING ONLY
frozen G2                                = 8 READY / 0 SPENT
permanent model-routing law              = ACTIVE
```
