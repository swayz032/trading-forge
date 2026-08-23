# ALGO — Worker seat handover

**From: Claude Code (Opus), ALGO worker seat, 2026-08-23.**
**To: whichever Claude worker seat exists next — possibly none.**

All Claude seats end **2026-08-27** when the operator's subscription lapses. This is written on
the assumption that nobody reads it for a long time, and that whoever does starts cold.

**If you are GPT, you want `ALGO-GPT-HANDOVER.md` instead.** This one is for a Claude worker.

---

## 1. Seat yourself in three commands

```
/algo-worker-onboarding          # the seat's own onboarding, read it first
cd C:\Users\tonio\Projects\wt-mnq-v24
git log --oneline -30
```

Then read `algo-reports/ALGO-001` onward on branch `external-advisor/gpt-rulings-algo`, in
order. Rulings and worker reports interleave; the numbering is strictly increasing and the
newest ruling is authoritative.

**Arm the ear before anything else.** A seat once ran an entire packet deaf to rulings landing
mid-turn. The onboarding names the exact command.

---

## 2. The one-paragraph state

`current_mnq_strategy_v2_4_*` is a standalone MNQ bot that copies one trader's discretionary
method. The campaign is about **fidelity** — does the machine decide like the man — scored on 14
frozen replay sessions carrying his recorded decisions. **PR #38 is DRAFT / DO NOT MERGE.**
Nothing is connected to a broker. The ladder is `FIDELITY → FREEZE → CLEAN EDGE →
prop-survival → TopstepX` and it is still on the first rung.

**The defect of record — AND ITS FIRST MEASURED MOVEMENT.** The bot used to take a trade in
**14 of 14** sessions and never genuinely decline; the trader traded on **7**. After ALGO-047's
wiring of the entry authority, re-measured end-to-end at the 08:00 window: it trades in
**13 of 14** and genuinely declines in-window **once**. When the bot is present in-window and
he trades, direction agrees **1 of 1**.

> **These numbers are measured at the 08:00 window**, which ALGO-049 made the standing
> configuration — the ALGO-043 revert to 09:30 is WITHDRAWN and 08:00–12:00 is the
> unconditional deployment window. The 09:30 arm (where the frozen **5/8** lives) now runs as a
> RUN-CONFIGURATION of the dual-window exam, not as a committed constant.

**The headline did not move: 1/8 before the wiring, 1/8 after.** What moved is that the entry
decision is no longer a CONSTANT — that constant was the reason the metric carried no
information. Whether the brain declines on the RIGHT sessions is the exam's question, and one
case moved to `BOT_ONLY_ENTRY_UNCENSORED_DECLINE`, which is not a flattering direction. So the
failure is **timing and selectivity, not direction.**

---

## 3. What is built, and what state it is in

**WIRED — the state machine is the kernel's entry authority, enforced by test:**

All under `research/`. Names spelled out so you can copy them straight into a command.

| module | what it does |
|---|---|
| `current_mnq_strategy_v2_4_derivation.py` | APPROACH computed from price; the spec's six interactions named |
| `current_mnq_strategy_v2_4_entry_authority.py` | WAIT-by-default state machine, four routes, no fifth |
| `run_derivation_checkpoint.py` | DIAGNOSTIC: what the new brain would do with current grants |
| `run_mutation_campaign_derivation.py` | ALGO-009 §7, 6 of 15 items owned, all killed |

**Wired when, and by whose authority:** ALGO-029 §2 authorized these to be **built** in parallel
with an outstanding grade but forbade any candidate being **accepted** until a fresh independent
grade passed the repaired evaluator. That gate — §9.2 — was **DISCHARGED by ALGO-047**
(`9d739b90`), which then ORDERED the wiring: the derivation layer and the four-route
WAIT-by-default state machine are now `iter_actionable_candidates`' entry authority on all four
routes, including the BRK15 variant. It is the first authorized kernel/entries change since
`068bb24a`.

**What the wiring changed, and what it deliberately did not.** The machine decides the GRANT;
the premarket plan gate, the location gate and the force gate are unchanged and are supplied to
it rather than re-implemented. The four pre-existing reason literals are byte-identical because
frozen custody artifacts pin them; `ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE` is new, because
Route D's accepted-break-retest form is a grant path the kernel did not previously have and
borrowing the repeat-test label would have put false evidence on a real entry.

**Instrument work, all landed:** the F-1 budget-faithful join (headline **1/8** at the amended 08:00 window; **5/8** at 09:30), the classifier-
bound agreement, the force receipt that can now actually disagree, the BRK15 mirror, the
enumeration guards, and the labels file committed into `research/`.

**Operator pack, landed:** `ALGO-RUNBOOK.md`, `ALGO-GPT-HANDOVER.md`, the kill-switch coverage
(0/7 → 7/7), and the refusal legibility table (28 codes).

---

## 4. What is NOT done, in the order I would do it

1. **The window amendment.** The operator's teaching moved his window to **8:00–12:00** with
   setups forming before 09:30. The hazard map is committed: 09:30 lives at ~30 code sites in
   **four distinct roles**, and the session-open **location anchor** (`kernel.py:132`, feeding
   `build_entry_locations_v24`) is a hardcoded literal. **Move ROLE 1 only.** A find-and-replace
   would silently change which S/R zones exist and invalidate every number.
   *I deferred this because the grader was live in the tree and changing its subject mid-grade
   would corrupt the grade.*
2. **Routes B/C/D in the new state machine.** Only Route A is built. §7 items 6–14 are waiting
   on them.
3. **The exam on the finished brain**, then FREEZE if it passes.
4. **Items 4 and 5 of ALGO-029:** the deployment path documented to the offline line, and the
   validation arsenal made runnable by single command. Both documentation-shaped; both PRIORITY 2.

---

## 5. Read these before you trust yourself

Every one is a conviction from this campaign, not general advice.

- **Instrument defects outnumbered strategy defects about four to one.** Four published numbers
  were wrong in two days and every one was the measuring tool. **Suspect the instrument first.**
- **A guard that reads prose convicts the sentence written to make the promise.** Five substring
  guards fired on their own docstrings. **Check the AST, never the text.**
- **A green check with no path to red is worthless.** The force receipt "verified" the kernel by
  calling the same pure function with identical arguments.
- **A hand-maintained list certifies only itself.** Derive populations; never type them.
- **A unit test on the inner object does not prove the outer path carries the value.**
- **A comparison is not an exoneration.** "Same failure count" hid five tests that had never run
  to completion on this machine.
- **A silent grader may have finished and failed to render.** Say *"no output received"*, never
  *"failed"*.
- **Enumerate before you commit.** I committed at "8 failed" without checking which eight.
- **Report to the advisor, never the operator.** No exempt category — status, progress and
  findings on screen are all reports. On screen is acknowledgement only.

---

## 6. Rails that do not bend

- **PR #38 DRAFT / DO NOT MERGE.**
- **No PnL, realized outcome or winner/loser label may pick a rule.** The ledger's `rPnL` is off
  limits for all semantic work.
- **Never edit** `research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json`.
- **Nothing connects to TopstepX** — not funded, not eval, not broker-paper — until the ladder
  finishes. No date overrides that.
- **Publish to `external-advisor/gpt-rulings-algo` via `scripts/publish_algo_report.sh`**, never
  to `gpt-rulings`. The script refuses rather than warns, because a misfiled report breaks the
  main campaign's control plane.
- **Diagnostics never import into the production namespace.**

---

## 7. The suite

`PYTHONPATH=. python -m pytest tests/ -q` — expect **7 failures**, all pre-existing and all
outside this lane (engine_final gold lifecycle, deepscan ×2, eligibility ×4). **A different
number means something changed; enumerate the `FAILED` lines before doing anything else.**
