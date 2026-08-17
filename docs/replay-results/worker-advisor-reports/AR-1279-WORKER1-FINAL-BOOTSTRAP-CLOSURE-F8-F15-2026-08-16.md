# AR-1279 — WORKER-1 FINAL CONTROL-PLANE BOOTSTRAP CLOSURE (F-8 … F-15)

```
RULING : AR-1278A (63cad6bf) §12 — ordinary bound Worker-1, final bootstrap-closure packet.
PIN    : branch claude/worker1-h1-20260815
         head BEFORE bc9d388e5198a76b218a0818abcc4e9ce08c1beb
         head AFTER  the commit carrying this file
TESTS  : node --test scripts/control_plane_bootstrap.test.mjs -> 56 pass / 0 fail / 0 SKIPPED
STOP   : none. The AR-1278 §8 open assumption is now CLOSED BY LIVE MEASUREMENT (§3).
NEXT   : GPT reviews. Execution still requires a later ruling carrying an EXECUTABLE marker.
```

**Counts generated from `git status --porcelain`, not typed** (AR-1278A §11 — I got this wrong twice):

```
2 new + this report : claims/README.md · cp-finalize.mjs
6 modified          : bootstrap.mjs · bundle.mjs · control-plane-guard.mjs
                      control-plane-seat-hook.mjs · plan.mjs · control_plane_bootstrap.test.mjs
```

---

## 1. THE HEADLINE: F-11 WAS A REAL, EXPLOITABLE HOLE, AND IT IS NOW MEASURED

GPT's `--init-only` suggestion was better than my proposed throwaway probe, and it converted the
AR-1278 §8 open assumption into a measurement. Two live runs, **zero model conversations**, fixture
in the OS temp directory, removed afterwards:

```
C9   project .claude/settings.json = {"disableAllHooks": true}
     LOCAL .claude/settings.local.json = {"disableAllHooks": false, hooks:{SessionStart:[...]}}
     claude --init-only --setting-sources user,project,local
     -> HOOK FIRED                                              (3.4s, real run, not skipped)

C9b  identical fixture, LOCAL omits disableAllHooks
     -> HOOK DID NOT FIRE
```

So this is not a defensive nicety. **Without the explicit `disableAllHooks:false`, the privileged
seat could have silently disarmed its own guard by editing only the tracked `.claude/settings.json`
— a file its own packet must edit — while never touching the Local file at all.** The fix is proven
load-bearing by its own RED/GREEN pair, and the two runs also settle what static evidence could not:
Claude Code itself discovers and invokes a hook registered only in the Local source.

> `PRECEDENCE YOU RELY ON BUT DO NOT STATE IS A DEFAULT SOMEBODY ELSE CAN CHANGE.`

**Disclosed honestly:** Claude Code refuses to launch inside another Claude Code session and names
the bypass in its own error. The child process therefore runs with `CLAUDECODE` (and the two related
markers) scrubbed from its environment. It is a separate top-level process, in a temp cwd, running
hooks and exiting with no conversation — the mode §12.9 authorized. The fixture is created and
removed by the test through Node's `fs` under `os.tmpdir()`; nothing is written into the repository.

**And a process finding against myself:** the first version of that probe `return`ed early when the
CLI could not run and printed a **green tick while proving nothing** — the same false-green shape
already convicted twice in this campaign. It now reports `SKIP`, and the final run shows
`skipped 0`, which is how you can tell it actually executed.

---

## 2. F-8 — THE RECEIVING SEAT NOW VERIFIES GPT AUTHORITY ITSELF  **CLOSED**

`verifyAuthorityIndependently()` runs at the seat's SessionStart and goes to the source rather than
the manifest: binds the real origin, fetches `origin/external-advisor/gpt-rulings`, resolves the
newest ruling by the same strict rule the bootstrap uses, extracts and validates the marker,
**recomputes the bundle from real bytes**, then requires the manifest to agree with the live
authority on authorization id, ruling id, target packet, bundle and `allowed_paths` **set-for-set**,
and requires the durable claim to exist and describe the same authorization.

`measureObservedIdentity()` no longer takes those five fields from the manifest. Its `trusted` input
is the verified marker at SessionStart, or the armed receipt at PreToolUse — the receipt being
mintable only by a SessionStart that already passed verification. No network on the hot path.

Controls: **C8b** (five distinct authority failures each leave *no* receipt, with a passing control),
**C8c** (wrong origin, wrong authorization id, wrong ruling, wrong packet, wrong bundle, extra
`allowed_paths` entry, missing claim and mismatched claim each refuse with a distinct code, against
a control where everything agrees).

---

## 3. F-9 — REAL ORIGIN BOUND AT BOTH LAYERS  **CLOSED**

The bootstrap refuses before any effect unless the measured remote equals `swayz032/trading-forge`;
the seat repeats the check independently. Previously the marker's `repo` field was validated against
a constant but never against the actual remote — and then `manifest.repo = measured.repoRemote` was
written, so a copied repository became internally self-consistent while still claiming Trading Forge.

Controls: **C9c** (wrong origin refuses with zero effects requested) and the `wrong_origin` case in **C8c**.

---

## 4. F-10 — THE CLAIM IS NOW LITERALLY THE FIRST FILESYSTEM ACT  **CLOSED**

`docs/replay-results/control-plane-bootstrap/claims/` is committed with a README explaining why it
must pre-exist. `writeClaim()` no longer creates directories — it **throws** if the parent is absent
rather than creating it inside the critical section, so the one-shot region is exactly one `wx`
write: it either spends the authorization or changes nothing.

Controls: **C6** (no `mutating:true` step precedes the claim in the plan), **C6b** (on the authorized
path the first requested effect is `writeClaim`, and the full call order is asserted), **C7**
(crash-shaped replay refuses with zero effects).

---

## 5. F-12 — THE REGISTRATION IS NOW WHAT MAKES IT DEFAULT-DENY  **CLOSED**

This was the second registration-level false green, and the lesson is the same as the fence scanner:

> `A DECISION FUNCTION IS ONLY AS DEFAULT-DENY AS THE EVENTS THAT REACH IT.`

PreToolUse is registered with the documented all-tools matcher `*`, and the guard holds a **closed
allowlist**: `Read, Glob, Grep, Edit, Write, NotebookEdit, Bash`. Everything else denies —
`Agent`, `Task`, `PowerShell`, `AskUserQuestion`, `ExitPlanMode` by name (the last two so a scripted
privileged seat can never stop and ask the operator anything), every `mcp__*` tool, and every unknown
or future tool.

Controls: **C12** asserts the ALLOW set, the explicit DENY set, MCP, unknown, empty and `undefined`
tool names — **and asserts the materialized matcher is `*` and contains no `|`**, which is the part
the previous suite never checked. **C12b** runs a synthetic unknown tool end-to-end through `decide`.

---

## 6. F-13 / F-14 — HANDS-FREE LAUNCH AND A TERMINAL FINALIZE  **CLOSED**

**F-13.** The seat is started with `-p` and a prompt derived mechanically from the validated marker —
it names the ruling, the authorization, the exact authorized paths, the finalize command, and the
hard rules (no Agent/subagent, no PowerShell, no frozen-G2 contact, never ask the operator anything).
No caller, model or operator text can influence it. The launch is **synchronous**, so the bootstrap
waits for exit and then verifies the trusted completion receipt instead of spawning a terminal and
walking away. `-p` is a top-level process, not a subagent.

**F-14.** `cp-finalize.mjs` is the one terminal path and takes **no arguments at all**. It re-measures
branch and origin, re-checks every **staged** path against the GPT allowlist and aborts on the first
violation, commits via the git-dir scratch pattern, pushes the measured branch to `origin`, and writes
a completion receipt under the git directory. Raw `git push` and `git commit` are **not** in the Bash
allowlist. HEAD-checking is therefore never weakened: after finalization further calls may deny
because HEAD moved, which is fine because finalization is terminal.

> `SOLVE THE LAST STEP BY ENDING, NOT BY WEAKENING EVERY STEP BEFORE IT.`

Controls: **C6b** (argv contains `-p`, prompt names the packet, the finalize command and the
no-questions rule), **C13b** (prompt is derived from the marker), **C14b** (raw push/commit DENY),
**C3c** (`cp-finalize.mjs` with any argument DENIES), **C10c** (a completion receipt for a different
authorization does not verify), **C7c** (an unarmed doorway refuses to start a conversation).

---

## 7. F-15 — EXACT TEST COMMANDS  **CLOSED**

The wildcard `node --test scripts/*.test.mjs` is gone. A test file is executable code, and
`readOnly:true` described the Bash shape rather than what the JavaScript inside could do. Two exact
commands remain. Control **C15** proves the exact command passes and three near-miss paths deny.

---

## 8. MANDATORY RUNTIME STATEMENT

```
privileged control-plane model launches    : 0
control-plane seats started                : 0
control-plane worktrees created            : 0   (git worktree list 108 before, 108 after)
control-plane branches created             : 0   (git branch 199 before, 199 after)
claims written                             : 0   (claims/ contains README.md only)
Agent/subagent model executions            : 0
Opus calibration retries                   : 0
frozen G2 calls executed                   : 0
protected-surface mutations                : 0
PowerShell side-door use                   : 0
zero-model claude --init-only runs          : 2   (§12.9-authorized; scratch temp dirs, both removed)
external privileged side effects           : NONE
```

**Frozen G2, two independent instruments, two languages:**

```
scripts/g2d_real_queue_preflight.py : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
bootstrap.mjs measureState          : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
                                      ready 8 · spent 0 · receipts README-only
```

**Live `--plan`:**

```
authorized      false
code            no_marker  ("no ... block in AR-1278A")   <- correct; AR-1278A issues none
newest_ruling   AR-1278A                                   <- revision letter preserved
repo_remote     swayz032/trading-forge
bundle_sha256   4045dd93f401f598987251e3277d257c46cc57132aa53cf7860353b8508952fb
exit            3
```

The *found-and-refused* path stays proven separately by the preserved AR-1276C control (N18).

**CI: NONE.** GitHub exposes no status checks or workflow runs at this head. All evidence here is
local and labelled as such.

---

## 9. WHAT IS STILL NOT PROVEN

1. **Steps 6-10 have never run.** `git worktree add`, guard materialization, the supervised `-p`
   launch and completion-receipt verification are authored and unit-tested against fakes; the real
   sequence has never executed, by design.
2. **`--init-only` was proven in a scratch fixture, not on a real control-plane worktree.** The
   mechanism is demonstrated; that specific worktree's first boot is not.
3. **The seat's own behaviour under its guard is untested at runtime.** The guard's decisions are
   tested; a live seat obeying them is not.
4. **56 controls cover the enumerated attack list**, not the space of all attacks. Both defects I
   found in AR-1278 came from *running* things, not from reading them — which is the argument for an
   independent adversarial pass rather than more of my own tests.
5. **`agent_model_executions: 0`** remains a property of these processes, not an audit of history.

---

## 10. PINS FOR THE EXECUTABLE MARKER

```
bootstrap_bundle_sha256 = 4045dd93f401f598987251e3277d257c46cc57132aa53cf7860353b8508952fb
bootstrap_source_sha    = the head of the commit carrying this report
```

Re-readable at any time with `node scripts/control-plane-bootstrap/bootstrap.mjs` (read-only). The
bundle now covers eight files — the six modules plus `cp-commit.mjs` and `cp-finalize.mjs`, because
both are reachable from the Bash allowlist and their bytes decide what a privileged seat can publish.

---

## 11. DELIBERATELY NOT DONE

- Root `CLAUDE.md` rebuild, PowerShell containment and the Agent-probe witness — **AR-1280**, the one
  privileged packet. No toolbox branch was touched and no toolbox re-pin is proposed, per §9.
- Token optimization beyond that rebuild (§12 forbids expanding this packet into it).
- Any execution of the bootstrap; any broad full-repo test sweep.
