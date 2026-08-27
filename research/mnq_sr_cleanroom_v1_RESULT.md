# MNQ-SR-CLEANROOM-v1 — RESULT. **IT FAILS ITS PRE-REGISTERED ACCEPTANCE.**

Spec frozen at `1aa85df1`, builder frozen at `55b344cd`, **both before this test was run.** Run
once. No parameter was changed after seeing a result.

---

## 1. THE VERDICT: **FAIL**

> **Pre-registered:** *"SUCCESS = the map draws `≤ 5` zones per session **AND** overlaps more of
> his 28 marked levels than v2.4's `13`. Both clauses must hold."*

| clause | result | |
|---|---|---|
| **≤ 5 zones per session** | **6 on 13 of 14 sessions**, mean **5.9** | ❌ **FAIL** |
| **overlaps > 13 of his 28** | **17 of 28** at exact overlap | ✅ pass |

**BOTH WERE REQUIRED. IT FAILS.**

## 2. 🛑 AND THE FAILURE IS A DEFECT IN MY OWN PRE-REGISTRATION, NOT A NEAR-MISS

**The spec's §1 says *"truncate to the top 3 per side"* — which is up to SIX. Its §4 says
*"≤ 5 zones per session."* Those two clauses are mutually unsatisfiable for any session with three
qualifying levels on each side, which is 13 of 14.**

**I wrote both, committed both, and the run exposed the contradiction.** ALGO-104's law, on my own
document: **an acceptance clause the authorized build cannot satisfy is not strict, it is broken** —
and it was knowable before the run by reading my own two sections together.

**I am publishing it as a FAIL rather than re-reading *"2–3 key areas"* as a per-map figure that
would make it pass.** A re-read after an unwanted answer is a goalpost with a citation, and the
number that would rescue it — 3 total instead of 3 per side — is a choice I would be making
*because* it passes.

## 3. WHAT THE RUN ACTUALLY SHOWS — reported in both directions

| | **clean-room** | **v2.4** |
|---|---|---|
| zones per session | **5.9** (max 6) | **37.3** |
| covers his 28, pad 0.00 (as marked) | **17** | 13 |
| pad 2.50 | **18** | 17 |
| pad 10.00 | 20 | **25** |
| pad 0.00 (7.25 arm) | **17** | 16 |
| pad 2.50 (7.25 arm) | 19 | **20** |
| pad 10.00 (7.25 arm) | 20 | **25** |

**IT COVERS MORE OF HIS LEVELS AT EXACT OVERLAP WITH ONE SIXTH OF THE ZONES — 17 vs 13, on an 84%
smaller map.**

**⚠️ AND IT LOSES AT A LOOSE TOLERANCE: 20 vs 25 at pad 10.** That is not noise and it is not
adverse-selection — **it is what 37 zones buy you.** A map that blankets the chart catches more of
anything at a wide enough tolerance. **The clean-room map wins on precision and loses on blanket
coverage, and both halves are the honest result.**

## 4. WHAT THIS DOES AND DOES NOT ESTABLISH

- **It does NOT establish that the clean-room map is better.** It failed its own test.
- **It does establish that the CONFLUENCE-RANK PREDICATE IS NOT EMPTY**: ranking by confluence
  count across independent families, with `≥2` reactions and a wick-to-close band, produces a
  ~6-zone map that contains more of his marked levels at exact overlap than the 37-zone map does.
  **From published practice, with one inherited magnitude and no fitted number.**
- **It does NOT license changing v2.4.** v2.4 was not edited and did not move during the
  comparison.
- **No profitability claim.** No PnL was read; the R-geometry is a frozen input and was not tested
  here at all.

## 5. THE ONE HONEST WORRY, NAMED

**I am not a clean room and §0 of the spec said so before the run.** I have measured those fourteen
sessions for three days. **Every parameter here is cited and none was tuned — but a person with my
exposure choosing *which published rules to adopt* is a channel no commit order closes.** The four
rules came from ALGO-161's external research rather than from me, which narrows it; **it does not
eliminate it, and a reader should weigh the result accordingly.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision.*
