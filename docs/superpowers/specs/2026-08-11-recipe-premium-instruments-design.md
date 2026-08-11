# Slumhouse Recipe — Canonical Identity, Countertop Banner, and Premium Test Instruments

**Date:** 2026-08-11  
**Status:** Operator-approved design; implementation authorized  
**Surface:** Slumhouse Recipe page, its read-only API assembler, and Recipe-specific static assets

## Goal

Make the Recipe page show the same strategy name as the Kitchen, replace its old background with a correctly sized Slumdawg Traders kitchen-counter banner, and turn the clicked-test detail card into a premium, test-specific 3D instrument without inventing results.

This is production hardening: it closes a cross-page identity disconnect, repairs Recipe reads that currently point at stale or nonexistent fields, and makes existing validation evidence understandable. It does not create a new trading subsystem.

## Locked operator requirements

- Kitchen and Recipe must show the same strategy display name for the same UUID.
- The Recipe banner must be exactly **1983 × 793**, matching the existing asset footprint and displayed width/height.
- The generated banner must contain **no Slumdawg bot or character**.
- The banner scene is the Slumdawg Traders kitchen and a countertop of seasoning jars labeled **BACKTESTING**, **MONTE CARLO**, **WALK-FORWARD**, **RISK CONTROL**, and **SLIPPAGE**.
- Each clicked test gets a unique 3D instrument, not one reused gauge template.
- Visuals may only encode persisted evidence. Missing evidence renders an explicit neutral “Not run yet” instrument.

## Non-goals

- No gate threshold, lifecycle transition, promotion decision, backtest math, Monte Carlo math, paper-trading behavior, or execution behavior changes.
- No database migration or data rewrite.
- No fabricated distributions, interpolated paths, implied passes, decorative values, or default-green states.
- No framework migration and no third-party charting dependency.
- No change to the separate Kitchen banner.

## 1. Canonical strategy identity

The Kitchen already derives `displayName` through `resolvePremiumName()` using the strategy’s raw name, symbols, timeframe, and config. The Recipe currently returns only the raw database name and applies a second browser-side regex catalog, which produces a different label.

The Recipe assembler will select `symbols`, `timeframe`, and `config`, call the same `resolvePremiumName()` function, and return both identities:

```ts
identity: {
  id: string;
  name: string;        // raw canonical database name, retained for lineage/source lookup
  displayName: string; // sole user-facing name, shared with Kitchen
  symbol: string;
  stationStreet: string;
  lifecycleState: string;
}
```

`recipe.html` will render `identity.displayName` verbatim. The duplicate `premiumTitle()`/`cleanName()` title path will no longer decide the hero label. UUID-only navigation remains unchanged.

## 2. Recipe banner

Create `public/slumhouse/images/slumdawg-recipe-counter.png` at exactly **1983 × 793** and point only `.r-hero` at it.

### Composition

- Ultra-wide 5:2 cinematic Slumdawg Traders kitchen.
- Empty atmospheric cabinetry, tile, blackened steel, and restrained warm practical lights at the edges.
- A dark gunmetal countertop across the middle of the frame.
- Five large front-facing seasoning jars centered within the crop-safe middle band.
- Central labels: `BACKTESTING`, `MONTE CARLO`, `WALK-FORWARD`.
- Secondary labels: `RISK CONTROL`, `SLIPPAGE`.
- Lime `#a3ff12` labels, black/gunmetal materials, restrained warm `#ffb84d` highlights.
- No mascot, people, robots, baked-in headline, performance number, chart result, or watermark.
- The live Recipe title, stage caveat, and source buttons remain HTML over the image.

The existing `min-height: 210px`, `background-size: cover`, and responsive grid are preserved unless screenshot verification finds a crop-only adjustment is necessary. The source image size and the rendered hero footprint remain unchanged.

## 3. Truth-first Recipe evidence contract

The visual redesign must not amplify stale/default values. The assembler will read the latest **completed** evidence from its canonical persisted columns/tables:

- Backtest: dedicated `backtests` columns plus `equity_curve`, `daily_pnls`, `walk_forward_results`, `prop_compliance`, `mrp_sharpe`, `mrp_regime_breakdown`, and `b15_battery`.
- Monte Carlo: latest completed `monte_carlo_runs` row; real sampled paths/distribution only when persisted.
- Real Edge: latest completed `frankenstein_test_runs` row.
- Crash-Proof: latest completed `synthetic_black_swan_runs` row; the advisory nature remains explicit.
- Paper Trial: real `paper_trades.pnl` grouped by `exit_time` for the most recent 30-day window across the strategy’s paper sessions.
- Live Match: `lifecycle_shadow_signals.divergence_vs_backtest`, replacing the nonexistent `divergence_pct` read.

Missing evidence is represented as `null`, never coerced to a passing boolean, `1.0`, zero result, or invented geometry. Existing gate thresholds are imported from the same gate helpers or persisted evidence that lifecycle decisions use.

The API will keep the current summary fields for compatibility and add a typed `instrument` payload to each gate metric. Each instrument is a discriminated object whose numeric geometry is a pure function of real values:

```ts
type RecipeInstrument =
  | { kind: "walk_forward"; wfe: number | null; floor: number }
  | { kind: "jitter"; sdr: number | null; psi: number | null; rws: number | null; thresholds: { sdr: number; psi: number; rws: number } }
  | { kind: "crash"; regimesTested: number | null; regimesSurvived: number | null; survivalRate: number | null; worstRegime: string | null; worstDrawdown: number | null; advisory: true }
  | { kind: "regimes"; sharpeByRegime: Record<string, number>; minimumSharpe: number | null }
  | { kind: "shuffle"; p95Sharpe: number | null; medianProfitFactor: number | null; sharpeDistribution: number[]; profitFactorDistribution: number[] }
  | { kind: "paper"; totalPnl: number | null; dailyPnl: Array<{ date: string; pnl: number }>; tradeCount: number }
  | { kind: "drift"; divergence: number | null; threshold: number; observations: number }
  | { kind: "compliance"; firms: Array<{ name: string; passed: boolean | null; reasons: string[] }>; passRate: number | null };
```

Arrays are bounded before serialization and hostile/free-text labels are escaped at render time.

## 4. Unique premium instruments

The left Recipe card remains the single switchable detail surface. Backtest is the default. Clicking a gate replaces that card with its unique instrument while Monte Carlo stays mounted on the right.

| Surface | Instrument | Honest empty state |
|---|---|---|
| Backtest | Raised equity “griddle,” dimensional KPI plates, PF and drawdown rails | Empty shelf and “No completed backtest” |
| Holds Up | 3D walk-forward fold towers with WFE marker and floor rail | Unlit fold towers |
| Handles Rough | Three mechanical dial gauges for SDR, PSI, and RWS | Parked neutral dials |
| Crash-Proof | Armored shield/pressure chamber showing regimes survived and worst-regime drawdown | Closed gray shield |
| Every Market | Five-segment regime wheel using persisted per-regime Sharpe | Gray segments for missing regimes |
| Real Edge | Observed-versus-shuffled laboratory using real stored shuffle distributions | Empty specimen trays; no synthetic curve |
| Paper Trial | 30-day cash-register tape using grouped real paper P&L | Blank tape and zero observations, not a flat fake line |
| Live Match | Twin signal tracks and a divergence dial using real shadow observations | Disconnected tracks |
| Rule-Safe | Machined rulebook seal with one plate per persisted firm result | Unstamped neutral seal |

All instruments share a restrained Slumdawg material system—black glass, gunmetal bevels, lime pass light, amber pending light, red failure light—but their silhouettes and data encodings are distinct.

CSS perspective, SVG gradients, and short transform/opacity transitions provide depth. Motion is disabled under `prefers-reduced-motion`. Decorative motion never changes metric geometry.

## 5. Interaction and accessibility

- Gate rows become semantic buttons with visible focus, `aria-pressed`, and an active state.
- Enter and Space select a gate.
- The selected instrument receives a short reveal transition and its heading receives programmatic focus without trapping keyboard navigation.
- “Backtest” remains the explicit return control.
- Selection does not alter the URL or persist across reloads.
- Mobile keeps a single-column layout; instruments reduce perspective/depth but retain their data and labels.

## 6. File boundaries

- `src/server/lib/slumhouse/recipe-data.ts`: canonical identity and evidence assembly only.
- `public/slumhouse/recipe-instruments.js`: pure DOM/SVG renderers and gate-to-instrument dispatch.
- `public/slumhouse/recipe-instruments.css`: instrument materials, layouts, transitions, focus, responsive, and reduced-motion rules.
- `public/slumhouse/recipe.html`: page composition, active selection controller, and use of canonical `displayName`.
- `public/slumhouse/images/slumdawg-recipe-counter.png`: generated 1983 × 793 banner.
- `src/server/__tests__/slumhouse/`: identity parity, canonical evidence, no-fabrication, DOM interaction, and route-contract tests.

No engine, schema, migration, n8n, paper execution, or lifecycle file is edited.

## 7. Error and empty-state rules

- A failed Recipe request keeps the current actionable retry state.
- A missing completed source yields a neutral instrument and “Not run yet.”
- A malformed optional JSON field is ignored and surfaced as unavailable; it cannot make a gate pass.
- A real zero remains zero and is visually distinguishable from missing `null`.
- Monte Carlo retains its existing `real` / `bounds` / `empty` no-fabrication policy.
- Advisory Crash-Proof evidence is labeled advisory and cannot be presented as an authoritative promotion result.

## 8. Verification

### Automated

- Cross-page contract: the same strategy fixture produces the same Kitchen `displayName` and Recipe `identity.displayName`.
- Assembler tests prove canonical dedicated fields win over stale `result_extras` and absent evidence remains null/pending.
- Regression test proves the Recipe shadow query uses `divergence_vs_backtest`.
- Completed-status tests prove pending/failed backtests, Monte Carlo, Frankenstein, and black-swan rows do not drive visuals.
- Renderer tests execute every instrument with real, zero, and null fixtures and prove no random/synthetic metric geometry is introduced.
- Interaction tests cover click, keyboard selection, active state, focus, and Backtest restore.
- Existing Recipe/Slumhouse no-fabrication suites remain green.
- Real TypeScript compiler, Slumhouse Vitest suites, focused Python smoke tests, and the three repository hard gates run from a correctly junctioned worktree.

### Visual

- Desktop screenshots at 1920 × 1080 for Backtest and all eight selected instruments.
- Responsive screenshots at 900px, 640px, and 390px widths.
- Verify banner remains the same displayed width/height and its five labels survive cover-cropping.
- Verify pass/warn/fail/null states remain legible without relying on color alone.

## 9. Instrument-change ratification receipt

1. **What and why now:** Recipe currently reads dedicated metrics from `result_extras`, queries nonexistent `divergence_pct`, defaults missing A14/compliance evidence toward pass, and displays a different name from Kitchen. The user requested richer visuals, which would magnify those defects.
2. **Blast radius:** Read-only Recipe API and Recipe UI only. No certification, frozen reference, promotion decision, gate result, or persisted row changes. Downstream trading consumers are unchanged.
3. **Scope-locked change:** Correct Recipe reads, add display identity, add bounded visualization payloads, generated banner, and Recipe UI renderers. Engine calculations, thresholds, lifecycle, persistence writers, schemas, and other pages are explicitly out of scope.
4. **Verification plan:** Red/green regression tests, canonical-versus-stale source fixtures, null/zero flip enumeration, route/UI/no-fabrication suites, screenshots, and an adversarial `accuracy-validator` review through independent query and rendered-response paths.
5. **Rollback:** Revert the Recipe commits. The old asset remains available, no migration/data rewrite occurs, and no live default or capital path changes.

This is an autonomous pre-live instrument-read correction, not the irreversible/live-capital class. It proceeds only after an independent `accuracy-validator` grade.

## 10. Acceptance criteria

- The strategy label is identical between Kitchen and Recipe for the same UUID.
- The Recipe hero uses the new no-bot 1983 × 793 countertop-seasoning banner and retains its current rendered footprint.
- Backtest and every gate render a visually distinct premium instrument.
- Every visible number or geometry is traceable to canonical persisted evidence or a canonical threshold.
- Missing evidence cannot appear green and cannot create a chart shape.
- Mouse, keyboard, reduced-motion, desktop, and mobile behavior pass automated and visual verification.
- Independent accuracy validation finds no unverified metric claim before production landing.
