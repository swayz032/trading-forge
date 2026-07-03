# Slippage-Survival Gate — Design Spec (Wave A)

**Date:** 2026-07-03
**Status:** Approved (operator "execute" 2026-07-03)
**Phase note:** New promotion gate. Fits Production Hardening (§2) as a *validation gate*, not a new subsystem. Ships **default-OFF** with legacy-null grandfather — inert until the operator enables it, exactly like B15/BIF.

## Purpose

Prove a strategy's edge survives elevated slippage before it reaches live capital. Blocks slippage-fragile strategies at PAPER → DEPLOY_READY. Answers: "is this edge real, or is it living on optimistic fills?"

## Approach (decided)

**Fixed-signal re-price.** Hold the backtest's realized trades fixed; re-apply slippage at 1×/2×/3×; recompute PF + expectancy on each stressed net-P&L series. Isolates the slippage variable precisely (cost-sensitivity analysis holding signals fixed — standard institutional technique). Reuses the per-trade slippage the engine already deducts — nearly free.

**Formula (review-pass fix, 2026-07-03):**
```
net_pnl_M[trade] = gross_pnl[trade] - commission[trade] - roll[trade] - M × slippage_dollars[trade]
```
Commission and roll-spread cost are held **FIXED** at their real realized values at every stress multiple — **only slippage is scaled by M**. This makes the M=1.0 sweep byte-identical to the trade's actual realized net P&L (`gross - slip - comm - roll`, the same formula the backtester already uses per trade). The original v1 formula (`gross_pnl - M*slippage`, omitting commission/roll entirely) inflated the 1x PF/expectancy baseline relative to the strategy's TRUE realized net — a fee-heavy net-loser could show "alive at 1x" and grandfather past the gate. Holding non-slippage frictions fixed and stressing only the named variable (slippage) is what makes this a *slippage*-survival gate rather than a generic cost-survival gate.

- **Rejected — full re-run** (`slippage_ticks × N`): faithful to fill/stop decision changes but 2× compute and *conflates* slippage-fragility with signal-change. Documented as the v2 upgrade.
- **Known limitation (v1):** fixed trades ignore the 2nd-order effect where higher slippage could trip a stop. Acceptable for a cost-fragility gate; recorded honestly.
- **Boundary precision:** the `breaks_at` alive-check (`pf[Mx] >= min_pf AND expectancy_r[Mx] > 0`) is evaluated on the RAW unrounded PF/expectancy values, not the 4dp-rounded values stored in the JSONB `pf`/`expectancy_r` fields — a raw PF of 0.99996 must not round to 1.0 and incorrectly pass a `min_pf=1.0` floor.

## The contract (producer ⇄ consumer — must not drift)

Engine writes `backtests.slippage_survival` JSONB. Exact shape both sides agree on:

```json
{
  "schema_version": 1,
  "multiples": [1.0, 2.0, 3.0],
  "pf": { "1x": 1.82, "2x": 1.31, "3x": 0.94 },
  "expectancy_r": { "1x": 0.41, "2x": 0.19, "3x": -0.03 },
  "breaks_at": 3.0,            // smallest multiple where edge dies; null = survives all
  "retention_2x": 0.46,        // expectancy_r.2x / expectancy_r.1x (fragility telemetry)
  "n_trades": 214,
  "computed_at": "2026-07-03T..."
}
```

- Edge "alive" at multiple M ⟺ `pf[Mx] >= SLIPPAGE_SURVIVAL_MIN_PF (1.0)` AND `expectancy_r[Mx] > 0`.
- `breaks_at` = smallest M in `multiples` where edge is not alive; `null` if it survives all.
- Emitted only when `n_trades >= SLIPPAGE_SURVIVAL_MIN_TRADES (20)`; below that, emit the block with `breaks_at: null` and `"insufficient_sample": true` so the gate can PASS-with-warn rather than gate on noise.

## Components (4 well-bounded units)

1. **Engine producer** — `src/engine/backtester.py`: after trades computed, compute the sweep from per-trade gross-P&L and per-trade slippage-dollars; emit `slippage_survival` into the result dict. Pure-functional helper in a new `src/engine/statistics/slippage_survival.py` (testable in isolation, no I/O). Persisted to `backtests.slippage_survival` by the same path that persists other engine metrics.
2. **Schema** — new migration `backtests.slippage_survival JSONB` **+ same-change CORE_DDL sync** in `src/server/__tests__/helpers/pglite-db.ts` (pinned hazard: skip this and every gate-chain suite silently breaks).
3. **Gate** — `src/server/lib/slippage-survival-gate.ts`: pure reader → `{passed, status, reason}`. Wired into `lifecycle-service.ts` PAPER → DEPLOY_READY beside WFE/B14/BIF. Rules:
   - disabled (`SLIPPAGE_SURVIVAL_GATE_ENABLED=false`, default) → PASS + advisory audit.
   - legacy null (no `slippage_survival` on backtest) → PASS + `slippage_survival.unavailable_legacy` warn (grandfather window).
   - `insufficient_sample` → PASS + warn.
   - `breaks_at != null AND breaks_at <= SLIPPAGE_SURVIVAL_BLOCK_MULT (2.0)` → **BLOCK**.
   - `breaks_at != null AND breaks_at > SLIPPAGE_SURVIVAL_BLOCK_MULT` (survives the block multiple but dies at a higher swept multiple) → PASS + WARN (`warn_breaks_at_above_block`). Generalized from a hardcoded `== 3.0` (review-pass fix) so telemetry stays accurate if the sweep points are tuned.
   - `breaks_at == null` (survives every swept multiple) → PASS (`clean`).
4. **Observability** — audit `slippage_survival.gate_evaluated`, SSE `lifecycle:slippage_survival_evaluated`, Prometheus counter `tf_slippage_survival_blocks_total{breaks_at}`.

## Data flow

`backtest → engine slippage sweep → backtests.slippage_survival (JSONB) → lifecycle gate reader → block/warn/pass → audit + SSE + metric`

## Config (env, institutional defaults)

| Env | Default | Meaning |
|---|---|---|
| `SLIPPAGE_SURVIVAL_GATE_ENABLED` | `false` | Master switch (advisory-only when false) |
| `SLIPPAGE_SURVIVAL_BLOCK_MULT` | `2.0` | Block if edge dies at ≤ this multiple |
| `SLIPPAGE_SURVIVAL_MULTIPLES` | `1,2,3` | Sweep points. Engine-side parser sorts ascending + drops non-positive values before use (review-pass fix, 2026-07-03) — `breaks_at` short-circuits on the first not-alive multiple in iteration order, so a misconfigured `"3,2,1"` would otherwise evaluate 3x first and report the wrong `breaks_at`. |
| `SLIPPAGE_SURVIVAL_MIN_PF` | `1.0` | Survival PF floor. Negative overrides fall back to the default (review-pass fix, 2026-07-03). |
| `SLIPPAGE_SURVIVAL_MIN_TRADES` | `20` | Sample-size guard. Negative overrides fall back to the default (review-pass fix, 2026-07-03) — a negative floor would make `insufficient_sample` structurally impossible to trigger. |

## Testing (no-bad-wiring bar)

- **pytest** (`slippage_survival.py`): sweep math, `breaks_at` logic, sample guard, retention calc, null/empty-trades edge cases.
- **vitest** gate unit: disabled / legacy-null / insufficient-sample / block / warn / pass.
- **Gate-chain integration** (pglite, real schema): INSERT producer-shape `backtests` row → run the REAL gate reader via lifecycle → assert PASS on survivor, BLOCK on fragile, and wrong-key-catches (put the value under a wrong key, assert it does NOT silently pass). Add its chain to `gate-chain-integration.test.ts`.
- `tsc --noEmit` clean; 3 CI hard gates GREEN (`production-isolation`, `2026-compliance`, `system-map:check`); `system-map:sync`.

## Double-check (adversarial, after build)

- `trading-forge-architect` — wiring/contract/map-convergence; confirm producer key === consumer key, migration registered, CORE_DDL synced, lifecycle insertion correct.
- `accuracy-validator` — false-green hunt: does the gate actually block a fragile strategy end-to-end, or grandfather-pass? Trace one correlation_id.
- `code-reviewer` — general review.

## Out of scope (v1)

- Full-re-run fidelity (v2).
- Gating stages other than PAPER → DEPLOY_READY.
- Retroactive backfill of `slippage_survival` on historical backtests (they grandfather-pass; recompute on next backtest).
