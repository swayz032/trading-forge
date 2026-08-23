# MNQ v2.4 — Operator Runbook

**For: Tonio. Written for someone who does not read code.**
Last measured against the repository on **2026-08-23**, head `2c18b8b1`.

This is the book for running, checking and stopping the bot **without Claude**. Every command
below was run against this repository on the date above. Where something does not exist yet,
this book says so plainly instead of describing what it ought to be.

---

## 0. Read this first — the two-sentence version

The bot is **not finished and is not connected to anything.** Today it is a strategy engine plus
a set of measuring tools you can run on your own machine against frozen past data. Nothing in
this book will place a real order, because nothing is wired to a live account yet.

---

## 1. What this bot is

It watches MNQ on a 5-minute chart and asks one question: **did price EARN permission at one of
my levels?** A retail indicator bot asks "did the line cross". This one requires a chain of
evidence before it will trade:

1. an **authorized key zone** — a level that existed before the session started
2. a **real interaction** with that zone — price actually went there
3. a **candle story** — the shape that says sellers or buyers lost control
4. **causal force** — sustained directional push, proven on 1-minute bars inside the forming
   5-minute candle
5. only then, an **entry**

If any link is missing, **it waits.** Waiting is the default, not the exception.

On top of that sit the rules you set: **one trade per session**, a **17.25-point stop**, and a
trading window. Those are hard limits in code, not suggestions.

---

## 2. What you can run today

Open a terminal. Everything below assumes you first do:

```
cd C:\Users\tonio\Projects\wt-mnq-v24
```

and that every command starts with `PYTHONPATH=. python -m`.

### 2a. The exam — how well does the bot copy you? (~6 minutes)

```
PYTHONPATH=. python -m research.run_frozen_14_case_baseline
```

This replays **14 past sessions** where your own decisions were recorded, and compares the bot
to you. It prints something like:

```
  agreement (decided cases) : 1/8
  bullet spent pre-window   : 7 sessions, hiding 16 unreachable in-window entries
  missed trader entries     : 2
  bot entered in window     : 7   declined 0   unavailable 7
  bot traded at all (session): 14 of 14
```

**How to read it, line by line:**

| line | what it means |
|---|---|
| `agreement (decided cases) : 1/8` | Of the 8 sessions where you actually made a call, the bot matched you on 1. **It was 5 before the trading window moved to 8:00** — the wider window lets the bot use up its one trade of the day before you have even looked. The other 6 of the 14 are sessions where the replay ran out before you decided — they cannot be scored either way. |
| `bullet spent pre-window` | The bot had already used its one trade for the day **before** the part of the session being audited. In 7 of 14 sessions. |
| `missed trader entries : 2` | Twice, you took a trade and the bot could not — its one trade was already gone. |
| `bot traded at all : 14 of 14` | **The bot trades every single day.** You traded on 7 of those same 14. This is the main thing still wrong with it. |
| `bot entered in window 7 / declined 0` | It never *chooses* to stand aside. When it looks like it declined, it had simply already fired. |

**The headline in one sentence:** when the bot is present and you trade, it picks the same
direction almost every time — its problem is **timing and being too eager**, not direction.

### 2b. Is my evidence still intact? (instant)

```
PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_external_evidence_custody
```

Checks that the files your results are built on have not been changed or deleted. You want
`ALL EXTERNAL EVIDENCE INTACT.` If it says `CHANGED`, a file that produced published numbers is
not the file on disk any more — **stop and report it**, do not re-run anything.

### 2c. Other measuring tools (all instant, all read-only)

| command (after `PYTHONPATH=. python -m research.`) | answers |
|---|---|
| `current_mnq_strategy_v2_4_bot_entry_rate` | how often the bot trades vs how often you do |
| `current_mnq_strategy_v2_4_evidence_eras` | which of your records can be compared to which |
| `current_mnq_strategy_v2_4_topstepx_prior_art` | what TopstepX connection code exists and what is proven |
| `current_mnq_strategy_v2_4_window_bound_census` | everywhere the 09:30 start time is written in code |
| `current_mnq_strategy_v2_4_ledger_corpus_join` | whether your trade ledger can be matched to the replays |

### 2d. Run the whole test suite (~40 seconds)

```
PYTHONPATH=. python -m pytest tests/ -q
```

Expect **7 failures**. Those 7 are pre-existing and are in older, unrelated parts of the
repository — not in the MNQ v2.4 bot. **If you ever see a number other than 7, something
changed.** Capture the list of `FAILED` lines and report it.

---

## 3. What does NOT exist yet — read this before believing anything is running

**There is no "start the bot" command.** Measured on 2026-08-23: the live runtime pieces
(`shadow_runtime`, `automation_runtime`, `broker`) are **libraries with no entry point**. Nothing
starts them. If you were expecting to type "go" and have the bot trade, that command has not
been written.

**Nothing is connected to TopstepX,** and nothing may be until the safety ladder finishes:

> **FIDELITY** (the bot copies you well enough, proven by an independent check) →
> **FREEZE** → **CLEAN EDGE** → **prop-survival tools** → *only then* TopstepX

This includes **evaluation accounts and broker-paper**. Not just funded ones. Today the bot fires
every session unconditionally; connecting it in that state is how an evaluation gets burned.

**A subscription running out does not change this ladder.** If the deadline arrives with the
ladder unfinished, the ladder continues — it does not get skipped.

---

## 4. Stopping everything

### 4a. What exists

The connection code has a **kill path**: `flatten()` closes open positions, `cancel_all()`
cancels working orders. As of 2026-08-23 both are **proven to work offline** — 7 of 7
safety-critical functions now have tests, up from 0.

### 4b. The one thing you must know about it

> **A FAILED CLOSE STOPS THE REST.**

`flatten()` closes your positions one at a time. If the broker rejects one of them, **it stops
there and the remaining positions stay open.** This is measured behaviour, not a guess.

**So "stop everything" can leave you partly in the market.**

**What to do:** run it again, then **check your positions in the TopstepX app with your own
eyes.** Never assume you are flat because the command ran.

### 4c. The absolute fallback

**Close it in the TopstepX app or phone the broker.** That always works and does not depend on
any of this code. If you are unsure and money is at risk, do that first and ask questions after.

---

## 5. What the bot's messages mean

Every refusal is a SHOUTING_CODE like `REALTIME_HEALTH_REFUSE`. They all mean the same thing at
heart: **the bot refused to act rather than guess.** A refusal is the system working.

The ones you could actually see when it is running:

| message | plain English | what you do |
|---|---|---|
| `REALTIME_HEALTH_REFUSE` | The live price feed is not healthy. | Nothing. It is right to refuse. Check your connection. |
| `ACCOUNT_CANNOT_TRADE` | TopstepX says this account may not trade. | Check the account in the app — breached, locked, or wrong one. |
| `CONTRACT_MISMATCH` | It is looking at a different contract month than expected. | Usually a roll. Report it. |
| `OPEN_POSITION_EXISTS` / `WORKING_ORDERS_EXIST` | Something is already live. | It will not stack. Flatten first. |
| `TOPSTEP_SIZE_REFUSE` | The size breaks a Topstep rule. | It is protecting you. |
| `BROKER_BALANCE_MISSING` / `ACCOUNT_BALANCE_WITNESS_MISMATCH` | It cannot confirm the balance, or two sources disagree. | Do not override. Report. |
| `BROKER_STATE_EXISTS_WITHOUT_LOCAL_BULLET` | The broker thinks there is a trade the bot has no record of. | **Stop. Check positions by hand.** |
| `V24_EXECUTION_QUOTE_DRIFT` / `..._OFF_TICK` | The price moved or is not a valid tick. | Correct refusal. |
| `V24_SIGNAL_SEMANTICS_STALE` | The signal was built by an older version of the strategy. | Report — do not run mixed versions. |
| `BRACKET_DISTANCE_NOT_TICK_ALIGNED` | Stop/target does not land on a real price. | Report. |

**Anything else:** copy the whole line and report it. You do not have to understand it.

**To get the full, current list** — all 28 of them, in plain English, with what to do:

```
PYTHONPATH=. python -c "from research.current_mnq_strategy_v2_4_refusal_legibility import PLAIN_ENGLISH as P; [print(f'{k}
  means : {v[0]}
  do    : {v[1]}
') for k in sorted(P) for v in [P[k]]]"
```

The table above is the short version. That command reads the real list out of the code, so it
cannot go out of date the way a hand-written table can.

---

## 6. If something goes wrong — in your words

**"The bot is silent."**
There is no start command yet, so today silence is expected. Once there is one: check the
process is running, then check the feed. Never assume silence means flat — **check positions.**

**"The bot won't trade."**
Most likely correct. It waits by default and takes one trade per session. Look for a refusal
code and use the table above.

**"Stop everything NOW."**
1. **Close positions in the TopstepX app.** Fastest and most reliable.
2. Then, if a bot process is running, stop it.
3. **Check positions again with your own eyes.** See §4b — a failed close can leave some open.

**"The numbers changed and I don't know why."**
Run the custody check (§2b). If it says `CHANGED`, a source file moved — report it and change
nothing.

**"Is it safe to connect to TopstepX?"**
No — not until the ladder in §3 finishes. That answer does not change because of a date.

---

## 7. Where things live

| what | where |
|---|---|
| the bot and all tools | `C:\Users\tonio\Projects\wt-mnq-v24\research\` |
| the tests | `...\wt-mnq-v24\tests\` |
| your recorded decisions (ground truth) | `research\current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json` — **committed, never edit** |
| the exam result | `research\current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json` |
| your trade ledger | `C:\Users\tonio\Downloads\backtesting-analytics.csv` — **not in the repo; do not delete** |
| reports to the advisor | branch `external-advisor/gpt-rulings-algo`, folder `algo-reports/` |

---

## 8. Working without Claude

From **2026-08-27** there is no Claude. **GPT is your engineering advisor**, and it can already
read every branch above.

**How to get help:**

1. Describe what happened in your own words.
2. Paste the **exact** message — the whole SHOUTING_CODE line.
3. GPT gives you a command. Paste it into the terminal exactly.
4. Paste the **whole output** back, including anything that looks like an error.

You do not need to interpret anything. **You are the hands; GPT reads.**

**Three rules that do not bend:**
- **Never edit** `..._labels_FROZEN.json`. It is the record of what you actually did.
- **Never connect to TopstepX** until the §3 ladder is finished.
- **Never trust "it ran fine"** over your own eyes on the account.

---

## 9. Honest gaps in this book

Listed because a runbook that hides its holes is worse than none.

- **No start command exists** for the v2.4 bot (§3). Until one is written, §6's "bot is silent"
  is theoretical.
- **The kill path is proven offline only.** It builds the right instructions; nobody has
  confirmed TopstepX accepts them, and nobody may until the ladder opens.
- **No heartbeat you would notice.** `RealtimeHealth` exists and is tested, but nothing pages
  you if the bot goes quiet. That is unbuilt.
- **The bot still trades every session.** That is the known defect the current work is fixing.
  It is not ready to run unattended, and this book cannot make it so.
