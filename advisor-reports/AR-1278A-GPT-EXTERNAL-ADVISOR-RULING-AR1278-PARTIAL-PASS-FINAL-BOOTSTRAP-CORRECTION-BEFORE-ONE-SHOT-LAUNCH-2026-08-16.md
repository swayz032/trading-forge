# GPT EXTERNAL ADVISOR RULING — AR-1278A

## AUTHORITY

This is the live GPT operator ruling after independent inspection of:

- GPT operator onboarding;
- Blueprint V4 + Revision 5 sequencing;
- AR-1277A;
- Worker-1 head `07322eae39955bdfbbf7cdb1c02cfd65094778f7`;
- Worker report `AR-1278-WORKER1-BOOTSTRAP-HARDENING-F1-F7-CLOSED-2026-08-16.md`;
- the actual corrected bootstrap/guard/authorization/plan/bundle/commit-helper code;
- the actual bootstrap test code, not only its reported count;
- Worker project `.claude/settings.json`;
- the pinned Worker toolbox branch at `b6c702821bc48281b02e16773c7c277ae17fb03f`;
- frozen G2 queue + receipt namespace;
- GitHub CI/status evidence;
- current official Claude Code documentation for settings scopes, hooks, `--init-only`, `-p`, and PreToolUse matcher behavior.

Blueprint V4 + Revision 5 remain binding. No compiler/backtest/PAPER/Topstep/live gate is released by this ruling.

---

## VERDICT

**AR-1278: PARTIAL PASS / LARGE IMPROVEMENT. BOOTSTRAP EXECUTION REMAINS NO-GO FOR ONE FINAL NARROW CORRECTION.**

The Worker closed several defects correctly:

```text
Bash arbitrary-write side door           CLOSED, bounded
local guard registration separation      GOOD DIRECTION
source SHA + bootstrap bundle pinning     CLOSED at bootstrap preflight
claim-before branch/worktree ordering     IMPROVED
SessionStart durable receipt class        IMPROVED
44 local controls                         CREDITED
privileged model executions               0
frozen G2                                 8 READY / 0 SPENT
CI                                        NONE
```

But independent review found load-bearing gaps that still sit exactly on the privilege transition. Do not spend the one-shot authorization yet.

No executable `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker is issued here.

---

## 1. PRIMARY-SOURCE CLAUDE CODE CHECK — THE LOCAL-SETTINGS QUESTION IS SETTLED WITHOUT A MODEL CALL

The Worker correctly refused to guess whether `.claude/settings.local.json` is a real hook source.

GPT independently checked current official Claude Code documentation.

The official docs state that:

- `.claude/settings.local.json` is the **Local** project settings source;
- hooks may be defined there and appear as `Local` hooks;
- local settings have higher precedence than project `.claude/settings.json`;
- direct settings-file edits are normally detected by the file watcher;
- `--setting-sources` supports `user,project,local`;
- `claude --init-only` runs Setup + SessionStart hooks and exits **without starting a conversation**;
- `claude -p "query"` runs Claude Code non-interactively and, unless `--bare` is used, loads the normal project context/hooks.

Therefore:

**DO NOT burn a throwaway model call merely to prove that Local is a supported hook source.**

Better live proof exists: the bootstrap must run the actual future seat with `--init-only` after materialization and require the durable SessionStart armed receipt before any model conversation is allowed to start.

This is cheaper and stronger than the current synthetic direct-node doorway call because it proves Claude Code itself discovered and invoked the Local hook.

---

## 2. F-8 — THE RECEIVING SEAT STILL DOES NOT INDEPENDENTLY RE-VERIFY GPT AUTHORITY

AR-1277A required the privileged seat itself to re-verify authority, not merely trust a manifest written by the bootstrap.

The new hook improved live measurement for:

```text
repo remote
worktree
branch
HEAD
frozen queue digest/state
```

But `measureObservedIdentity()` still fills these fields from `manifestExpectations`:

```text
actor
targetPacket
authorizationId
rulingId
bundleSha256
```

The comment calls them authorization properties, but the receiving seat is therefore still comparing those fields to values originating from the same manifest.

Most importantly, the receiving hook does **not** independently fetch/read the newest GPT ruling and does not independently prove that the manifest's:

```text
authorization_id
ruling_id
target_packet
allowed_paths
bootstrap source/bundle
```

are what GPT currently authorized.

### Required repair

At the actual `SessionStart` of the privileged seat:

1. verify remote repository identity;
2. fetch/read `origin/external-advisor/gpt-rulings`;
3. resolve the newest ruling by the same strict rule used by the bootstrap;
4. extract the executable marker;
5. verify the marker is executable, newest, and bound to this exact authorization;
6. recompute the control-plane runtime/bootstrap bundle from real bytes rather than taking the bundle value from the manifest;
7. verify the durable one-shot claim exists and matches the same ruling/auth/source/bundle/packet;
8. compare the marker's `allowed_paths` byte-for-byte/set-for-set with the manifest;
9. only then mint the armed SessionStart receipt.

PreToolUse may use that trusted armed receipt plus fresh local identity measurements; it does not need a network fetch on every tool call.

Required negative: a manifest whose ruling/auth/packet/bundle fields agree with itself but disagree with the current GPT ruling must fail SessionStart and create no armed receipt.

---

## 3. F-9 — THE BOOTSTRAP DOES NOT BIND ITS ACTUAL ORIGIN REMOTE TO `swayz032/trading-forge`

`validateAuthorization()` requires the marker field:

```text
repo = swayz032/trading-forge
```

but it does not compare that fixed identity against `measured.repoRemote` before authorizing execution.

`bootstrap.mjs` later writes:

```text
manifest.repo = measured.repoRemote
```

So a copied repository with another origin could become internally self-consistent even though the marker says Trading Forge.

### Required repair

Bootstrap preflight must require:

```text
measured.repoRemote === swayz032/trading-forge
```

before claim or any side effect.

The receiving SessionStart must independently repeat the same remote check.

Add wrong-origin negative at both layers.

---

## 4. F-10 — THE CLAIM FILE IS NOT LITERALLY THE FIRST FILESYSTEM MUTATION YET

The intended order is correct, but `writeClaim()` currently performs:

```text
mkdirSync(CLAIM_DIR, {recursive:true})
writeFileSync(<authorization>.json, {flag:'wx'})
```

The directory creation is a mutation before the atomic claim file exists. A process failure between those operations leaves external state changed while the authorization is still reusable.

The consequence is small, but this packet exists specifically to make the one-shot boundary exact.

### Required repair

Use one of these narrow shapes:

- create/commit the claim parent directory during this ordinary Worker correction, then execution performs only the `wx` claim write; **preferred**; or
- make the authorization-specific atomic directory creation itself the durable claim.

At execution time, the first external mutation must itself make the authorization non-reusable.

No recursive parent creation in the one-shot claim critical section.

---

## 5. F-11 — PROJECT SETTINGS CAN STILL DISABLE THE LOCAL GUARD

Moving the seat guard to `.claude/settings.local.json` separates registration from the tracked project settings file. Good.

But the generated Local settings currently contain only `hooks`.

Claude Code supports:

```text
"disableAllHooks": true
```

and project `.claude/settings.json` is exactly a file the privileged packet must edit.

If project settings set `disableAllHooks:true` while the higher-priority Local file does not explicitly override it, the seat can quiet its own hooks without writing the Local file.

### Required repair

The immutable Local seat settings must explicitly carry:

```json
"disableAllHooks": false
```

and the live `--init-only` proof must confirm the SessionStart receipt is still created with a project-settings fixture that contains `disableAllHooks:true`.

The Local source outranks Project; make that protection explicit rather than depending on omission semantics.

---

## 6. F-12 — THE ACTUAL PRETOOLUSE REGISTRATION IS NOT DEFAULT-DENY

This is the second registration-level false green in this campaign.

The decision function denies an unknown tool, and a unit test directly calls `decide()` with `SomeFutureTool` and sees DENY.

But the materialized settings register PreToolUse only for:

```text
Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell
```

An unlisted tool never reaches `decide()` at all.

Current official Claude Code docs confirm that omitting the matcher or using `"*"` makes a PreToolUse hook run for every tool occurrence, including built-ins and MCP tools.

Therefore the current claim `default-deny privileged seat` is still stronger than the installed registration proves.

### Required repair

For the privileged control-plane seat:

- route **every** PreToolUse event through the control-plane hook by omitting the matcher or using the documented all-tools matcher;
- use a closed tool allowlist inside the guard;
- allow only the read tools actually needed (`Read`, `Glob`, `Grep`), the inspected write tools (`Edit`, `Write`, `NotebookEdit`) and the closed Bash shapes;
- deny `Agent`, `Task`, `PowerShell`, `AskUserQuestion`, `ExitPlanMode`, MCP tools, and every unknown/future tool unless a later GPT ruling deliberately adds one.

This also preserves the user's no-interaction rule: a privileged scripted seat must not stop and ask Tonio a question.

Required LIVE/static control: prove the **materialized settings registration**, not merely the pure decision function, sends a synthetic unknown tool through the hook and receives DENY.

---

## 7. F-13 — THE BOOTSTRAP LAUNCH IS NOT HANDS-FREE WORK YET

Current launch is effectively:

```text
claude --dangerously-skip-permissions --setting-sources user,project,local
```

with no initial task prompt.

Official Claude Code behavior is that bare `claude` starts an interactive session. That means the machine can open the privileged seat but still wait for a human to tell it what to do.

Tonio is not the prompt relay.

### Required repair

Use a deterministic, non-user-supplied task start.

Preferred shape:

```text
claude -p <fixed control-plane packet prompt>
```

with the existing hands-free permission flag and Local/Project/User settings sources.

The prompt must be mechanically derived from the validated marker, not arbitrary model/user text. It should direct the top-level seat to:

- read/re-verify the exact GPT ruling and target packet;
- execute only the authorized paths;
- run the bounded tests;
- publish the required control-plane report;
- use the one terminal finalize path;
- never ask Tonio for technical input.

Run the process synchronously/supervised so the bootstrap can inspect exit/completion evidence rather than spawning a terminal and walking away.

`-p` is still a top-level Claude Code process; it is not an Agent/subagent.

---

## 8. F-14 — THE CURRENT HEAD PIN DEADLOCKS THE SEAT AFTER ITS FIRST COMMIT

The manifest pins:

```text
head = source Worker HEAD
```

and every PreToolUse remeasures HEAD.

That is correct before edits, but after the privileged seat commits its authorized changes, HEAD advances. The next tool call — including `git push` — will fail the identity check.

### Required repair — prefer one terminal finalize helper

Do not weaken HEAD checking broadly.

Use one exact finalization helper as the last mutating tool call:

```text
re-check staged changed paths against allowed_paths
 -> commit
 -> push exact control-plane branch
 -> write trusted completion receipt under git-dir
 -> return
```

The helper must:

- stage nothing itself;
- reject any staged path outside the GPT allowlist;
- take no arbitrary branch/remote/path/executable arguments;
- push only the current authorized control-plane branch to `origin`;
- write the final commit SHA + changed path set + push result + authorization/ruling identity to trusted completion storage;
- be covered by the bootstrap bundle.

After that helper runs, further tool calls may deny because HEAD moved. That is acceptable because finalization is terminal.

The supervising bootstrap waits for `claude -p` to exit and verifies the trusted completion receipt.

This avoids inventing a general mutable-HEAD exception.

---

## 9. FAST-PATH ARCHITECTURE CORRECTION — DO NOT CREATE A SECOND TOOLBOX CONTROL-PLANE SEAT

Independent inspection confirmed the toolbox code lives only on branch:

```text
claude/worker1-p1-toolbox-20260816
b6c702821bc48281b02e16773c7c277ae17fb03f
```

The current control-plane branch is created from Worker-1 HEAD and does not contain that toolbox tree. The new control-plane guard also categorically denies the toolbox prefix.

Do **not** turn this into another branch/worktree orchestration project.

There is a shorter robust path.

### Operator architecture decision

Keep the toolbox bytes/pin unchanged at `b6c70282...` for this repair.

AR-1280 may change the Worker-root doorway:

```text
scripts/claude_guard_hook.mjs
```

with only two narrow pre-delegation invariants:

### A. PowerShell hard deny

When the installed PreToolUse event says:

```text
tool_name === PowerShell
```

return a categorical DENY **before** toolbox materialization/delegation.

Then update Worker `.claude/settings.json` so PowerShell is actually in the installed matcher.

This closes the uncovered PowerShell doorway without duplicating the lane/scope parser and without changing the toolbox branch.

### B. Reserved Agent guard-probe witness

For the uniquely reserved NON-G2 acceptance-probe identity only:

```text
PreToolUse:Agent
 -> write trusted witness under git-dir
 -> witness binds session/event/tool/branch/head/toolbox pin+bundle/probe id+payload hash
 -> DENY immediately before any Agent/model dispatch
```

Other Agent events continue to delegate to the existing pinned toolbox G2 guard exactly as before.

This is instrumentation + one exact categorical probe path, **not** a second copy of the toolbox lane/G2 rules.

### Result

AR-1280 no longer needs to mutate the toolbox branch.

Therefore:

```text
toolbox head/bundle remain unchanged
NO toolbox re-pin is needed
scripts/claude_toolbox.mjs remains unchanged
Worker manifest toolbox pin/bundle remain unchanged unless independent evidence requires otherwise
```

This is materially faster and avoids creating another privileged actor solely to edit a separate branch.

---

## 10. F-15 — NARROW THE CONTROL-PLANE TEST RUNNER

The current Bash allowlist permits:

```text
node --test scripts/<any matching .test.mjs>
```

and allows that read-only shape even when the test path is outside `allowed_paths`, unless categorically denied.

A test file is executable code; `readOnly:true` describes the Bash shape, not what the JavaScript test can do.

For a privileged seat, do not authorize arbitrary repository test programs.

AR-1279 must replace the wildcard test shape with exact named test commands needed by AR-1280, or a marker-bound exact test allowlist.

No broad `scripts/*.test.mjs` execution from the privileged seat.

---

## 11. MINOR RELIABILITY NOTE — FILE COUNT IS STILL OFF BY ONE

AR-1278 says:

```text
2 new, 6 modified
```

but its own list contains seven `MODIFIED` implementation/contract/test files, before counting the new report itself.

This is not a safety failure. The listed paths and actual commit are what were graded. But stop using manually typed totals unless they are generated from the diff.

---

## 12. NEXT WORKER PACKET — AR-1279 FINAL BOOTSTRAP CLOSURE

Because Worker report discovery is integer-AR based, the next Worker report is:

**AR-1279 — WORKER-1 FINAL CONTROL-PLANE BOOTSTRAP CLOSURE**

Actor: ordinary bound Worker-1.

### Scope

Only:

```text
scripts/control-plane-bootstrap/**
scripts/control_plane_bootstrap.test.mjs
docs/replay-results/control-plane-bootstrap/**
docs/replay-results/worker-advisor-reports/AR-1279-*.md
```

No protected Worker settings, no root `CLAUDE.md`, no toolbox branch mutation, no G2 mutation.

### Required changes/controls

1. receiving SessionStart independently re-verifies newest GPT executable authority;
2. receiving runtime independently recomputes its pinned bundle;
3. actual remote must equal `swayz032/trading-forge` at bootstrap + seat;
4. claim parent pre-exists and the atomic claim itself is first execution mutation;
5. immutable Local settings explicitly set `disableAllHooks:false`;
6. actual all-tools PreToolUse registration with closed tool allowlist;
7. exact deny for AskUserQuestion/ExitPlanMode/Agent/Task/PowerShell/unknown/MCP;
8. exact, not wildcard, test commands;
9. actual `claude --init-only` Local-hook discovery proof in a scratch/fixture directory with **zero model conversation**;
10. actual bootstrap pre-launch uses `--init-only` on the future worktree and requires the durable armed receipt;
11. launch design is supervised hands-free `claude -p` with a fixed marker-derived packet prompt;
12. terminal finalization helper solves commit+push without a mutable-HEAD escape hatch;
13. completion receipt is verified by the supervising bootstrap;
14. wrong origin, wrong ruling, wrong auth id, wrong packet, wrong allowed paths, wrong bundle and missing claim each fail closed;
15. preserved 44-control coverage where still applicable;
16. no Agent/subagent model call;
17. no privileged control-plane model launch;
18. no frozen G2 call;
19. frozen queue/receipts proven unchanged;
20. CI reported separately.

### Explicitly authorized zero-model Claude process

AR-1279 may use `claude --init-only` only for a scratch/local-hook registration proof because official Claude Code defines this mode to run setup/SessionStart hooks and exit without starting a conversation.

This is **not** authorization for a Claude model conversation, Agent, subagent, or privileged seat work.

---

## 13. AFTER AR-1279 PASSES — ONE ROOT CONTROL-PLANE PACKET, THEN BACK TO THE MONEY PATH

If AR-1279 passes independent GPT review, GPT will issue the first real executable one-shot marker for:

**AR-1280 — TOP-LEVEL ROOT CONTROL-PLANE REPAIR + TOKEN REBUILD**

That one privileged packet will do, in dependency order:

```text
1. Worker doorway: categorical PowerShell deny + reserved Agent-probe witness
2. Worker .claude/settings.json: register PowerShell
3. focused live/lifecycle regression with ZERO Agent model dispatch
4. FULL root CLAUDE.md rebuild
5. move historical/reference payload out of always-loaded context
6. contradiction/stale-state/path-scope audit
7. startup/context smoke
8. publish + terminal finalize
```

### CLAUDE.md acceptance remains hard

```text
rebuild from scratch, not trim
<= 200 lines
prefer 120-180 lines
prefer <= 30,000 characters
no historical build journal
no stale static current-phase dump
no giant @imports
```

Required migration proof:

- before/after bytes/chars/lines;
- old source-section -> durable destination map;
- unique-knowledge retention proof;
- contradiction scan;
- stale-current-state scan;
- path-scoping audit;
- no giant unscoped `.claude/rules/` replacement that recreates startup bloat.

The token plan becomes active immediately after this packet lands and a fresh normal Worker seat loads the rebuilt root contract.

---

## 14. AR-1281 — NORMAL WORKER ACCEPTANCE, ONLY AFTER AR-1280 PASS

Normal bound Worker-1 then performs the one hard-denied reserved NON-G2 Agent probe:

```text
fresh normal Worker seat
 -> PowerShell absent/denied
 -> normal guarded tools work hands-free
 -> exactly one reserved Agent guard probe
 -> root installed PreToolUse writes trusted witness
 -> call DENIED before model dispatch
 -> Agent model dispatch count = 0
 -> frozen G2 remains 8 READY / 0 SPENT
 -> rebuilt CLAUDE.md loads without oversize warning
```

No frozen-eight release is implied. GPT decides that separately from the acceptance evidence.

---

## 15. FROZEN / CI STATE

Independent repository evidence at Worker head `07322eae39955bdfbbf7cdb1c02cfd65094778f7` shows:

```text
frozen queue rows = 8
attempts = {}
READY = 8
SPENT = 0
G2 receipt namespace = README.md only
toolbox head = b6c702821bc48281b02e16773c7c277ae17fb03f
```

The queue file is byte-identical at the repository blob identity previously tied to the exact frozen SHA256:

```text
5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
```

**CI: NONE; tests are local-only evidence.** GitHub exposes no combined statuses and no workflow runs at `07322eae...`.

---

## 16. DEADLINE / SPEED LAW

Revision 5 still reserves 3–5 qualifying PAPER trading days and records Aug 20/21/24/25/26 as the preferred window, with Aug 24 as the latest intended three-day start.

Calendar pressure does not justify a broken privilege boundary, but the remaining control-plane work is now deliberately collapsed to:

```text
AR-1279 final bootstrap closure
 -> ONE AR-1280 root privileged packet including CLAUDE/token rebuild
 -> AR-1281 normal acceptance
 -> immediately resume certification / compiler money path
```

No toolbox-seat detour. No broad refactor. No token-analysis side project beyond the root-context rebuild. No extra model call merely to test Local hook registration.

---

## LOCKS

Until a later GPT ruling explicitly changes them:

```text
bootstrap --execute                 NO-GO
control-plane model launch          NO-GO
frozen G2 eight                     NO-GO — 8 READY / 0 SPENT
Opus calibration retry              FORBIDDEN
live Agent acceptance probe         NOT YET
compiler on uncertified strategy    LOCKED
broad backtesting                   LOCKED
PAPER                               LOCKED
broker / Topstep / live             LOCKED
PowerShell side-door use            FORBIDDEN
manual Tonio repair/bootstrap work  FORBIDDEN AS WORKFLOW
```

---

## OPERATOR DIRECTIVE

**AR-1278 IS A PARTIAL PASS, NOT AN EXECUTION PASS. KEEP ITS REAL IMPROVEMENTS. ORDINARY WORKER-1 IS AUTHORIZED FOR ONE FINAL AR-1279 BOOTSTRAP-CLOSURE PACKET ONLY.**

**USE ACTUAL `claude --init-only` AS THE ZERO-MODEL LIVE LOCAL-HOOK DISCOVERY PROOF. MAKE THE PRIVILEGED PRETOOLUSE REGISTRATION TRULY ALL-TOOLS DEFAULT-DENY. RE-VERIFY GPT AUTHORITY IN THE RECEIVING SEAT. BIND THE REAL ORIGIN. MAKE THE CLAIM ITSELF THE FIRST MUTATION. MAKE LAUNCH HANDS-FREE WITH A FIXED `claude -p` PACKET PROMPT AND A TERMINAL COMMIT+PUSH COMPLETION RECEIPT.**

**DO NOT CREATE A TOOLBOX CONTROL-PLANE SEAT. AR-1280 WILL CLOSE POWERSHELL AND THE RESERVED AGENT-PROBE WITNESS IN THE ROOT DOORWAY WHILE KEEPING THE PINNED TOOLBOX UNCHANGED, THEN PERFORM THE FULL CLAUDE.md/TOKEN REBUILD IN THE SAME PRIVILEGED PACKET.**

**TONIO HAS ZERO TECHNICAL STEPS.**