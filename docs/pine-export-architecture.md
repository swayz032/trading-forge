# Pine Export Architecture

> Trading Forge Pine Script export pipeline — contracts, bands, and semantic-equivalence rules.
> Pass 2 Track D (2026-06-22). Source of truth for alert-only vs strategy-mode export decisions.

---

## Alert-only Pine band contract (Pass 2, 2026-06-22)

**WHAT.** Pine scripts emitted for `archetype:*` and `uncatalogued:*` entry indicators are
indicator-pane scaffolds — they contain `alertcondition()` hooks and `plotshape()` markers, NOT
a `strategy()` script with `strategy.entry()` / `strategy.exit()` calls. The operator sees
visual markers on the TradingView chart and can fire webhook alerts, but TradingView's built-in
Strategy Tester is not involved. Entry and exit decisions belong entirely to the Python engine at
`src/engine/strategies/<class>.py`, which the backtest runner invokes via `--strategy-class`.

**WHY.** Structural ICT/SMC archetypes (Fair Value Gaps, Order Blocks, Market Structure Shifts,
killzone timing windows, displacement sequences) cannot be expressed in Pine Script without
material complexity loss. Pine evaluates one bar at a time with no persistent object model for
multi-bar structural patterns; the Python engine has full access to the bar history, the
ARCHETYPE_REGISTRY dispatch table, and the framework-overlay risk parameters. Alert-only
delegation to the Python engine preserves full semantic equivalence while keeping operator
visibility (chart markers + Discord pings) intact.

**WHERE.** The pipeline is wired across four files:
- `src/engine/pine_compiler.py::ARCHETYPE_PINE_RECIPE` — the 28-key dict of archetype
  display-name → alert-only Pine template; `_build_archetype_alert_pine()` renders the template.
- `src/engine/exportability.py` — recognises the `archetype:` and `uncatalogued:` prefix and
  emits `band='alert_only'` with exportability score 60 (within recommended band).
- `src/server/services/direct-bucket-graduator.ts` — stamps the `archetype:<key>` sentinel on
  `entry_indicator` and emits the `graduation.archetype_pine_recipe_assigned` audit row (for
  catalog archetypes) or `graduation.uncatalogued_pine_recipe_assigned` (for uncatalogued
  speaker terms). Both rows carry `pine_band: 'alert_only'` and `recipe_source` for pipeline
  traceability.
