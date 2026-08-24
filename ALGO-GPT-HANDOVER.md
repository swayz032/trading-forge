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

**The defect of record, and its first measured movement.** The bot **used to take a trade in 14
of 14 sessions and never once genuinely decline** — an entry decision that is a constant, and
therefore carries no information. Everything built in this phase existed to kill that. After
ALGO-047's wiring of the entry authority into the kernel, and re-measured again at
`acceptance_bars = 3` with ALGO-068 R1 landed: **12 of 14, with two genuine in-window
declines.** (It read 13 of 14 with one decline at `acceptance_bars = 2` before R1 — a
superseded brain, not a different reading of this one.) The trader traded on 7 of the same 14. When the bot is
present in-window and he trades, it picks the same direction **1 of 1** — so the failure is
**timing and selectivity, not direction**.

**The headline number is 1/8, unchanged by the wiring** (it was 1/8 before).

> **These numbers are measured at the 08:00 window**, which ALGO-049 made the standing
> configuration: the ALGO-043 revert to 09:30 is WITHDRAWN and 08:00–12:00 is the unconditional
> deployment window. The 09:30 arm — where the frozen **5/8** lives — now runs as a
> RUN-CONFIGURATION of the dual-window exam rather than as a committed constant.

That 1/8 is on the 8 sessions where he actually decided (6 of 14 are right-censored — the replay
ran out while he was still watching, and those can never be scored). **Read the two together:
the constant is gone but the score did not improve, and one case moved to
`BOT_ONLY_ENTRY_UNCENSORED_DECLINE` — the bot taking an in-window trade the trader declined,
which is the unflattering direction.** Whether the brain refuses on the RIGHT sessions is the
dual-window exam's question under its own pre-registration, not a claim this packet makes.

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
