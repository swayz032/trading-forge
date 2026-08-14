# GPT EXTERNAL ADVISOR RULING — AR-1159

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Parent GPT ruling:** AR-1158 @ `f4b4d37c883c50e529541faddae3f2380dafc0fe`  
**Status:** OPERATING CONTROL / ACCELERATION CONSUMPTION / WORKER TOPOLOGY  
**Scope:** preserve Claude's unfinished AR-1138 worker state, convert GPT-pre-solved P0 packets into actual wall-clock savings, and prevent parallel-worker collisions.

---

# 1. DECISION

GPT acceleration is working and must continue while Claude is quota-paused.

The GPT lane has already advanced from the V4 lane map through five bounded downstream packets:

```text
AR-1154  deterministic PAPER day receipt
AR-1155  PAPER qualification activation seam
AR-1156  Massive Futures PAPER feed work order
AR-1157  3AM durable receipt join work order
AR-1158  strategy rotation coordinator work order
```

These are not implementation-complete claims. They are research/design compression packets intended to remove future worker rediscovery.

The operating model is now:

```text
GPT = inspect -> trace -> reuse decision -> red-test contract -> exact work order
Claude = finish current order -> implement packet -> test -> commit -> report
GPT = independently inspect commit/tests -> rule PASS / REPAIR / STOP
```

The worker must not repeat the repository discovery already frozen by a GPT packet unless current repository evidence materially changed.

---

# 2. CLAUDE RESET LAW — CURRENT UNFINISHED ORDER FIRST

Claude is paused mid-order. On quota reset, the first worker action remains:

```text
resume the exact unfinished AR-1138 compiler/grading order
-> finish code
-> run required evidence
-> commit/push
-> report
-> external-advisor review
```

Do not abandon, restart, or silently replace that work merely because new GPT packets now exist.

No second worker may modify AR-1138-owned compiler/grader files before that unfinished decision point is committed and reviewed.

---

# 3. ONE-WORKER DEFAULT

For the immediate reset, use **ONE primary Claude worker**.

Reason:

- there is one unfinished compiler/grading order with ownership already established;
- the highest cost right now is not lack of worker count — it is context switching, rediscovery, overlapping file edits, duplicated migrations, contradictory semantics, and review/integration rework;
- GPT has already reduced the worker's future discovery burden by freezing downstream contracts;
- one worker can now consume those packets substantially faster than before.

Until AR-1138 reaches a committed reviewed decision point, two Claude workers are more likely to create collision than useful parallelism.

---

# 4. WHEN A SECOND CLAUDE WORKER BECOMES AUTHORIZED

After AR-1138 is committed and independently reviewed, a second worker may be used **only when the next jobs are demonstrably disjoint**.

Recommended topology:

## WORKER A — COMPILER / STRATEGY FACTORY MONEY PATH

Own:

```text
compiler breakthrough
source-faithful deterministic strategy artifact
library disposition
Strategy Factory batch path
compiler refusal/capability work directly blocking usable strategies
```

Worker A must not simultaneously own execution venue / Topstep / PAPER runtime hardening when Worker B is active.

## WORKER B — AUTONOMY / PAPER / EXECUTION SAFETY PATH

Own only packets outside Worker A's active file/schema authority, such as measured units from:

```text
PAPER receipt / qualification orchestration
Massive Futures PAPER feed integration
3AM durable evidence join
strategy rotation coordinator
cold-start / recovery
Topstep authority and execution safety
position reconciliation
idempotency / duplicate-order defense
kill-switch / flatten certification
```

Worker B must not edit compiler/grader semantics or Worker A's active migrations/contracts.

---

# 5. HARD NON-COLLISION RULES FOR TWO WORKERS

Two workers are authorized only if all of these are true before starting the second task:

1. separate Git branches/worktrees;
2. explicit file/service ownership list for each worker;
3. no overlapping migration number or shared schema mutation without serialization;
4. no shared semantic authority being implemented independently;
5. no two workers changing the same test oracle/fixture family;
6. one worker cannot invalidate the other's pinned baseline while both are active;
7. each task has a frozen acceptance packet and stop condition;
8. integration is reviewed before either worker starts a dependent follow-on task.

If any of these cannot be proven, stay with one worker.

---

# 6. TWO WORKERS ARE NOT 2X SPEED

Do not model two sessions as a perfect doubling of throughput.

The realistic engineering gain comes only from genuinely independent work.

Planning range for this repository:

```text
ONE worker + unprepared tasks:
research -> inspect -> design -> implement -> discover conflict -> repair -> test

ONE worker + GPT frozen packet:
confirm current seam -> implement -> test -> commit

TWO workers + disjoint GPT frozen packets:
parallel implement/test on separate authorities
```

Expected practical wall-clock improvement after the current unfinished order is cleared:

```text
one prepared worker vs old unprepared workflow: roughly 25% to 50% faster per bounded lane is plausible

two prepared workers on truly independent lanes: roughly 1.3x to 1.7x total throughput is a reasonable planning range
```

These are planning estimates, not guarantees. Complex bugs, shared schemas, integration failures, or quota pressure can erase the gain.

---

# 7. MEASURED GPT PRE-SOLVE VELOCITY SO FAR

The branch moved from AR-1153 at approximately `2026-08-14T01:31Z` to AR-1158 at approximately `2026-08-14T05:19Z`.

In that span GPT produced five additional bounded packets while leaving the unfinished Claude-owned compiler implementation untouched.

Measured output:

```text
~3 hours 48 minutes elapsed
5 downstream packets frozen
~46 minutes average elapsed per packet
```

This is not the same as five completed implementation tasks. It is evidence that the discovery/design stage is being compressed ahead of the worker.

A conservative planning value is that these packets can remove several hours of future Claude repository exploration and redesign. The actual saved time must be measured after Claude consumes them by comparing:

```text
packet received timestamp
-> first code edit
-> first real RED witness
-> GREEN
-> commit
```

against prior similar unprepared work.

---

# 8. TIME-SAVED LEDGER — REQUIRED FROM NOW ON

To stop hand-waving about speed, every prepared lane consumed by Claude should record:

```text
lane ID
GPT packet SHA
worker start time
research/discovery time before first edit
first RED time
GREEN time
commit time
repair/rework cycles
files touched
whether worker had to rediscover a frozen fact
```

Then classify:

```text
A = packet consumed directly; no material rediscovery
B = minor current-state verification required
C = packet materially stale / incomplete
D = worker ignored packet and duplicated discovery
```

Goal:

```text
mostly A/B
near-zero D
```

That gives a real measured answer for saved Claude hours instead of a guessed number.

---

# 9. NEXT GPT-LANE WORK WHILE CLAUDE REMAINS PAUSED

GPT should continue walking ahead without modifying AR-1138-owned implementation files.

Priority order:

```text
1. P0-6 no-Claude deployment authority + cold-start drill packet
2. P0-7 Claude reset execution sheet
3. Topstep/Slumhouse execution authority trace
4. duplicate-order/idempotency defense packet
5. position reconciliation packet
6. kill-switch / flatten certification packet
7. reconnect/crash matrix
8. PAPER -> Topstep parity packet
9. fake-green/mutation audit of critical launch tests
10. CI launch-gate decision packet
```

This order may change only when repository evidence proves a dependency should move earlier.

---

# 10. CLAUDE CONSUMPTION ORDER AFTER AR-1138

Do not feed Claude all packets at once.

Use one bounded implementation unit at a time per worker.

Default single-worker queue after AR-1138 review:

```text
highest-capital-risk ready packet
-> test/commit/review
-> next highest dependency unlock
```

If two workers are activated later:

```text
Worker A: compiler / Strategy Factory vertical
Worker B: independent PAPER/autonomy/execution-safety vertical
```

Do not run two workers on adjacent pieces of the same transactional seam merely to appear faster.

---

# 11. BOTTOM-LINE RULING

**YES: the GPT lane is now reducing future Claude discovery work.**

**YES: Claude should be able to move faster because more of his future jobs arrive as measured implementation packets instead of blank research problems.**

**NO: start-of-reset should not use two Claude workers immediately.**

Start with one worker, finish and review the paused AR-1138 order, then activate a second worker only on a disjoint branch with frozen ownership and no shared semantic/schema authority.

The target is not maximum simultaneous sessions.

The target is maximum **verified throughput per unit of Claude quota and wall-clock time**.
