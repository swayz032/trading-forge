# Golden Fixture — MNQU2026 LONG + SHORT White-Line TP Geometry — v0.20 — 2026-08-11

Status: **USER-VISUAL SEMANTIC FIXTURE / PLATFORM-PARITY RESEARCH**

These two screenshots are the acceptance truth for the specific reviewed MNQU2026 5-minute replay. The user-drawn white lines mark the intended TP1 location **inside the visible reaction area**, not merely a generic reaction reference.

## LONG-side reviewed case

- LONG Entry Zone: approximately `29900.00`
- rejected v0.19.x LONG TP1: approximately `29974–29975`
- user-drawn intended LONG TP1: `29953.25`

### Ruling

The old TP was too high because the detector built the upper reaction area from `body top -> wick high`, which represents a thin extreme strip rather than the full visible reaction area.

For the reviewed LONG case:

1. build the full upper reaction area from candle-body lower edge through the reaction high;
2. fuse repeated 5m/15m observations of that same physical shelf;
3. place TP1 in the **middle with a small lean toward the top**, matching the operator's white-line intent;
4. do not place TP1 at the upper edge/wick extreme;
5. do not skip this first qualified shelf for PDH or a farther upper shelf.

The exact `29953.25` value is a golden visual target for this chart case. It is not a universal hard-coded NQ/MNQ price.

## SHORT-side reviewed case

- SHORT Entry Zone: approximately `29666.00`
- rejected v0.19.x SHORT TP1: approximately `29555.25`
- user-drawn intended SHORT TP1: `29600.75`

### Ruling

The old TP skipped the first meaningful lower reaction area and promoted a deeper shelf.

For the reviewed SHORT case:

1. build the full lower reaction area from reaction low through the candle-body upper edge;
2. prove reaction quality before distance ranking;
3. the **first qualified physical shelf below Entry owns TP1**;
4. place TP1 around the **middle** of that reaction zone, matching the operator's white-line intent;
5. only after that shelf is consumed may a deeper shelf become TP2.

The exact `29600.75` value is a golden visual target for this chart case. It is not a universal hard-coded NQ/MNQ price.

## Shared hard invariants

- LONG TP1/2/3 must remain strictly above the active/displayed LONG Entry reference.
- SHORT TP1/2/3 must remain strictly below the active/displayed SHORT Entry reference.
- A reaction area is not a thin wick strip.
- Quality precedes proximity.
- One physical shelf consumes one TP number across 5m/15m descriptions.
- TP is inside the canonical zone, never exactly on its edge.
- A farther shelf cannot become TP1 while a nearer qualified shelf exists.
- Missing qualification fails closed instead of inventing a target.

## Acceptance test

On the same MNQU2026 5m chart/data window:

- LONG TP1 must move materially down from the rejected ~`29974–29975` extreme-strip target and align with the user-approved interior neighborhood around `29953.25`;
- SHORT TP1 must move materially up from the rejected `29555.25` deeper-shelf target and align with the user-approved first-shelf neighborhood around `29600.75`;
- both lines must sit visibly inside their respective reaction zones;
- no hard-coded fixture price may appear in executable target assignments;
- TradingView and FX Replay must implement the same full-body zone geometry and first-shelf ordering before platform parity can advance.
