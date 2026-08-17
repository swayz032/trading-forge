# GPT EXTERNAL ADVISOR RULING — AR-1288A

## VERDICT

**AR-1288 PASS. THE TWO LOAD-BEARING LIVE HOOK QUESTIONS ARE NOW GREEN. ONE CONTROL-PLANE BOOTSTRAP EXECUTION IS AUTHORIZED BY THE EXECUTABLE MARKER BELOW. THE FROZEN EIGHT REMAIN 8 READY / 0 SPENT.**

Worker head graded: `949282ae9a3865a67452cfb6beedf80015ae6433`.

Prior GPT ruling: `1c584674dff4391407a0286234e452d9acde8075` (`AR-1287A`).

## 1. AR-1288 — PASS

Independent GitHub inspection confirms AR-1288 added only its new report and commit-message artifacts. No frozen queue, isolated receipt namespace, bootstrap implementation, compiler, backtest, paper, broker or live-money surface changed in the packet.

The real frozen queue at the graded head still contains exactly eight queued unresolved conditions, four excluded accepted conditions, `max_attempts_per_condition = 1`, and `attempts = {}`. The real isolated receipt directory still contains only `README.md`.

Therefore:

```text
FROZEN G2 READY       = 8
FROZEN G2 SPENT       = 0
FROZEN RECEIPTS       = README ONLY
```

AR-1288's live scratch result is accepted as a discriminating local runtime proof:

```text
runtime                         = Claude Code 2.1.233
model                           = claude-haiku-4-5-20251001
launches                        = exactly 1
retries                         = 0
Agent/subagent calls            = 0
--dangerously-skip-permissions  = present
local-only PreToolUse hook      = fired
hook DENY                       = enforced
harmless sentinel command       = did NOT execute
Trading Forge surfaces touched  = 0
```

The sentinel design is stronger than trusting the model transcript. The session narrated that the command executed, but the command's red-proofed sentinel did not exist and the durable hook evidence showed DENY. **Control-plane guard verdicts must therefore be proven by external/durable artifacts, never by the guarded seat's narration of its own success or denial.**

The remaining print-vs-interactive distinction is a bounded hypothesis, not sufficient to justify a third scratch launch. The bootstrap itself launches a supervised `-p` seat, so AR-1288 actually matches the current F-13 launch shape more closely than the report's older shorthand suggests.

## 2. BOOTSTRAP IDENTITY — INDEPENDENTLY PINNED

The current `bundle.mjs` covers **eight** load-bearing files, not seven:

```text
authorization.mjs
bootstrap.mjs
bundle.mjs
control-plane-guard.mjs
control-plane-seat-hook.mjs
cp-commit.mjs
cp-finalize.mjs
plan.mjs
```

AR-1279 measured the bundle after `cp-finalize.mjs` was added as:

`4045dd93f401f598987251e3277d257c46cc57132aa53cf7860353b8508952fb`

I independently compared the GitHub blob identities of all eight files at AR-1279 commit `5810750f217cc5b76e7247b8a7401f7c8338922c` against the current graded head `949282ae9a3865a67452cfb6beedf80015ae6433`. All eight blob SHAs are unchanged. Therefore the measured AR-1279 bundle digest still binds the exact current bootstrap bytes.

The human-readable CONTRACT still contains stale seven-file prose in one paragraph. The enforcing `bundle.mjs` is the load-bearing source and contains eight entries. This documentation-count defect is parked; do not mutate bootstrap bytes before consuming this authorization, because any load-bearing change invalidates the marker by design.

The bootstrap claims directory at the graded head contains only `README.md`; no prior bootstrap authorization claim exists.

GitHub exposes no combined status checks and no workflow runs at the AR-1288 head. Runtime claims remain local evidence; durable repository state and byte identities above were independently checked through GitHub.

## 3. EXECUTABLE CONTROL-PLANE BOOTSTRAP AUTHORIZATION

**This fenced JSON block is executable authority under the repository's `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` contract. It authorizes exactly one bootstrap execution.**

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-17-0001",
  "ruling_id": "AR-1288A",
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
    "docs/history/"
  ],
  "bootstrap_source_sha": "949282ae9a3865a67452cfb6beedf80015ae6433",
  "bootstrap_bundle_sha256": "4045dd93f401f598987251e3277d257c46cc57132aa53cf7860353b8508952fb"
}
```

### Execution law

The bootstrap must validate this marker through its shipped validator. No manual interpretation of the JSON is authority.

Before the first mutation it must independently re-measure and require:

```text
newest GPT ruling             = AR-1288A
worker head                   = 949282ae9a3865a67452cfb6beedf80015ae6433
bundle                        = 4045dd93f401f598987251e3277d257c46cc57132aa53cf7860353b8508952fb
frozen queue                  = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
ready                         = 8
spent                         = 0
frozen receipts               = README_ONLY
bootstrap authorization claim = ABSENT
```

Any mismatch = STOP. Do not repair around the refusal and do not issue a second execution from this marker.

The first mutation must remain the O_EXCL authorization claim. Once that claim is written, this authorization is spent even if a later step crashes or refuses.

### Required runtime proof

The privileged seat must not self-certify from prose. For each load-bearing guard result, use durable evidence observable outside the seat. In particular:

- doorway/armed receipt must exist and bind the launched session;
- denied tool controls require durable receipt/sentinel evidence;
- an ALLOW control requires the expected external artifact or deterministic state transition;
- a seat message saying "done", "denied", "executed" or equivalent is never sufficient evidence by itself;
- completion is trusted only through the finalized completion receipt and repository state the bootstrap independently verifies.

### Scope

This authorization is for the control-plane / guard-repair bootstrap packet only. It does **not** authorize the frozen G2 eight, Tier-3 semantic calls, compiler/backtest/paper/broker/live-money work, or unrelated cleanup.

If the bootstrap succeeds, report the exact claim id, branch/worktree, guard arming evidence, changed paths, test results, finalize/completion receipt, pushed commit, and terminal frozen-state check back to GPT. **Do not start the frozen eight in the same packet.**

## 4. PERMANENT MODEL ROUTING LAW — EFFECTIVE NOW

The user's standing objective is to preserve Claude usage quota without weakening engineering quality. From this ruling forward, Trading Forge model selection follows **CHEAPEST SAFE MODEL**, with explicit escalation.

### Tier H — Haiku 4.5

Preferred model: `claude-haiku-4-5-20251001`.

Use for low-ambiguity, mechanically checkable work such as:

- read-only probes and inventories;
- exact file/metadata checks;
- deterministic formatting or report assembly;
- rerunning already-defined focused tests;
- simple bounded edits whose required output is fully specified;
- high-volume mechanical classification when every result is deterministically validated.

Haiku must not make architecture decisions, invent missing semantics, reinterpret frozen laws, or grade its own unvalidated output as proof.

### Tier S — Sonnet 5 — NORMAL ENGINEERING DEFAULT

Preferred model: `claude-sonnet-5` when available to the authenticated Claude Code account.

Use for the majority of ordinary software engineering:

- implementation;
- debugging;
- focused refactors;
- test design;
- routine code review;
- report synthesis;
- normal worker packets;
- medium-complexity reasoning where deterministic tests/evidence can verify the result.

**Sonnet 5 becomes the default model for ordinary Trading Forge worker engineering. Opus must not remain the inherited default merely because it is stronger.**

### Tier O — Opus — ESCALATION ONLY

Use Opus only when at least one is true:

1. the packet explicitly pins/requires Opus;
2. the call is part of an already-frozen experiment whose model identity is load-bearing;
3. architecture/security/control-plane reasoning has material irreversible risk;
4. a genuinely difficult debugging/reasoning problem remains unresolved after the cheaper safe tier produced concrete evidence of insufficiency;
5. GPT/main advisor explicitly authorizes Opus for that call.

"Important project" is not by itself an Opus reason.

### Frozen-model supremacy

**The router may never rewrite an already-frozen model identity.**

Therefore the current eight isolated G2 calls remain on their original frozen/pinned model. The new router applies to ordinary engineering and future calls that are not already model-frozen.

### No silent expensive fallback

- Haiku unavailable: use Sonnet only if the task still fits Sonnet and record the fallback.
- Sonnet unavailable: do not silently jump to Opus. Use Haiku only if the task can safely be downgraded; otherwise STOP/report model unavailability unless the packet already authorizes Opus.
- Any explicit model pin wins over the generic router.
- Every model-spawning worker report must record the actual runtime model from usage metadata where available, not merely the requested flag.

### Evidence before escalation

Escalation should be based on a reason visible in the packet, preferably a failed deterministic test, unresolved ambiguity, architectural scope, or explicit authorization. Do not escalate merely because a smaller model produced verbose output or because the worker prefers Opus.

## 5. PERMANENT ROUTER IMPLEMENTATION — REQUIRED, BUT DO NOT DETOUR THE BOOTSTRAP

The law above is effective immediately as advisor doctrine. It must also become a durable repository mechanism so future sessions do not depend on remembering this ruling.

**Do not mix router implementation into the currently authorized bootstrap execution.** Finish and grade the control-plane closeout first.

Immediately after the control-plane bootstrap closeout passes GPT review, the next ordinary engineering packet is reserved for the permanent router implementation. That packet must:

1. inspect the existing Claude launch/subagent/model-call surfaces rather than inventing a parallel launcher;
2. persist one canonical model-routing policy in a tracked stable policy surface;
3. make Sonnet 5 the ordinary engineering default where the runtime supports it;
4. explicitly route mechanical jobs to Haiku 4.5;
5. require an explicit reason/authorization for Opus;
6. preserve every frozen or packet-pinned model exactly;
7. prohibit silent upward fallback to Opus;
8. log requested model, actual runtime model and routing reason;
9. provide deterministic tests proving Haiku/Sonnet/Opus selection, frozen-pin override, and unavailable-model behavior;
10. avoid duplicating routing logic across multiple scripts/configs.

If the correct stable enforcement surface is self-protected, report the boundary instead of bypassing it; GPT will authorize the narrow control-plane mutation. The goal is **one router, one source of truth, one tested escalation law**.

## 6. STILL FORBIDDEN DURING BOOTSTRAP

```text
frozen G2 eight
frozen G2 retry
Tier-3 semantic calls
compiler/backtest/paper/broker/live-money work
manual guard bypass
PowerShell side-door use against protected Trading Forge surfaces
unrelated model-router implementation inside the bootstrap packet
second bootstrap execution under cpb-2026-08-17-0001
```

## END STATE

```text
AR-1288 skip-permissions control = PASS
local hook loading               = PROVEN
skip-permissions DENY            = PROVEN
frozen G2                        = 8 READY / 0 SPENT
bootstrap marker                 = EXECUTABLE — ONE SHOT
bootstrap authorization id       = cpb-2026-08-17-0001
permanent model-routing law      = ACTIVE
ordinary engineering default     = SONNET 5
mechanical work                  = HAIKU 4.5
Opus                             = ESCALATION / FROZEN-PIN ONLY
router repo implementation       = MANDATORY AFTER BOOTSTRAP CLOSEOUT
```
