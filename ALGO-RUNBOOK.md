# MNQ v2.4 — Operator Runbook

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
> defect at 08:00 is that it spends its one daily trade BEFORE the operator's own entry clock
> on 13 of 14 sessions.


**For: Tonio. Written for someone who does not read code.**
Measured against this repository on **2026-08-26**, branch
`research/current-mnq-strategy-v2-4-zone-first-candles`, at the revert head `6888112d` with the
live tree at `abce4155`. Ruling ladder head: **ALGO-100C** at `602318c5`.

This is the book for running, checking and stopping the bot **without Claude**. Every command in
§2 was actually run on this machine on the date above unless it is marked UNVERIFIED, and every
UNVERIFIED one says why. Where something does not exist, this book says so plainly instead of
describing what it ought to be.

---

## 0. Read this first — the two-sentence version

The bot is **not finished and is not connected to anything.** Today it is a strategy brain plus a
set of measuring tools you run on your own machine against frozen past data. Nothing in this book
will place a real order, because nothing is wired to a live account — and by design, nothing may
be.

---

## 1. What the bot IS today, honestly

### 1a. It is a brain and a measuring bench, not a service

There is **a strategy brain** — the code that decides — and **an exam bench** — the tools that
score that brain against 14 sessions where your own decisions were recorded. Both live on a git
branch. Neither is a running program.

- **There is no "start the bot" command.** The live-runtime pieces (`shadow_runtime`,
  `automation_runtime`, `broker`) are code libraries with no entry point. Nothing starts them.
- **Nothing runs in the background.** No service, no scheduled task, no daemon. It cannot be
  "secretly running" — see `KILL-AND-HEARTBEAT.md` §1–§3 for the inventory of what *is* running
  on this tower (that is the Trading Forge platform, a different product) and how to check.
- **It is not connected to any broker, and must not be.**

### 1b. The hard gate — the one rule that costs money if you read past it

Written into the code at
`research/current_mnq_strategy_v2_4_topstepx_prior_art.py:87-91`, verbatim:

> NOTHING connects to TopstepX — not funded, not eval, not broker-paper — before
> FIDELITY (grade passes) → FREEZE → CLEAN EDGE → prop-survival arsenal. A subscription expiry
> date exerts ZERO authority over this ladder.

This includes **evaluation accounts and broker-paper**, not just funded ones. Read that twice.
The bot currently takes a trade in **12 of 14** replayed sessions while you traded 7 of those
same 14 — it is too eager. Connecting a too-eager bot to an evaluation account is how the
evaluation gets burned, and the money you are saving for it goes with it.

**A subscription running out does not move this gate.** If Claude ends with the ladder
unfinished, the ladder continues under GPT + you. The scripts run without Claude; GPT reads the
output; this book says how.

### 1c. What would have to be true before it trades

In order. None can be skipped, none can be done out of order.

| rung | what it means in plain terms | where it stands 2026-08-26 |
|---|---|---|
| **FIDELITY** | The bot decides like you do, and somebody independent — not the person who built it — confirms that. | **Not passed.** Agreement on decided cases is `1/8`. Current work is the T3 gate (see §2f). |
| **FREEZE** | The rules stop changing. The brain is sealed and hashed so a later run can be proven to be the same brain. | Not started. |
| **CLEAN EDGE** | On data it was never tuned against, the thing makes money after costs, and survives having its best month and its five best trades removed. | Not started. Deliberately last — no result may pick a rule before FREEZE. |
| **PROP-SURVIVAL** | Sizing and drawdown tools that keep a Topstep account alive. | Partly built (`current_mnq_strategy_v2_3_topstep_risk`), not exercised. |
| **A start command** | Somebody writes the program that actually runs the brain live. | **Does not exist.** |
| **A dead-man alarm** | Something tells you if it goes quiet. | **Does not exist.** See `KILL-AND-HEARTBEAT.md` §6. |
| **A flatten drill** | The emergency close-everything path proven against the real broker, not just offline. | Not done. Cannot be done before the gate opens. |

---

## 2. Commands — the daily/whenever set

Open PowerShell. Every command assumes you first do:

```
cd C:\Users\tonio\Projects\wt-mnq-v24
```

and every command starts with `PYTHONPATH=. python -m`. If PowerShell objects to `PYTHONPATH=.`
at the front of a line, set it once per window instead:

```
$env:PYTHONPATH = "."
```

and then just type `python -m ...`.

**Two kinds of command in this book.** Most only READ and print. A few also **REWRITE a result
file** in the repository. Those are marked **WRITES**. That is not dangerous — it cannot touch
your account — but it changes a file that other numbers were built on, so run those only when
GPT asks for them.

### 2a. Read the ruling ladder — what the advisor has decided

The ladder is the campaign's memory. Every decision on this lane is a numbered report on a
branch. To pull the newest and list it:

```
git fetch origin external-advisor/gpt-rulings-algo
git log --format="%h %s" -12 origin/external-advisor/gpt-rulings-algo
```

VERIFIED. The subject lines are written to be self-contained — reading those twelve lines tells
you the state of the campaign without opening anything. To read one in full:

```
git ls-tree --name-only origin/external-advisor/gpt-rulings-algo:algo-reports/ | tail -12
git show origin/external-advisor/gpt-rulings-algo:algo-reports/<paste-the-filename-here>
```

VERIFIED. `ALGO-100C` at `602318c5` is the newest as of 2026-08-26.

### 2b. See the state of the strategy branch

```
git log --oneline -10
git status --short
```

VERIFIED. `git status --short` printing nothing means nobody has half-finished work sitting in
the folder. If it prints lines beginning `M` or `??`, work is in progress — say so to GPT before
running anything that WRITES, because the numbers will describe the half-finished state.

### 2c. The exam — how well does the bot copy you? (~2–6 minutes) **WRITES**

```
PYTHONPATH=. python -m research.run_frozen_14_case_baseline
```

UNVERIFIED BY THE DRAFTER — deliberately not run, because it **rewrites** the scorecard file and
the strategy tree currently has a landing batch in progress. Its output format is read directly
from the code, and the numbers below are the ones in the committed scorecard at this head.

It replays **14 past sessions** where your own decisions were recorded and compares the bot to
you. It prints:

```
wrote research\current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json
  join                      : WINDOW  (was SESSION - refuted)
  agreement (decided cases) : 1/8   [AGREE + BOTH_DECLINED, from _mismatch_class only]
  censored, excluded        : 6
  bullet spent pre-window   : 10 sessions, hiding 8 unreachable in-window entries
  missed reasons            : {'BUDGET_CONSUMED_BEFORE_WINDOW': 4, 'NO_PERMISSION_IN_WINDOW': 2}
  opposite AT decision      : 0
  missed trader entries     : 6
  bot-only vs REAL decline  : 1
  bot entered in window     : 2   declined 2   unavailable 10
  bot traded at all (session): 12 of 14
  censored (segregated)     : 0 entered / 0 declined
  decisions end / in-window : 42 / 10
  census                    : {'AGREE': 1, 'BOT_ONLY_ENTRY_UNCENSORED_DECLINE': 1, ...}
```

**How to read it, line by line:**

| line | what it means |
|---|---|
| `join : WINDOW (was SESSION - refuted)` | Which clock it compares on. An earlier version compared whole sessions and was proven wrong; this one compares inside the audited window. If this ever says SESSION again, stop and report it. |
| `agreement (decided cases) : 1/8` | Of the 8 sessions where you actually made a call, the bot matched you on 1. **This is the headline fidelity number and it is the thing the whole campaign is trying to move.** |
| `censored, excluded : 6` | In 6 of the 14, the replay ran out while you were still watching. You never made a call, so those cannot be scored either way — they are excluded from both halves of the fraction, not counted as failures. |
| `bullet spent pre-window : 10 sessions, hiding 8 unreachable in-window entries` | In 10 of 14 sessions the bot had already used its one trade for the day **before** the audited window began. That eagerness hides 8 entries it would otherwise have been able to take. |
| `missed reasons` | Why it missed a trade you took: `BUDGET_CONSUMED_BEFORE_WINDOW` = it had already fired; `NO_PERMISSION_IN_WINDOW` = nothing earned permission at your clock. Two different diseases. |
| `opposite AT decision : 0` | **It has never gone the opposite way from you at a decision.** Direction is not the problem. |
| `missed trader entries : 6` | Six times you took a trade the bot could not. |
| `bot-only vs REAL decline : 1` | Once the bot took an in-window trade you genuinely declined. This is the unflattering direction and it is reported, not hidden. |
| `bot entered in window : 2 declined 2 unavailable 10` | `declined 2` matters: the bot **can** now genuinely stand aside. It used to be incapable of it — entering in 14 of 14 and declining in 0 — so its decision carried no information at all. That constant is gone. |
| `bot traded at all (session): 12 of 14` | The bot trades on 12 of the 14 days. You traded on 7. **This gap is the main defect of record.** |
| `census` | The same story as counted buckets. `AGREE` is the good one. |

**The headline in one sentence:** when the bot is present and you both trade, it picks the same
direction — measured **1 of 1**, and never once the opposite. Its problem is **timing and being
too eager**, not direction.

**One thing not to be fooled by:** the file it writes is called `..._frozen_14_case_scorecard_...`
but it is **rewritten by every run** and is not a frozen reference. The real never-rewritten
comparator is a separate file, `research/current_mnq_strategy_v2_4_F2_ANCHOR_frozen_5of8_ea6f0940_IMMUTABLE.json`,
checked by hash on every read by `research/current_mnq_strategy_v2_4_f2_anchor.py`. Never quote
the scorecard as "the frozen baseline".

### 2d. Is my evidence still intact? (instant)

```
PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_external_evidence_custody
```

VERIFIED (exit 0). Checks that the files every published number was built on have not changed or
vanished. Prints one line per file. You want `OK` on each:

```
trader_labels_COMMITTED        OK   33598 B  research\..._replay_v3_labels_FROZEN.json
trader_labels_external_origin  OK   33598 B  C:\Users\tonio\Downloads\mnq_replay_v3_labels_FROZEN.json
trade_ledger                   OK   10771 B  C:\Users\tonio\Downloads\backtesting-analytics.csv
```

If any line says `CHANGED` or `MISSING`, a file that produced published numbers is not the file
on disk any more — **stop, change nothing, and paste the whole output to GPT.** Do not re-run
anything to "see if it clears".

### 2e. The refusal trace — WHY it said no at your clocks **WRITES**

```
PYTHONPATH=. python -m research.run_refusal_trace_five_clocks
```

UNVERIFIED BY THE DRAFTER — not run, because it rewrites
`research/current_mnq_strategy_v2_4_refusal_trace_five_clocks_2026_08_24.json`, a tracked file,
while a landing batch is in progress. Output format read from the code.

This is the single most useful diagnostic when the question is *"why didn't it take my trade?"*.
At each of your five recorded entry clocks it asks every route family and prints **the first
thing that refused**, its exact line of code, and — this is the point — whether that refusal
rests on **something you taught** or on **a number somebody chose**. It prints:

```
=== REFUSAL TRACE AT HIS FIVE CLOCKS ===

2026-04-09  11:35 LONG  candidates=12  survived=0
   ROUTE_A_REJECTION            NO_TAKEOVER                       [TAUGHT]
   ROUTE_B_BREAKOUT             NO_COMPLETED_PRINT_BEYOND_THE_ZONE [TAUGHT]
   ...
refusals resting on an UNTAUGHT magnitude: 2
```

**How to read it:**

| what you see | what it means |
|---|---|
| `candidates=12 survived=0` | Twelve possible trades were considered at your minute; none got through. |
| `SURVIVES: <route> <reason>` | One did get through — the route and why. |
| `[TAUGHT]` | The refusal rests on a rule you actually taught. **This is the machine being faithful.** Nothing to fix. |
| `[UNTAUGHT MAGNITUDE]` | The refusal rests on a number an engineer picked, not on anything you said. **These are the repair targets.** The line names the number and its value. |
| `[TAUGHT_SHAPE_UNTAUGHT_GATE]` | The shape is yours but it is guarded by a chosen number. Half-legitimate; still a target. |
| `refusals resting on an UNTAUGHT magnitude: N` | The count that matters. It should trend to zero over the campaign. |

### 2f. The candidate table — what happened at your six clocks **WRITES**

```
PYTHONPATH=. python -m research.run_algo096_candidate_table_six_clocks
```

UNVERIFIED BY THE DRAFTER — same reason, and additionally this script has **uncommitted
changes** in the working tree right now, so today it would measure half-finished work.

Where §2e answers *"what refused"*, this answers *"how far did each possible trade get"*. Per
session it prints the candidate population at your bucket, every survivor **with its full key**
(route + location + direction + clock), and the **deepest gate any candidate reached**:

```
2026-04-06  09:38 SHORT  candidates=85  distinct_keys=6  survivors=0
    deepest BY KEY: depth 4  _control  (1 key(s) at this depth)
        @ ('REV', 'S:2026-03-25T06:30...', 'SHORT', '09:38')
    UNRANKED tokens: {"SOME_TOKEN": 3}
```

**How to read it:**

| what you see | what it means |
|---|---|
| `candidates=85 distinct_keys=6` | 85 records, but only 6 genuinely different setups. **Always read `distinct_keys`, never `candidates`** — the raw count is multiplied by locations and flatters nothing. |
| `deepest BY KEY: depth 4 _control` | The furthest any single setup got before dying, and what killed it. Deeper = closer to a trade. |
| `@ (...)` | The exact setup that got that far. This is the thing GPT will want. |
| `UNRANKED tokens` | Refusal names the tool does not yet know how to rank. **Reported, never silently swept into a bucket** — that was a real past defect. |

### 2g. The quick measuring tools (all instant, all read-only, all VERIFIED exit 0)

Each is `PYTHONPATH=. python -m research.` followed by the name.

| command | answers |
|---|---|
| `current_mnq_strategy_v2_4_bot_entry_rate` | how often the bot trades vs how often you do (12 of 14 vs 7 of 14) |
| `current_mnq_strategy_v2_4_evidence_eras` | which of your records can be compared to which — the 2025 ledger and the 2026 replays are **disjoint** |
| `current_mnq_strategy_v2_4_topstepx_prior_art` | what broker-connection code exists, what is tested, and the hard gate above it |
| `current_mnq_strategy_v2_4_window_bound_census` | every place the old 09:30 start time is still written in code (35 sites, in 5 different roles) |
| `current_mnq_strategy_v2_4_ledger_corpus_join` | whether your trade ledger can be matched to the replays at all |
| `current_mnq_strategy_v2_4_refusal_legibility` | how many refusal codes exist and how many have plain English (28 of 28) |
| `current_mnq_strategy_v2_4_validation_arsenal` | the whole validation ladder: which tools are runnable today and which are GATED behind FREEZE, with the reason |

### 2h. Print every refusal message in plain English

```
PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_refusal_legibility
```

VERIFIED — prints the counts. For the full table with what-to-do for each of the 28:

```
PYTHONPATH=. python -c "from research.current_mnq_strategy_v2_4_refusal_legibility import PLAIN_ENGLISH as P; [print(f'{k}\n  means : {P[k][0]}\n  do    : {P[k][1]}\n') for k in sorted(P)]"
```

VERIFIED (28 codes). This reads the real list out of the code, so it cannot go stale the way a
hand-written table can. `SELF-EXPLANATION-AUDIT.md` translates the rest — every status word the
family can print, including the exam and trace words above.

### 2i. Run the whole test suite (~65 seconds)

```
PYTHONPATH=. python -m pytest tests/ -q
```

VERIFIED, 2026-08-26: **1662 passed**. Expect **7 failures**. They are these, and all 7 are in
older, unrelated parts of the repository — none is the MNQ v2.4 bot:

```
tests/test_current_mnq_strategy_v2_2_engine_final.py::test_final_engine_installs_one_gold_lifecycle_everywhere
tests/test_deepscan_fixwave_2026_06_29.py::TestH6FreqMapAlias::test_bars_per_day_4hr_is_6
tests/test_deepscan_fixwave_2026_06_29.py::TestH6FreqMapAlias::test_4h_and_4hour_still_present
tests/test_eligibility_gate_stop_ceiling.py::TestBugProof::test_mnq_30pt_stop_clamped_to_6pt_with_old_hardcoded_args
tests/test_eligibility_gate_stop_ceiling.py::TestFixVerification::test_mnq_above_ceiling_is_clamped
tests/test_eligibility_gate_stop_ceiling.py::TestFixVerification::test_mes_stop_above_14pt_ceiling_is_clamped
tests/test_eligibility_gate_stop_ceiling.py::TestFixVerification::test_mcl_stop_above_1pt_ceiling_is_clamped
```

**If you see a number other than 7, capture every `FAILED` line and paste it to GPT.** Compare
the names against the list above: a failure whose name is NOT on that list is new. While a
change is being landed the count is temporarily higher — on 2026-08-26 the live tree showed 9,
the extra 2 being a half-finished test file for the gate described in §5. A batch is not allowed
to land with the suite red, so on any committed state the number should be 7 again.

---

## 3. How to publish a report to GPT

Reports and rulings for this lane live on their own branch so they cannot collide with the main
Trading Forge campaign. One command does it:

```
scripts/publish_algo_report.sh <path-to-your-file.md> "<the commit subject line>"
```

The subject line is the first thing GPT reads — make it say the whole finding, not a title.

**The script REFUSES rather than warns** if you get the branch, the folder or the numbering
wrong. But it does not protect you from these three, which have each bitten this desk:

1. **The filename must be the full descriptive name.** The script takes the published name from
   your LOCAL file's basename. Name your local file
   `ALGO-NNN-WHAT-IT-DECIDES-YYYY-MM-DD.md` before publishing — a file called `ALGO-097.md` was
   published as exactly that and had to be renamed on the ladder afterwards.
2. **There is NO number-collision guard.** Two reports can take the same number. Check first:
   ```
   git fetch origin external-advisor/gpt-rulings-algo
   git ls-tree --name-only origin/external-advisor/gpt-rulings-algo:algo-reports/ | tail -15
   ```
   VERIFIED. Use the next unused number. `ALGO-026`, `ALGO-039` and `ALGO-043` all carry
   collision scars.
3. **Publish from a SHORT directory.** From a deep temp path, `git hash-object` dies on Windows
   with `Filename too long`. Put the file somewhere like `C:\a\` and publish from there.

---

## 4. If something goes wrong — in your words

### "Nothing responds."

Nothing here is a live service, so this is almost always the Trading Forge platform, not the
bot. Follow **`KILL-AND-HEARTBEAT.md` §3** — it gives you the exact `Get-Service` and port-4000
checks. If services show Running but pages are dead, restart the machine; everything on this
tower auto-starts. **Nothing here can lose a market position today**, because nothing is attached
to a market.

### "I want to stop everything."

**`KILL-AND-HEARTBEAT.md` §4** is the procedure. Today it carries **zero market risk** — there
is nothing to flatten. Do not go looking for a bot process to kill; there isn't one (§1a).

If money is ever at risk in future, the order is: **close it in the TopstepX app or phone the
broker FIRST**, then worry about code. And know this, which is measured and not a guess:

> **A FAILED CLOSE STOPS THE REST.**

`flatten()` closes positions one at a time; if the broker rejects one, it stops there and the
rest stay open. So "stop everything" can leave you partly in the market. Run it again, then
**check your positions in the TopstepX app with your own eyes.** Never accept "the command ran"
as proof you are flat.

### "A number looks wrong."

Do this in order, and **change nothing** while you do it:

1. Run the custody check (§2d). If anything says `CHANGED`, stop there and report it — a source
   file moved and every number built on it is suspect.
2. Run `git status --short` (§2b). If it prints anything, half-finished work is in the folder and
   the number describes that, not the real state.
3. Ask **which commit** the number came from. A number without a commit is a rumour.
4. Paste the number, the command that produced it, and the output of steps 1–3 to GPT.

**Do not "re-run it until it looks right."** On this project, four published numbers in two days
were wrong and **every one of them was the measuring tool, not the bot.** Suspect the instrument
first. That is why nothing here is fixed by re-running.

### "GPT asks me to run something I don't understand."

You do not have to understand it, but you are allowed to ask, and these five checks are yours:

1. **Does it appear in §2 of this book?** If yes, run it. Everything in §2 is read-only or marked
   **WRITES** with what it writes.
2. **Does it contain `git push`, `git commit`, `rm`, `del`, `checkout`, or `--force`?** Those
   change or destroy things. Ask GPT what it changes and whether it can be undone, before you
   press Enter.
3. **Does it mention TopstepX, a broker, an account number, or a key?** **Do not run it.** The
   gate in §1b has not opened. Reply with §1b and ask GPT to confirm the ladder finished.
4. **Does it write to the labels file?** Never run it. See §6.
5. **Would it install something or reach the internet?** Ask first.

Otherwise: paste it, run it, and paste **the whole output back** — including anything that looks
like an error, and including the boring lines. You are the hands; GPT reads.

---

## 5. The one-page mental model

This is the whole method, in the order the bot asks the questions. **Any one answer of "no" means
no trade.** It is written in the code as one line — the master trading equation, in
`MNQ_V24_ENGINEER_ONBOARDING.md` under "Master trading equation":

> `TRADE = SESSION ∧ PREMARKET_PRIOR ∧ VALID_KEY_LOCATION_OR_APPROVED_PREBREAK_EXCEPTION ∧ VALID_CANDLE_STORY ∧ SUSTAINED_INTRA_CANDLE_DIRECTIONAL_FORCE ∧ ROOM_TO_FIRST_REACTION ∧ FIRST_A_PLUS ∧ DAILY_BULLET_UNUSED`

Your own sentence for the same thing:

> **Location gives permission. Candle sequence tells the story. Momentum/force pulls the trigger.**

| # | the question | in your words | where it lives in the code |
|---|---|---|---|
| 1 | **Location** | Is price at one of my key level zones — a band that existed *before* today started? No zone, no trade. | `research/current_mnq_strategy_v2_4_levels.py:225` builds the zones; `research/current_mnq_strategy_v2_4_premarket.py` sets the bias |
| 2 | **Candle story** | Did the candles at that zone actually tell me something — a rejection wick, a sweep and reclaim, a failed break? Or did it just wander past? | `research/current_mnq_strategy_v2_4_derivation.py:334` (`derive_story`); the six taught interactions at `:174` |
| 3 | **Force** | Is there real push behind it — proven on the 1-minute candles *inside* the forming 5-minute candle — or is it one hopeful print? | `research/current_mnq_strategy_v2_4_force.py:101` (`force_snapshot`), confirmation at `:195` |
| 4 | **Target** | Is there somewhere worth going — a gap, a cluster, the next zone — before the first reaction? No room, no trade. | `research/current_mnq_strategy_v2_4_targets.py:234` and `:326`; the $400 floor in `research/current_mnq_strategy_v2_4_target_policy.py` |
| 5 | **First A+** | Is this the *first* good one of the day? Not the best one — the **first**. | `research/current_mnq_strategy_v2_4_kernel.py:201-208` — the ranking function that spends the bullet |
| 6 | **One bullet a day** | Have I already traded today? Then I am done, whatever happens next. | `research/current_mnq_strategy_v2_4_session_budget.py` |

Sitting over all six: **a 17.25-point stop** (`research/current_mnq_strategy_v2_4_kernel.py:9`)
and an **08:00–12:00 deployment window**
(`research/current_mnq_strategy_v2_4_exam_window.py:54`). Both are hard limits in code, not
suggestions.

**On #5, which the campaign settled in August 2026 and is worth knowing:** there is no clever
ranking of the day's setups, and there never was one to build. *"First A+ only"* **is** the rule.
The code was right the whole time; the idea that a smarter selector was missing has been formally
withdrawn (ALGO-100B). What *was* missing is one taught gate you did teach and the code had lost:
**a touch with mixed or doji control is a WAIT, not a trade** — an indecisive candle at the zone,
where nobody took charge, is not an A+. That gate is being put back now, and it is the current
work (ALGO-100C, ratified). If it lands, the bot stops taking many of the too-early trades that
produce `12 of 14`.

**The one thing to hold onto:** the bot's default is **WAIT**. Nearly every message it prints is
it explaining why it kept waiting. A refusal is the system working.

---

## 6. Where everything lives

| what | where |
|---|---|
| the brain and all tools | `C:\Users\tonio\Projects\wt-mnq-v24\research\` |
| the tests | `C:\Users\tonio\Projects\wt-mnq-v24\tests\` |
| the strategy branch | `research/current-mnq-strategy-v2-4-zone-first-candles` (PR #38 — **DRAFT / DO NOT MERGE**) |
| **your recorded decisions — the ground truth** | `research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json` — committed, and you must **never edit** it |
| the frozen textbook of the method | `research/current_mnq_strategy_v2_4_spec.json` |
| the exam result (rewritten every run) | `research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json` |
| the real frozen comparator (never rewritten) | `research/current_mnq_strategy_v2_4_F2_ANCHOR_frozen_5of8_ea6f0940_IMMUTABLE.json` |
| your trade ledger | `C:\Users\tonio\Downloads\backtesting-analytics.csv` — **not in the repo; do not delete** |
| rulings and reports | branch `external-advisor/gpt-rulings-algo`, folder `algo-reports/`, numbered `ALGO-NNN` |
| the handover to GPT | `ALGO-GPT-HANDOVER.md` at repo root |
| stopping things / what is alive | `KILL-AND-HEARTBEAT.md` |
| what every message means | `SELF-EXPLANATION-AUDIT.md` |
| seating a future Claude, if you ever re-subscribe | `SEAT-HANDOFF-TEMPLATES.md` |

**Three rules that do not bend:**

- **Never edit** `research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json`. It is the
  record of what you actually did, and every fidelity number is measured against it. If it
  changes, nothing can be compared to anything.
- **Never connect to TopstepX** — including evaluation accounts and broker-paper — until the §1b
  ladder finishes.
- **Never trust "it ran fine"** over your own eyes on the account.

---

## 7. Working without Claude

From **2026-08-27** there is no Claude on this project. **GPT is your engineering advisor**, and
it already reads every branch named in this book.

1. Describe what happened in your own words.
2. Paste the **exact** message — the whole SHOUTING_CODE line, not a summary of it.
3. GPT gives you a command. Check it against §4's five questions, then paste it in exactly.
4. Paste the **whole output** back, including anything that looks like an error.

You do not need to interpret anything. **You are the hands; GPT reads.**

Two things GPT should never ask you, and you can refuse without explaining:

- **Anything about replay markings** — which line, what time, what you were looking at. You have
  said repeatedly you cannot remember them and that collection is closed (operator order
  ALGO-083). Reply: "closed, ALGO-083" and move on.
- **Historical decision evidence** — why you passed on some day months ago. Also closed: *"you
  have all my data"* (ALGO-022). Everything that can be known is already in the repository.

---

## 8. Honest gaps in this book

Listed because a runbook that hides its holes is worse than none.

- **There is no "start the bot" command** (§1a), so §4's "nothing responds" is about the platform,
  not the bot. Until a runner is written, the bot cannot be silent — it is not speaking.
- **The kill path is proven offline only.** The code builds the right instructions; nobody has
  confirmed the broker accepts them, and nobody may until the gate opens.
- **No heartbeat you would notice.** Nothing pages you if a future bot goes quiet. See
  `KILL-AND-HEARTBEAT.md` §6 for the two candidate designs — neither is built.
- **The bot still trades on 12 of 14 days.** That is the defect the current work is fixing (§5).
  It is not ready to run unattended and this book cannot make it so.
- **Three commands in §2 are UNVERIFIED by the drafter** — the exam (§2c), the refusal trace
  (§2e) and the candidate table (§2f). All three **rewrite tracked files**, and a landing batch
  was in progress on 2026-08-26. Their output formats were read from the code, not guessed. The
  worker seat should run all three at the landing commit and correct any drift in the sample
  output above.
- **The failure count in §2i (7) was measured on a live tree** that also showed 2 in-flight
  failures. It must be re-measured at the landing commit before this book is committed.
- **These sample outputs will drift.** Any number in this book can be re-derived by running the
  command next to it. Where a printed number and this book disagree, **the command is right and
  the book is stale** — tell GPT.

## Known defects — things that are wrong and are written down

### The bot stopped with a `RuntimeError` — a KNOWN, REPRODUCIBLE defect

**What you would see:** the process is gone, and the last line is

```
RuntimeError: V24_TARGET_DISTANCE_LT_REACTION_CONTACT:23.5000<23.5640
```

**What it means, in one sentence:** a strict inequality between the computed target distance
and the reaction-contact distance rejects a **sub-tick** difference (here 0.064 points) by
**raising** instead of **declining the trade**.

**Why it matters more than it looks:** the engine does not refuse the session, it **crashes**.
An unattended bot that raises mid-session **halts** rather than declining and carrying on. It
killed a running backtest worker outright, 64 sessions in.

**Verified at the line:** `research/current_mnq_strategy_v2_4_target_policy.py:157-161`, inside
`classify_first_reaction_destination`. Reproduced on session **2023-04-03** by the EDGE lane on
out-of-sample data (1 occurrence in 317 days measured so far).

**What to do:** nothing urgent — this path only runs when a backtest or a live session reaches
that destination check. Restart the run. **Paste the literal above to GPT**; it is enough to
locate the defect exactly.

**A measurement warning for whoever runs a census next:** a crashed session is **NOT** a
no-trade decision — the engine never reached one. Count such days as *run* and *excluded*, with
the exception type and message journalled. Counting a crash as a decline silently inflates the
no-trade bucket.

**NOT FIXED, deliberately:** the strategy was frozen and the semantic lanes owned the work when
this was found. It is recorded rather than patched so it is actionable post-sunset.

