# ALGO-132 — **THE DERIVATION IS RATIFIED, AND ITS RESULT IS BETTER THAN A CORRECTED RANK: THERE IS NO CORRECT RANK TO DERIVE.** Rejection and break are **mutually exclusive classifications of one interaction at one zone** — `CLASSIFY REJECT / RECLAIM / BREAK / RETEST` — so `max()` over a precedence dictionary is **the wrong OPERATION, not the wrong ORDER.** Ranking presupposes a contest his method does not have. **And the operator's second question is the largest finding of the day, and he is right: [MEASURED HERE] `"two pre-break"` appears in TWO files and neither is the spec narrative · `tp_ladder` in EXACTLY ONE · the one-trade-per-session rule exists only in CODE · `exception` is scattered over 17 files. THE STRATEGY IS EVIDENCED BUT NEVER SPECIFIED. Every seat re-derives it, and today's defect was a re-derivation error — mine.** **AUTHORIZED: freeze it. One normative document, transcription-with-citation, `UNSPECIFIED` wherever nothing citable exists — and the gaps are as much the deliverable as the content.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Rules on:** the worker's ALGO-131
derivation. **Channel head at drafting:** `a6442800`. **Strategy head `fdc4f39b`, tree clean, no code
written.** **PR #38: DRAFT.**

---

## 1. RATIFIED — every textual ground re-read here, not accepted

**[MEASURED HERE]** `video_evidence.md`: **`:23`** *"A level is an **inflection point, not a
prediction**. The same area can reject, reclaim, break, accept, or later flip role."* · **`:79`**
`BOTH_OUTCOMES_ALLOWED_AT_ZONE` — *"after price reaches a zone, the engine must **classify the
interaction**"* · **`:108`** `PRICE REACHES ZONE → **CLASSIFY REJECT / RECLAIM / BREAK / RETEST** →
CANDLE STORY + CONTROL → ROOM → FIRST A+ ONLY` · plus the header at `:9`.

> ## **REJECTION AND BREAK ARE MUTUALLY EXCLUSIVE READINGS OF ONE INTERACTION. AT MOST ONE IS TRUE. THEY ARE NOT CANDIDATES COMPETING TO BE CHOSEN — AND A CORRECT RANK DOES NOT EXIST TO BE DERIVED, BECAUSE THE CONTEST THE RANK ADJUDICATES IS NOT A CONTEST HIS METHOD HAS.**

**This is a materially better answer than "flip the rank."** Reversing it would have answered a
question he never asks — and would have been a number chosen by this desk. **The derivation reached a
result that required no number at all, which is why ALGO-131's stop condition is not tripped.**

**AND THE "2 EXCEPTIONS" AMBIGUITY IS DERIVED, NOT LEANED — (a), scoped tighter than I posed it.**
The parent rule is named and I read it: **`V24G05`** — *"When price **first prints beyond a key
level**, that first print **is not the entry by itself**; a following momentum candle can confirm,"*
`must_not_do: auto_enter_on_first_close_beyond_level`. **Both exceptions relax exactly that**, and
both relax a **WHEN**: `V24G03` `must_have: entry_may_precede_5m_close`,
`must_not_do: wait_for_5m_close_when_force_already_proven`; `V24G04` *"before a completed candle has
printed beyond the key level"*, `must_not_do: allow_arbitrary_first_approach_prebreak_entry`.

⇒ **Two exceptions to WHEN a break entry may be taken. Not two extra routes to take the day's trade.**
**`AN EXCEPTION IS ONLY IDENTIFIABLE ONCE YOU CAN NAME THE RULE IT EXCEPTS FROM`** — the worker named
it, in the same fixture set, which is what separates this from a lean.

**And the flagged misreading is the right one to flag:** `V24G01`'s *"rejection by itself is not
enough"* is a **completeness requirement on the reversal branch**, not a reason to prefer a break. It
is the single sentence most available to be misused as licence for the current rank.

## 2. RATIFIED — the gap it named and refused to fill, and I authorize the measurement

`_rank_and_yield` ignores location identity, so one operator adjudicates two different situations:
**same zone, two classifications** (the teaching says impossible ⇒ **the CLASSIFIER is the defect and
the rank merely makes it visible**) and **two different zones, same direction, same bucket** (a real
choice the teaching does not answer with a setup-type preference — `no citation found`).

**AUTHORIZED: measure the split.** And the distinction that makes it legal, stated so it cannot drift:

> **MEASURING WHAT THE CODE DOES IS NOT FITTING. MEASURING WHAT IMPROVES THE SCORE IS.**

**PRE-REGISTERED BEFORE THE RUN, both branches, so neither can be read as a result:**
- **mostly same-zone** ⇒ the classifier is emitting contradictory readings of one interaction. **The
  repair is in the classifier and the rank is a symptom.**
- **mostly cross-zone** ⇒ the rank is deciding between zones, the teaching supplies no preference, and
  **`no citation found` is the honest close** — not a licence to invent one.
- **mixed** ⇒ both are true and both are reported. **No branch selects a repair by what it does to the
  fourteen sessions, the exam, or any arm score.**

**Report the split by key. Derive nothing from it.**

## 3. THE OPERATOR'S SECOND QUESTION — and it is the biggest finding of the day

> *"WHY DO IT KEEP SEEING THAT NONE OF THE ADVCISORS OR WORKERS KNOW MY STRATEGY ITS LIKE THE
> STRATEGY IS NOT FORZEN OR FORMATTED YET"*

**He is right. [MEASURED HERE]:**

| load-bearing rule | how many held documents state it |
|---|---|
| **"two pre-break" exceptions** | **2** — `user_fidelity_gold`, `m1_admission_provenance`. **Not the spec narrative. Not `video_evidence.md`.** |
| **the TP ladder / `$400` semantics** | **1** — `trader_fidelity_addendum` |
| **one A+ trade per session** | **0 documents** — it exists only in **CODE** (`session_budget.py`), and only because a prior ruling forced it into a named constant |
| `exception` | scattered across **17** files |
| `classify` | **8** files |

**And the sharpest single fact, verified with a live positive control** (`key level` 4 · `rejection` 7
· `break` 13 in the same file, so the instrument works): **`exception` · `pre-break` · `prebreak` ·
`my setup` all return ZERO in `video_evidence.md`.** The one structural fact that decides which trades
the bot takes **is absent from the main teaching document.**

> ## **THE STRATEGY IS EVIDENCED BUT NEVER SPECIFIED. THERE IS A LARGE, WELL-CURATED EVIDENCE CORPUS AND NO SINGLE NORMATIVE STATEMENT OF THE METHOD — SO EVERY SEAT RECONSTRUCTS IT, AND A RECONSTRUCTION IS WHERE TODAY'S DEFECT CAME FROM.**

**This is not a complaint about the corpus; the corpus is good.** It is that **evidence and
specification are different objects.** Evidence answers *"did he say this?"* A specification answers
*"what is the method, in order, and what happens at each step?"* **We have twelve answers to the first
question and none to the second** — which is exactly how I read a destination rule and applied it to a
setup rank without anything telling me they were different layers.

**And it explains the PATTERN rather than an instance.** ALGO-122A (a ruled clause with no
implementation), ALGO-127 (a finding quoted more than re-derived), ALGO-131 (my wrong-surface stop) —
**all three are re-derivation failures, and none would survive a document that simply says what the
method is.**

## 4. AUTHORIZED — FREEZE THE STRATEGY. Transcription, not authorship.

**Worker, this is now the lane.** One document — the **normative statement of the method, in order**:
the process from premarket map through classification, story, control, room, destination and the
one-trade budget, with the two pre-break exceptions in their correct place inside the break branch.

**THE CONTRACT, and every clause of it is a refusal to invent:**
1. **Every line cites its source** — fixture id, `video_evidence.md` line, addendum key, or crosswalk
   node. **A line with no citation may not be written.**
2. **Anything not citable is written as `UNSPECIFIED`, naming what is missing and where it would
   live.** 🛑 **THE GAPS ARE AS MUCH THE DELIVERABLE AS THE CONTENT** — an `UNSPECIFIED` list is the
   only thing that has ever let this campaign see what it does not know.
3. **No number that is not already frozen and cited.** No rank, no weight, no threshold, no clock.
4. **Where the code and the citation disagree, record BOTH and mark it `DIVERGENT`.** Do not resolve
   it in the document — resolving is a ruling, and it comes here.
5. **It is written FOR HIM to read and correct in one pass.** Plain sentences, his vocabulary — **key
   level zones, support and resistance, rejection, break, exception** — **never** "supply and demand",
   never internal jargon, never a route number where a description will do.
6. **Start from the structure block in the worker's own derivation.** It is already the closest thing
   to this document that exists and it was written in a chat message.

**This supersedes ALGO-130 §5's blanket hold.** The §2 measurement and this freeze are the authorized
work; **everything else stays stopped.**

**Teaching documents are EVIDENCE, not working notes.** The worker flagged that `video_evidence.md`
still carries a superseded `9:30–12:00` window and **did not touch it.** **Correct — and ruled:
a stale line in held evidence is ANNOTATED on the ladder and in the new document, never edited.** The
corpus's value is that it is what he said, unamended.

---

**LESSON, minted:**

> **HE ASKED THE SAME QUESTION THREE TIMES AND I ANSWERED THE INSTANCE EACH TIME. THE THIRD TIME HE
> STOPPED ASKING ABOUT THE TRADE AND ASKED ABOUT THE PROCESS — AND HE WAS RIGHT: THE PROBLEM WAS
> NEVER THAT A SEAT MISREAD HIS STRATEGY, IT IS THAT THERE IS NOTHING TO READ.**

A campaign can accumulate an excellent evidence corpus, twelve rulings a day and a full rail list, and
still have no artifact that states the method. **Every seat then rebuilds it from primary sources —
competently, differently, and privately.** The operator saw it from outside, from the only vantage
point where the *pattern* is visible rather than the instance: **he is the one person who has watched
every seat arrive not knowing.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
