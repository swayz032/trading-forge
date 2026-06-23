# Institutional-Grade Extraction — 100% Evidence-Based Plan (2026-06-22)

> Engineered via a 12-agent design+research workflow (research ≥2025 sources + code-map + 4 competing architectures + adversarial judge + synthesis). Run `wf_ca42b232-70c`.

## The problem
gemma4:e2b (5.1B local) captures only ~57% of a dense strategy transcript in a single pass (live-proven on `iU8ww5MC2FQ`: missed the Gann box, 4 zones, IRS model, 3-step entry). The W3 **safety** layer (coverage gate + quarantine) correctly *detects* the gap, but the system then **stops** — it never *closes* it. And the coverage_pct is **gameable** (checks name presence, not mechanic capture), so "rich"/coverage numbers are false-completeness signals across the whole 40-concept library.

## Winning architecture — 5-layer local-first hybrid (gemma4:e2b only, all merges quote-grounded + gap-fill-only)
Judges: sliding-window (D)=7 keep · decomposition (B)=5.5 · repair-loop (A)=4.5 · self-consistency (C)=4. None reach 100% standalone → hybrid.

- **Layer 0 — Full-transcript sliding-window enumeration** (`extraction-coverage-gate.ts:113`). Replace the 14K-char slice + 10-item cap with ~12K windows / ~2K overlap, per-window enumeration (each quote-verified), UNION by normalized name, cap→24. *This is what makes back-23K-char items (Gann zones, IRS) even visible.*
- **Layer 1 — Wire the dormant recall tier** (`transcript-extractor-recall.ts:327` `runRecallPass` — built+tested but **test-only**). Call it in `agent.ts` after chunked extraction, before the coverage gate. Recovers primary_tool_setup (Q6), time/candle/instrument.
- **Layer 2 — Depth-aware comparator** (`isItemCovered :226`). An item counts COVERED only if its name is present AND ≥`MIN_MECHANIC_TOKENS` (2) content tokens from *its own verbatim_quote* are present. "gann box" alone = SHALLOW (a repair target), not covered. **This makes coverage_pct ungameable** → the 5-URL gate measures real completeness.
- **Layer 3 — Bounded quote-grounded repair loop** (NEW `extraction-coverage-repair.ts`, wired `agent.ts` between coverage gate and compilability). While `verdict≠pass && coverage_pct<0.95 && rounds<2`: feed missing[]+SHALLOW[] (with enumeration verbatim_quotes as cues, ≤6/round) into ONE targeted gemma call → pure-merge (drop unverified quotes, UNION confluences, append non-covered steps) → re-run depth-aware verdict (free). Residual → existing W3.2 quarantine (no library pollution).
- **Layer 4 — Real naming + archetype routing on the COMPLETED extraction** (`agent.ts:1378`). Synthesize a non-generic concept_name from the top primary speaker_item; ensure entry_indicator non-null → `deriveEntryIndicator` routes iU8 to `archetype:gann_box_4h_continuation`.
- **SCHEMA CAVEAT:** do NOT add `evidence_quote` into the GBNF-constrained nested schema (`additionalProperties:false` — a prior nested-schema change caused an Ollama recursion OUTAGE). Carry quotes TS-side (step.rationale + a `_repair_evidence[]` sidecar).

## Build steps (subagent in parens)
1. **(critic-optimizer)** Windowed enumeration + cap→24 — `extraction-coverage-gate.ts`
2. **(critic-optimizer)** Depth-aware comparator + COVERED/SHALLOW/MISSING — `extraction-coverage-gate.ts`
3. **(paper-parity)** Wire `runRecallPass` into production — `agent.ts`
4. **(critic-optimizer)** Repair loop — NEW `extraction-coverage-repair.ts` + wire `agent.ts`
5. **(backtest-core)** Non-generic naming + archetype routing — `agent.ts` + assert graduator route
6. **(trading-forge-architect)** Gate operator-ingest mention-persist on compilability + fingerprint from real name — `admin.ts` + `strategy-fingerprint.ts`
7. **(observability-reliability)** Boot probe warm-load (keep_alive) + 60s timeout + 1 retry — `model-router.ts`
8. **✅ DONE** youtube-transcript@^1.3.1 → main
9. **(observability-reliability)** Library count = 40 unique (×3 symbols), 117 in subtitle — library route + LibraryDiversityPanel
10. **(trading-forge-architect, LAST)** `scripts/validate-5url-extraction.ts` harness + parity gate + System Map sync

## THE GATE (operator mandate)
**Manual field-by-field audit vs raw transcript on 5 real YouTube source URLs. coverage_pct is INPUT, never the pass criterion.** Per-URL PASS = (1) every PRIMARY mechanic captured with mechanic-depth, (2) ZERO fabricated items (every field has a verifyQuoteInTranscript=true quote), (3) non-generic name + real archetype (or honest quarantine), (4) operator sign-off. **GATE = 5/5 PASS.** No mass re-extraction until 5/5 + 5-fixture parity PASS.

Test URLs: `iU8ww5MC2FQ`, `N7uP9V0Iktc`, `UBvfsImdI2U`, `z3Qn3fBoe2I` (+1 from bucket-mentions).

## Gated mass re-extraction (AFTER 5/5)
Worklist = 40 unique fingerprints → source URLs via `strategy-source-resolver.ts`. Re-extract SEQUENTIALLY (single GPU, never parallel gemma) through the same pipeline. PASS+compiles → replace; FAIL → quarantine (keep prior row, log library-debt). Then backfill `completeness_grade` (from depth-aware coverage_pct, NOT factor count). Spot-audit 5 of 40. ~11 gemma calls × 40 ≈ 440 sequential calls, offline, days not hours.

## gemma budget
Per dense transcript: ~5 chunk + ~3 enum + 1 recall + 0-2 repair = ~9-11 calls (offline only; +50-80% vs baseline; re-verify is FREE). VRAM unchanged (~1.6GB, keep_alive holds one copy). Zero cloud (no-cloud mandate → the boot warm-load fix is load-bearing).

## Acceptance
Enumeration over FULL transcript (>10 items on iU8); depth-aware unit test (bare "gann box"=SHALLOW); runRecallPass called in production; repair bounded≤2 + monotone + every field quote-true; iU8 re-run depth-aware coverage≥0.95 + manual audit confirms Gann box+zones+IRS+3-step+redemption+hidden level+1:2R/PDH-PDL+4H + named + routed; no GBNF nested-schema change; parity PASS; operator-ingest stops pooling compilable=false into c25828a8; boot warm-load; count shows 40; **5/5 gate before mass re-extract**; 3 CI gates green; System Map synced.
