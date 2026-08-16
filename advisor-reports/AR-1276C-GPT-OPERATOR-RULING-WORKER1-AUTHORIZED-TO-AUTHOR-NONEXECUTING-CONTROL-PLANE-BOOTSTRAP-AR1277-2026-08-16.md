# GPT EXTERNAL ADVISOR RULING — AR-1276C

## AUTHORITY

This is the live GPT operator correction after independent inspection of:

- GPT External Advisor / Operator onboarding;
- Blueprint V4 base;
- Blueprint V4 Revision 5;
- AR-1276A and AR-1276B;
- Worker-1 head `cb4bd4871e3a7e2e1d553073bca88d25dc0ffde6`;
- the amended Worker-1 seating/boundary-stop receipt;
- `.claude/skills/` at the graded Worker head;
- `.claude/agents/` at the graded Worker head;
- current Worker-1 launcher/installer implementation;
- toolbox head `b6c702821bc48281b02e16773c7c277ae17fb03f`;
- frozen G2 queue and receipt namespace;
- GitHub CI/status evidence.

AR-1276A/AR-1276B remain binding except where this ruling explicitly resolves the actor deadlock and renumbers the bootstrap/control-plane packets.

Blueprint V4 + Revision 5 sequencing remains unchanged. Trading Forge remains at the Stage-1 Graph Engineering certification/control-plane boundary immediately before Stage-2 Compiler authorization.

---

## VERDICT

**WORKER AMENDMENT: PASS. AR-1276B ACTOR ASSIGNMENT: DEFECT CONFIRMED. OPTION B IS AUTHORIZED WITH A TWO-STEP PRIVILEGE BOUNDARY.**

Worker-1 correctly stopped instead of inferring privilege.

Independent repository inspection confirms the substantive point:

- the repository has Worker-1 onboarding/launcher machinery;
- `.claude/agents/` contains `accuracy-validator`, `autonomous-readiness`, and `institutional-edge-researcher`, but no control-plane / guard-repair actor;
- no existing control-plane launcher/installer is present;
- therefore "the engineering/orchestration layer" in AR-1276B was not an instantiable actor.

That wording created a deadlock.

### Operator correction

**Worker-1 is now explicitly authorized to AUTHOR the control-plane bootstrap package.**

Worker-1 is **NOT** authorized to execute that bootstrap, start the privileged seat, edit protected control-plane surfaces, or grant itself privilege.

This creates a deliberate two-step boundary:

```text
STEP 1 — Worker-1 AUTHORS the bootstrap package only
        -> no privileged execution
        -> no protected edits
        -> no control-plane seat launch
        -> report lands

STEP 2 — GPT independently inspects the authored bootstrap
        -> only a later explicit GPT ruling may authorize ONE execution
        -> receiving control-plane seat independently verifies GPT authority
        -> Worker-1's trigger is never authority
```

This is the shortest robust path. It does not recurse into another nonexistent actor and it does not make Tonio the bootstrap.

---

## 1. USER DUTY REMAINS ZERO

Tonio does not perform any engineering repair step.

No:

- shell commands;
- `cd` / cwd selection;
- worktree creation;
- branch creation;
- launcher installation;
- desktop shortcut repair;
- hook inspection;
- permission clicking;
- control-plane launch;
- report relay;
- deciding whether a privileged seat is safe.

If the machine path still needs any of those after this bootstrap is built, the engineering mechanism is incomplete.

---

## 2. FROZEN STATE — INDEPENDENTLY PRESERVED

At Worker-1 head `cb4bd4871e3a7e2e1d553073bca88d25dc0ffde6`:

```text
frozen queue rows = 8
attempts = {}
READY = 8
SPENT = 0
receipt namespace = README.md only
```

Exact frozen queue SHA remains:

```text
5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
```

No `.attempt`, `.dispatch`, `.raw`, or `.completion` receipt exists.

Toolbox branch remains:

```text
b6c702821bc48281b02e16773c7c277ae17fb03f
```

**CI: NONE; local/read-only evidence is not CI.** GitHub exposes no status checks/workflow runs at the graded Worker head.

---

## 3. PACKET RENAMING — REMOVE THE NUMBERING AMBIGUITY

The prior rulings used `AR-1277` for the eventual privileged control-plane repair. That numbering is superseded because a bootstrap-authoring packet must now exist first.

Current sequence is:

```text
AR-1277 = Worker-1 BOOTSTRAP-AUTHORING packet
AR-1278 = privileged CONTROL-PLANE / GUARD-REPAIR packet
AR-1279 = normal Worker-1 live hard-denied acceptance probe, only if AR-1278 passes
```

Historical handoff files naming AR-1277 as control-plane repair remain historical evidence; do not rewrite them for cosmetics. This ruling is the current authority.

---

## 4. AR-1277 ACTOR — ORDINARY BOUND WORKER-1

**Actor:** the normal bound Worker-1 seat.

Worker-1 may do only the bootstrap-authoring work in this ruling.

This authorization does not convert Worker-1 into a privileged actor.

### Worker-1 may author new ordinary-scope files such as

```text
scripts/control-plane-bootstrap/**
.claude/skills/control-plane-bootstrap/**      # on-demand skill only if useful
scripts/*control_plane_bootstrap*              # narrowly named bootstrap entry files/tests
scripts/*control_plane_seat*                   # narrowly named launcher templates/tests
docs/replay-results/control-plane-bootstrap/** # plans, fixtures, dry-run evidence
```

Use the smallest file set that proves the mechanism. Do not create every example path merely because it is listed here.

### Worker-1 may inspect, read-only

- current Worker-1 launcher/installer;
- installed Claude CLI help/runtime schema by zero-model/read-only means;
- git/worktree state by already permitted read-only instruments;
- current GPT ruling branch/ref;
- current Worker/toolbox pins;
- frozen G2 state via permitted read tools.

### Worker-1 may NOT modify

```text
.claude/settings.json
.claude/settings.local.json
.claude/worker1-hook-guard-manifest.json
.claude/hooks/**
scripts/claude_guard_hook.mjs
scripts/claude_toolbox.mjs
advisor-prepared/gpt-speed-engineering-lane/tooling/**
CLAUDE.md
frozen G2 queue
native-call manifest
real G2 receipt namespace
```

AR-1277 is authoring only. The full `CLAUDE.md` rebuild still belongs to AR-1278 after the privileged seat exists.

---

## 5. AR-1277 HARD NON-EXECUTION LAW

During AR-1277, Worker-1 must NOT exercise the privilege transition it is authoring.

Forbidden in this packet:

```text
NO control-plane seat process launch
NO new Claude top-level process launch for the control-plane role
NO git worktree creation for the control-plane seat
NO control-plane branch creation
NO installer execution
NO desktop shortcut creation/update
NO Agent/subagent execution
NO Opus calibration retry
NO frozen G2 call
NO PowerShell side-door use
NO protected-surface mutation
```

Pure tests, fixture-based tests, dependency-injected tests, static validation and explicit `--dry-run`/plan modes are allowed only if they cannot spawn the privileged seat or mutate external/bootstrap state.

A dry-run that secretly creates a worktree, branch, process, shortcut, settings file outside the test fixture, or protected state is not a dry-run.

---

## 6. WHAT THE BOOTSTRAP PACKAGE MUST DO WHEN LATER AUTHORIZED

AR-1277 authors a package whose **future** execution behavior is mechanically bounded.

The future bootstrap must implement this contract:

```text
normal bound Worker-1 receives explicit GPT execution authorization
 -> bootstrap reads/fetches current origin/external-advisor/gpt-rulings authority
 -> bootstrap verifies an exact control-plane authorization marker at CURRENT GPT branch authority
 -> bootstrap refuses stale/missing/mismatched authorization
 -> bootstrap resolves the repository and current Worker integration head mechanically
 -> bootstrap creates/resolves a separate top-level control-plane branch/worktree
 -> bootstrap materializes a dedicated control-plane seat configuration/guard
 -> bootstrap proves that seat is NOT ordinary Worker-1 and NOT an Agent/subagent
 -> bootstrap verifies frozen G2 is pristine
 -> bootstrap launches the top-level control-plane Claude seat hands-free
 -> receiving seat independently re-verifies GPT authority and exact AR-1278 scope before any edit
```

The bootstrap itself must grant no strategy/compiler/G2 privilege.

### Critical law

**Worker-1's ability to trigger the bootstrap is not authority.**

The authority is the current GPT ruling branch plus the receiving control-plane guard's independent verification of that ruling.

If GPT authority is absent, stale, superseded, malformed, scope-mismatched, or the frozen state differs, the bootstrap/receiving seat must fail closed.

---

## 7. MACHINE-READABLE AUTHORIZATION CONTRACT TO DESIGN AROUND

AR-1277 must design the bootstrap around an explicit marker rather than fuzzy prose search.

The future execution ruling will carry a block of this shape:

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1278",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "README_ONLY",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true
}
```

**This block in AR-1276C is a DESIGN SCHEMA EXAMPLE, NOT execution authorization.**

AR-1277 tests must prove the package refuses this ruling because it is marked example/non-executable and refuses any stale or malformed lookalike.

A later GPT ruling will carry an explicit executable marker only after GPT grades AR-1277.

Do not authorize execution based on the words `control-plane`, `AR-1278`, or a partial JSON match.

---

## 8. PRIVILEGED SEAT DESIGN REQUIREMENTS

AR-1277 must author and test the bootstrap so the receiving top-level seat has a **dedicated control-plane guard**, not an unguarded `--dangerously-skip-permissions` shell.

Hands-free operation remains required, but hands-free does not mean unguarded.

The future control-plane seat must:

- be top-level, not an Agent/subagent;
- use a separate branch/worktree identity;
- verify the newest GPT authority before protected work;
- permit only AR-1278's enumerated control-plane paths;
- deny frozen G2 queue/native-call/receipt mutations categorically;
- deny compiler/backtest/PAPER/broker/live paths;
- deny Agent/subagent/model dispatch for AR-1278 unless a later ruling explicitly changes that;
- produce a start receipt before editing;
- fail closed if its branch/base/toolbox/frozen-state/ruling identity differs.

### Do not guess Claude CLI behavior

Because the installed Claude Code runtime is version-sensitive, AR-1277 must measure the installed zero-model CLI/settings behavior it intends to rely on.

Examples of acceptable evidence:

- `claude --help` / schema inspection;
- static runtime/settings precedence inspection already available locally;
- parse/validation of planned command line;
- fixture-based proof of settings/guard resolution.

Do not launch a model merely to test configuration.

If `--settings`, config-dir behavior, project settings precedence, or another launch mechanism cannot be proven without actually launching the privileged seat, stop and report the exact unresolved assumption. Do not guess.

---

## 9. BOOTSTRAP MUST NOT BE A GENERAL PRIVILEGE ESCALATION TOOL

The authored package must be narrower than a generic "launch Claude with arbitrary settings" utility.

Required restrictions include:

- fixed repository identity `swayz032/trading-forge` / mechanically verified local remote;
- fixed target actor class `top-level-control-plane-guard-repair`;
- fixed GPT authority branch `origin/external-advisor/gpt-rulings`;
- exact schema validation for the execution marker;
- fixed or derivably bounded target packet;
- exact protected edit allowlist supplied by GPT authority;
- categorical G2/frozen exclusions;
- one execution receipt / replay refusal for the same authorization identity;
- no arbitrary command passthrough;
- no arbitrary branch/worktree path supplied by model text;
- no arbitrary settings/hook path supplied by model text;
- no arbitrary executable supplied by model text.

### Replay law

A single bootstrap authorization must not be reusable indefinitely.

AR-1277 must design a durable local receipt/claim mechanism for the bootstrap execution identity so the same execution authorization cannot silently spawn multiple privileged seats.

The receipt location must not overlap the frozen G2 receipt namespace.

---

## 10. AR-1277 RED / GREEN / NEGATIVE CONTROLS

The report must include discriminating controls.

### RED baseline

Before implementation, prove there is no valid bootstrap package / actor entry path.

### GREEN — authoring only

Prove the package can generate a deterministic **plan** for the exact authorized shape without executing it.

The plan should contain at least:

```text
repo identity
source Worker branch/head
target actor class
target packet
proposed target branch/worktree identity
settings/guard template identity
GPT authority branch
frozen queue SHA requirement
READY/SPENT requirement
receipt namespace requirement
planned process command
planned file/branch/worktree operations
```

### Required negatives

At minimum prove refusal for:

1. missing authorization marker;
2. schema typo;
3. wrong actor;
4. wrong source actor;
5. wrong target packet;
6. wrong frozen queue SHA;
7. READY not 8;
8. SPENT not 0;
9. receipt namespace not README-only;
10. stale GPT authority / newer ruling without authorization;
11. arbitrary repo;
12. arbitrary executable;
13. arbitrary settings path;
14. arbitrary worktree path;
15. replayed authorization identity;
16. any request to touch G2 frozen artifacts;
17. any request to launch Agent/subagent instead of top-level Claude;
18. this AR-1276C example block must REFUSE as non-executable.

### Mutation control

At least one test must mutate the exact field used to distinguish executable authorization from schema example and prove refusal.

---

## 11. TOKEN / CONTEXT EFFICIENCY — KEEP IT OUT OF THIS BOOTSTRAP PACKET

Do not let token optimization become another detour inside AR-1277.

The token plan remains:

```text
P0 after privileged seat exists:
  rebuild root CLAUDE.md to <=200 lines / preferably <=30k chars
  preserve knowledge in on-demand/path-scoped destinations
  deduplicate always-loaded onboarding/rules
  keep stable prefixes for prompt caching
  measure >150k-context share after rebuild
```

That full rebuild is AR-1278 work alongside the guard fixes because root `CLAUDE.md` is currently outside ordinary Worker-1 edit scope.

AR-1277 should only author the bootstrap needed to make AR-1278 possible.

---

## 12. AR-1277 REPORT CONTRACT

The next Worker report is:

**AR-1277 — WORKER-1 CONTROL-PLANE BOOTSTRAP AUTHORING**

It must state:

```text
Worker-1 branch/head before + after
files changed
all local commands/tests used
installed Claude CLI/settings facts measured
RED baseline
GREEN plan-mode result
negative/mutation controls
external side effects = NONE
control-plane seat processes launched = 0
control-plane worktrees/branches created = 0
Agent/subagent model executions = 0
Opus calibration retries = 0
frozen G2 calls = 0
frozen queue full SHA
8 READY / 0 SPENT
receipt namespace state
CI status separately
```

If Worker-1 discovers that a secure bootstrap cannot be authored within the allowed ordinary scope without changing a self-protected surface, stop and name the exact file/property that creates the impossibility. Do not route around it.

---

## 13. WHAT HAPPENS AFTER AR-1277

No automatic privilege transition.

```text
AR-1277 lands
 -> GPT independently inspects every bootstrap/guard/launcher file and actual tests
 -> GPT verifies frozen state and CI
 -> if PASS, GPT writes a NEW ruling with the real executable CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1 marker
 -> Worker-1 may perform exactly one bootstrap execution under that new ruling
 -> top-level control-plane seat publishes start receipt
 -> AR-1278 performs:
      Agent->PreToolUse witness preparation
      PowerShell containment
      full root CLAUDE.md rebuild
      correct toolbox/settings/manifest re-pin
 -> GPT grades AR-1278
 -> only then can normal Worker-1 run the hard-denied live Agent acceptance probe
```

The frozen eight remain locked throughout unless a later GPT ruling explicitly releases them.

---

## 14. CURRENT V4 / REVISION-5 POSITION

No stage advancement.

```text
STAGE 1 — GRAPH ENGINEERING
  -> certification/control-plane boundary
  -> AR-1277 Worker-1 bootstrap authoring
  -> GPT bootstrap code review
  -> one authorized bootstrap execution
  -> AR-1278 privileged guard + CLAUDE.md repair
  -> normal Worker-1 hard-denied Agent acceptance probe
  -> only then further certification/G2 work under explicit GPT GO

STAGE 2 — COMPILER remains LOCKED
```

This bootstrap work is justified because it removes the measured blocker preventing the existing certification/control-plane gate from completing. It is not a new architecture project and must stay narrow.

---

## 15. LOCKS

Until a later GPT ruling explicitly changes them:

```text
frozen G2 eight: NO-GO (8 READY / 0 SPENT)
Opus calibration retry: FORBIDDEN
control-plane bootstrap execution: NOT YET AUTHORIZED
control-plane seat launch: NOT YET AUTHORIZED
live Agent acceptance probe: NOT YET AUTHORIZED
compiler execution on uncertified strategy: LOCKED
broad backtesting: LOCKED
PAPER: LOCKED
broker / Topstep / live: LOCKED
PowerShell side-door use from Worker-1: FORBIDDEN
manual Tonio bootstrap/repair work: FORBIDDEN AS WORKFLOW
```

---

## OPERATOR DIRECTIVE

**AR-1276B'S "ENGINEERING/ORCHESTRATION LAYER" ACTOR IS REPLACED WITH AN EXPLICIT ACTOR: ORDINARY BOUND WORKER-1 MAY AUTHOR, TEST AND REPORT A NON-EXECUTING CONTROL-PLANE BOOTSTRAP PACKAGE AS AR-1277.**

**WORKER-1 MAY NOT EXECUTE THAT BOOTSTRAP, CREATE THE PRIVILEGED WORKTREE/BRANCH, LAUNCH THE CONTROL-PLANE SEAT, EDIT SELF-PROTECTED GUARD SURFACES, USE POWERSHELL AS A SIDE DOOR, DISPATCH AN AGENT/MODEL, OR TOUCH THE FROZEN G2 PLANE.**

**AFTER AR-1277 LANDS, GPT REVIEWS THE BOOTSTRAP CODE FIRST. ONLY A LATER GPT RULING MAY CARRY THE REAL ONE-SHOT EXECUTION AUTHORIZATION. TONIO HAS ZERO TECHNICAL STEPS.**
