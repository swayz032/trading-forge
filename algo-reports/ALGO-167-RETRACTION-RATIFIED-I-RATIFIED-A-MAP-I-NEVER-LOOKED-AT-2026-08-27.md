# ALGO-167 — **THE RETRACTION IS RATIFIED IN FULL AND ALGO-164 IS WITHDRAWN. I CALLED THAT MAP *"THE FIRST THING THIS CAMPAIGN HAS PRODUCED THAT MOVES A NUMBER IN THE RIGHT DIRECTION FOR A REASON IT CAN NAME"* AND ITS MEDIAN ZONE IS `912.6` POINTS WIDE, COVERING `78%` OF THE SESSION'S OWN RANGE. I VERIFIED THE SORT KEY, THE ABLATION, THE ARITHMETIC AND THE PRE-REGISTRATION, AND I NEVER ONCE ASKED HOW WIDE A ZONE WAS.** **[VERIFIED HERE at `de002b65`] `mnq_sr_cleanroom_v1.py:123` — `while changed: # transitive closure over band overlap` — SINGLE LINKAGE, median `230` members per "level". Its `17 of 28` against its OWN null of `17.5`: `−0.27 sd`, `p=0.718`. THE MAP IS SLIGHTLY WORSE THAN CHANCE.** **🛑 AND THE NULL CUTS THE OTHER WAY TOO, WHICH THE RETRACTION UNDERSTATES: v2.4's `13` against its null of `9.5` is `+1.43 sd`, `p=0.112`. v2.4 WINS THE WIDTH-CONTROLLED COMPARISON AND STILL DOES NOT CLEAR A SIGNIFICANCE BAR. NEITHER MAP IS DEMONSTRATED TO FIND HIS LEVELS.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `4e4260b4`.
**Strategy head `de002b65`.** **PR #38: DRAFT / DO NOT MERGE.**
**WITHDRAWN BY THIS RULING: ALGO-164 §4's comparison and its headline; ALGO-163's clause 2 as evidence.**

---

## 1. RATIFIED — AND THE CONDUCT IS THE PART TO COPY

**It retracted its own headline before anyone asked, and it stopped a running backtest mid-flight
rather than spend an hour measuring a map that is not a map.** **A result that flatters the person
holding it is the hardest kind to kill, and this one was a day old, publicly ratified by this desk,
and standing between the campaign and its deadline.** Ratified without reservation.

**And the instrument that caught it cost ninety seconds:** *"when a map covers 17 of his 28, how many
would it cover if his levels were random?"*

## 2. 🛑 I RATIFIED IT. THE SPECIFIC FAILURE, NAMED

**ALGO-164 audited: the sort key · the ablation table · `MEMBERS_ONLY == AS_BUILT` · `CONFLUENCE_ONLY = 6` ·
the adverse branch · the pre-registration provenance in git.** **All of it correct. All of it about
the RANKING of a set whose members I never looked at once.**

> ## **I AUDITED HOW A MAP ORDERED ITS ZONES AND NEVER ASKED WHAT A ZONE WAS. A `912`-POINT "KEY LEVEL" IS VISIBLE TO THE NAKED EYE AND SURVIVED A DESK THAT CHECKED ITS SORT KEY CHARACTER BY CHARACTER.**

**Both acceptance clauses I pre-registered — `≤5 zones a session`, `>13 of his 28` — measure COUNT and
COVERAGE. Neither constrains WIDTH. Three bands swallowing the chart satisfy both perfectly.**
**`[guard-green-for-the-wrong-reason]` names this exact shape and it is in my own index: green at the
assertion, blind to what it asserted over. The worker had the law and did not apply it; so did I, and
I am the seat whose job is to apply it to someone else's work.**

**And my own ALGO-153 tolerance law missed it by one layer.** *"A proximity join reports at three pads
or it reports nothing"* — **the pads were reported. But a pad tests the JOIN's tolerance and a `912`-point
band makes the pad irrelevant.** ⇒ **a discipline aimed at the tolerance of the COMPARISON is no
protection against the width of the OBJECT.**

## 3. 🛑 THE LAW THIS CAMPAIGN HAS BEEN MISSING FOR TWO WEEKS

**`17 of 28` is uninterpretable without `17.5`.** And this campaign has published, without a single
null: **`13 of 28` · `17 of 28` · `501 of 522` · `25 of 28` · `508 / 501 / 479` · `21 of 28`.**

> ## **A COVERAGE NUMBER WITHOUT A NULL IS NOT A MEASUREMENT. IT IS A COUNT WEARING A MEASUREMENT'S CLOTHES, AND ITS ENTIRE MEANING LIVES IN A COMPARISON NOBODY RAN.**

**⚠️ AND APPLIED HONESTLY IT ALSO WEAKENS THE SIDE I WOULD PREFER.** **v2.4's `+1.43 sd` is `p = 0.112`.**
**That is not a demonstration that v2.4 finds his levels either.** ⇒ **the correct statement of the
whole comparison, and it is a null result on both arms:**

> **THE CLEAN-ROOM MAP IS AT CHANCE. v2.4 IS WEAKLY ABOVE CHANCE AND DOES NOT CLEAR A CONVENTIONAL BAR.
> NEITHER MAP IS ESTABLISHED AS FINDING HIS LEVELS, AND `13 of 28` NEVER MEANT WHAT THREE DAYS OF
> RULINGS TOOK IT TO MEAN.**

**Accepting v2.4's win at `p=0.112` because it points the way I now expect would be the identical
error I am retracting, run in the opposite direction.** **The instrument limit is carried: the null
draws uniformly over the session range, and a pivot-drawn null would be stricter — which would move
BOTH arms, not one.**

## 4. WHAT SURVIVES — CHECKED, NOT ASSUMED

| | |
|---|---|
| **ALGO-164 §2, the ablation reading** | **SURVIVES.** Confluence decided `0 of 14` cuts, `NO_CONFLUENCE == AS_BUILT`, `CONFLUENCE_ONLY = 6`. **Claims about this map's INTERNAL ranking, still true of a map that must not be used.** |
| **ALGO-165 reads 1 and 2** | **SURVIVE.** The `3.83R` AST guard stands; the `08:00` anchor is still forced. |
| **the anchor confound I raised** | **RESOLVED, and it did not exist.** v1 anchored at `09:30`, same as v2.4's pinned map — **established by reading the artifact, not by re-running against the fourteen.** Correct method. |
| **ALGO-163 clause 2 as evidence** | **DEAD.** |
| **"more of his levels on a map 12.4× smaller"** | **DEAD.** |
| **the premise under CLEANROOM-v2** | **DEAD.** Stopping that backtest was right. |
| **the freeze, the 6 AST guards, the byte-exact restore** | **All correct. All irrelevant. NONE OF THEM EVER LOOKED AT A ZONE** — and that is the most useful sentence in the packet. |

## 5. THE FIX IS NOT A TOLERANCE, AND THAT IS A FINDING RATHER THAN A CONSOLATION

**Your refusal to pick a width cap is RATIFIED** — a constant chosen by what it does to the output is
the exact thing this build existed to avoid. **But the conclusion "therefore no principled fix exists"
does not follow, and the reason is his own ratified spec:**

> **A zone is the top of the rejection wick down to THAT CANDLE'S CLOSE** — his reserved answer,
> ALGO-071, and `MNQ-STRATEGY-SPECIFICATION.md` §1-8 `RATIFIED`.

⇒ **A `230`-member, `912`-point band ALREADY VIOLATES HIS RATIFIED DEFINITION, independent of any
tolerance.** **The defect is not an unset parameter — it is non-conformance to a definition the
operator has already confirmed in writing.** **`[strategy-spec-ratified-and-zone-side-is-live-role]`:
where code disagrees with the confirmed method, THE CODE IS WRONG.**

⇒ **the correction is derivable and carries no fitted number: a cluster may contain only bands that
MUTUALLY overlap, never bands connected through a chain.** **Complete linkage is not a tuned
alternative to single linkage; it is the one that preserves the definition of the thing being clustered.**

## 6. AUTHORIZED

1. **ONE rebuild — `CLEANROOM-v3` — changing exactly one thing: mutual overlap instead of transitive
   closure.** No other edit. **No width constant anywhere.** If the definition alone does not fix the
   width, **that is the answer and it gets published as one.**
2. **🛑 PRE-REGISTERED NOW, BEFORE THE REBUILD RUNS — the three clauses ALGO-161 should have carried,
   and the two new ones are the ones that would have killed v1 on day one:**
   - **`≤5` zones a session** *(unchanged)*
   - **coverage of his 28 exceeding its OWN null by `≥2 sd`** — a conventional bar, fixed in advance,
     **not derived from any result**
   - **median zone width and share-of-session-range REPORTED IN THE SAME TABLE AS COVERAGE, ALWAYS**
   - **and the adverse branch, recorded so it cannot be softened: mutual overlap may collapse the map
     to almost nothing, or leave it at chance. `AT CHANCE` IS THE MOST LIKELY OUTCOME AND IT WILL BE
     PUBLISHED AS A FAILURE OF THE APPROACH, NOT AS A REASON FOR A FOURTH BUILD.**
3. **The v2.4 lookahead trace (ALGO-165 §3) remains authorized and untouched.** **It is now the more
   valuable of the two lanes**, because §3 has just removed the ground under every coverage comparison
   this campaign has published and that trace is a claim about CAUSALITY, which no null can rescue or
   destroy.
4. **Re-run the null against v2.4's map with a PIVOT-DRAWN null** when convenient — **it is the
   stricter instrument and it moves both arms.**

**Not authorized:** any width constant · any linkage chosen by its score · a fourth build · any v2.4
edit · any Monte Carlo · any adoption decision in the same message as a result.

---

**LESSON, minted:**

> **A FROZEN SPEC, A COMMIT-ORDER PROOF, SIX AST GUARDS, FOUR PLANTED DEFECTS GOING RED, A BYTE-EXACT RESTORE, A PRE-REGISTERED ADVERSE BRANCH CHECKED DIRECTLY, AND AN ABLATION NOBODY REQUIRED — AND THE THING SHIPPED A `912`-POINT KEY LEVEL. NOT ONE OF THOSE INSTRUMENTS EVER LOOKED AT A ZONE.**

**Every instrument was pointed at PROVENANCE — where did this number come from, who chose it, when,
and could a result have influenced it. All of it was sound and all of it was orthogonal to whether the
output was absurd.** **The campaign built an elaborate defence against fitting and none at all against
nonsense.**

> **PROVENANCE DISCIPLINE AND SANITY ARE INDEPENDENT AXES. BEFORE AUDITING HOW A SET WAS ORDERED, LOOK AT ONE MEMBER OF IT — AND WRITE THE PRE-REGISTRATION BY ASKING WHAT THE WORST ARTIFACT THAT PASSES IT WOULD LOOK LIKE.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
