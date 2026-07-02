# 3-Video Extraction Audit — old gemma vs new compiler vs HAND ground truth (2026-07-02)

Operator directive before trusting the 40-video re-extraction: personally verify 3 library videos — does the new
system capture **100% of the steps the speaker actually said**, and how does the old (thin) extraction compare?
Method: I hand-read each transcript and enumerated the speaker's source-owned executable steps (ground truth),
pulled the OLD production extraction from the live strategies table, and score the NEW compiled spec against the
same ground truth when the batch emits it. Videos chosen blind (never golded before): snNkQSyWX4k, c8VLqF0XDR4,
e5HQXYBUW-Q.

## Video 1 — snNkQSyWX4k ("20 points a day on crude oil", 9/20 SMA close+retest, 30m)

**HAND GROUND TRUTH (8 source-owned steps):** crude oil · 30-minute chart · SMA 9 + SMA 20 · SHORT: candle closes
BELOW BOTH MAs → wait for RETEST of the average(s) → retest = sell entry · LONG mirror (close above both → retest
down → buy) · NO-RETEST = NO TRADE (explicitly skips one) · US session only · no trading during consolidation.
(Framework-stated: stop above last high / below last low, 20-pt target → next S/R zone, BE after.)

**OLD EXTRACTION (3 symbol-split rows, `fq=fallback_only`):** `entry_indicator=sma_crossover` — **WRONG
MECHANISM** (the trigger is close-beyond-both + retest, not a crossover) · timeframe None · entry_sequence null ·
filters null · confluences = ONLY the two auto-floor injections. **Score ≈ 1.5/8, core semantics wrong.**

**NEW COMPILER:** _pending batch — filled by the comparison run._

## Video 2 — c8VLqF0XDR4 (30-minute ORB break-and-RETEST, "I never buy breakouts")

**HAND GROUND TRUTH (8 steps):** mark high/low of FIRST 30-MIN candle (9:30–10:00 NY; deliberately not 15m —
volatility rationale + 10:00 initial balance) · drop to 5-minute for execution · **ANTI-RULE: never buy
breakouts/breakdowns** · LONG: break above orb high → pullback RETESTS it as SUPPORT → enter · SHORT: break below
→ pop back, REJECT as RESISTANCE → enter · failed-break = no trade (couldn't hold below) · A+ confluence stack:
pre-market high + imbalance/FVG + order-flow buyers at the level · optional 5m-close confirmation.
(Framework-stated: stop beyond retest swing, ≥1:1 then trim + BE.)

**OLD EXTRACTION (`orb_mnq_5m`, `fq=rich`):** `entry_indicator=session_open_breakout` — **SEMANTICS INVERTED**:
routed to a BREAKOUT archetype when the educator's defining rule is never-breakout-always-retest. An engine
running this trades the exact entries the educator forbids. No 30-min range spec, no retest step, no failed-break
rule, no premarket/imbalance/orderflow stack. entry_sequence null, filters null. **Score ≈ 2/8, core rule
inverted — and the 'rich' label overstates it.**

**NEW COMPILER:** _pending._

## Video 3 — e5HQXYBUW-Q ("why your 15-min ORB fails" — ORB + context filters)

**HAND GROUND TRUTH (9 steps):** 15-min opening range, NY open · 5-min execution · raw break entry REJECTED
(~30% win, his backtest) · wait for CANDLE-CLOSE confirmation + structure (never limit orders at the range edge) ·
HTF context: skip choppy/ranging opens, need momentum · WITH-TREND ONLY (HTF up → longs only) · VWAP / anchored-
VWAP context · liquidity zones + volume profile + RTH gap-fill awareness (avoid fakeouts into supply/demand) ·
be selective / checklist — sitting out is a position. (Framework-stated: stop above prior 5m wick, ≥1:1.)

**OLD EXTRACTION (`orb_mes_15m`, `fq=rich`):** `session_open_breakout`, entry_sequence null, filters null,
3 confluences (killzone / orb / volume). **Score ≈ 2.5/9 — the extraction IS the naive version the educator
demonstrates losing 4 of 5 trades; every fix he teaches is absent.**

## Interim verdict (old system, 3/3 audited)

The old extractions aren't just thin — on 2 of 3 videos the **core mechanism is wrong or inverted** (crossover
instead of close+retest; breakout instead of never-breakout-retest), and on all 3 the ordered steps, filters,
confirmation rules, and educator-specific confluences are absent (entry_sequence null / filters null across the
board). Backtesting these does not test the educators' strategies. **The re-extraction is not an optimization —
it is a correction.**

## New-compiler comparison

_Filled by the batch comparison: for each video, the compiled spec's conditions (with verbatim transcript
quotes) are matched against every hand ground-truth step; verdict = steps captured / total, with quotes._
