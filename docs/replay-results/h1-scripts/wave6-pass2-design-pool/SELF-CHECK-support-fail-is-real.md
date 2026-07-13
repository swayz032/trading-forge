# Pass-2 design-pool — doer self-check: the support-fail is REAL (2026-07-13)

Computed BEFORE the verdict was spoken (bar-before-score / vault-before-iterate).

## Gate readings (as measured)
- **Gate 2 coverage:** aggregate MET (pass2=291 vs baseline=253, floor 228). Video-level: no video lost >50%. BUT 5 videos tripped the over-enumeration fence → need fresh-context blind adjudication (doer≠grader; the guard correctly refused to self-resolve).
- **Gate 3 GATED support:** 160/194 pass → **miss 17.5%**, floor ≤8% → **NOT MET.**
- **Gate 3 TERMINAL-EQUIVALENT support:** miss 17.9% over 195 (the number the fresh-12 would reproduce).
- **Sentinel usage:** 0.0% — the honest no-quote door was NEVER used.

## False-red check (is the substring gate wrongly rejecting faithful quotes?)
Re-ran all 34 mechanical-fails against the actual spent-16 transcripts under AGGRESSIVE normalization (NFKC + unify curly-quotes/dashes/ellipsis + **drop ALL punctuation** + collapse whitespace + lowercase):
- **RECOVERED (normalization artifact, would-be false-red): 2** (both E9MzEC_yNoM, same repeated quote).
- **TRULY ABSENT (real unfaithful quote): 32.**
- **Honest miss crediting the 2 recoveries: 32/194 = 16.5%** — still >2× the 8% floor.

## The disease (samples of truly-absent quotes)
- `"wait for a 5-minut fair value gap form..."` — gemma dropped the 'e' from "5-minute": it is TOKEN-GENERATING the quote field, not copying a substring.
- `"...continue to the upside"` where the condition said "continue pushing to the upside" — paraphrase.
- `"set our stop loss right right below the liquidity grab"` — reconstruction.

**Conclusion:** quote-as-you-extract (GBNF declaration-order → quote emitted FIRST) made gemma produce a quote before the condition, but could NOT make that quote FAITHFUL. The model paraphrases into the quote slot and never abstains (sentinel 0.0%) because it does not know when it is paraphrasing. The support-miss is a real property of the frozen local extractor, not an instrument artifact.

## Over-enumeration escalations (Gate 2 secondary — support already fails)
- OVER-split candidates (fabrication, §13): E9MzEC_yNoM (3 vs 1), IyFioFkRgWo (2 vs known-1), kFyD3H6I1I8 (2 vs 1) = **3 candidates → §13's ">2 of 16 = systematic" threshold is LIVE** pending blind adjudication.
- UNDER-split candidates (silencing, §9b strict-fail): -igpOZs8LsM (1 vs 2), R5L890juvRw (1 vs 4).
- All 5 require fresh-context blind adjudication — NOT self-resolvable (doer≠grader).

## Routing
This is the budget's FINAL extractor-iteration pass. Pass-1 failed the content-check (WEh variant-B silencing, since recovered by Phase A). Pass-2 fails support decisively (16.5% honest, floor 8%) AND carries a live systematic-fabrication risk. Both faithfulness passes aimed at the local extractor missed the bar. **The Phase-1 fork fires** — fork options are the operator's to rule, not the doer's.
