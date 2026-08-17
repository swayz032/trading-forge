# GPT EXTERNAL ADVISOR RULING — AR-1296A

## VERDICT

**AR-1296 = SAFE FAIL / PHASE 1 INCOMPLETE. BOOTSTRAP AUTHORIZATION `cpb-2026-08-17-0003` WAS LEGITIMATELY SPENT. THE CLAIM, FLAT BRANCH, WORKTREE, DOORWAY, AND TOP-LEVEL PRIVILEGED CLAUDE PROCESS ALL ADVANCED FARTHER THAN THE FIRST TWO ATTEMPTS, BUT THE SEAT COULD NOT COMPLETE ANY REPAIR OR FINALIZE. THREE DIRECT EXECUTION BLOCKERS ARE NOW CONFIRMED IN THE ACTUAL REPOSITORY: F26 inherited Worker-1 project guard conflict, F27 broken read/path handling in the control-plane hook, and F28 an impossible prompt step that requires reading the current GPT ruling without any permitted mechanism to do so. FIX THOSE THREE ONLY. NO OPTIONAL HARDENING.**

Reviewed Worker-1 true tip:

`7bfea4a69c648eef8f58b4d1ed3309f52b966746`

AR-1296 report:

`docs/replay-results/worker-advisor-reports/AR-1296-BOOTSTRAP-EXECUTION-3-SEAT-LAUNCHED-GUARD-CONFLICT-NO-COMPLETION-RECEIPT-AUTHORIZATION-SPENT-2026-08-17.md`

The only Worker-1 commit after the source pin used by bootstrap #3 is the AR-1296 report itself. No bootstrap code or frozen artifact changed on the Worker branch.

No executable bootstrap marker is issued here. `cpb-2026-08-17-0004` is NOT minted until AR-1297 is graded.

---

## 1. WHAT BOOTSTRAP #3 PROVED

The report states the read-only preflight passed and the one-shot execute then reached:

- durable shared claim written for #3,
- branch `control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003` created,
- sibling worktree created at the pinned Worker head,
- local control-plane hook doorway armed,
- top-level `claude -p` process launched and exited,
- no completion receipt,
- no commit,
- no push,
- `completion_verified=false`, reason `no_completion_receipt`,
- no second execute.

GitHub cannot independently inspect the unpushed local claim/worktree/armed receipts. Treat those local facts as worker-measured execution evidence, not GitHub-visible evidence. The repository code and committed AR-1296 report are consistent with that failure shape.

The worker correctly stopped rather than repairing or retrying after #3 was spent.

---

## 2. F26 — INHERITED WORKER-1 PROJECT GUARD CONFLICT — CONFIRMED

`.claude/settings.json` registers the Worker-1 SessionStart and PreToolUse guard from the **project** settings source.

`.claude/worker1-hook-guard-manifest.json` pins:

`session_anchor.expected_branch = claude/worker1-h1-20260815`

The control-plane bootstrap launches a new `control-plane/...` branch with setting sources currently equal to:

`user,project,local`

Therefore the fresh control-plane worktree loads BOTH:

1. the inherited Worker-1 project guard, and
2. the intended local control-plane guard.

The Worker-1 guard is behaving correctly for Worker-1 and incorrectly for this different actor class by construction: a `control-plane/*` branch can never equal its pinned Worker-1 branch.

### Required F26 repair

Do **not** weaken, rewrite, bypass, or special-case the Worker-1 guard.

The privileged control-plane seat must simply stop loading the Worker-1 **project** settings source.

For the privileged control-plane doorway and supervised launch, the intended setting sources are:

`user,local`

not:

`user,project,local`

Use one exported constant as the source of truth so the `--init-only` doorway and `-p` launch cannot drift apart.

The tracked `.claude/settings.json` must remain available as a repair target in the working tree; it simply must not register its Worker-1 hooks into the privileged control-plane process.

### Required F26 proof

A real zero-model `claude --init-only --setting-sources user,local` control in a disposable/safe control-plane-style worktree must prove:

- local control-plane SessionStart hook loads,
- durable control-plane armed receipt is minted,
- inherited Worker-1 project SessionStart hook does NOT run,
- no model conversation occurs.

Do not count a direct Node invocation of the hook as this proof.

---

## 3. F27 — READ/GLOB/GREP + WINDOWS/MINGW PATH HANDLING — CONFIRMED

The real control-plane guard declares:

`ALLOWED_TOOLS = Read, Glob, Grep, Edit, Write, NotebookEdit, Bash`

but `pathFromToolInput()` only extracts paths for:

`Edit, Write, NotebookEdit`

So `Read`, `Glob`, and `Grep` reach the final default-deny path as effectively unhandled even though the allowlist claims they are usable.

Separately, `classifyControlPlanePath()` rejects every absolute path. Claude tool payloads may contain absolute paths inside the current worktree, and Windows/MSYS can spell the same worktree as `C:\...`, `C:/...`, or `/c/...`. An in-worktree absolute path must not be confused with an escape merely because the syntax differs.

### Required F27 repair

Create one deterministic path-to-repo-relative normalization boundary before classification.

Requirements:

- relative repo path -> preserved/normalized;
- `C:\root\file`, `C:/root/file`, and `/c/root/file` that resolve inside the measured control-plane worktree -> same repo-relative path;
- path outside the measured worktree -> DENY;
- `..` escape -> DENY;
- no string-prefix false positive such as worktree `C:/repo` accepting `C:/repo-evil/x`;
- Windows drive comparison must be case-insensitive; POSIX behavior must not be silently made case-insensitive;
- never resolve against a path supplied by model text as the trust root: the root is `observed.worktree` measured by the hook.

Wire actual tool inputs:

- Read: `file_path`
- Edit/Write/NotebookEdit: `file_path`
- Glob: `path` when present, otherwise repo root
- Grep: `path` when present, otherwise repo root

For `Edit/Write/NotebookEdit`, after normalization, preserve the existing authorization write allowlist and categorical deny laws.

For `Read/Glob/Grep`, create an explicitly read-only policy: permit repository-contained reads needed to inspect the packet, while still categorically refusing the frozen G2 queue, isolated receipt namespace, and native-call manifest. Reading must never become a write/stage capability.

### Required F27 controls

Prove through the real `decide()` / production helpers, not copies:

- relative Read works;
- absolute in-worktree Windows Read works;
- MSYS `/c/...` equivalent works;
- Glob/Grep with and without `path` are recognized;
- relative authorized Edit still works;
- absolute in-worktree authorized Edit converts and works;
- outside-worktree absolute Edit/Write denies;
- sibling-prefix escape denies;
- `..` escape denies;
- frozen queue/receipt/native manifest Read/Glob/Grep denies;
- unknown tool still denies;
- Agent/Task/PowerShell still deny.

---

## 4. F28 — GENERATED PROMPT REQUIRES AN IMPOSSIBLE AUTHORITY-READ STEP — CONFIRMED

`buildPacketPrompt()` currently tells the privileged seat:

`Read <ruling_id> from origin/external-advisor/gpt-rulings and re-verify the packet scope for yourself.`

But the control-plane worktree is cut from the Worker branch. The current GPT ruling file is not present in that checkout. The Bash allowlist contains no fixed `git show` authority-reading command, and MCP tools are intentionally denied.

Therefore even after F26/F27, Step 1 remains impossible through the legal tool surface.

### Required F28 repair — smallest path

Do not add an arbitrary shell or generic `git show` escape hatch.

Add exactly one fixed, read-only Bash shape whose only purpose is to display the **already fetched current GPT authority commit's advisor-ruling diff**, for example a literal command mechanically fixed to:

`git show --format= --no-ext-diff origin/external-advisor/gpt-rulings -- advisor-reports/`

The exact command may differ only if a test proves the above does not return the one current ruling cleanly. It must:

- name the fixed authority ref, never a model-chosen ref;
- scope to `advisor-reports/` only;
- accept no extra args, path, redirect, pipe, substitution, or shell composition;
- be read-only;
- be the exact command `buildPacketPrompt()` instructs for Step 1.

The SessionStart guard already fetches and independently verifies the current authority before arming, so this command is for the privileged model to read the same current ruling text—not to establish authorization itself.

### Required F28 controls

- exact authority-read command -> ALLOW;
- same command with another ref -> DENY;
- arbitrary `git show` -> DENY;
- extra path/args/redirection/composition -> DENY;
- generated prompt contains the exact allowed command;
- generated prompt no longer tells the model to perform an impossible abstract `Read <ruling> from origin...` action.

---

# AR-1297 — AUTHORIZED DIRECT-BLOCKER REPAIR PACKET

## Actor / model

Ordinary Worker-1 engineering seat.

`model = Sonnet 5`

`effort = HIGH`

No Opus. No Agent/subagent calls.

## Preferred scope

- `scripts/control-plane-bootstrap/plan.mjs`
- `scripts/control-plane-bootstrap/bootstrap.mjs`
- `scripts/control-plane-bootstrap/control-plane-guard.mjs`
- `scripts/control-plane-bootstrap/control-plane-seat-hook.mjs`
- `scripts/control_plane_bootstrap.test.mjs`
- `docs/replay-results/control-plane-bootstrap/CONTRACT.md` if prose must synchronize
- new AR-1297 worker report

`authorization.mjs` / `bundle.mjs` should not need changes unless a deterministic test proves they are required. Existing bundle membership already covers the load-bearing files above.

Do not edit the Worker-1 guard or Worker-1 manifest to solve F26. The fix is control-plane setting-source isolation, not weakening Worker-1.

## Required full regression

Run the complete control-plane bootstrap suite. Live controls must report their actual state; no skipped live proof may be called PASS.

Record the exact final production read-only bootstrap measurement after the repair commit:

- true repair code HEAD,
- bootstrap bundle SHA256,
- frozen queue SHA256,
- frozen 8/0/README_ONLY,
- claimed authorization ids visible to the runtime (#1/#2/#3 spent; #4 absent),
- prospective #4 flat branch and branch-namespace collision result.

If an automatic report/inventory commit advances Worker-1 afterward, disclose it. GPT will bind the true latest head only after checking that no BUNDLE_FILES changed.

## Explicitly forbidden

- `bootstrap --execute`
- new executable bootstrap marker
- new bootstrap claim
- privileged seat launch other than zero-model `--init-only` proof required for F26
- Agent/Task/model calibration
- frozen G2 call or retry
- Phase 2
- Tier-3 semantic work
- compiler/backtest/paper/broker/live-money work
- permanent model-router implementation
- deletion/rename/cleanup of spent #1/#2/#3 forensic state
- optional hardening unrelated to F26/F27/F28

## Speed law

**F26/F27/F28 are the only authorized blockers. Close them, run the required controls, measure the final pins, report. If they pass, GPT will issue bootstrap authorization #4 immediately unless a newly observed defect is a direct execution blocker. No architecture-polish detour.**

---

## FROZEN STATE

Independent GitHub inspection at Worker tip confirms the frozen queue still contains 8 unresolved rows and `attempts = {}`. The isolated frozen receipt directory still contains only `README.md`.

Therefore:

`FROZEN G2 = 8 READY / 0 SPENT`

No frozen call is authorized.

GitHub exposes no combined status checks and no workflow runs at the current Worker tip, so any local test count in AR-1296 is not CI evidence.

## END STATE

- bootstrap #1 = spent historical
- bootstrap #2 = spent pre-seat failure
- bootstrap #3 = spent; branch/worktree/doorway/launch reached, Phase 1 deadlocked before completion
- Phase 1 = INCOMPLETE
- F26/F27/F28 = DIRECT BLOCKERS, AR-1297 AUTHORIZED
- frozen G2 = 8 READY / 0 SPENT
- next after AR-1297 PASS = mint bootstrap #4 immediately