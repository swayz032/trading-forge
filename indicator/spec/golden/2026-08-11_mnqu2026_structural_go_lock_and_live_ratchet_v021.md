# MNQU2026 structural GO lock + live proof ratchet — v0.21 golden fixture

Status: **USER-VISUAL SEMANTIC FIXTURE / RESEARCH ONLY**

Platform: TradingView
Symbol: MNQU2026
Chart: 5m
Reviewed date: 2026-08-11

## Operator correction

The yellow LONG line has two different jobs that MUST NOT be mixed:

1. **STRUCTURAL GO / LONG ENTRY** — the meaningful intraday barrier whose break proves the bullish pullback is real enough to consider instead of a quick bearish-market fake bounce.
2. **LIVE 5M PROOF** — only after a completed 5m candle proves through the structural GO line, yellow switches to the completed candle high and then ratchets with BREAK -> PUSH 1 -> PUSH 2 / ENTRY READY.

The same rule mirrors for SHORT using lows.

## Reviewed LONG case

- BIG DIRECTION was bearish.
- The earlier chart around 02:00 showed the LONG structural yellow line around the `29900` area.
- The later chart showed that same LONG structural requirement degraded down toward the `29840` area even though the operator had not approved an easier bullish-pullback proof level.
- The operator-marked white structural reference in the reviewed later chart is approximately `29900.50`.

### Hard acceptance

While the same structural epoch is active:

- LONG structural GO may **never move down** because newer/lower pivots entered a rolling memory window.
- SHORT structural GO may **never move up** for the mirror reason.
- A pivot aging out of a finite rolling list is not a valid reason to make proof easier.
- If a new candidate would make proof easier, keep the existing structural line.
- A reset must be explicit and deterministic. v0.21 uses new chart day or BIG DIRECTION regime flip as its research reset boundary.

## Live 5m proof acceptance

Before activation:

`yellow = STRUCTURAL GO`

After a completed LONG proof candle closes through structural GO and passes the reference-candle body check:

`yellow = completed proof candle HIGH`

Then:

`WAIT_BREAK -> BREAK -> PUSH_1 -> PUSH_2 / ENTRY_READY`

During that chain:

- LONG yellow can only stay the same or move higher.
- SHORT yellow can only stay the same or move lower.
- If Candle 2 fails and the next candle begins, the momentum measurement may reset, but the visible threshold cannot move backward and make the trade easier.
- BREAK and PUSH stages must move the visible yellow line with the current favorable extreme; an invisible internal anchor is not sufficient.

## TP regression tied to v0.20

v0.20 widened reaction zones correctly but could then discard a legitimate broad zone because its near edge overlapped the entry-separation band.

v0.21 rule:

- quality must qualify first;
- canonical shelf fusion still occurs before TP numbering;
- for LONG, a broad shelf remains eligible when its **far/high edge** reaches the required profit side;
- for SHORT, a broad shelf remains eligible when its **far/low edge** reaches the required profit side;
- clip only the portion of that qualified shelf that lies beyond the entry/boundary gap;
- place TP inside that clipped profit-side geometry;
- do not discard the whole reaction shelf merely because its near edge overlaps the entry band.

## Never reintroduce

- rolling-pivot decay that lowers LONG proof;
- rolling-pivot decay that raises SHORT proof;
- using the structural GO and the live momentum tip as one mutable variable;
- moving LONG live proof down after a failed candle;
- moving SHORT live proof up after a failed candle;
- TP rejection based only on the full zone near edge when a valid profit-side portion exists.
