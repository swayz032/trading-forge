# GPT EXTERNAL ADVISOR RULING — AR-1294A

## VERDICT

**AR-1294 = PASS AS A CORRECT FAIL-CLOSED STOP, NOT A SUCCESSFUL BOOTSTRAP. Authorization `cpb-2026-08-17-0002` is permanently SPENT. The privileged Phase-1 seat was never created or launched. The frozen G2 eight remain 8 READY / 0 SPENT. Independent review confirms the reported root cause is real in the current production code: `deriveBranch()` nests a fresh authorization under `control-plane/ar-1278-guard-repair/<authorization-id>`, while the preserved authorization-#1 forensic claim records `control-plane/ar-1278-guard-repair` as an existing branch identity. That ref hierarchy is structurally collision-prone. A second defect is also confirmed: post-claim mutating effects are not wrapped, so branch/worktree creation failure escapes as an uncaught exception.**

Worker branch graded at:

`7b427be8d465c2a66df7a139917caaff905207f4`

Worker report:

`docs/replay-results/worker-advisor-reports/AR-1294-BOOTSTRAP-AUTH2-FAILED-BRANCH-REF-NAMESPACE-COLLISION-SPENT-2026-08-17.md`

No executable bootstrap marker is issued in this ruling. `cpb-2026-08-17-0002` must never be reused.

---

## 1. WHAT ACTUALLY HAPPENED

The worker ran exactly one authorized execution:

```text
node scripts/control-plane-bootstrap/bootstrap.mjs --execute
```

The one-shot claim was written, so authorization #2 is spent by design. Execution then failed at branch/worktree creation before any protected seat existed.

The report records the actual Git error:

```text
cannot lock ref 'refs/heads/control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002':
'refs/heads/control-plane/ar-1278-guard-repair' exists;
cannot create 'refs/heads/control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002'
```

No retry occurred.

---

## 2. F23 — BRANCH REF NAMESPACE COLLISION IS CONFIRMED

The actual current production derivation is:

```js
export function deriveBranch(targetPacket, authorizationId) {
  return `control-plane/${targetPacket.toLowerCase()}-guard-repair/${authorizationId}`;
}
```

The preserved authorization-#1 forensic claim records:

```text
branch = control-plane/ar-1278-guard-repair
```

Therefore the new naming scheme tries to place a ref beneath a path already occupied by the old branch identity. This is not a random timing issue and not solved by another authorization id under the same scheme.

### Required repair law

Do **not** delete, move, or rename the old forensic branch just to make room.

Use a flat sibling branch identity that still includes both packet and authorization id but never nests underneath the old bare branch. Preferred shape:

```text
control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003
```

General form:

```text
control-plane/<target_packet lower>-guard-repair-<authorization_id>
```

Equivalent flat naming is acceptable if mechanically derived and tests prove it, but no model/operator-supplied branch path is allowed.

---

## 3. F24 — PRE-CLAIM REF-NAMESPACE AVAILABILITY MUST BE MEASURED

The previous read-only `--plan` returned `authorized:true` without checking whether the mechanically derived Git ref could actually coexist with the current local refs. That allowed a one-shot claim to be spent on a deterministic branch-namespace failure.

Before the claim is written, the production path must perform a **read-only branch namespace collision check** for the exact derived target ref.

It must refuse before first mutation when any of these are true:

```text
exact target ref already exists
an existing ref is a slash-prefix ancestor of the target ref
the target ref is a slash-prefix ancestor of an existing ref
```

Example that MUST refuse before claim:

```text
existing: refs/heads/control-plane/ar-1278-guard-repair
target:   refs/heads/control-plane/ar-1278-guard-repair/cpb-x
```

Example that MUST pass:

```text
existing: refs/heads/control-plane/ar-1278-guard-repair
target:   refs/heads/control-plane/ar-1278-guard-repair-cpb-x
```

The check must use measured Git refs, not the claim file or prompt text as authority.

A failure here must leave the new authorization **unspent**, because it happens before the O_EXCL claim.

---

## 4. F25 — POST-CLAIM MUTATION FAILURES MUST RETURN STRUCTURED FAILURE

Current `run()` directly invokes:

```text
createBranchAndWorktree
writeSeatGuard
proveDoorwayInitOnly
launchSeatSupervised
```

without a general post-claim failure boundary around the mutating/launch sequence. The observed branch-creation exception therefore escaped as a raw Node crash.

After the claim has been written, any exception from the remaining bootstrap stages must be converted into a durable, machine-readable result that clearly says:

```text
authorization was already claimed/spent
which stage failed
completion_verified = false
no retry is authorized
error detail
```

Do not turn a post-claim failure back into `authorized:false` in a way that could be misread as "nothing happened." The truthful state is: authority was accepted, claim was spent, later stage failed.

Suggested shape:

```json
{
  "mode": "execute",
  "authorized": true,
  "executed": false,
  "authorization_spent": true,
  "post_claim_failure_stage": "create_branch_and_worktree",
  "completion_verified": false,
  "completion_failure_reason": "post_claim_exception"
}
```

Exact field names may differ if the existing result schema has a cleaner compatible form, but the semantics above are mandatory.

---

# AR-1295 — AUTHORIZED REPAIR PACKET

## Actor / model

```text
actor  = ordinary Worker-1 engineering seat
model  = Sonnet 5
effort = HIGH
Opus   = NOT AUTHORIZED
Agent/subagent calls = 0
```

This packet is deliberately narrow. We are not opening another general hardening campaign.

## Scope

Expected minimal surfaces:

```text
scripts/control-plane-bootstrap/plan.mjs
scripts/control-plane-bootstrap/bootstrap.mjs
scripts/control_plane_bootstrap.test.mjs
docs/replay-results/control-plane-bootstrap/CONTRACT.md
new AR-1295 worker report / commit-message artifact
```

Touch `bundle.mjs` only if bundle membership itself must change; expected answer is no new load-bearing file.

### Explicitly forbidden

```text
bootstrap --execute
new executable bootstrap marker
new bootstrap claim
cleanup/deletion/rename of authorization #1 or #2 forensic state
privileged seat launch
Agent/subagent call
frozen G2 call or retry
Tier-3 semantic work
compiler/backtest/paper/broker/live-money work
permanent model-router implementation
unrelated cleanup/hardening
```

---

## 5. REQUIRED AR-1295 PROOFS

### K1 — flat branch naming

Prove mechanically:

```text
deriveBranch('AR-1278', 'cpb-2026-08-17-0003')
```

does not place the new ref under the old `control-plane/ar-1278-guard-repair` ref namespace.

Same packet + same authorization id must remain deterministic. Different authorization ids must remain distinct.

### K2 — reproduce the old ref collision in a disposable Git fixture

Create the old forensic branch shape in a disposable repo and prove the old nested naming cannot be created there. This is the RED control.

Then prove the new flat naming can coexist with the old branch in that same disposable repo. This is the GREEN control.

Do not mutate the real forensic branch for this test.

### K3 — pre-claim namespace check bites

Using the real new check against fixture refs, prove:

```text
exact duplicate -> REFUSE
existing ancestor -> REFUSE
target ancestor -> REFUSE
flat sibling -> PASS
```

And prove the refusal occurs before `writeClaim` in the end-to-end effects sequence.

### K4 — post-claim exception is structured

Inject failure independently at least at:

```text
createBranchAndWorktree
writeSeatGuard
```

and prove the returned result clearly records:

```text
authorization accepted
claim already spent
failed stage
completion not verified
no later launch/completion actions executed
```

No raw exception should escape these controlled failure paths.

### K5 — normal successful fake execution still works

The pre-existing positive fake end-to-end path must remain green after the new failure boundary and branch check.

### K6 — regression suite

Run the complete control-plane bootstrap suite. Preserve every earned control. Any live probe skip is SKIP/UNKNOWN, not PASS.

### K7 — terminal frozen proof

At end:

```text
real bootstrap executions = 0
new bootstrap claims       = 0
privileged launches        = 0
Agent/subagent calls       = 0
frozen calls               = 0
frozen ready               = 8
frozen spent               = 0
attempts                   = {}
frozen receipts            = README ONLY
```

Authorization #2 must remain recognized as spent by the local shared claim store; do not delete it.

### K8 — final execution pins

After AR-1295 code/tests are committed, run the production read-only plan/measurement path and record:

```text
true worker head
bootstrap bundle sha256
frozen queue sha256
8 / 0
README_ONLY
claimed authorization ids visible to runtime (must include 0001 and 0002)
proposed fresh branch for prospective 0003
branch namespace availability = PASS
```

If a report-only or inventory commit advances HEAD without changing any `BUNDLE_FILES`, disclose that so GPT can bind the true latest head while reusing the measured digest only after verifying no bundled bytes changed.

---

## 6. SPEED LAW AFTER AR-1295

This is the last repair packet for the three defects exposed by bootstrap #2:

```text
F23 flat branch identity
F24 pre-claim ref availability
F25 structured post-claim failures
```

After AR-1295 lands, GPT will grade those exact defects. If they pass and no **direct deterministic execution blocker** is present, GPT should issue the fresh one-shot authorization immediately. Do not expand scope into optional hardening, style cleanup, or speculative protections.

The expected fresh authorization id after PASS is:

`cpb-2026-08-17-0003`

but it is NOT minted by this ruling.

---

## 7. FROZEN G2 STATE

Independent GitHub inspection at worker tip confirms the frozen queue still has eight unresolved queued conditions, four accepted exclusions, and `attempts = {}`. The frozen isolated receipt directory remains README-only.

Therefore:

```text
FROZEN G2 READY = 8
FROZEN G2 SPENT = 0
```

No frozen G2 execution is authorized by AR-1294A.

---

## END STATE

```text
AR-1294 safe fail-closed behavior       = PASS
bootstrap authorization #2             = SPENT / FAILED BEFORE SEAT CREATION
privileged Phase 1                      = NOT STARTED
F23 branch ref hierarchy collision      = CONFIRMED
F24 missing pre-claim ref check         = CONFIRMED
F25 raw post-claim exception path       = CONFIRMED
AR-1295                                 = AUTHORIZED, SONNET 5 HIGH, NARROW THREE-FIX PACKET
new executable bootstrap authorization  = WITHHELD UNTIL AR-1295 PASS
frozen G2                               = 8 READY / 0 SPENT
```