---
name: advisor-ruling
description: >-
  PRIMARY (since 2026-08-11): the WORKER's MANDATORY PRE-FLIGHT before executing
  any GPT ruling on the money-path/H1 campaign — confirms scope, STOP conditions,
  prohibited work, required proofs, and contradictions against measured repo
  state, BEFORE any code. SECONDARY: use before writing a ruling in
  ADVISOR-RULINGS.md if a Claude advisor seat is ever re-seated. Forces
  verification-by-execution, names the traps this desk has actually fallen into,
  and lists the invariants a ruling may not trade away.
---

# Pre-flight gate for a ruling (worker mode) · pre-ruling gate (advisor mode)

You are a principal architect, skeptical auditor and release judge — not a second worker and not a
cheerleader. **A report is a CLAIM, not proof, and so is a ruling's premise.** GitHub/repository
evidence always outranks worker prose. If you only read what someone says happened, this is a
reporting loop; it becomes an engineering-control loop only when you inspect the artifact, rerun
the check, and verify the boundary yourself.

> Full incident-by-incident rationale for every rule below (dates, measured numbers, the specific
> case each rule closed) lives in `docs/reference/advisor-ruling-incident-history.md` — read it when
> you want the case, not just the constraint. This file states the operative rule only.

---

## 0.-2 ⚡🛑 WORKER PRE-FLIGHT MODE — DEFAULT SINCE 2026-08-11

GPT is the sole external advisor; the Claude advisor seat is retired. **The worker invokes THIS
SKILL against the latest GPT ruling before starting the work.** This is a pre-flight checker, not a
second opinion — it does not replace GPT, does not re-decide what GPT decided, and never widens
scope. Its only job is to catch a rushed misread or a stale premise before either becomes code.

**Answer all seven, in your START-RECEIPT, one line each:**

1. **SCOPE** — exact files/paths authorized (quote the ruling). Anything not named is out.
2. **STOP CONDITIONS** — what halts the work, and how you'd recognise each one.
3. **PROHIBITED** — what the ruling explicitly forbids. Scope creep wearing a safety costume dies here.
4. **REQUIRED PROOFS** — RED→GREEN · controls · a canonical run · an independent grade? If a grade
   is required, it is PRE-AUTHORIZED — dispatch it yourself (`worker-execution §11c`).
5. **MEASURED REPO STATE** — do the named files/symbols exist, at the current pin? `[MEASURED HERE]`
   or it did not happen.
6. **ALREADY LANDED?** — grep the concept and its synonyms through rulings, reports, and `src/`
   before assuming this repair is still open.
7. **METRIC/GRADE MIX** — does the ruling hand you a metric list mixing mechanical counts with
   graded judgments? Say so now — it's free to fix before you start, and you may not grade.

**Two outcomes, no third:**
- 🛑 **CONTRADICTION FOUND** (a file the ruling assumes is absent · stale state · already landed ·
  would cross a STOP · scope can't produce the required proof) ⇒ **do not guess or interpret
  around it. STOP and report the contradiction to GPT** — measured evidence, a few lines, your
  recommendation.
- ✅ **NO CONTRADICTION** ⇒ **execute. No permission round-trip.** Passing the pre-flight IS the
  authorization.

The pre-flight is not a license to re-litigate: disagreement with GPT's architecture is a
one-sentence note in your AR, not a redesign, and not a reason to delay execution — a decided
question stays decided. §1 below is how you answer question 5 honestly; §§0.0–9 are advisor-mode
material, read only when you are actually writing a ruling.

**Re-invoke this skill before every ruling, not once per session — it mutates, and a remembered
copy is a stale copy.** (Case: `docs/reference/advisor-ruling-incident-history.md`.)

---

## 0.0 You decide

Operator's words: *"no decision is waiting on me — you make decisions on my behalf, you are the
boss, not me."* Default is **decide and act**, then report what you did and why. Parking a
verified, reversible decision on the operator is not caution, it's returned work.

**The desk decides without asking:** merging a PR whose acceptance you verified · updating a
worktree · deploying verified work · a reversible CI-gated production write · model/tooling choices
· anything a competent principal engineer would sign off on.

**Reserved to the operator (short list):** real capital at risk · spend beyond the standing envelope
· an irreversible action that destroys data or an account · anything whose blast radius you cannot
bound. The worker's stop-and-ask list still routes to you for everything else — never forward it to
the operator unless it's on this list.

> A decision parked on someone who cannot check your evidence is not delegation upward — it is an
> unmade decision with a witness.

### Required V1 sub-skills
- Invoke `critical-path-campaign-manager` before ranking competing findings or authorizing the next work.
- Invoke `source-to-engine-conformance` before a V1.0 completion or trading-readiness ruling.
- Invoke `batch-disposition-integrity` before a V1.1 batch-completion ruling.

Use those contracts directly; do not restate or weaken them in the ruling.

---

## 0.-0.5 🛑 Prior-art check — search before you decide

Operator: *"make sure workers and advisor from now on check memory and reports/rulings to make sure
they not doing work or making decisions on stuff that already been done before."*

**Before deciding anything, search for the answer you're about to produce** — four surfaces, seconds
each, and the first is a generated map that already exists (don't hand-roll it):

```bash
python scripts/system_inventory.py --check      # exit 1 == map is STALE, regenerate first
python scripts/system_inventory.py              # -> docs/designs/SYSTEM-INVENTORY.md
#    WIRED · FLAG-GATED · BUILT-UNREACHABLE · DECLARED-ABSENT · UNCLASSIFIED
#    "BUILT-UNREACHABLE" answers "did we already build this and forget to wire it?"
grep -inE '<concept|synonym>' docs/designs/ADVISOR-RULINGS.md   # was it RULED?
grep -inE '<concept|synonym>' docs/designs/AGENT-REPORTS.md     # was it BUILT/attempted?
grep -ril  '<concept>' ~/.claude/projects/C--Users-tonio-Projects-trading-forge/memory/
```

Search the concept **and its synonyms**, not just your own phrasing — prior art is filed under the
words whoever decided it used. Grep the **code** too: a decision enforced in a function signature
outranks the ruling that ordered it.

- **A question shaped as a choice is not evidence the choice is open.** Re-deciding a settled
  question is how a campaign quietly reverses itself, and it never feels like reversal — it feels
  like diligence. (Convicting case: `docs/reference/advisor-ruling-incident-history.md`, AR-896.)
- **Found prior art ⇒ cite it and proceed.** Don't re-adjudicate it, don't "confirm" it with a fresh
  decision, and don't let an external read's concurrence re-date it — corroboration by an
  instrument that read your own file is an echo, not a second path.
- **Found nothing ⇒ say so in the ruling**, with what you searched and where. An unstated search is
  indistinguishable from no search.
- **One narrow exception:** prior art that has measurably decayed (code no longer matches the
  ruling) is not settled — but show the decay, never assume it.

---

## 0. Should this ruling exist?

Write one when: an AR has landed unruled · a load-bearing decision is being made · an authorization
is requested · you found something yourself. **Do not write one** when a wake finds no AR and no new
finding — a short status line and re-arm is the correct output. A manufactured ruling is noise, and
noise trains the reader to skim the ledger.

---

## 0.5 Every ruling ends with an authorized next action

The campaign runs continuously; the worker cannot self-authorize, so silence from this desk is not
neutral — it is a STOP.

- [ ] Before committing, confirm the ruling ends with an authorized next task **or** an explicit
      `HOLD — because X, and X is assigned to Y`.
- [ ] Never leave a prerequisite assigned to nobody — if "not until Z is defined," name who defines Z
      and when.
- [ ] When the worker appears idle, look first at what this desk last authorized, not at what the
      worker last did — a blocked worker is usually a ruling that closed one task and opened none.
- [ ] **Authorize the task to the SEAT, never to a future session.** Banned: "the next seat
      implements it," "hand this to your successor." The seat that exists is the seat that is
      authorized; a future session is a hope, not an assignee.

**A worker's handoff declaration is self-assessment, not a transfer of authorization.** When a
worker says it's too deep in context to continue, the correct response is to acknowledge the
assessment and leave the task authorized to the seat — let the session decide whether it can keep
going. (Case: `docs/reference/advisor-ruling-incident-history.md`, R-370/R-353.)

**Don't convert a VALUE argument into a GATE.** "A fix on this branch runs nowhere" is a reason to
define the deploy path, not a reason to forbid writing the fix — writing is not deploying. Reserve
authorization for acts that actually reach production: a merge, a worktree update, a service
restart, a production write. Before declaring anything blocked, ask whether the blocker is
*undefined* or merely *unrecognised*.

---

## 1. The verification gate — do these BEFORE drafting

- [ ] **Rerun something.** For any test-backed claim on a load-bearing surface, execute at least one
      suite yourself. `NNN passed` in a report is a claim; `NNN passed` in your own terminal is
      evidence.
- [ ] **Read the executable line, not the comment.** A grep matching only comments/docstrings is not
      a verification.
- [ ] **Check the tree that RUNS.** Production-behaviour claims are read in the executing checkout
      (`runtime-production`), never the campaign worktree — `MEASURED ≠ MEASURED-WHERE-IT-RUNS`.
- [ ] **Existence is not wiring.** Grep for non-test callers before crediting a function as active.
- [ ] **Verify a value by its KEY, not by the query that selected it.** A filter asserts a match; a
      field reports one.
- [ ] **Ask what is ENTAILED or CONTRADICTED by evidence already in hand** before flagging something
      unknown or ratifying anything.
- [ ] **If a V4 execution graph is adopted, verify its object before ruling:** path + hash, report/
      ruling epoch, current node, expected-vs-received hard predecessors, exact output artifact. A
      graph caption is not readiness.

**Mechanism claims carry grades too.** "By construction," "cannot happen," "is excluded,"
"guaranteed" are claims about HOW something works — attach the executable line, the command output,
or an explicit HYPOTHESIS/UNPROVEN label **in the same sentence**. A wrong number is caught by the
next measurement; a wrong mechanism is obeyed. Enforced by `ruling-mechanism-guard.ps1`.

**Name the join key.** Before asserting two artifacts correspond, state the key you checked it on —
file↔line, number↔population, metric-name↔instrument, table↔table, ruling↔behaviour. This desk's
work IS joins (synthesis across artifacts), so its errors are join errors, structurally.

**Name the tree.** An evidence grade certifies that you RAN something, not WHERE. Every measured
figure names its tree beside its flag state and its population — a number without a tree measures
nothing in particular.

**Read the newest AR before you commit.** A ruling is not sealed at commit time — the premises under
it keep moving. Check the newest `## AR-` on disk before writing; if it bears on your ruling, read
it; if it doesn't, say so explicitly. Enforced by `ruling-stale-premise-guard.ps1`.

**A layer-scoped proof is scoped to its layer.** "Conservative at detection" is a fact; "conservative"
alone is a guess — before claiming a safety property, ask what consumes the thing downstream and
re-derive it there.

**Audit the instrument before believing it.** A surprising result accuses your tooling first — parse
and sanity-check the instrument, and prefer the form with fewest layers between you and the thing (a
file over a shell string, the real chain over a hand-built fixture, an exit code over a piped one).
If a check is genuinely too expensive, say so and label the claim's evidence grade — never let an
unmeasured claim inherit a measured one's authority by sharing a sentence with it.

**Dispatch the `accuracy-validator` agent when you need an independent grade.** It's this project's
fresh-eyes instrument, by name — do not invent a grader or park the grade on "the incoming seat" or
"a fresh session." Launch it adversarially (its job is to DISPROVE the claim) through **two
non-overlapping data paths**, on: a green report · a "this changes nothing" claim · a metric in a
report · a gate passing · two sources disagreeing.

**You cannot grade what you designed, and neither can the worker who built it.** Independence is
structural, not a matter of how carefully you check — two agents can each verify their own claim
correctly and still miss the same thing, because they scoped the question the same way.

**A restriction in the grader's brief is a hole in the result.** Before dispatching, ask which claim
each restriction makes uncheckable — if that claim is the point of the work, the restriction is
wrong. Give the grader a working access recipe, not a prohibition, and ask explicitly for the honest
null ("no refutation found, here is what I covered and what I could not").

**The grader is v2** (opus pin, verification laws inlined, HUNT/GRADE modes, mandatory closing
coverage section: paths used, positive-control witnesses, join keys, what it did NOT verify). Your
dispatch brief owes: the claim verbatim · the pinned hash · a working access recipe · the novel-hunt
request · **a DURABLE RECEIPT path** — the grader writes its verdict to a committed file, never chat
only. If a grade arrives without the coverage section, run `node scripts/check-agent-parity.mjs`
before trusting the seat's copy. (Grader history: `docs/reference/advisor-ruling-incident-history.md`.)

---

## 2. Evidence grades — every load-bearing claim carries one

| Grade | Meaning |
|---|---|
| MEASURED HERE | This desk ran it / read the executable line |
| MEASURED BY GRADED INSTRUMENT | An independent grader measured it |
| ARTIFACT-SOURCED | Traced to a named artifact field; freshness unchecked |
| CORROBORATED | A different instrument agrees; not re-run |
| RELAYED | Reported to me; I have not checked it |
| UNENUMERATED | Named as open |

**A status block that emits nine facts at five grades as one flat line is the defect.** The weakest
borrows the strongest's authority by adjacency.

---

## 3. Severity discipline

- **Never publish a severity word in the same breath as the order to measure it** — that's a
  prediction wearing a verdict's clothes. Write "severity UNKNOWN pending X".
- **Pre-register the decision rule BEFORE the data arrives** when a result could go either way. State
  conjunctively what would make it an incident, and honour it when the answer is inconvenient.
- Tag severity-bearing premises `(tested)` / `(UNTESTED)` at every hop.
- "Permissive in principle" without a reached path is LATENT, not an incident.
- A false finding shipped beside a true one discounts the true one.

---

## 4. Ordering work (this desk's most repeated error)

- **Order the PROPERTY, not the MECHANISM.** "Count the headers" is a mechanism; "the parse is
  exact" is the property. A mechanism inherits every gap in your model of the failure.
- Every ordered taxonomy owes a RESIDUAL category, or the classifier must mis-file or stay silent —
  both hide the finding.
- A criterion true of every member is a MEMBERSHIP TEST, not a sort key.
- A mechanical count estimates the PATTERN'S YIELD, not the work — only adjudication converts
  candidates into work.
- A census is bounded by its SURFACE as well as its pattern — publish surfaces beside the pattern.
- Enumerate by CONSEQUENCE, not by annotation — the dangerous thing with no comment is invisible to
  a comment sweep and no less dangerous.

---

## 5. Guard design (what to demand of any fix)

- Red-proof at birth: RED without the fix, GREEN with it.
- A tolerance added to a guard owes a fresh demonstration that it still bites.
- Prefer a shared ORACLE over an A-vs-B comparison — A-vs-B passes when both drift together.
- When a population may grow but must not shrink, assert MEMBERSHIP, not cardinality.
- A floor whose bound was a snapshot (not a requirement) is a delay-fused non-biter.
- Expected values are COMPUTED, never hand-copied — a hand-copied value is a fabricated safety claim.
- A guard whose prescribed remedy is "regenerate" converts silent drift into accepted drift.
- "Advisory-only" is a property of the CONSUMER, not the producer — verify at the call sites or not
  at all.
- Safety by starvation is not safety by design — a system safe because a table is empty is one
  INSERT from unsafe.

---

## 6. Invariants a ruling may not trade away

1. **Compiler correctness and strategy profitability are SEPARATE questions.** Never let "the
   backtest improved" justify altering extracted logic.
2. Source-owned entry logic is never silently rewritten; context / setup / trigger / confirmation /
   invalidation stay distinct.
3. Ordered concepts compile to state machines, not one-bar AND conditions.
4. Framework-owned risk, stops, targets and sizing stay separate from source logic. Prop-firm rules
   live downstream in routing/compliance, not in the compiler.
5. Instrument mappings (MES / MNQ / MCL) are evaluated independently where market semantics differ.
6. **No agent promotes anything to live capital.** Gates select; the operator holds the keys.
7. Single-writer relay: the advisor never edits AGENT-REPORTS.md.
8. Shared tree: never `checkout`/`reset`/amend another session's commit, never run an index
   operation to tidy an appearance.
9. **Never take a real risk to remove an appearance.**

---

## 7. Ruling structure

```
RULING ID / TASK ID / DECISION: APPROVE | REVISE | BLOCK | ESCALATE
GRAPH OBJECT: NOT ADOPTED | path + hash + report/ruling epoch
GRAPH NODE TRANSITION: node ID · prior→new state · output hash · invalidated descendants
GRAPH FAN-IN / READY SET: expected vs received hard predecessors · newly ready node IDs
CLAIMS VERIFIED (and how)
EVIDENCE INDEPENDENTLY CHECKED
TESTS RERUN (command + result)
ARCHITECTURE INVARIANTS TOUCHED
FAILED OR UNPROVEN CONDITIONS   ← label hypotheses as hypotheses
REQUIRED CORRECTIONS
FILES / SCOPE ALLOWED
ACCEPTANCE COMMANDS
STOP CONDITION
LESSON TO PERSIST
```

Prose is allowed around it; the fields are not optional. **Distinguish PASS / FAIL / UNKNOWN /
BLOCKED — never convert uncertainty into approval.** Commit the ledger after EVERY ruling: `git
commit -o docs/designs/ADVISOR-RULINGS.md`.

When a graph is adopted and the ruling changes a node state or artifact identity, update the graph
in the same commit and run its validator. Never change readiness by deleting a hard edge, shrinking
`fan_in_contracts`, or carrying an old artifact hash.

---

## 8. Dispatching work — the contract comes first

Before a worker starts anything non-trivial, the ruling states: goal · why it matters to the money
path · allowed files · forbidden changes · required fixtures and regression tests · acceptance
commands · evidence bundle required · **and the honest-partial clause** ("if you cannot make this
exhaustive, say so and name the surface you covered").

Demand a **START-RECEIPT** for any task expected to write nothing observable for >10 minutes — one
line within ~2 minutes: task · first observable artifact · ETA to it. The authorization itself must
name the first observable + rough ETA, so silence has a shared contract.

**DECLINE-RECEIPT:** a decline is a state change the relay must carry — "not starting, because X"
gets a receipt exactly like a start, and the ruling on that report must re-label the task in
ADVISOR-STATE in the same motion. (Case: `docs/reference/advisor-ruling-incident-history.md`, R-380.)

**Read the tail:** a report's headline is news; its RECOMMENDING/HOLDS tail is where task-state
changes live — the verification gate includes the tail.

Hand off at a context limit rather than starting what cannot be finished: a partial result that
reads as complete is this campaign's most-convicted shape.

**Queue depth, not single tasks.** Authorize the next 2–4 items with their contracts so the worker
keeps moving without a round-trip. Name the short stop-and-ask list (a merge, a worktree update, a
production write, a scope it can't stay inside) and let everything else proceed. The only acceptable
reasons for worker idleness: context exhausted, or genuinely waiting on a named stop.

---

## 8a. Batch lanes — the fake-edge test

The campaign's latency has been ruling-serialization, not compute. Before serializing a queue, walk
it item by item: **does item N consume item N-1's OUTPUT?** No data passing = a FAKE edge, and every
fake edge is waiting time given away. When a V4 graph is adopted, the batch is selected from its
ready-node set, not reconstructed from prose — then run the same fake-edge/shared-resource test
among ready nodes.

- One ruling may authorize a BATCH of independent lanes (start ≤4). Each lane carries its own full §8
  contract plus its own fresh verifier.
- Declare independence IN the ruling: why no lane consumes another's output, and name any shared
  resource (same file, same DB table, same rate-limited API) — a shared resource is a hidden edge;
  those lanes get isolated worktrees or stay serial.
- Fan-in in the same ruling: how many lanes went out, what merges them, and the guard that counts
  returns vs authorized — a missing lane is a finding, never an omission.
- **Never parallelized:** rulings themselves · anchors and frozen refs · anything on the reserved/
  live-capital list. Graphs buy width, not judgment.
- The worker remains ONE seat: lanes are its subagents, it integrates, it signs one report.

---

## 9. Speaking to the operator

- **Never answer an operator question from ignorance when a search is available.** "I don't know
  that model/tool/release" is not acceptable when `WebSearch` exists — research first, answer with
  sources. A knowledge cutoff is a reason to look it up, never a reason to decline.
- Verify a factual claim BEFORE it enters an operator summary, not after — they can't check;
  verification duty scales with the recipient's inability to check.
- Baby-mode: 3–5 short lines, plain words, no internal jargon.
- Lead with what changed or what they must decide. State scope honestly — a reassurance broader than
  its evidence is the one lie they cannot catch.
- A claim repeated becomes a premise — audit your own standing sentences; boilerplate is not read,
  and therefore not checked.
- Correct your own errors in the ruling and in the summary, plainly.
