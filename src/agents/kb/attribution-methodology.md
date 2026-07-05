# Attribution Methodology — Trading Forge KB Card

> **Loaded by:** `trade_critique` (via `critique-knowledge-retriever.ts`, Wave 1 institutional RAG grounding).
> **Purpose:** Rigorous, auditable definition of the 8-dimension attribution framework used by the per-trade autopsy. This card is BOTH the analyst reference AND the machine-readable spec the faithfulness checker (`critique-faithfulness-check.ts`) enforces.
> **Authority:** Canonical for the critique subsystem. Section-key convention: each dimension is headed `## KEY: <dim>` (lowercase snake). The retriever slices by these keys; the faithfulness checker reads the FAITHFULNESS RULE below.
> **Last updated:** 2026-07-05.

---

## Why attribution must be grounded, not narrated

The nightly critique is an **LLM-as-analyst**, never an LLM-as-trader (institutional 2025-2026 state of the art — arXiv 2510.05533; arXiv 2603.27539; FINRA 2026 Regulatory Oversight Report). A frontier model can produce a *confident* attribution that is *confabulated* — right about the grade, wrong about WHY (arXiv 2605.27773 "Do Models Know Why They Changed Their Mind?"; arXiv 2602.14233 — "CoT rationales should not be treated as transparent traces of the model's internal decision process"). Stated rationale is not a faithful trace of the true decision basis.

The defense is the **FAITHFULNESS RULE**: a dimension may only carry attribution weight if the underlying data field that evidences it is actually present in the trade input. A dimension weighted on absent data is a confabulation flag, not a finding (arXiv 2605.27773; arXiv 2602.14233; arXiv 2512.02261 "TradeTrap" — small unfaithful components propagate into large downstream errors).

**Attribution weights are causal shares of the trade's R outcome and MUST sum to 1.00 (±0.02).** Weight explains R, never win/loss (win rate is an observed output, never a target — CLAUDE.md §1).

---

## The FAITHFULNESS RULE (spec the checker enforces)

For each of the 8 dimensions, the dimension's weight may be **material (≥ 0.10)** ONLY if its **evidencing data field is present** (non-null) in the trade input `llmInput`. If a dimension carries weight ≥ 0.10 but its evidencing field is null/absent, the faithfulness checker emits:

`attribution.<dim> weighted <w> but <field> missing`

Dimension → evidencing input field (canonical mapping — the checker reads THIS table):

| Dimension (`## KEY:`) | Evidencing field in `llmInput` | Present-when |
|---|---|---|
| `regime`     | `context.regime_at_entry`           | regime label is non-null |
| `structure`  | `context.structure_state`           | Wave 25 structure snapshot present |
| `narrative`  | `context.narrative_phase`           | Wave 25 HTF narrative present |
| `confluence` | `context.confluence_factors_active` | active-factors array present |
| `decay`      | `context.confluence_factors_active` | (decay_confidence rides inside each factor) |
| `liquidity`  | `context.nearest_liquidity_level`   | nearest liquidity level present |
| `fill`       | `position.fill_probability` (or `position.slippage`) | either non-null |
| `exit_plan`  | `position.exit_reason`              | exit reason recorded |

**Materiality threshold:** `0.10`. A dimension weighted below 0.10 does not require its field (a small residual weight on a data-poor dimension is acceptable; a *material* weight on absent data is not). This mirrors the rubric's own "minimal → fill + exit_plan take majority weight; other dimensions 0.0 if no data" contract in `trade-critique.md`.

**Why fill + exit_plan are always assessable:** slippage, fill_probability, and exit_reason are recorded on every `paper_position` regardless of Wave 25 field completeness. They are the two dimensions that never legitimately need a `[data unavailable]` marker (`trade-critique.md` §"Handling Missing Wave 25 Fields").

---

## KEY: regime

**What it means.** Did the regime at entry match the strategy's declared `preferred_regimes`, and was the regime correctly identified? Regime mismatch is the single most consistent cause of out-of-sample failure (`kb/regime-taxonomy.md`; López de Prado, *Advances in Financial Machine Learning*).

**What evidences it.** `context.regime_at_entry` (TRENDING_UP / TRENDING_DOWN / RANGE_BOUND / … per `kb/regime-taxonomy.md`) compared against `strategy.preferred_regimes`.

**How to weight it.** High weight when the regime at entry contradicts the strategy's preferred regime (a trend strategy that fired in RANGE_BOUND). Low weight when regime was aligned and stable. If `regime_at_entry` is null → weight must stay below 0.10 and `regime_mismatch` reported against `[data unavailable]`.

## KEY: structure

**What it means.** Was BOS / CHoCH / MSS confirmed before entry? Was the PD (premium/discount) zone clean or compromised? (Wave 25 independent Structure Engine — `src/engine/context/structure_engine.py`.)

**What evidences it.** `context.structure_state`. Null for pre-Wave-25 positions → use `[data unavailable]`, keep weight < 0.10.

**How to weight it.** High when structure was unconfirmed or counter-trend at entry. The Structure Engine publishes state BEFORE the trigger evaluates, so `structural_setup=true` is no longer circular with the entry firing (W25.2).

## KEY: narrative

**What it means.** Did the HTF narrative — London bias, NY-open direction, daily dealing-range quadrant, A/M/E phase — support the trade direction? (Wave 25 Pass 2/6 HTF narrative + A/M/E state machine.)

**What evidences it.** `context.narrative_phase`. Null → `[data unavailable]`, weight < 0.10.

**How to weight it.** High when the trade fought the HTF narrative (long in a distribution/manipulation phase against London bias).

## KEY: confluence

**What it means.** How many confluence factors were active, what was the aggregate weighted score, and were any high-weight factors missed? (Wave 25 11-factor weighted model — `confluence-score.ts`, default threshold 0.72.)

**What evidences it.** `context.confluence_factors_active` (array of `{factor, weight, satisfied, decay_confidence}`) and `context.confluence_score`.

**How to weight it.** High when the aggregate score barely cleared threshold or a high-weight factor (`market_structure_aligned` 0.20, `liquidity_target_clear` 0.13) was unsatisfied. Populate `confluence_factors_missed[]` from the unsatisfied entries.

## KEY: decay

**What it means.** Were satisfied confluence factors STALE at entry (low `decay_confidence` < 0.70)? Did factor decay explain a premature reversal? (Wave 25 Pass 4 confluence decay engine — 6 of 11 factors carry time-based decay multipliers.)

**What evidences it.** The `decay_confidence` field inside each `context.confluence_factors_active` entry. Shares the same evidencing field as `confluence`.

**How to weight it.** Material only when a factor was satisfied-but-aged (e.g. a 240-bar CHoCH, a 3+-touch order block). If the active-factors array is absent, decay cannot be assessed — weight < 0.10.

## KEY: liquidity

**What it means.** Was the nearest liquidity level above or below entry, and did the trade target the correct side of the pool? (Wave 25 Pass 3 persistent liquidity map — `liquidity_levels`.)

**What evidences it.** `context.nearest_liquidity_level` (`{level_type, price, sweep_probability, htf_significance}`). Null → `[data unavailable]`, weight < 0.10.

**How to weight it.** High when the trade targeted the WRONG side of an obvious draw-on-liquidity, or entered right into a high-sweep-probability level. Intraday DOL only — PWH/PWL/PMH/PML are excluded per the day-trader mandate (`INTRADAY_ALLOWED_LEVEL_TYPES`).

## KEY: fill

**What it means.** How did realized slippage compare to expected ATR-scaled slippage, and was `fill_probability` above 0.80? Execution-quality dimension.

**What evidences it.** `position.slippage` and `position.fill_probability` (either present suffices). ALWAYS assessable — recorded on every fill.

**How to weight it.** High when slippage materially exceeded the ATR-scaled expectation or fill_probability was marginal. See `kb/execution-microstructure.md` for per-symbol slippage benchmarks.

## KEY: exit_plan

**What it means.** Did the actual exit match the planned Style C exit (TP1 33%@1R / TP2 33%@2R / runner) or the adaptive exit plan? Did the 15:55 ET time-stop fire? Was BE+1 triggered on TP1 fill?

**What evidences it.** `position.exit_reason` (tp1 / tp2 / time_stop / trailing_stop / runner / stop), plus `tp1_price` / `tp2_price` / `stop_price`. ALWAYS assessable.

**How to weight it.** High when execution diverged from plan (early flatten, time-stop caught a would-be runner, BE move mistimed). Feeds `exit_execution_delta_r` = realized_r − planned_r_at_exit_reason.

---

## Attribution constraint (hard)

`regime + structure + narrative + confluence + decay + liquidity + fill + exit_plan = 1.00` (within 0.02). This is enforced independently in `trade-critique-service.ts::validateCritiqueOutput`; the faithfulness checker is ADDITIVE — it checks that material weights are *supported by data*, not that they sum correctly.

## What faithfulness does NOT do

- It does not re-grade the trade or change the A-F grade.
- It does not block persistence — it is an ADVISORY signal (challenger-only governance; the critique is dashboard/aggregator input, never a live-trading control — arXiv 2605.19337; FINRA 2026 no-safe-harbor finding).
- It is single-pass; calibration against an operator-labeled reference set (Cohen's kappa) and self-consistency sampling remain documented follow-ups (evidence file R9 / R10; arXiv 2512.22245).

## Sources

- arXiv 2605.19337 — Agentic Trading (2026-05-19): "Oracle Fallacy"; auditability depends on grounded, time-stamped tool calls + data snapshots.
- arXiv 2603.27539 — Reliable Evaluation of LLM Financial Multi-Agent Systems (2026-03-29): verifier-gated execution preferred for institutional deployment.
- arXiv 2605.27773 — CoT Faithfulness (2026-05-27) + arXiv 2602.14233 (2026-02-15): stated rationale ≠ faithful trace of the decision process.
- arXiv 2512.02261 — TradeTrap (2025-12-02): unfaithful components propagate into large drawdowns.
- arXiv 2510.05533 — The New Quant (2025-10-07): separate research from order routing; log retrievals for audit.
- FINRA 2026 Regulatory Oversight Report (via Debevoise / McGuireWoods / Sidley; arXiv 2604.01483) — no safe harbor for "the LLM decided".
- `docs/institutional-evidence/nightly-llm-research-dept-2026.md` ADDENDUM 2026-07-04 — sub-claims 7-10, R9-R13.
- Trading Forge `src/agents/trade-critique.md` — the 8-dimension rubric this card grounds.
