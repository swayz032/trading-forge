# Sealed-read seam enumeration — DERIVED FROM CODE (R-033 §3 law)

> The minted law (R-033 §3): the seam list is DERIVED FROM CODE, never from narrative.
> This checklist is computed by enumerating, in `src/engine/extraction/sealed_read_driver.py`,
> every sealed-mode live dependency: each `live_*_fn` the sealed branch requires
> (raise-if-None guards), each injected model seam (`propose_fn`), the stage-0 fetch,
> the terminal verdict, and each conductor `_make_conductor_*_fn` artifact dependency.
> Every "green" claim carries one line per DERIVED seam with its LIVE receipt.

## Derivation sources (grep-verifiable)

- Sealed raise-if-None guards: `live_phase_a_draw_fn`+`live_phase_b_fn` (driver:1056),
  `live_panel_fn` (driver:1490), `rater_fn` (driver:2227).
- Injected model seam used on sealed: `propose_fn` → `anchor_locator._default_propose_fn`
  (gemma via Ollama, "the ONLY LLM step", anchor_locator.py:14/98-99/134).
- Stage-0 dependency: transcript fetch (`_default_transcript_fetch_fn`, npx tsx bridge).
- Terminal: Module-E verdict + independent re-verify (deterministic from artifacts).
- Conductor artifact readers: `_make_conductor_{phase_a_draw,phase_b,panel,rater}_fn`.

## THE SEAM CHECKLIST (7 seams)

| # | Seam | Live mechanism | Conductor artifact | LIVE receipt (spent 2DX) |
|---|------|----------------|--------------------|--------------------------|
| 1 | Transcript fetch (stage-0) | `fetch_fn` (npx tsx `h1-fetch-one.ts`) | `transcripts/<vid>.txt` | ⚠️ **GAP** — git-bash fetch works; `npx` via Python subprocess fails on Windows (WinError 2). Needs plumbing fix or documented pre-fetch. |
| 2 | Phase-A dispatch | `live_phase_a_draw_fn` → `_run_claude_p` no-tools | `phase_a/<vid>/draw_<i>.json` | ✓ 5 blind draws, 0 retries |
| 3 | Anchor-locator | `propose_fn` → gemma (Ollama `gemma4:e4b-it-qat`) | (drives packet quote_anchors) | ✓ ran live in certify (18 anchored stage-1 quotes, 8 stage-2 conditions) |
| 4 | Phase-B dispatch | `live_phase_b_fn` → `_run_claude_p` no-tools | `phase_b/<cid>.json` | ✓ 3 strategies, 0 retries |
| 5 | Panel dispatch | `live_panel_fn` → gpt-5.4 `{conflation, enumeration_consistency, completeness}` | `panels/<cid>.json` | ✗ **GAP** — no operationalized dispatch (no `--dispatch panel`); rehearsals LOAD CACHED; never run live |
| 6 | Rater dispatch | `rater_fn` → `_run_claude_p` no-tools, 2 stages | `raters/<id>.json` | ✓ both stages (38 roles + 28 support), 0 retries |
| 7 | Verdict + re-verify | Module E (deterministic from persisted artifacts) | — | ✗ **never run through live** (all rehearsals stopped before the verdict) |

## Status (R-033)

- Seams 2, 3, 4, 6 — PROVEN LIVE on spent 2DXQqwKSwJE.
- Seam 5 (panel) — the AR-023 catch; operationalize + prove (R-033 resolution 1–4).
- Seam 7 (verdict) — proven only when the through-the-verdict rehearsal runs (R-033 p4).
- Seam 1 (fetch) — operationalization gap surfaced BY this enumeration; plumbing fix (npx
  resolution) or a documented pre-fetch step, disclosed here rather than left implicit.

Green is TRUE only when every row above carries a ✓ live receipt. This document is the
completeness definition R-033 §3 requires; AR-024 reports it with every receipt filled.
