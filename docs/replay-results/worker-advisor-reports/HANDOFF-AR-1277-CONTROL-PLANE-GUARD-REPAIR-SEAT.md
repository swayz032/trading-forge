# HANDOFF — AR-1277 → CONTROL-PLANE / GUARD-REPAIR SEAT

**Authority:** AR-1276 §7 ("route/hand off to the permitted control-plane seat through the
established engineering workflow"). Written by the bound Worker-1 seat, which is **not** the
permitted actor for AR-1277 and did not attempt any part of it.

**This is not a worker AR report.** It is deliberately not `AR-`numbered, so
`scripts/worker-report-latest.mjs` ignores it and the newest-report contract stays clean.

---

## 1. ACTOR — READ THIS FIRST

AR-1277 is assigned to a **dedicated top-level desk-authorized CONTROL-PLANE / GUARD-REPAIR seat** —
the same class of actor that repaired/re-pinned the SessionStart→PreToolUse lifecycle defect.

It is **NOT**:

- the ordinary bound Worker-1 lane;
- an `Agent`/subagent spawned from Worker-1 (AR-1276 §7, and AR-1276 §10 forbids any model dispatch);
- Tonio. He is not the bootstrap, permission pipeline, report relay or repair technician (§10).

A bound Worker-1 seat **must not** bypass self-protection to do this work. AR-1276 graded exactly
that refusal as correct.

---

## 2. STATE AT HANDOFF — MEASURED, NOT REMEMBERED

```
Worker-1 branch     claude/worker1-h1-20260815
Worker-1 head       51ad3d94  (the head AR-1276 independently inspected)
                    + this handoff commit, which advances it — re-read the tip, do not trust this line
toolbox pin         b6c702821bc48281b02e16773c7c277ae17fb03f
toolbox bundle      c8b7cec408b017ce6d2c04dcc4ad705726c3bfadbd9e9f4afb0a9d0c6aee894e
toolbox source      advisor-prepared/gpt-speed-engineering-lane/tooling/**
                    on origin/claude/worker1-p1-toolbox-20260816   (PIN is authority; branch is a hint)
governed dirty      docs/wave25-exit-engine-ab-report.md @ diff e200765c11e8 (AR-1265 §4) — LEAVE IT
newest GPT ruling   AR-1276 @ e0e34fcc on origin/external-advisor/gpt-rulings
```

### Frozen G2 — verified before AND after AR-1275, unchanged

```
queue[] entries = 8      "attempts": {}      READY 8 / SPENT 0
excluded[]      = 4      derived_from.condition_count = 12  (8+4, internally consistent)
receipts isolated-receipts-t1/ = README.md ONLY
.attempt / .dispatch / .raw / .completion = 0 / 0 / 0 / 0
```

### 🛑 AR-1276 §F PLANTED WRONG-HASH CONTROL — DO NOT COPY THE WRONG 64-HEX VALUE

AR-1276 §F prints a hash and then **rejects it in the same breath**. It is the *extraction* SHA
that appears inside the queue JSON, included so a packet cannot pass by finding a familiar
64-hex string in the file.

```
REQUIRED queue SHA : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
NOT the queue SHA  : 5935b1c6c03860b35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823   <- extraction SHA, trap
```

Both begin `5935b1c6c03860b35`. **Compare the full string, not the prefix.**

---

## 3. THE PACKET (AR-1276 §7) — condensed; the ruling is authoritative

**Authorized scope** — only what is necessary among:

```
advisor-prepared/gpt-speed-engineering-lane/tooling/**
.claude/settings.json
.claude/worker1-hook-guard-manifest.json
scripts/claude_toolbox.mjs
scripts/worker1_seat_launch.ps1        # only if a measured runtime PowerShell disable needs it
CLAUDE.md
AGENT-LOGS.md / .claude/rules/** / named destination docs for moved CLAUDE.md history
```

Do **not** touch the frozen queue, native-call manifest, or receipt files.

- **A. Agent hook witness preparation** — trusted session-bound witness under the guard runtime /
  git-dir (NOT a Worker-writable repo path); bind ≥ session id, event, tool name, verdict, live
  branch/head, toolbox pin, bundle; store a probe id / prompt hash, never raw prompts; self-protect
  it; add ONE reserved non-G2 Agent guard-probe identity; prove mechanically it cannot equal any of
  the frozen 8; on that probe, persist witness then **DENY before dispatch**.
  ⚠ **AR-1277 installs and proves the mechanism. It does NOT perform the live Agent attempt.**
- **B. PowerShell containment** — preserve `--dangerously-skip-permissions`; add `PowerShell` to the
  installed matcher **and** bridge-deny `tool_name === "PowerShell"` fail-closed; prove unknown-tool
  fallthrough does not reopen it (matcher-only is explicitly insufficient — the bridge falls through
  unknown tools as `guarded:false`); optional runtime-surface removal only after measuring the exact
  control. No shell-language parser.
- **C. `CLAUDE.md`** — 205,646 bytes / 1,096 lines → **≤ 100,000 chars**, preferably far less. Move,
  never delete. Evidence: before/after bytes+chars+lines, source→destination map, hot-rule
  preservation check, no unique knowledge lost. Replace stale static "current phase" prose with the
  dynamic pointer (GPT onboarding → Blueprint V4 → Revision 5 → newest GPT ruling → repo evidence).
- **D. Re-pin, if toolbox bytes change** — advance only from `b6c70282`; compute the bundle with the
  production materializer; cross-check independently; update **BOTH** halves
  (`scripts/claude_toolbox.mjs` actual pin **and** manifest `_toolbox_pin` + `_toolbox_bundle_sha256`);
  append truthful pin history; verify descendant ancestry; run the live doorway.
  **`A RE-PIN IS TWO FILES. CHANGE ONE AND YOU HAVE EITHER A BRICK OR A LIE.`**
- **E. Test order** — probe witness RED/GREEN → PowerShell RED/GREEN → collision/forgery/mutation
  negatives → lifecycle suite → G2 pre-call regression → full toolbox suite once → live doorway
  dry-run with no dispatch → GitHub CI reported separately.
- **G. Required runtime statement** — `Agent/subagent model executions: 0`,
  `Opus calibration retries: 0`, `Frozen G2 calls executed: 0`.
- **H. Report** — may land on the repair seat's own branch, or here at
  `docs/replay-results/worker-advisor-reports/`. Never require Worker-1 to write the GPT branch.

---

## 4. ENVIRONMENT FACTS THE NEXT SEAT WILL HIT — measured this session, so you don't re-pay for them

These cost real time to discover. They are properties of the guarded seat, not bugs to fix:

| Observation | Consequence |
|---|---|
| Bash refuses any command text containing `<` or `>` (`file-output redirection … blocked`) | The co-author trailer `<noreply@anthropic.com>` makes `git commit -m` **unconditionally fail**. Use `scripts/worker-commit.mjs --msg-file <path>` (AR-1274 §8 helper, already shipped): it moves the message to the git-dir, commits `-F`, and self-cleans so nothing untracked survives. |
| `Write` is fenced to the repo root | You cannot create scratch outside the repo. Untracked files block SessionStart, so scratch must be deleted by a Node helper, not Bash. |
| Bash file mutation blocked, but `mkdir` permitted; `rm`/redirect blocked | A throwaway git fixture is still buildable via `git commit --allow-empty` (no file writes). That is how the ear red-proof was obtained. |
| `git branch -a --contains`, and a batch containing `git cat-file`/`git merge-base`, refused as *"branch/worktree/history mutation"* | Read-only false-positives. Re-express the query; do **not** route around via PowerShell (§10). |
| Bash is fenced from protected surfaces even read-only (`.claude/settings.json`, frozen queue, toolbox path) | But the **`Read`/`Grep`/`Glob` tools reach the frozen queue fine.** That is how the §G before/after evidence was taken. Use those, not Bash. |
| `PowerShell` executes with **zero** guard interposition | Independently re-confirmed in AR-1275. This is track B's whole reason for existing. |
| pre-commit stashes/restores unstaged files | It ran twice here and the governed dirty file survived intact — but AR-1274 §8 flags it as unsafe with concurrent worktrees. Stage explicit paths; never `git add -A`. |

---

## 5. WHAT AR-1275 DID NOT PROVE (AR-1276 §9) — keep these bounded

- `Agent` appearing in `.claude/settings.json` does **not** prove a real Agent event traversed the hook.
- An **allowed** Agent call is non-discriminating: "hook fired and allowed" and "hook never fired"
  look identical. That is the open witness.
- PowerShell being read-only in AR-1275 does **not** prove it cannot write — it proves the surface
  sits outside guard interposition.
- Local tests are **not** GitHub CI. CI at both the Worker head and the toolbox pin: **NONE**.
- `CLAUDE.md` cleanup repairs no mechanical guard gap.
- The report helper discovers reports; it does not certify their content.

---

## 6. AFTER AR-1277 PASSES — NOT BEFORE

A green AR-1277 does **not** release the frozen eight. The next acceptance packet returns to the
**normal Worker-1 desktop shortcut** and proves: hands-free startup with no approval prompts →
PowerShell absent or denied → one real reserved Agent **tool attempt** reaches installed PreToolUse
→ durable witness exists → guard DENIES before dispatch → model executions 0 → frozen eight still
8 READY / 0 SPENT → slimmed `CLAUDE.md` loads without the oversize warning.

🛑 **If that live probe unexpectedly launches a model because the hook did not fire: STOP, report the
real dispatch honestly, and DO NOT RETRY.** An unexpected dispatch is never relabelled a
zero-dispatch success. Only a later GPT ruling releases the frozen eight.
