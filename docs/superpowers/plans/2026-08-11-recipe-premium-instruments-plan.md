# Recipe Premium Instruments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Kitchen/Recipe identity, source Recipe metrics from canonical persisted evidence, add distinct premium 3D test instruments, and replace the Recipe hero with a no-bot 1983×793 seasoning-counter banner.

**Architecture:** Keep Recipe data assembly read-only in `recipe-data.ts`. Add isolated static renderer/CSS files consumed by `recipe.html`; every visual state derives from typed API evidence and null renders neutral. Preserve the existing authenticated route and UUID handoff.

**Tech Stack:** TypeScript, Drizzle SQL, Vitest/PGlite, plain browser JavaScript/SVG/CSS, OpenAI image generation.

## Global Constraints

- No gate thresholds, lifecycle logic, engine math, persistence writers, schemas, or migrations change.
- No fabricated chart geometry; null is not zero and missing evidence cannot pass.
- Recipe banner is exactly 1983×793, contains no bot/person/robot, and keeps the current rendered hero footprint.
- Implementation is graded independently by `accuracy-validator` before landing.

---

### Task 1: Canonical Recipe identity and evidence

**Files:**
- Modify: `src/server/lib/slumhouse/recipe-data.ts`
- Modify: `src/server/__tests__/slumhouse/recipe-data.test.ts`
- Modify: `src/server/__tests__/slumhouse/recipe-data-pglite.test.ts`
- Modify: `src/server/__tests__/slumhouse/recipe-route.test.ts`

**Interfaces:**
- Produces `identity.displayName` from `resolvePremiumName()`.
- Produces typed `gateMetrics[*].instrument` payloads from completed canonical rows only.

- [ ] **Step 1: Write failing identity and canonical-source tests**

```ts
expect(recipe.identity.displayName).toBe(resolvePremiumName(strategyFixture).displayName);
expect(recipe.backtest.sharpeRatio).toBe(1.75); // dedicated column wins over stale extras
expect(recipe.gateMetrics["Real-Time Match"].instrument).toMatchObject({ kind: "drift", divergence: 0.018 });
```

- [ ] **Step 2: Run focused tests and confirm expected failures**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/recipe-data.test.ts src/server/__tests__/slumhouse/recipe-data-pglite.test.ts src/server/__tests__/slumhouse/recipe-route.test.ts`

- [ ] **Step 3: Implement minimal read-only assembler changes**

Select the latest completed canonical backtest/MC/Frankenstein/black-swan rows, use `walk_forward_results`, `b15_battery`, `mrp_regime_breakdown`, `prop_compliance`, `paper_trades`, and `lifecycle_shadow_signals.divergence_vs_backtest`, and preserve nulls.

- [ ] **Step 4: Run the focused tests to green and commit explicit files**

Commit: `fix(slumhouse): align Recipe identity and evidence`

### Task 2: Premium instrument renderer and interaction

**Files:**
- Create: `public/slumhouse/recipe-instruments.js`
- Create: `public/slumhouse/recipe-instruments.css`
- Modify: `public/slumhouse/recipe.html`
- Create: `src/server/__tests__/slumhouse/recipe-instruments-ui.test.ts`
- Modify: `src/server/__tests__/slumhouse/recipe-no-fabrication.test.ts`

**Interfaces:**
- `window.RecipeInstruments.renderBacktest(recipe)` returns a DOM panel.
- `window.RecipeInstruments.renderGate(recipe, internalGateName)` returns one of eight distinct DOM/SVG instruments.

- [ ] **Step 1: Write failing UI-contract tests**

```ts
expect(render("Surprise Test")).toContain('data-instrument="walk-forward"');
expect(render("Sloppy Bot Test")).toContain('data-instrument="jitter-dials"');
expect(renderNull("Real or Lucky")).not.toMatch(/<path[^>]+data-series/);
```

- [ ] **Step 2: Run tests and confirm they fail because renderers are absent**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/recipe-instruments-ui.test.ts src/server/__tests__/slumhouse/recipe-no-fabrication.test.ts`

- [ ] **Step 3: Implement the nine renderers and shared material system**

Create distinct Backtest, walk-forward, jitter, crash, regimes, shuffle, paper, drift, and compliance instruments. Geometry must be clamped from real values; missing values render gray inactive parts only.

- [ ] **Step 4: Implement accessible selection**

Convert gate rows to buttons, maintain `aria-pressed`/active state, support Enter/Space, restore Backtest, and respect `prefers-reduced-motion`.

- [ ] **Step 5: Run UI/no-fabrication tests to green and commit explicit files**

Commit: `feat(slumhouse): add premium Recipe test instruments`

### Task 3: Recipe countertop banner

**Files:**
- Create: `public/slumhouse/images/slumdawg-recipe-counter.png`
- Modify: `public/slumhouse/recipe.html`
- Modify: `src/server/__tests__/slumhouse/recipe-instruments-ui.test.ts`

- [ ] **Step 1: Add a failing asset contract**

```ts
expect(recipeHtml).toContain("/slumhouse/images/slumdawg-recipe-counter.png");
expect(readPngSize(asset)).toEqual({ width: 1983, height: 793 });
```

- [ ] **Step 2: Generate one wide no-bot Slumdawg kitchen-counter image**

Required jars: BACKTESTING, MONTE CARLO, WALK-FORWARD, RISK CONTROL, SLIPPAGE. No character, headline, statistics, or watermark.

- [ ] **Step 3: Inspect, size to exactly 1983×793, wire the hero, and run the contract test**

- [ ] **Step 4: Commit explicit asset and page/test paths**

Commit: `feat(slumhouse): replace Recipe countertop banner`

### Task 4: Verification, independent grade, and production landing

**Files:** No planned production edits.

- [ ] **Step 1: Run focused Recipe/Slumhouse Vitest and Python smoke tests**
- [ ] **Step 2: Run the real TypeScript compiler and repository hard gates**
- [ ] **Step 3: Capture desktop and mobile screenshots for all selected instruments**
- [ ] **Step 4: Dispatch `accuracy-validator` to disprove identity/evidence/visual claims through two independent paths**
- [ ] **Step 5: Dispatch architecture and autonomy reviewers**
- [ ] **Step 6: Compare final diff-stat against reviewed scope, push branch, cherry-pick into runtime production, and verify live**

