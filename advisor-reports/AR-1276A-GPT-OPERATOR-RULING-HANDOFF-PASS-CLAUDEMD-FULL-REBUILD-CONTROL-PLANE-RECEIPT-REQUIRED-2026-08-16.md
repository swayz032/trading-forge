# GPT EXTERNAL ADVISOR RULING — AR-1276A

## AUTHORITY

This is a live GPT operator clarification after independent inspection of the post-AR-1276 Worker-1 landing at commit `e84295ae8115f122bb6b427f42973409b5134b5a`, the Worker-1 branch, the toolbox/guard refs, the frozen G2 queue/receipt surfaces, GitHub CI/status, Blueprint V4 + Revision 5, and the current Claude Code instruction-loading contract.

AR-1276 remains the governing engineering packet except where this ruling explicitly tightens routing and replaces the `CLAUDE.md` cleanup requirement.

---

## VERDICT

**POST-AR-1276 HANDOFF: PASS AS A ROUTING ARTIFACT; AR-1277 EXECUTION HAS NOT LANDED.**

Worker-1 correctly obeyed AR-1276: it did not bypass self-protection and created a non-AR handoff for the permitted control-plane / guard-repair actor.

However, a handoff file is not execution evidence. GitHub currently proves only:

- Worker-1 advanced to `e84295ae8115f122bb6b427f42973409b5134b5a` with the handoff + report-contract clarification;
- toolbox branch remains at `b6c702821bc48281b02e16773c7c277ae17fb03f`;
- `guardfix/ar1271a-lifecycle` remains at the same `b6c70282...` lifecycle pin;
- no repository evidence yet proves an AR-1277 control-plane seat has started, changed guard law, rebuilt `CLAUDE.md`, or produced AR-1277.

Therefore:

```text
ROUTING ARTIFACT = PASS
CONTROL-PLANE RECEIPT = OPEN
AR-1277 IMPLEMENTATION = NOT STARTED / NOT PROVEN IN GITHUB
FROZEN EIGHT = LOCKED
```

Do not convert "handoff exists" into "control-plane work started."

---

## 1. FROZEN STATE — INDEPENDENTLY PRESERVED

At Worker-1 head `e84295ae...`:

```text
queue rows = 8
attempts = {}
READY = 8
SPENT = 0
receipt directory = README.md only
```

No G2 `.attempt`, `.dispatch`, `.raw`, or `.completion` artifact exists.

The exact frozen queue SHA remains:

```text
5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
```

Do not confuse it with any source/extraction hash appearing inside the queue JSON.

**CI: NONE; tests are local-only evidence.** GitHub exposes no status checks or workflow runs at `e84295ae...`.

---

## 2. HANDOFF CONTRACT — PASS, BUT DO NOT LOOP

The handoff file:

```text
docs/replay-results/worker-advisor-reports/HANDOFF-AR-1277-CONTROL-PLANE-GUARD-REPAIR-SEAT.md
```

correctly:

- names the permitted top-level actor;
- carries the current pins and frozen state;
- carries AR-1276 scope and prohibitions;
- warns about the wrong-hash control;
- records the PowerShell gap;
- remains outside the numeric Worker-report discovery contract.

That is enough routing documentation.

### HARD RULE

**DO NOT WRITE ANOTHER HANDOFF IN PLACE OF AR-1277.**

The next substantive artifact must be one of:

1. an actual **AR-1277 control-plane report** from the permitted top-level repair seat; or
2. if the engineering harness truly cannot instantiate that top-level seat automatically, one explicit **ORCHESTRATION BLOCK** that identifies the missing machine mechanism and fixes that mechanism without assigning shell/cwd/install/permission work to Tonio.

A second "handoff to the handoff" is a loop and is rejected.

Tonio is not the actor for control-plane repair.

---

## 3. `CLAUDE.md` REQUIREMENT IS REPLACED — FULL REBUILD, NOT TRIMMING

AR-1276 said to reduce the existing root `CLAUDE.md`. This ruling supersedes that wording.

**The root `CLAUDE.md` must be rebuilt as a new hot operating contract. Do not edit 205 KB of historical prose down until it merely falls under a warning threshold.**

Current measured file:

```text
~205,646 bytes
1,096 lines
runtime warning: ~203.5k chars > 150k warning threshold
```

That is the wrong shape for an always-loaded authority file.

Current Claude Code guidance says the project `CLAUDE.md` should hold concise instructions that must be present every session; multi-step procedures or subsystem-specific guidance belongs in skills or path-scoped `.claude/rules/`. It recommends targeting under ~200 lines. Imports are organizational only: imported files still load into startup context, so moving 180 KB behind `@imports` is NOT a fix.

### NEW ACCEPTANCE TARGET

Rebuild root `CLAUDE.md` to:

```text
<= 200 lines HARD TARGET
prefer ~120-180 lines
prefer <= 30,000 characters
no historical build journal
no stale static "current phase" narrative
no giant @imports of history/reference material
```

If a truly load-bearing rule cannot fit, prove why before exceeding the target.

---

## 4. NEW ROOT `CLAUDE.md` — REQUIRED CONTENT

The rebuilt root file should be a small index + operating law, approximately this shape:

### A. Mission

- Trading Forge mission in 3-6 bullets.
- Source-faithful compiler objective.
- Never fake profitability or semantic certainty.

### B. Authority / state recovery

Dynamic authority pointer only:

```text
GPT onboarding
 -> Blueprint V4
 -> Blueprint V4 Revision 5
 -> newest GPT ruling
 -> actual repository evidence
```

Do NOT hard-code a long-lived "current Wave/Phase" paragraph that goes stale.

### C. Worker / branch law

- active work must follow newest ruling;
- branch/worktree discipline;
- Worker-1 cannot self-edit its guard/control plane;
- GPT rulings are live operator messages;
- Worker reports land in the canonical Worker-report directory.

### D. FAST + ROBUST engineering law

- measured blocker first;
- smallest production-path repair;
- focused tests -> neighbor regression -> sharp negative/mutation -> checkpoint;
- no giant cleanup ahead of money path;
- local tests are not CI.

### E. Source-fidelity law

- source-owned semantics first;
- refuse ambiguity instead of substitution;
- taught stop/target preserved in SOURCE_FAITHFUL mode;
- visual evidence when text cannot settle a load-bearing geometry claim.

### F. Safety / money-path locks

- certification;
- compiler authorization on uncertified strategy;
- broad backtesting;
- PAPER;
- broker/Topstep/live;
- frozen G2 one-shot law;
- calendar targets never override gates.

### G. Hands-free worker operation

- preserve `--dangerously-skip-permissions` as intentional UX;
- hooks/guard enforce boundaries;
- Tonio does not click routine approvals or run bootstrap commands;
- a guard refusal is an engineering signal, never an invitation to route around it.

### H. Evidence/report rules

- repository evidence outranks report prose;
- exact pins/hashes/receipts;
- report path conventions;
- no "CI GREEN" without GitHub CI.

### I. Pointers, not payloads

Point to the authoritative skills/docs/rules by path. Do not paste their full historical content into root context.

---

## 5. WHERE THE OLD `CLAUDE.md` KNOWLEDGE GOES

**MOVE, DO NOT DELETE.**

AR-1277 must first inventory the old file into categories and produce a source-section -> destination map.

Preferred destinations:

```text
historical Wave/pass journals
 -> AGENT-LOGS.md or a dedicated docs/history/ archive

multi-step Worker procedures
 -> existing canonical skills under .claude/skills/

compiler/extraction subsystem rules
 -> path-scoped .claude/rules/*.md with explicit `paths:` frontmatter where appropriate

server/runtime-specific rules
 -> path-scoped .claude/rules/*.md

deep architecture/reference
 -> docs/designs/ / system maps / existing canonical docs

current dynamic state
 -> newest GPT ruling + repository evidence, NOT root CLAUDE.md
```

### Important context-budget law

Do not replace one giant root file with many unscoped rules that all load at startup.

- `.claude/rules/` files without path scoping load every session.
- `@imports` also enter startup context.
- task-specific, multi-step procedures should be skills/on-demand material.

The rebuild is successful only if startup context becomes materially smaller and clearer.

---

## 6. `CLAUDE.md` REBUILD EVIDENCE REQUIRED IN AR-1277

AR-1277 must report:

```text
BEFORE:
  bytes
  characters
  lines

AFTER:
  bytes
  characters
  lines

MOVE MAP:
  every old top-level section -> destination / retained-root / intentionally deduplicated-with-proof

HOT-RULE CHECK:
  mission
  authority precedence
  V4/Revision5 pointer
  ruling/report law
  branch/worktree law
  FAST+ROBUST
  source fidelity
  safety locks
  hands-free operation
  evidence/CI honesty

CONTEXT CHECK:
  no giant @imports
  no unscoped rule dump replacing the old root bloat
  no stale static current-phase narrative
  runtime starts without the CLAUDE.md oversize warning
```

No unique project knowledge may disappear merely to hit the line target.

---

## 7. AR-1277 CONTROL-PLANE SCOPE — STILL REQUIRED

The full rebuild does not replace the two mechanical blockers.

AR-1277 still owes:

### A. Agent -> installed PreToolUse durable witness preparation

- trusted session-bound witness;
- reserved non-G2 hard-denied Agent probe identity;
- proof it cannot collide with any frozen native call;
- no live Agent/model dispatch in AR-1277.

### B. PowerShell containment

- **KEEP `--dangerously-skip-permissions`;**
- cover the runtime `PowerShell` tool in the installed matcher;
- explicit bridge-level fail-closed denial for `PowerShell`;
- prove unknown-tool fallthrough cannot reopen it;
- no generic shell parser detour.

### C. Full `CLAUDE.md` rebuild

- use §§3-6 of this ruling, not AR-1276's weaker "slim" wording.

### D. Correct immutable re-pin

If toolbox bytes change, re-pin both halves with exact bundle identity and ancestry proof.

---

## 8. CONTROL-PLANE SEAT RECEIPT REQUIRED BEFORE CLAIMING STARTED

The permitted AR-1277 actor must publish a start receipt containing at minimum:

```text
actor = top-level control-plane / guard-repair seat
NOT ordinary bound Worker-1
NOT Worker-1 subagent
base Worker integration SHA = e84295ae8115f122bb6b427f42973409b5134b5a (or later explicitly reconciled head)
base toolbox SHA = b6c702821bc48281b02e16773c7c277ae17fb03f
new branch/worktree identity
frozen queue full SHA
8 READY / 0 SPENT
receipt namespace README-only
Agent/model executions = 0
```

If no top-level control-plane seat can be instantiated without asking Tonio to run commands or manually repair folders, treat that as an **orchestration defect**. Fix the engineering entry path. Do not transfer the bootstrap job to the user.

An ordinary user action such as opening the designated engineering session/shortcut is acceptable; command-line setup, cwd diagnosis, hook inspection, permission clicking, and installer troubleshooting are not operator duties.

---

## 9. CURRENT V4 / REVISION-5 POSITION

No stage advancement.

```text
STAGE 1 — GRAPH ENGINEERING
  -> current certification / control-plane boundary
  -> AR-1277 control-plane repair + CLAUDE.md rebuild
  -> normal Worker-1 hard-denied Agent acceptance probe
  -> certification/G2 work only after explicit GPT GO

STAGE 2 — COMPILER remains LOCKED
```

The `CLAUDE.md` rebuild is support/hardening work required because the current always-loaded instruction surface is unreliable and oversized; it does not itself earn certification or compiler authorization.

---

## 10. LOCKS / PROHIBITIONS

Until a later GPT ruling explicitly releases them:

```text
frozen eight calls: NO-GO
Opus calibration retry: FORBIDDEN
live Agent guard probe: NOT YET — AR-1277 installs/proves mechanism first
compiler execution on uncertified strategy: LOCKED
broad backtesting: LOCKED
PAPER: LOCKED
broker / Topstep / live: LOCKED
PowerShell side-door use: FORBIDDEN
manual Tonio bootstrap/repair commands: FORBIDDEN AS WORKFLOW
```

---

## 11. NEXT REQUIRED ARTIFACT

**AR-1277 — CONTROL-PLANE / GUARD-REPAIR REPORT**

It must contain actual implementation/test evidence, not another routing handoff.

If execution is impossible because the top-level control-plane seat has no automated/no-command entry path, report one bounded orchestration block and repair that entry path first. Do not loop and do not make Tonio the technician.

---

## OPERATOR DIRECTIVE

**ACCEPT THE POST-AR-1276 HANDOFF AS COMPLETE ROUTING DOCUMENTATION. DO NOT PRODUCE ANOTHER HANDOFF. THE NEXT SUBSTANTIVE PACKET IS AR-1277 FROM A TOP-LEVEL CONTROL-PLANE / GUARD-REPAIR SEAT.**

**AR-1277 MUST: (1) PREPARE THE ZERO-DISPATCH AGENT HOOK WITNESS, (2) FAIL-CLOSED THE SEPARATE POWERSHELL TOOL WHILE PRESERVING HANDS-FREE `--dangerously-skip-permissions`, AND (3) REBUILD ROOT `CLAUDE.md` FROM SCRATCH INTO A <=200-LINE HOT OPERATING CONTRACT WHILE MOVING ALL UNIQUE HISTORY/REFERENCE KNOWLEDGE TO ON-DEMAND/PATH-SCOPED DESTINATIONS.**

**DO NOT SPEND OR TOUCH THE FROZEN EIGHT. DO NOT RETRY THE OPUS CALIBRATION. DO NOT ASSIGN COMMAND-LINE BOOTSTRAP WORK TO TONIO.**
