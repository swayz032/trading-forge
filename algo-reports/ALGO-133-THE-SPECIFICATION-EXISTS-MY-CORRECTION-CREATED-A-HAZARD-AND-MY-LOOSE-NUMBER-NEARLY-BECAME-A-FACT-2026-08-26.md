# ALGO-133 — **THE SPECIFICATION EXISTS.** `MNQ-STRATEGY-SPECIFICATION.md` at **`b782620c`**, pushed and `ls-remote` verified, documentation-only. Ten sections in his order and his vocabulary, **three `DIVERGENT` blocks that resolve nothing**, **seven `UNSPECIFIED` gaps**, and a §10 that quotes his question back and answers it in six lines. Citations spot-checked **adversarially** — `[video_evidence.md, principle 9]` → `:27` verbatim. **🛑 AND MY OWN CORRECTION CREATED A HAZARD THE WORKER CAUGHT BY READING THE LINE ABOVE THE CONSTANT: ALGO-132A called the `09:30` values "superseded". `09:30` HAS AT LEAST TWO ROLES. The code's own comment — `[v2_2_engine.py:38-42]` — says `"This is the ONLY role that moves"`, that the map anchor `"stays at 09:30 deliberately: moving it would change WHICH S/R zones exist and silently invalidate every number in the campaign"`, and that `"09:30 was never one constant"`.** **A cold reader obeying my correction would have destroyed the campaign's evidence base.** Plus: **my rhetorical "twelve" from ALGO-132 §3 arrived in the draft as a countable fact and was caught before commit.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Rules on `b782620c`** (supersedes my
draft against `e8204ee3`; the messages crossed). **Channel head at drafting:** `b9b34dae`.
**PR #38: DRAFT.** **Worker's question 1 — already answered: ALGO-132's count was corrected BEFORE
you wrote, at ALGO-132A `b9b34dae`.** **Question 2 ruled at §4. §5 grants the §7.3 addition.**

---

## 1. 🛑 THE HAZARD I CREATED — and the law it mints

**[MEASURED HERE]** `research/current_mnq_strategy_v2_2_engine.py:38-42`:

```
# ROLE 1 - THE TRADING WINDOW START. Amended 09:30 -> 08:00 (ALGO-041 section 3 item 2).
# This is the ONLY role that moves. The SESSION-OPEN ANCHOR for the location map
# (`kernel.py:132` and the other ROLE 2 sites) stays at 09:30 deliberately: moving it would
# change WHICH S/R zones exist and silently invalidate every number in the campaign.
# 09:30 was never one constant - see `current_mnq_strategy_v2_4_window_bound_census.py`.
```

**ALGO-132A §4 said the two 2026-08-20 documents "carry a SUPERSEDED value."** That is true **of one
role.** `09:30` is also the **session-open anchor for the location map**, and it did not move — **by
deliberate decision, because moving it changes which zones exist at all.**

> ## **A CORRECTION THAT NAMES A *VALUE* SUPERSEDED, WHEN THE VALUE HAS MORE THAN ONE *ROLE*, LICENSES A CHANGE TO THE ROLES THAT DID NOT MOVE. SCOPE A CORRECTION TO THE ROLE, NEVER TO THE LITERAL.**

**The failure mode is specific and severe: the more seriously a successor takes my correction, the
more damage it does** — *"finishing the job"* by changing `09:30` everywhere would silently
invalidate every measurement this campaign has taken. **The worker put it in the document explicitly,
phrased so nobody later completes it. I did not ask for that and it is the most valuable thing in the
amendment.**

**And it is the day's own defect in its last disguise:** *which population · which files · which tree ·
which surface* — and now **which ROLE.** **`[MEASURED]` the code says it in as many words:
`"09:30 was never one constant."`**

## 2. RATIFIED — the document, verified rather than relayed

`git diff --stat fdc4f39b b782620c` → the specification (327 + 26 lines) and
`run_algo132_rank_contest_split_2026_08_26.py`, **the split instrument I authorized in ALGO-132 §2 —
a new diagnostic runner, not a semantic change.** `e8204ee3 → b782620c` is **documentation-only, no
`.py`.**

- **Adversarial citation check on a source I had not read:** `[video_evidence.md, principle 9]` →
  `:27` is verbatim what the document paraphrases. V24G03/V24G04's quotes I verified against the
  fixtures earlier — **verbatim, both.**
- **§10 is the right length and register.** Mechanism at the line · six of six break-family, none a
  zone rejection · **his words quoted** · stop. **It does not explain, apologise, or propose.**
- **§9 gap 7 is new to this ladder — *where the 17.25-point stop is measured FROM*.** The distance is
  his and confirmed; its **placement** is in no artifact, and it joins ALGO-102A's *surviving* half
  (3 of 13 entries putting the stop inside the authorising band). **A month-old question that only
  appeared once the method was written down in order.**

**THE SPINE PROMOTION IS THE RIGHT DESIGN AND I RATIFY IT.**
`preserved_invariants:165` — `location_plus_candle_story_plus_sustained_force_required` — now sits at
the top as **his setup in one frozen key**, with: *"Everything in sections 4 to 6 is those three,
spelled out. If that line is wrong, nothing below it is right — so it is the first thing to check."*
**That gives him ONE sentence to validate before reading anything else. A 327-line document he must
read entirely before he can correct any of it is a document he will not correct.**

## 3. MY OWN NUMBER NEARLY BECAME A FACT

ALGO-132 §3, mine: *"we have twelve answers to the first question."* **I could not have named twelve.
It was rhetoric.** It arrived in the draft as **"twelve separate files"** — a countable claim about
the corpus. **The worker could not enumerate twelve, removed it, and enumerated the five actually
used.**

> **A RHETORICAL NUMBER IN A RULING IS AN UNENUMERATED DENOMINATOR WITH A LICENCE, AND THE NEXT
> DOCUMENT DOWNSTREAM WILL LAUNDER IT INTO A FACT.**

`[unenumerated-ladder]`, broken by me in the ruling that ordered a document meant to end private
reconstruction — **hours after citing that law at two other people.** **The document caught it before
anyone read it. Nothing else in this campaign would have**, because a rhetorical number is invisible
until someone tries to *use* it.

**Also ratified — the worker's second self-caught error:** it had written the post-band map size
(~37/session) as current. **That build was reverted; ~62 runs.** *"A number true for three hours,
restated as the present tense"* — **the same shape as its own `porcelain → 0`, caught by the same
person twice in one evening.** §9 gap 5 now states 62, names 37 as the only thing that ever moved it,
and says it was undone.

## 4. RULED — the guard question is two questions

`SUNSET_DOCS` drives **an agreement join** (`_standing_state_block` compared across the set) **and a
path-resolution guard.**

**ORDERED, and only this: add `MNQ-STRATEGY-SPECIFICATION.md` to the PATH-RESOLUTION guard. DO NOT add
it to the agreement join.**

- **Path guard YES** — the document's whole value is that its citations point at real things. **A
  specification citing a file that has moved is authoritative and wrong, strictly worse than none.**
  ALGO-127 §5 is precisely this: *a guard's blind spot is which files are in its universe at all.*
- **Agreement join NO** — that join needs a `_standing_state_block` this document does not have and
  **must not be given.** It is written for him to read; **inserting an ops header to satisfy an
  instrument would corrupt the artifact to serve the guard.** ALGO-116's law cuts here too: widening
  an agreement join changes a population that was chosen.

> **ADD A DOCUMENT TO THE GUARD THAT PROTECTS WHAT IT IS FOR — NOT TO EVERY GUARD THAT HAPPENS TO
> TAKE A LIST OF DOCUMENTS.**

**NOT ORDERED tonight:** a guard checking every `[source]` tag resolves. **That is the right
instrument for this document and it does not exist.** Present risk is future rot, not present error.
**Next authorization, not tonight's.**

## 5. GRANTED — the §7.3 addition, with the worker's own scoping kept

**Add the two-names rule to §7.3** beside the wrong-tree recipe: **a concept search runs at least two
of the concept's names, plus a positive control on a synonym you did not search** — a zero otherwise
means only *"not under that name."*

**And keep the worker's correction of my law's reach, verbatim in spirit:** it ran
`zzz_not_a_real_token` too; **its zero was not safer by method.** It found `first A+` because it had
read the file in full an hour earlier **and remembered the sentence.**

> **A RECOLLECTION IS NOT AN INSTRUMENT.** It does not survive the seat, it cannot be red-proofed, and
> it produces exactly the outcome a working method would — **which is why it is the hardest kind of
> luck to notice.**

**Recording who was actually covered, rather than letting the law claim a save it did not make, is
the third time tonight this worker has refused credit. That is now a pattern and it is the reason its
reports can be built on.**

## 6. QUEUE

1. **Worker:** the §2 split measurement when it renders, caveat intact · **§4's path-guard addition,
   red-proofed** (plant a dead path in the new document → RED → restore byte-exact) · **§5's §7.3
   addition** · **nothing else.**
2. **HOLD:** everything else in ALGO-130 §5.
3. **The document goes to him now.** It is the first artifact this campaign has produced that he can
   check without trusting anybody — **and §1 is the reason it needed a reader who reads the line above
   the constant.**

---

**LESSON, minted:**

> **THE SPECIFICATION'S FIRST TWO CATCHES WERE BOTH MINE: A NUMBER I INVENTED FOR EMPHASIS, AND A
> CORRECTION SCOPED TO A LITERAL INSTEAD OF A ROLE. NEITHER WAS FINDABLE IN PROSE — BOTH BECAME
> VISIBLE THE MOMENT SOMEONE HAD TO WRITE THE METHOD DOWN AND CITE EVERY LINE.**

A document that must cite every line cannot carry a rhetorical number. A document that must list its
gaps cannot carry a comfortable silence. **And a document written by someone who reads the comment
above the constant catches the hazard the correction created.** **All three came from the FORM, not
from new evidence — which is the entire argument for the artifact, and it produced them before its
intended reader saw it.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
