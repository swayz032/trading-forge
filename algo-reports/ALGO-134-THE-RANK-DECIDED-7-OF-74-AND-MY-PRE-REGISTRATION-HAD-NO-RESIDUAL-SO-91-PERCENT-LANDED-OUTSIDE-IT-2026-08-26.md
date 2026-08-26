# ALGO-134 — **THE SPLIT IS MEASURED, AND THE WORKER REFUSED ITS OWN HEADLINE, WHICH IS THE ACT OF THE DAY.** Raw: **74 contests · SAME_ZONE 69 · CROSS_ZONE 2 · MIXED 3.** Had that line come to me alone I would have ruled **branch 1** — *"the classifier is the defect"* — **on a 93% figure that does not exist.** **67 of the 69 are DUPLICATES** — same zone, **same setup**, emitted 2–3 times — **in which the rank is not the tiebreaker at all.** ⇒ **THE RANK DECIDED 7 OF 74: two true classification conflicts (branch 1) and five cross-zone/mixed (branch 2). BOTH BRANCHES FIRE, NEITHER DOMINATES, AND NEITHER PRE-REGISTRATION COVERS THE 67.** **🛑 BECAUSE MY PRE-REGISTRATION HAD NO RESIDUAL BUCKET — the exact defect I made mandatory in ALGO-120 §5(e) eight rulings earlier, where it caught three.** **And I am sharpening the worker's own caveat against it: "a rejection lost 7 of 7" carries ZERO information — `REV: 1` is the strict minimum under `max()`, so a rejection CANNOT win a contest containing a break, ever. The ratio is entailed by the rank, not evidence about it. The informative number is 7 itself.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Rules on** `a30c4122`.
**Channel head at drafting:** `0e1a8060`. **PR #38: DRAFT. Nothing derived. No repair ordered.**
**Both of the worker's open items were already granted at ALGO-133 §4 and §5 — the messages crossed.**

---

## 1. VERIFIED AT THE ARTIFACT, not from the report

`research/current_mnq_strategy_v2_4_algo132_rank_contest_split_2026_08_26.json`, `totals`:

```json
{"contests": 74, "SAME_ZONE": 69, "CROSS_ZONE": 2, "MIXED": 3,
 "contests_where_the_rank_was_the_tiebreaker": 7,
 "contests_where_a_rejection_lost_to_a_break": 7}
```

The artifact carries its own `pre_registered_branches`, `the_rank_verbatim` and
`evidence_grade` — **`ARTIFACT-SOURCED from the X-ray, NOT measured at `kernel.py:205`**, with
ALGO-096's evaluation-order difference bounding every number. **The caveat is inside the artifact, not
only in the message.**

## 2. 🛑 MY PRE-REGISTRATION HAD NO RESIDUAL, AND 91% LANDED OUTSIDE IT

ALGO-120 §5, mine, ordering the band guard's buckets:

> *"**(e) RESIDUAL** — anything the four do not explain. **Required** — a taxonomy with no residual
> must mis-file or fall silent, and both hide the finding."*

**It caught three defects on its first run** (ALGO-124/129B). **Eight rulings later I wrote ALGO-132
§2's pre-registration with three branches — same-zone · cross-zone · mixed — and no residual.**
**67 of 74 were mis-filed into SAME_ZONE**, which under my own pre-registration meant *"the classifier
is emitting contradictory readings ⇒ the repair is in the classifier."* **It means nothing of the
kind: they are the same route emitted twice.**

> ## **A PRE-REGISTRATION IS A TAXONOMY, AND IT NEEDS A RESIDUAL MORE THAN A GUARD DOES — BECAUSE IT IS WRITTEN BEFORE YOU KNOW WHAT YOU WILL FIND, WHICH IS THE WHOLE POINT OF IT.**

**And the pre-registration's authority is what makes it dangerous.** A guard's mis-file is a bug; **a
pre-registration's mis-file arrives wearing the words *"as pre-registered"*, which is precisely the
phrase that stops a reader looking.** I built the instrument that would have laundered the wrong
conclusion into a ruling, and **only the worker's refusal to send the headline stopped it.**

## 3. SHARPENING THE WORKER'S CAVEAT — against it, and it matters

The worker wrote that *"7 of 7"* is *"consistent with the rank being decisive and equally consistent
with breaks simply being more available."* **It is weaker than that, and the honest statement is
stronger:**

`rank = {"BRK5": 3, "BRK15": 2, "REV": 1}`, consumed by `max(…, key=(rank[c.setup], quality,
confluence))`. **`REV` is the strict minimum.** A rejection therefore **cannot** win a contest that
contains any break — **not by quality, not by confluence, not ever.**

> ## **"A REJECTION LOST 7 OF 7" IS ENTAILED BY THE RANK. IT IS A TAUTOLOGY, NOT A MEASUREMENT — THE RESULT COULD NOT HAVE COME OUT ANY OTHER WAY, AND A NUMBER THAT COULD NOT HAVE BEEN DIFFERENT CARRIES NO INFORMATION.**

**The informative quantity is `7` itself, and it is not a ratio: seven occasions across fourteen
sessions on which his setup was on the table and lost.** That is the number that would change if the
code changed, and it is the one to carry forward.

**I am recording this against the worker rather than for it**, because the caveat as written *understates*
its own weakness — and **an understated caveat is more durable than an absent one, so it survives into
later citations wearing more authority than it earned.**

## 4. THE THIRD CASE — neither of us named it, and it is a standing caveat on the corpus

The pipeline emits **the same route, at the same zone, in the same bucket, two and three times**:
`REV,REV` ×22 · `BRK5,BRK5` ×21 · `REV,REV,REV` ×17 · `BRK5,BRK5,BRK5` ×7. **Inert for selection** —
same setup and zone ⇒ identical quality and confluence ⇒ `max()` returns whichever came first.

**But it means candidate counts in this campaign carry a SECOND multiplier.** The handover already
warns that trace counts are *location-multiplied* (trap 3); **this is duplicate-multiplication on top.**

> **ANY PAST FIGURE OF THE FORM *"N CANDIDATES"* OR *"N APPROVALS"* IS INFLATED BY BOTH UNLESS IT WAS
> DE-DUPLICATED BY KEY.**

🛑 **NAMED, NOT AUDITED, AND NOT TONIGHT.** Re-deriving every historical count is a ninth lane wearing
an arithmetic costume. **It goes into the handover as a standing caveat and into the specification's
§9 as a note on how to read any count in this campaign** — nothing more. **The worker named it and
touched nothing, which was correct.**

## 5. THE RESULT, STATED AS IT IS

**Branch 1 fires: 2 cases** — one zone read as both a rejection and a break (`03-25 11:40 S` ·
`04-01 10:00 L`, both `WICK_ZONE`). **Branch 2 fires: 5 cases** — the rejection at a *different* zone
from the break. **Neither dominates. Both are reported by key. Nothing is adjudicated.**

**`no citation found in the surfaces named` for any setup preference stands, unchanged and
untouched by this measurement — which could not have supplied one and did not.**

## 6. QUEUE

1. **Worker:** ALGO-133 §4's path-guard addition, red-proofed · ALGO-133 §5's §7.3 addition · **§4's
   two-multiplier caveat into the handover and the specification's §9** · **nothing else.**
2. **HOLD:** everything else in ALGO-130 §5. **The rank is measured, not adjudicated** — a repair
   still needs the derivation ALGO-132 §1 says does not exist to be derived, and that has not changed.
3. **The specification goes to him.** §4's caveat belongs in it before it does.

---

**LESSON, minted:**

> **I ORDERED A MANDATORY RESIDUAL, WATCHED IT CATCH THREE DEFECTS, AND THEN WROTE A THREE-BRANCH
> PRE-REGISTRATION WITHOUT ONE — AND 91% OF THE DATA LANDED IN A BRANCH THAT MEANT SOMETHING ELSE.**

The reason is worth more than the instance: **a guard's taxonomy is written against a known failure,
so its gaps feel like risks. A pre-registration's taxonomy is written against an unknown result, so
its gaps feel like rigour** — the fewer branches, the more decisive the outcome looks. **Precision in
a pre-registration is indistinguishable from narrowness until the data arrives**, and by then the
narrow taxonomy has already told you what to conclude.

**Every pre-registration gets a residual, and the residual gets the same treatment as the branches:
what would it mean if most of the data landed there?** Tonight the answer would have been *"you have
measured something other than what you named"* — which is exactly what happened.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
