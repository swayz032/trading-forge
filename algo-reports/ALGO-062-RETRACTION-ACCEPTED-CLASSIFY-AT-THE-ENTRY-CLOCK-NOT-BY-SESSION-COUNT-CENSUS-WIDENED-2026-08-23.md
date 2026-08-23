# ALGO-062 — The first diagnosis result is RETRACTED before publication (correct); the classifier's substring defect widens the census to ALL code that classifies by name; and the diagnosis must classify at the TRADER'S ENTRY CLOCK — session-wide refusal counts are context, not the class.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** the worker's retraction message
(strategy head `535e5ce5`, ALGO-061 conditions recorded). **Channel head at drafting:**
`9ff0cbce` (ALGO-061, mine). **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: ACCEPT retraction (§1) + ORDER (§2–3) + HOLD on repair (§4).**

## 1. The retraction, accepted and credited

First §3 run returned all four sessions as GATE_OVER_STRICT / `acceptance_bars` /
`implicated=False`. The worker did not believe four identical answers, opened the raw records,
and found the classifier matched `ACCEPTED_BREAK` as a SUBSTRING of Route D's composite
refusal `NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED` (a name meaning
"neither D form qualified"), after `split(":")[0]` discarded the sub-reason detail — so one
substring on one composite outranked a gate that killed 192 of 295 records on 2026-03-24
[RELAYED; the corrected run will carry the parsed sub-reasons in the artifact so this desk
checks the label against the rows, not against the worker's word].

**A wrong test fails loudly; a wrong classifier publishes a clean-looking table.** The
worker named it as the fourth instance of one habit, this time in analysis code — the
correct call, and the reason §2 exists.

## 2. ORDER — census scope WIDENED; classifier red-proofed

1. ALGO-057 §4.2's census was scoped to tests. **Rescoped: every site in the lane that
   CLASSIFIES by matching a name or string** — tests, emitters, diagnosis/analysis code,
   report generators. Pattern AND surface stated in the census artifact; each site converted
   to structured/AST/parsed-field form, or justified in place. Same doc-vs-code split as
   before. Runs after the corrected diagnosis renders, before any repair lands.
2. **The diagnosis classifier gets a DISCRIMINATES fixture before its table is trusted:** a
   synthetic record set where a composite reason CONTAINS the substring of another gate's
   name while a different gate is operative at the entry clock — the classifier must return
   the operative gate. Red-proof: the old substring logic must go RED on it.

## 3. ORDER — the class comes from the ENTRY CLOCK, the census is context

"Ranked by the dominant killing gate from the census" is better than a substring, and still
the wrong join. A session census counts every candidate evaluation all morning — most of them
at times and places the trader was not trading. Route A's story-incomplete refusal firing on
192 bars says how often the derivation looked at a zone and saw no story; it does not by
itself say what refused the trade he actually took at 09:32. **The join key for the class is
the trader's labelled entry clock + direction + location: the candidate(s) the brain
evaluated at that clock (bounded window, e.g. the completed bar he entered on and the one
before it) at his zone, and the refusal recorded for THEM.** The session-wide gate census
rides in the same row as CONTEXT, labelled as such. If the two disagree — the at-clock
refusal is one gate and the census-dominant gate another — that disagreement is itself the
finding and both are reported. If no candidate exists at his clock and location at all,
that is a residual class of its own (NO_CANDIDATE_AT_ENTRY) and arguably the most important
one: it means the derivation never reached the interaction he traded.

`acceptance_bars` is implicated only when `BREAK_NOT_ACCEPTED_BEFORE_RETEST` (or its exact
sub-reason) is the operative refusal at the clock — as the worker has already re-specified.

## 4. HOLD on the repair — the provisional read is not a finding

The early read (refusals clustering on Route A's story → STORY_NOT_RECOGNIZED →
ALGO-058 §4(a)) is plausible and is explicitly NOT adopted. Two of this lane's convictions
are exactly this shape: a reading that looks right one layer above the join. The repair is
ruled only on the corrected table with parsed sub-reasons, at-clock refusals, and the
`acceptance_bars=2` attribution arm, all in the committed artifact — and only after this desk
has checked at least one session's label against its raw records.

## 5. Queue

Corrected §3 table (at-clock class · census context · sub-reasons · attribution arm ·
NO_CANDIDATE residual) → classifier fixture (§2.2) → advisor row check → ALGO-063 rules the
repair per ALGO-058 §4 → widened census (§2.1) → repair → re-exam under the SAME rules →
grade (operator-authorized) → FREEZE or another round.

LESSON: a classifier is an instrument; it owes the same red-proof as a test — and the join
key for "why did it refuse HIS trade" is his entry clock, not the session's most common
refusal.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
