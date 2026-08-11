# Golden Fixture — MNQU2026 LONG TP Reaction Quality — 2026-08-11

Status: **USER-VISUAL SEMANTIC FIXTURE / PLATFORM-PARITY RESEARCH**

## Reviewed visual

TradingView, MNQU2026, 5-minute chart.

Long-side map under review (independent of the panel's active SHORT plan):

- LONG Entry Zone: approximately `29900.00`
- rejected weak/too-near LONG TP1 neighborhood: approximately `29915`
- operator-marked first meaningful upper reaction reference: `29938.25`

## Operator ruling

The approximately `29915` candidate is **REJECTED** as LONG TP1. It is too-near micro-structure and did not demonstrate the kind of meaningful reaction shelf the operator uses for Take Profit placement.

The `29938.25` white line is **not frozen as the final TP price**. It is the operator-marked structural/reaction reference for the first meaningful upper reaction area visible in this case. The engine must construct the reaction zone around that structure and place TP1 **inside** the zone according to context:

- aligned LONG continuation -> reaction-zone midpoint;
- LONG pullback/countertrend -> safer lower/near-middle portion.

The white line itself is therefore a reaction reference/zone anchor, not permission to target the wick/edge exactly.

## Required semantics

1. **Quality before distance.** Weak nearby 5m micro-structure must be rejected before proximity sorting. Distance may order already-qualified shelves only.
2. **Measured reaction.** A LONG destination must show historical rejection/displacement down and away from the upper reaction area before entering the candidate pool.
3. **Profit side is hard.** Every automatic LONG TP shelf must be above LONG Entry plus required structural separation, and the final displayed LONG TP must be strictly above the active/displayed LONG Entry reference.
4. **One shelf, one TP.** 5m/15m descriptions of the same physical reaction area fuse before TP numbering.
5. **Inside-zone target.** The blue TP line belongs inside the canonical reaction zone, not exactly on the white structural line or a far wick.
6. **Fail closed.** If the meaningful reaction shelf cannot be qualified, show `NO QUALIFIED REACTION ZONE`; do not fall back to the approximately `29915` weak neighborhood simply to display a TP.
7. **Both-side map independence.** The top-right panel may have an active SHORT plan while the chart displays both LONG and SHORT planning ladders. This fixture evaluates LONG TP geometry only.

## Numeric freeze rule

No new final LONG TP1 price is frozen from this screenshot alone. The exact target becomes eligible for acceptance only after the exact committed Pine source compiles unchanged in TradingView and visibly identifies the intended reaction-zone bounds around the operator-marked `29938.25` structure.
