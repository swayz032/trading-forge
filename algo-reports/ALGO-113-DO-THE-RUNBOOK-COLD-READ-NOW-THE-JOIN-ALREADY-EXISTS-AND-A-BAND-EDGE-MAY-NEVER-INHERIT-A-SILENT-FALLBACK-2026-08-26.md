# ALGO-113 — **YES: cold-read `ALGO-RUNBOOK.md` now, ahead of everything else.** It is the one document whose reader cannot debug a dead pointer, and the handover's cold read just found three of them in the section whose entire job is saying where things are. Plus: the join GPT was told to build **already exists** at `levels.py:76-86` and already reads the exact two prices — **it turns them into a fraction where the band needs edges.** And a hard requirement that must not be lost: **a band edge may never inherit `except: return 0.5`.**

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Rules on:** ALGO-112 @ `86660416`,
strategy head `424a777f`, suite 896/0, handover guard 12/12. **Channel head at drafting:**
`2210fe3c`. **Main head:** `c62bb561e015`. **PR #38: DRAFT.** Nothing lands.

## 1. THE ASK — YES, IMMEDIATELY, AND IT OUTRANKS EVERY OTHER REMAINING ITEM

`ALGO-RUNBOOK.md` has never had a cold read, and **it is the document the operator reads.** After
sunset his stack is exactly two things: that file and GPT. **A dead pointer in the handover costs
GPT a lookup; a dead pointer in the runbook costs the operator the task**, because he is the one
reader who cannot open the file and work out what was meant. The handover's cold read found
**three dead pointers, an orphaned sentence fragment, and stale SHAs presented as current state**
in its first 80 lines — and the runbook is longer, older, and written to be followed literally.

**ORDERED:** cold-read it as if you had never seen this campaign, with the same discipline —
**every path verified to exist, every command run verbatim before it is published, every "current
state" replaced by a command that returns the live answer.** Fix what you cannot follow. This
takes precedence over any further band, magnitude or census work.

## 2. `_pivot_close_away` — the join is already written, and this changes GPT's task

`levels.py:76-86` **already performs the pivot→source-bar join** and already reads **exactly** the
two prices the ruled band needs: `bar.low` / `bar.close` for a support pivot, `bar.high` /
`bar.close` for a resistance pivot, side mirror correct, duplicate-index guard present. **It
converts them into a FRACTION; the band needs them as EDGES. That is the whole change.** GPT is
correctly told to *follow that function rather than invent a second join* — a second join would be
a second definition of the same object, and this ladder has spent a week on exactly that failure.

**HARD REQUIREMENT, and it is the sharpest half of the finding:** that function ends
`except Exception: return 0.5`. **Acceptable for a quality score. Unacceptable for a band edge.**
A failed join in a scoring context yields a mediocre score; a failed join in a band context yields
**a plausible zone unrelated to the candle that drew it — and nothing goes red.** **The band build
must fail loudly: raise, or emit an explicit refusal literal. It may not inherit the fallback, and
it may not be silently absent.** This sentence goes into GPT's first task verbatim.

The worker's correction of its own ALGO-110 column claim (`levels.py:116` — the frame carries
`wick` too; *no OHLC* was the load-bearing half) is accepted.

## 3. TWO LAWS MINTED

> **A GUARD WHOSE FILTER IS WRITTEN FROM THE FIXED SPELLING CANNOT SEE THE BROKEN ONE.**

The worker's first repair filtered bare basenames with `tok.startswith("ALGO-")` — **but the bug
IS a missing `ALGO-` prefix**, so the filter excluded the exact case the guard exists for, and D1
went green. **It was caught only because the battery plants the ORIGINAL defect rather than one of
the author's choosing** — which is now the standing requirement for any guard written to fix a
specific bug.

> **WHEN YOUR INSTRUMENTS AGREE WITH EACH OTHER, ONLY AN OUTSIDE READING CAN DISAGREE WITH THEM.**

`test_every_path_it_names_actually_exists` **passed the entire time three pointers were dead**,
because it checked a **typed list of five paths** — **trap 10 in the very document it guards**
(*"a hand-maintained list certifies only itself; derive populations, never type them"*). The guard
committed the trap the document documents, and **every automated check agreed with itself.** The
repair (derive the path set from the document, keep the five as a must-mention floor, carry a ≥15
floor so a broken extractor cannot pass silently) is ratified.

**And the observation in §5 is upgraded from observation to finding: three of the last four defects
were in INSTRUMENTS, not in the strategy** — the stale F2 anchor pin, the typed-list path guard,
and the filter written from the fixed spelling. **This campaign's remaining risk is concentrated in
its measuring tools, not in its subject**, and cold reading is the only technique that has found
that class.

## 4. ORDER OF WORK FOR THE REMAINING TIME

1. **Runbook cold read** (§1) — everything else waits.
2. Fold §2's hard requirement into GPT's first task verbatim, if not already carried.
3. Then, only if time remains: the AST sweep specified in ALGO-111 §5.
4. **Nothing lands. No question goes to the operator.** The two reserved-class asks stay drafted
   and unsent.

LESSON: the guard for a document about not typing populations was typing a population. **A rule
you have written down is not a rule you are following — check your own instruments against the
laws in your own documents, because that is the last place anyone looks.**

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
