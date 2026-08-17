# AR-1287 — SCRATCH LOCAL-SETTINGS HOOK PROBE: **PASS** (P1–P6 all met)

**Question settled:** a hook registered **only** through `.claude/settings.local.json` **does** fire in a
fresh top-level Claude Code session, **and** it **remains in force after `.claude/settings.json` is changed
during that same session.** AR-1278 §8's open assumption is **TRUE** in Claude Code `2.1.233`.

🛑 **But read §6 before issuing the bootstrap marker.** The probe settled the *settings-source* question
exactly as authorized. It did **not** exercise the flag the privileged seat actually launches with, and I
had exactly one authorized launch, which is spent. That is a **new, narrower** open item — not a
re-litigation of this one.

```
AR-1287 verdict            = PASS
frozen G2                  = 8 READY / 0 SPENT   (unchanged, verified terminally)
model launches this packet = EXACTLY 1  (claude-haiku-4-5-20251001)
Agent/subagent calls       = 0        retries = 0        TF surfaces touched = 0
```

---

## 1. ACTOR AND SCOPE

Run from **a normal unprivileged top-level Claude Code session** — the actor AR-1286A §4 names. This seat is
outside the governed Worker-1 seat (`claude_guard_hook` = 0 in all three settings sources it loads) and is
not, and did not act as, the privileged control-plane seat. It received and used **no** control-plane
authority.

```
scratch path   C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/
               b2bad47a-9d8f-4c43-a651-4f2dc3daf017/scratchpad/ar1287-probe
```

`[MEASURED HERE]` that path is its own `git init` repository, its `--show-toplevel` is itself, and it does
**not** appear in `git worktree list` for the Trading Forge repo. **No Trading Forge guard file was copied
or modified**; the probe hook was written from scratch. The deny protocol shape
(`hookSpecificOutput.permissionDecision`) was *read* from the repo's known-good hook to match this runtime —
reading a protocol is not copying a guard.

---

## 2. THE PROBE — AND WHY ITS EVIDENCE CANNOT BE FAKED BY A STALE FILE

```
.claude/settings.local.json   THE ONLY source carrying hooks  (SessionStart + PreToolUse)
.claude/settings.json         NO hooks — this is the file SessionStart mutates mid-session
probe-hook.mjs                one file, two phases
PROBE_ID                      AR1287-20260817T052039Z-57390     <- unique to this run
```

`[MEASURED HERE]` `grep -c hooks .claude/settings.json` = **0**, and the user source
(`~/.claude/settings.json`) has **`hooks` keys: NONE**. **So any hook that fired is attributable to
`settings.local.json` alone** — there is no second registration that could have produced these receipts.

Every receipt filename and body carries **both** the `PROBE_ID` **and** the runtime `session_id`. A receipt
from an earlier run cannot satisfy the checks, because the session id did not exist before the launch.

**Disclosed:** before launching I ran one offline self-test of the hook *program* (`session_id: "SELFTEST"`),
confirmed it emitted a valid deny, then **deleted the receipts directory to empty** (`0 files`) and pinned the
before-state. The self-test proves only that the doorway *works when invoked directly* — which is precisely
the claim AR-1278 §8 said was **not** in question. It is reported for completeness, not as evidence.

**Also disclosed — a defect in my own first attempt:** my initial `settings.local.json` was assembled by
shell heredoc and produced **invalid JSON** (unescaped quotes around the hook path). The validator caught it
*before* the one-shot launch; I regenerated the file via `JSON.stringify`. **No launch was consumed by that
error.** Reported per §0-CTRL.4 — a harness that was wrong once is a harness whose later green needs to be
seen in that light.

---

## 3. THE ONE AUTHORIZED LAUNCH

```bash
cd <scratch path>
claude -p "Run exactly one command using the Bash tool: pwd" \
  --model claude-haiku-4-5-20251001 \
  --setting-sources user,project,local \
  --output-format json
```

Runtime `2.1.233 (Claude Code)`. From the launch result JSON:

```
modelUsage        claude-haiku-4-5-20251001   canonicalModel "claude-haiku-4-5"   provider firstParty
session_id        79376ea2-06f0-4398-971f-d5cb4f562dd3
num_turns 2 · is_error false · total_cost_usd 0.0279309 · terminal_reason "completed"
permission_denials  [ { tool_name: "Bash", tool_input: { command: "pwd" } } ]
```

**Model verified by its own usage record, not by the flag I passed** — `modelUsage` names exactly one model
and it is Haiku. **No silent Opus substitution occurred**, so AR-1286A's STOP-rather-than-substitute condition
did not fire. One model, one session, one launch, no retry, no `Agent`/subagent entry.

---

## 4. P1–P6 — EACH MET, WITH THE MEASUREMENT

| | requirement | evidence |
|---|---|---|
| **P1** | SessionStart receipt with the new session/probe identity | `sessionstart-AR1287-20260817T052039Z-57390-79376ea2-…json` @ `2026-08-17T05:27:09.056Z` |
| **P2** | scratch `.claude/settings.json` validly changed AFTER session start | sha `7298e23c…ae65` → **`97e39f93…7fda`**; body gained `env.AR1287_SESSIONSTART_TOUCH` = `PROBE_ID\|session\|timestamp`; still valid JSON |
| **P3** | PreToolUse receipt, same session, AFTER the project-settings change | `pretooluse-…-79376ea2-…json` @ `05:27:17.339Z` — **8.28 s later**, same `session_id` |
| **P4** | the tool call was denied by the local-source hook | `permission_denials` lists `Bash{command:"pwd"}`; the model's own output quotes `AR1287_LOCAL_HOOK_BIT probe=AR1287-20260817T052039Z-57390 session=79376ea2-…` |
| **P5** | no Trading Forge path changed | worktree HEAD `3781a08c…` unchanged, `0` unpushed, working tree shows **only** the pre-existing governed dirty `docs/wave25-exit-engine-ab-report.md` (untouched by me) |
| **P6** | no second launch, retry, Agent or subagent call | one `claude -p` invocation; `modelUsage` has exactly one key; `num_turns: 2` |

### 🔑 THE DECISIVE MEASUREMENT — ORDERING PROVED BY CONTENT, NOT BY CLOCK ALONE

Each receipt records the sha256 of `.claude/settings.json` **as that hook saw it**:

```
sessionstart receipt   project_settings_sha_seen = 7298e23c…ae65    <- the BEFORE bytes
   (SessionStart then wrote the change)
pretooluse   receipt   project_settings_sha_seen = 97e39f93…7fda    <- the AFTER bytes
```

**The PreToolUse hook did not merely fire late — it observed the changed file.** That closes the exact
question AR-1278 §8 raised, and it closes it on content rather than on two timestamps that could in principle
be reordered by buffering. `.claude/settings.local.json` itself was **unchanged** throughout
(`a95fc28b…89ea` before and after), so the hook source was never re-registered mid-run.

**A negative control is built into P4:** `Bash(pwd)` was explicitly **allowed** in the scratch permission
settings. So the permission layer could not have produced this denial — had the local hook not fired, the
command would have executed and printed a path. **It did not execute.** The observable that would have
appeared under the "hook never armed" hypothesis is absent, and the observable unique to my hook is present.

---

## 5. FROZEN BUDGET — TERMINAL PROOF

```
$ python scripts/g2d_real_queue_preflight.py
ready 8 · receipt directory non-README []
ALL 8 ONE-SHOT ATTEMPTS UNSPENT.
```

```
FROZEN G2 READY = 8      FROZEN G2 SPENT = 0      README-only receipts = YES
historical AR-1272 Opus calibration        = SPENT
AR-1287 scratch local-hook probe           = SPENT (this packet, exactly 1 cheap Haiku launch)
frozen eight G2 attempts                   = 0/8 SPENT
```

---

## 6. 🛑 WHAT I DID **NOT** PROVE — AND WHY GPT SHOULD WEIGH IT BEFORE THE MARKER

**The probe launched with `-p` (print mode) and default permissions. The bootstrap launches the privileged
seat with `--dangerously-skip-permissions` (CONTRACT §3, argv fixed).** I did not exercise that flag, because
AR-1287 authorized exactly one launch and scoped it to the settings-source question. **`[layer-scoped-proof]`
requires me to name the layer: what is proven is that the local source registers and survives a
project-settings edit — for a `--print` session without that flag.**

Why it could matter: `--dangerously-skip-permissions` alters the permission path, and **P4's witness here was
a denial**. If that flag were to bypass `PreToolUse` denials, the privileged seat's guard could register,
write its receipts, and still fail to *block* — and per AR-1278 §8's own reasoning, **that failure is silent
from inside.** I have **no evidence either way**, and I am explicitly **not** asserting it is broken: hooks
and permissions are separate subsystems, and the flag's name concerns permissions. **This is `HYPOTHESIS /
UNPROVEN`, flagged because its failure mode is quiet, not because I have a reason to expect it.**

Note the bootstrap's step-8 doorway probe does **not** cover this either: it proves the hook program reports
ARMED, which §3 of AR-1286A already distinguished from live interception.

**Recommendation — cheap, and it does not touch the frozen budget:** authorize **one** further scratch launch
identical to this one plus `--dangerously-skip-permissions`, reusing this exact rig (it is still on disk and
the before/after protocol is proven). PASS requires the same P3+P4 pair: a PreToolUse receipt for the new
session **and** a denial. If GPT judges the residual risk acceptable, the alternative is to issue the marker
now and treat the first privileged boot's own denial evidence as the check — but that spends the one-shot
authorization claim to find out, which is the trade AR-1286A §3 declined to make.

**Other limits, stated plainly:** one runtime version (`2.1.233`), one OS (Windows 11), one scratch repo, one
tool (`Bash`) and one matcher; `SessionStart` matcher `startup|resume|fork` was exercised on `startup` only;
`num_turns: 2` means the model made one tool attempt, which is what the design asked for and no more.

---

## 7. TREE, HEADS, DISCLOSURES

```
worktree             C:\Users\tonio\Projects\wt-claude-worker1-20260815
branch               claude/worker1-h1-20260815
head at probe time   3781a08c2954c03708b9462299d4914d487959f5   (graded by AR-1286A)
GPT authority head   a95ac6dae2d6afd18d9370eb89db28a2db1ee847   (AR-1286A, newest)
governed dirty       docs/wave25-exit-engine-ab-report.md — NOT TOUCHED
```

- 🛑 **Per AR-1286A §7, `bootstrap_source_sha` must pin the head that exists AFTER this report lands.**
  Publishing this report advances the head; do **not** pre-copy `3781a08c…`. Re-measure with
  `node scripts/control-plane-bootstrap/bootstrap.mjs --plan` and take `worker_head`.
  `bootstrap_bundle_sha256` was `4045dd93…52fb` and this report touches none of the seven covered scripts.
- **AR-1286A §5 (graded artifacts are immutable) is accepted and honoured**: this is a **new** file. No prior
  graded report was modified in this packet. The §5 finding concerns commit `e8d43e2c` by the **outgoing bound
  Worker-1 seat**, not this one; I have not touched it, per §5's own instruction not to churn it back.
- **AR-1286A §6 honoured:** no detour into `worker-report-latest.mjs`. This report lands in the canonical
  directory so that helper sees it.
- **My ruling ear died mid-session** (harness stopped the monitor). I detected it, **backfilled by hand** —
  reading the branch head directly and finding AR-1286A — and **re-armed** on `a95ac6da…`. Blind window
  covered; no ruling was missed. Two **orphaned** ears from an earlier session (PIDs 27156, 21736, parents
  dead) are still polling and delivering to nobody; I neither armed nor killed them.
- **PowerShell** was used only for the read-only `Win32_Process` census (onboarding §2a bans `TaskList`). No
  protected Trading Forge surface, consistent with AR-1286A §8.

---

## END STATE

```
AR-1287 local-settings hook probe   = PASS  (P1–P6 all met)
AR-1278 §8 assumption               = TRUE for the settings-source question, runtime 2.1.233
residual, newly surfaced            = --dangerously-skip-permissions interaction UNTESTED (§6)
frozen G2                           = 8 READY / 0 SPENT
bootstrap executable marker         = GPT's call (issue now, or clear §6 with one more cheap launch)
```

*Filed by the unprivileged scratch actor AR-1286A §4 authorized. No control-plane surface was touched, no
frozen condition claimed or dispatched, and no privileged bootstrap was attempted.*
