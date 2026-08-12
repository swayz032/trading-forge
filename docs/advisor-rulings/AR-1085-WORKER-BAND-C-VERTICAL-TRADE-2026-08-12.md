# AR-1085 (worker) — THE VERTICAL TRADE EXISTS. GRADER DISPATCHED ON DISPROVE.

**Governing:** AR-1082 §5.4, §5.5, §5.7 · **Pin:** `4936aae8` (pushed) · Predecessors `001c1758`, `162e6fa1`

---

## 1. ONE AUDITABLE TRADE, THROUGH THE REAL ROUTE, AT THE PRODUCTION DEFAULT

A persisted config carrying the `compiled_spec` and a **real execution-candidate receipt** (all four `_CANDIDATE_KEYS`, proven through `resolve_candidate_authority`'s own three anchors) driven through `bt.main.callback`. The only thing patched is the market — `load_ohlcv`, on **both** `src.engine.backtester` and `src.engine.data_loader`.

`TF_FVG_IDENTITY_ENABLED` is **DELETED** by the fixture, not set. This runs at the shipped default.

**Every value below is READ OFF THE RETURNED TRADE RECORD.** Not a spy, not a strategy attribute, not an intermediate the test placed there.

```
entry_idx           8                       the third FVG candle
entry_timestamp     2024-01-02 10:10 ET     that same bar, so an index shift cannot hide
Avg Entry Price     119.0                   its CLOSE
Direction           Long                    from the OR breakout side, not the EMA
risk_points         7.5                     entry - the displacement candle's wick low 111.5
stop_basis          source_exact            no ATR, no ceiling clamp
Avg Exit Price      134.0                   exactly entry + 2 x 7.5
exit_reason         source_fixed_r_target
Size                1.0                     whole position, no ladder
source_risk_mode    SOURCE_FAITHFUL
total_trades        1
```

★ `A SPY MEASURES THAT CODE RAN. THE RETURNED TRADE MEASURES WHAT IT DECIDED.`

### Five ablations, all bite, and their red sets are informative

| ablation | result |
|---|---|
| V1 restore the +1 entry roll on the source arm | whole vertical class collapses (7 errors) |
| V2 remove the source stop-map producer | whole vertical class collapses (7 errors) |
| V5 remove the FVG-identity bypass | whole vertical class collapses (7 errors) |
| V3 replace fixed-R with the house ladder | exactly the 2R target assertion |
| V4 hard-code `r_multiple=3` instead of the taught 2 | exactly the 2R target assertion |

V4 leaves the **stop** assertion green, which is correct and is the discriminator I would want: it proves the target and the stop are separately witnessed rather than jointly satisfied by one number.

**84 green** across the four source suites at `4936aae8`.

---

## 2. TWO LIMITATIONS, PINNED AS TESTS RATHER THAN MENTIONED IN PASSING

**(a) THREE source entries, ONE trade.** The engine's own line reads `raw=3 (L:3 S:0) → … → trades=1 (vectorbt drop: 67%)`. One event per session is emitted, and only the first becomes a trade: `exit_long` is framework-owned and never set by a strategy, so the position opened at the first entry is still open when the later entries fire and vectorbt ignores them; the exit is retro-fitted afterwards by trade management.

**This is pre-existing position-model behaviour, not something the source join introduced** — but it is invisible unless someone reads the pipeline line, and **any future source-faithful trade-count or performance claim must account for it.** Pinned by a test so it cannot quietly stop being true. `A SIGNAL THAT NEVER BECAME A TRADE IS NOT A REFUSAL, AND IT IS NOT AN ENTRY EITHER.`

**(b) A DISCLOSURE DEFECT I INTRODUCED.** The trade record correctly says `exit_reason='source_fixed_r_target'`, but the engine's summary counter reports it under `1 signal exits` — that counter's categories predate this exit engine. Printed counter only; no trade, price or metric is wrong. Pinned so the discrepancy stays visible until the counter is taught the new reasons.

---

## 3. MY OWN ERROR IN THIS PIECE

My first version of the harness captured **stdout only** and then asserted against pipeline lines that live on **stderr** — producing two red tests that accused production code of a change it had not made. I fixed it by capturing both streams. Recorded because a red I authored is exactly as misleading as a false green, and this is the second time this session an instrument, not the code, was the defect.

★ `THE STREAM YOU CAPTURED IS PART OF THE CLAIM YOU ARE MAKING.`

---

## 4. WHAT THIS IS NOT

**Not a performance result.** Three sessions, and the engine's own gate correctly REJECTS it — *"Only 3 OOS trading days — minimum 60 required"*. **A test pins that refusal**, so this fixture cannot quietly widen into a backtest without going red. AR-1082 §7 authorizes no source-faithful performance backtest and I am not claiming one.

**Discriminators still open:** 11, 12, 14, 15 have no direct test at the Band C layer (11 and 12 are covered at component level; 14 and 15 are covered by ablations V3 and V1 rather than by committed tests). 16 holds structurally — the exit scan starts at `entry_idx + 1`, so the decision bar is not in the loop's range — but has no test, and I have named it to the grader as an attack surface.

---

## 5. §5.7 — GRADER DISPATCHED

`accuracy-validator`, **DISPROVE** mandate, pinned at `4936aae8`, with the working access recipe rather than a prohibition, and asked explicitly for the honest null. Named attack surfaces: the warmup-index rebase · per-session OR under DST/gaps/unsorted bars · same-FVG identity with overlapping zones and a zone at index 0 · the same-candle entry-order claim (whose proof is structural and untested) · **plus ≥1 novel attack it must find itself, not copied from my controls.**

I also asked it to check four things where I may simply be wrong: whether the greens are an artifact of one hand-built fixture; whether the FVG-routing bypass changed any legacy binding; whether I weakened anything under cover of "the ruling changed" when I rewrote two Style-C tests; and whether my 7-pre-existing-failures claim survives its own re-measurement.

Verdict lands at `docs/designs/GRADE-SOURCE-BCDF-VERTICAL-2026-08-12.md`, uncommitted, and I will publish it here in full — not a summary.

---

## 6. STATUS AGAINST AR-1082 §5

| step | state |
|---|---|
| 1 publish exact tree | DONE |
| 2 narrow FVG bypass, separate commit | DONE `162e6fa1` |
| 3 four-cell routing discriminator | DONE |
| 4 real Band C deterministic long trade | **DONE** `4936aae8` |
| 5 load-bearing values off the returned trade | **DONE** |
| 6 remaining discriminators | PARTIAL — 11/12 component-only, 14/15 ablation-only, 16 untested |
| 7 `accuracy-validator` on DISPROVE | **DISPATCHED** |
| 8 publish validator result + pin | pending |

**Pin `4936aae8`.**
