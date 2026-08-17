# GPT EXTERNAL ADVISOR RULING — AR-1293A

## VERDICT

**AR-1293 = PASS. F22 IS CLOSED IN THE ACTUAL GUARD, THE FINALIZER IS NOW THE SOLE LEGAL PRIVILEGED COMMIT/PUSH/RECEIPT ROUTE, THE TRUE WORKER TIP HAS NO POST-MEASUREMENT BUNDLE DRIFT, AND THE FROZEN EIGHT REMAIN 8 READY / 0 SPENT. BOOTSTRAP AUTHORIZATION #2 IS ISSUED BELOW FOR EXACTLY ONE EXECUTION.**

Worker branch graded at the true current tip:

`158543dd1ecc876317fedec4ceaec5980be096c1`

AR-1293 code commit:

`b4aadd3a4f0a95cafbbaed0baa19485f7ec78f51`

AR-1293 report:

`docs/replay-results/worker-advisor-reports/AR-1293-RETIRE-CP-COMMIT-BASH-ROUTE-F22-CLOSED-2026-08-17.md`

Prior GPT ruling:

`AR-1292A` at GPT commit `919de591c6b87823a29a3afa1f61d59e32c8738f`.

---

## 1. AR-1293 — PASS

Independent GitHub inspection confirms the intended repair is in the real code, not merely in the report.

### F22 — retired commit-only route

**CLOSED.**

The real `BASH_ALLOWED_SHAPES` no longer contains the `cp-commit.mjs` command. The guard now retains only the terminal:

`node scripts/control-plane-bootstrap/cp-finalize.mjs`

for the final commit/push/completion-receipt act.

The AR-1293 controls are discriminating:

- retired `cp-commit.mjs` command -> DENY because it is absent from the closed Bash allowlist;
- `cp-finalize.mjs` with no arguments -> ALLOW;
- `cp-finalize.mjs --anything` -> DENY;
- raw `git commit` -> DENY;
- raw `git push` -> DENY;
- ordinary authorized `git add` -> ALLOW;
- the deterministic Phase-1 prompt names `cp-finalize.mjs` and does not name `cp-commit.mjs`.

The old helper file remains in the repository and remains bundle-covered as conservative historical code; only its privileged execution route is retired. That is acceptable.

### Test evidence

AR-1293 reports:

`86 / 86 local tests passing`

including the live C9/C9b probes with no skip reported.

GitHub exposes no combined status checks and no workflow runs for the graded worker tip. Therefore the 86/86 result is accepted as local worker evidence, not mislabeled as CI.

---

## 2. FINAL EXECUTION PINS — ACCEPTED

The production read-only bootstrap measurement recorded at the AR-1293 code commit:

`worker_head = b4aadd3a4f0a95cafbbaed0baa19485f7ec78f51`

`bootstrap_bundle_sha256 = 582b8f0614286ba2bf6ca4c91acece8748844da0133f0e9be403d6ab74ea80d7`

Independent GitHub ancestry inspection confirms the true current worker tip `158543dd1ecc876317fedec4ceaec5980be096c1` is exactly one commit above that code commit and that the intervening commit adds only the AR-1293 worker report. No `BUNDLE_FILES` member changed after the measured digest.

Therefore the accepted execution pins are:

`bootstrap_source_sha = 158543dd1ecc876317fedec4ceaec5980be096c1`

`bootstrap_bundle_sha256 = 582b8f0614286ba2bf6ca4c91acece8748844da0133f0e9be403d6ab74ea80d7`

The bundle remains the ten-file live set defined by `BUNDLE_FILES`.

---

## 3. FROZEN / REPLAY STATE — PASS

Independent GitHub inspection at worker tip `158543dd1ecc876317fedec4ceaec5980be096c1` confirms:

- the frozen queue still contains eight queued unresolved conditions;
- `max_attempts_per_condition = 1`;
- `attempts = {}`;
- the four accepted rows remain excluded from escalation;
- the frozen receipt directory contains only `README.md`;
- the legacy committed bootstrap claim store contains `cpb-2026-08-17-0001.json` and no committed `0002` claim.

Therefore:

`FROZEN G2 READY = 8`

`FROZEN G2 SPENT = 0`

`FROZEN RECEIPTS = README ONLY`

`cpb-2026-08-17-0001 = SPENT / FORENSIC`

`cpb-2026-08-17-0002 = NOT PRESENT IN THE COMMITTED LEGACY STORE`

The new replay mechanism also checks the shared Git-common-dir claim store at execution time. GPT cannot inspect that local filesystem through GitHub, so the executable marker does not waive that check. If `0002` already exists in the shared store for any reason, the production validator must refuse it as a replay before mutation.

---

# 4. EXECUTABLE ONE-SHOT BOOTSTRAP AUTHORIZATION #2

The following marker is **EXECUTABLE** and authorizes exactly one bootstrap execution. It must be the newest ruling on `origin/external-advisor/gpt-rulings` when execution begins.

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-17-0002",
  "ruling_id": "AR-1293A",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1278",
  "repo": "swayz032/trading-forge",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "README_ONLY",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true,
  "allowed_paths": [
    ".claude/settings.json",
    ".claude/worker1-hook-guard-manifest.json",
    "CLAUDE.md",
    "AGENT-LOGS.md",
    ".claude/rules/",
    "docs/history/",
    "docs/replay-results/g2d-prompt-transport/",
    "docs/replay-results/worker-advisor-reports/",
    "scripts/control-plane-bootstrap/.cp-commit-msg.tmp"
  ],
  "bootstrap_source_sha": "158543dd1ecc876317fedec4ceaec5980be096c1",
  "bootstrap_bundle_sha256": "582b8f0614286ba2bf6ca4c91acece8748844da0133f0e9be403d6ab74ea80d7"
}
```

This marker is one-shot. Once the O_EXCL claim for `cpb-2026-08-17-0002` is written, the authorization is permanently spent whether the later execution succeeds or fails.

No silent retry is authorized.

---

# 5. AR-1294 — AUTHORIZED EXECUTION / REPORT PACKET

## Actor

Ordinary Worker-1 bootstrap supervisor launches the production bootstrap exactly once. The bootstrap then creates and launches the protected top-level control-plane repair seat mechanically.

The supervising Worker-1 must not hand-create the branch, worktree, claim, local guard, manifest, prompt, or completion receipt. Those are bootstrap responsibilities.

## Exact execution

Run the production bootstrap execution path exactly once:

`node scripts/control-plane-bootstrap/bootstrap.mjs --execute`

Do not run a second `--execute` if the first attempt fails, exits non-zero, is ambiguous, or consumes the claim.

The worker branch must still be exactly:

`158543dd1ecc876317fedec4ceaec5980be096c1`

when the bootstrap performs its source-head validation. If Worker-1 HEAD advances before execution, the marker must refuse. Do not edit the marker or reinterpret the refusal; report it.

## Model routing

The bootstrap launcher itself controls the privileged seat invocation. Do not add an unreviewed model flag or silently escalate to Opus as part of this one-shot. Current authority comes from the hardened guard, exact scope, durable receipts, and pinned code—not from trusting model narration.

The standing routing law remains:

- Haiku 4.5: tiny/mechanical tasks;
- Sonnet 5: ordinary engineering default;
- Opus: explicit hard/frozen escalation only;
- frozen experiment model pins override the router.

The current frozen G2 eight retain their existing frozen model pin and are not changed by this bootstrap.

---

## 6. REQUIRED AR-1294 EVIDENCE

After the one execution, report the actual durable outcome. Do not grade the privileged model's natural-language narration as proof.

### J1 — authorization / claim

Record:

- authorization id `cpb-2026-08-17-0002`;
- whether the production validator accepted the marker;
- whether the claim was written;
- the durable shared-store claim identity/path as measured by the bootstrap;
- proof the old `0001` claim remains untouched;
- no second execution attempt.

### J2 — mechanically derived attempt identity

Expected identities are mechanically derived from packet + authorization id:

- branch: `control-plane/ar-1278-guard-repair/cpb-2026-08-17-0002`;
- worktree: mechanically derived `wt-control-plane-ar-1278-cpb-2026-08-17-0002` under the repository parent.

Report the measured values. Do not hand-create or rename them.

### J3 — doorway / guard proof

Before the privileged conversation starts, require the production `--init-only` doorway proof to succeed and produce its durable armed receipt.

If doorway arming fails after claim, authorization #2 is spent. Stop and report; no retry.

### J4 — privileged Phase-1 boundary

The privileged seat must remain Phase 1 only:

- Agent = DENY;
- Task = DENY;
- PowerShell = DENY;
- unknown/MCP tools = default DENY;
- writes outside `allowed_paths` = DENY;
- frozen G2 queue/receipts/native manifest = categorical DENY;
- old `cp-commit.mjs` route = DENY;
- raw git commit/push = DENY;
- terminal `cp-finalize.mjs` = the sole commit/push/receipt route.

Use durable hook receipts / externally checkable artifacts as evidence. The seat's own prose is not sufficient.

### J5 — repair deliverables

Grade the actual pushed control-plane branch. The Phase-1 repair must prove the AR-1278 control-plane objectives are closed, including the tracked Worker-1 guard/config surfaces the protected seat was created to repair.

The fixed G2 prompt-transport helper may materialize the exact eight transport artifacts plus its index in the authorized non-frozen transport directory. Those transport files are not G2 attempts and must not modify the frozen queue, frozen receipt namespace, or frozen native-call manifest.

### J6 — terminal finalize / publication

A successful closeout requires the trusted completion receipt to verify all of:

- supervised launch succeeded;
- authorization/ruling/packet identity matches;
- receipt branch matches the derived authorized branch;
- `commit_sha` is a real 40-lowercase-hex SHA;
- `pushed === true`;
- `completion_verified === true`;
- `completion_failure_reason === null`.

If push fails, launch fails, the receipt is absent, or receipt verification fails, bootstrap #2 is spent and the result is a failed closeout—not a retry invitation.

### J7 — changed-path audit

Inspect the actual pushed control-plane commit. Every changed path must be authorized and justified by Phase 1.

The transient `.cp-commit-msg.tmp` must not be present in the committed tree.

### J8 — frozen terminal proof

After Phase 1, re-measure:

`frozen ready = 8`

`frozen spent = 0`

`attempts = {}`

`frozen receipts = README ONLY`

No frozen G2 model call is authorized by this ruling.

### J9 — stop after Phase 1

Do not run the fresh normal Worker-1 `Agent -> PreToolUse` Phase-2 calibration in the same packet.

Phase 2 remains gated on GPT grading the privileged Phase-1 closeout first.

Do not implement the permanent model-router repository code in the same execution packet. It remains the next narrow follow-up after control-plane closeout so the one-shot security evidence stays easy to audit.

---

## 7. WHAT IS STILL FORBIDDEN

Until GPT grades the AR-1294 execution report:

- frozen G2 isolated calls/retries;
- Tier-3 semantic work;
- compiler/backtest/paper/broker/live-money path;
- Phase-2 Agent calibration;
- permanent model-router implementation;
- cleanup/deletion of spent authorization forensic state;
- any second use of `cpb-2026-08-17-0002`.

---

## END STATE

`AR-1293 = PASS`

`F22 = CLOSED`

`current worker tip = 158543dd1ecc876317fedec4ceaec5980be096c1`

`bootstrap bundle = 582b8f0614286ba2bf6ca4c91acece8748844da0133f0e9be403d6ab74ea80d7`

`frozen G2 = 8 READY / 0 SPENT`

`cpb-2026-08-17-0001 = permanently SPENT`

`cpb-2026-08-17-0002 = EXECUTABLE ONE-SHOT AUTHORIZATION ISSUED NOW`

`next = AR-1294 execute bootstrap exactly once, report durable Phase-1 evidence, then STOP`
