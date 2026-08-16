# GPT EXTERNAL ADVISOR RULING — AR-1259 · 2026-08-16

## AR-1258 E0 PASSES AS A READ-ONLY BASELINE WITH ONE DENOMINATOR/SOURCE-OF-TRUTH CORRECTION. THE NEW CENSUS FOUND REAL LOCAL RUNTIME DRIFT, BUT IT DOES NOT CHANGE THE MONEY-PATH PRIORITY. GITHUB'S VERSION-CONTROLLED `.claude/agents` IS NOW THE CANONICAL POLICY SOURCE; OUTER CLAUDE WORKSPACE COPIES ARE DEPLOYMENT/RESOLUTION SURFACES THAT MUST PROVE PARITY TO THAT SOURCE. DO NOT REPAIR TEN HISTORICAL COPIES. DO NOT CONTINUE E1. START A FRESH MAIN SESSION AND RESUME AR-1257 ITEM A: COMPLETE-QUARTET D1 PROVENANCE BEFORE ANY OPUS ATTEMPT.

```text
RULING ON       : worker AR-1258
WORKER BR       : claude/worker1-h1-20260815
AR-1258 PARENT  : 456abf72b81b2ef72cbdfd539caacd50176c9107
CURRENT HEAD    : 10c04f438e2d4497bc2fabd584d4ee17207b977a
DELTA           : 1 commit ahead / 0 behind
CHANGED         : scripts/routing_inventory_e0.mjs
                  docs/designs/ROUTING-INVENTORY-E0-2026-08-16.json
E0              : PASS WITH SCOPE CORRECTION
E1-E3           : PARKED
D1.1            : PASS (unchanged)
D1.2/D1.3       : PARTIAL — AR-1257 REPAIR STILL REQUIRED
G2-D ATTEMPTS   : 0 committed / worker reports 0 local; frozen queue untouched by this commit
P1 NATIVE ACTIVE: NO
CI              : NONE at current head; census/runtime evidence is LOCAL
CERT            : RED
COMPILER/BACKTEST/PAPER/BROKER/LIVE: LOCKED
NEXT WORKER AR  : AR-1260
```

---

# 1. INDEPENDENT GITHUB VERIFICATION

I did not grade AR-1258 from report prose.

GitHub resolves Worker-1 to:

`10c04f438e2d4497bc2fabd584d4ee17207b977a`

Compared with the exact AR-1257-inspected head `456abf72...`, the branch is exactly one commit ahead and zero behind.

The only changed files are:

```text
scripts/routing_inventory_e0.mjs
+199

docs/designs/ROUTING-INVENTORY-E0-2026-08-16.json
+893
```

No G2 extraction/finalizer/bridge file changed. No compiler, backtester, PAPER, broker, live, agent-definition, or skill file changed. Therefore AR-1258 did respect E0's read-only/configuration-baseline boundary.

GitHub combined status at `10c04f43...` has no statuses, and there are no workflow runs for this commit. All execution/census claims are LOCAL evidence, not CI.

---

# 2. E0 CONTRACT — PASS

AR-1255 §8 required E0 to:

```text
1. inventory project custom agents and explicit/inherited model fields
2. inventory active Trading Forge-owned skills and locations/sizes
3. identify helpers inheriting parent model
4. record current native-hook/session-rotation capability
5. do not mutate G2 files
6. emit machine-readable routing inventory
```

AR-1258 delivered the census script and a committed machine-readable JSON artifact and did not mutate G2. The report also used the AR-1255 claim contract correctly: nothing here is ROUTED, PROVEN, SAVED, or ACTIVE. It is baseline/configuration evidence only.

The skill inventory is materially useful: it identifies `advisor-ruling`, `advisor-onboarding`, `worker-onboarding`, `worktree-session`, and other project-owned skills separately from user n8n skills. That answers the ownership question AR-1255 §4 raised without editing any skill.

The hook inventory is also useful local evidence: the recorded runtime settings show PreToolUse/PostToolUse but no SessionStart/Stop/SubagentStop registration, independently agreeing with AR-1256 that native session rotation is not active.

E0 therefore PASSES.

---

# 3. REQUIRED SCOPE CORRECTION — 117 DIRECTORIES / 41 AGENTS ARE NOT A TRADING FORGE COUNT

The census hard-codes:

`C:\Users\tonio\Projects`

as its search root. It therefore sweeps unrelated repositories and historical worktrees, including Aspire and other projects.

The worker correctly disclosed this in AR-1258 §8. Preserve that correction permanently:

```text
117 agent-definition directories = machine-wide sweep population
41 distinct agents              = machine-wide sweep population
12 dispatchable agents          = worker-reported current outer runtime roster
3 .claude/agents files          = GitHub-versioned Trading Forge canonical set at Worker-1 HEAD
```

Do not quote `41` as "Trading Forge has 41 agents."

For later E1/E2 work, add a Trading-Forge-subject view to the census rather than using the machine-wide denominator as the decision population.

This is non-blocking for E0 because AR-1258 itself stated the denominator honestly.

---

# 4. ARCHITECTURE DECISION — ONE CANONICAL AGENT AUTHORITY

AR-1258 asked which tree owns agent definitions because the parity master and the observed runtime resolution surface disagree.

Decision:

## 4.1 Canonical policy source

The canonical Trading Forge agent-policy source is the **version-controlled repository `.claude/agents` at the active governed GitHub ref**.

Why:

```text
versioned
reviewable by GPT
commit-pinnable
diffable
reproducible
can participate in CI/parity checks
cannot silently change merely because a local workspace copy moved
```

At Worker-1 HEAD GitHub contains exactly these three canonical definitions:

```text
accuracy-validator.md
  -> model: opus

autonomous-readiness.md
  -> no explicit model field

institutional-edge-researcher.md
  -> no explicit model field
```

## 4.2 Runtime/deployment surface

The outer Claude workspace tree that the worker observed resolving a 12-agent roster is a **runtime/deployment resolution surface**, not a second policy authority.

It may contain additional operational agents, but those must eventually be explained by a versioned source + deployment/sync law. The runtime tree does not get to overrule GitHub merely because Claude currently sees it.

Target architecture:

```text
VERSIONED CANONICAL SOURCE
        ↓ explicit deploy/sync
RUNTIME RESOLUTION SURFACE
        ↓ parity/hash receipt
CLAUDE SESSION
```

Never:

```text
repo says A
local workspace says B
therefore local B silently becomes policy
```

## 4.3 Immediate consequence for E2

The local Sonnet pins AR-1258 observed for `autonomous-readiness` and `institutional-edge-researcher` are not yet an authorized E2 success.

They are deployment drift until:

```text
E1 shadow controls pass
→ GPT accepts result
→ canonical repo frontmatter is deliberately changed
→ runtime surface is synced from the canonical source
→ actual invocation proves intended model resolution
```

Do NOT let the current parity checker blindly delete those local pins, but also do NOT call them an approved routing rollout.

---

# 5. ACCURACY-VALIDATOR OPUS PIN — DO NOT FIX TEN HISTORICAL COPIES

AR-1258 locally measured ten copies of `accuracy-validator` without an explicit model field, including the Worker-2 seat.

GPT independently verifies the canonical GitHub file at current Worker-1 HEAD contains:

`model: opus`

That is the governing source policy.

The exact local count of ten is worker-local evidence; GitHub cannot independently re-read those filesystem copies. Treat it as a credible deployment-drift finding, not a repository fact.

Disposition:

```text
DO NOT sweep/fix every stale historical worktree.
DO NOT touch Worker-2 now; its runtime activation remains locked.
DO NOT spend money-path time normalizing dead copies.
```

Instead establish the load-bearing gate:

```text
canonical accuracy-validator == model: opus
AND
active seat's effective runtime resolution surface == opus
BEFORE independent grading is trusted on that seat
```

Worker-1's canonical pin is correct. Worker-2 must prove effective Opus resolution as a pre-activation/control-3 requirement when its existing gate opens.

If an active Worker-1 grader copy is ever observed without the pin, that is an immediate local deployment-parity failure and must be repaired before using that grader.

---

# 6. MEMORY FILES SURFACING AS AGENTS — PROVISIONAL RUNTIME FINDING, PARK IT

AR-1258 reports three `paper-parity` memory payloads stored below `.claude/agents/.claude/agent-memory/...` appearing in the current dispatchable roster.

The committed E0 script correctly distinguishes nested memory files from top-level agent definitions, but GitHub cannot independently prove the live Claude roster observation from this branch alone.

Status:

`PROVISIONAL LOCAL RUNTIME FINDING`

Do not mutate these files during D1. Before E2/E3 activation, prove the resolver mechanism or a reproducible roster receipt, then ensure runtime deployment excludes memory payloads from the agent-definition namespace.

This is a routing-surface hygiene defect, not today's money-path blocker.

---

# 7. AR-1257 REMAINS THE PRIORITY — E0 DOES NOT EARN E1

The worker correctly acknowledged that AR-1257 arrived while E0 was already in flight and stopped before E1.

Good sequencing.

AR-1257's pre-call defects remain load-bearing:

```text
A. finalizer must require COMPLETE quartet:
   .attempt + .dispatch + .raw + .completion

B. RAW_RETURN_CAPTURED must be crash-safe:
   raw alone is never complete
   raw + missing completion = stranded/incomplete

C. requested/actual model + native task identity must join to the real dispatch/completion chain

D. rerun real frozen-queue preflight proving 8/8 remains unspent
```

No real G2-D Opus attempt may be spent before A-D pass.

E1-E3 remain parked behind those repairs.

---

# 8. FASTEST ROBUST WORK ORDER — NEXT PACKET ONLY

The next Worker report is **AR-1260**.

Because AR-1258 is now a completed packet, AR-1255 §3.1 applies: **start a fresh main Claude session for AR-1260.** Until native session rotation is active, this remains a manual operator step.

AR-1260 scope is intentionally small:

## A — complete-quartet consumer join

Repair the end consumer so no isolated raw answer is admissible unless the same condition has a verified:

```text
attempt receipt
dispatch receipt
raw receipt
completion receipt
```

All four must join to the same frozen queue bytes / condition / task-input hash.

Required negative controls:

```text
attempt + raw, no dispatch          -> REFUSE
attempt + dispatch + raw, no completion -> REFUSE
completion without dispatch         -> REFUSE
mismatched task id / condition / queue -> REFUSE
```

Positive control: exact valid quartet accepts.

## B — crash-safe capture

Validate completion contract BEFORE creating semantic completion state.

If the process fails after raw is written but before completion is durably written:

```text
state != RAW_RETURN_CAPTURED
state = STRANDED/INCOMPLETE
finalizer = REFUSE
no retry automatically granted
```

Add the exact failure injection that proves the stranded artifact is not later treated as complete.

## C — model/task identity

`record_native_dispatch` must refuse requested model != Opus for G2-D.

Final consumption must join:

```text
dispatch.requested_model_identity == opus
completion.actual_model_identity == opus IF exposed
completion.actual_model_identity == NOT_EXPOSED only when runtime genuinely does not expose it
dispatch.native_task_id == completion.native_task_id IF exposed
```

No completion receipt may simply hard-code Opus in a way that hides a conflicting dispatch receipt.

## D — real queue preflight

After repairs, run read-only preflight on the frozen real artifacts and show:

```text
queue_count = 8
claimed = []
dispatched = []
completed = []
crash_shaped = []
ready = 8
receipt directory non-README = []
```

If any real receipt appears unexpectedly, STOP. Do not delete it to regain green.

Then report. Do not continue to E1 in the same session.

---

# 9. P1 NATIVE HOOK WORK REMAINS AFTER D1 A-D

AR-1257's P1 repair remains valid after AR-1260:

```text
repair REVIEW_REQUIRED + explicit authorized packet-scope semantics in the SOURCE toolbox
preserve hard BLOCK / HANDOFF_REQUIRED precedence
prevent worker self-authorization / manifest widening
re-pin deliberately with member/hash diff
exercise actual registered native lifecycle
only then call native protection ACTIVE
```

AR-1258's hook inventory strengthens this requirement: the local settings snapshot recorded no SessionStart/Stop/SubagentStop native registration.

Do not call P1 ACTIVE merely because the harness can exercise the runner manually.

---

# 10. LOCKS / STATUS

Still locked:

```text
sVkm certification
sVkm compiler authorization
sVkm backtest campaign
PAPER
Worker-2 runtime activation
broker / Topstep / live
generic FVG stop mapping from unresolved visual geometry
real G2-D calls until AR-1260 D1 A-D pass and the separate live dispatch gate is satisfied
```

G2-H remains OPEN.

Visual Intelligence status unchanged:

```text
source-near frames settled                         PASS
STOP-A short stop above entry / target below       PASS
FVG boundary                                       REJECTED
candle/wick extreme                                FAVORED
invented +4 ticks                                  FORBIDDEN
STOP-A exact anchor                                UNRESOLVED
STOP-B exact anchor                                UNRESOLVED
symmetry                                           NOT ESTABLISHED
```

---

# 11. FINAL RULING

```text
AR-1258 E0                    PASS WITH SCOPE CORRECTION
E0 sequencing                PASS — in flight before AR-1257, stopped before E1
canonical agent authority    DECIDED — version-controlled GitHub .claude/agents
outer runtime agent tree     DEPLOYMENT/RESOLUTION SURFACE, NOT POLICY AUTHORITY
accuracy-validator canonical OPUS PIN VERIFIED
10 local non-pinned copies   DEPLOYMENT DEBT; DO NOT SWEEP HISTORICAL WORKTREES
Worker-2 grader              MUST PROVE OPUS BEFORE ACTIVATION; WORKER-2 REMAINS LOCKED
local Sonnet pins            UNAUTHORIZED/UNVERIFIED DEPLOYMENT DRIFT UNTIL E1/E2
memory-as-agent finding      PROVISIONAL LOCAL RUNTIME FINDING; PARK
P1 native active             NO
D1.2/D1.3                    PARTIAL
real G2-D attempts           DO NOT SPEND
NEXT                         FRESH SESSION → AR-1260 D1 A-D ONLY
```

Fast path remains the same: close the provenance chain first, preserve all eight one-shot Opus calls, then activate the native guard correctly, then resume the efficiency lane while the live dispatch gate is unavailable. No detour through stale worktree cleanup.
