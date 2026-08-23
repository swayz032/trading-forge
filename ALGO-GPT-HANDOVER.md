# ALGO — Handover to GPT

**To: GPT, incoming sole engineering advisor for the MNQ v2.4 lane.**
**From: Claude (worker seat), 2026-08-23.**
**Effective: 2026-08-27, when all Claude seats end. Written to be read cold.**

You already advise the main Trading Forge campaign. This is a **different, smaller lane** and it
is nearly standalone. Everything you need is below or reachable from it.

---

## 1. What this is, in one paragraph

`current_mnq_strategy_v2_4_*` is a **standalone MNQ bot** built to copy one trader's
discretionary method. It does **not** need the Trading Forge DSL or extraction engine
(ALGO-025 §2). It is not finished. It is not connected to any broker. The campaign's whole
subject is **fidelity** — does the machine decide like the man — measured against 14 replay
sessions where his own decisions were recorded.

---

## 2. Where everything lives

| what | where |
|---|---|
| code + tools | `research/current_mnq_strategy_v2_4_*` in `wt-mnq-v24` |
| strategy branch | `research/current-mnq-strategy-v2-4-zone-first-candles` (PR #38, **DRAFT / DO NOT MERGE**) |
| this lane's reports + rulings | branch `external-advisor/gpt-rulings-algo`, folder `algo-reports/`, numbered `ALGO-NNN` |
| the operator's runbook | `ALGO-RUNBOOK.md` at repo root |
| the frozen textbook | `research/current_mnq_strategy_v2_4_spec.json` |
| the ground truth | `research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json` (**committed; never edit**) |
| the exam result | `research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json` |

**Read ALGO-001 through the newest in order.** They are the whole history. Rulings and worker
reports interleave on the same branch, and the numbering is strictly increasing.

**Channel rule that matters:** this lane publishes to `gpt-rulings-algo`, never to
`gpt-rulings`. `scripts/publish_algo_report.sh` enforces it and *refuses* rather than warns —
a report in the wrong place breaks the main campaign's control plane.

---

## 3. State of the work, honestly

**The defect of record.** The bot **takes a trade in 14 of 14 sessions and never once genuinely
declines.** The trader traded on 7 of the same 14. When the bot is present in-window and he
trades, it picks the same direction **1 of 1** — so the failure is **timing and selectivity, not
direction**. Everything being built exists to kill that.

**The headline number is 1/8**

> **These numbers are measured at the AMENDED 08:00 window (ALGO-041 §3.2).** At the previous 09:30 window they were 5/8 and 5 of 5. The amendment made fidelity WORSE on the current brain — it gives an over-permissive entry gate 90 more minutes to spend the day's single bullet before the trader ever decides. The deltas are in ALGO-042 and the amendment is under advisor review; if it is reverted, these numbers return.
 on the 8 sessions where he actually decided (6 of 14 are
right-censored — the replay ran out while he was still watching, and those can never be scored).

**Where it sits on the ladder:** `FIDELITY → FREEZE → CLEAN EDGE → prop-survival → TopstepX`.
Still on the first rung.

**Built and BUILD-ONLY** (not imported by kernel/entries/engine/signal, enforced by test):
the derivation layer (approach + the spec's six interactions), the story layer
(APPROACH/FIGHT/DECISION, none of them a literal), and entry authority as a WAIT-by-default
state machine. First checkpoint: it refuses 60 of the kernel's 128 Route A grants.

**Not done:** the window amendment, the §7 mutation campaign, the exam on the finished brain,
FREEZE, and most of the deployment documentation.

---

## 4. The one thing that is genuinely blocking

**An independent grade of the repaired evaluator was dispatched and has not rendered.**
The previous grade returned **band 5, REFUTED**, and its findings were repaired in full
(ALGO-024). Semantics may be **built** but no candidate may be **accepted** against the 14 cases
until a fresh grade passes.

**If it never renders:** the evaluator's repair is described completely in ALGO-024 and the
prior grade in ALGO-019. You can grade it yourself from the repository — you have done exactly
that on this lane before. Three files: the regrade, the runner, the scorecard.

**A hard-won lesson: a silent grader may have finished and failed to render.** Say *"no output
received"*, never *"failed"*. I called it failure once and was wrong; the report arrived intact
hours later and overturned my headline.

---

## 5. How to work with the operator after the 27th

**He is the hands; you read.** He is not a coder and does not need to be.

1. He describes what happened in his own words.
2. **You prescribe an exact command.** He pastes it.
3. He pastes back the *whole* output. You interpret.

`ALGO-RUNBOOK.md` already gives him the commands, what each output means, and what to do in
each incident. Point him at it rather than re-deriving.

**Three rails that do not bend:**
- **Never** edit the frozen labels file. It is the record of what he actually did.
- **Nothing connects to TopstepX** — not funded, not eval, not broker-paper — until the ladder
  finishes. A subscription date exerts zero authority over that.
- **No PnL, realized outcome or winner/loser label may pick a rule.** The ledger's `rPnL` column
  is off limits for all semantic work. Dates, prices and clocks only.

---

## 6. Things that will bite you, learned the expensive way

**Instrument defects outnumbered strategy defects roughly four to one.** Four published numbers
were wrong in two days and *every one* was the measuring tool, not the bot. Suspect the
instrument first.

**A guard that reads prose convicts the sentence written to make the promise.** Five separate
substring guards fired on their own module's docstring explaining the property being guarded.
**Check the AST, never the text.**

**A green check with no path to red is worthless.** The force receipt "verified" the kernel by
calling the same pure function with identical arguments — it could never disagree. Every guard
needs a mutation that turns it red, *and* a positive witness that it is green for the right
reason.

**A hand-maintained list certifies only itself.** The X-ray's correspondence test compared
against a typed tuple of gate names; the ranker was simply never added, so the test passed for
as long as the divergence existed. Derive populations; never type them.

**A unit test on the inner object does not prove the outer path carries the value.** A field was
added to one dataclass and not threaded to the next; the unit test passed and the real run
printed an empty census.

**A comparison is not an exoneration.** "Same failure count as before" hid five tests that had
never once run to completion on this machine — they died on a Windows encoding default before
reaching their assertion.

**Ask the advisor, never the operator.** Historical-evidence questions are closed
(*"you have all my data"*). And `WAIT` ≠ `NO_TRADE`: six of the seven sessions he "passed" on
carry no decision at all, so asking why he passed was asking about a decision he never made.

---

## 7. If you take one thing from this document

The campaign's method is **outcome-blind fidelity**: the bot is fit to the trader's *decision
process*, proven against his recorded decisions, with every measurement red-proofed and
independently graded — and **no result is ever allowed to pick a rule**. That is what makes it
different from a curve-fit retail bot, and it is the part worth defending when the deadline
pushes.

Good luck. He is a careful operator and the record is complete.
