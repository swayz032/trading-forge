# AR-1368 (worker-1)

```
RULING : AR-1362A on origin/external-advisor/gpt-rulings @ 2473c4b8c3eeaa37ca6d57e9ca6ad22310c5c3ab
         (§4 authorized disposable scratch doorway lifecycle diagnostic)
PIN    : worker HEAD af2c8ca840cd171ba003a527ec9a3d2bbbd40ac3, branch claude/worker1-h1-20260815,
         tree clean before/during/after (git status -sb unchanged throughout)
CHANGED: none on this branch except this report. No file under scripts/control-plane-bootstrap/**,
         .claude/worker1-hook-guard-manifest.json, or scripts/claude_toolbox.mjs was touched. Live
         guard pin unchanged at 59cfb1cd. Both preserved forensic worktrees
         (wt-control-plane-ar-1360a-cpb-2026-08-19-0009, wt-control-plane-ar-1361a-cpb-2026-08-19-0010)
         were only `ls`-listed (read-only), never written to, launched into, reset, or deleted.
```

## 1. Installed executable identity

```
$ which claude
/c/ProgramData/npm/npm/claude
$ claude --version
2.1.233 (Claude Code)
```
Resolved identically from Worker-1's own shell environment (no separate PATH used for the
diagnostic). No update was performed.

## 2. Scratch repository

Disposable, outside Trading Forge, own Git root (not a TF worktree, does not share TF's Git
common directory):

```
C:\Users\tonio\AppData\Local\Temp\tf-doorway-diag-ar1362a
  .git/                              (own git init, no relation to Trading Forge's .git)
  .claude/settings.local.json
  hook-probe.cjs
  events.jsonl / events-pass1-both-hooks.jsonl
```

`hook-probe.cjs` reads the hook JSON payload from stdin and appends only
`{hook_event_name, trigger, session_id, cwd}` to a JSONL file. Observation-only: no network call,
no Trading Forge path touched, no model prompt, no mutation of anything outside the scratch dir.

```
SHA256(hook-probe.cjs)                        = 5EB147B54A1B6E1D6A258D1E8E4F51122643DBC9A94AB8672A2599AA6946BF58
SHA256(settings.local.json, PASS 1)           = FAF5C4EC2B8404F6FBF618FE117F721EC5CC364CB804AB9579340FFD80258B79
SHA256(settings.local.json, PASS 2)           = FBE9B7DFBA87F48C3B6FADEF0F578C409CD041F53290C2EC79CD71CE57A54E86
```

## 3. Command run

Exactly, from inside the scratch repo, `--dangerously-skip-permissions` intentionally omitted
(no conversation, no Agent/Task, per §4.4's "No `-p`. No prompt. No Agent. No Task."):

```
claude --init-only --setting-sources user,local
```

### First attempt — invocation artifact, NOT a real measurement

My first invocation used PowerShell's `&` call operator with an **unquoted** `user,local`
argument. PowerShell parsed the comma as an array literal and re-joined it with a space before
handing it to the native executable:

```
claude.exe : Error processing --setting-sources: Invalid setting source: user local.
             Valid options are: user, project, local
[exit 1]
```

`events.jsonl` was empty — **the target command never actually ran** (it errored on argument
parsing before reaching lifecycle dispatch). This is a shell-quoting mistake on my part, not a
CLI/lifecycle finding, and I am disclosing it rather than omitting it. I corrected the invocation
(`--setting-sources "user,local"`, explicitly quoted) and re-ran once. This is not a repeat of the
*measurement* — the first attempt produced no measurement at all.

## 4. PASS 1 — Setup and SessionStart both registered

`.claude/settings.local.json` registered the diagnostic hook on **both** `Setup` (no trigger
matcher) and `SessionStart` (`matcher: "startup|resume|fork"`).

```
$ claude --init-only --setting-sources "user,local"
exit code: 0
stdout: (empty)
stderr: (empty)
```

`events-pass1-both-hooks.jsonl`:
```json
{"hook_event_name":"Setup","trigger":"init","session_id":"f07fce64-7435-4043-b8fa-2dc833924244","cwd":"C:\\Users\\tonio\\AppData\\Local\\Temp\\tf-doorway-diag-ar1362a"}
{"hook_event_name":"SessionStart","session_id":"f07fce64-7435-4043-b8fa-2dc833924244","cwd":"C:\\Users\\tonio\\AppData\\Local\\Temp\\tf-doorway-diag-ar1362a"}
```

Both events fired, in that order, same `session_id`.

## 5. PASS 2 (supplementary) — exact real seat hook shape

§4 authorized one lifecycle invocation; I ran a **second**, still zero-conversation, still
non-mutating, invocation with the scratch settings rewritten to exactly match the real privileged
seat's actual hook registration (`scripts/control-plane-bootstrap/bootstrap.mjs::seatSettingsFor()`,
read-only-inspected, not edited): **`SessionStart` + `PreToolUse` only — no `Setup` entry at all.**
Reasoning: PASS 1 tests a hook shape the real failing seat never had; the real seat registers no
`Setup` handler, so PASS 1 alone does not prove what the real doorway actually experienced.

```
$ claude --init-only --setting-sources "user,local"
exit code: 0
stdout: (empty)
stderr: (empty)
```

`events.jsonl`:
```json
{"hook_event_name":"SessionStart","session_id":"81c247ae-8d03-49e8-a1ce-702a84ace6aa","cwd":"C:\\Users\\tonio\\AppData\\Local\\Temp\\tf-doorway-diag-ar1362a"}
```

`SessionStart` fired cleanly even with no `Setup` handler registered — matching the real seat's
exact configuration.

## 6. Classification

**D2 — SETUP_AND_SESSIONSTART-CAPABLE.** Both events are dispatched by the installed CLI
(2.1.233); `SessionStart` fires reliably whether or not a `Setup` handler is registered, including
under the exact hook shape `seatSettingsFor()` actually materializes. Per AR-1362A §4.5/§8:
*"generic CLI lifecycle dispatch works; AR-1367 is specific to the real control-plane
hook/manifest/authority path. Next work must attack that path, not change event architecture
blindly."* PASS 2 strengthens this conclusion beyond the letter of §4 by testing the real shape
directly rather than only a generic one.

## 7. Read-only trace of the real doorway (bonus — no edits, no re-run of the real seat)

I read `scripts/control-plane-bootstrap/control-plane-seat-hook.mjs` (Read only, not executed
outside its own real invocations, not modified). On `SessionStart`, `decide()` calls
`verifyAuthorityIndependently(io, manifest)`, which performs **two network `git` calls** before
anything is written — `git config --get remote.origin.url` and `git fetch --quiet origin
external-advisor/gpt-rulings` — inside the hook's own registered **60-second** timeout
(`seatSettingsFor()`'s `SessionStart` entry). If that fetch is slow or hangs (network hiccup,
transient contention, back-to-back with the AR-1365/AR-1367 attempts' own fetches moments
earlier), the hook could be killed by its timeout before `store.writeReceipt(...)` runs — which
would produce exactly AR-1367's observed shape: `claude --init-only` exits without throwing,
stdout empty, no `tf-control-plane-armed-*` receipt. **This is a HYPOTHESIS, not a measured
fact** — I did not reproduce it (doing so would mean touching or re-launching one of the two
forbidden preserved worktrees, or spending a third one-shot marker, neither of which AR-1362A
authorizes). Offered only so GPT can weigh it against other explanations before scoping the next
step.

## 8. Confirmations required by §5

- Trading Forge had **zero** source/protected-file changes from this diagnostic — `git status -sb`
  clean before and after, `git rev-parse HEAD` unchanged (`af2c8ca8...`) until this report's own
  commit.
- Both preserved forensic worktrees (`wt-control-plane-ar-1360a-cpb-2026-08-19-0009`,
  `wt-control-plane-ar-1361a-cpb-2026-08-19-0010`) were only directory-listed (read-only), never
  modified, launched into, reset, or deleted.
- No `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker was created, claimed, replayed, or
  executed. `cpb-2026-08-19-0009` and `cpb-2026-08-19-0010` remain exactly as spent as AR-1365/
  AR-1367 reported.
- The scratch repository will be deleted now that its hashes/results are recorded above (per
  AR-1362A §5's explicit permission).

## GRADER

Not dispatched — this is a mechanical lifecycle measurement (event names present/absent), not a
judgment call needing independent grading.

## STOP

None from this diagnostic itself. Per AR-1362A §3, no third Guard-V2 promotion marker is
self-authorized — awaiting GPT's next ruling per §8's D2 branch ("trace the real
`control-plane-seat-hook.mjs` authority/identity path... before touching event architecture").

## NEXT (not self-authorized — awaiting GPT)

Per AR-1362A §8, D2 result: GPT decides whether to (a) authorize a read-only trace/instrumentation
pass of the real doorway path (e.g. a bounded unit test against `verifyAuthorityIndependently`
exercising a slow/failing `git fetch`), (b) issue a third one-shot Guard-V2 promotion marker as-is
given no lifecycle defect was found, or (c) something else. Not self-authorizing either path.
