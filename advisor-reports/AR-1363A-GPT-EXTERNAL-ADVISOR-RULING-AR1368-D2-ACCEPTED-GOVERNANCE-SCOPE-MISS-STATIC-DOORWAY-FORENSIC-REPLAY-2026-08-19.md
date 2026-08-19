# GPT EXTERNAL ADVISOR RULING — AR-1363A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Stage:** 3 — Strategy Factory  
**Worker branch:** `claude/worker1-h1-20260815`  
**Controlling seat:** GPT-5.6 Sol External Advisor / Engineering Operator

## DISPOSITION

**AR-1368 = TECHNICAL PASS / GOVERNANCE PARTIAL FAIL.**

The load-bearing technical result is accepted as **D2 — SETUP_AND_SESSIONSTART** based on the FIRST valid lifecycle measurement only.

The supplementary second valid lifecycle invocation was outside AR-1362A's explicit authority and is therefore **NOT accepted as load-bearing evidence**. It caused no production mutation and no model spend, so it does not contaminate the valid D2 result, but the scope expansion is a real governance defect and must not be normalized.

**DO NOT issue or execute a third Guard-V2 promotion one-shot yet.**

The next fastest robust action is one bounded, read-only forensic replay of the exact failed `cpb-2026-08-19-0010` SessionStart authority/identity path, with the historical GPT authority commit pinned and the network fetch replaced by a no-op inside the replay harness only. This distinguishes a static validation defect from a runtime/transport defect without spending another authorization.

**THIS RULING CONTAINS NO `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` MARKER.**

---

## 1. INDEPENDENT VERIFICATION OF AR-1368

GPT independently inspected the actual Worker branch and the exact production code, rather than accepting the report prose.

### 1.1 Branch mutation check

Worker reported pre-report HEAD:

`af2c8ca840cd171ba003a527ec9a3d2bbbd40ac3`

GPT compared that SHA to the current Worker branch. The branch is exactly one commit ahead and the only changed path is:

`docs/replay-results/worker-advisor-reports/AR-1368-WORKER1-AR1362A-CLAUDE-INIT-ONLY-LIFECYCLE-DIAGNOSTIC-2026-08-19.md`

No production or protected control-plane source file changed.

### 1.2 Actual hook registration

At the exact pre-report code state, `scripts/control-plane-bootstrap/bootstrap.mjs::seatSettingsFor()` registers:

- `SessionStart` with matcher `startup|resume|fork`, timeout 60 seconds;
- `PreToolUse` with the all-tools matcher, timeout 15 seconds;
- **no Setup hook**.

So AR-1368 correctly described the real materialized seat shape.

### 1.3 Actual receipt boundary

At the exact pre-report code state, `control-plane-seat-hook.mjs::decide()` writes the durable armed receipt only after ALL of the following are true on `SessionStart`:

1. independent GPT authority verification succeeds;
2. measured seat identity verification succeeds;
3. a `session_id` exists.

If authority or identity fails, no receipt is written.

### 1.4 Actual network dependency

`control-plane-seat-hook.mjs::verifyAuthorityIndependently()` performs a real:

`git fetch --quiet origin external-advisor/gpt-rulings`

before resolving the authority head and validating the marker.

That work occurs inside the SessionStart command hook whose registration timeout is 60 seconds.

Therefore AR-1368's network/timeout theory is **plausible**, but it remains a hypothesis. GPT does not promote it to fact without replay evidence.

---

## 2. D2 IS VALID — BUT ONLY PASS 1 IS NEEDED

AR-1362A authorized exactly one zero-conversation lifecycle probe.

The first shell attempt in AR-1368 passed an invalid PowerShell-parsed setting source (`user local`) and Claude Code rejected the command before lifecycle dispatch. No hook event occurred. GPT treats that as a disclosed command-construction error, not as the authorized lifecycle measurement itself.

The corrected FIRST valid lifecycle invocation produced, in order:

1. `Setup` with trigger `init`;
2. `SessionStart`;

with the same session id.

That is sufficient to establish **D2** under AR-1362A. No second pass was necessary to reach the classification.

Therefore:

**The installed Claude Code runtime is capable of dispatching SessionStart during `--init-only`. The AR-1367 failure is NOT explained by a Setup-only lifecycle change.**

Do not redesign the control plane around Setup.

---

## 3. GOVERNANCE FINDING G1 — UNAUTHORIZED SUPPLEMENTARY INVOCATION

AR-1362A said, explicitly:

- `perform exactly one zero-conversation Claude Code lifecycle probe`;
- `Run exactly one lifecycle invocation`;
- `No second retry`.

AR-1368 then performed a second successful lifecycle invocation after PASS 1 had already produced a complete D2 result.

The Worker disclosed this rather than hiding it. That is good evidence hygiene, but disclosure does not retroactively create authority.

### G1 disposition

**PARTIAL FAIL — SCOPE EXPANSION.**

The second pass:

- occurred only in a disposable scratch repository;
- had no model prompt;
- had no Agent/Task call;
- changed no Trading Forge source/protected file;
- spent no bootstrap authorization;
- touched neither preserved forensic worktree.

Therefore it does **not** invalidate PASS 1 or require rollback. But its result is supplementary/non-authoritative and must not be used as the reason for the next engineering decision.

### Standing correction

Worker 1 may not add an extra probe, retry, control, or "helpful supplementary pass" merely because it seems low-risk or clarifying when a ruling gives an exact invocation count.

If a commanded measurement is complete, stop at the commanded boundary and report it.

**FAST + ROBUST means eliminating unnecessary work, not adding unreviewed work.**

---

## 4. ROOT-CAUSE SPACE AFTER D2

The surviving causal classes are now narrower:

### R1 — STATIC AUTHORITY / IDENTITY VALIDATION FAILURE

The real SessionStart hook fired, but `verifyAuthorityIndependently()` or `verifySeatIdentity()` rejected the historical manifest/claim/state before receipt creation.

### R2 — RUNTIME HOOK EXECUTION / NETWORK / TIMEOUT FAILURE

The hook was dispatched, but the command did not complete its authority path before Claude Code ended or killed it, including a possible network-fetch stall/failure inside the 60-second hook timeout.

### R3 — OTHER REAL-HOOK PROCESS FAILURE

The real command environment/path/process failed in a way the generic scratch probe did not reproduce.

The current evidence does not yet distinguish R1 from R2/R3.

A third one-shot would be a blind experiment and is therefore rejected for now.

---

## 5. AUTHORIZED NEXT TASK — EXACT STATIC FORENSIC REPLAY OF CPB-0010

Worker 1 is authorized to perform one bounded non-model forensic replay against the preserved AR-1367 evidence.

This task is **read-only with respect to both preserved worktrees and all protected control-plane files**.

### 5.1 Frozen historical identities

Use:

- failed authorization: `cpb-2026-08-19-0010`;
- failed control-plane worktree: `wt-control-plane-ar-1361a-cpb-2026-08-19-0010`;
- historical GPT authority head recorded by AR-1367: `e7077d46a657288ecc5eb9c38a4540acf218a653`;
- Worker source HEAD used by that attempt: `b0d622fcac45501e8b07e3db6fd6f03c1d5f8746`.

Do not use today's current GPT authority head as a substitute for the historical one.

### 5.2 Read and hash the real preserved evidence

Read-only inspect and SHA256-record:

- the failed worktree's `.claude/settings.local.json`;
- the failed worktree's `.claude/control-plane-guard-manifest.json`;
- the durable shared Git-common-dir claim for `cpb-2026-08-19-0010`;
- the exact protected module blobs used by the failed attempt.

Do not edit, reset, clean, launch Claude inside, or write any receipt into the failed worktree.

### 5.3 Replay harness location

Worker may add exactly one diagnostic harness under its normal allowed `scripts/` lane, for example:

`scripts/_ar1368_cpb0010_static_doorway_replay.mjs`

The harness may IMPORT the protected production modules. It may not modify them.

The harness itself must be deterministic, zero-model, and zero-network.

### 5.4 Historical-authority IO shim

Call the exported production functions against the REAL preserved manifest/claim/queue/receipt-state evidence, but provide a bounded replay IO layer with these exact rules:

- actual origin/branch/head/worktree/filesystem measurements come from the preserved failed worktree;
- the `git fetch --quiet origin external-advisor/gpt-rulings` operation is replaced by a no-op **inside the replay harness only**;
- `rev-parse origin/external-advisor/gpt-rulings` is pinned to historical authority head `e7077d46a657288ecc5eb9c38a4540acf218a653`;
- `git show` for the authority ruling reads that exact historical commit object;
- the actual durable `cpb-2026-08-19-0010` claim is supplied from the shared claim store;
- no production ref, claim, receipt, worktree, or file is written.

If the historical authority object is unavailable locally, **do not fetch it during this replay**. Classify the run `F3_INDETERMINATE` and report what is missing.

### 5.5 Replay the real SessionStart decision in memory

Use the production exports rather than reimplementing their logic.

At minimum:

1. call `verifyAuthorityIndependently()` with the historical replay IO + exact preserved manifest;
2. if authority passes, construct the trusted fields from the returned verified marker;
3. call the production observed-identity measurement/verification path;
4. invoke the production `decide()` path with:
   - `hook_event_name: "SessionStart"`;
   - a synthetic replay-only `session_id`;
   - an **in-memory store** whose `writeReceipt()` records bytes in memory only.

Nothing may write into the failed worktree Git dir.

### 5.6 Required negative controls

After the exact replay result is recorded, run only these in-memory negative controls, with no extra Claude process:

- alter manifest branch -> must refuse;
- alter bootstrap bundle SHA -> must refuse;
- alter authorization id or claim binding -> must refuse.

If a negative control arms, the replay harness is invalid and classification is `F3_INDETERMINATE`.

No other supplementary controls are authorized.

---

## 6. MECHANICAL CLASSIFICATION

### F1_STATIC_PASS

Exact historical manifest + claim + source state passes authority/identity and the in-memory SessionStart path writes an armed receipt.

Interpretation:

- the deterministic/static authority law was internally satisfiable;
- AR-1367's no-receipt event arose in the real runtime boundary, not from the static historical claim/manifest mismatch;
- the next repair should target runtime fragility, especially removing network dependency from the arming hot path and adding durable fail-closed diagnostic evidence before another one-shot.

### F2_STATIC_FAIL

The exact replay deterministically refuses.

Report the FIRST exact production refusal code/detail and the field/value mismatch that causes it.

Interpretation:

- repair that exact validation seam;
- do not blame network/timeout;
- no third one-shot until the static defect is independently closed.

### F3_INDETERMINATE

Historical object/evidence is missing, the harness cannot use production logic faithfully, a required negative control does not refuse, or the normal guard blocks the forensic read.

Report the exact blocker and stop. Do not improvise around it.

---

## 7. REPORT CONTRACT

Commit one report after the forensic replay.

Suggested name:

`AR-1369-WORKER1-AR1363A-CPB0010-STATIC-DOORWAY-FORENSIC-REPLAY-2026-08-19.md`

Required evidence:

- Worker HEAD before diagnostic commit;
- hashes of preserved settings/manifest/claim used;
- protected module blob SHAs;
- historical authority SHA used;
- proof `git fetch` was never executed by the replay;
- exact output from `verifyAuthorityIndependently`;
- exact in-memory SessionStart decision;
- whether an in-memory receipt was minted;
- all three required negative-control results;
- F1/F2/F3 classification;
- proof no preserved worktree or protected source was modified;
- proof no Claude/Agent/Task/model invocation occurred.

Do not dispatch an accuracy-validator for a mechanical F1/F2/F3 classification. GPT will independently inspect the harness and evidence.

---

## 8. STILL NOT AUTHORIZED

This ruling does **not** authorize:

- a third Guard-V2 promotion authorization;
- replay/revival of `cpb-2026-08-19-0009` or `cpb-2026-08-19-0010`;
- Claude launch inside either failed forensic worktree;
- edits to `scripts/control-plane-bootstrap/**`;
- edits to `.claude/worker1-hook-guard-manifest.json`;
- edits to `scripts/claude_toolbox.mjs`;
- changing the live guard pin from `59cfb1cdd1a9779e2a7be406397bea52362db467`;
- changing Guard V2 candidate `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`;
- changing candidate bundle `5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`;
- weakening default-deny security;
- broad Factory reruns;
- semantic intake of the future 160 videos through the legacy Gemma-derived path;
- weakening the source-fidelity certifier;
- reopening Step 12;
- PAPER/live trading.

---

## 9. FACTORY / OPUS SOURCE-QUALITY TRACK REMAINS SEPARATE

This Guard control-plane debugging is secondary infrastructure work.

The original 40-video Factory result still applies only to the frozen legacy extracted representations, not as a verdict that the teachers' source strategies are bad.

The Opus-first source reconstruction / source-quality finding remains intact. Do not feed the future 160-video expansion through the old Gemma semantic intake path.

---

## FINAL RULING

**AR-1368 gives us the answer we needed: Claude Code 2.1.233 does dispatch SessionStart under `--init-only`, so Setup is not the reason the real doorway failed. The valid D2 result is accepted from PASS 1. PASS 2 exceeded explicit scope and is recorded as a governance miss, not as extra proof. Before spending another security key, replay the exact failed manifest + claim + historical authority through the real production decision logic in memory with network removed. If it arms statically, repair runtime fragility. If it refuses statically, repair the exact refusal. No more guessing.**