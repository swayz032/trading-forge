# GPT EXTERNAL ADVISOR RULING — AR-1169

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Status:** P0-6 CODE-CANDIDATE GRADE / DEPLOYMENT GATE

## VERDICT

**ACCEPT**

**Accepted exact code-candidate SHA:** `65a53ea95111a469e2324ba2e9df576f605eca99`

**Superseded intermediate candidate:** `56da1174391166b1f52db9505f81c323544f2f34`

This is an acceptance of the **P0-6 code candidate only**.

It is **NOT**:
- authorization to deploy immediately;
- final P0-6 system GREEN;
- authorization to enable Worker 2 or Agent Teams;
- authorization for Topstep network access.

P0-6 remains **RED / NOT DONE** until the live deployment, LocalSystem, Rails, cold-start/recovery, PAPER rehydration, zero-egress, and rollback witnesses pass.

---

## INDEPENDENT GITHUB GRADE

I independently inspected the exact commits and did not rely on the Codex prose as proof.

### 1. `56da1174` identity correction — ACCEPTED

The committed running-code identity implementation now:

- always asks real Git for `rev-parse HEAD`;
- always asks real Git for `status --porcelain`;
- marks a declared `GIT_COMMIT` mismatch dirty;
- marks actual worktree dirt dirty;
- fails closed with `dirty=true` when Git is unavailable/fails;
- uses command-local `-c safe.directory=*` rather than requiring a persistent global wildcard.

The six committed tests cover the prior environment-bypass false green, matching/mismatching declared SHA, dirty worktree, and Git-unavailable behavior.

No static code discrepancy requiring correction was found in this seam.

### 2. `65a53ea9` canonical test-lane correction — ACCEPTED

`65a53ea9` is exactly one commit ahead of `56da1174`, with merge base equal to `56da1174` and only one changed file: `package.json`.

Its one-line routing correction adds `scripts/integration/__tests__/*.test.mjs` to the canonical `test:scripts` lane. That closes the observed orphan without moving Node tests into Vitest or changing runtime semantics.

Because it is the exact descendant containing both the identity fix and the canonical test-lane fix, `65a53ea9` is the correct P0-6 candidate SHA.

### 3. Validator implementation — ACCEPTED WITH REQUIRED LIVE/PREFLIGHT CONTROLS

The committed `scripts/integration/validate-agent-packet.mjs` is fail-closed on:

- non-full base/candidate SHAs;
- candidate SHA not equal to current HEAD;
- dirty candidate worktree;
- base not an ancestor of candidate;
- any failed command in the selected validation profile.

The runtime profile covers the relevant PAPER/runtime/Topstep-offline/running-code-identity tests plus build, production-isolation, 2026-compliance, and system-map gates.

The four committed validator unit tests exercise validation-plan routing, not the CLI guards themselves. This is **not a code-candidate rejection**, because the CLI guards are simple and directly inspectable, but Claude must prove the mismatch and dirty-worktree guards in a disposable preflight worktree before privileged mutation.

---

## DISCREPANCIES / LIMITS FOUND

1. **No GitHub commit-status contexts were attached to either `56da1174` or `65a53ea9`.** Therefore GPT does not treat the reported local test totals as GitHub-CI-attested facts. Claude must rerun the bounded canonical preflight at the accepted exact SHA before mutation.

2. **The privileged deployment/rollback handoff file itself is not available through the connected GitHub repository or current attached-file context.** GPT therefore has not independently audited the six privileged PowerShell blocks. Do not reconstruct or improvise them. Claude must hash-check the exact prepared handoff file and execute it verbatim only after the deployment gate opens.

3. **Healthy/no-op n8n executions do not prove the true unhealthy restart or Discord-alert branches.** Those remain separate post-deployment controls.

4. **The live runtime state described in the handoff is still incompatible with final GREEN:** old running SHA, dirty runtime checkout, incorrect health identity, missing watchdog, and stale/failing Rails scheduled authority. Code acceptance does not erase those live defects.

5. **Codex already installed the two distinct onboarding identities while Agent Teams remained disabled.** Do not ask Claude to reinstall them if byte/hash verification still matches. Installation is not activation.

---

## STATUS DISTINCTION

```text
CODE CANDIDATE
65a53ea95111a469e2324ba2e9df576f605eca99
= ACCEPTED

DEPLOYMENT AUTHORIZATION
= CLOSED UNTIL AR-1138 IS COMPLETED AND GPT-ACCEPTED

FINAL P0-6 SYSTEM GREEN
= CLOSED UNTIL ALL LIVE WITNESSES + ROLLBACK PASS
```

AR-1138 remains the first semantic gate and first Claude priority.

---

# EXACT NEXT CLAUDE WORK ORDER

## PHASE A — FIRST ACTION WHEN CLAUDE RETURNS

**Worker 1 only. Do not start P0-6 deployment yet.**

1. Resume the exact unfinished AR-1138 state; do not restart or replace the order.
2. Complete the already-authorized real grading/geometry/compiler work.
3. Run the exact AR-1138 evidence/tests required by that order.
4. Commit and push the bounded result.
5. Publish the Worker 1 report.
6. **STOP for GPT external grading.**

During Phase A:

- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` stays absent/off;
- Worker 2 stays `GATED_IDLE`;
- do not deploy P0-6;
- do not repoint NSSM or Rails scheduled tasks;
- do not register the production watchdog;
- do not activate PAPER qualification;
- do not make Topstep network calls.

## PHASE B — ONLY AFTER GPT ACCEPTS AR-1138

Use the already-prepared Worker identities; verify, do not redesign/reinstall unless mismatch is proven.

Then perform the bounded P0-6 deployment lane with **accepted exact SHA**:

`65a53ea95111a469e2324ba2e9df576f605eca99`

### B1. Verify remote authority

```powershell
git fetch origin codex/p0-6-test-lane-coverage-20260814
git rev-parse origin/codex/p0-6-test-lane-coverage-20260814
```

Required output:

```text
65a53ea95111a469e2324ba2e9df576f605eca99
```

Any other SHA => **STOP**.

### B2. Verify the prepared handoff artifacts before privileged use

```powershell
(Get-FileHash -Algorithm SHA256 'C:\Users\tonio\Documents\Codex\2026-08-14\hey\handoffs\P0-6-DEPLOYMENT-ROLLBACK-COMMAND-PACKET-2026-08-15.md').Hash
```

Required:

`0F3DB19826DC561ED4D71D6DC1ACA9CC5A836B60826E3FBEC672EA1195739E9C`

```powershell
(Get-FileHash -Algorithm SHA256 'C:\Users\tonio\Documents\Codex\2026-08-14\hey\handoffs\P0-6-SCHEDULED-TASK-REGISTRATION-PREFLIGHT-RECEIPT-2026-08-14.md').Hash
```

Required:

`B157A2266C5FBD6D5FD2FEAC06D3629E34CD25B5F53F1617E183D29486BBDFBC`

```powershell
(Get-FileHash -Algorithm SHA256 'C:\Users\tonio\Documents\Codex\2026-08-14\hey\handoffs\P0-6-RUNTIME-DIRTY-MANIFEST-2026-08-14.json').Hash
```

Required:

`6DBD3CC94757B7ED56A6335E0BE89DC997FEED45A739DAACDF71D2194C2F7AA3`

Any hash mismatch => **STOP**. Do not recreate the packet from memory.

### B3. Create/use a separate clean exact-SHA release worktree

Use the exact worktree path and release commands from the hash-verified deployment/rollback packet. Do **not** deploy from the dirty existing `runtime-production` checkout.

Before mutation, the release source must prove:

```powershell
git rev-parse HEAD
git status --porcelain
```

Required:

- HEAD exactly `65a53ea95111a469e2324ba2e9df576f605eca99`;
- status output empty.

### B4. Canonical candidate preflight

From a clean disposable/candidate worktree at exact SHA `65a53ea9`:

```powershell
npm ci
npm run test:scripts
node scripts/integration/validate-agent-packet.mjs --profile runtime --base 702d8fb72854d0dd39f536b36f59cbb8a6c9808b --candidate 65a53ea95111a469e2324ba2e9df576f605eca99
```

All commands must exit `0`.

### B5. Two required validator negative controls — disposable worktree only

Candidate-mismatch guard:

```powershell
node scripts/integration/validate-agent-packet.mjs --profile runtime --base 702d8fb72854d0dd39f536b36f59cbb8a6c9808b --candidate 56da1174391166b1f52db9505f81c323544f2f34
```

Required: nonzero exit with `candidate_head_mismatch` while HEAD is `65a53ea9`.

Dirty-worktree guard:

```powershell
Set-Content -Path '.p0-6-intentional-dirty-sentinel' -Value 'intentional negative control'
node scripts/integration/validate-agent-packet.mjs --profile runtime --base 702d8fb72854d0dd39f536b36f59cbb8a6c9808b --candidate 65a53ea95111a469e2324ba2e9df576f605eca99
if ($LASTEXITCODE -eq 0) { throw 'P0-6 STOP: dirty-worktree guard false-green' }
Remove-Item '.p0-6-intentional-dirty-sentinel' -Force
git status --porcelain
```

Required:

- validator nonzero with `candidate_worktree_dirty`;
- sentinel removed;
- final status empty.

### B6. Privileged deployment

Only after B1-B5 pass, execute the privileged mutation phases **verbatim from**:

`P0-6-DEPLOYMENT-ROLLBACK-COMMAND-PACKET-2026-08-15.md`

Do not improvise, shorten, or reconstruct the privileged PowerShell from this ruling.

### B7. Live witnesses required before P0-6 can turn GREEN

Collect and report:

1. NSSM/service release path points to the clean exact-SHA release checkout.
2. Service restarts normally and remains healthy.
3. Direct Git from the actual running service directory, using command-local safe-directory handling, reports exact deployed SHA and real dirty state.
4. `/api/health` commit and `code_dirty` exactly match direct Git.
5. `TF-ApiLivenessWatchdog` is registered under `NT AUTHORITY\SYSTEM` and witnessed executing the committed helper.
6. Full-Lane and Cert-Rig are repointed to the accepted release authority and both produce fresh successful scheduled witnesses.
7. Controlled cold start/recovery passes.
8. PAPER rehydrates once, creates no duplicate signal/order, and proves zero broker egress.
9. Rollback is exercised and returns NSSM/Rails/watchdog state to the recorded predeployment authority.
10. n8n true unhealthy restart branch receives a gated positive control and healthy/no-op receives a negative control; Discord alert branch is separately witnessed without leaking secrets.

Then publish one bounded P0-6 Worker 2 report and **STOP for GPT grading**.

---

# EXPLICIT GATES THAT REMAIN CLOSED

Until their named prerequisite is satisfied:

- **AR-1138:** remains first semantic priority.
- **P0-6 deployment:** closed until AR-1138 is GPT-accepted.
- **P0-6 final GREEN:** closed until live deployment + recovery + PAPER + rollback witnesses pass.
- **Agent Teams:** OFF until AR-1138 acceptance and distinct two-worker activation receipt.
- **Worker 2 implementation:** `GATED_IDLE` until the same activation checkpoint.
- **PAPER qualification:** not activated by this code acceptance.
- **Topstep REST/WebSocket/Practice/Combine/funded/live access:** closed until paid access exists and explicit authorization is issued.
- **Broker egress:** must remain zero during P0-6 PAPER proof.
- **n8n unhealthy restart / Discord alert certification:** still open; healthy/no-op success is insufficient.

---

# GPT LANE — WHAT REMAINS AFTER CODEX WORK

Codex materially reduced the GPT flashlight queue. Do **not** duplicate its completed offline work.

GPT's remaining work is now primarily independent grading and gate control:

1. Grade the completed AR-1138 Worker 1 report when Claude resumes and publishes it.
2. Grade the two-worker activation receipt; verify installed identities are distinct and lane-isolated rather than reinstalling them.
3. After AR-1138 acceptance, grade P0-6 Phase B live deployment evidence against exact SHA `65a53ea9`.
4. Grade LocalSystem watchdog, health/direct-Git identity parity, Rails scheduled witnesses, cold-start/recovery, PAPER rehydration/duplicate suppression/zero-egress, and rollback.
5. Grade the n8n true unhealthy restart and Discord-alert branch controls; do not repeat the already-proven healthy/no-op path.
6. Reuse, then independently grade, the existing offline Topstep safety work before any later network phase; do not rebuild the adapter work Codex already completed.
7. Continue the remaining production-hardening queue only where not already covered: reconnect/crash matrix, position reconciliation, strategy-rotation chaos, 3AM receipt chaos, fake-green/mutation hunt, CI launch gates, security/secrets, 120-strategy load, one-strategy golden run, multi-strategy contention, PAPER→execution parity, launch drill, and final GO/NO-GO certification.

## BOTTOM LINE

**ACCEPT `65a53ea95111a469e2324ba2e9df576f605eca99` as the exact P0-6 code candidate.**

**Do not deploy it yet. AR-1138 still goes first.**

After AR-1138 passes GPT review, Claude may run the bounded, hash-verified P0-6 Phase B deployment. P0-6 remains RED until the live system—not just the source tree—proves the required witnesses.