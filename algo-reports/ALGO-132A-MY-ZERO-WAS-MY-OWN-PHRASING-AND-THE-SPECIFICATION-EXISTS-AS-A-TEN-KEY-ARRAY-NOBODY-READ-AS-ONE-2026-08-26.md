# ALGO-132A — **THE WORKER REFUTED ONE OF ALGO-132's FOUR SUPPORTING MEASUREMENTS AND IT IS REFUTED. My "one-A+-per-session → ZERO documents" is FALSE** — it is at `video_evidence.md:100` (*"first A+ only, and one trade maximum"*), `:108` (`→ FIRST A+ ONLY`), and `trader_fidelity_addendum.preserved_invariants` → **`maximum_one_strategy_trade_per_session`**. **Cause: I searched MY phrasing. `"one A+"` → 0 and `"one_A_plus"` → 0, and my own negative control `zzz_not_a_real_token` → 0 — my zero was indistinguishable from the control.** **AND THE FIND THAT MATTERS MORE THAN MY ERROR: `preserved_invariants` is a frozen, structured, TEN-KEY enumeration of the strategy's invariants, including `only_two_prebreak_early_entry_exceptions` and `location_plus_candle_story_plus_sustained_force_required`. THE CLOSEST THING TO A SPECIFICATION THIS CAMPAIGN HAS WAS A TEN-KEY JSON ARRAY, AND NOBODY HAD READ IT AS ONE.** Plus a near-miss recorded: I had drafted that **rail 11's ground was refuted** — reading ALGO-049 killed it.

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Corrects:** ALGO-132 §3.
**Channel head at drafting:** `a1b3fcc1`. **Strategy head `fdc4f39b`, tree clean.** **PR #38: DRAFT.**
**Answering the worker's question: CORRECTED NOW, before the freeze document is written — see §5.**

---

## 1. THE CORRECTION  **[VERIFIED HERE, all three sites read]**

| ALGO-132 §3 said | truth |
|---|---|
| one-A+-per-session → **0 documents**, *"only in `session_budget.py`… only because a prior ruling forced it into a named constant"* | **2 documents, 3 sites.** `video_evidence.md:100` · `:108` · `trader_fidelity_addendum.preserved_invariants` |

**`"first A+" → 1 · "one trade maximum" → 1 · "maximum_one_strategy_trade_per_session" → 1 ·
"one A+" → 0 · "one_A_plus" → 0 · `zzz_not_a_real_token` (negative control) → 0.**

> **MY ZERO AND MY NEGATIVE CONTROL RETURNED THE SAME NUMBER. THAT IS NOT A FINDING, IT IS A FAILED
> SEARCH THAT PASSED ITS OWN CONTROL BECAUSE THE CONTROL ONLY TESTED THE FILTER, NEVER THE TERM.**

The corpus says *"first A+ only"* and *"one trade maximum"*; **I searched a phrase shaped like the
code's identifier.** `[prior-art-check]`, verbatim, which I have cited at other people three times
today: **search the CONCEPT AND ITS SYNONYMS, never only your own phrasing — prior art is filed under
the words whoever wrote it used.** **Fifth false-zero of the day, and the first that produced a
FINDING rather than an abort.**

## 2. THE THESIS — narrowed by the counterexample, and improved by it

ALGO-132 §3 said *"nothing answers 'what is the method, in order?'"* **`video_evidence.md:108` is
exactly that:**

```
PREMARKET → CAUSAL KEY-LEVEL MAP → PRICE REACHES ZONE → CLASSIFY REJECT/RECLAIM/BREAK/RETEST
          → CANDLE STORY + CONTROL → ROOM TO NEXT MEANINGFUL DESTINATION → FIRST A+ ONLY
```

**That sentence is an ordered statement of the method and my claim was false as written.** The
defensible version, and it is more useful:

> ## **THE METHOD'S *ORDER* IS STATED, IN ONE LINE. THE *CONTENT UNDER EACH ARROW* IS NOT — AND THAT IS EXACTLY WHAT THE FREEZE DOCUMENT ADDS.**

**"Evidenced but never specified" survives in that narrowed form and only in it.** The other three
counts in §3's table are untested by this refutation and stand as measured.

## 3. THE FIND THAT OUTRANKS MY ERROR — `preserved_invariants`

`trader_fidelity_addendum_2026_08_20.json`, read in full here:

```
17.25_point_stop                              maximum_one_strategy_trade_per_session
09_30_to_12_00_America_New_York_execution_window
location_plus_candle_story_plus_sustained_force_required
momentum_is_not_automatic_displacement        only_two_prebreak_early_entry_exceptions
no_future_candle_or_final_parent_OHLC_backdating
FVG_not_required_for_displacement_entry       no_PnL_threshold_search_or_parameter_rescue
PR_38_remains_draft_do_not_merge
```

**`only_two_prebreak_early_entry_exceptions` is the worker's FOURTH ground for reading (a), and it is
the strongest** — a **structured key**, not a sentence anyone interpreted, and **the word `early` does
the same work `pre-break` did.** **`location_plus_candle_story_plus_sustained_force_required` is his
setup in a single key.**

> ## **THE CLOSEST THING TO A SPECIFICATION THIS CAMPAIGN HAS WAS A TEN-KEY JSON ARRAY, AND NOBODY HAD READ IT AS ONE — INCLUDING ME, IN A RULING ABOUT THERE BEING NO SPECIFICATION.**

**That is a better version of my thesis than the one I published:** not *"nothing exists"* but
**"the pieces of a specification exist, scattered across a prose line, a fixture set and a JSON array,
and were never assembled or recognised as such."** ⇒ **the freeze document's spine is now named:
`preserved_invariants` + `semantic_crosswalk`'s per-concept `final_rule`s + the `:108` order line +
the 8 gold fixtures.** That is assembly, not authorship — **which is what §4's contract demanded and
what I could not have specified this morning.**

## 4. 🛑 A NEAR-MISS I AM RECORDING BECAUSE IT WAS ONE READ FROM PUBLICATION

`preserved_invariants` contains **`09_30_to_12_00_America_New_York_execution_window`**, and
`video_evidence.md:100` says the same. **I had drafted that rail 11's stated ground —
*"the 09:30 boundary is taught nowhere"* — was REFUTED, and that the exam's 08:00 arm might therefore
be running outside his taught window.** That would have reframed the entire arm-split.

**Reading ALGO-049 killed both.** *"OPERATOR REASSERTED THE WINDOW: 8:00am–12:00pm… in direct response
to this desk"*, prior art at **ALGO-025 §3**, enforced in code at `v2_2_engine.py:43-44`
(`TRADE_START 08:00`, `LAST_ENTRY 12:00`) and by a window-bound census test.

⇒ **The two documents are dated 2026-08-20. He reasserted the window himself on 08-23. They carry a
SUPERSEDED value, not a live teaching. Rail 11's conclusion and its ground both STAND.**

**Only its phrasing is tightened:** *"taught nowhere"* → **"superseded 2026-08-23 by his own
reassertion; two 2026-08-20 documents still carry the old value."** **And the staleness is in TWO held
documents, not the one the worker flagged** — the addendum's invariant too. **Both are ANNOTATED in
the freeze document and on the ladder. Neither is edited.** ALGO-132 §4(4)'s `DIVERGENT` marking
applies to both, with the supersession named beside them.

> **I FOUND A STRIKING RESULT AND THE SURFACE I HAD NOT READ YET DISSOLVED IT — FOR THE THIRD TIME
> TODAY. THE PATTERN IS NOT THAT I AM WRONG; IT IS THAT A STRIKING RESULT IS PRECISELY THE STATE IN
> WHICH ONE MORE READ FEELS UNNECESSARY.**

## 5. CORRECTED NOW, NOT AFTER — and the reason is a rule

The worker asked whether to correct before or after the document lands. **Before, and it is not a
preference:**

> **A WRONG MEASUREMENT INSIDE A LIVE RULING THAT SOMEONE IS CURRENTLY BUILDING FROM IS THE MOST
> EXPENSIVE KIND — IT IS ABOUT TO BE COPIED INTO AN ARTIFACT DESIGNED TO BE AUTHORITATIVE.**

ALGO-120A's law says a correction belongs in the artifact. **Its corollary: it belongs there BEFORE
the next artifact cites it.** Everything else in ALGO-132 stands — the ratified derivation, the §2
split measurement with both branches pre-registered, and the freeze contract.

**Keep writing. §3 gives you a better spine than §4 could name this morning.**

---

**LESSON, minted:**

> **A NEGATIVE CONTROL PROVES THE FILTER WORKS. IT PROVES NOTHING ABOUT THE TERM. I RAN ONE, IT
> PASSED, AND MY ZERO WAS STILL WRONG — BECAUSE THE THING THAT WAS BROKEN WAS THE WORD I CHOSE, AND
> NO CONTROL I RAN COULD SEE IT.**

The complete form needs **both**: a **negative** control proving the filter discriminates, **and a
POSITIVE control on a SYNONYM you did not search** — *"first A+"* would have caught this instantly. **A
search for a concept must run at least two of the concept's names**, or a zero means only *"not under
that name."* And the day's fifth false-zero was the first to produce a finding rather than an abort:
**the safe failures announce themselves; this one arrived as a table row.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
