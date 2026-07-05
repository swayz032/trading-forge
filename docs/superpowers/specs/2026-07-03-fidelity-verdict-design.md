# Fidelity Verdict — Design Spec (Wave C)

**Date:** 2026-07-03
**Status:** Approved (operator "EXECUTE AND MAKE US INSTITUTIONAL GRADE" 2026-07-03)
**Phase note:** New capability (overrides §2, operator-authorized). It is a **research-integrity annotation**, NOT a deployment gate — it never blocks a strategy from trading; it decides whether a backtest counts as *evidence for the educator's idea*.

## Purpose

Answer the third axis of the research conveyor: **does the strategy actually run like the speaker in the YouTube video said — his steps, in his order?** A strategy's profit (and the Mode A/B overlay verdict) is only evidence *for the educator's playbook* if the execution was faithful to what he taught. Otherwise it validates a compiler artifact or a lucky mutation wearing his name.

**The principle it enforces:** *no alpha attributed to an educator without fidelity to what he taught.*

## What it rolls up (signals that already exist)

- **Compile fidelity (per-step, always available for spec-compiled strategies):** `BindingPlan.bindings: list[ConditionBinding]` — each stated condition is `primitive=None` (**dropped/unmappable**), or bound with `approximation=False` (**faithful**) or `approximation=True` (**approximated**). `role=="spine"` marks a core step; `primitive=="provenance_only"` marks a non-executable context clause (excluded from the denominator). `spine_bound/spine_total` is the core-step bind ratio.
- **Execution fidelity (cheap, from `per_condition_bool` at entry bars; richer when `TF_SPEC_TRACE=true` via `result["spec_trace"]`):** confirms bound spine steps actually gated entries + measures how loosely approximated steps fired.
- **Provenance:** `spec_provenance_ref` (educator-sentence → backtest-row).

## Scope

Applies ONLY to **spec-compiled strategies** (those with a `BindingPlan` — the Band-C condition-compiled corpus). Archetype + legacy strategies have no binding plan → `verdict: "NOT_APPLICABLE"` (honest; not scored, not admissible-as-educator-evidence).

## The contract (producer ⇄ consumer — must not drift)

Engine writes `backtests.fidelity_verdict` JSONB:

```json
{
  "schema_version": 1,
  "applicable": true,
  "steps_total": 8,            // executable stated spine steps (excl provenance_only)
  "steps_faithful": 6,         // bound + approximation=false
  "steps_approximated": 1,     // bound + approximation=true
  "steps_dropped": 1,          // primitive=None (stated but NOT enforced)
  "spine_bound_ratio": 0.875,  // BindingPlan.spine_bound / spine_total
  "fidelity_score": 0.81,      // (steps_faithful + 0.5*steps_approximated) / steps_total
  "sequence_honored_pct": 0.91,// from spec_trace when TF_SPEC_TRACE on; null otherwise
  "verdict": "APPROXIMATED",   // FAITHFUL | APPROXIMATED | LOW_FIDELITY | NOT_APPLICABLE
  "admissible": true,          // evidence-for-educator (see rule)
  "approximated_conditions": ["confluence_filter"],
  "dropped_conditions": ["smt_divergence"],
  "spec_provenance_ref": "<video>#<spec_hash8>",
  "computed_at": "2026-07-03T..."
}
```

- `fidelity_score = (steps_faithful + 0.5*steps_approximated) / steps_total` (faithful=1.0, approximated=0.5, dropped=0.0). `steps_total==0` → `NOT_APPLICABLE`.
- **Verdict bands:** `NOT_APPLICABLE` (no binding plan) · `FAITHFUL` (score ≥ `FIDELITY_FAITHFUL_THRESHOLD` (0.85) AND `steps_dropped==0`) · `LOW_FIDELITY` (score < 0.50 OR any **spine** step dropped) · else `APPROXIMATED`.
- **admissible (evidence-for-educator):** `verdict ∈ {FAITHFUL, APPROXIMATED}` AND `fidelity_score ≥ FIDELITY_ADMISSIBILITY_THRESHOLD (0.70)` AND no dropped **spine** step. Below → the backtest is quarantined as "tests our approximation, not his idea."

## Components (well-bounded units)

1. **Engine scorer** — `src/engine/statistics/fidelity_verdict.py`: PURE `compute_fidelity_verdict(binding_plan, spec_trace=None, spec_provenance_ref=None)` → the contract dict. No I/O. Excludes `provenance_only` from the denominator; counts spine-role steps by (primitive, approximation).
2. **Engine emit** — `src/engine/backtester.py`: after a spec-compiled backtest, emit `result["fidelity_verdict"]` (reuse the already-constructed `strategy.binding_plan` + optional `strategy.last_trace`). Non-spec strategies emit `{applicable:false, verdict:"NOT_APPLICABLE"}`.
3. **Schema** — migration `backtests.fidelity_verdict JSONB` **+ same-change CORE_DDL sync** in `pglite-db.ts` (pinned hazard) + `schema.ts` column.
4. **TS reader/annotation** — `src/server/lib/fidelity-verdict.ts`: pure reader → `{verdict, admissible, score, ...}`. Persisted via `backtest-service.ts` completion `.set()` (cherry-pick, like `slippageSurvival`). Emits audit `fidelity.verdict_evaluated`. **NOT a promotion gate** — it annotates + tags admissibility; it never blocks a lifecycle transition.
5. **Corpus dimension** — expose `fidelity_verdict.admissible` so the research corpus (Mode A/B harness, `corpus-fdr-report.py`) can partition **faithful-educator-evidence** vs **our-approximation-experiments**. v1: persist + expose + audit; wiring the FDR/Mode-A/B to filter on it is a documented follow-up (kept small).
6. **Observability** — audit `fidelity.verdict_evaluated`, SSE `backtest:fidelity_evaluated`, Prometheus `tf_fidelity_verdict_total{verdict}`.

## Data flow

`spec-compiled backtest → BindingPlan (+spec_trace) → fidelity_verdict.py → result["fidelity_verdict"] → backtests.fidelity_verdict (JSONB) → fidelity-verdict.ts reader → corpus annotation + admissibility + audit`

## Config (env, defaults)

| Env | Default | Meaning |
|---|---|---|
| `FIDELITY_ADMISSIBILITY_THRESHOLD` | `0.70` | Min score to count as evidence-for-educator |
| `FIDELITY_FAITHFUL_THRESHOLD` | `0.85` | Score for the FAITHFUL band |

## Testing (no-bad-wiring bar)

- **pytest** (`fidelity_verdict.py`): all-faithful → FAITHFUL/score 1.0; one approximated → APPROXIMATED/0.5 weight; one dropped spine → LOW_FIDELITY + not admissible; provenance_only excluded from denominator; empty/non-spec → NOT_APPLICABLE; score-band + admissibility boundaries; determinism.
- **vitest** reader: NOT_APPLICABLE / FAITHFUL / APPROXIMATED / LOW_FIDELITY / admissible-vs-not; legacy-null (no column) → NOT_APPLICABLE.
- **integration** (pglite): INSERT producer-shape row → real reader → correct verdict + admissibility; wrong-key does NOT silently read as admissible.
- **no-gate assertion:** confirm the fidelity reader is NOT wired into any lifecycle promotion path (it must never block a transition) — it's annotation-only.
- `tsc` clean; 3 CI hard gates GREEN; `system-map:sync`.

## Double-check (adversarial, after build)

- `trading-forge-architect` — producer→persistence→reader key convergence (like slippage gate); CORE_DDL synced; migration registered; confirm it is NOT a promotion gate (annotation only); provenance link.
- `accuracy-validator` — does the score honestly reflect fidelity? Can a low-fidelity strategy be mislabeled admissible (false-green)? Is `provenance_only` correctly excluded (else denominator inflates fidelity)? Is spine-drop → LOW_FIDELITY + inadmissible actually enforced? Verify against real binding plans from the 117 corpus.
- `code-reviewer` — score math, band boundaries, admissibility rule, NOT_APPLICABLE handling.

## Out of scope (v1)

- Wiring the admissibility flag into `corpus-fdr-report.py` / Mode-A/B filtering (documented follow-up; v1 persists + exposes it).
- Deep per-trade sequence-order reconstruction beyond `sequence_honored_pct` (uses the existing trace; a full step-order state-machine is a future enhancement).
- Any deployment/promotion gating on fidelity (deliberately NOT a gate).
