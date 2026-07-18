# Sealed-read RECEIPT MATRIX — R-034 §4 (green defined finitely)

> R-034 §4: green is a CHECKABLE STATE, not a narrative. Rows = the code-derived
> seams (R-033 §3 law). Columns = {mechanics receipt · input-faithfulness receipt
> (with parity check) · output-consumed receipt}. When every cell carries evidence,
> green is checkable. An eighth catch would have to name a NEW column.
>
> Derivation: every sealed-mode `live_*_fn` (raise-if-None at
> sealed_read_driver.py:1056/1490/2227), `propose_fn` (anchor_locator), the stage-0
> fetch, and each conductor `_make_conductor_*_fn` artifact dependency.

## The matrix (spent 2DXQqwKSwJE; NEVER the twelve)

| # | Seam | Mechanics | Input-faithfulness (+ parity) | Output-consumed |
|---|------|-----------|-------------------------------|-----------------|
| 1 | Transcript fetch | ✅ npx full-path resolved | ✅ live-fetch 2DX hash-MATCHED on-disk (t5, zero sealed cost) | ✅ consumed by Phase-A/B |
| 2 | Phase-A dispatch | ✅ 5 blind draws, 0 retries | ✅ transcript is the certified enumerator input | ✅ consensus computed, consumed by Phase-B |
| 3 | Anchor-locator (gemma) | ✅ ran live in certify | ✅ propose_fn input = (transcript, condition) — the certified instrument, used directly | ✅ anchors consumed by cert + raters |
| 4 | Phase-B dispatch | ✅ live, 0 retries | ✅ embeds certified scope {name,entry,exit,variants,element_inventory}; parity RED on drop; surplus excluded | ✅ extraction consumed by certify + panels |
| 5 | Panel dispatch (gpt-5.4) | ✅ **LIVE** 3 cids × 3 axes, cap-guarded, SHA-pinned graders | ✅ threaded inventory + certified-shape extraction + transcript; prompts byte-unchanged (SHA-pinned) | ✅ panels consumed by the certificate |
| 6 | Rater dispatch (2 stages) | ✅ live A+B, both stages, 0 retries | ✅ driver-built packet (pilot shape) + stage-scoped output_contract | ✅ consumed by Module-D adjudication |
| 7 | Verdict + re-verify | ✅ computed + **reverify MATCH** | n/a (deterministic from artifacts) | ✅ THE terminal output — the faithful through-verdict run |

**GREEN IS A STATE: every cell ✅.** The faithful through-verdict run on spent 2DXQqwKSwJE (2026-07-17) executed all 7 seams LIVE with faithful inputs -> INDETERMINATE_SOURCE_ATTRITION (correct on 1 video, floor 9) + validity VALID + reverify MATCH. Independent grade BAND 7 SAFE (grader HIGH/MEDIUM findings — grader-prompt SHA-pin + builder-drift alarm — CLOSED). An 8th catch would have to name a new column.
