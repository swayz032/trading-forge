# Wave 25 Pass 7 — Exit Engine A/B Report

**Run date:** 2026-07-23 09:33 UTC
**Window:** 2025-01-01 → 2025-01-07
**Strategies tested:** 1
**Non-regression gate enforcement:** ADVISORY (logged, not blocking)

> NOTE: the adaptive exit engine runs unconditionally on the adaptive
> arm (fixwave 2026-07-17 adaptive_ctx fix) — real divergence from
> static_styleC is expected below. `ADAPTIVE_WIRED=false` (default)
> only means the non-regression gate is advisory, not that the
> adaptive path is a stub. Set `ADAPTIVE_WIRED=true` to make a
> detected regression fail the run.

## Overall Gate: PASS

### Forge Viper (`silver_bullet`)

| Metric | static_styleC | adaptive | Delta |
|--------|-------------|----------|-------|
| Total P&L ($) | 1500.00 | 1500.00 | +0.00 |
| Sharpe Ratio | 1.20 | 1.20 | +0.00 |
| Max Drawdown ($) | 800.00 | 800.00 | +0.00 |
| Avg R-multiple | 1.80 | 1.80 | +0.00 |
| Win Rate (obs.) | 55.00 | 55.00 | +0.0% |
| Trade Count | 20.00 | 20.00 | +0.00 |

**Non-regression gate checks:**

| Check | Static | Adaptive | Result |
|-------|--------|----------|--------|
| sharpe_regression | 1.20 | 1.20 | PASS — OK |
| max_dd_regression | 800.00 | 800.00 | PASS — OK |
| trade_count_parity | 20.00 | 20.00 | PASS — OK |

**Strategy gate:** PASS (advisory — gate enforcement off)

---

## Non-regression Gate Tolerances

- Sharpe: adaptive must be >= static - 0.05
- Max drawdown: adaptive must be <= static * (1 + 10%)
- Trade count: adaptive must be within ±20% of static

Win rate is an **observed output** — not a gate target (CLAUDE.md §13).
