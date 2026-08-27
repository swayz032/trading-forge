# ALGO-174 — **THE ENUMERATION IS RATIFIED AND THE REPAIR IS AUTHORIZED. `5 OF 12` IN-WINDOW BULLETS USED A LOCATION THE BOT COULD NOT CAUSALLY HAVE HAD, AND EVERY AFFECTED DECISION BECAME A TRADE — THERE IS NO AFFECTED-BUT-DISCARDED POPULATION DILUTING IT.** **🛑 AND THE PROOF IS LEGIBLE IN THE IDENTIFIER STRINGS: `2026-03-30 08:05` TRADED `S:2026-03-30T08:45:00:93755` AND `2026-04-02 08:05` TRADED `SWING:S:2026-04-02T08:45:00:94666`. TWO DECISIONS AT `08:05` USED LEVELS WHOSE OWN NAMES CARRY A TIMESTAMP FORTY MINUTES IN THEIR FUTURE.** **🛑🛑 AND THE RULING THAT CLOSES ALGO-165'S LOOP: THE COMMENT DEFENDING THE ANCHOR SAYS MOVING IT *"WOULD SILENTLY INVALIDATE EVERY NUMBER IN THE CAMPAIGN."* THE NUMBERS ARE ALREADY INVALID. MOVING THE ANCHOR DOES NOT INVALIDATE THEM — IT REVEALS THAT THEY WERE. THAT SENTENCE WAS NEVER A DEFENCE; IT WAS THE PRICE OF FINDING OUT, AND IT HAS NOW BEEN PAID BY MEASUREMENT INSTEAD OF BY CHOICE.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `fa233b38`.
**Strategy head `312ab490`.** **PR #38: DRAFT / DO NOT MERGE.**

---

## 1. THE ENUMERATION — RATIFIED  **[VERIFIED HERE at the artifact]**

| | |
|---|---:|
| decisions strictly inside `08:00–09:30` | **19** |
| …of which became a bullet | **12** |
| **AFFECTED DECISIONS** | **5 of 19** |
| **AFFECTED BULLETS** | **5 of 12** |
| positive control | **`14 of 14` sessions returned a NON-EMPTY `08:00` location set** |

**`4 HARD · 1 AUTHORIZATION`, and keeping them apart is right.** A flat *"5 lookahead bullets"* would
have been **a gate label worn as a sub-reason** over a six-stage composite —
`[gate-label-not-subreason]`, applied by the worker to itself before publication.

> ## **EVERY AFFECTED DECISION BECAME A TRADE. THE DEFECT IS NOT FILTERED OUT DOWNSTREAM BY ANYTHING — WHEN THE BOT SEES A LEVEL THAT DOES NOT YET EXIST, IT TRADES IT.**

## 2. 🛑 THE EVIDENCE IS IN THE ID STRING, WHICH IS WHY THIS ONE WILL NOT COME BACK

| decision | level traded |
|---|---|
| `2026-03-30` **`08:05`** | `S:2026-03-30`**`T08:45:00`**`:93755` |
| `2026-04-02` **`08:05`** | `SWING:S:2026-04-02`**`T08:45:00`**`:94666` |

**Two trades placed at `08:05` on levels whose own identifiers contain `08:45`.** ⇒ **no join, no
instrument and no interpretation is required to see it — the future timestamp is inside the name of
the thing being traded.** **After a day in which a `912`-point zone survived every guard we own, a
finding that is legible without an instrument is worth naming as such.**

## 3. THE JOIN-KEY CATCH — and it would have UNDERSTATED the result

**Established and exceptional zones come from DIFFERENT BUILDERS — `core.build_zones` and
`levels.exceptional_single_swing_zones` — and one join key cannot see both.** The first pass read
`1 HARD / 2 AUTH / 2 UNJOINED`; joined on the builder that actually makes each zone it is
**`4 HARD / 1 AUTH`.**

> **THE ERROR WOULD HAVE PUBLISHED TWO MEMBERS OF THE FOUR-FIFTHS MAJORITY AS AN INSTRUMENT LIMIT.**
> **A join-key defect does not merely add noise — it MOVES ROWS INTO THE "we could not tell" BUCKET,
> and that bucket reads as honesty.**

**`[self-certifying-collections]` — always the ADJACENT array.** Caught before publication, which is
the only place it counts.

## 4. 🛑 THE REPAIR IS AUTHORIZED, AND IT IS NOT THE KIND OF CHANGE I HAVE BEEN REFUSING ALL DAY

**Every prohibition I have held for three days was against a repair that ADDS A DEGREE OF FREEDOM** —
a threshold, a cap, a linkage, a tolerance, a width, a rank chosen by its score. **This is the
opposite. It DELETES a hardcoded constant in favour of the time the decision actually occurs.**

> ## **A FIDELITY REPAIR ADDS NO DEGREES OF FREEDOM. `09:30` IS NOT A PARAMETER BEING RETUNED — IT IS A LITERAL BEING REMOVED. THERE IS NO VALUE TO CHOOSE, SO THERE IS NOTHING TO FIT.**

**And the blast-radius objection is now inverted.** *"It would invalidate every number measured
against the current map"* was the reason not to touch it. **§1 establishes that the current map
contains information the bot could not have had, on `5 of 12` in-window bullets, with every affected
decision becoming a trade.** ⇒ **those numbers do not become invalid when the anchor moves. They are
invalid now, and the anchor is why.** **`[stated-price-not-prohibition]`: a cost is not a ban.**

**THE PROPERTY TO IMPLEMENT, stated as a property so the implementation stays yours:**

> **THE LOCATION SET AVAILABLE TO A DECISION AT TIME `T` MUST BE DERIVABLE FROM BARS AT OR BEFORE `T`, AND FROM NOTHING ELSE.**

**That is the only formulation with no free parameter.** **Do NOT substitute a different fixed anchor
— `08:00` instead of `09:30` is the same defect with a friendlier number**, and it would also blind
the bot to structure forming during the session, which his method plainly uses. **Report the runtime
cost; if a per-decision rebuild is prohibitive, bring me the cost and the options rather than
choosing a cheaper constant.**

**🛑 PRE-REGISTERED NOW, BEFORE THE REPAIR RUNS, so none of it can be read favourably afterwards:**
1. **The trade set WILL change.** Some of the five vanish; others may move to a different level, a
   different clock, or a different session. **A changed trade set is the EXPECTED outcome and is not
   evidence the repair is wrong.**
2. **Bullets may go UP, not down.** Removing a non-causal early entry frees the budget for a later
   one. **An increase in trade count is not a regression.**
3. **Every v2.4 number measured against the old map is marked `MEASURED AGAINST A NON-CAUSAL MAP`,
   NOT DELETED and NOT re-scored.** Re-scoring is a separate ruling and needs its own pre-registration.
4. **The `8 of 14` headline (ALGO-141) is now SUSPECT and is not to be cited without this caveat** —
   `5` of the affected sessions are inside its population. **I am not claiming it falls; I am
   claiming it can no longer be quoted bare.**
5. **NO PnL comparison. NO Monte Carlo. `-$21,075 / 42%` stays un-rescored** until fidelity is frozen.
   **`FIDELITY → FREEZE → CLEAN EDGE`, and this is the fidelity gate finally having something real in it.**

## 5. WHAT IS STILL NOT CLAIMED — held exactly where you left it

- **No extrapolation beyond `14` sessions and the in-window population.** `12` is a small denominator.
- **EXISTENCE and AUTHORIZATION only, never STATE.** ALGO-137 stands untouched.
- **The mechanism is enumerated; how far it generalises is not measured** — and the full-history
  answer arrives free once the repair lands, because the backtest will run on a causal map.

## 6. AUTHORIZED

1. **Implement the §4 property.** One behavioural change, no new constant, **report the runtime cost.**
2. **Re-run the in-window enumeration against the repaired kernel as the acceptance test** — the same
   instrument, unchanged, on the same 19 decisions. **`AFFECTED BULLETS` must be `0 of N`.**
   **`[red-path-decay]`: prove the fix with the convicting instrument, not a new one.**
3. **THEN STOP.** No PnL, no MC, no re-score, no map build, no adoption decision.

---

**LESSON, minted:**

> **THE ONE DEFECT THAT SURVIVED A DAY OF RETRACTIONS WAS THE ONE VISIBLE IN A STRING. THREE BUILDS, SIX AST GUARDS, A NULL CONTROL, AN ABLATION AND A FROZEN COMMIT ORDER ALL DIED OR PROVED NOTHING — AND THE FINDING THAT HELD WAS A TRADE AT `08:05` ON A LEVEL CALLED `T08:45:00`.**

**Every instrument this campaign built was aimed at what it could not see.** The thing that held was
readable in a committed artifact's own identifier, and **it had been sitting in the `map_anchor` field
of a pinned capture, in plain English naming both files, read and skipped by both seats.**

> **BEFORE BUILDING AN INSTRUMENT TO DETECT SOMETHING, READ WHAT THE ARTIFACT ALREADY CALLS ITSELF. THE CHEAPEST EVIDENCE IN A SYSTEM IS THE NAMES IT GIVES ITS OWN OBJECTS, AND IT IS THE LAST PLACE ANYONE LOOKS.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
