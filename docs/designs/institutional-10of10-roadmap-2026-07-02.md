# Institutional 10/10 Roadmap — YouTube Extraction → Backtest → Overlay Testing → Live
**2026-07-02 · grounded in code verified this session + deep-scans #6–#11 + the certified 6-video gate**

Grading convention: a band is 10/10 when a hostile fund-DD reviewer could not name a missing control.
Current grades are honest, not aspirational. Items marked ★ are the five gaps from today's assessment.

---

## Band A — Extraction & Compilation (research pipeline) — **9.0 today**
The certified compiler (46/46 probes, golds 7/7 + 100%, Ledger A–G, Δ=0 determinism) is the strongest band.
What separates 9 from 10:

| # | Item | Why 10 needs it | Effort |
|---|---|---|---|
| A1 ★(2) | **Extraction provenance version-stamps** — prompt hash + gemma model digest + compiler commit into every spec artifact + manifest | Silent model/prompt drift currently undetectable; mirrors Phase 1.3 backtest provenance | ~half day, AFTER the running batch |
| A2 ★(3) | **Gate → standing regression CI** — golds (psH, l-2, +MKsj/h6T) + 6 ground-truth probe suites run on ANY compiler/prompt change; red = merge-blocked (same discipline as the 5-fixture production parity rule) | Today proved one prompt line shifts the whole labeling distribution; certification decays without CI | ~1 day (harness exists; wire as npm script + CI gate) |
| A3 | **Ungroundable-condition policy** — the CCI product decision (h6T) + a standing rule: ungroundable conditions block that strategy's onboarding OR are explicitly waived per-strategy with an audit row | Ledger F reports gaps honestly; 10/10 requires a *decision procedure*, not just a report | decision + ~half day |
| A4 | **Corpus refresh cadence** — scout-discovered videos flow through the certified compiler on a schedule; re-extraction triggered when pipeline version changes | The corpus is a living asset; one-shot extraction rots | ~1 day (cron + version check) |
| A5 | (deep-scan #11 fix wave, other agent) **Production-path grounding** — wire the existing coverage-gate verbatim-quote verifier into the scout path; fix the parity gate (qwen→gemma4, minimal-path fixtures) | The OLD path still creates strategy rows today; both CRITICALs verified in code | theirs; coordinate fixtures with my ground truths |

## Band B — Spec → Production Onboarding (THE unclaimed bridge) — **2.0 today**
★(1) Nothing exists. The single biggest gap on the board. 10/10 requires:

| # | Item | Notes |
|---|---|---|
| B1 | **Spec→strategies-row converter** — EngineStrategySpec → config (entry conditions, entry_quality with REAL extracted confluences, direction incl. mirror-candidate rows, timeframes from spans) + framework overlay applied | The converter must preserve provenance: strategy row carries spec_hash + video id |
| B2 | **Playbook registration** — every onboarded strategy mapped into ALL_STRATS families (or an explicit new-family registration flow) | Verified this session: unregistered = overlay silently bypasses = every Mode A/B run void |
| B3 | ×3 symbol split preserved (MES/MNQ/MCL) with per-symbol stop ceilings honored | Operator convention |
| B4 | Onboarded strategies enter at CANDIDATE and walk the FULL ladder (Gate 1/2/3 + auditor + SHADOW) — no fast-tracks | Evolution-INSERT lesson (deep-scan #11): every creation site passes the same gates |
| B5 | **Old-library retirement executes** (`retire-old-library.ts --apply`, 117 frozen IDs → GRAVEYARD) after B1–B4 land | Ready; operator go |

Effort: ~3–5 days. **Gates Phase 2 — no volume through an unonboarded corpus.**

## Band C — Execution Semantics for Compiled Strategies — **6.0 today**
★(4) Extraction fidelity is certified; execution rigor is one tier below.

| # | Item | Notes |
|---|---|---|
| C1 | **The decision: per-condition evaluators vs archetype mapping.** Recommended: HYBRID — map each spec condition family onto the 34 audited archetypes/engine primitives (structure_engine BOS/CHoCH/MSS, liquidity_levels 17 types, killzone.ts, VWAP/AVWAP, candle_patterns) where a primitive exists; keep the research family-evaluators ONLY for conditions with no primitive, flagged `approximation=true` in results | Engine primitives are already institutional-grade (deep-scans 8–10 hardened them); reuse beats rebuild |
| C2 | **Ledger E extended** — TS↔Python interpreter parity already proven (604/604); extend the parity suite to every NEW evaluator wired in C1 | Existing pattern (check:ts-python-exit-parity) |
| C3 | **Ledger G as standard output** — every production backtest of a compiled strategy can emit trade→condition→span traces on demand | Already built for research; expose as a flag |

Effort: ~4–6 days after the C1 decision.

## Band D — Validation Battery — **8.5 today** (the Phase 1 plan closes most of it)
Existing and already institutional: CPCV-default, PBO<15%, DSR (full Bailey post deep-scan #9), WFE≥0.70,
B14 ruin ci_high (firm-breach basis), B15 jitter battery, BIF, frozen-policy hash, SHADOW divergence.

| # | Item | Notes |
|---|---|---|
| D1 | (Phase 1.2, other agent) Null-strategy noise floor —**make every gate verdict floor-RELATIVE**: "pass" = above the measured false-pass rate, reported as excess-over-null | The single most important epistemic upgrade |
| D2 ★(5) | **Corpus-level FDR control** — Benjamini-Hochberg (or Harvey-Liu-Zhu haircuts) across the ~200-strategy population, per educator-family; publish corpus-level expected-false-discoveries alongside per-strategy verdicts | Per-strategy gates can't see population-level selection; educators are sampled by marketing, not trading |
| D3 | (Phase 1.3, other agent) Provenance-stamped backtest rows as hard persistence gate | Complements A1 — together they give end-to-end lineage |
| D4 | Regime-stratified reporting standard: every verdict reports per-regime (5-class) performance, not just aggregate | Data exists (regime classifier); make it a required output |

## Band E — Confluence Overlay Testing — **7.0 today**
Built this session: Mode A/B ablation, Δ_overlay corpus sweep, per-layer attribution + A+ retention +
daily-band metrics, gate skipped_signals instrumentation. Plus Phase 1.1 exit replay (other agent).

| # | Item | Notes |
|---|---|---|
| E1 | **Full battery under both modes** — WF + CPCV + PBO + DSR + B14 with TF_CONFLUENCE_OVERLAY_DISABLED toggled; today's instruments are single-backtest core | The toggle is global; mostly orchestration work |
| E2 | (Phase 1.4) Leave-one-filter-out CPCV ablation with the ≥0.05 OOS-DSR keep rule — seeded by the per-layer finding (NO_TRADE playbook ≈ 99% of cuts) | Refinement target already localized |
| E3 | **Overlay unfreeze protocol** — written procedure: component unfreezes ONLY on (profitable Mode A baseline) + (E2 evidence) + (A+ retention ≥ threshold on gate-passed strategies); each unfreeze = one component, one audit row | Codifies the standing rule into a mechanism |
| E4 | A+ retention as a first-class gate metric for overlay changes (≥80% retention on positive-expectancy strategies per the adopted protocol) | Instrument exists; formalize the threshold |

## Band F — Data Integrity — **8.5 today** (deep-scan #10 closed the CRITs)
Remaining: F1 next Databento refresh rebuilds CME-session-anchored daily bars (owned, operator-next);
F2 data-snapshot ids joined into provenance stamps (with D3); F3 volume-quality flags for VP-dependent
strategies (vacuum-method class needs honest volume-data grading before its verdicts count).

## Band G — Governance & Ops — **8.0 today** (owned by Phase 0/3 + fix waves)
G1 Office approval card (Phase 3 P0, gates live money) · G2 secrets rotation (operator, Phase 0) ·
G3 quota budget + zero-extract alerting (deep-scan #11 wave) · G4 evolution INSERT gate parity (same wave) ·
G5 4 unresolved strategies from the 117→40 mapping: manual review or retire unreplaced.

---

## The path to 10/10, ordered
1. **Now (in flight):** 40-video re-extraction completes → manifest.
2. **Immediately after:** A1 provenance stamps + A2 regression CI (mine, ~1.5 days) — locks the asset.
3. **The bridge:** B1–B5 onboarding + retirement (~3–5 days) — unlocks Phase 2 honestly.
4. **Parallel (other agent):** Phase 1.1–1.4 + deep-scan #11 fix wave (D1/D3/E2/A5/G3/G4).
5. **Then:** C1 decision + evaluator/archetype wiring (~4–6 days) → compiled strategies get production-grade verdicts.
6. **Then:** E1 full-battery Mode A/B + D2 corpus FDR → the overlay question answered at population scale, above a measured noise floor.
7. **Standing:** E3 unfreeze protocol, A4 refresh cadence, D4 regime reporting.

**Total: ~2.5–3.5 focused weeks to a system where every band survives hostile DD** — consistent with the
Master Plan's estimate, with Bands B and C as the additions nobody's plan owned.
