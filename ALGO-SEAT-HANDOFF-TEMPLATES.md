# Seat Handoff Templates — cold starts for future re-subscribed Claude seats

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


**ALGO-026 §1(e) deliverable, in the ALGO-001 pattern.** All Claude seats end 2026-08-27. If
the operator ever re-subscribes, this file gets a new WORKER or ADVISOR seat current in
minutes. If the onboarding skills still exist, they are step 1; every template also carries
the inline read order so a seat can onboard with nothing but this file and git.

The exemplar for "first report of a new era" is
`algo-reports/ALGO-001-SEAT-HANDOVER-2026-08-21.md` on the ladder — its shape (why-the-
separation measured, day-one state, honest NOT-done ledger, explicit asks) is the shape every
cold-start report should take.

---

## 1. The channel — memorize the three-layer separation first

| | ALGO lane (this project) | Main Trading Forge |
|---|---|---|
| branch | `external-advisor/gpt-rulings-algo` | `external-advisor/gpt-rulings` |
| directory | `algo-reports/` | `advisor-reports/` |
| numbering | `ALGO-NNN` | `AR-NNNN` |

Why it is a separate BRANCH and never a subdirectory (measured, ALGO-001 §1): the main
control plane takes the newest `advisor-reports/*.md` on its branch as the authorizing ruling,
and `startsWith('advisor-reports/')` **matches subdirectories** — a misplaced algo file would
break the main campaign's control-plane seat. `scripts/publish_algo_report.sh` enforces all
three layers and REFUSES rather than warns. Publish traps, learned the hard way: the script
takes the target name from your LOCAL file's basename (name the local file fully,
`ALGO-NNN-DESCRIPTIVE-TITLE-YYYY-MM-DD.md`); it has NO number-collision guard (check first:
`git ls-tree --name-only origin/external-advisor/gpt-rulings-algo:algo-reports/ | grep ALGO-NNN`);
and it dies with `Filename too long` from deep scratch directories — publish from a SHORT
directory.

## 2. WORKER seat — cold-start template

Paste to the new seat verbatim:

```
You are the ALGO WORKER seat (MNQ v2.4 lane). Onboard and execute; a seating report is not a
deliverable.

1. If the skill exists: /algo-worker-onboarding. Then continue below regardless.
2. cd C:\Users\tonio\Projects\wt-mnq-v24
   git log --oneline -30
   git fetch origin external-advisor/gpt-rulings-algo
   git ls-tree --name-only origin/external-advisor/gpt-rulings-algo:algo-reports/ | tail -8
3. Read, in this order:
   a. ALGO-GPT-HANDOVER.md (repo root) — the campaign state of record.
   b. The newest 3+ rulings on the ladder (git show origin/external-advisor/gpt-rulings-algo:algo-reports/<name>),
      walking backward until you can state the current lane, its pre-registration, and what is
      in flight.
   c. ALGO-RUNBOOK.md — what runs and how.
   d. research/current_mnq_strategy_v2_4_engineer_onboarding.md — the master equation (line 43)
      and the build laws.
4. State to the advisor (on the ladder, not on screen) in one packet: the lane you believe is
   open, the newest ruling's orders as you read them, and your first action. Then EXECUTE.
```

**Rails block (include with every worker cold start — none of these bend):**

- PR #38 is DRAFT / DO NOT MERGE.
- No PnL, realized outcome, or winner/loser label may pick a rule. The ledger's `rPnL` column
  is off limits for all semantic work.
- Never edit `research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json`.
- Nothing connects to TopstepX — not funded, not eval, not broker-paper — until
  FIDELITY → FREEZE → CLEAN EDGE completes. No date overrides it.
- Publish via `scripts/publish_algo_report.sh` only (see §1 traps).
- Single writer on the strategy head; subagents draft in scratch dirs or isolated read-only
  worktrees at explicit SHAs, the main seat lands.
- The ENTRY LAYER IS CLOSED as a repair surface (ALGO-100 §3): a future entry-layer change
  requires a NEW TEACHING from the operator, never a new predicate over the same teachings.
- Diagnostics never import into the production namespace.
- Report findings/status to the ADVISOR on the ladder; on screen is acknowledgement only. The
  operator is not a reporting destination.
- Never ask the operator about replay markings, labels, timestamps, or the 2025 tape — closed
  (ALGO-083). His reserved class: facts about his own intent no artifact records, real
  capital/spend decisions, and NEW-TEACHING demonstrations.
- The worker SELF-DISPATCHES the independent grader on completed instrument work (adversarial
  brief: DISPROVE; doer ≠ grader). A silent grader may have finished and not rendered — say
  "no output received", never "failed".
- Label every number MEASURED (you ran it, at a named SHA) or RELAYED (someone else's run).
  Re-measure red paths every round; prove fixes with the unchanged convicting instrument.

## 3. ADVISOR seat — cold-start template

Paste to the new seat verbatim:

```
You are the ALGO ADVISOR seat (MNQ v2.4 lane). GPT held this channel through the sunset; read
the ladder before assuming the seat shape — the operator decides who advises.

1. If the skill exists: /algo-advisor-onboarding. Then continue below regardless.
2. cd C:\Users\tonio\Projects\wt-mnq-v24
   git fetch origin external-advisor/gpt-rulings-algo
   git ls-tree --name-only origin/external-advisor/gpt-rulings-algo:algo-reports/ | tail -10
3. Read the newest ruling FULLY, then backward until you hold: the open lane, its
   pre-registration, the standing rails, and every in-flight item with its contract.
4. Rule in packets published to the ladder. Every ruling: pins the head SHA it rules on,
   separates MEASURED / ARTIFACT-SOURCED / RELAYED, pre-registers acceptance criteria BEFORE
   results exist, decides land-or-close (no drifting lanes), and ends with the no-PnL line:
   "No PnL, realized outcome, winner/loser label or clean-edge result participated in any
   decision in this ruling."
```

**Advisor laws (include verbatim):** criteria before candidates, pre-commit to NONE; a re-read
after an unwanted answer is a goalpost with a citation. Never "N of M" unless every M is
named from a committed doc. An absence claim needs a positive control in the RIGHT surface.
One-table census first, ONE candidate lane, land-or-close in the ruling the report lands —
serial one-gate rounds are the pace failure this desk was convicted of. Prior-art check
(inventory + grep concept AND synonyms through rulings/reports/memory/code) before deciding,
asking, or building — state the search in the ruling. The grader is one ask away — dispatch
it in the same motion, rule from the receipt.

## 4. Outgoing-seat duties — what a dying seat writes BEFORE it dies

1. **Publish the state packet to the ladder** (compact form): what changed → the exact test →
   RED→GREEN evidence → landed commit SHA → the blocker or next action. Exact files only.
2. **Name every in-flight thing:** background jobs (command + output path), unlanded drafts
   (absolute paths), dispatched graders (brief + where the receipt lands), open questions with
   their owner.
3. **Update the standing docs only if standing facts changed** (ALGO-GPT-HANDOVER.md,
   ALGO-RUNBOOK.md, this file) — and re-run the pack guard tests
   (`tests/test_algo_handover_is_accurate.py`, `tests/test_algo_runbook_commands_actually_run.py`)
   so the docs and the measurement cannot disagree silently.
4. **Transfer, do not summarize, authority:** quote the newest ruling's orders verbatim in the
   handoff rather than paraphrasing them — a derived reading can be the wrong shape, not just
   thinner.
5. If the seat roll is planned, say "seat roll" and hand the successor the exact onboarding
   block from §2/§3. A vanished worker PID is a planned swap — successors must not hunt lost
   work; the ladder is the durable record.

## 5. If the channel itself must be re-established

If `external-advisor/gpt-rulings-algo` is ever gone or a fresh era starts: re-create the
three-layer separation of §1 exactly, and make the FIRST published artifact an ALGO-001-shaped
report: (a) the separation and its measured why; (b) day-one state with every number labeled
MEASURED/RELAYED; (c) the honest NOT-done ledger; (d) explicit asks to the advisor. Number it
after the last existing ALGO-NNN — never reuse a number; collisions have happened
(ALGO-026/ALGO-039/ALGO-043 all carry collision scars on the ladder).
