# ALGO — Handover to GPT

> **Standing state corrected on commit (2026-08-26).** Drafted at ladder head ALGO-100C
> `602318c5`; committed at ladder head **ALGO-100E `a553b59f`** (ALGO-100D landed the
> operator's volunteered target teaching and RE-OPENED the target layer; ALGO-100E published
> this handover to the channel). Strategy branch head at commit: **`abce4155`**
> (`6888112d` is the revert commit, no longer the head). The T3 batch referenced below
> is now **LANDED and its status is exactly `UNRATIFIED-FOR-FREEZE`** (ALGO-105). It may NOT
> be described anywhere as ratified, passing, or frozen.
>
> What that means in plain words: the batch (R2 + R2b + F1 + T3'') is on the branch at
> `da7f9d3d` and the suite is green, but **re-exam #3 returned FAIL and the freeze is BLOCKED**.
> It was NOT reverted, because nothing degraded - the deployed 08:00 arm is character-identical
> to before, the 09:30 arm GAINED two sessions against the frozen anchor, and the 04-14 control
> is identical by key and target. It was NOT frozen, because the exam's A3 makes a failing
> 08:00 arm block the freeze outright, and that arm was already 1/8 before this batch existed.
>
> **Nothing here is deployable and nothing trades real money.** The bot's remaining known
> defect at 08:00 is that it spends its one daily trade TOO EARLY. Measured on the frozen
> 14-case scorecard, stated only in numbers the scorecard supports:
>
> - it takes a trade at all in **12 of 14** sessions (he traded 7 of the same 14);
> - the single daily trade is spent **before the audited window even opens in 10 of 14**,
>   which makes every in-window entry in those sessions unreachable;
> - and of the **5** sessions where the bot traded *and* he entered - the only sessions where
>   the comparison is defined - the bot's first entry precedes his clock in **4**.
>
> **CORRECTED 2026-08-26.** These five documents all carried *"before the operator's own
> entry clock on 13 of 14 sessions"*. **No measurement supports 13.** It exceeds the 12
> sessions in which the bot trades at all, which is impossible - a bullet cannot be spent in
> a session with no trade. `ALGO-WORKER-SEAT-HANDOVER.md:45` records the likely origin: a
> superseded `13 of 14` from the brain at `acceptance_bars = 2`, before ALGO-068 R1 - already
> retracted there, and it had survived here verbatim in five headers.

**DO NOT RENAME OR MOVE THIS FILE.** Its accuracy guard,
`tests/test_algo_handover_is_accurate.py`, reads `ALGO-GPT-HANDOVER.md` **by path** and will fail
if it moves. That guard re-derives this document's load-bearing numbers from the measurement code
on every run — so **if a claim here goes stale, the suite goes red rather than the document going
quietly wrong.** Keep it that way: put numbers where the guard can check them.

**To: GPT, sole engineering advisor for the MNQ v2.4 lane from 2026-08-27.**
**From: the Claude worker seat, 2026-08-26.**
**Strategy branch: `research/current-mnq-strategy-v2-4-zone-first-candles`. Written to be read
cold.**

> **HOW TO GET THE CURRENT STATE — do not trust any commit SHA typed in this document.**
> Several are quoted below as the state *at the moment a section was written*, and they age the
> instant anything lands. **The live answer is always:**
>
> - **strategy head** → `git rev-parse --short HEAD` on the branch above;
> - **ladder head + the latest ruling** → `git fetch origin external-advisor/gpt-rulings-algo && git ls-tree --name-only -r FETCH_HEAD -- algo-reports/ | sort | tail -5`
>   (the `fetch` is load-bearing — without it you read whatever your clone last saw, which is a
>   stale answer that looks exactly like a current one);
> - **is this document's state still true?** → `pytest tests/test_algo_handover_is_accurate.py`.
>
> A SHA in prose is a timestamp, not a fact about now. **The ladder is the durable record**;
> this file is a map to it.

You already advise the main Trading Forge campaign. This is a **different, smaller, nearly
standalone lane**. Everything you need is below or reachable from it.

---

## 1. What this is, in one paragraph

`current_mnq_strategy_v2_4_*` is a **standalone MNQ bot** built to copy one trader's
discretionary method. It does not need the Trading Forge DSL or extraction engine (ALGO-025 §2).
It is not finished, it is not connected to any broker, and it must not be. The campaign's whole
subject is **fidelity** — does the machine decide like the man — measured against 14 replay
sessions in which his own decisions were recorded. **No realized outcome is ever allowed to pick
a rule.** That is what separates this from a curve-fit retail bot, and it is the part worth
defending when a deadline pushes.

### Where everything lives

| what | where |
|---|---|
| code + tools | `research/current_mnq_strategy_v2_4_*` in `wt-mnq-v24` |
| strategy branch | `research/current-mnq-strategy-v2-4-zone-first-candles` (PR #38, **DRAFT / DO NOT MERGE**) |
| this lane's reports + rulings | branch `external-advisor/gpt-rulings-algo`, folder `algo-reports/`, numbered `ALGO-NNN` |
| the operator's runbook | `ALGO-RUNBOOK.md` at repo root |
| the frozen textbook of the method | `research/current_mnq_strategy_v2_4_spec.json` |
| **the ground truth** | `research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json` — committed; **never edit the frozen labels** |
| the exam result (rewritten by every run) | `research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json` |
| the never-rewritten comparator | `research/current_mnq_strategy_v2_4_F2_ANCHOR_frozen_5of8_ea6f0940_IMMUTABLE.json`, hash-checked by `research/current_mnq_strategy_v2_4_f2_anchor.py` |
| publish tool | `scripts/publish_algo_report.sh` |
| stopping things / what is alive | `ALGO-KILL-AND-HEARTBEAT.md` |
| every status word translated | `ALGO-SELF-EXPLANATION-AUDIT.md` |
| cold-starting a future Claude seat | `ALGO-SEAT-HANDOFF-TEMPLATES.md` |

**Read ALGO-001 forward.** Rulings and worker reports interleave on one branch and the numbering
is strictly increasing. The subject lines are deliberately self-contained: `git log --format='%h %s'`
on that branch is a readable campaign history on its own.

---

## 2. Standing state as of ALGO-100C at `602318c5`

### 2.1 The revert executed, and the baseline reproduces

`6888112d` is the revert commit ordered by ALGO-100 §2: R2 + R2b + F1 out, `derivation.py` /
`force.py` / `independent_force.py` and the eight rewritten tests restored to `6d22524c` state,
the `(A,C)` overlap pin restored. **Acceptance met: the 40-approval baseline reproduces exactly
by key.** Kept across the revert: N0's capture fields, ALGO-096A's `UNFROZEN_CHOICES`, and every
artifact. Nothing was thrown away — only the semantic diff was.

### 2.2 The entry layer is CLOSED as a repair surface

ALGO-100 §3, and this is the most consequential structural finding of the campaign. On **both**
sides of R2c, everything the bot admits is **a taught rejection form on a live zone** — the 103
additions and the 26 survivors alike (26 = 10/3/4/3/6; `touch_and_reject` 21 + `prior_momentum`
5; zone states 15/5/4/2; **none broken**). Re-derived from rows at the advisor desk, independently
of the worker.

**There is nothing malformed left to refuse.** So a future entry-layer change requires **a NEW
TEACHING from the operator — never a new predicate over the same teachings.** If a future round
proposes another refusal predicate invented from the existing corpus, that is the thing this
clause exists to stop. Refusal-only predicates were formally retired as a repair class at
ALGO-094 after E1 turned five wrong-time trades into nine no-trades.

### 2.3 `FIRST_A_PLUS` is FAITHFUL — the selector idea is DEAD

ALGO-100 §4 opened a lane on the theory that `FIRST_A_PLUS` was a conjunct of the master equation
with no implementing predicate — the bullet being spent by `kernel.py:201-208` on rank
(BRK5 > BRK15 > REV) then quality/confluence, then clock order. **S1 refuted that at ALGO-100B
and the advisor desk ratified the refutation against itself.**

**There is no taught ranking. "First A+ only" IS the teaching**, confirmed in `video_evidence`
and re-read at the line. `kernel.py:201-208` is **faithful**. The A+ selector order is WITHDRAWN
and the selector concept is **DEAD** — it was an invented comparative the teachings do not
contain. ALGO-100 §6c's "A+ implemented as first = defect" framing was retracted by its own
author. Do not reopen it without a new teaching.

The unbuilt piece was never a ranking. It was **one taught gate the code had lost**.

### 2.4 The live lane: T3

**T3 = "touch with mixed/doji control → WAIT_OR_NO_TRADE."** It comes from `video_evidence`
Explicit refusals, verbatim, and from the onboarding line *"a doji reclaim alone is not A+"*.
Until this round it was implemented **only** by the untaught fractions `0.62` / `0.78` and
`0.30` / `0.40` — which R2/R2b rightly retired and **wrongly replaced with nothing**. That hole
is the whole 40 → 143 over-admission. Form was never where T3 lived; **control QUALITY was** —
which is why ALGO-099 §2c stands.

**Formalized at `abce4155`, magnitude-free, and RATIFIED EXACTLY AS COMMITTED by ALGO-100C:**

> **MIXED** = body < upper wick **AND** body < lower wick
> **∨ NO_DIRECTIONAL_CONTROL** = close fails past the bar's own midpoint
> — completed story bar only, **OHLC vs OHLC, no constant.**

Two rulings from ALGO-100C worth carrying:

- **The desk's own `C1 ∨ C2` suggestion was REFUTED by the worker on teaching grounds before any
  measurement**: C1 implies C2 so the disjunction collapses, and C2 refuses the **HAMMER** — the
  archetypal rejection candle `_rejection_wick` exists to accept. ALGO-100B §3.1's "C1vC2
  arguable" was withdrawn as advisor error. *The pre-commit sequencing is what made that error
  cheap.*
- **The midpoint is RULED NOT A MAGNITUDE**: it is the bar's own geometric centre — no free
  parameter, no search range, unlike the retired `close_loc` 0.78 over the range (0.72, 0.84).
  The packet owes a provenance line and the tie convention: **close exactly at midpoint REFUSES.**

**Red-proof baseline AMENDED, and the reason is the round's best evidence:** RED at the reverted
head `6888112d` is **unachievable**, because the retired magnitudes are still doing T3's job
there. The baseline is the **BATCH head**, with `6888112d` kept as a third column where two rows
fail correctly. Red-proofs are at `b7227259`, whose own subject states it: *"THE RED-PROOF HEAD
IS THE BATCH STATE, not the reverted head."* The four-row table (DOJI/MIXED complete at the batch
head = the hole; HAMMER and CLEAN thin-wick pass) re-derives S1's conclusion from **fixtures
instead of citations** — a third independent path.

**Landing as ONE batch:** R2 + R2b + F1 byte-identical from history + T3 at the story control
step + the four ALGO-100A instrument fixes F-1…F-4. **R2c is NOT in the batch.** The batch commit
is `9434e22d`.

**Pre-registration, conjunctive** (ALGO-100B §4, amended by ALGO-100C §3.4):
the bullet lands on his 03-24 09:32 key `…96923`, with the eight earlier same-day approvals'
T3 verdicts published; 04-09 `…100322@11:37` is a **SURVIVES-TO-RANKING** test (approval
reported, never required) — because T3 refuses and can never *create* an approval; control key
kept; no AGREEing anchor day lost; membership against both 40 and 143 at both pins; sessions
silenced ZERO; no uncited number; suite + mutation green. **If the teaching-committed T3 kills
either hit, the lane closes HONEST-PARTIAL** and the one reserved-class ask goes to the operator
— a live demonstration, never a fraction re-fit.

**ALGO-101 rules the packet.** Then re-exam #3, then the FREEZE path per ALGO-029.

### 2.5 The census that corroborates it, independently

S2's selection census at `62722a2a` (143 by-key control PASS): on **six of seven** entry days the
bot's first approval precedes his clock by **80–187 minutes**, with 4–26 approvals per session.
On **04-14 — the one day it agrees — the session has exactly ONE approval and it is his.**

**This is over-admission, not mis-selection.** S1 (from teachings) and S2 (from rows) converge on
that independently, which is why the T3 lane is the right one.

Two instrument rulings inside it: S2's 04-09 section is a **TRUNCATED INSTRUMENT** and not
comparable — it ran the X-ray at `as_of = replay_end = his 11:35 clock` and saw zero, where
`ct_after_0800` measures 89 candidates and the 11:37 survivor. **The canonical surface is the
full-session run**: `replay_end` is a property of the labelling session, not of the market.

### 2.6 The numbers, as they stand

Measured at the current head, from the committed scorecard and
`research/current_mnq_strategy_v2_4_bot_entry_rate.py`:

| | |
|---|---|
| agreement on decided cases | **1/8** — the headline fidelity number |
| right-censored, excluded from both halves | 6 of 14 (the replay ran out before he decided) |
| bot traded at all in the session | **12 of 14**; he traded 7 of the same 14 |
| bot entered in-window / genuinely declined / unavailable | 2 / 2 / 10 |
| direction agreement when both entered | **1 of 1**; opposite direction at a decision: **0** |
| sessions whose bullet was spent before the window | 10 of 14, hiding 8 unreachable in-window entries |

**Read those together.** The bot used to enter in 14 of 14 and decline in 0 — an entry decision
that was a constant and therefore carried no information at all. ALGO-047's wiring killed the
constant: it now genuinely stands aside. **But the score did not improve**, and one case moved to
`BOT_ONLY_ENTRY_UNCENSORED_DECLINE` — the bot taking an in-window trade he declined, which is
the unflattering direction and is published as such. The failure is **timing and over-eagerness,
not direction.**

One diagnostic sits in the scorecard, unadopted, and it is yours to rule on: censoring is
asymmetric — trader-side non-decision is excluded from both numerator and denominator, bot-side
non-decision counts as a disagreement. Symmetric censoring would read **1/4**. It was not adopted
because *it raises the fidelity number, and a party may not adopt the reading that flatters it.*
That is an ALGO question, not a worker decision.

### 2.7 The EDGE lane

Advisor-owned, **firewalled from fidelity**, multi-year backtest in flight. It may not touch any
fidelity decision, and nothing it produces may enter the entry layer. It exists so that when
FREEZE completes there is already an out-of-sample read waiting — not so that it can inform the
brain. If an edge result ever appears in a fidelity argument, that argument is void by §4 rail 1.

### 2.8 The independent grade

ALGO-100A: **BAND 7, VERIFIED**, scoped to the 14-session corpus at both arm pins plus the guard
artifacts at `62722a2a` and `7d42d121`. 13 claims, 11 confirmed. The headline is **Path B**: the
grader re-ran the capture instrument itself and reproduced the entire 111-row R2c result
**identical by key and target** across 14/14 sessions, and independently closed the packet's open
sub-table with the same numbers *before* seeing the worker's closure — two independent
productions, one of them the grader's own.

Two literal refutations, neither moving a number (claim 8's "same script at two commits" is false
for the R2c arm — 5-field vs 13-field instrument versions; claim 10's D5-pin attribution is
wrong). Four instrument findings F-1…F-4, all routed into the S3 re-land, **none reopening the
revert or ALGO-100's decisions**. Band 7 is the ceiling claimed: suite, mutation battery and
grant matrix were not re-run, and the 09:30 R2c arm is unmeasured.

---

## 3. How the channel works

### 3.1 Publish first, then message

Publish the artifact, **then** tell the peer the filename and SHA. Monitors and ears are retired
on this lane; the ladder is the durable record. A message describing an unpublished file is a
request for trust, not a report.

### 3.2 The three separations — and why a subfolder is not one

| | ALGO lane | main Trading Forge |
|---|---|---|
| **branch** | `external-advisor/gpt-rulings-algo` | `external-advisor/gpt-rulings` |
| **directory** | `algo-reports/` | `advisor-reports/` |
| **numbering** | `ALGO-NNN` | `AR-NNNN` |

This lane publishes to `gpt-rulings-algo`, **never to** `gpt-rulings`. The reason is measured:
the main control plane takes the newest `advisor-reports/*.md` on its branch as the authorizing
ruling, and `bootstrap.mjs` filters with `startsWith('advisor-reports/')` — **which matches
subdirectories.** An algo file under `advisor-reports/algo/` would become the head commit's only
ruling and break the main campaign's control-plane seat with `stale_authority`. The obvious
separation was a subfolder, and the subfolder was the bug.

`scripts/publish_algo_report.sh` enforces all three layers and **refuses** rather than warns.

### 3.3 The publish script's three traps

1. **It takes the published name from the LOCAL file's basename.** Name the local file fully —
   `ALGO-NNN-WHAT-IT-DECIDES-YYYY-MM-DD.md` — before publishing. `ALGO-097.md` was published as
   exactly that and needed a rename commit (`ae717ae8`) to fix.
2. **There is NO number-collision guard.** Fetch and `git ls-tree --name-only
   origin/external-advisor/gpt-rulings-algo:algo-reports/` first. ALGO-026, ALGO-039 and
   ALGO-043 all carry collision scars.
3. **Publish from a SHORT directory.** From a deep scratchpad path, `git hash-object` dies on
   Windows with `Filename too long`.

### 3.4 What a ruling owes

Pin the head SHA it rules on. Separate MEASURED / ARTIFACT-SOURCED / RELAYED. **Pre-register
acceptance criteria before results exist** — criteria before candidates, and pre-commit to NONE
being acceptable. Decide **land-or-close** in the same ruling the report lands; drifting lanes
are the pace failure this desk was convicted of (ALGO-094). Never "N of M" unless every M can be
named from a committed doc. End with the no-PnL line.

---

## 4. How to instruct the operator

**He is the hands; you read.** He is not a coder and does not need to become one.

1. He describes what happened in his own words.
2. **You prescribe an exact command**, copy-pasteable, no placeholders he has to fill in.
3. He pastes back the whole output. **You** interpret it.

`ALGO-RUNBOOK.md` already holds the commands, what each output means, and the incident actions in
his own words. Point him at a section number rather than re-deriving. Its §4 gives him five
checks to apply to any command you send; commands that pass those five will not stall.

### Two things you must never ask him

- **Never ask about replay markings** — any line, marked time, timestamp, or the 2025 tape.
  Operator order **ALGO-083**: he cannot remember them, has said so repeatedly, and the whole
  collection is CLOSED. The labels are **day-level scoring references, not precision ground
  truth**. Tick and minute-level label forensics are DONE and void. If a band is underivable,
  use the line, record that you did, and move on. *Rough data is a worse parameter source, not a
  licence to fit.*
- **Never ask for historical decision evidence** — why he passed on some day, what he was
  thinking months ago. **ALGO-022**: *"you have all my data."* Everything knowable is in the
  repository. Also: `WAIT` ≠ `NO_TRADE` — six of the seven sessions he "passed" carry no decision
  at all, so asking why he passed asks about a decision he never made.

### What IS reserved to him

Only three classes: **a fact about his own intent that no artifact records**; **real capital,
spend, and irreversibly destructive decisions**; and **a NEW TEACHING demonstration** — the one
ask §2.4 authorizes if T3 kills a required hit. Everything else is yours to decide. He retired
the question channel: *"you have an advisor for the rest of your questions."*

### His vocabulary — use it

He trades **key level zones / support and resistance**. Never say "supply and demand." A zone is
a **band**, from the top of the rejection wick to that candle's close. A **rejection** is a
rejection wick — a candle that does **not** break the level. `body_frac` and `close_loc` were
never his (ALGO-071/073). And when a construction cannot be reproduced the way he draws it:
*"if it can't draw things like me it can do it in a computer way"* — the equivalence that matters
is **of TRADES, not of drawings**. A cited machine-checkable predicate is a legitimate stand-in
for his eye; never stall a repair on "cannot reproduce his construction."

---

## 5. The standing rails, each with its ruling

None of these bend, and no deadline has authority over any of them.

| # | rail | ruling |
|---|---|---|
| 1 | **No PnL, realized outcome, winner/loser label or clean-edge result may participate in ANY fidelity decision.** The ledger's `rPnL` column is **off limits** for all semantic work. Dates, prices and clocks only. | standing; restated in every ruling's closing line |
| 2 | **No number without a teaching citation.** A magnitude with no taught sentence behind it is a number somebody chose. When you remove an untaught magnitude, ask what taught sentence it was accidentally carrying, and re-supply that sentence before the diff lands. | ALGO-100B (minted as the round's LAW) |
| 3 | **Nothing from the 2026 labels sets a parameter.** They are day-level scoring references only. No band, no threshold, no clock is derived from them. | ALGO-083 |
| 4 | **NOTHING connects to TopstepX — not funded, not eval, not broker-paper — before FIDELITY → FREEZE → CLEAN EDGE → prop-survival.** In code at `research/current_mnq_strategy_v2_4_topstepx_prior_art.py:87-91`: *"A subscription expiry date exerts ZERO authority over this ladder."* | ALGO-025 §2, ALGO-026 §3 |
| 5 | **The frozen labels are never edited.** `research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json` is the record of what he actually did. | standing, ALGO-007 |
| 6 | **17.25-point stop; one bullet per day; 08:00–12:00 window.** Hard limits in code, not suggestions. 08:00–12:00 is the unconditional deployment window; the 09:30 revert is WITHDRAWN and 09:30 now runs only as a run-configuration of the dual-window exam. | ALGO-049; ALGO-043's pre-registered rule (the 08:00 arm degrading IS the early-entry defect — the window does not move) |
| 7 | **Doer ≠ grader.** Completed instrument work gets an independent adversarial grade with the brief DISPROVE. The worker self-dispatches it; rule from the receipt. | standing; ALGO-100A is the current example |
| 8 | **Every claim carries an evidence grade** — MEASURED (you ran it, at a named SHA), ARTIFACT-SOURCED, or RELAYED. Re-measure red paths every round; prove a fix with the **unchanged** convicting instrument. | standing |
| 9 | **The entry layer is closed as a repair surface.** New entry semantics require a NEW TEACHING, never a new predicate. | ALGO-100 §3 |
| 10 | **PR #38 is DRAFT / DO NOT MERGE.** | standing since ALGO-001 |

---

## 6. The open queue, with contracts

### What "DONE" means — the ALGO-029 §1 checklist

The operator's order was *"the bot has to be done already."* DONE is this checklist, not a
feeling:

| # | item | contract | state 2026-08-26 |
|---|---|---|---|
| 1 | **Strategy brain code-complete** | the ALGO-009 §3/§6 four-route entry-authority state machine with the derivation layer computed from price (nothing self-attested), the 08:00–12:00 window amendment folded in (ROLE-1 + deliberate ROLE-3; the ROLE-2 anchor untouched), full §7 mutation campaign green | **in flight** — the S3 batch is the current attempt; ALGO-101 rules it |
| 2 | **Fidelity exam run on the finished brain**, honest published numbers; **if it passes → FREEZE executed**, hash-pinned, on the record | re-exam #3 only after a ratified landing | **not reached.** Its PASS is an empirical outcome, the one item effort cannot force |
| 3 | **Safety core proven offline** | FakeSession flatten / cancel / position tests green | **done** — 7 of 7 safety-critical broker methods covered, up from 0 |
| 4 | **Deployment path finished to the offline line** | ProjectX adapter verified at request-shaping; the credentialed shakedown and connection procedure written as **RUN-ONLY** steps, executed post-sunset by operator + GPT after FREEZE and clean edge — never now | **partial**; the run-only write-up is the gap |
| 5 | **Validation arsenal runnable by single command** | assess in-family prior art, deliver run-only invocations + plain-English readouts. **No new arsenal is authored — reuse and document** | **answered honestly and NOT met**: `current_mnq_strategy_v2_4_validation_arsenal` reports 5 tools, 2 runnable, 1 with an entry point. The family is libraries, not commands; the entry points do not exist. Same shape as the no-start-command finding |
| 6 | **The self-sufficiency pack complete** (ALGO-026 P1) | runbook, self-explanation audit, kill+heartbeat, this handover, seat handovers | **this pack** — all five drafted |

**If item 2 still refuses when the work is otherwise complete**, ALGO-028 §3.2 governs: park
code-complete, run-only, resumable. That is the fallback of record, not the plan.

### GPT'S FIRST TASK — the zone band shape is **RULED AND UNBUILT**

**This is not a proposal and it is not a threshold question. It was ruled, verified against the
operator's own demonstration, and never reached the code.** ALGO-109 §"the item that outranks
everything left".

> ### THE WHOLE TASK, IN ONE SENTENCE
>
> **`levels.py:149` centres the band on a PIVOT PRICE; the ruled band needs the REJECTION
> CANDLE'S OWN wick extreme and close — so the work is to JOIN each pivot back to its source bar
> on the marked timeframe. THE JOIN IS THE TASK; THE ARITHMETIC IS TRIVIAL.**
>
> Read that before the rest of this section. Everything below is the citation trail, the scope,
> and the measurement obligations — but if you only take one line, take that one. Placed here by
> ALGO-111's order.

**DO THIS ONE FIRST, AND ALONE — the order is ruled (ALGO-111 ask 1).** The exceptional-swing
path (`levels.py:149`) comes **before** the established path (`engine.py:492-496`), for two
reasons: doing both at once makes the displacement delta **unattributable** between them, which
ALGO-109 forbids; and the exceptional path's magnitudes are at least **declared**, so a change
there is auditable against a written surface today, while the established path carries four
magnitudes declared **nowhere**. *You do not rebuild on the foundation you have not surveyed.*

**AND THE ESTABLISHED PATH HAS A PRECONDITION, NOT A PARALLEL TASK (ALGO-111 ask 2).** Before
anything is built on `engine.py:492-496`, its `0.20 / 0.80 / 0.05 / 0.30` get **their own
provenance pass** — the AST sweep, M1's citation-status discipline, and a **mandatory positive
control** (a bare-number corpus search without one reported *6 of 10 cited* when the truth was
*0 of 10*; see trap 20 and ALGO-110 §3).

**THE RULE (ALGO-073 §2, from his own words in ALGO-073 §1):**

> *"i take a key zone with a wick and i draw the zone from the top of the wick to where the
> xandle closed"*
>
> **Zone = `[wick extreme, close]` of the rejection candle that defines the key level**, on the
> timeframe he marks it (**5m or 15m only** — 30m was a cross-teacher error).
> **Resistance:** top of the upper wick down to that candle's close. **Support:** the mirror.
> The width is **whatever that candle's wick-to-close IS** — *no magnitude is added by anyone.*

**VERIFIED (ALGO-089 §3)** against his volunteered zone-marking demo: `[wick extreme, close]`
matches to **0.59 / 0.60 pts on both edges**; the rival "band above the wick" reading is
**refuted at 18.97 pts**. The `~4–32 pt` pinned screenshot spans **corroborate** the stated rule;
they are not its source (ALGO-073 §1).

**WHAT THE CODE ACTUALLY DOES — three constructions, none of them his:**

| # | construction | site | untaught magnitudes |
|---|---|---|---|
| 1 | **symmetric** `center ± max(4 ticks, 0.06 × ATR)` | **`levels.py:149`** (exceptional single-swing path) | `key_level_pad_atr 0.06`, `4 ticks` |
| 2 | **quantile spread** `[Q20, Q80]` of rejection prices `± max(TICK, 0.05 × med_atr)` | **`engine.py:492-496`** (established multi-rejection path) | `0.20`, `0.80`, `0.05` — **declared in NEITHER the spec NOR `PARAMETER_REGISTRY`** |
| 3 | symmetric pad around PDH/PDL/PWH/PWL | `engine.py:585` (`make_key_locations`) | same pad — **but those families have no entry authority**, so this is context only |

`TICK = 0.25`, so #1's floor is **1.0 pt half-width / 2.0 pts full** — **narrower than the
narrowest band anyone measured**, and the wrong *shape* regardless of width. **Symmetric-around-a-
price and asymmetric-wick-to-close are different objects, not different calibrations.**

**WHY IT OUTRANKS THE REST OF M1.** It is already ruled, so no derivation is owed. It introduces
**no** number, so `anti_overfit.no_threshold_search` does not block it. And band geometry
propagates into **the map, the touch test, the fill displacement and the destination ladder** —
ALGO-102 measured the map admitting a **median 64 locations per session**.

**THE JOIN, in detail — and it ALREADY EXISTS in this file.** (The one-sentence version is at the
top of this section.)

`levels.py:149` builds `lo, hi = center ± half` from `center = float(row.price)`. `row` comes from
the pivot frame, whose columns are asserted at **`levels.py:116`**:
`{"t", "confirm", "side", "price", "wick", "disp", "atr"}` — **no OHLC**. So the rejection
candle's wick extreme and close are not in the frame and must be fetched.

**`_pivot_close_away` (`levels.py:76-86`) already performs exactly that fetch**, and it already
reads **exactly the two prices the ruled band needs**:

```python
bar = h15.loc[row.t]
if isinstance(bar, pd.DataFrame):
    bar = bar.iloc[0]                    # a duplicated index would silently pick one
if row.side == "S":  ... bar.close, bar.low     # support: low wick extreme -> close
else:                ... bar.high, bar.close    # resistance: high wick extreme -> close
```

**Follow this function; do not invent a second join.** It has the timeframe (`h15`), the lookup
key (`row.t`), the duplicate-index guard, and the **side mirror already correct** — `S` takes the
low, `R` takes the high, both against the close. It currently turns those two prices into a
*fraction*; the band needs them as **the two band edges**. That is the whole change.

> ### ⚠ HARD REQUIREMENT — THE BAND EDGE MAY NOT INHERIT THE FALLBACK
>
> **ALGO-113, verbatim and binding.** `_pivot_close_away` ends `except Exception: return 0.5` —
> **acceptable for a quality score, UNACCEPTABLE for a band edge**, because a failed join there
> yields **a plausible zone unrelated to the candle that drew it** and **nothing goes red.**
>
> **The band build must FAIL LOUDLY — raise, or emit an explicit refusal literal. It may not
> inherit the fallback, and it may not be silently absent.**
>
> This is not style. A `0.5` that reaches a quality score costs you a slightly wrong rank; a
> defaulted band edge **admits a location the operator never drew**, at a price nothing in the
> pipeline can distinguish from a real one — and the whole campaign is a fidelity argument.

**MANDATORY, from ALGO-108 §1 — this change ADMITS, so it will DISPLACE.** Report membership
**per route** and audit **every removal** for a same-bucket higher-ranked addition
(`kernel.py:205`). A band change that "reduced the flood" by displacing his own Route A entries is
a **failure** that a count reports as a success. Control `04-14 09:38 L BRK5 → 25869.0` by key
**and** target, both pins, plus zero sessions silenced.

**Fifth time this ladder has found a ruled clause that never reached the code.** State it that way.

### Named open items

- **`V24_TARGET_DISTANCE_LT_REACTION_CONTACT` — the engine CRASHES instead of declining.**
  `target_policy.py:157-161`, `classify_first_reaction_destination`. A strict inequality
  rejects a sub-tick difference (`23.5000 < 23.5640`, 0.064 pt) by RAISING. Reproduced on
  session **2023-04-03**; 1 occurrence in 317 out-of-sample days. **Unattended-run hazard:** a
  raise HALTS the process rather than declining the trade. **Measurement hazard:** a crashed
  session is not a no-trade decision — any census must journal it as `engine_refused` and
  exclude it from the no-trade bucket. NOT fixed: the strategy was frozen when it was found.

- **ALGO-101** — rules the S3 batch (`9434e22d`) against its conjunctive pre-registration. The
  next thing that happens on this lane.
- **F-1 reason chain** — after F1's removal, `PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` labels a
  clause that cannot refuse. MOOT at `6888112d`, **BINDS the re-land**. The printed reason must
  always be the clause that actually refused.
- **F-2 AST no-fraction scan** — R2c's guard scans only the LONG branch's physical line. Binds
  `7d42d121` if R2c ever returns.
- **The 04-09 named finding** — which layer refuses that LONG after ranking, with its executable
  line, TP1 and dollar display at 15 contracts, plus why the SHORT on the same zone at 11:27/11:28
  approved. Does **not** gate the batch.
- **`TAUGHT_SHAPE_UNTAUGHT_GATE` inventory** — 2 remained at the 08-24 verified run. Whether each
  survives the re-land is campaign work.
- **The wider status-literal sweep** — `ALGO-SELF-EXPLANATION-AUDIT.md` §11 names it.
- **The heartbeat build decision** — `ALGO-KILL-AND-HEARTBEAT.md` §6 offers two honest minimal designs.
  Nothing is built; nothing needs to be until a runtime exists.

---

## 7. METHOD — the two techniques that found almost everything. Read before any strategy content.

**ALGO-115 put this ahead of the trap list and ahead of the strategy sections, and this is the
campaign's closing position on method:**

> ### THE STRATEGY IS BETTER MEASURED THAN THE THINGS MEASURING IT.

**Five of the last six defects found on this lane were in INSTRUMENTS, not in the bot.** Every
semantic finding survived adversarial grading; the measuring tools did not. The stale F2 anchor
pin · the typed-list path guard · a filter written from the fixed spelling · a claim searched
file-wide instead of where it lives · and a number that five documents asserted and no guard ever
examined. **Suspect the instrument first — it is where the remaining risk lives.**

**Exactly two techniques found that class. Nothing else did.**

### 7.1 A MUTATION BATTERY THAT PLANTS THE *ORIGINAL* DEFECT

Every guard that closes a finding gets a battery — **no exceptions** (ALGO-115). Plant defects,
confirm each goes **RED**, restore **byte-exact** and verify by `sha256`. Compare failure sets by
**MEMBERSHIP**, never by count.

**And plant the ORIGINAL defect, never one of your choosing.** Repairing three pointers that had
lost their `ALGO-` prefix — the sunset docs named the kill/heartbeat, self-explanation and
seat-handoff files without it — I wrote the new guard's filter as `tok.startswith("ALGO-")`.
**The bug IS the missing prefix**, so the filter excluded the exact case the guard existed for and
the planted original went **green**.

*(The broken spellings are described here rather than quoted in backticks: the path guard reads
backticked tokens as claims, so quoting a dead pointer to illustrate it would make this document
fail its own check. It caught exactly that when this section was first written — which is the
cheapest possible demonstration that the guard works.)*

> **A GUARD WHOSE FILTER IS WRITTEN FROM THE FIXED SPELLING CANNOT SEE THE BROKEN ONE.**
> A detector written while looking at corrected text inherits the correction.

Two more from the same battery, both green-while-testing-nothing:

- **A claim satisfiable by a coincidental match elsewhere in the file is not being checked where
  it matters.** A guard asserting `**12 of 14**` appears in a document survived deletion of the
  entire claim, because that string also occurs in an unrelated sentence further down. Scope the
  assertion to the block that must carry it.
- **A join defined over "what still agrees" cannot see the thing that stopped agreeing.** The
  first path join checked only paths appearing in ≥2 documents; breaking one in a single document
  removed it from the shared set and went green. **Divergence hid itself from the guard.**

Ask not *"did it pass"* but **"what edit makes this red, and have I made it?"**

### 7.2 A COLD READ BY SOMEONE WHO HAS NOT SEEN THE WORK

**Read the document as if you had never seen this campaign, and fix whatever you cannot follow.**
Automated checks agree with each other; only an outside reading disagrees with all of them.

It is the only thing that found: three dead pointers in the map section (one inside the
**stop-everything** procedure); commands printed in a syntax that **fails in PowerShell every
time**, documented as a conditional (*"if PowerShell objects"*) when it always objects; and a
headline number that was **arithmetically impossible** — 13 sessions of a thing that can happen in
at most 12 — asserted identically in five documents and already retracted in a sixth.

> **A FAILURE THAT HAPPENS EVERY TIME MAY NOT BE DOCUMENTED AS A CONDITION. If it always fires,
> it IS the instruction.** (ALGO-115)

**Two cheap habits from that read, worth more than their cost:**

1. **Check published numbers for the inequality they must satisfy.** `spent_early ≤ traded_at_all`
   killed the wrong number with one subtraction and **no ground truth at all**.
2. **Duplicated prose has no owner.** If text must appear in N places, **a test must assert the N
   copies agree** — `tests/test_algo_sunset_docs_agree.py` is that test for these five documents,
   and it names its own blind spots.

---

## 8. The instrument traps a future seat WILL hit

Every one of these cost a retraction on this lane. **Instrument defects have outnumbered strategy
defects roughly four to one** — four published numbers were wrong in two days and *every one* was
the measuring tool, not the bot. **Suspect the instrument first.**

1. **A gate label is not a sub-reason.** `FORCE_NOT_CONFIRMED` is a family name; the sub-reason
   lives beside it. X-ray records carry `force_reason` — read that. ALGO-095 attributed a whole
   round to `force.py:123` on the label alone and was refuted at ALGO-096.
2. **An evaluation order is not a causal order.** "Route A never reaches `_control`" was the
   X-ray asking force first (`candidate_xray.py:190-228`), not the strategy refusing there. With
   force forced true, the story gate binds. This one misdirected an entire round.
3. **Report by KEY, never the majority literal, and never a raw count.** On 04-06 a single
   `_control` refusal sat behind 44 no-touch records and the modal literal hid it. Trace counts
   are **location-multiplied** — 63/34/4 were ONE distinct evaluation each. And the fix has its
   own trap: **deepest-gate-BY-KEY breaks ties arbitrarily** and hid the changed key at 04-09
   (F-4). Report **all** keys at maximum depth.
4. **Text-vs-instant timestamp joins.** Two timestamps that print identically can be different
   objects; a re-pasted read carries no timestamp of its own. Join on two verbatim strings, and
   remember `SIGNAL_ASOF_MUST_BE_TZ_AWARE` exists because naive datetimes reached production once.
5. **CRLF phantom diffs on Windows.** A diff that looks enormous and semantically empty is a line
   ending. Check before believing a landed change is larger than the reviewed one.
6. **`git stash list` reads EMPTY while a pre-commit hook is stashing.** Only the commit's own
   stdout tells the truth. The grader is a writer too — fix at source, in an isolated checkout.
7. **A completion signal is not a result.** Check the artifact, not the exit code. This appeared
   twice inside a single grade (F-5). Related and equally expensive: **a silent grader may have
   finished and not rendered** — say **"no output received"**, never **"failed"**. That call was
   made wrongly once here; the report arrived intact hours later and overturned the headline.
8. **Check the AST, never the text.** Five substring guards fired on their own module's docstring
   explaining the property being guarded. A guard that reads prose convicts the sentence written
   to make the promise.
9. **A green check with no path to red is worthless.** The force receipt "verified" the kernel by
   calling the same pure function with identical arguments — it could never disagree. Every guard
   needs a mutation that turns it red **and** a positive witness that it is green for the right
   reason.
10. **A hand-maintained list certifies only itself.** The X-ray's correspondence test compared
    against a typed tuple of gate names; the ranker was never added, so it passed for as long as
    the divergence existed. **Derive populations; never type them.**
11. **A comparison is not an exoneration.** "Same failure count as before" hid five tests that had
    never once run to completion on this machine — they died on a Windows encoding default before
    reaching their assertion.
12. **A unit test on the inner object does not prove the outer path carries the value.** A field
    added to one dataclass and not threaded to the next: unit test green, real run printed an
    empty census.
13. **A CLI is only proven by running the CLI.** `evidence_eras` was documented in the runbook and
    crashed with `KeyError`; every unit test passed because they all called `measure()` and none
    called `main()`. `tests/test_algo_runbook_commands_actually_run.py` exists because of this.
14. **A truncated instrument is not a null result.** Running the X-ray at `as_of = replay_end`
    showed zero candidates where the full-session surface has 89. An absence claim needs a
    positive control **in the right surface**.
15. **Closing one instance is not closing the condition.** Name the mechanism, ask what the
    enumeration over it is, and whether you ran it. No enumeration ⇒ say "one instance closed."
16. **A proof about a PREDICATE does not transfer to the PIPELINE that contains it.** B1 was
    proved — algebraically and over 400k random bars, zero counterexamples — to be incapable of
    refusing anything the retired fractions accepted. It removed **eleven** approvals anyway,
    **11 of 11** same-bucket rank displacements of a route it never evaluates. Anything that
    **SELECTS** — a ranker, a `max`, a one-per-bucket budget — turns an addition into a removal
    somewhere else. The scoped claim ("can only ADD") stayed *true* and silently licensed a
    system claim. **Audit every removal for a same-bucket higher-ranked addition and label it
    DISPLACEMENT, not refusal.** ALGO-108 §1; law minted at ALGO-109.
17. **ONE DOOR PER ROUTE — a story refusal does not close a bucket.** T3′′ refused `03-24 08:12
    S REV` at the story layer; the *same clock, same direction* returned as `08:12 S BRK5`
    through the break family and outranked it. **Scoped form, because the absolute is false
    (ALGO-109 ask 2):** *a story refusal is effective only at buckets where no higher-ranked
    route also qualifies.* At 08:00 a break route qualified and the refusal was nullified; at
    09:30 none did and the same clause recovered two sessions. Both measured.
18. **REPORT MEMBERSHIP PER ROUTE, always.** Ordered at ALGO-109 ask 1. Because of #16, every
    earlier Route A before/after silently carries break-family coupling — `40 → 143 → 91 → 107`
    were never pure story-layer effects. Those deltas are **RE-LABELLED, not retracted**: every
    load-bearing conclusion is a **per-key** statement, and per-key statements are immune to a
    coupling that moves totals. A bare total is now an incomplete report.
19. **The route precedence itself is UNTAUGHT.** `rank = {"BRK5": 3, "BRK15": 2, "REV": 1}` at
    `kernel.py:205` has **no teaching citation in five named surfaces** (ALGO-109). It decides
    which trade takes the one bullet whenever two routes qualify at one bucket, and it is the
    `FIRST_A_PLUS` machinery ALGO-099 found unimplemented. **NAMED, NOT OPENED** — a rank change
    without a guard would silently rewrite every bullet in the corpus.
20. **Deriving from the declaring surface is not deriving from the code.** The M1 magnitude set
    is walked out of the loaded spec and is **a floor, not a total**: the established-zone band
    (`engine.py:492-496`) uses `0.20`, `0.80` and `0.05`, declared in **neither** the spec **nor**
    `PARAMETER_REGISTRY`. "The set is DERIVED" reads as complete when it is only well-sourced.
    An AST sweep of the call path for bare literals is the honest instrument.

---

## 9. If you take one thing from this document

The method is **outcome-blind fidelity**: the bot is fit to the trader's *decision process*,
proven against his recorded decisions, every measurement red-proofed and independently graded,
and **no result is ever allowed to pick a rule.**

The single best procedural lesson of the final rounds, in ALGO-100C's own words: *sequencing a
decision ahead of its data does not slow the work down — it is what made an advisor's error
cheap.* Commit the formalization by teaching-fit argument **before** any census or guard number
is read, and a wrong idea costs one paragraph instead of a round.

He is a careful operator and the record is complete. Good luck.

**No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
recorded in this handover.**
