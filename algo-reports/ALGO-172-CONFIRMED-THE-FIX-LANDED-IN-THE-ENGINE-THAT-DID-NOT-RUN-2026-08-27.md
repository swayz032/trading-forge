# ALGO-172 — **CONFIRMED AT SOURCE, AND IT IS THE FIRST DEFECT THIS CAMPAIGN HAS PROVEN ALL WEEK THAT NOTHING LATER RETRACTED. `kernel.py:219` ITERATES DECISIONS FROM `08:00` AND `kernel.py:222` HARDCODES THE MAP TO `09:30`. TWO `08:07` TRADES USED A ZONE THAT DOES NOT EXIST IN THE CAUSAL MAP — PRESENT AT THE `09:30` ANCHOR, ABSENT AT `08:00`, WITH THE POSITIVE CONTROL PASSING ON BOTH.** **🛑 AND THE STRUCTURE OF THE BUG IS WORSE THAN THE BUG: `v2_2_engine.py:875` CARRIES A COMMENT CELEBRATING THE DELETION OF *"a second copy of the 09:30 literal"* — AND THAT DELETION LANDED IN THE ENGINE THAT IS ALREADY CAUSAL, WHILE THE KERNEL THAT ACTUALLY RUNS KEPT ITS OWN COPY. THE SECOND COPY WAS NEVER DELETED. IT MOVED. THE FIX AND ITS CELEBRATION ARE IN ONE FILE; THE DEFECT IS IN THE OTHER; AND THE COMMENT READS AS IF IT COVERS BOTH.** **[VERIFIED HERE at `63fff63e`, all four lines read directly.]**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `ccf2bcdf`.
**Strategy head `63fff63e`.** **PR #38: DRAFT / DO NOT MERGE. Read-only trace, no v2.4 file written.**

---

## 1. CONFIRMED — **[VERIFIED HERE, independently at the lines]**

| line | text |
|---|---|
| `kernel.py:216` | `def iter_actionable_candidates(env, dte, p, ...)` — **the function that produces the trades** |
| `kernel.py:219` | `bucket_starts = _bucket_starts(r5, one, dte, as_of)` — **decisions begin `08:00`** |
| **`kernel.py:222`** | **`open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)`** |
| `kernel.py:229` | `build_entry_locations_v24(env, dte, open_ts, p)` — **the map is built at that anchor** |
| `v2_2_engine.py:924` | `open_ts = session.index[0]` — **the OTHER engine is causal** |

| session | `09:30` anchor | `08:00` anchor | positive control |
|---|---|---|---|
| `2026-03-30` | 37 locations, **flagged zone PRESENT** | 37 locations, **zone ABSENT** | ✅ 37 returned |
| `2026-04-02` | 47 locations, **flagged zone PRESENT** | 45 locations, **zone ABSENT** | ✅ 45 returned |

> ## **THE TWO `08:07` TRADES USED A ZONE THAT DOES NOT EXIST IN THE MAP THE BOT COULD CAUSALLY HAVE HAD. THE POSITIVE CONTROL MEANS EACH ABSENCE IS EVIDENCE ABOUT THE ZONE AND NOT ABOUT AN EMPTY CALL.**

**And it nearly closed the other way, which is why I believe it.** `v2_2_engine` **is** causal — `r5`
floored at `TRADE_START`, `open_ts = session.index[0]` — and you spent twenty minutes believing you had
published a false positive before establishing that **`iter_actionable_candidates` is the path the walk
used.** **A confirmation that survived its author's own attempt to kill it is worth more than one that
arrived clean.**

## 2. 🛑 THE ARTIFACT HAD ALREADY SAID SO, AND BOTH OF US DOUBTED IT

**The pinned capture's `map_anchor` field reads: `"09:30 session open, mirroring candidate_xray.py and
kernel.py"`.** **You flagged it as a limitation to be doubted. I READ THAT EXACT STRING MYSELF EARLIER
TODAY, in the first minutes of this lane, and did not act on it either.**

> ## **THE ANSWER WAS IN A METADATA FIELD OF A COMMITTED ARTIFACT, IN PLAIN LANGUAGE, NAMING THE TWO FILES. IT SURVIVED BEING READ BY BOTH SEATS BECAUSE IT LOOKED LIKE PROVENANCE BOILERPLATE RATHER THAN A FINDING.**

**Checking was still correct** — an artifact's self-description is a claim. **But `[absence-claim]`'s
sibling applies: an artifact that TELLS you its own anchor has given you the hypothesis for free, and
the cost of that free hypothesis was a day.**

## 3. THE STRUCTURAL FINDING, WHICH OUTLIVES THIS BUG

**`v2_2_engine.py:875` records that a stale duplicate of the `09:30` literal once made a window
amendment a silent no-op — and that it was deleted.** **It was deleted THERE.** The kernel kept its own.

> ## **A FIX THAT LANDS IN ONE OF TWO ENGINES, WITH THE POST-MORTEM COMMENT BESIDE IT, READS AS IF IT COVERS BOTH. THE COMMENT IS THE MOST CONVINCING THING IN THE FILE AND IT IS TRUE ONLY OF THE FILE IT IS IN.**

**And ALGO-165 called the shape before the trace ran:** *"a comment that names the cost of moving a
constant is not evidence the constant is correct."* **It is now worse than that — the comment names the
cost of a DUPLICATE it believes it removed, in an engine that never had the problem.**
⇒ **`[unjoined-duplicates-rot-together]` for the third time today, and this instance is CODE rather
than prose: two literals, no join, one fixed, and a comment asserting the class was closed.**

## 4. SCOPE — HELD, AND I HOLD IT TOO

- **EXISTENCE, not STATE.** ALGO-137's refutation stands untouched; `zone_state_at_v24` really is
  re-evaluated per bucket. **Only one of those two objects was ever traced and only one is claimed.**
- **`2 of 19` in-window decisions is the honest denominator** and you claim nothing beyond it.
  **Ratified — and `[instance-not-condition]` says the next move is the enumeration, not a bigger claim.**
- **Nothing here rehabilitates the clean-room**, which failed on its own terms at `0 of 28`.
- **Nothing here rehabilitates v2.4 either.** Its `+1.43 sd` / `p = 0.112` map coverage is a separate
  measurement and is untouched by this.

## 5. WHY IT MATTERS — stated at exactly its proven size

**Memory records the bullet spent before `09:30` on `14 of 14` sessions.** **IF the enumeration confirms
the mechanism broadly, then a material share of v2.4's traded behaviour is not reproducible live** —
**and a backtest containing trades the bot could not have taken overstates whatever it reports.**
**That bears directly on the operator's own constraint: you cannot look for an edge in a curve that
contains non-causal fills.** **`-$21,075` / 42% is the pre-repair number and it may not mean what it says.**

**🛑 I am stating that as a CONDITIONAL and it is not a finding yet.** `2 of 19`.

## 6. AUTHORIZED

1. **RUN THE ENUMERATION.** The mechanism is named and the instrument exists: **for EVERY decision
   strictly inside `08:00-09:30` across all 14 sessions, does its location set contain a zone absent
   from the `08:00`-anchored build?** **Report by key — decision `ts`, zone id, present-at-`09:30` /
   absent-at-`08:00` — with the same positive control per call.** **Report the count of affected
   DECISIONS and, separately, of affected BULLETS.** Derive nothing.
2. **THEN HOLD.** **No repair.** Moving `kernel.py:222` changes which zones exist and would invalidate
   every campaign number measured against the current map — **that is a ruling, and it is one that
   costs the operator his baseline, so it is not a worker's edit and not this desk's unilateral call.**
3. **Standing prohibitions unchanged:** no fourth map build · no proximity term · no recency · no
   tolerance · no linkage change · no v2.4 edit · no Monte Carlo · no adoption decision inside a result.

---

**LESSON, minted:**

> **THE MOST CONVINCING ARTEFACT IN THE CODEBASE WAS A COMMENT DESCRIBING A BUG THAT HAD ALREADY BEEN FIXED — IN THE OTHER FILE. IT DOCUMENTED THE EXACT DEFECT THAT WAS STILL LIVE TWENTY LINES FROM WHERE IT WAS STILL LIVE, AND ITS PAST TENSE IS WHAT MADE IT INVISIBLE.**

**A post-mortem comment is the strongest possible signal that a class of defect was UNDERSTOOD, and it
is no evidence at all that the class was CLOSED.** **The more precisely it describes the mechanism, the
more completely it persuades a reader that the mechanism is gone.**

> **WHEN A COMMENT SAYS A DUPLICATE WAS REMOVED, GREP FOR THE DUPLICATE. THE FIX AND THE LITERAL DO NOT HAVE TO LIVE IN THE SAME FILE, AND THE ONE THAT RUNS IS NOT ALWAYS THE ONE THAT WAS FIXED.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
