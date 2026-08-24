# O3 — REPAIR DESIGN. **DESIGN ONLY. NOTHING LANDS. NO EXAM RUN.**

ALGO-080 order 3. Every element below carries a teaching citation (or `TAUGHT_CITATION_ABSENT`),
a red-proof plan, a membership-guard plan, and a per-day expectation **pre-registered here,
before any exam is run**.

**The evidence base got weaker in this packet, not stronger, and the design says so.** O1 cut the
spent-filter's support from 3 sessions to 1. O2 failed to demonstrate prospective marking on
either focus session. A design written as if those had gone the other way would be the goalpost
failure this lane exists to avoid.

---

## R-A · SPENT-ZONE FILTER (target universe)

**What.** Before nearest-first is applied, remove from the destination universe any zone that is
already SPENT: a bar **completing at or before the decision clock** has already traded into the
band. Nearest-first itself is untouched.

**Teaching citation.** ALGO-051, operator verbatim: *"…momentum candle breakout and i jumped in
and **targeted the next key zone**"* — the re-anchor mechanic, where the first level's reaction
has happened and the target moves on. ALGO-052 measures the same shape (target = the upper key
zone band, 110 pts × $30). **CITED.**

**Scope, set by O1 and NOT by the original claim.** With the completed-bar clause enforced on 1m
evidence, the predicate separates on **03-24 only** — 18 completed 1m bars in the winner's band
vs a fresh TP band. On **03-30 and 03-31 the machine's winner is NOT spent** (0 completed bars),
so the filter does nothing there. Control 04-14 reproduces FRESH.

> **R-A is a repair for ONE of the three target-layer sessions. It is not the general fix, and
> the earlier "3/3" was an artefact of filtering on bar-start instead of bar-completion.**

**Red-proof plan.** Plant each defect, require RED, restore byte-exact:
1. filter on bar **start** instead of completion → 03-30/03-31 wrongly become SPENT (this is the
   exact defect O1 caught; it must go red);
2. drop the session-open lower bound → prior-session bars leak in;
3. invert containment → fresh zones filtered, spent zones kept;
4. apply the filter to Route A locations as well as destinations → out-of-scope mutation.

**Membership guard.** In-window grant attempts across all 14 sessions, compared **by membership**
at the pre-repair and post-repair pins. Expected: **no grant removed**; any addition named with
clock+key and tested against the ALGO-070 clauses.

**Pre-registered per-day expectation.** 03-24 target changes from `24358.00` to a farther,
non-spent destination. 03-30, 03-31, 04-14, and all other days: **no change**. If any day other
than 03-24 moves, R-A is wrong as scoped.

---

## R-B · HTF REJECTION-BAND DESTINATIONS (target coverage)

**What.** Admit 30m wick-extreme-to-close rejection bands as destination candidates.

**Teaching citation.** The band rule is his own (ALGO-071/073: zone = rejection wick extreme to
that candle's close); 30m sits inside the taught **5/15/30** family. **CITED for 30m.**
**60m: `TAUGHT_CITATION_ABSENT`** — admissible only as `PROVISIONAL-UNCITED`, never carrying a
verdict alone (ALGO-080).

**Scope, set by L3.**
- **03-30** — his TP 23355.25 falls inside three 30m bands, tightest `[23345.5, 23357.75]`.
  **Covered by a cited source.**
- **03-31** — his TP 23540.75 has **no source at any searched surface**; nearest is
  `session_high_to_entry` 23531.5 at **9.25 pts**, outside the pre-fixed tolerance.
  **`TAUGHT_CITATION_ABSENT` → no coverage repair. This is the campaign's honest-loss candidate
  and R-B must not be widened to capture it.**

**Red-proof plan.** (1) admit 60m as if cited → provenance guard must go red; (2) drop the
completed-bar filter on HTF bars → bands built from unprinted candles; (3) widen the band
tolerance past the pre-fixed 2.0 pts → goalpost guard red; (4) admit a band whose candle
postdates the decision clock.

**Membership guard.** Destination-set membership per session at both pins: additions must be 30m
bands only, each named, none from 60m, none postdating the clock.

**Pre-registered per-day expectation.** 03-30 gains a destination containing his TP.
**03-31 stays lost.** No other day's chosen destination changes. If 03-31 is recovered by R-B,
R-B has been widened and must be rejected.

---

## R-C · ZONE-UNIVERSE PREDICATE (H-A direction) — **NOT READY**

**What it would be.** Restrict the entry-zone universe so the bot stops firing at levels he
would not have marked — the direction L1's H-A points at, and the direction that explains why the
bot fires 46 min–3 h early in his own direction on 4 of 5 days.

**Evidential status: `TAUGHT_CITATION_ABSENT` for any concrete predicate.**
- L1's 5/5 tally is a **base-rate artefact** (only 1.5–4.4% of the machine's locations overlap his
  marked zones; P(all five miss by chance) = **89.2%**) and is excluded as evidence by ALGO-080.
- The admissible observation is **one**: the single agreeing day is the day the bot fired at a
  zone he marked.
- The desk's convergent reading — all five early trades are BRK5 at **stale structure** (location
  ids born 03-03, 03-16, prior-day) vs his same-session rejections and pre-existing HTF bands —
  is teachings-supported and is the most promising lead, **but it is still a property, not a
  predicate.** No threshold separating "stale" from "live" has a citation.

**Why nothing is proposed.** Any staleness cut-off invented here would be fitted to six 2026
sessions, which the standing rails forbid. **R-C is deferred pending outside-teachings research
under his vocabulary** (key level zone · support · resistance · rejection wick · a candle that
does not break the level).

**If it were built**, the red-proof and membership plans would mirror R-A's, plus a guard that
the age threshold appears in no 2026-derived artifact.

---

## Open questions that are the operator's, not mine

1. **Does he mark levels prospectively?** O2 could not demonstrate it: on the two focus sessions
   03-24 is only *within tolerance* of a 30m band (gap 1.375, not contained) and 04-06 has no
   source at all. Per ALGO-080 this now goes to him.
   *Also flagged:* a **0.375** gap recurs on 03-31 and 04-14. His lines are midpoints of
   0.25-wide zones (all ending `.625`) while band edges fall on `.25`/`.75`, so that offset looks
   like a **quantisation artefact of the zone encoding**, not structure — and it must not become a
   reason to widen a tolerance.
2. **03-24 and 04-06 have no completed penetration at his entry** (L4). Either those lines are
   wrong, or he marks prospectively, or he reads a finer timeframe than 5m.

---

## What this design does NOT claim

- It does **not** claim the target layer is the whole problem. The ratified census says the six
  traded days need **five of six gates** repaired, and **S4 (budget) is taught and unrepairable** —
  its block is the symptom that the bot fires early.
- It does **not** propose a timing/WAIT predicate. That is R-C, and R-C is not ready.
- **No number moves, no repair lands, and no exam has been run.** The expectations above are
  pre-registered so a later exam can falsify them.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this design.
