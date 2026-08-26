# ALGO-119 — **BUILD THE BAND TONIGHT.** Operator, verbatim: *"CLAUDE SUPPOSE TO BE ABLE TO GET THE BREAKTHROUGH WITHOUT TRYING TO PUSH IT ON GPT IT SHOULDNT BE THIS HARD."* **He is right and this desk was wrong.** The band-shape repair needs **no derivation** (ruled ALGO-073), **no verification** (measured to 0.59/0.60 pt against his own demo, ALGO-089), **no new magnitude** (it is a shape, so `no_threshold_search` does not reach it), and **no new join** (it already exists at `levels.py:76-86`). **I put the one item that was ready to build into someone else's queue and spent the seat's last hours on documentation about it.** Reversed. **The build is authorized now.**

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Supersedes** ALGO-109 §6.1,
ALGO-111 §5 and ALGO-117 §5 **only** where they place the band shape in GPT's queue.
**Channel head at drafting:** `eca7c7f2`. **Main head:** `c62bb561e015`. **PR #38: DRAFT.**

## 1. The misjudgment, named

I optimised for **what survives tomorrow** when I should have optimised for **what can be finished
today**. The runbook and handover work was real — dead pointers inside the STOP-EVERYTHING
procedure, commands that failed on every paste — but once that landed I ordered **more
documentation** when the tree was green, the worker seat was idle, and **the highest-leverage
repair in the campaign was sitting fully specified.** Deferring a ready build to a successor is a
decision that needs a reason, and "the deadline is tomorrow" is an argument **for** building it,
not against.

## 2. Why it is buildable tonight and nothing else on the queue is

| item | derivation needed | magnitude question | blocked by contract | join written |
|---|---|---|---|---|
| **BAND SHAPE** | **no** — ruled ALGO-073 §2 | **no** — a shape | **no** | **yes**, `levels.py:76-86` |
| established-path band | yes | yes (4 undeclared) | yes | no |
| the rank | yes | — | needs a guard that rewrites every bullet | no |
| M1 / AST / 7 weights | yes | yes | `no_threshold_search` | n/a |

**Every other item needs something that cannot be produced in the time. This one needs a change of
output type.**

## 3. THE BUILD — authorized, scoped, and pre-registered

**SCOPE:** the **exceptional single-swing** band only (ALGO-111 §4's ruling — the established path
waits for its provenance pass). Draw the band as **`[wick extreme, close]` of the source rejection
candle on its marked timeframe (5m/15m)** — his words, ALGO-073 §2 — replacing the symmetric
`max(4 ticks, 0.06·ATR)` construction for that family.

1. **Use the existing join.** `_pivot_close_away` (`levels.py:76-86`) already walks each pivot back
   to its source bar and already reads `bar.low`/`bar.close` (S) and `bar.high`/`bar.close` (R),
   side mirror correct. **It returns a fraction; take the edges.** Do **not** write a second join.
2. **FAIL LOUDLY.** That function ends `except Exception: return 0.5`. **The band build may not
   inherit it.** A failed join must raise or emit an explicit refusal literal — a silent fallback
   produces a plausible zone unrelated to its candle and **nothing goes red.**
3. **A-priori fixtures, committed BEFORE the guard** (the sequencing that has caught four bad
   clauses this week): a long-wick support rejection → band spans wick-low to close · a resistance
   rejection → mirrored · a candle whose close is inside the prior band → stated behaviour, chosen
   from the words not from what it does to the sessions · a join failure → **raises**, does not
   return a band.
4. **GUARD, both pins, membership by key:** map size per session before/after (**structural, no
   target size** — ALGO-102 §4) · control 04-14 by key **and** target · sessions silenced,
   reported · the five early bullet-spends' dispositions · first-approval-per-session table ·
   **per-route membership** (ALGO-109 §2).
5. **THEN RE-EXAM #5.** **Binding clause: NOTHING LEAVES.** Everything else is reported. **No
   agreement gain is required** — and per ALGO-117 §1 the **seven undeclared quality weights sit
   upstream of this change**, so a result in either direction is partly theirs; **say so in the
   packet rather than claiming or disclaiming the outcome.**
6. **Disposition, pre-committed:** nothing leaves **and** the control holds → the batch **stays**,
   labelled by what the exam actually showed. Anything leaves → **revert in one commit**, plainly.
   **If the derivation cannot be expressed without a new number, STOP and say so** — that is the
   honest close, not a reason to invent one.

**ANTI-OVERFIT:** the band comes from **his sentence**, not from map size, not from his seven
trades, not from any backtest number. **The ~4–32-pt spread is corroboration, not the source**
(ALGO-111 §2). No clause may be chosen for what it does to the five early trades.

## 4. What does not change

Nothing else is authorized. The T3″ batch stays **UNRATIFIED-FOR-FREEZE**. R2c and B1 stay
unlanded. The reserved-class asks stay **unsent**. The hard gate stands — **no TopstepX connection
of any kind, broker-paper included.** The three process fixes still land in the handover, **after**
the build, and if the build consumes the remaining time then the handover carries them as text and
GPT applies them.

LESSON: **a deadline is a reason to build the thing that is ready, not a reason to write about it.**
The operator had to point that out, which means the desk's judgment about its own remaining time
was worse than his.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
