# ALGO-162 — **THE FAIL IS RATIFIED AND THE REFUSAL TO RESCUE IT IS THE BEST THING IN THE PACKET. BUT ITS STATED CAUSE IS WRONG, AND THE CORRECT CAUSE MATTERS: THE ACCEPTANCE CLAUSE WAS NEVER BROKEN — THE BUILD EXCEEDED ITS AUTHORIZATION.** **[VERIFIED HERE] ALGO-161 line 110, published at `4e823af4` BEFORE the builder existed, reads `keep top 2-3 PER SESSION`. The spec's §1 reads `truncated to the top 3 PER SIDE` — up to six. `≤5` was always satisfiable by the CONTRACT; it was unsatisfiable only by a build that doubled its own cap.** ⇒ **RE-RUNNING AT `top 3 per session` IS NOT A MOVED GOALPOST, IT IS EXECUTING THE CONTRACT AS PUBLISHED, AND THE PROOF IS IN GIT.** **🛑 AND THE RESULT THAT STANDS REGARDLESS OF THE VERDICT: `17 OF 28` AT EXACT OVERLAP ON A MAP OF `5.9` ZONES A SESSION, AGAINST v2.4's `13 OF 28` ON `37.3`. MORE OF HIS LEVELS, ON A MAP SIX TIMES SMALLER. THE CONFLUENCE-RANK PREDICATE IS NOT EMPTY.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `4e823af4`.
**Strategy head `989b4142`** (spec `1aa85df1` → builder `55b344cd` → test, all frozen before contact).
**PR #38: DRAFT / DO NOT MERGE. No v2.4 file touched. No repair authorized.**

---

## 1. THE FAIL IS RATIFIED, AND SO IS THE REFUSAL

> **"I am publishing FAIL rather than re-reading *'2–3 key areas'* as a per-map figure that would make
> it pass. The number that rescues it is one I'd be choosing *because* it passes."**

**That is the campaign's most important discipline and it held under the maximum pressure it has ever
faced** — a three-day blocker, a deadline, a result that was one reinterpretation away from a
headline. **`[pre-register-criteria]`: a re-read after an unwanted answer is a goalpost with a
citation.** ⇒ **Ratified without qualification. The verdict is FAIL.**

## 2. 🛑 BUT THE CAUSE IS MISATTRIBUTED, AND THE CORRECTION IS LOAD-BEARING

| | text | committed |
|---|---|---|
| **the CONTRACT** — ALGO-161 §2/§4 | **`keep top 2-3 PER SESSION`** · `≤5 zones a session` | **`4e823af4`, before the builder existed** |
| **the SPEC** — `MNQ-SR-CLEANROOM-SPEC.md:31` | **`truncated to the top 3 PER SIDE`** (up to **6**) | `1aa85df1` |
| the builder — `mnq_sr_cleanroom_v1.py:50,153` | *"Taken as the SPEC WROTE IT — top 3 per side"* | `55b344cd` |

**`2-3 per session` and `≤5 per session` are consistent. There was never an unsatisfiable pair in the
authorized contract.** The pair became unsatisfiable **when the spec silently converted a
per-session cap into a per-side cap and doubled the ceiling.**

> ## **"AN ACCEPTANCE CLAUSE THE BUILD CANNOT SATISFY IS BROKEN" HOLDS ONLY WHEN THE BUILD IS FAITHFUL. A CLAUSE THE BUILD CANNOT SATISFY *BECAUSE THE BUILD EXCEEDED ITS AUTHORIZATION* IS A BUILD DEFECT WEARING A CRITERION'S CLOTHES — AND DIAGNOSING IT AS A BROKEN CRITERION IS THE MORE FLATTERING OF THE TWO READINGS.**

**This desk owns the conditions that let it through:** ALGO-161 stated the cap **twice, in two
sections, in two phrasings** (`the map keeps the top 2-3` at §2; `keep top 2-3 per session` at §4) and
**never once as a single named constant with a unit.** **`[unjoined-duplicates-rot-together]`: text
repeated in N places has no owner, and the drift appeared exactly at the restatement.** ⇒ **ordered
into the method: a cap is published ONCE, as `NAME = value UNIT`, and the build cites that name.**

## 3. WHAT THE RUN ESTABLISHES — AND IT SURVIVES THE FAIL  **[VERIFIED HERE at `989b4142`]**

| | **clean-room** | **v2.4** |
|---|---:|---:|
| **zones per session** | **`5.9`** (max 6) | **`37.3`** |
| covers his 28 — **pad `0.00`** | **`17`** | `13` |
| pad `2.50` | **`18`** | `17` |
| pad `10.00` | `20` | **`25`** |
| pad `0.00`, `7.25` arm | **`17`** | `16` |

> ## **MORE OF HIS LEVELS AT EXACT OVERLAP, ON A MAP `84%` SMALLER. THE CONFLUENCE-RANK PREDICATE IS NOT EMPTY — AND IT WAS BUILT FROM PUBLISHED PRACTICE, ONE INHERITED MAGNITUDE, AND NO FITTED NUMBER.**

**ALGO-158 proved no threshold could reach the object. This is the first artifact showing something
that CAN** — and it is of the kind ALGO-159 named: **a rank over independent factors, not a magnitude.**
**"Promotion, not invention" survives its first contact with data.**

**AND THE LOSS IS REPORTED AS HONESTLY AS THE WIN.** `20` vs `25` at pad `10.00`:

> **"That is what 37 zones buy you. A map that blankets the chart catches more of anything at a wide
> enough pad. Precision up, blanket coverage down."**

**Correct, and it is the single most important caveat in the packet.** ⇒ **any future comparison of
these two maps reports pad `0.00` AND pad `10.00` together, or it is cherry-picking by omission.**

**It establishes NOTHING about profitability.** No PnL read; the R-geometry is a frozen input and
**untested**. `[the-edge-is-target-geometry-not-levels]` remains the open half of the thesis.

## 4. THE CONTAMINATION LIMIT — RATIFIED AS STATED

> **"I am not a clean room. A person with three days of exposure choosing WHICH published rules to
> adopt is a channel no commit order closes."**

**Ratified and carried.** The four rules were sourced by **this desk** from published practice
(ALGO-161 §2) rather than by the builder, **which narrows the channel and does not close it.** The
commit order proves the build never READ the test set; **it cannot prove the builder was never
INFLUENCED by three days of exposure to it.** ⇒ **published as a stated limit on every future citation
of this result. A commit order is evidence about FILES, not about a MIND.**

**And the trap it caught before commit deserves its own line:** the builder's docstring asserted
*"grep this file for `labels`, `manifest`, `scorecard` and the answer is zero"* — **and the grep
returns three, all from that sentence.** **Sixth instance of a self-refuting absence claim in this
campaign and the first written INSIDE an assertion of cleanliness.** Now AST-verified: **zero in the
code, seven imports, none able to reach a replay artifact.** `[absence-claim]`.

## 5. AUTHORIZED — ONE RE-RUN, AND THE PRE-REGISTRATION IS RECORDED BEFORE IT

**Re-run `MNQ-SR-CLEANROOM-v1` with the truncation set to the AUTHORIZED cap: `top 3 PER SESSION`
(both sides pooled, ranked by confluence).** **Change that ONE line. Nothing else.**

**Why this is not a goalpost move, stated so a hostile reader can check it:** `top 2-3 per session`
was published at **`4e823af4`**, **before `1aa85df1` and `55b344cd` existed.** **The correction moves
the BUILD toward the contract; it does not move the CRITERION away from the result.** Both acceptance
clauses stand **exactly as written in ALGO-161 §4 and unchanged**: `≤5 zones a session` **AND**
`overlaps more than 13 of his 28`.

**🛑 PRE-REGISTERED NOW, BEFORE THE RUN — the branch that would embarrass me:** cutting `5.9 → ~3`
removes roughly half the map. **Coverage may fall from `17` to at or below `13`, in which case clause
2 FAILS and the tighter map is WORSE THAN v2.4 on the only metric it won.** **That is a real and
likely outcome, it is the correct answer if it happens, and it will be published as a FAIL of the
predicate rather than as a reason to restore the per-side cap.** **A third run to find a cap between
3 and 6 is FORBIDDEN — that is threshold search, and it is the thing this whole build exists to avoid.**

**Not authorized:** any v2.4 change · any other parameter · any second reinterpretation of a published
rule · any PnL or outcome read.

---

**LESSON, minted:**

> **THE BUILD FAILED A CLAUSE IT WAS NEVER BUILT TO MEET, AND BOTH OF US READ THAT AS A BROKEN CLAUSE RATHER THAN AS A BUILD THAT HAD QUIETLY DOUBLED ITS OWN CEILING. THE SELF-BLAMING DIAGNOSIS WAS ALSO THE FLATTERING ONE — IT MADE THE CRITERION THE DEFECT AND LEFT THE RESULT INTACT.**

**Its route in was a restatement.** The cap appeared **twice in ALGO-161, in two phrasings, never as a
named constant** — and the spec re-expressed it a third time with a different unit. **Nothing joined
the three copies.** ⇒ **when a limit is restated, the restatement is where the unit dies.**

> **PUBLISH A CAP ONCE, AS `NAME = VALUE UNIT`, AND MAKE THE BUILD CITE THE NAME. AND WHEN A BUILD MISSES AN ACCEPTANCE CLAUSE, CHECK WHETHER IT IMPLEMENTED THE CONTRACT BEFORE YOU CONCLUDE THE CONTRACT WAS WRONG.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
