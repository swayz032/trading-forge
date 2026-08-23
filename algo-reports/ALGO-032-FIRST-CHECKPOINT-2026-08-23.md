# ALGO-032 — First derivation checkpoint: the new brain refuses 60 of 128. One question for you.

**Strategy head:** `b30745bdb240` (pushed, verified) · PR #38 **DRAFT / DO NOT MERGE** ·
still **BUILD ONLY** · kernel/entries/force/engine **byte-identical to `068bb24a`** · grade
still in flight.

Item 1 now has three layers built and the first checkpoint run, per your §2 order.

---

## 1. The checkpoint

    kernel Route A grants   128
    new machine grants       68     refuses 60  (46.9%)
    states   GRANTED 68 · WAIT_PRICE_HAS_NOT_EARNED_THE_LEVEL 55 · WAIT_STORY_INCOMPLETE 5
    refusals MERE_APPROACH_WITHOUT_TOUCH 55 · TOUCHED_BUT_NO_RECOGNISED_INTERACTION 5

**It discriminates** — which is the only thing a checkpoint can establish. Refusing nothing would
mean the new machine is as permissive as the literal it replaces; refusing everything would be
equally uninformative. **Whether it keeps the RIGHT ones is a fidelity question the exam answers
after the grade**, and the artifact carries that sentence in its own body so nobody reads 46.9%
as a result. It steers no rule, selects no threshold.

No second loop: it hooks `xray_session(on_rejection_candidate=...)` and sees exactly what the
kernel's own ranker left standing.

---

## 2. THE QUESTION — `touch_and_reject` matches **0 of 128**

And it is **not** shadowing: the classifier now reports *every* matching form, and it is still
zero.

    ALL matches: prior_momentum 60 · sweep_and_reclaim 37 · doji_pin_inside 28 ·
                 penetrate_and_reclaim 20 · failed_breakout 16 · touch_and_reject 0

**My reading of the mechanism.** The trigger bar handed to the gate is the **synthetic force
row** — a partial composite of the completed 1m sub-bars inside a *still-forming* 5m parent, not
a completed candle. A forming partial rarely carries a large rejection wick, **because the wick
forms as the candle completes.** Looking for single-bar rejection geometry *on the trigger* is
looking for a shape that cannot be there yet. Corroborated by `prior_momentum_after_rejection`
matching 60 of 128 — the rejection lives on an earlier **completed** bar, which is what that
branch tests.

**What I am NOT concluding.** That the trader never takes a touch-and-reject. Only that this
pipeline cannot *see* one on the trigger bar.

**Your call:** do the frozen teachings intend the rejection to be read on the **completed prior
bar**, with the trigger carrying only force and follow-through? That is a textbook question, and
ALGO-029 §2 says the teachings steer and the checkpoint may not. **I have not changed anything
on the strength of it.** Recorded `OPEN` in the artifact.

---

## 3. Three defects in my own code, all found by real data rather than review

1. **Five refusals named the wrong reason.** Cases in `WAIT_STORY_INCOMPLETE` reported
   `MERE_APPROACH_WITHOUT_TOUCH` — they *had* touched. A refusal that misdirects is worse than a
   silent one, and after the 27th the reader is the operator with GPT. New distinct reason, and a
   test now forbids any refusal claiming "never touched" when the approach was real. **This is
   the exact defect my own state-machine test warned about, in code I had committed hours
   earlier.**
2. **An elif chain shadowed the census.** Fixed by reporting every matching form.
3. **And threading that through caught a third:** `all_kinds` was added to `Interaction` but not
   to `DerivedStory`, so the real checkpoint printed an **empty** all-matches census while the
   unit test — which reads `Interaction` directly — passed. **A unit test on the inner object
   does not prove the outer path carries the value.** The empty census caught it.

---

## 4. Where item 1 stands

**Built, BUILD-ONLY, not imported by kernel/entries/engine/signal (enforced by test):**
the derivation layer (approach + the spec's six interactions), the story layer
(APPROACH/FIGHT/DECISION, none a literal, every named negative fixture refused), and entry
authority as a **WAIT-by-default state machine** stopping at the *earliest* unmet requirement,
four routes with a fifth refused loudly.

**Remaining in item 1:** the window amendment (hazard map already landed — ROLE-1 only, the
`kernel.py:132` anchor untouched) and the §7 mutation campaign.

**Also done:** item 3 safety core, item 6's 1(a) runbook and 1(c) kill switch.
**Not started:** items 4 and 5, and pack items 1(b), 1(d), 1(e).

Suite **7 failed / 1218 passed**, enumerated; same 7, all outside this lane. **No PnL, realized
outcome, winner/loser label or clean-edge result participated in any decision in this packet.**
