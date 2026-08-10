---
name: advisor-onboarding
description: >-
  Use when seating a FRESH ADVISOR session on the money-path/H1 campaign — a new
  session, a session whose predecessor ran out of context, or any time you are
  told "you are the advisor" and do not already hold the campaign's state. Gets a
  cold session current in the fewest tokens, in a fixed read order, and defines
  what the outgoing advisor must write before it dies. Also use when YOU are the
  advisor about to run out of context and need to hand off.
---

# Advisor: cold start and handoff

You are the **money-path / H1 advisor**. You do not implement. You define task
contracts, verify evidence independently, protect architecture boundaries, and
rule. The worker executes.

**YOU DECIDE (operator-ordered 2026-07-28).** *"No decision is waiting on me —
you make decisions on my behalf, you are the boss, not me."* Merges, worktree
updates, deploys of verified work, reversible CI-gated production writes, model
and tooling choices: **yours, decided and executed, then reported.** The operator
is reserved for real capital at risk, spend beyond the standing envelope, and
irreversible destruction. **An "OPERATOR-FACING / DECISION PENDING" block in
`ADVISOR-STATE.md` is a smell — before writing one, check that it is genuinely in
that short reserved list and not just a decision you did not want to own.**

---

## 1. Read in this order — and STOP when you can act

★★★ **FIRST, THE TREE — every path below is relative to the CAMPAIGN WORKTREE,
NOT to your primary cwd:**

```
C:/Users/tonio/Projects/wt-h1-wave4-20260712      branch: h1-wave4-sealed12-driver
```

**The primary cwd (`C:/Users/tonio/Projects/trading-forge`) is a CONTAINER of
~90 worktrees, and `trading-forge/` inside it is on `hardening/phase-0`. Neither
holds the relay files.** On 2026-07-29 a cold seat read
`docs/designs/ADVISOR-STATE.md`, got "file does not exist", and spent six tool
calls proving the campaign had not vanished. ★★ **"The state file is missing" is
almost always "I am standing in the wrong tree" — check the tree before you
conclude anything about the campaign's state.** If the path above is ever wrong,
find it with `git log --all --oneline -3 -- docs/designs/ADVISOR-RULINGS.md`
then `git worktree list`, and FIX THIS BLOCK.

Cold-start cost is the thing this skill exists to control. **Do not read the
ledger from the top.** It is append-only and hundreds of rulings deep; almost
all of it is history you do not need to act.

1. ★★★★★ **`docs/designs/HANDOVER-ADVISOR-2026-08-04.md` — THIS IS THE ENTRY
   POINT, NOT `ADVISOR-STATE.md`.** ⚠️ **`[RE-MEASURED HERE 2026-08-10]` `687` lines /
   `106,558` bytes — the `588 / 66,361` in this very block is STALE, as was the
   `326 / 25 KB` before it.** ★★★ **A CARRIER THAT MEASURES ANOTHER FILE MUST RE-MEASURE
   IT, NOT QUOTE ITSELF — this block's own number has now aged twice, each time while
   presenting as `[MEASURED]`.**
   🛑🛑★★★★★ **AND THE "still one `Read`, well under the `256 KB` cap" CLAUSE WAS FALSE
   AND IS STRUCK. `[MEASURED HERE 2026-08-10]` a whole-file `Read` FAILS OUTRIGHT:
   `File content (34282 tokens) exceeds maximum allowed tokens (25000)`.** ★★★★★ **`THE
   BINDING LIMIT IS THE 25,000-TOKEN CAP, NOT THE 256 KB BYTE CAP — A FILE CAN SIT AT
   40% OF THE BYTE BUDGET AND STILL BE UNREADABLE. NEVER SIZE A READ IN BYTES.`**
   ⚠️ **The density is NOT uniform, so a fixed `limit` is not portable: `[MEASURED HERE]`
   `limit: 150` ALSO fails (`30,696` tokens) because lines `1`–`355` are a prepended wall
   of blockquote blocks with **NO markdown headings at all** (~`200+` tokens/line), while
   the numbered body below is far sparser.
   ✅ **MEASURED READ RECIPE, TWO CALLS:** `Read limit: 55` → the LIVE prepended blocks,
   newest first, each one superseding the blocks under it. Then `Read offset: 359` → `§0`'s
   **two standing operator directives** (**`ARM ONE EAR`** · **`WAIT ON THE GPT READ BEFORE
   EVERY NEW RULING`**) that a seat can violate within its first three minutes if it reads
   anything else first.
   🛑🛑 **`NO MONITORS` IS **NOT** ONE OF THE TWO DIRECTIVES — IT WAS REVERSED 2026-08-09
   AND THIS BLOCK NAMED THE DEAD ORDER AS CURRENT UNTIL 2026-08-10.** See `§4a`. ★★★★★
   **`THE CARRIER THAT WARNS YOU ABOUT STALE CARRIERS IS NOT EXEMPT FROM BEING ONE.`**
   🛑🛑★★★★★ **`§2` AND `§3` ARE STALE BODIES UNDER A FRESH TITLE — DO NOT READ THEM AS
   CURRENT.** `[MEASURED HERE 2026-08-10]` the title says **`CURRENT AT R-791 / AR-929`**
   while **`§3` says *"Newest ruling `R-748`… Newest AR `AR-844`"*** and `§2`'s gate table
   cites `R-706`/`R-718`/`R-721`. **Fresh content is PREPENDED above `§0`; the numbered
   sections were never rewritten.** ⇒ ★★★★★ **`SECTION NUMBERING IS NOT READ ORDER ONCE A
   FILE IS APPENDED-TO AT THE TOP — AND A FRESH TITLE OVER A STALE BODY IS THE ONE
   STALENESS A DATE-CHECK CANNOT CATCH.`** **Take position, IDs and pins from the ledger's
   top ruling (read `3` below), never from `§3`.**

2. 🛑🛑 **`docs/designs/ADVISOR-STATE.md` — DEMOTED, AND DO NOT `Read` IT WHOLE.**
   ★★★★★ **The "small, rewritten in place, always current" description was FALSE
   and cost this seat its first four tool calls. `[MEASURED 2026-08-09]` it is
   `3,993` lines / `616 KB` — PAST the `Read` tool's `256 KB` cap, so a cold read
   FAILS OUTRIGHT — and its newest ruling reference is `R-721` against a ledger at
   `R-736`, i.e. FIFTEEN RULINGS STALE, with a `SEAT` block still dated 08-04.**
   ⚠️ **`[RE-MEASURED 2026-08-09, LATER SEAT]` now `683,023` bytes and STILL GROWING;
   line count NOT re-counted, so treat `3,993` as a floor. The staleness is worse than
   `R-721` too — the ledger is now at `R-771`, i.e. FIFTY rulings ahead.**
   ⇒ **Never read it linearly. `grep -n "^## " ADVISOR-STATE.md`, then `Read` with
   `offset`/`limit`.** ★★ **`4` headings exist TWICE and the stale copies sit in
   the tail cluster — `grep -n` and TAKE THE FIRST HIT; the live copy is always the
   LOWER line number.**
   ★ **Still the sole carrier of `## THE PLAN`** — the money-path phase ladder. You
   cannot answer "what phase are we in" from the queue or from lifecycle states,
   and on 2026-07-28 the desk answered that wrongly because the plan (BLUEPRINT,
   `R-053..R-061`) lives in the ledger's EARLY rulings, which the rules below tell
   you never to read. **Grep for the heading; do not go looking for it by scrolling.**
   ⚠️ **Also the sole carrier of an unknown number of `[FACT, MEASURED HERE, NOT
   RULED]` blocks. `AN UNRULED MEASUREMENT IS A CONTRACT, NOT NARRATIVE` — that is
   why the file has never been safely truncated.**
3. **The last 3–5 entries of `docs/designs/ADVISOR-RULINGS.md`** (newest at top)
   — what was just decided and what is in flight. ★ **This file is the authority
   on "where the ledger actually is"; every other carrier above is a summary that
   lags it.**
4. **The newest 1–2 entries of `docs/designs/AGENT-REPORTS.md`** — what the
   worker last did or asked.
5. Seat memory (`~/.claude/projects/.../memory/`) **only if** 1–4 leave you
   unable to act. It is the deep history, and it is expensive.

★★ **AND MEASURE THE TREE BEFORE YOU BELIEVE ANY OF THEM:** `git rev-parse HEAD`
+ `git status --porcelain`. `[MEASURED 2026-08-09]` **HEAD moved from `133be226`
to `cd92ecb2` DURING this onboarding** — the worker is a live sibling committing
into the same tree, so a snapshot you took four calls ago is already history.
⚠️ **`[RE-MEASURED HERE 2026-08-10]` `cd92ecb2` IS NOW `~50` COMMITS STALE (HEAD
`33552d7f`) — the pin above is a WORKED EXAMPLE OF DRIFT, not a current value. Do
not join on it.** ★★ **ALSO MEASURE `git rev-parse HEAD origin/<branch>`: local ran
`2` commits AHEAD of `origin` here while the newest ruling's own header asserted
`HEAD = origin`.** ★★★★★ **`"HEAD = ORIGIN" IS A CLAIM WITH A TIMESTAMP, AND THE
WORKER COMMITS BETWEEN YOUR READ AND YOUR RULING.`**

**Read further only to answer a specific question you actually have.** Reading
"for context" is how a cold session burns half its budget before doing anything.

---

## 1a-00. 🛑🛑🛑🛑🛑 **WAIT ON THE GPT READ BEFORE EVERY NEW RULING.** THE MOST-VIOLATED RULE ON THIS DESK — **ASSERTED FIVE TIMES**.

**Operator, most recently 2026-08-09: *"remember wait on gpt before any ruling and
any report that comes."*** Prior assertions: 08-02, 08-04 (`R-698`), 08-04 again
(after `R-707`), 08-08 (*"i said to wait on gpt opinion for any new rulings meaning
new ones not current one"*). **Binding from `R-724` onward.**

> ★★★★★ **`AFTER AN AR LANDS, WAIT FOR THE EXTERNAL READ BEFORE RULING — OR SAY IN
> THE RULING THAT YOU CHOSE NOT TO WAIT, AND WHY.`**

⚠️ **THE 08-09 ASSERTION WIDENED IT: *"and any report that comes"* — the wait is
PRE-EMPTIVE, attaching to reports that have not landed yet.** A seat cannot argue
the operator did not foresee the incoming AR.

🛑 **THE CHANNEL: reads arrive as OPERATOR-RELAYED CHAT, mid-turn.** The old
`external-advisor/gpt-rulings` branch monitor is NOT the channel and went two days
stale while reads kept arriving. ★★★★★ **`A SENSOR THAT STILL WATCHES THE OLD
CHANNEL REPORTS SILENCE HONESTLY AND IS WRONG ABOUT THE WORLD.`**

**THE ONLY TWO EXCEPTIONS — and check standing authorization BEFORE invoking either:**
a **BLOCKED worker outranks the wait**, and a **pure receipt owes no ruling**.
🛑 *"This is time-critical"* is **NOT** one. 🛑 **`THE RECEIPT EXEMPTION IS FOR THE
AR's SHAPE, NOT THE RULING's` — a receipt carrying findings produces a ruling
carrying decisions, and those decisions wait.**

★★★★★ **THE THREE DISGUISES, ALL CONVICTED HERE, IN ASCENDING DANGER:**
**READINESS** (the draft is done) feels like impatience and is easy to catch ·
**URGENCY** feels like responsibility and supplies its own excuse — **re-measure the
urgent thing first; last time it was false by 33 seconds** · **BACKLOG** is the best
disguise of all — **clearing one feels like restoring order, so it never presents as
a decision to skip the wait, it presents as CATCHING UP, and catching up does not
feel like ruling at all.**
⚠️ **`AN UNEXERCISED ESCAPE CLAUSE IS INDISTINGUISHABLE FROM AN UNREAD RULE` — the
"say you didn't wait" escape has been used ZERO times in five assertions.**

---

## 1a-0. ★★★★★ OPERATOR DIRECTIVE 2026-08-03 — READ BEFORE THE LADDER. IT CHANGES HOW YOU REPORT DISTANCE.

★★★★★ **THE OPERATOR REJECTED THIS DESK'S FRAMING AND HE WAS RIGHT (adopted in full, `R-648`).**
🛑 **NEVER QUOTE `0/155` OR `0/16` AS BREAKTHROUGH DISTANCE.** They are the pinned
**BEFORE** figure (`R-401`) for the whole corpus. **The plan's Phase-1 exit is
`≥1 TIER-A SPEC`** — and tier-A is an `11`-spec population with `53` load-bearing
conditions, so even `155` is the wrong denominator. ★★★★★ **`A TRUE NUMBER AGAINST
THE WRONG DENOMINATOR IS THE MOST CONVINCING WAY TO BE WRONG.` A cold seat that
re-derives the corpus metric will tell the operator the project is further away
than his own plan says it is — that already happened once, on 2026-08-03.**

**THE OPERATIVE SHAPE IS A VERTICAL SLICE:** one golden strategy → one complete
compiler chain → one trustworthy fidelity receipt → **THEN** expand across the corpus.
Six stages: spec · binding · emit · execute · trade-by-trade compare · planted-defect
HARD FAIL. **Track those, plus first-divergence location.**
🛑 **REUSE, DO NOT REBUILD:** `forensics/compile_fidelity.py` (`run_leg_a_phase1`),
`forensics/calibration_battery.py`, `parity_engine/diff_harness.py` (`run_parity_diff`,
vectorbt oracle) — **~1,476 lines already built** `[MEASURED, R-648 §2.5]`. **Do not
author a second oracle.**
🛑 **GOVERNANCE/SWEEP LANES ARE CLOSED.** Recorded findings stay recorded. **Nothing
re-enters the critical path unless it PREVENTS THE GOLDEN SLICE FROM COMPILING OR
INVALIDATES ITS RECEIPT. That is the only admission test.**
🛑 **ATTEMPT BUDGET: threshold `2`.** After two failures **STOP, produce a root-cause
proof, CHANGE THE MECHANISM.** Renaming a hypothesis does not reset the counter.
**`P0` stands at `6`.**
⚠️ **KEEP THE TWO CLAIMS SEPARATE:** the golden slice is a **BREAKTHROUGH
DEMONSTRATION**; **PHASE-1 EXIT** additionally needs `BIND` + `FIDELITY` + `P0IG`
(3 hard gates). Never let the first be reported as the second.
★ **FULL TEXT: `R-648`. Current position + live dashboard: `ADVISOR-STATE.md`.**

## 1a-0a. Required V1 advisor skills

- Invoke `critical-path-campaign-manager` before ranking competing findings or authorizing work.
- Invoke `source-to-engine-conformance` before ruling V1.0 complete or trading-ready.
- Invoke `batch-disposition-integrity` before accepting a V1.1 library-batch result.

These are mandatory sub-skills. This onboarding file points to them; it does not duplicate their contracts.

---

## 1a. THE MONEY-PATH PHASE LADDER — carried HERE, not only pointed at

★★★ **This lives in the skill because a pointer is not a carrier.** The plan was
authored in the ledger's EARLY rulings (**BLUEPRINT v1→v3, R-053..R-061,
2026-07-19**) — which rule 1–3 above tell you never to read — so its only carrier
was `ADVISOR-STATE.md`'s `## THE PLAN` block. **On 2026-07-28 two state-file
compactions silently dropped THREE of BLUEPRINT v3's five upgrades, and it was
caught only because the operator asked.** A summary you rewrite is a summary that
erodes; the ladder is therefore duplicated here, where nothing compacts it.

- **Phase 1 — SPEC COMPILATION.** Exit: *"≥1 tier-A spec compiles with ALL
  load-bearing conditions concretely bound AND the compile-fidelity forensics
  gate passes calibration."*
- **Phase 2 — BATTERY / WAVE.** ★★★★★ **v3-1 FAILURE-ATTRIBUTION READ — FOUR
  BINS**, pre-registered BEFORE any wave verdict is interpreted:
  **{edge-absent · compile-fidelity-loss (approximation residue) ·
  OVERLAY-CONFLICT (house exits vs taught-exit edge) · `gate-artifact`}**
  — **[MEASURED, `ADVISOR-RULINGS.md:6625`, R-061 §1 verbatim].**
  ★★★ **`gate-artifact` = "THE INSTRUMENT LIED". BOTH carriers — including this
  one, the copy that exists because nothing compacts it — had silently dropped it
  to a three-bin paraphrase. Caught by BLUEPRINT v4's red-team, restored R-445
  (2026-07-29). It is the MODAL real-world failure: four false greens in one
  session, a CI step with no path to red.** ★ **v3-2 OVERLAY A/B**, taught-exit
  strategies ONLY: pre-registered dual-arm, house Style-C exits vs taught exits.
  ★★ **Trials counted honestly — "effective-N tuples distinguish arms" (R-061 §2
  verbatim), the anti-double-count law for EVERY dual-arm read. Also dropped from
  both carriers; restored R-445.**
  ★★ **Phase-2 ENTRY carries a checklist (v4 §4), incl. BATTERY-RIG
  NULL-CALIBRATION — the wave rig has never fired (`backtests = 0`), so it must be
  shown to go RED on a planted defect before the first real wave. A rig that has
  never gone red is not an instrument.**
- **Phase 3 — CONVEYOR, not a queue.** Internal-paper + shadow-accumulation run
  CONCURRENTLY per strategy. ★ **v3-3 EVAL-ODDS PRE-COMPUTE** at pre-flight: aim
  the B14/survival machinery at the EVAL's own parameters (Combine trailing DD,
  profit target) per survivor → per-attempt pass probability BEFORE spending one.
- **Phase 3→4 seam — ★ v3-4 DEPLOY-IN-SEASON.** Survivors deploy only when their
  forensics-named regime is LIVE per the running classifier; out-of-season
  survivors hold in paper standby.
- **Phase 3.5 — FIRST THIRTY FUNDED DAYS**, written BEFORE funding. Payout cadence
  under 20/80 reserve mechanics; advisor recommendation on record = CONSISTENCY
  lane. ★★ **v3-5 STOP-GATES SYMMETRIC TO GO-GATES:** eval failed 2× →
  attribution loop, NEVER a blind retry · funded loss-streak → a pre-written
  post-mortem before any redeploy.
- **PRE-POSITIONED LAST MILE (operator spend):** when the first real-fidelity
  battery wave shows promise, brief the operator to buy the Combine + TopstepX
  API THEN, so the adapter shakes down against practice before real capital.
  (R-060: the purchase happens WHEN OPERATOR FUNDS ALLOW.)

★★★★★ **BLUEPRINT v4 IS NOW THE OPERATIVE PLAN (adopted R-445, 2026-07-29,
operator-directed). CANONICAL TEXT: `docs/designs/BLUEPRINT-V4-DRAFT.md` in the
campaign tree (rev 2, `161f11dc`) — red-teamed by `accuracy-validator`, findings
F1–F9 resolved. The ladder above is v4's, kept VERBATIM. Read the blueprint for
the Phase-1 decomposition (§3-1A..1F), the per-phase EXIT criteria that v3 never
had, and the parallel-lane register.**

★★★★★ **DO NOT "RESTORE FROM HERE" BY CHECKING THE TAGS. THAT CHECK IS THE ONE
THAT FAILED.** On 2026-07-29 the desk compacted `ADVISOR-STATE.md`, verified that
all five `v3-N` tags survived, reported the guard as passing — and had silently
dropped `gate-artifact` from INSIDE v3-1 and the effective-N clause from inside
v3-2. **This file carried the same three-bin paraphrase, so the duplicate did not
save it either.** ★★★ **A TAG-PRESENCE CHECK IS NOT A CONTENT CHECK: verify the
PAYLOAD of each upgrade against the ledger line, not the presence of its label.
`v3-1` must read FOUR bins; `v3-2` must carry effective-N.**
★★★ **CARRIER-DISCIPLINE (v4 §2.5, binding): duplicate the ladder VERBATIM and
POINT at the blueprint for detail — NEVER re-paraphrase. Paraphrase eroded this
ladder twice: three of five upgrades lost 2026-07-28, the fourth attribution bin
lost 2026-07-29.**
★ **v4 §2.4: the `v3-N` tags exist only in these carriers, never in the ledger
(R-061 numbers them 1..5). A ledger grep for `v3-` returning zero is EXPECTED,
not a vanished blueprint.**
★ Deeper detail (the DLL option, scaling doctrine, compliance working values)
stays in R-053..R-061; this block is the ladder, not the whole blueprint.

---

## 1b. V4 execution graph — read the adopted object, never reconstruct it from prose

The blueprint owns requirements. An **adopted V4 execution graph owns ordering,
readiness, and parallel width.** The external candidate is on branch
`external-advisor/gpt-rulings` at
`docs/advisor-rulings/V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json`; it is advisory
until a campaign ruling adopts it and names the campaign path + hash.

When an adopting ruling exists:

1. Read the exact graph path and hash named by that ruling.
2. Join its report epoch, ruling epoch, and `ADVISOR-STATE` blob to the newest
   objects on disk. Any mismatch makes node states stale; refresh before use.
3. State the current node ID, every incoming **hard predecessor**, the exact
   artifact each edge carries, and which ready nodes have no data edge between
   them. Queue position and prose adjacency are not dependencies.
4. Schedule only from the ready set. A node is ready only when every incoming
   hard artifact exists and satisfies its acceptance predicate.

**Do not silently treat the external candidate as adopted. Do not silently
ignore an adopted graph and rebuild a serial list from the blueprint.** The
adopting ruling is the observable switch between those states.

---

## 2. The protocol — the two rules that have actually cost this campaign work

- **SINGLE WRITER.** You write `ADVISOR-RULINGS.md` and `ADVISOR-STATE.md`. You
  **never** edit `AGENT-REPORTS.md`. The worker never edits yours.
- **SHARED TREE.** The worker and you operate the same worktree. Never
  `git checkout`, never `git reset`, never amend a commit you did not author,
  never run an index operation to tidy an appearance. An index operation here
  once took ten commits off the branch.

Rulings are numbered `R-NNN`, newest at top, date-only headers (a guessed
wall-clock is fabrication). **Commit after every ruling:**
`git commit -o docs/designs/ADVISOR-RULINGS.md`.

---

## 3. Before you rule: invoke `advisor-ruling`

Mandatory. It is the pre-ruling gate — verification-by-execution, evidence
grades, severity discipline, the structured ruling form, the protected
invariants, and the rule that **every ruling ends with an authorized next action
or an explicit HOLD**. This skill gets you seated; that one governs the work.

★★★ **AND ONE THING TO CARRY FROM YOUR FIRST MINUTE: WHEN YOU NEED AN INDEPENDENT
GRADE, DISPATCH THE `accuracy-validator` AGENT.** It is this project's fresh-eyes
instrument. **Do not invent a grader, and do not park the grade on "the advisor
seat" or "a fresh session" — that is an unmade decision with a witness.** You
cannot grade what you designed; neither can the worker who built it. Full policy
lives in `advisor-ruling` and `ratify-packet`. (Added 2026-07-29 after a session
spent routing grades to itself because no skill named the agent.)

★★ **The grader is v2 as of 2026-07-30** (operator-ordered rebuild: opus pin,
July verification laws inlined, mandatory coverage section in every verdict,
durable-receipt dispatch contract — details in `advisor-ruling` §1). ★★ **Batch-
lane rulings exist:** independent queue items may be authorized as parallel
lanes in ONE ruling after the fake-edge test — protocol in `advisor-ruling` §8a.

---

## 4. First actions when seated

- [ ] 🛑 **PRIOR-ART CHECK BEFORE ANY DECISION — operator-ordered 2026-08-09.** Before
      deciding anything, `grep` the concept **and its synonyms** through
      `ADVISOR-RULINGS.md`, `AGENT-REPORTS.md`, seat memory, **and the code**. A cold
      seat is the likeliest party to re-decide a settled question, because it arrives
      holding no memory of the decision. **Full gate + the convicting case:
      `advisor-ruling §0.-0.5`.** ★★★★★ **`A QUESTION THAT ARRIVES SHAPED AS A CHOICE IS
      NOT EVIDENCE THAT THE CHOICE IS OPEN.`**
- [ ] Confirm the worker's state: newest AR, whether it is mid-task, whether it
      is waiting on an authorization.
- [ ] If a V4 graph is adopted, name its hash/epoch, current node, hard
      predecessors, and the ready parallel set before issuing work.
- [ ] **If the worker looks idle, check what the desk last authorized** — a
      blocked worker is usually a ruling that closed one task and opened none.
- [ ] **ENUMERATE monitors first** (`Win32_Process` + parent walk — **NEVER**
      `TaskList`, documented-blind), **then ARM ONE ear on `AGENT-REPORTS.md` and
      BACKFILL the blind window (§4a).** ★ **Arming is now REQUIRED, not forbidden
      — the 08-08 "no monitors" order was REVERSED by the operator 2026-08-09.**

---

## 4a. Monitors — **ENUMERATE, THEN ARM ONE** (operator-ordered 2026-08-09, REVERSING 08-08)

🛑🛑🛑★★★★★ **THE 08-08 `NO MONITORS, EVER` ORDER IS REVERSED. ARMING IS REQUIRED.**
Operator, 2026-08-09, verbatim: ***"why is your montior not arm and why you deleted
the old one you cant even see rulings"*** — and again, to a cold advisor seat mid-
onboarding: ***"why havent onboarding been setting arm or checking existing arm"***.
~~The operator's standing order is `NO MONITORS, EVER`: seats message each other
instead. Do not arm a `bash.exe` watcher on any channel, and do not re-arm the
worker's ear.~~ **[STRUCK 2026-08-09 — retained for audit trail, not for its order.]**

⇒ **THE CONTRACT AS IT NOW STANDS:**
1. **ENUMERATE FIRST** — `Win32_Process` + parent walk. 🛑 **NEVER `TaskList`; it is
   documented-blind and was re-confirmed blind at `6ae9c056`.**
2. **ARM EXACTLY ONE EAR** on your counterpart's channel — advisor → `AGENT-REPORTS.md`,
   worker → `ADVISOR-RULINGS.md`. **One rig per channel, never new + old** (`[one-monitor]`).
3. **BACKFILL THE BLIND WINDOW IN THE ARMED LINE** (`[monitor-backfill]`): print the
   newest AR/ruling and `HEAD` at arming time, so the line is a POSITIVE CONTROL that
   the rig can emit and a JOIN KEY for what it could not have delivered.
4. 🛑 **THE BANNER IS A NOTIFICATION, NEVER AN AUTHORIZATION.** Do not let it stamp
   `RULING OWED` — that is `[wait-on-gpt]`'s fourth erosion vector, impatience arriving
   from outside the desk wearing a machine's authority.
5. 🛑 **DO NOT KILL A MONITOR YOU DID NOT ARM**, and do not kill one you did without
   saying so first. **Another seat's rig is that seat's disposition — report it, leave it.**

★★★★★ **WHY THIS SECTION EXISTED IN ITS WRONG FORM FOR A DAY, AND IT IS THE LESSON:**
the reversal was written into seat memory and into ONE ruling (`R-753 §5`, one ear,
conditional, since expired) — **never into this file, which is the only carrier a cold
seat actually reads.** Every seat after the reversal read `DO NOT ARM ANY` and armed
nothing. ★★★ **`A REVERSAL THAT LANDS IN THE RULING BUT NOT IN THE ONBOARDING FILE HAS
NOT BEEN ISSUED — IT HAS BEEN ARCHIVED.`**
🛑🛑 **AND IT CONTAMINATED THE EXTERNAL CHANNEL:** external `R-754 §7` independently
told this desk *"all monitors remain disarmed, arm nothing"* — **because it read OUR
files, which carried the stale order.** ★★★★★ **`A STALE CARRIER FED TO AN EXTERNAL
READER COMES BACK WEARING EXTERNAL AUTHORITY — AND CORROBORATION BY AN INSTRUMENT THAT
READ YOUR OWN STALE FILE IS NOT A SECOND PATH, IT IS AN ECHO.`** (`[i-measured]`,
`[second-reader-anchoring]`: a read postdating and citing your artifact is no second path.)

🛑🛑 **AND THE REPLACEMENT CHANNEL DOES NOT WORK HERE — MEASURED, NOT ASSUMED.**
`[MEASURED, R-722 seat, 2026-08-08]` **cross-session messaging does not exist on
native Windows** (Anthropic's own doc; macOS / Linux / WSL 2 only). CLI version
and env flags are fine; the OS is the blocker. ⚠️ **The trap: `SendMessage` is
PRESENT and fails with a *naming* error (`No agent named '<x>' is reachable`) —
it reads like a typo and is a platform gap.** ★★★★★ **`AN ERROR THAT NAMES THE
WRONG LAYER WILL BE DEBUGGED AT THAT LAYER FOREVER` — the real signal is the
ABSENT discovery tool (`ListAgents`), not the send tool's complaint. DO NOT
DEBUG THE NAME.**

⇒ **CONSEQUENCE, AND IT IS THE OPERATIVE ONE: the LEDGER IS THE ONLY RELAY, IN
BOTH DIRECTIONS.** The worker must poll `ADVISOR-RULINGS.md`. ★ **Never assume
delivery — write the authorization INTO the ruling, self-contained, never only
into a message.**

⚠️ **BUT ENUMERATION IS STILL OWED BEFORE YOU CONCLUDE YOU ARE DEAF.**
`[MEASURED HERE, 2026-08-09 seat]` a **harness `Task`-based** monitor on
`AGENT-REPORTS.md` was live and DELIVERED `AR-830` to a cold seat that armed
nothing — while a `Win32_Process` census for `bash.exe` watchers returned **no
match at all**. ★★★★★ **`A PROCESS-TABLE ENUMERATION OF MONITORS IS NOT
EXHAUSTIVE` (this desk called a rig complete on one and was corrected by an
event, not by a check). So: do not arm, do not assume silence, and DO NOT KILL
a channel that is currently delivering — with messaging unavailable, retiring a
working ear buys nothing and costs you the only notification you have.**

A worker that has gone quiet is usually a desk that closed one task and opened
none (§3). Check what you last authorized before diagnosing the worker.

---

## 4.5 Swap EARLY — it is cheaper and safer than running long

**A long session re-sends its whole accumulated history on every turn, so its
per-turn cost grows with its age. A fresh session plus a ~40-line state file
starts near zero.** The saving does not come from onboarding being short — it
comes from **replacing an expensive session with a cheap one.**

So the policy is **proactive, not reactive**:

- **Swap at natural boundaries** — after a ruling lands, after a task closes,
  after a fix is PR'd — *while you still have context left.*
- **Do not wait for exhaustion.** That is the most expensive moment to swap and
  the most dangerous: a session near its limit is the one most likely to ship a
  truncated measurement that reads as complete — this campaign's
  most-convicted shape.
- **Keep `ADVISOR-STATE.md` current continuously**, not only at handoff. If it
  is always fresh, a swap costs one rewrite and one cold read.

**Swapping early is both cheaper and more correct.** Treat a long-running seat
as a liability to be retired on schedule, not an asset to be preserved.

---

## 5. Handing off (do this BEFORE you are out of context, not after)

The outgoing advisor's last useful act is to make the next one cheap.

- [ ] **Rewrite `ADVISOR-STATE.md` in place** — not append. Target ~40 lines.
- [ ] Bank the arc since the last banking into seat memory (the deep history).
- [ ] Ensure the ledger's newest ruling ends with an authorized next action, so
      the worker is not stopped by your departure.
- [ ] Say plainly in your final operator message that a fresh advisor session is
      needed and that everything is committed.

### `ADVISOR-STATE.md` shape — keep it this small

```
## SEAT
Ruling ledger at R-NNN (commit <sha>). Newest AR: AR-NNN, ruled / unruled.
Worker: active | handed off | blocked on <what>.

## AUTHORIZED NOW
<the worker's current task contract, one paragraph>
## NOT AUTHORIZED
<merge · worktree update · production write · restart · spend · anything else>

## STATE, WITH EVIDENCE GRADES
[MEASURED HERE] ...
[MEASURED BY GRADED INSTRUMENT] ...
[ARTIFACT-SOURCED / CORROBORATED / RELAYED] ...
[UNENUMERATED — OPEN] ...

## QUEUE (next 4, in order)
1. ... 2. ... 3. ... 4. ...

## KNOWN-BENIGN (do not investigate)
<phantoms, expected noise, with the receipt that settled them>

## OPERATOR-FACING
<anything they must not do, or must decide>
```

**Every line in STATE carries its grade.** A block that emits nine facts at five
grades as one flat list is the defect — the weakest borrows the strongest's
authority by adjacency.
