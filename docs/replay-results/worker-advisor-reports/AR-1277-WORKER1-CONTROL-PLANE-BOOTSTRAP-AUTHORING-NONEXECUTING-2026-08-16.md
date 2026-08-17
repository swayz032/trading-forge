# AR-1277 — WORKER-1 CONTROL-PLANE BOOTSTRAP AUTHORING (NON-EXECUTING)

```
RULING : AR-1276C (5bfdcf35) §4 — ordinary bound Worker-1 may AUTHOR, TEST and REPORT a
         non-executing control-plane bootstrap package. §5 non-execution law observed in full.
PIN    : worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         branch   claude/worker1-h1-20260815
         head BEFORE cb4bd4871e3a7e2e1d553073bca88d25dc0ffde6
         head AFTER  the commit carrying this file (git log -1)
STOP   : none fired. One impossibility was found and is reported in §7 — it did NOT block the
         packet, because the repair is in ordinary scope.
NEXT   : GPT reviews the bootstrap code. Only a later ruling carrying an EXECUTABLE marker may run it.
```

---

## 1. FILES CHANGED — 6 new, 0 modified, 0 protected surfaces touched

```
scripts/control-plane-bootstrap/authorization.mjs           marker schema + strict validation (pure)
scripts/control-plane-bootstrap/control-plane-guard.mjs     the privileged seat's default-deny guard (pure)
scripts/control-plane-bootstrap/control-plane-seat-hook.mjs the seat's SessionStart/PreToolUse doorway
scripts/control-plane-bootstrap/plan.mjs                    deterministic plan builder (pure)
scripts/control-plane-bootstrap/bootstrap.mjs               CLI: --plan (default) | --execute (gated)
scripts/control_plane_bootstrap.test.mjs                    31 tests: 18 negatives + mutation + GREEN + live
docs/replay-results/control-plane-bootstrap/CONTRACT.md     the marker GPT must emit
```

Not touched: `.claude/settings.json`, `.claude/settings.local.json`,
`.claude/worker1-hook-guard-manifest.json`, `.claude/hooks/**`, `scripts/claude_guard_hook.mjs`,
`scripts/claude_toolbox.mjs`, `advisor-prepared/**/tooling/**`, `CLAUDE.md`, the frozen G2 queue,
the native-call manifest, the G2 receipt namespace.

---

## 2. RED BASELINE — measured before implementation

```
$ ls scripts/control-plane-bootstrap
ls: cannot access 'scripts/control-plane-bootstrap': No such file or directory
$ git ls-files | grep -ciE 'control.plane.bootstrap|control_plane_bootstrap|control_plane_seat'
0
```

Actor-surface census (the AR-1276B defect this packet answers): 19 canonical skills, 3 agent
definitions, **none** defining a control-plane / guard-repair seat; the only launcher/installer pair
in the repository is Worker-1's. Positive control: the same instruments return `worker-1`,
`worker-2`, `worker-onboarding`, so the absence is real rather than a bad path.

---

## 3. GREEN — plan mode against the REAL repository and the LIVE authority branch

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs         # --plan is the default
  "authorized": false,
  "code": "all_markers_refused",
  "detail": "missing_field: missing required field(s): authorization_class, authorization_id,
             ruling_id, repo, allowed_paths"
  "worker_branch": "claude/worker1-h1-20260815",
  "worker_head": "cb4bd4871e3a7e2e1d553073bca88d25dc0ffde6",
  "gpt_authority_head": "5bfdcf357295c37bfdd818097452587d96002969",
  "newest_ruling": "AR-1276C",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "ready": 8, "spent": 0, "receipts_readme_only": true,
  "agent_model_executions": 0, "claimed_authorization_ids": []
exit=3
```

**Read the refusal code carefully — it is the whole point.** It is `all_markers_refused /
missing_field`, NOT `no_marker`. The package **found** AR-1276C §7's example block on the live
authority branch and **refused** it for the exact structural reason the design intends. A `no_marker`
result would have been a false green (see §6).

The plan itself (emitted when a marker validates) carries every field AR-1276C §10 requires; a test
asserts each by name, asserts `executed:false`, and asserts the claim step precedes the launch step.

---

## 4. NEGATIVE + MUTATION CONTROLS — 31 tests, 31 pass

```
$ node --test scripts/control_plane_bootstrap.test.mjs
ℹ tests 31   ℹ pass 31   ℹ fail 0
```

All 18 required negatives (AR-1276C §10) refuse with distinct codes: missing marker · schema typo ·
wrong actor · wrong source actor · wrong target packet · wrong frozen SHA · READY≠8 · SPENT≠0 ·
receipts not README-only · stale authority *and* ruling-id mismatch · arbitrary repo · arbitrary
executable · arbitrary settings path · arbitrary worktree path · replayed authorization · frozen-G2
path in the allowlist · Agent/Task/PowerShell dispatch · the AR-1276C example block.

- **No-mutation control** runs first: the baseline marker validates, so every negative is exactly one
  field away from a pass and the suite can distinguish "catches breakage" from "always red".
- **Mutation control** targets the discriminator: `authorization_class` set to `EXAMPLE`, to
  lower-case `executable`, and deleted — all refuse; restored, the same marker passes.
- **N6 carries the AR-1276 §F trap**: the extraction SHA shares 17 leading characters with the queue
  SHA. The test asserts the shared prefix *and* the inequality, so a prefix comparison would fail it.
- **Effects recorder**: both end-to-end `--execute` tests assert `effects.calls` is `[]` — proving no
  side effect was even *requested* on a refusal path, not merely that none occurred.

---

## 5. INSTALLED CLAUDE CLI / SETTINGS FACTS — MEASURED (AR-1276C §8: do not guess)

```
$ claude --version   ->  2.1.233 (Claude Code)
$ claude --help      ->  --settings <file-or-json>   "load ADDITIONAL settings from"
                         --setting-sources <sources> (user, project, local)
                         --permission-mode <acceptEdits|auto|bypassPermissions|manual|dontAsk|plan>
                         --dangerously-skip-permissions
```

Two facts taken from repository evidence rather than assumption:

- **Binding is by launch directory** (AR-1271A §4, and this very session is the standing witness: my
  guard bound from this worktree). The bootstrap therefore launches with the new worktree as **cwd**
  and puts the guard in that worktree's own `.claude/settings.json`.
- **A PreToolUse `deny` outranks `bypassPermissions`** — read out of the shipped resolver and
  documented at `scripts/worker1_seat_launch.ps1:204-224`. That is why the seat can be hands-free
  (`--dangerously-skip-permissions` preserved, AR-1276C §8) **and** guarded.
- **Deny-envelope shape** copied from the pinned `claude-hook-runner.mjs` @ b6c70282:
  `hookSpecificOutput.permissionDecision='deny'`, and internal errors deny rather than fall through.

---

## 6. FINDINGS AGAINST MYSELF — both found by running, neither by review

**F-1 — the ruling-revision letter was dropped from the ruling identity.**
The first live `--plan` run printed `"newest_ruling": "AR-1276"` while reading
`AR-1276C-…md`. `AR-1276`, `AR-1276A`, `AR-1276B`, `AR-1276C` are four rulings and three are
superseded. Direction was fail-CLOSED (a valid `ruling_id:"AR-1280A"` marker would have been refused
for a mismatch that did not exist) — so it would not have leaked privilege; it would have silently
blocked the real execution ruling while looking like a correct refusal. Fixed in
`rulingIdFromFilename()`; regression test pins both the suffixed and un-suffixed forms.

**F-2 — the marker extractor could not see the marker (a real false green).**
The first extractor was `/```(?:json)?\s*\n([\s\S]*?)\n```/g`. Against the real AR-1276C — 17,979
chars, 32 fences, only 1 of them ```` ```json ```` — it extracted **zero** markers: a ```` ```text ````
fence cannot open a match, so the scanner resynchronised on that block's *closing* fence, paired it
with the next block's *opening* fence, and every pairing after was off by one.
**Why this mattered more than a parsing bug:** `no_marker` and "found it and refused it" are the same
observation from outside, so negative control #18 was passing against the live ruling while proving
nothing. It was caught only because a control was written that asserts the marker is **extracted**
before asserting it is refused. Replaced with a line-state fence scanner; the live control now
reports `all_markers_refused`, not `no_marker`.

> `A CONTROL THAT CANNOT SEE ITS TARGET REPORTS SUCCESS.`

**F-3 — process note.** Two Bash invocations were refused by the guard mid-packet (`node -e` text
containing `>`; then a mutation-shaped command). Both refusals were correct and were routed through
the inspected write path the guard named, not around it. The second one improved the result: the
throwaway probe became the permanent live control that caught F-2.

---

## 7. THE IMPOSSIBILITY AR-1276C §12 ASKED ME TO NAME (it did not block the packet)

**The control-plane seat cannot reuse the pinned Worker-1 toolbox guard.** Measured at `b6c70282`:

1. `advisor-prepared/gpt-speed-engineering-lane/tooling/lane-boundary-guard.mjs:175` —
   `classifyPath(worker, …)` **throws** unless worker is `worker-1` or `worker-2`. The actor class
   `top-level-control-plane-guard-repair` cannot be expressed at all.
2. `SELF_PROTECTED_RULES` (same file, line 30) denies `.claude/settings.json`,
   `hook-guard-manifest`, `.claude/hooks/` and the toolbox prefix, and `DENY_REGARDLESS_VERDICTS`
   makes that un-overridable by scope. **Those files are AR-1278's work surface.**

A control-plane seat wearing the Worker-1 guard would be denied the entire packet it exists to
perform. Repairing this by editing the toolbox is forbidden to me and was not attempted. The
available repair is in ordinary scope — a **new** guard for the new actor — so the packet proceeded.

⚠️ **The consequence, stated plainly: the privileged seat's guard is NEW CODE, not the
battle-tested one.** It is default-deny by construction and covered by the tests above, but it has
never run in a live seat. It is the part of this package most in need of GPT's line-by-line review.

---

## 8. UNRESOLVED ASSUMPTIONS — named rather than guessed (AR-1276C §8)

1. **Hook registration via `--settings` is NOT proven.** It cannot be tested without launching a
   privileged seat. The design therefore does **not** depend on it: the guard binds from the
   worktree's own `.claude/settings.json` with that worktree as cwd — the mechanism this repository
   already demonstrates. `--settings` is unused.
2. **`git worktree add` + first-boot behaviour of a fresh control-plane worktree is unexercised.**
   Steps 4-9 of the plan have never run; they are authored and reviewed, not proven.
3. **`agent_model_executions: 0` is a property of this process, not a scan of history.** The
   bootstrap dispatches no Agent/subagent, so it reports 0 by construction. It is not an audit of
   whether anything else ever did.
4. **The 18 negatives cover the enumerated list, not the space of all attacks.** An independent
   grader hunting a *novel* refusal bypass is the right next instrument; F-2 shows this suite's
   controls needed a control of their own.

---

## 9. MANDATORY RUNTIME STATEMENT (AR-1276C §12)

```
control-plane seat processes launched      : 0
control-plane worktrees created            : 0   (git worktree list 108 before, 108 after)
control-plane branches created             : 0   (git branch 199 before, 199 after; control-plane/* = 0)
installer executions / shortcuts created   : 0
Agent/subagent model executions            : 0
Opus calibration retries                   : 0
frozen G2 calls executed                   : 0
protected-surface mutations                : 0
PowerShell side-door use                   : 0
external side effects                      : NONE
claims written                             : 0   (docs/replay-results/control-plane-bootstrap/claims absent)
```

**Frozen G2 — verified by TWO independent instruments:**

```
scripts/g2d_real_queue_preflight.py (canonical, Python) : queue_artifact_sha256
  = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
    queue_count 8 · ready 8 · claimed/dispatched/completed/stranded all [] · receipts non-README []
    "ALL 8 ONE-SHOT ATTEMPTS UNSPENT."  exit 0

bootstrap.mjs measureState (this packet, Node)          : frozen_queue_sha256
  = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
    ready 8 · spent 0 · receipts_readme_only true
```

Two implementations, two languages, same digest. `8 READY / 0 SPENT`, receipt namespace README-only.

**CI: NONE.** GitHub exposes no status checks or workflow runs at this head. Everything above is
local evidence and is labelled as such.

---

## 10. WHAT THIS PACKET DELIBERATELY DID NOT DO

- The root `CLAUDE.md` rebuild (AR-1276C §6C / §11) — **AR-1278 work**; `CLAUDE.md` is outside
  ordinary Worker-1 edit scope and was not touched.
- The Agent→PreToolUse witness and PowerShell containment (§6A/§6B) — AR-1278.
- Any execution of the authored bootstrap.
- The orphaned ear process (pid 26992) — left alive per AR-1276B §2; not this seat's child.
