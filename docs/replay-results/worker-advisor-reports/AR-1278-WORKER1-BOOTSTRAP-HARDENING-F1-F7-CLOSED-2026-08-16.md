# AR-1278 — WORKER-1 CONTROL-PLANE BOOTSTRAP HARDENING (F-1 … F-7 CLOSED)

```
RULING : AR-1277A (9bf12d20) §9-§10 — ordinary bound Worker-1, narrow correction packet only.
PIN    : worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         branch   claude/worker1-h1-20260815
         head BEFORE 09d10dcb9efd6a396cb1edd2ba81b0919cd8a5c6
         head AFTER  the commit carrying this file
TESTS  : node --test scripts/control_plane_bootstrap.test.mjs  ->  44 pass / 0 fail
STOP   : none fired. One assumption remains OPEN and gates execution — §8.
NEXT   : GPT reviews the corrected bootstrap. Execution still requires a later EXECUTABLE marker.
```

**Correction to AR-1277 first, per AR-1277A §1:** that report's header said `6 new` files while listing
seven. The count was wrong; the list was right. This report's counts are stated against the actual
diff below.

---

## 1. FILES — 2 new, 6 modified, 0 protected surfaces touched

```
NEW       scripts/control-plane-bootstrap/bundle.mjs        deterministic source/bundle identity (F-5)
NEW       scripts/control-plane-bootstrap/cp-commit.mjs     the seat's ONLY commit path (F-2)
MODIFIED  scripts/control-plane-bootstrap/authorization.mjs source+bundle pins; immutable-surface tokens
MODIFIED  scripts/control-plane-bootstrap/bootstrap.mjs     claim-first ordering; bundle measurement; local-source guard
MODIFIED  scripts/control-plane-bootstrap/control-plane-guard.mjs   Bash default-deny; full identity vector
MODIFIED  scripts/control-plane-bootstrap/control-plane-seat-hook.mjs  real measurement; durable receipt
MODIFIED  scripts/control-plane-bootstrap/plan.mjs          local-source registration; mutating-step ordering
MODIFIED  scripts/control_plane_bootstrap.test.mjs          44 controls
MODIFIED  docs/replay-results/control-plane-bootstrap/CONTRACT.md
```

Untouched: `.claude/settings.json`, `.claude/settings.local.json`,
`.claude/worker1-hook-guard-manifest.json`, `.claude/hooks/**`, `scripts/claude_guard_hook.mjs`,
`scripts/claude_toolbox.mjs`, `advisor-prepared/**/tooling/**`, root `CLAUDE.md`, the frozen G2
queue, the native-call manifest, the G2 receipt namespace, compiler/backtest/PAPER/broker surfaces.

---

## 2. F-1 — LIVE IDENTITY SELF-CERTIFICATION  **CLOSED**

The defect was mine and it was worse than GPT's description. `main()` built `observed` from the
manifest it then validated, **and** honoured `manifest._observed_override`, so a manifest could
dictate its own observed values outright.

Repair: `measureObservedIdentity(io, …)` derives repo from `git config --get remote.origin.url`,
worktree from `realpath(rev-parse --show-toplevel)`, branch and HEAD from `git rev-parse`, and the
frozen digest/ready/spent/receipt state from the queue file. `_observed_override` is deleted. The
manifest now supplies **only** the expected side.

> `A CHECK WHOSE INPUT AND EXPECTATION COME FROM ONE FILE IS A SPELL-CHECKER FOR THAT FILE.`

Controls: **C2** (a manifest that lies about repo/branch/worktree/head cannot move the measured
values) and **C1** (a lying manifest produces `identity_mismatch_branch`, not a pass).

---

## 3. F-2 — BASH ALLOWLIST BYPASS  **CLOSED**

Confirmed as described: `classifyControlPlaneTool('Bash')` returned ALLOW, the Bash arm scanned for
three frozen-G2 tokens and otherwise returned `null` (permit). Bash could write anything `Edit`
would have been denied — while the report called the design default-deny. That overclaim was mine.

Repair: `classifyControlPlaneBash()` is default-DENY with a closed set of exact shapes —
`git status --porcelain`, `git rev-parse HEAD`, `git rev-parse --abbrev-ref HEAD`,
`git log --oneline -N`, `git diff [--cached] --stat`, `node --test scripts/*.test.mjs`,
`git add <path>`, the fixed commit helper, and `git push origin <the seat's own branch>`.
Shell composition (`; & | < > \` $( ${` and newlines) and arbitrary passthrough
(`node -e`, `python -c`, `sh -c`, `bash -c`, `npx`) refuse **before** matching. `git add`'s captured
path re-enters the same classifier the Edit/Write arm uses, so staging cannot outflank the allowlist,
and `git push` is pinned to the seat's measured branch.

`cp-commit.mjs` exists because that policy makes a compliant commit otherwise impossible (the
co-author trailer contains `<…>`). It **stages nothing** and accepts **no path** — the message file
is a fixed literal matched by the single allowed shape.

> `A HELPER THAT ACCEPTS A PATH REINTRODUCES THE BOUNDARY IT WAS BUILT TO RESPECT.`

Controls: **C3** (five non-G2 mutations DENY, including `git add README.md`), **C3b** (composition and
passthrough DENY), **C3c** the discriminating control — the permitted shapes still work, `git add`
respects the allowlist, and a push to `main` DENIES.

---

## 4. F-3 — GUARD SELF-DISARM  **CLOSED (with one open assumption, §8)**

Repair: the seat's hooks are materialized into `.claude/settings.local.json` and its manifest into
`.claude/control-plane-guard-manifest.json`; both, plus the claim namespace, are in
`CATEGORICAL_FORBIDDEN_PATH_TOKENS` — so no allowlist and no ruling can authorize writing them, and
`git add` on them DENIES too. The **tracked** `.claude/settings.json` stays repairable, which is the
packet's actual job. Launch passes `--setting-sources user,project,local` so loading is stated rather
than inherited from a default.

Controls: **C4** (all three immutable surfaces DENY categorically, a ruling that tries to authorize
one is refused, and the Bash route is closed) and **C5**, the discriminating half — `.claude/settings.json`,
the worker manifest and `CLAUDE.md` are still ALLOW.

---

## 5. F-4 — CLAIM ORDERING  **CLOSED**

Order is now: verify authority → verify frozen → verify source SHA + bundle → verify no replay →
**O_EXCL claim (first mutation)** → branch+worktree → materialize guard → prove doorway → launch.
Each planned operation carries an explicit `mutating` flag so the ordering is checkable rather than
narrated.

A failure after the claim leaves the authorization **SPENT** and needing a new GPT decision.
Deliberate: `A ONE-SHOT THAT SURVIVES A CRASH IS NOT A ONE-SHOT.`

Controls: **C6** (no `mutating:true` step precedes the claim), **C6b** (on the authorized path the
first requested effect is `writeClaim`, and the full call order is asserted), **C7** (crash-shaped
replay: a previously-claimed id refuses with zero effects), **C7b** (a doorway that does not report
ARMED refuses to launch).

---

## 6. F-5 / F-6 — SOURCE+BUNDLE PINNING AND THE FULL IDENTITY VECTOR  **CLOSED**

`bootstrap_source_sha` (40-hex, must equal measured Worker HEAD) and `bootstrap_bundle_sha256`
(64-hex, must equal a recomputed digest) are now required schema fields. The bundle hashes
`(path, byte-length, bytes)` over a **sorted** file list covering `authorization.mjs`,
`bootstrap.mjs`, `bundle.mjs`, `control-plane-guard.mjs`, `control-plane-seat-hook.mjs`, `plan.mjs`
and `cp-commit.mjs`. SHA alone is insufficient (a dirty tree at the right HEAD runs different bytes);
bundle alone is insufficient (no ancestry). Both, or neither.

`verifySeatIdentity` now binds ten fields — repo, worktree, branch, head, actor, targetPacket,
authorizationId, rulingId, queueSha256, bundleSha256 — plus frozen ready/spent/receipt state and the
subagent flag, and refuses if the **authorization fails to pin** a field (`expected_missing_*`),
rather than silently comparing `undefined` to `undefined`.

Controls: **C8** (wrong source SHA, malformed SHA), **C9** (one byte in **each** covered file
individually → `bootstrap_bundle_mismatch`; seven separate assertions), **C9b** (order-independence
and length-sensitivity), **C11** the identity mutation matrix — every one of the ten fields DENIES
when it differs, plus frozen drift and subagent, **with an unmutated control that is permitted.**

---

## 7. F-7 — DURABLE START RECEIPT  **CLOSED**

`SessionStart` verifies identity, then writes `tf-control-plane-armed-<session>.json` into the
worktree's **git directory** — outside the working tree, so absolute-path Edit/Write is refused as
escaping and no allowed Bash shape can reach it. Every `PreToolUse` requires that receipt, binds it
to `session_id`, and re-checks repo/worktree/branch/head/queue-digest against **freshly measured**
values, so a receipt that was valid at arming stops being valid once the seat moves.

Controls: **C10** (no receipt → deny; SessionStart arms → same call permitted; another session's
receipt cannot be borrowed), **C10b** (stale receipt → `receipt_drift_head`), and a refused
SessionStart leaves **no** receipt behind.

---

## 8. 🛑 THE ONE ASSUMPTION THAT REMAINS OPEN — AND IT GATES EXECUTION

**Claim under test:** hooks registered in `.claude/settings.local.json` are loaded for a fresh
top-level seat, and stay in force when `.claude/settings.json` is edited during that session.

**What I measured (zero model launches):**

```
claude --version                       2.1.233 (Claude Code)
claude --help                          --setting-sources <sources>  (user, project, local)
strings in the shipped claude.exe      "settings.local.json"  x83
                                       localSettings x311 · projectSettings x234 · userSettings x393
repo's own pinned guard                SELF_PROTECTED_RULES lists .claude/settings.local.json
                                       with reason 'live hook registration'
```

So `local` is a documented, first-class, separately-tracked settings source, and this repository's
own guard already treats it as a hook-registration surface.

**What that does NOT prove:** that a hook present *only* in the local source fires for a new
top-level session, and that it survives an edit to the project settings file mid-session. Proving it
requires starting a session, which is a model launch, which AR-1276C §8 forbids for configuration
testing — so I did not do it, and I am not asserting it.

**Why the failure mode is quiet:** if the assumption is false, the seat's guard never arms at all,
and an unarmed guard and a permissive one look identical from inside.

**Cheapest way to settle it, if GPT wants it settled before authorizing execution:** one throwaway,
**unprivileged** session in a scratch directory whose only hook lives in a local settings file, with
a hook that writes a file and exits. It spends no frozen budget, touches no control plane, and needs
no privileged seat — but it is a model launch, so it needs an explicit authorization I do not have.

**Mitigation already in place if it is never settled:** step 8 of the execution plan runs the seat's
doorway directly with a synthetic `SessionStart` and **refuses to launch unless it reports ARMED**.
That proves the doorway *works*; it does not prove Claude Code will *invoke* it from the local
source. Those are different claims and I am not merging them.

**Other assumptions still open:** `git worktree add` and first-boot of a fresh control-plane worktree
remain unexercised (steps 6-9 have never run); `agent_model_executions: 0` is a property of this
process, not an audit of history; and the 44 controls cover the enumerated attack list, not the space
of all attacks.

---

## 9. MANDATORY RUNTIME STATEMENT

```
control-plane seat processes launched      : 0
control-plane worktrees created            : 0   (git worktree list 108 before, 108 after)
control-plane branches created             : 0   (git branch 199 before, 199 after)
claims written                             : 0   (claims directory does not exist)
installer executions / shortcuts created   : 0
Agent/subagent model executions            : 0
Opus calibration retries                   : 0
frozen G2 calls executed                   : 0
protected-surface mutations                : 0
PowerShell side-door use                   : 0
external privileged side effects           : NONE
```

**Frozen G2, verified by two independent instruments in two languages:**

```
scripts/g2d_real_queue_preflight.py : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
                                      queue_count 8 · ready 8 · receipts non-README []
bootstrap.mjs measureState          : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
                                      ready 8 · spent 0 · receipts_readme_only true
```

**Live `--plan` against the real authority branch:**

```
authorized      false
code            no_marker  ("no CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1 block in AR-1277A")
newest_ruling   AR-1277A            <- revision letter preserved
repo_remote     swayz032/trading-forge
bundle_sha256   8968001cb74dbae92a3e7818893077fe28b2969e2cf92a43c87d0c64855e398b
setting_sources user,project,local
exit            3
```

`no_marker` is correct here — AR-1277A states it issues none. The *found-and-refused* path is proven
separately by the preserved AR-1276C extraction control (N18).

**CI: NONE.** GitHub exposes no status checks or workflow runs at this head. All evidence above is
local, and is labelled as such.

---

## 10. PINS FOR THE FUTURE EXECUTABLE MARKER

```
bootstrap_bundle_sha256 = 8968001cb74dbae92a3e7818893077fe28b2969e2cf92a43c87d0c64855e398b
bootstrap_source_sha    = the head of the commit carrying this report
```

Both are re-readable at any time with `node scripts/control-plane-bootstrap/bootstrap.mjs` (read-only,
default `--plan`). If any covered file changes after review, the digest changes and the authorization
refuses — which is the point.

---

## 11. WHAT THIS PACKET DELIBERATELY DID NOT DO

- Root `CLAUDE.md` rebuild — AR-1279, and outside ordinary Worker-1 edit scope.
- Agent→PreToolUse witness repair and PowerShell containment on the Worker side — AR-1279.
- Token/context optimization — AR-1277A §12 explicitly forbids expanding this packet into it.
- Any execution of the bootstrap, or any broad full-repo test sweep (§10: focused suite once).
