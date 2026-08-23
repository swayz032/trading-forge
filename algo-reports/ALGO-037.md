# ALGO-037 — BRK15 derived; the gap ALGO-036 §7 listed is closed. 19/19 mutations.

**Strategy head:** `4663a176` (pushed, verified by `ls-remote`) · PR #38 **DRAFT / DO NOT MERGE**
· still **BUILD ONLY** · kernel/entries/force/engine **byte-identical to `068bb24a`** · grade
still out. Compact, per conservation mode.

---

**What changed.** ALGO-036 §7 listed BRK15 as declared-but-not-derived. It is derived now:

    weak first break -> controlled completed pullback -> forming 15m bar 3 with live force

**Weak is a REQUIREMENT.** The spec's own definition of a weak break is a close beyond the zone
*without* momentum geometry. A first break that already had momentum is the NORMAL breakout and
must take the second-5m extension test. Admitting it here would open a second, laxer door to the
same trade — which is how a closed family of four becomes five. Refused as
`FIRST_BREAK_HAD_MOMENTUM_THIS_IS_THE_NORMAL_ROUTE_NOT_THE_VARIANT`.

**It cannot become a fifth route.** Reached as `route=B, variant=BRK15`; raises
`VARIANT_BELONGS_TO_ANOTHER_ROUTE` under A/C/D and `UNKNOWN_VARIANT` for anything outside the
frozen tuple. `ROUTES` still has four members.

**The §7.14 guard was one hand-typed list away from missing this.** It enumerated four
functions; the population was four yesterday and five today. It now derives the set from the
AST — every public function annotated to return a `BreakoutRead` — plus a test that the derived
population is neither empty nor missing a known member, because a population that silently comes
back empty passes every test written over it.

**Mutation campaign: 19 of 19 killed. Three of them are NOT §7 items.**

    S7.1-S7.15    16 mutations, all fifteen items (item 4 still has two doors)
    variant.V1    a strong first break entering through the weak-break variant
    variant.V2    accepting a pullback that gave the level back
    variant.V3    the variant accepted under a route that is not B

§7 enumerates fifteen defects and none is about BRK15. Numbering these 7.16–7.18 would invent
ruling coverage that does not exist, so they are counted separately and the §7 denominator stays
at fifteen — two tests enforce it. **An inflated denominator is the same lie as a shrunken one,
in the flattering direction.** I also had to fix my own console labels, which printed `§7.V1` in
the very commit that argued against doing that.

**Checkpoint: unchanged, and that is the honest result.** The kernel emits no BRK15 candidate
in these fourteen sessions, so the variant is **derived but unexercised on real data** — the
same gap Route C has, flagged for the same reason.

---

**Still open, unchanged from ALGO-036 §7:** the window amendment waits on the grade; the exam
and FREEZE follow it. **Still awaiting your ruling on** the unfrozen `acceptance_bars=2`, and on
Route C never having fired.

Suite **7 failed / 1435 passed**, enumerated; same 7, all outside this lane. **No PnL, realized
outcome, winner/loser label or clean-edge result participated in any decision in this packet.**
