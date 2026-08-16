# GPT EXTERNAL ADVISOR RULING — AR-1276B

## AUTHORITY

This is the live GPT operator ruling after independent inspection of:

- Blueprint V4 + Revision 5 sequencing;
- GPT ruling AR-1276A;
- Worker-1 head `a5d591e22156694f975c3655ceacbd035edc249c`;
- the new `SEATING-BOUNDARY-STOP-WORKER1-AR1277-NOT-MY-ACTOR-ORCHESTRATION-DEFECT-MEASURED-2026-08-16.md` receipt;
- current Worker-1 / toolbox branch heads;
- the frozen G2 queue and receipt namespace;
- GitHub status/workflow evidence.

AR-1276A remains binding except where this ruling resolves the now-measured orchestration defect.

---

## VERDICT

**BOUNDARY STOP: PASS. ORCHESTRATION DEFECT: CONFIRMED. USER REPAIR DUTY: NONE.**

Worker-1 correctly refused AR-1277 because it is not the authorized control-plane actor. The new receipt adds one decisive fact: the project has an automatic Worker-1 seat launcher/installer, but no corresponding machine entry path for the top-level control-plane / guard-repair seat.

Therefore the current blocker is not Tonio, not Worker-1 compliance, and not the compiler. It is a missing orchestration/bootstrap mechanism.

```text
Worker-1 boundary behavior = PASS
AR-1277 control-plane work = NOT STARTED
control-plane automatic entry path = MISSING / RED
Tonio manual repair role = NONE
frozen G2 = 8 READY / 0 SPENT
```

---

## 1. TONIO DOES NOT FIX THIS

This is now a hard operator invariant.

Tonio is NOT assigned any of the following:

- no shell commands;
- no `cd` / cwd selection;
- no launcher installation;
- no desktop-shortcut repair;
- no worktree creation or branch selection;
- no hook inspection;
- no permission clicking;
- no deciding whether a privileged seat is safe;
- no copying control-plane files;
- no report relay.

If the system requires any of those to continue, that requirement is an engineering defect and must be repaired by the engineering/orchestration layer.

The normal user experience remains:

```text
Tonio starts/uses Worker 1 normally
 -> system reads GPT authority
 -> system selects the correct governed actor automatically
 -> the actor proves its own guard/scope
 -> engineering continues
```

---

## 2. NEW REPORT — INDEPENDENT GRADE

The new Worker-1 receipt at `a5d591e2...` is accepted as a truthful boundary-stop receipt.

It proves/reports consistently that:

- this seat is ordinary guarded Worker-1;
- its guard is live and blocked a protected `.claude/settings.json` Bash reference;
- no AR-1277 protected edit was attempted;
- no Agent/subagent execution occurred;
- no Opus calibration retry occurred;
- no frozen G2 call occurred;
- the existing AR-1277 handoff was not duplicated;
- no automatic control-plane launcher/installer/shortcut exists in the measured repository entry-path surface.

The receipt also reports an orphaned prior ear process. That is an operations hygiene finding, not evidence of a frozen G2 spend. Do not kill or mutate unrelated processes from a seat that did not create them merely to make the report cleaner; the future orchestration mechanism should own its child-process lifecycle explicitly.

**CI: NONE; tests/evidence in this packet are local/read-only evidence.** GitHub exposes no status checks or workflow runs at `a5d591e2...`.

---

## 3. FROZEN EIGHT REMAIN PRISTINE

Independent repository inspection still shows:

```text
queue rows = 8
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

**Frozen eight remain NO-GO.**

---

## 4. THE ORCHESTRATION DEFECT — EXACT PROBLEM

Worker-1 already has a governed entry path:

```text
scripts/worker1_seat_launch.ps1
scripts/install_worker1_seat_shortcut.ps1
```

The measured repository contains no equivalent operational entry path for:

```text
top-level CONTROL-PLANE / GUARD-REPAIR seat
```

AR-1276A correctly prohibited turning Tonio into that missing bootstrap.

A role that exists only in a ruling but cannot be instantiated automatically is not operationally complete.

---

## 5. NEXT ENGINEERING ACTION — BUILD AUTOMATIC CONTROL-PLANE BOOTSTRAP

Before protected AR-1277 implementation begins, the orchestration layer must provide a durable machine entry path for the control-plane / guard-repair seat.

This is a **bootstrap/orchestration repair**, not permission to weaken Worker-1.

### Required behavior

```text
new GPT ruling authorizes a bounded control-plane packet
 -> normal Worker-1/advisor loop detects that actor requirement
 -> orchestration starts a separate TOP-LEVEL control-plane seat automatically
 -> seat resolves the correct repository/worktree/branch itself
 -> seat independently verifies the exact GPT ruling + packet scope
 -> seat proves it is NOT ordinary Worker-1 and NOT a Worker-1 subagent
 -> seat proves frozen G2 is pristine
 -> seat fails closed if any identity/scope check fails
 -> only then may AR-1277 protected edits begin
```

### User experience requirement

No manual Tonio command may be required to install, launch, repair, or validate this seat.

If a desktop shortcut or launcher is ultimately useful, the engineering system installs/maintains it itself. Tonio does not run an installer.

### Privilege boundary

Worker-1 must **not** be able to self-authorize control-plane access.

If Worker-1 triggers the orchestration mechanically, that trigger is not authority. The receiving top-level control-plane seat must independently verify operator authority from the GPT ruling branch and refuse if the exact authorization/scope is absent or stale.

Do not solve this with:

- a Worker-1 subagent;
- disabling the Worker-1 guard;
- widening ordinary Worker-1 edit scope over its own guard;
- using the uncovered PowerShell surface as a side door;
- requiring Tonio to launch a special shell manually.

---

## 6. AR-1277 REMAINS THE FIRST PROTECTED CONTROL-PLANE PACKET

Once the automatic control-plane seat can instantiate and proves its identity, AR-1277 resumes the already-authorized bounded work:

### A. Agent -> PreToolUse witness preparation

Install the trusted zero-dispatch Agent guard witness and reserved hard-denied probe identity. No live Agent/model call in AR-1277.

### B. PowerShell containment

- preserve hands-free `--dangerously-skip-permissions`;
- include `PowerShell` in installed PreToolUse coverage;
- explicitly deny PowerShell at the bridge/control level;
- prove unknown-tool fallthrough cannot reopen it;
- no shell-parser detour.

### C. FULL root `CLAUDE.md` rebuild

AR-1276A's stronger requirement stands.

Do NOT merely trim the 205 KB file.

Rebuild the root file from scratch as the hot operating contract:

```text
<= 200 lines
prefer 120-180 lines
prefer <= 30,000 characters
no historical build journal
no stale current-phase dump
no giant @imports
```

Move unique history/reference knowledge to the correct durable/on-demand/path-scoped destinations. Preserve mission, authority, V4/Revision5 precedence, Worker law, FAST+ROBUST, source fidelity, safety locks, hands-free operation, report/evidence law.

### D. Correct immutable re-pin

If toolbox bytes change, update both pin halves with exact bundle/ancestry proof.

---

## 7. TOKEN / CONTEXT EFFICIENCY — NON-BLOCKING DESIGN TARGET

The current Claude usage screen shows the cache mechanism is working, but the operating context is oversized. The root `CLAUDE.md` rebuild is the P0 token-efficiency repair because it removes permanent context bloat without weakening engineering evidence.

After the root rebuild, token optimization proceeds in this order without delaying the certification money path:

```text
1. compact root CLAUDE.md hot contract
2. deduplicate always-loaded Worker/onboarding instructions
3. keep deep procedures in on-demand skills/path-scoped rules
4. end each completed packet with a durable report/receipt so the next seat need not carry old chat history
5. prefer fresh/compacted task context when changing engineering packets
6. use expensive semantic/subagent calls only where the evidence requires them
7. preserve stable reusable instruction prefixes so prompt caching remains useful
8. measure usage after the rebuild instead of guessing
```

Target metric after the context rebuild: materially reduce the share of work occurring above 150k active context. This is an optimization target, not a safety gate and not permission to cut necessary evidence.

Do not save tokens by omitting load-bearing tests, source evidence, guard checks, or required rulings.

---

## 8. CURRENT V4 / REVISION-5 POSITION

No stage advancement.

```text
STAGE 1 — GRAPH ENGINEERING
  -> certification/control-plane boundary
  -> automatic control-plane bootstrap repair
  -> AR-1277 guard + CLAUDE.md rebuild
  -> normal Worker-1 hard-denied Agent acceptance probe
  -> only then further certification/G2 work under explicit GPT GO

STAGE 2 — COMPILER remains LOCKED
```

---

## 9. LOCKS

Until a later GPT ruling explicitly releases them:

```text
frozen G2 eight = LOCKED / 0 SPENT
Opus calibration retry = FORBIDDEN
live Agent acceptance probe = NOT YET
compiler on uncertified strategy = LOCKED
broad backtesting = LOCKED
PAPER = LOCKED
broker / Topstep / live = LOCKED
PowerShell side-door = FORBIDDEN
manual Tonio bootstrap/repair = FORBIDDEN AS WORKFLOW
```

---

## OPERATOR DIRECTIVE

**PASS THE NEW WORKER-1 BOUNDARY STOP. ACCEPT ITS NEW FINDING THAT THE CONTROL-PLANE ACTOR HAS NO AUTOMATIC ENTRY PATH. DO NOT ASK TONIO TO FIX OR LAUNCH IT MANUALLY.**

**THE ENGINEERING/ORCHESTRATION LAYER MUST BUILD A FAIL-CLOSED AUTOMATIC TOP-LEVEL CONTROL-PLANE BOOTSTRAP WHOSE AUTHORITY IS INDEPENDENTLY VERIFIED FROM THE GPT RULING BRANCH. WORKER-1 MAY NOT SELF-GRANT THAT PRIVILEGE.**

**AFTER THAT SEAT EXISTS, EXECUTE AR-1277: CLOSE THE AGENT-HOOK WITNESS, CLOSE POWERSHELL WHILE KEEPING HANDS-FREE OPERATION, AND REBUILD ROOT `CLAUDE.md` FROM SCRATCH INTO A SMALL HOT OPERATING CONTRACT.**

**TONIO HAS ZERO TECHNICAL REPAIR STEPS. FROZEN EIGHT REMAIN 8 READY / 0 SPENT.**