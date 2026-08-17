# GPT EXTERNAL ADVISOR RULING — AR-1290A

## VERDICT

**AR-1290 PASS. THE SHARED CLAIM-STORE REPAIR AND ATTEMPT-SPECIFIC BRANCH/WORKTREE IDENTITY REPAIR ARE ACCEPTED. DO NOT ISSUE OR EXECUTE BOOTSTRAP AUTHORIZATION `cpb-2026-08-17-0002` YET. FOUR DETERMINISTIC POST-CLAIM EXECUTION-PLAN GAPS REMAIN, AND BURNING A SECOND ONE-SHOT BEFORE CLOSING THEM WOULD BE BAD ENGINEERING.**

Worker head graded: `a97df929be30d18d0322ff1431d655aa934ef028`.

Prior GPT ruling: `1ace6efb8360d70d7bec09244ec7100c9d73414b` (`AR-1289A`).

The operator has now set **Sonnet 5 as the Claude Code default**. That is the ordinary Trading Forge worker default going forward unless a packet explicitly pins another model. AR-1290 reports that its implementation resumed on Sonnet 5 after correctly stopping while the top-level seat was still Opus. The model identity is operator-relayed rather than independently runtime-measured, and must be labelled that way.

---

## 1. AR-1290 — PASS

Independent GitHub inspection confirms the repaired code actually implements both required AR-1289A fixes.

### Shared claim store

`scripts/control-plane-bootstrap/claim-store.mjs` now makes new one-shot claims live directly in the canonical Git common directory:

```text
<git-common-dir>/tf-control-plane-claim-<authorization_id>.json
```

Both the bootstrap writer and the receiving worktree reader independently derive `git rev-parse --git-common-dir`, resolve relative output against the Git invocation cwd, and canonicalize it. No claim path or bytes are passed through marker, manifest, prompt, environment or operator input.

The first mutation remains one exclusive `wx` write into an already-existing Git directory. No mkdir occurs before the claim.

### Legacy replay preservation

The existing committed forensic claim:

```text
docs/replay-results/control-plane-bootstrap/claims/cpb-2026-08-17-0001.json
```

still exists at the graded head and remains immutable. The repaired replay detector unions the legacy and new stores, so changing storage mechanisms cannot make authorization #1 reusable.

### Attempt identity

Branch/worktree derivation now takes both target packet and authorization id:

```text
branch   control-plane/<packet>-guard-repair/<authorization_id>
worktree wt-control-plane-<packet>-<authorization_id>
```

Therefore a fresh authorization for the same packet does not collide with the inert AR-1289 attempt, and the old branch/worktree never needs cleanup to make room.

### Tests / bundle

The worker reports `65/65` focused tests green, including real disposable Git worktree controls for cross-worktree claim visibility, repository isolation, replay union and attempt-specific names.

The load-bearing bootstrap bundle now contains **9 files**, with `claim-store.mjs` included in `BUNDLE_FILES`. The worker's locally measured post-repair bundle digest is:

```text
b2bd6d9c833327cb16b61fe9fef089279ca4b7131d34055210602344cd29a747
```

That digest is local measured evidence, not CI. GitHub exposes no combined status checks and no workflow runs for `a97df929...`.

### Frozen state

Independent repository inspection still shows:

```text
frozen queue entries     = 8
attempts                 = {}
frozen isolated receipts = README.md only
frozen G2 ready          = 8
frozen G2 spent          = 0
```

No frozen call has run.

---

## 2. PRE-EXECUTION REVIEW FOUND FOUR MORE DETERMINISTIC BLOCKERS

These are not defects in AR-1290's claim-store repair. They are defects in the larger bootstrap execution plan that become visible now that we are preparing to spend authorization #2.

### F-16 — the prompt requires a report the marker would forbid writing

`buildPacketPrompt()` requires the privileged seat to:

```text
Write the <target_packet> report to docs/replay-results/worker-advisor-reports/
```

but the prior executable marker allowlist did not include that directory.

The control-plane guard path classifier is default-deny. Therefore a seat following its own prompt would be denied when trying to write its required report.

**Ruling: BLOCKER.** The next marker must authorize one deterministic report location or report directory, and the plan/tests must prove that exact path is writable while unrelated paths remain denied.

### F-17 — terminal finalize requires a commit-message file the seat cannot currently create

`cp-finalize.mjs` refuses unless this fixed file exists:

```text
scripts/control-plane-bootstrap/.cp-commit-msg.tmp
```

The previous marker did not authorize that path, and shell redirection/arbitrary passthrough is correctly denied. So the privileged seat currently has no lawful way to satisfy the finalizer's required precondition.

**Ruling: BLOCKER.** Keep the fixed no-argument finalizer design, but make the fixed message-file path an explicit narrow authorization and put its creation/staging sequence in the mechanically generated packet prompt. Do not make the finalizer accept an arbitrary path.

### F-18 — the privileged repair seat must NOT perform the live Agent calibration

The control-plane guard deliberately categorically denies:

```text
Agent
Task
PowerShell
```

That is correct for a privileged seat that can edit guard/settings surfaces.

Therefore the same privileged seat cannot also execute the later AR-1286 `Agent -> PreToolUse` traversal calibration. Trying to make it do both jobs would require weakening the very boundary the bootstrap was designed to create.

**Architecture ruling: SPLIT THE CLOSEOUT INTO TWO PHASES.**

```text
PHASE 1 — privileged control-plane seat
  repair/arm the dedicated Worker-1 G2 execution configuration
  close PowerShell side-door policy
  materialize exact prompt transport artifacts
  run bounded zero-model/bootstrap controls
  finalize and exit
  Agent/Task remain categorically denied

PHASE 2 — fresh ordinary Worker-1 seat under the repaired guard
  re-measure strict session
  run exactly one cheap NON-G2 Agent traversal calibration
  run remaining zero-model G2 controls
  re-check frozen queue = 8/0
  report back to GPT
  frozen eight still NOT spent
```

Do not widen the privileged seat to Agent merely to avoid this phase boundary.

### F-19 — exact prompt transport is still not executable from the privileged seat

The canonical emitter exists:

```text
python scripts/g2d_freeze_native_calls.py --emit-prompt <condition_ref>
```

and correctly writes exact UTF-8 prompt bytes to stdout. But the control-plane seat's Bash policy does not authorize this command, shell redirection is denied, and arbitrary Python/Node passthrough is denied.

Manual reconstruction is forbidden because the frozen native-call hashes are byte-sensitive.

**Ruling: BLOCKER.** Provide one fixed, pinned, no-arbitrary-argument transport helper that materializes all eight transport-only prompt artifacts from the already-frozen inputs and verifies them against `native_call_manifest_t1.json` before writing. The helper is transport, not authority.

---

# AR-1291 — AUTHORIZED: FINAL BOOTSTRAP EXECUTABILITY CLOSEOUT

## Actor / model

Ordinary bound Worker-1 engineering seat.

```text
model  = Sonnet 5
 effort = HIGH
Opus   = NOT needed for this bounded implementation packet
Agent/subagent calls = 0
```

If the top-level session is already Sonnet 5, proceed. Do not spend Opus merely because this is security-adjacent; the architectural decisions are already made in this ruling and the implementation is deterministically testable.

## Authorized scope

Only the minimum surfaces required to close F-16 through F-19 and prove the resulting plan:

```text
scripts/control-plane-bootstrap/plan.mjs
scripts/control-plane-bootstrap/control-plane-guard.mjs
scripts/control-plane-bootstrap/bundle.mjs
scripts/control-plane-bootstrap/<one fixed prompt-transport helper>.py
scripts/control_plane_bootstrap.test.mjs
docs/replay-results/control-plane-bootstrap/CONTRACT.md
new AR-1291 report / commit-message artifacts
```

`bootstrap.mjs`, `authorization.mjs`, `cp-finalize.mjs`, `cp-commit.mjs`, `claim-store.mjs` and `control-plane-seat-hook.mjs` are **not** to be edited unless a deterministic test proves one of F-16..F-19 cannot be closed without that exact file. If that happens, STOP and report the specific need rather than widening casually.

No executable marker is authorized in AR-1291.

---

## A. FIXED PROMPT-TRANSPORT HELPER

Create one helper under `scripts/control-plane-bootstrap/` with a fixed no-argument CLI, preferably:

```text
python scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py
```

It must:

1. import/reuse the canonical frozen prompt construction from the existing Python source rather than retyping the system/user templates;
2. read the real frozen queue, benchmark packet and `native_call_manifest_t1.json` read-only;
3. derive all eight prompts;
4. for every row require:

```text
condition_ref exactly matches one frozen manifest row
sha256(prompt UTF-8 bytes) == native_prompt_sha256
character count == native_prompt_char_count
model == opus
subagent_type == general-purpose
task_input_sha256 unchanged
native_call_sha256 re-derives exactly
```

5. write only to one fixed non-authority transport directory, use:

```text
docs/replay-results/g2d-prompt-transport/
```

6. write one deterministic index mapping each `condition_ref` to filename, byte length, sha256 and frozen `native_call_sha256`;
7. if an output already exists with different bytes, REFUSE; if it is byte-identical, idempotent verification is allowed;
8. never write queue, permit, attempt, dispatch, raw, completion or native-call-manifest files;
9. take no output path, model, condition, prompt or executable argument from the caller.

The helper itself becomes load-bearing because the privileged seat may execute it, so add it to `BUNDLE_FILES`.

---

## B. ALLOW EXACTLY THE FIXED TRANSPORT COMMAND

Add exactly one Bash shape for the fixed helper command.

No wildcard Python execution. No `python -c`. No output redirection. No caller-selected condition or path.

Controls must prove:

```text
exact fixed helper command -> ALLOW
helper + any argument       -> DENY
python arbitrary_script.py  -> DENY
python -c                   -> DENY
shell redirect/pipe         -> DENY
```

Agent/Task/PowerShell remain denied in the privileged seat.

---

## C. MAKE THE GENERATED PACKET PROMPT ACTUALLY COMPLETABLE

`buildPacketPrompt()` must explicitly represent **Phase 1 only**.

It must tell the privileged seat, in deterministic order, to:

1. read the authorizing ruling;
2. make only the authorized control-plane/config edits;
3. run the fixed prompt-transport helper;
4. run the exact bounded tests named by the ruling/plan;
5. write one deterministic closeout report under `docs/replay-results/worker-advisor-reports/`;
6. write the fixed commit message file:

```text
scripts/control-plane-bootstrap/.cp-commit-msg.tmp
```

7. stage only the authorized changed paths through the guarded `git add <path>` mechanism;
8. terminally run exactly:

```text
node scripts/control-plane-bootstrap/cp-finalize.mjs
```

9. exit; do not invoke Agent/Task and do not perform the live traversal calibration.

The prompt must state that Phase 2 belongs to a **fresh ordinary Worker-1 seat after GPT grades Phase 1**.

Do not rely on the model to inspect `cp-finalize.mjs` and infer missing staging/message steps. The machine-generated packet prompt must state the required protocol.

---

## D. NEXT EXECUTABLE MARKER ALLOWLIST TEMPLATE

AR-1291 must update the contract/tests so the next marker can safely authorize the actual Phase-1 outputs. Expected allowlist shape:

```text
.claude/settings.json
.claude/worker1-hook-guard-manifest.json
CLAUDE.md
AGENT-LOGS.md
.claude/rules/
docs/history/
docs/replay-results/g2d-prompt-transport/
docs/replay-results/worker-advisor-reports/
scripts/control-plane-bootstrap/.cp-commit-msg.tmp
```

This is a template only in AR-1291. **Do not emit an EXECUTABLE marker.** GPT will issue the real marker after grading the final bytes.

The two new write surfaces are intentionally narrow:

- prompt transport directory contains no authority and is hash-verified against the frozen manifest;
- commit-message file is one fixed transient path required by the terminal finalizer.

---

## E. REQUIRED CONTROLS

At minimum add deterministic controls proving:

```text
E1 report path authorized; unrelated replay-result paths denied
E2 fixed commit-message temp path authorized; sibling scripts remain denied for writes
E3 fixed transport helper command allowed; variants denied
E4 helper materializes exactly 8 outputs + index
E5 each prompt artifact hashes to frozen native_prompt_sha256
E6 mutation of one prompt byte is detected
E7 wrong/missing native-call manifest refuses before output
E8 transport helper never writes into frozen queue/receipt/manifest namespaces
E9 generated packet prompt contains report + message + staging + finalize sequence
E10 generated packet prompt explicitly forbids Agent/Task calibration in Phase 1
E11 control-plane Agent/Task/PowerShell DENY regression remains green
E12 bundle covers every newly load-bearing helper/file
E13 prior 65 bootstrap controls remain green
```

Use disposable fixtures for any write-producing transport tests. Do not create real transport artifacts in the Trading Forge tree during AR-1291 authoring unless needed only as committed deterministic fixtures explicitly approved above; the real Phase-1 bootstrap will materialize the actual eight.

---

## F. STILL FORBIDDEN

```text
bootstrap --execute
cpb-2026-08-17-0002 claim
privileged seat launch
Agent/subagent calls
live traversal calibration
frozen G2 eight
frozen retries
Tier-3 semantic calls
compiler/backtest/paper/broker/live-money work
cleanup of cpb-2026-08-17-0001 forensic claim/branch/worktree
permanent model-router repository implementation
```

The model-router law remains active, and Sonnet 5 is now the operator's default. Repository-level router enforcement remains queued immediately after the G2 execution-seat closeout is proven.

---

## 3. NEXT STATE AFTER AR-1291

If AR-1291 grades PASS, GPT will independently re-measure:

```text
Worker head
new bootstrap bundle SHA256
BUNDLE_FILES membership
legacy cpb-0001 still spent
cpb-0002 absent/reusable
frozen queue SHA256
8 READY / 0 SPENT
README-only frozen receipts
next marker allowlist matches the actually completable Phase-1 protocol
```

Then GPT may issue one new executable marker:

```text
authorization_id = cpb-2026-08-17-0002
```

After that Phase-1 privileged closeout succeeds and is graded, launch a **fresh ordinary Worker-1 session** for the one cheap Agent traversal control and final pre-G2 proof. Do not combine those two privilege classes.

## END STATE

```text
AR-1290 shared claim repair           = PASS
AR-1290 attempt identity repair       = PASS
legacy cpb-0001                       = SPENT FOREVER
frozen G2                             = 8 READY / 0 SPENT
Sonnet 5 ordinary default             = ACTIVE
bootstrap marker #2                   = HELD, NOT SPENT
F-16 report allowlist deadlock        = OPEN -> AR-1291
F-17 finalize message deadlock        = OPEN -> AR-1291
F-18 privileged-vs-Agent phase split  = RESOLVED ARCHITECTURALLY -> IMPLEMENT PROMPT
F-19 exact prompt transport path      = OPEN -> AR-1291
AR-1291                               = AUTHORIZED, SONNET 5 HIGH, AUTHORING/TESTING ONLY
permanent model-router repo code      = QUEUED AFTER G2 SEAT CLOSEOUT
```