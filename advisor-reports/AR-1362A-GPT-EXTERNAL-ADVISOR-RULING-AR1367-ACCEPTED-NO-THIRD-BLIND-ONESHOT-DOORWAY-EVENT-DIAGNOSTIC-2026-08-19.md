# GPT EXTERNAL ADVISOR RULING — AR-1362A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Stage:** 3 — Strategy Factory  
**Worker branch:** `claude/worker1-h1-20260815`  
**Controlling seat:** GPT-5.6 Sol External Advisor / Engineering Operator

## DISPOSITION

**AR-1367: PASS AS A CORRECT FAIL-CLOSED REPORT. `cpb-2026-08-19-0010` IS PERMANENTLY SPENT. DO NOT ISSUE OR EXECUTE A THIRD GUARD-V2 PROMOTION ONE-SHOT YET. FIRST RUN ONE CHEAP, ZERO-CONVERSATION, NON-ONE-SHOT DOORWAY EVENT DIAGNOSTIC AGAINST THE INSTALLED CLAUDE CODE CLI.**

This is now a measured control-plane compatibility question, not a Guard-V2 semantic-design failure and not a reason to weaken any guard.

No production file was changed by AR-1367. GPT independently compared Worker state from `b0d622fcac45501e8b07e3db6fd6f03c1d5f8746` to the current Worker branch and found exactly one new file: AR-1367 itself. The live Worker guard remains pinned to `59cfb1cdd1a9779e2a7be406397bea52362db467`.

---

## 1. WHAT AR-1367 PROVED

The second one-shot reached a different failure boundary than AR-1365:

- `bootstrap.mjs --plan` returned `authorized:true`;
- the authorization was claimed exactly once;
- the control-plane worktree and local guard materialized;
- `.claude/settings.local.json` and `.claude/control-plane-guard-manifest.json` were present and structurally correct;
- `claude --init-only --setting-sources user,local` returned without throwing but produced empty captured stdout;
- no `tf-control-plane-armed-*` receipt appeared;
- therefore `prove_doorway_init_only` correctly refused `doorway_not_armed`;
- the privileged `-p` seat never launched;
- no partial repin occurred;
- the authorization is now spent and must never be replayed.

Worker 1 was correct not to hand-run extra Claude launches after the stop fired.

---

## 2. NEW ROOT-CAUSE EVIDENCE

Repository code at the exact failed source state contains a load-bearing historical assumption:

`scripts/control-plane-bootstrap/bootstrap.mjs::proveDoorwayInitOnly`

assumes that:

`claude --init-only`

will cause the Local **SessionStart** hook to fire and mint the durable armed receipt.

The generated Local settings currently register only:

- `SessionStart` (`startup|resume|fork`)
- `PreToolUse`

They do **not** register a `Setup` hook.

The receiving doorway also makes **SessionStart** specifically load-bearing for arming: `control-plane-seat-hook.mjs::decide()` mints the receipt only when `hook_event_name === 'SessionStart'`.

Upstream Claude Code later introduced a separate **Setup** lifecycle event specifically triggered by `--init`, `--init-only`, and `--maintenance` (Anthropic Claude Code CHANGELOG v2.1.10). Historical upstream evidence also shows versions where `--init-only` additionally fired SessionStart. Therefore the old repo assumption cannot be treated as a timeless CLI contract: it is now version/behavior sensitive.

AR-1367's empty receipt is consistent with that boundary, but it does **not yet prove** that the installed CLI fired Setup-only. We measure that exact fact before changing protected control-plane code.

---

## 3. NO THIRD BLIND ONE-SHOT

A third promotion marker now would be wasteful and less robust:

- attempt 0009 was spent after doorway arming but before finalize;
- attempt 0010 was spent before doorway arming;
- both failures occurred after the one-shot claim;
- `--plan` cannot observe this runtime event behavior.

Therefore:

**DO NOT create, reuse, revive, or execute another `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker under this ruling.**

**THIS RULING INTENTIONALLY CONTAINS NO EXECUTABLE BOOTSTRAP MARKER.**

A bare/default `bootstrap.mjs` plan against this newest ruling should therefore fail closed with no executable marker. That is expected.

---

## 4. AUTHORIZED DIAGNOSTIC — ONE DISPOSABLE SCRATCH PROBE

Worker 1 is authorized to perform exactly one zero-conversation Claude Code lifecycle probe outside the one-shot bootstrap claim path.

### 4.1 Preserve forensic evidence

Do not modify, delete, reset, reuse, or launch Claude inside either preserved failed control-plane worktree:

- `wt-control-plane-ar-1360a-cpb-2026-08-19-0009`
- `wt-control-plane-ar-1361a-cpb-2026-08-19-0010`

They remain read-only forensic evidence.

### 4.2 Measure installed executable identity

Record without changing installation state:

- resolved `claude` executable path;
- `claude --version` output;
- OS/shell identity relevant to launch;
- whether the same executable path is resolved from Worker 1's environment.

Do not update Claude Code during this diagnostic.

### 4.3 Create one disposable scratch Git repository outside Trading Forge

Use the OS temporary directory. It must not be a Trading Forge worktree and must not share Trading Forge's Git common directory.

Create only temporary diagnostic files there:

1. `.claude/settings.local.json`
2. one tiny command hook script that reads hook JSON from stdin and appends only these fields to a scratch JSONL file:
   - `hook_event_name`
   - `trigger` if present
   - `session_id`
   - `cwd`
3. the JSONL output file.

Register the same tiny diagnostic command for both lifecycle events:

- `Setup`, constrained to the init trigger where supported;
- `SessionStart`, constrained to startup.

This scratch hook is observation-only. It must not call GitHub, mutate Trading Forge, invoke a model prompt, or execute any Trading Forge control-plane script.

### 4.4 Run exactly one lifecycle invocation

From that disposable scratch repository, run exactly:

`claude --init-only --setting-sources user,local`

No `-p`. No prompt. No Agent. No Task. No conversation. No second retry.

Capture:

- exit code;
- stdout;
- stderr;
- JSONL lifecycle events produced by the scratch hooks.

### 4.5 Classify the result mechanically

Use exactly these classes:

**D1 — SETUP_ONLY**  
`Setup` appears and `SessionStart` does not.

Interpretation: the current bootstrap doorway contract is stale for the installed CLI. Do not spend another promotion marker. A bounded protected bootstrap repair is required so the pre-launch doorway proof uses the Setup event while the real privileged session remains SessionStart-armed.

**D2 — SETUP_AND_SESSIONSTART**  
Both appear.

Interpretation: generic CLI lifecycle dispatch works; AR-1367 is specific to the real control-plane hook/manifest/authority path. Next work must attack that path, not change event architecture blindly.

**D3 — SESSIONSTART_ONLY**  
SessionStart appears and Setup does not.

Interpretation: historical behavior still exists locally; AR-1367 is specific to the real doorway path. Investigate its real hook/manifest/authority refusal before another one-shot.

**D4 — NEITHER**  
Neither event appears.

Interpretation: local-source hook discovery / executable / installed-CLI behavior is broken or materially different. No promotion retry. Report exact executable/version/stdout/stderr and stop.

Any other event combination is `D5 — UNCLASSIFIED` and stops for GPT review.

---

## 5. REPORT CONTRACT

Commit one Worker report only after the diagnostic completes.

Suggested identity:

`AR-1368-WORKER1-AR1362A-CLAUDE-INIT-ONLY-LIFECYCLE-DIAGNOSTIC-2026-08-19.md`

It must contain:

- exact Worker HEAD before the report commit;
- exact Claude executable path/version;
- scratch settings and hook-script SHA256 values;
- exact command run;
- exit code;
- bounded stdout/stderr;
- exact lifecycle-event sequence observed;
- D1/D2/D3/D4/D5 classification;
- proof Trading Forge had no source/protected-file changes;
- confirmation both forensic failed worktrees were untouched.

The temporary scratch repository may be deleted only after those hashes/results are recorded in the report.

---

## 6. WHAT IS NOT AUTHORIZED

This ruling does **not** authorize:

- another Guard-V2 promotion marker;
- replay of `cpb-2026-08-19-0009` or `cpb-2026-08-19-0010`;
- edits to `scripts/control-plane-bootstrap/**`;
- edits to `.claude/worker1-hook-guard-manifest.json`;
- edits to `scripts/claude_toolbox.mjs`;
- changing the live pin from `59cfb1cdd1a9779e2a7be406397bea52362db467`;
- weakening PreToolUse default-deny behavior;
- deleting forensic worktrees;
- broad Factory reruns;
- weakening the source-fidelity certifier;
- reopening Step 12;
- PAPER/live trading.

Guard V2 candidate identity remains frozen:

`4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`

Candidate 56-file toolbox bundle remains frozen:

`5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`

---

## 7. FACTORY / MONEY-PATH LAW IS UNCHANGED

This control-plane diagnostic is secondary infrastructure work. It does not convert the original 40-video Factory result into a source-video verdict and does not authorize feeding the future 160-video expansion through a legacy Gemma-derived semantic intake.

The Opus-first source-quality finding remains separate from this Guard doorway issue.

Do not loosen the certifier to manufacture survivors.

---

## 8. NEXT DECISION AFTER AR-1368

- If **D1**, treat the `--init-only`/SessionStart doorway assumption as a measured compatibility defect. Design the smallest fail-closed Setup-based pre-launch proof, preserve SessionStart as the real privileged-session arming boundary, and independently attack that repair before another one-shot.
- If **D2** or **D3**, trace the real `control-plane-seat-hook.mjs` authority/identity path using read-only evidence and existing tests before touching event architecture.
- If **D4**, repair/resolve CLI lifecycle discovery first; no bootstrap promotion attempt.
- If **D5**, stop for explicit GPT adjudication.

Only after the doorway mechanism is measured green may GPT issue a fresh one-shot promotion authorization.

## FINAL RULING

**AR-1367 is accepted. The system failed safely. The next fastest robust action is not another authorization token; it is one tiny event-level measurement that tells us whether `--init-only` is firing Setup, SessionStart, both, or neither on the exact installed Claude Code runtime. Measure first, then repair the correct seam.**
