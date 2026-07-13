# Phase-B extraction COMPLETE + verified — Claude rung, v3.1 (2026-07-13)

All 22 strategies / 16 videos extracted under frontier-v3 coverage contract (Claude Opus 4.8, subscription). Every extraction verified against the four rules + coverage contract + v3.1 gestural-exit clause. Quality: UNIFORM PASS.

## Contract compliance (spot-verified across all 22)
- RULE-2 PAIRS NEVER MERGED: DLwVqc long|short, E9MzEC break-cont|sweep-rev, R5L890 continuation|mean-rev, 2DX mean-rev|continuation|spread — all separate objects, no self-contradictory fusion.
- DLwVqc 4 MANDATORY CONTENT UNITS all present: long entry + band-scalp exit (~15-20pt) + 20SMA-trail exit (~75pt) + Rule-2 short. Neither long exit silenced (the coverage-hardening held).
- GESTURAL EXITS kept per v3.1 (levels null, words verbatim, flagged, NEVER deleted): _LS6, 2DX mean-rev, 2DX spread-making, DLwVqc short, -igp target.
- 0xyg STOP RECOVERED verbatim ("putting my stop on this order block low") — the exact field v1 silenced.
- MENTIONS absent-with-reason (not fabricated): IyF breakdown, -igp order-block/breaker/flip deferred models, _LS6 HOD-break mistake, 2DX swing-trading, ZF8 'enter-on-break' rejected + 'do-the-opposite' future-backtest.
- EXAMPLE NUMBERS stripped, RULES verbatim (incl ASR artifacts vwob/5minut/'fair value gut' preserved for char-for-char grounding).

## Grounding leg (remaining -> joint verdict = operator stop-point)
PERSISTENCE INTEGRITY: extractions must be persisted BYTE-EXACT by the extractor (write-to-disk), NOT hand-transcribed — locator checks conditions char-for-char; a transcription slip = phantom miss indistinguishable from a real one. Plan:
1. Re-dispatch 22 frontier-v3 extractions with WRITE to staging/{vid}__s{id}.json (byte-exact, free/subscription).
2. Mechanical Python merge -> vault/{vid}.json (aggregate per video; NORMALIZE stop -> {anchor: <text>} since conditions_of reads stop.anchor; several extractors emitted stop as string/{description}).
3. Locator grounding: python scripts/h1_designpool_support.py claude-rung-designpool  (local gemma, FREE) -> support_miss_rate vs <=8% floor.
4. GOVERNOR PRE-FLIGHT (daily UTC ledger + balance) BEFORE gpt-5.4 content-preservation panel (metered; OpenAI never grades OpenAI -> Claude-extracted, gpt-5.4-graded is legal cross-vendor).
5. JOINT VERDICT = grounding (<=8% locator) AND content-preservation clean -> clear = freeze SHA -> sealed-12 terminal read; miss = paid understudies (terra/sol).

Vault dirs staged: docs/replay-results/h1-scripts/claude-rung-designpool/{vault,staging}/.
