---
name: transcript-audit
description: >-
  Use after EVERY gemma transcript-extractor probe or extraction run, before
  recommending or starting any mass (re-)extraction, when grading extraction
  quality against a YouTube video, when deciding whether a video/strategy
  should be rejected at intake, or when judging whether a direction/coverage
  "miss" is a real gap. Probe-green is NOT a substitute — this audit is the
  gate.
---

# Transcript Audit — field-by-field extraction grading

## Why this skill exists

Probes report structural health ("all green": direction populated, multi-step,
claims captured) while the EXTRACTION is semantically wrong. Test 2
(2026-05-27) had a green probe hiding: trade-example contamination (specific
prices like "11028" extracted as rules), end-summary bias (5-item closing
checklist captured, 8 minutes of mid-video teaching missed), R-ratio inversion
("1:2 R/R" → `avg_r=1.2` instead of `2.0`), and silently dropped win-rate.
Only reading the transcript catches these. Operator rule: **"THE ROUTINE TEST
IS YOU CHECK AND SEE IT YOURSELF TO COMPARE."**

## Procedure (per video in the probe output)

1. Fetch the FULL transcript via a Node script using the `youtube-transcript`
   npm package (NOT via Chrome — operator instruction). Chunk-read >30K-char
   transcripts end-to-end.
2. Grade each field below **with explicit transcript quotes** as evidence.
3. Surface every gap with its quote so the operator can verify.
4. **NEVER recommend mass extraction until the latest probe's audit is CLEAN.**

## Field-by-field rubric

| Field | What to check |
|---|---|
| `direction` | Label which of the 5 cases the video actually is: (1) long-only, (2) short-only, (3) bidirectional both taught, (4) long with implied symmetric mirror, (5) long+short both explicit. Directionality = what the speaker TAUGHT, not what the instrument permits. |
| `entry_sequence` | Steps must be GENERALIZED RULES, not quotes from a specific trade (a literal price like "11028" in a step = contamination). |
| `stop.anchor` | Did the speaker say where stops go? Did the extraction capture that anchor (structure, level, wick), not a generic default? |
| `targets[]` | Speakers often imply multi-target (TP1 + runner). All captured? |
| `source_claim_win_rate` | Scan the FULL transcript — intro + middle + closing. A "52.63% win rate" said once mid-video counts; title hype does not. |
| `source_claim_avg_r` | "1:2 R/R" means `avg_r = 2.0`, NOT 1.2. Verify the direction of the ratio. |
| `confluences[]` | Every condition the speaker says must be true — captured? Empty because the vocabulary is uncatalogued is NOT acceptable (see intake rules). |

**The per-miss litmus test:** "If a trader had ONLY the extraction output,
could they reproduce the entry logic taught in the video?" YES and the miss is
mirror/synonym/umbrella/philosophy/stat → denominator noise. NO → real gap,
regardless of what any benchmark says.

## Direction misses — the mirror trap

Do NOT fold an opposite-direction "miss" as symmetric-mirror noise without
checking the transcript. The W7nln correction (2026-06-24): the speaker
EXPLICITLY taught the full short setup ("break below → retest as resistance →
bearish hammer/gravestone/engulfing + volume → short; stop above the level")
and the extraction collapsed it to "vice versa" — that was an extraction gap
mis-graded as mirror noise. Category A (true symmetric constructs:
engulfing↔engulfing, support↔resistance, hammer↔shooting-star) may fold;
Category B (trend filters, bias gates, one-sided rules, direction-specific
stops) must NEVER be inferred. When only longs are shown, mark longs EXPLICIT
and infer shorts only when genuinely symmetric — and document the inference.

## Intake rejection rules (what is and is not a reject)

The extractor extracts **ANY strategy in the speaker's words** — the catalog
(`kb/indicator-catalog.md`, ARCHETYPE_REGISTRY) is a DOWNSTREAM graduator
mapping, never an extraction gate. Uncatalogued vocabulary ("supply zone
retest after MSS") → extract verbatim; graduator owns mapping.

ONLY four hard rejects:
1. **No trading strategy at all** (educational/promo/portfolio-theory).
2. **Swing / multi-day / overnight hold** — day-trader-only; EOD trailing DD
   kills multi-day holds. Also reject screenshot-only / trade-recap videos.
3. **Options-MECHANIC dependence** — Greeks (theta/delta/gamma/vega),
   premium/IV, strike selection, 0DTE/expiration mechanics, spread structures
   (condor/butterfly/straddle). **"I take calls/puts" alone is NOT a reject**
   — that's the speaker's instrument, not the mechanic. A VWAP retest traded
   via calls is a KEEP (ports 1:1 to futures).
4. **Instrument-specific mechanics that don't port**: forex carry/swap,
   dividend capture, earnings plays, on-chain metrics, funding-rate arb.

The speaker's demo chart (EURUSD/AAPL/BTC) is NOT the strategy's market —
chart-based mechanics port to MES/MNQ/MCL unchanged → `futures_primary`.

## Red flags — the audit failed, do not proceed
- "6/6 GREEN, ready for mass extraction" citing probe output alone
- Grading a field without a transcript quote attached
- A rejection reason of `no_supported_market` / uncatalogued-indicator /
  "calls and puts" with no Greek/IV/strike evidence
- Folding a direction miss as "mirror" without the transcript check
- Win-rate/avg-R graded from the title or thumbnail
