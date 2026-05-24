# Wave 25 Pass 7 — Exit Engine A/B Report

**Run date:** 2026-05-24 13:29 UTC
**Window:** 2025-01-01 → 2025-01-07
**Strategies tested:** 1
**Adaptive exit wired:** NO (P7.A1–A4 state; adaptive path stubs to static_styleC)

> NOTE: adaptive exit engine wiring (P7.A5) is not yet complete.
> Expect zero delta between adaptive and static_styleC runs.
> Gate is advisory only until `ADAPTIVE_WIRED=true`.

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

**Strategy gate:** PASS (advisory — adaptive not yet wired)

---

## Non-regression Gate Tolerances

- Sharpe: adaptive must be >= static - 0.05
- Max drawdown: adaptive must be <= static * (1 + 10%)
- Trade count: adaptive must be within ±20% of static

Win rate is an **observed output** — not a gate target (CLAUDE.md §13).
