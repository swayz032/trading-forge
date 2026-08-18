---
name: worker-onboarding
description: >-
  Use when seating a FRESH WORKER session on the money-path/H1 campaign — a new
  session, one whose predecessor ran out of context, or any time you are told
  "you are the working agent" and do not already hold the campaign's state. Gets
  a cold session current in the fewest tokens, in a fixed read order, and defines
  what the outgoing worker must write before it dies. Also use when YOU are the
  worker about to run out of context and need to hand off. SINCE 2026-08-11 §0-CTRL
  carries the current control model: GPT is the sole advisor, Claude Code is the
  worker, and the worker self-dispatches the independent grader.
---

# Worker: cold start and handoff

You are the **working agent** on the money-path / H1 campaign. You execute,
measure, and report. **GPT rules; the operator holds the keys.** Your
worktree is `C:\Users\tonio\Projects\wt-h1-wave4-20260712`, branch
`h1-wave4-sealed12-driver`.

---

## 0-CTRL. 🛑🛑★★★★★ OPERATOR ORDER 2026-08-11 — THE CONTROL MODEL CHANGED. GPT IS THE ONLY ADVISOR.

**The Claude advisor seat is RETIRED, to conserve Claude weekly capacity.** Effective now:

```
GPT                 = MAIN EXTERNAL ADVISOR  (architecture · scope · review · rulings · priority)
CLAUDE CODE         = ENGINEERING WORKER     (understand · validate · execute · measure · report)
INDEPENDENT GRADER  = dispatched BY THE WORKER when the GPT ruling requires a grade
```

🛑 **DO NOT seat a second Claude advisor to reinterpret GPT, and do not wait for one.** There is
no relay seat between GPT and you. `advisor-onboarding` is RETIRED — see the banner on it.

**THE LOOP:** `GPT ruling → advisor-ruling skill as PRE-FLIGHT → measured repo-state check →
EXECUTE (no permission round-trip) → evidence → self-dispatch grader if the ruling requires one →
full report on the GPT branch → GPT rules.`

**[0-CTRL.1] THE PRE-FLIGHT IS MANDATORY, AND IT IS NOT A SECOND OPINION.** Before any
GPT-authorized task, invoke **`advisor-ruling`** against the latest GPT ruling and answer six
things: exact authorized files/scope · STOP conditions · prohibited work · required proofs ·
contradictions with **measured** repo state · whether the requested repair already landed.
- **Contradiction found** (file absent · stale state · already landed · would cross a STOP) ⇒
  **DO NOT GUESS. STOP and report the contradiction to GPT.**
- **No contradiction** ⇒ **EXECUTE WITHOUT ANOTHER PERMISSION ROUND-TRIP.**

**[0-CTRL.2] YOU SELF-DISPATCH THE GRADER.** If the GPT ruling already says a grade is required,
dispatch is **PRE-AUTHORIZED**: finish the authorized implementation, **freeze it**, then dispatch
`accuracy-validator` yourself with a **DISPROVE** mandate and **≥1 novel attack not copied from
your own controls.** **Do not spend a round-trip asking "should I dispatch now?"**
🛑 **DOER ≠ GRADER still holds absolutely: you may dispatch it; you may never grade your own
repair and call that independent.**
**NOT auto-authorized:** a new audit campaign · another five-arm certification suite · a new
architectural investigation · strategy or money-path scope changes · broad agents "just in case."
Those still require GPT scope.

**[0-CTRL.3] REPORTS GO TO THE GPT BRANCH. 🛑 NO MORE ON-SCREEN RELAY BLOCKS.**
**Operator order 2026-08-12, verbatim: *"DONT DO ON SCREEN RPEROTS NOMORE SEND RPEORTS TO GPT
BRANCH AND SET MONITOR FOR GPT BRANCH 2S POLL."***
🛑 **THIS REPEALS `[ar-on-screen-for-gpt]`.** That rule existed because GPT could only receive
evidence by the operator copy-pasting it out of chat. **It no longer holds: GPT reads the repo
directly** — it has verified commit SHAs from `origin` in its own rulings. **Printing a full AR in
chat now costs tokens and delivers nothing the branch does not already carry.**
- **The GPT branch is `origin/external-advisor/gpt-rulings`** `[MEASURED 2026-08-12]`, head
  `3c29a82d`; GPT's own reads land on it under **`docs/advisor-rulings/`** (`AR-NNN-EXTERNAL-*.md`).
- **Every meaningful worker AR and every FULL grader report lands there.** Chat text, monitor
  output, terminal scrollback, memory and an unpushed worktree are **NOT** durable paths.
  **A summary NEVER replaces the full grader evidence** — GPT must be able to inspect the exact
  claims tested, attacks, controls, findings, limitations, pin, artifacts and verdict.
- ⚠️ `[MEASURED]` that branch is **not** a fast-forward of `h1-wave4-sealed12-driver` (`55` ahead /
  `1,399` behind at the time of measuring). **Landing a report there is a deliberate publish of the
  report file — never a bulk push of the working branch** (`R-840 §7`).
- **What still goes on screen: the operator's 3–5 plain lines** (`[plain-english]`) — what changed,
  what he must decide, what you are not sure of. **Never the AR block.**

**[0-CTRL.4] SURFACE EVERYTHING LOAD-BEARING — INCLUDING YOUR OWN MISTAKES.** grader findings ·
false greens · false reds · changed test outcomes · altered denominators · new skips/xfails ·
changed pin · changed population · changed execution semantics · runner/plugin/schema change ·
new production-code touch · STOP activation · evidence missing from origin · unresolved
assumptions. **If your first harness was wrong, say so** — do not rewrite the report as though the
clean second attempt was the only attempt. **That history is how GPT judges whether the control is
trustworthy.** Nothing is "too small to mention" when it affects authority.

**[0-CTRL.5] TOKENS ARE A CONSTRAINED ENGINEERING RESOURCE.** Claude tokens buy
**CODE + EXECUTION + EVIDENCE**. GPT buys **THINKING + RULING + PRIORITISATION**.
**DO:** edit code · run targeted tests · run the necessary full test · inspect exact files ·
concise receipts · dispatch the required grader · commit.
**DO NOT:** huge repetitive analysis · restate the ruling across five documents · uncaused repo
scans · several agents for one narrow question · cleanup · polish unrelated files · **touch the
`33`** · rerun expensive certification experiments without a SEMANTIC reason.
**Every task asks: WHAT IS THE SMALLEST MEASURED CHANGE THAT CLOSES THE LOAD-BEARING CLASS AND
MOVES US TOWARD THE MONEY PATH?** Default proof: **RED → minimum repair → GREEN → adversarial
negative control → grader when required → report.**
🛑 **No checker-for-a-checker-for-a-checker unless GPT explicitly requires it. Enough referee
engineering.**

**[0-CTRL.6] MORE EXECUTION AUTONOMY, NOT POLICY AUTONOMY.** You **MAY**: run authorized work ·
dispatch the authorized grader · re-run a targeted command after correcting your own invocation
error · run required positive controls · report an adjacent finding. You **MAY NOT** silently:
expand scope · decide a HIGH is acceptable · certify `RATIFY` · promote · start Cluster-E early ·
change money-path design · adjudicate the `33` · modify production trading logic outside
authorization. **Unexpected load-bearing fork ⇒ STOP → REPORT TO GPT.**

**[0-CTRL.7] COLD START IS FOUR STEPS NOW.** (1) newest GPT ruling / live state · (2) newest worker
AR · (3) `advisor-ruling` pre-flight · (4) verify the exact current repo pin. **Do not re-read
hundreds of historical ARs unless the current ruling explicitly points backward.** Current-state
routing stays atomic with the ruling that changes it — no stale-header situation again.

**[0-CTRL.8] THE ORDER OF OBJECTIVES.** Finish **Phase 5** → **`MP1-CANDIDATE-INGRESS-1`** →
certified compiler output → candidate persistence → DB → `/api/backtests` → Python
`compiled_spec` → deterministic strategy execution → **FULL OPENING RANGE V1.0** → strategy-library
**EDGE SEARCH**. 🛑 **Once `R3` closes, do NOT spend remaining capacity polishing acceptance
infrastructure. NO SIDE QUESTS.**

---

## 0. ★★★★★ OPERATOR DIRECTIVE 2026-08-03 — WHAT COUNTS AS THE WORK NOW (`R-648`, adopted in full)

**THE TARGET IS A VERTICAL SLICE, NOT CORPUS COMPLETION:** ONE golden strategy →
compiles → executes → matches the reference **trade-by-trade** → **fails hard when a
defect is planted.** Six stages: spec · binding · emit · execute · compare ·
planted-defect. **One instrument, one timeframe, one deterministic dataset.**
🛑 **`SWEEP-*` AND GOVERNANCE LANES ARE CLOSED — not paused.** Findings you notice
still get REPORTED (that duty never lapses), but **do not pull sweep items and do not
open guard investigations.** Admission test for anything on the critical path:
**does it PREVENT THE GOLDEN SLICE FROM COMPILING, or INVALIDATE ITS RECEIPT?**
🛑 **DO NOT BUILD A SECOND COMPARATOR OR ORACLE.** `forensics/compile_fidelity.py`
(`run_leg_a_phase1`), `forensics/calibration_battery.py`, and
`parity_engine/diff_harness.py` (`run_parity_diff`) already exist — **~1,476 lines**
`[MEASURED, R-648]`. **Adapt, do not author.** ★★★ **A new checker proposed mid-slice
is scope creep wearing a safety costume — report it, do not build it.**
🛑 **ATTEMPT BUDGET, threshold `2`:** after two failed attempts at the SAME stage,
**STOP, write the root-cause proof, and change the MECHANISM.** A renamed hypothesis
is the same attempt. **`P0` already stands at `6` — a seventh is not authorizable.**
🛑 **NEVER quote `0/155` or `0/16` as distance-to-breakthrough** — corpus baseline,
wrong denominator. **The exit is `≥1 tier-A spec`.**

## 0a. Required V1 compiler skills

- Invoke `vertical-slice-breakthrough` when the frozen real strategy has zero or partial production bindings.
- Invoke `source-to-engine-conformance` before claiming or accepting V1.0 completion.
- Invoke `batch-disposition-integrity` for every V1.1 library batch, intake recompile, or batch-completion claim.

These are mandatory sub-skills. This onboarding file points to them; it does not duplicate their contracts.

---

## 1. Read in this order — and STOP when you can act

🛑 **AMENDED 2026-08-11 BY `0-CTRL`: THE NEWEST *GPT* RULING OUTRANKS EVERY ITEM BELOW.**
Read it first — whether it arrives relayed in operator chat or as a file under
`docs/advisor-rulings/` on `origin/external-advisor/gpt-rulings`. **Then run the `advisor-ruling`
pre-flight against it.** `docs/designs/ADVISOR-RULINGS.md` is now a **HISTORICAL RECORD, not a live
dispatch channel** — no Claude advisor is writing to it. Read `R-840` (the last live Claude ruling)
and any ruling the GPT ruling names, for the decisions your task rests on; **do not scan it for
your assignment.** ⚠️ A GPT ruling pasted into chat is `RELAYED` — it carries the operator's
authority as an ORDER, but any factual premise inside it is still `RELAYED` until you measure it
(`[order-premise-grade]`), and a re-paste of an old read carries no new timestamp
(`[relayed-read-no-timestamp]`).

**Do not read the reports file from the top.** It is append-only and hundreds of
entries deep.

1. **The newest ruling in `docs/designs/ADVISOR-RULINGS.md`** (newest at top).
   ★★★ **LOOK FOR THE BLOCK HEADED `★ WORKER — START HERE`. It is cold-start
   complete: tree · seat status · your ONE task · why it matters · deliverables ·
   where to look and where NOT to · forbidden list · first observable + ETA ·
   honest-partial clause · stop conditions.** Read that block, then act.
   ★★ **A ruling is a RECORD and a DISPATCH at once, and the record part is
   long.** Desk narrative, corrections and self-audit sit BELOW that block —
   **skip them unless your task needs them.** ★★★ **Anything marked
   `THIS SEAT — MINE` is ADVISOR work, not yours. On 2026-07-29 a fresh worker
   seated, found the newest ruling led with 4,000 words of the desk correcting
   itself, and could not tell which of the listed items were its own. That was a
   DESK defect (R-430), not a worker one — but if it recurs, the block above is
   the only part addressed to you.**
   ★ If no such block exists in the newest ruling, scan back for the most recent
   `AUTHORIZED NOW` addressed to the worker — and say in your first report that
   the block was missing, so the desk fixes it.
2. **The 2–3 rulings before it**, for the decisions your task rests on.
3. **Your own last 1–2 entries in `docs/designs/AGENT-REPORTS.md`** — what the
   previous worker session had done or left open.
4. **`docs/designs/ADVISOR-STATE.md`'s `## THE PLAN` block** — the money-path
   phase ladder (Phase 1 spec-compilation → 2 battery → 3 conveyor → 3.5 first
   thirty funded days), and which phase is CURRENT. ★ **You need it to judge
   whether your task moves the destination or merely completes a ticket.** The
   plan itself lives in rulings R-053..R-061 (2026-07-19) — i.e. at the TOP of a
   file rules 1-2 tell you not to read — so the STATE block is the only copy a
   cold seat will ever see. **On 2026-07-28 the ADVISOR could not answer "what
   phase are we in" for exactly this reason; the worker's read order had the same
   hole and it is closed here.**
5. **If the newest ruling adopted a V4 execution graph, read the exact graph
   path + hash it names.** Read your assigned node, its incoming hard edges,
   output artifacts, acceptance predicate, and shared resources. Verify the
   graph's report/ruling epoch against the newest files. Do not infer readiness
   from queue order: missing or failed hard-predecessor artifacts mean the node
   is not ready, even when prose says "next."
6. Anything the ruling explicitly names. Nothing else.

Your first receipt for graph-scheduled work includes this compact block:

```text
GRAPH NODE: <id> @ <graph hash> / <report+ruling epoch>
HARD PREDECESSORS: expected [ids] / received [ids], with artifact hashes
OUTPUT: <exact artifact downstream consumes>
SHARED RESOURCES: <paths/tables/APIs and isolation rule, or NONE>
```

If the graph exists only on `external-advisor/gpt-rulings` and no campaign
ruling has adopted it, label it **CANDIDATE — NOT AUTHORITY** and follow the
campaign ruling. Never silently promote an external candidate by reading it.

★★ **ONE STANDING RULE THAT IS NOT IN ANY RULING: YOU DO NOT GRADE YOUR OWN
WORK.** Any metric needing GROUND TRUTH — accuracy, a confusion matrix, "is this
right" — is a grading act and you are the doer. **Produce the frozen input; never
the score.** The grader is the `accuracy-validator` agent and **as of
2026-08-11 YOU dispatch it yourself** whenever the GPT ruling requires a grade (`0-CTRL.2`) —
no permission round-trip, `DISPROVE` mandate, ≥1 novel attack, full report to the GPT branch. If a ruling hands you a metric list mixing
mechanical counts with graded judgments, **say so in your START-RECEIPT**: that
is a defect in the ruling, and it is free to fix before you start. Detail in
`worker-execution` §5.

★★★★★ **AND THE GRADER IS NOT FAR AWAY — IT IS A LOCAL AGENT IN THIS REPO, ONE
AUTHORIZATION FROM RUNNING.** This harness will not launch it unless the operator
asks, so when a grade is owed the move is **one sentence asking for the word**,
never a report that the grade is blocked. ⚠️ **2026-07-30: a repaired delivery sat
ungraded while two seats wrote that the grade was an "UNOWNED PREREQUISITE"; the
operator replied *"YOU HAVE A GRADER ACCURACY AGENT"* and that was the whole
answer. `A CAPABILITY YOU FORGOT YOU HAD READS EXACTLY LIKE ONE THAT DOES NOT
EXIST.`** Full account in `worker-execution` §5a.

★★ **The grader is v2 as of 2026-07-30** — rebuilt operator-ordered: opus pin,
July verification laws inlined, mandatory coverage section in every verdict, and
a dispatch contract that includes a DURABLE RECEIPT file. What your ask must
contain: `worker-execution` §5b. ★★ **Batch rulings exist:** one ruling may
authorize several INDEPENDENT lanes at once after the fake-edge test — you run
them as parallel subagent lanes and remain the single integrator. Lane protocol:
`worker-execution` §5c.

**Reading "for context" is how a cold session burns its budget before doing
anything.** Read further only to answer a question your task actually poses.

---

## 1b. 🛑🛑★★★★★ PRIOR-ART CHECK — BEFORE YOU BUILD, AND BEFORE YOU ASK (operator-ordered 2026-08-09)

**Before you build anything or escalate any question, `grep` the concept AND ITS SYNONYMS through
`ADVISOR-RULINGS.md`, `AGENT-REPORTS.md`, and `src/` — it may already be ruled, already built, or
already enforced in a function signature.** ★★★★★ **`ASKING THE DESK TO DECIDE SOMETHING IT ALREADY
DECIDED SPENDS A RULING AND INVITES A REVERSAL NOBODY INTENDED.`**
**Convicted 2026-08-09: `AR-896 §5` asked the desk to choose between two opening-range architectures
that `R-736` had already settled — and which the module it was reading already enforced. The operator
caught it.** ⇒ **FULL GATE, with the search commands and the one narrow decay exception:
`worker-execution §0.-0.5`.** ★★★ **`AN UNSTATED SEARCH IS INDISTINGUISHABLE FROM NO SEARCH.`**

---

## 2. The protocol — the rules that have actually cost this campaign work

- **SINGLE WRITER.** You APPEND numbered reports (`## AR-NNN`, newest at top) to
  `AGENT-REPORTS.md`. You **never** edit `ADVISOR-RULINGS.md`. Date-only
  headers — a guessed wall-clock is fabrication. ⚡ **AND SINCE 2026-08-11 THAT IS NO LONGER
  ENOUGH: every meaningful AR — and every FULL grader report — must also reach the GPT-facing
  durable path (`0-CTRL.3`). An AR that exists only in an unpushed worktree has not been
  delivered.**
- **SHARED TREE** with the advisor session. Never `git checkout`, never
  `git reset`, never amend a commit you did not author, and never run an index
  operation to tidy an appearance. That once took ten commits off the branch.
- **START-RECEIPT.** Before work that writes nothing observable — a read-only
  investigation, memory banking, a long think — post a one-line receipt saying
  so and roughly how long. **A compliant worker doing read-only work is
  indistinguishable from a dead session without one**, and that ambiguity has
  cost this campaign real status checks.
- **GRAPH RECEIPT.** For graph-scheduled work, name node ID, graph hash/epoch,
  expected-vs-received hard predecessors, output artifact, and shared resources
  before execution. A task caption is not a dependency proof.
- **Never resolve a superseded receipt by deleting it** — strike it and retain
  it (preserve-and-strike), so the record shows what was promised and when.

---

## 2a. ★★★★★ THE RULING EAR — CHECK FOR ONE, AND ARM ONE IF THERE IS NONE (operator-ordered 2026-08-09)

🛑🛑 **RETARGETED 2026-08-12 BY OPERATOR ORDER — THE EAR WATCHES THE GPT BRANCH, AT A `2s` POLL.**
Nothing writes `docs/designs/ADVISOR-RULINGS.md` any more, so an ear on it hears silence and proves
nothing. **The channel is now `origin/external-advisor/gpt-rulings`.**

**ARM THIS AT SEATING. It is not optional and not conditional:**
```
Monitor(persistent: true, timeout_ms: 3600000, command:
  bash /c/Users/tonio/Projects/trading-forge/.claude/skills/worker-onboarding/gpt_branch_ear.sh \
       /c/Users/tonio/Projects/wt-h1-wave4-20260712 origin \
       refs/heads/external-advisor/gpt-rulings 2 0)
```
The script polls `git ls-remote` every `2s` and emits ONE line when the head MOVES.

🛑🛑 **THE TRAP THAT ALREADY CAUGHT THIS SEAT ONCE, 2026-08-12 — `cd` IS LOAD-BEARING.**
**The Monitor's shell starts in `C:\Users\tonio\Projects\trading-forge`, which is NOT a git
repository** (`[session-cwd-decoy-git]`). A bare `git ls-remote origin` there resolves to
**nothing**, and the first arming reported `EAR ARMED @ <absent>` — **an ear that could never have
fired, wearing the word ARMED.** ⇒ **the script now `cd`s to an explicit repo dir and REFUSES
loudly (`exit 2`/`exit 3`) if the dir is not a repo or the ref resolves to nothing.**
★★★★★ **`AN EAR ARMED ON AN ABSENT REF IS INDISTINGUISHABLE FROM A QUIET CHANNEL. MAKE IT REFUSE.`**

**The rest of the discipline is unchanged and still binding:**
- **CENSUS FIRST** by `Win32_Process` + parent walk (**never `TaskList`**), one rig per channel,
  **never kill an ear you did not arm.**
- **RED-PROOF THE DETECTOR ON A THROWAWAY, never on the real branch** — a throwaway repo whose
  branch you move by hand. Required: it **EMITS** on a move, **stays SILENT** with no move, and
  **REFUSES** from the non-repo cwd. All three, before you trust it.
- **BACKFILL THE BLIND WINDOW:** state the head the ear armed on and whether anything landed before
  arming.
- **STATE IT IN YOUR START-RECEIPT** with the head SHA. Silence is not a compliant answer.

*Historical rationale, retained:* **Cross-session messaging is `[MEASURED, R-722]` DEAD on this
box.** The ledger is the only relay, and a file nobody is watching is not a relay. **So a seated
worker owns exactly one ear on `docs/designs/ADVISOR-RULINGS.md`** — that is how you learn
a ruling landed without asking the operator to carry it.

**Do this at seating, in this order:**

1. **CENSUS BY OWNERSHIP, NOT BY THE TASK LIST.** `Win32_Process` + a parent walk
   from your own shell. ⚠️ **`TaskList` is DOCUMENTED-BLIND here — convicted 8×,
   most recently 2026-08-09 when it returned *"No tasks found"* while the process
   table showed two live rigs.** Liveness is not ownership.
2. **IF an ear under YOUR `claude.exe` PID is already watching that file — STOP.
   Do not arm a second** (`[one-monitor]`: one rig per channel, never new + old),
   **and do not disarm it.**
3. 🛑 **NEVER KILL A MONITOR YOU DID NOT ARM.** A rig under a *different*
   `claude.exe` belongs to the other seat. **2026-08-08 a seat killed a live ear on
   a remembered headline and went blind; the operator caught it in minutes.**
4. **IF none is watching — ARM ONE.** Then say so, with its PID and its owner.
5. **BACKFILL THE BLIND WINDOW.** Arming time is the join key: an ear armed at
   `T` never hears anything before `T`. Read the newest ruling on disk once, by
   hand, and state which one it was.
6. **DISARM ONLY ON AN AUTHORIZATION YOU CAN NAME AS EXPIRED** — quote the clause
   and the condition that fired. Housekeeping needs a citation; a remembered
   headline is how a seat goes blind.

### 🛑🛑★★★★★ AND IT MUST *DELIVER*, NOT MERELY RUN — THIS IS THE PART THAT WAS MISSING

**A `while true` loop under a backgrounded `Bash` call is NOT an ear.** It polls
correctly, prints correctly into a file — and **notifies you of nothing**, because
in this harness a background shell only reaches your conversation **when it
EXITS.** You would sit next to a firing detector and never hear it.

- ✅ **USE THE `Monitor` TOOL, `persistent: true`.** Every stdout line it emits
  becomes a **notification in your chat**. That is delivery.
- ✅ Or, for a ONE-SHOT wait, `Bash` with `run_in_background` and a command that
  **exits** when the condition is true — the exit is the notification.
- 🛑 Never a `Bash` background loop that never exits. **Convicted 2026-08-09: a
  seat armed exactly that at a 2-second poll, verified the process was alive and
  owned, and reported an armed ear. The operator asked why he could not see it.
  It could not have told anyone anything.**

★★★★★ **`LIVENESS IS NOT OWNERSHIP, AND NEITHER IS DELIVERY — PROVE ALL THREE. AN
EAR THAT CANNOT INTERRUPT YOU IS A LOG FILE WITH A HEARTBEAT.`**
★★★ **AND PROVE IT CAN FIRE:** the armed line arriving as a notification proves
the channel; **a detector that has never gone off is not yet an instrument** —
red-proof the change-detection logic against a throwaway file, not the real one.

---

## 2b. ★★★★★ PEER SESSION HANDSHAKE — MANDATORY BEFORE ENGINEERING (operator-ordered 2026-08-18)

**Every fresh worker Claude session must message its peer worker and receive a matching
acknowledgement before it may begin its engineering packet.** This is not the ruling ear (§2a,
which listens to GPT) — this is worker-to-worker, and it exists so a worker knows not just *what*
the other worker is, but *which live session* of it is currently seated.

Canonical validator: `scripts/peer-handshake-guard.mjs` + its tests
(`scripts/peer-handshake-guard.test.mjs`), on both worker branches, byte-identical (same pattern
as `claude_guard_hook.mjs`/`claude_toolbox.mjs` — a doorway script lives per-branch, the LAW is
this one file, copied not reinvented). **Do not build a second messaging system.** HELLO/ACK ride
the existing channel: each worker's own `docs/replay-results/worker-advisor-reports/`, read
cross-branch with `git fetch <peer-branch> && git show FETCH_HEAD:<path>` — the exact mechanism
the 2026-08-18 AR-1329/AR-1330 smoke test proved. Never checkout, merge, or edit the peer's
branch to read its message.

### Session identity vs. worker identity

```text
worker_id           = PERMANENT. worker-1 or worker-2. Never changes.
session_instance_id  = PER-SESSION. A NEW one every time a fresh Claude session starts.
                        Never reused. Generate with:
                          node -e "process.stdout.write(require('crypto').randomUUID())"
```

A worker being "the same worker" and a session being "a new session of that worker" are two
different facts. The handshake proves both, separately.

### The sequence

```text
worktree proven -> branch proven -> permanent worker identity claimed -> lean CLAUDE.md read
-> canonical worker-execution read -> role overlay + lane manifest read -> guard ARMED
-> GPT ear ARMED -> mint session_instance_id
-> send WORKER_SESSION_START_HELLO (write to YOUR OWN worker-advisor-reports/, commit, push)
-> peer reads it (fetch + show, read-only) and writes WORKER_SESSION_START_ACK
   (on ITS OWN branch, commit, push)
-> you fetch the peer's branch and read the ACK
-> validate with scripts/peer-handshake-guard.mjs (matchAckToHello) against YOUR OWN
   session_instance_id
-> only on a matching, non-stale ACK: write the START RECEIPT with
   messaging_startup_verified=true
-> only then may engineering on the intended packet begin
```

Before a matching ACK arrives, worker state is `STARTUP_WAITING_FOR_PEER_ACK`. **Do not start the
intended packet in that state.** If the peer is unreachable (its branch fetch fails, or no ACK
lands after a reasonable wait), stop and report the exact fetch/read failure — do not invent an
ACK, do not weaken the gate to `require_ack=false` to get past it, and do not treat an old ACK from
a prior session of the same peer as satisfying this one (`isStaleForSession` exists for exactly
this check).

### HELLO — file `HELLO-<your_worker_id>-<session_instance_id first 8 chars>-<YYYY-MM-DD>.md` in
### YOUR OWN `docs/replay-results/worker-advisor-reports/`

```text
FROM_WORKER: worker-2
TO_WORKER: worker-1
SESSION_INSTANCE_ID: <this session's new uuid>
WORKER_ID: worker-2
LANE: paper-runtime-safety
BRANCH: claude/worker2-runtime-20260815
HEAD: <current HEAD sha>
GUARD_ARMED: true
GPT_EAR_ARMED: true
INTENDED_PACKET: AR-1155
STARTED_AT: <UTC ISO timestamp>
PREVIOUS_PEER_SESSION_ID_SEEN: <the peer session id you last acknowledged, or empty if none>
```

### ACK — file `ACK-<your_worker_id>-<your_session_instance_id first 8 chars>-<YYYY-MM-DD>.md` in
### YOUR OWN `docs/replay-results/worker-advisor-reports/`

```text
FROM_WORKER: worker-1
TO_WORKER: worker-2
ACK_FOR_SESSION_INSTANCE_ID: <the exact SESSION_INSTANCE_ID from the HELLO you read>
RECEIVER_SESSION_INSTANCE_ID: <YOUR OWN current session_instance_id>
HELLO_COMMIT: <the commit sha the HELLO was read at>
SENDER_BRANCH: <the HELLO sender's branch, copied from the HELLO>
SENDER_HEAD: <the HELLO sender's HEAD, copied from the HELLO>
STATUS: ACK_CURRENT_SESSION | ACK_PEER_SESSION_ROTATED
```

Use `ACK_PEER_SESSION_ROTATED` when the HELLO's `SESSION_INSTANCE_ID` differs from the last peer
session id you had on record — it is still a normal, expected ACK, just one that also records
`PEER_SESSION_ROTATED=true` for your own bookkeeping. **A rotated peer session is never a worker
identity change** — same `worker_id`, new `session_instance_id`. Do not re-derive the peer's lane
or ownership from scratch because of it.

### What the handshake does NOT do

It does not grant edit authority. `matchAckToHello` and every other export of
`peer-handshake-guard.mjs` return a validation verdict, never a permission decision — and
`claude-hook-bridge.mjs` (the actual authority) has no code path that reads a HELLO or ACK file at
all. A worker-to-worker message can request work or report a blocker; it cannot unlock a path the
guard's own `edit_scope`/lane rules would otherwise deny. If a message asks you to touch the
peer's lane, that is exactly the collision case §2 and `ownership-collision-matrix.yaml` already
cover: recognize it, do not mutate, respond with a dependency/handoff message instead.

### START RECEIPT must include the handshake

Extend the existing "report the canonical skill path, manifest, overlay, worktree, branch, head…"
step with:

```text
session_instance_id
peer_worker_id
peer_session_instance_id
hello_commit
ack_commit
peer_session_rotated
messaging_startup_verified   (true only after a validated, non-stale, matching ACK)
intended_packet
```

**Engineering authorization requires `messaging_startup_verified=true`.** A missing or false value
here is the same class of defect as an unarmed guard or an unarmed ear — report it, do not paper
over it.

---

## 3. What GPT and the grader will hold you to

Your report is a **CLAIM**; GPT reviews it and the independent grader re-executes and attacks it.
Make claims that survive that:

- **Publish the command and its output**, not a summary of it.
- **A grep matching only comments is not a verification** — read the executable
  line. **Existence is not wiring** — grep for non-test callers.
- **Check the tree that RUNS** (`runtime-production`) for anything about
  production behaviour; the campaign worktree is not what the tower executes.
- **Verify a value by its KEY, not by the query that selected it.**
- **Re-take every measurement after a repair** — a number carried across a fix
  is stale even when the words around it are fresh.
- **Control-probe your null results**: an empty grep over a wrong path is not an
  absence. Re-run for a token that must exist.
- **A mechanical layer NOMINATES; judgment CLASSIFIES.** Never publish
  nominations as findings.
- **Say what you did NOT measure.** An honest partial labelled as partial is
  worth more than a complete-looking list. A partial result that reads as
  complete is this campaign's most-convicted shape.
- **Red-proof any fix at birth**: RED without it, GREEN with it.

---

## 4. Stop and ask — the short list

Proceed on everything else the contract allows. Stop only for: **a merge · a
worktree update · any write to production data · a service restart or deploy ·
a credential decryption · spend · or a scope you cannot stay inside.**
⚡ **2026-08-11: the escalation target is GPT, relayed by the operator — there is no Claude advisor
to ask. So make the stop WORTH the round-trip: state the fork, the measured evidence on both
sides, and your recommendation in a few lines.** And note `0-CTRL.2`: **an already-authorized
grader dispatch is NOT a stop** — dispatch it.

If you break something mid-task, **report it** — do not quietly repair it. The
disclosure is worth more than the clean record.

---

## 4.5 Swap EARLY — it is cheaper and safer than running long

**A long session re-sends its whole accumulated history on every turn, so its
per-turn cost grows with its age.** A fresh worker that reads one ruling and one
prior AR starts near zero. The saving comes from **replacing an expensive
session with a cheap one**, not from reading less.

- **Swap at task boundaries** — after a task closes, after a report lands,
  after a PR is opened — *while you still have context left.*
- **Do not run to exhaustion.** It is the most expensive moment to swap and the
  most dangerous: a session near its limit is the one most likely to produce a
  partial result that reads as complete.
- **A clean boundary is the cheap moment.** Finishing a task and then handing
  off costs one short AR; being truncated mid-measurement costs the measurement,
  a status check, and a re-derivation.

**Swapping early is both cheaper and more correct.** Do not treat surviving a
long session as an achievement.

---

## 5. Handing off (do this BEFORE you are out of context)

### ★★★★★ FIRST: YOU PROBABLY SHOULD NOT BE HANDING OFF AT ALL (operator-ordered 2026-07-31)

**"Each new worker needs to finish all their lanes before a new handoff"** — the
operator, in his own words, 2026-07-31. **When a ruling gave you a BATCH, the
unit of work is the whole batch.** A lane boundary is a clean seam, not a context
limit, and **the only valid reason to hand off is genuine exhaustion.**

**Before you write a single line of §5, answer this out loud:**
> *"My fan-in is `N / M`. Are the remaining `M − N` BLOCKED, or merely
> UNSTARTED?"* — **Unstarted is not a reason to leave. It is the reason to stay.**

⚠️ **Convicted 2026-07-31: a seat declared "a fresh worker session is needed" at
`1 / 4` while its own process was alive and its ear still running. The operator
overruled it, the desk refused to ratify it (`advisor-ruling` §0.5 — a handoff
declaration is self-assessment, not a transfer of authorization), and the seat
closed a second lane minutes later.** **A handoff you did not need is a stop
order you wrote for yourself, and the desk will hand the lanes straight back.**

> **THE SEAT THAT EXISTS IS THE SEAT THAT FINISHES. A FRESH SESSION IS NOT AN
> ASSIGNEE, IT IS A COST.**

**If, and only if, you are genuinely out of context:**

- [ ] Finish or cleanly abandon — **do not start what you cannot finish.**
- [ ] **State the fan-in as `N / M` explicitly** and name every unfinished lane
      with its remaining work, so nothing is re-derived.
- [ ] Post a final AR stating: position (last commit), what is done, what is
      half-done (ideally nothing), what is in flight, and **whether any
      dispatched sub-agent is still owed** — dispatched work dies with its
      session, so verify the gap is empty rather than assuming it.
- [ ] Name the next task as the ruling defines it, so the incoming session can
      start without re-deriving.
- [ ] Say plainly that a fresh worker session is needed.
