# Media Vault Compiler View and Fight Night Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an evidence-honest cinematic Compiler View to the Media Evidence Vault and make Paper Fight Night fit fully inside standard desktop viewports.

**Architecture:** A pure server adapter converts persisted `strategies.config.compiled_spec` into a narrow read-only receipt. A dependency-free browser module renders that receipt through a WebGL2 storm layer and accessible DOM/CSS-3D rule chambers, while the Vault page owns mode switching. Fight Night receives scoped viewport-budget CSS without changing its data path.

**Tech Stack:** TypeScript, Drizzle SQL, Vitest, static HTML/CSS/ES modules, WebGL2, Playwright CLI.

## Global Constraints

- Visualization only: do not change extraction, compiler, lifecycle, gate, paper, execution, or n8n authority.
- Missing compiler data must emit zero compiled rule values.
- Every Compiler View activation replays the complete cinematic.
- Source identity may tint atmosphere; lime/amber/red/steel retain fixed truth meanings.
- No generated background, CDN, remote module, or new runtime dependency.
- WebGL failure and reduced motion must preserve the complete read-only truth view.
- Desktop quiet Fight Night must fit without page scroll at 1920x1080, 1600x900, 1440x900, and 1366x768.
- Preserve all unrelated edits and commit only explicit paths.

---

### Task 1: Compiler receipt adapter and Vault payload

**Files:**
- Create: `src/server/lib/slumhouse/compiler-view-data.ts`
- Create: `src/server/__tests__/slumhouse/compiler-view-data.test.ts`
- Modify: `src/server/lib/slumhouse/evidence-vault-data.ts`
- Modify: `src/server/__tests__/slumhouse/evidence-vault-data.test.ts`

**Interfaces:**
- Consumes: persisted strategy `config` JSON and `{id,name,symbol,timeframe,lifecycleState}` presentation fields.
- Produces: `buildCompilerViewReceipt(input): CompilerViewReceipt`, where receipt state is `uncompiled | compiled | refused | stale | unavailable` and `chambers` contains only persisted rule facts.

- [ ] **Step 1: Write failing pure-adapter tests**

Cover a null config, a persisted compiled spec with source spans, and a binding refusal. The null case must assert `state === "uncompiled"`, `receiptHash === null`, and every chamber has an empty `rules` array. The compiled case must assert that `spec_hash`, direction, source evidence, and binding summary survive without exposing arbitrary config keys.

```ts
expect(buildCompilerViewReceipt(base, null)).toMatchObject({
  state: "uncompiled",
  receiptHash: null,
});
expect(buildCompilerViewReceipt(base, null).chambers.every((c) => c.rules.length === 0)).toBe(true);
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/compiler-view-data.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the narrow adapter**

Define fixed chamber keys (`context`, `setup`, `entry`, `stop`, `exit`, `sizing`, `filters`). Validate objects and arrays defensively. Classify `WAIT_SESSION` into context, `WAIT_STRUCTURE` into setup, `ENABLE_ENTRY`/`WAIT_CONFIRMATION` into entry, and `FILTER` into filters. Add stop/exit/sizing only from their explicit persisted config keys. Preserve evidence, span, role, origin, canonical expression, receipt hash, and binding reasons. Do not traverse or stringify unknown keys.

- [ ] **Step 4: Run the adapter test and verify GREEN**

Run the command from Step 2. Expected: all adapter cases pass.

- [ ] **Step 5: Write failing payload tests**

Extend the existing DB fixture assertions so every strategy row has `compilerView`, compiled fixtures carry a receipt, and null `compiled_spec` produces the exact source-only model.

- [ ] **Step 6: Run the Vault data suite and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/evidence-vault-data.test.ts`

Expected: FAIL because the payload does not expose `compilerView`.

- [ ] **Step 7: Wire the adapter into `assembleEvidenceVault`**

Reuse the already-selected `s.config`; do not add a table or query. Add `compilerView` to the strategy payload interface and map each operator-visible strategy through the pure adapter.

- [ ] **Step 8: Run both Task 1 suites and verify GREEN**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/compiler-view-data.test.ts src/server/__tests__/slumhouse/evidence-vault-data.test.ts`

- [ ] **Step 9: Commit Task 1**

Commit explicit Task 1 paths with message `feat(slumhouse): expose compiler view receipts`.

---

### Task 2: Deterministic compiler-scene renderer

**Files:**
- Create: `public/slumhouse/evidence-vault-compiler.js`
- Create: `public/slumhouse/evidence-vault-compiler.css`
- Create: `src/server/__tests__/slumhouse/evidence-vault-compiler-view.test.ts`

**Interfaces:**
- Consumes: `{strategy, source, compilerView}` from the Vault page.
- Produces: `deriveCompilerIdentity(seed)`, `buildCompilerSceneModel(input)`, and `mountCompilerView(host, input, options)` returning `{replay(), destroy()}`.

- [ ] **Step 1: Write failing deterministic-model tests**

Assert the same video ID produces byte-identical palette/particle seeds, different IDs differ, source-only input contains `UNBOUND` chambers and no rule values, and compiled input preserves semantic states.

```ts
expect(deriveCompilerIdentity("abc12345678")).toEqual(deriveCompilerIdentity("abc12345678"));
expect(buildCompilerSceneModel(sourceOnly).chambers.every((c) => c.state === "unbound")).toBe(true);
expect(JSON.stringify(buildCompilerSceneModel(sourceOnly))).not.toMatch(/entry_long|stop_loss|target/);
```

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/evidence-vault-compiler-view.test.ts`

Expected: FAIL because the renderer module is absent.

- [ ] **Step 3: Implement pure scene-model functions**

Use a stable string hash and constrained HSL conversion for per-video identity. Convert server chambers into display chambers without adding facts. Export the functions for Vitest and browser use.

- [ ] **Step 4: Run the pure tests and verify GREEN**

Run the command from Step 2.

- [ ] **Step 5: Write failing renderer-contract tests**

Pin local-only WebGL2 creation, device-pixel-ratio cap, context-loss fallback, reduced-motion handling, seven-second phase constants, `SOURCE CAPTURED · BLUEPRINT NOT YET COMPILED`, receipt seal rendering, cancel-before-replay, and a callable `destroy()` path.

- [ ] **Step 6: Run and verify RED for the missing renderer behavior**

Run the command from Step 2. Expected: FAIL on the new contract assertions.

- [ ] **Step 7: Implement the renderer and styles**

Create a WebGL2 point field with perspective projection, seeded spiral motion, source-colored fog, restrained additive glow, and a seven-second phase timeline. Render the source plane, status seal, chamber ring, chamber detail drawer, `Media View`, and replay progress as accessible DOM. Cap DPR at 1.75; quality-tier particle count by viewport/hardware concurrency. On context loss or reduced motion, preserve all chambers in the DOM and skip expensive motion.

- [ ] **Step 8: Run Task 2 tests and verify GREEN**

Run the command from Step 2.

- [ ] **Step 9: Commit Task 2**

Commit the renderer, stylesheet, and test with message `feat(slumhouse): render evidence-honest compiler storm`.

---

### Task 3: Vault right-rail and main-stage integration

**Files:**
- Modify: `public/slumhouse/evidence-vault.html`
- Modify: `src/server/__tests__/slumhouse/evidence-vault-ui-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 `strategy.compilerView` and Task 2 `mountCompilerView()`.
- Produces: a separate `Compiler View` button for every strategy card and a reversible main-stage mode.

- [ ] **Step 1: Write failing integration contract tests**

Assert the page loads the local compiler stylesheet, dynamically imports `/slumhouse/evidence-vault-compiler.js`, renders a non-nested `.compiler-view-trigger`, preserves `Media View`, restarts on each click, and destroys the renderer on strategy/mode changes.

- [ ] **Step 2: Run the UI contract and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/evidence-vault-ui-contract.test.ts`

- [ ] **Step 3: Implement accessible right-rail markup**

Replace the strategy card's single-button wrapper with a neutral card container containing one selection button and one `Compiler View` button. Do not nest interactive controls. Preserve existing filters, selected styling, and library behavior.

- [ ] **Step 4: Implement mode orchestration**

Add `openCompilerView(strategy)`, `closeCompilerView()`, and cancellation state. If source evidence must load first, wait for that real payload before mounting. Clicking Compiler View always calls a fresh replay. Clicking Media View restores the existing selected source stage and transcript.

- [ ] **Step 5: Run the UI contract and verify GREEN**

Run the command from Step 2.

- [ ] **Step 6: Run all Vault suites**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/evidence-vault-*.test.ts`

- [ ] **Step 7: Commit Task 3**

Commit the page and test with message `feat(slumhouse): add compiler view to media vault`.

---

### Task 4: Paper Fight Night desktop viewport fit

**Files:**
- Modify: `public/slumhouse/office.html`
- Modify: `src/server/__tests__/slumhouse/reporting-room-scopes-honesty.test.ts`

**Interfaces:**
- Consumes: existing Paper Floor quiet/live markup.
- Produces: desktop-only viewport-budget CSS; no data or rendering-function changes.

- [ ] **Step 1: Write failing viewport-budget tests**

Pin `100dvh`, a desktop compact-height media query, a calculated Fight Night arena height, removal/override of the quiet desktop `560px`/`520px` minimum stack, and retention of mobile scrolling.

- [ ] **Step 2: Run the Reporting Room test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/reporting-room-scopes-honesty.test.ts`

- [ ] **Step 3: Implement scoped CSS**

For desktop Paper Floor, bound `.imm-screen` to the available viewport, compact `.imm-head` and aggregate spacing at short heights, assign `.fight-night-empty` a calculated remaining height, and make `.premium-scene`/`.arena-photo-stage` inherit that budget. Keep `object-fit:cover` and ring focal point. Restore normal scrolling and stacked minimums below the mobile breakpoint.

- [ ] **Step 4: Run the Reporting Room test and verify GREEN**

Run the command from Step 2.

- [ ] **Step 5: Commit Task 4**

Commit Office and the test with message `fix(slumhouse): fit fight night to desktop viewport`.

---

### Task 5: Browser, accessibility, and regression verification

**Files:**
- Modify if required by observed defects: Task 2–4 files only.
- Modify: `AGENT-LOGS.md`

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: screenshot receipts and fresh verification evidence.

- [ ] **Step 1: Start the isolated local server with real project dependencies**

Create the worktree `node_modules` junction per the worktree contract, use the real TypeScript binary, and start the server without changing Trading Forge/n8n authority.

- [ ] **Step 2: Verify Vault behavior in a real browser**

At desktop size, confirm the right-rail button, seven-second replay on two consecutive clicks, per-strategy identity change, source-only honesty, chamber keyboard focus, Media View restoration, reduced-motion behavior, and WebGL fallback. Capture settled source-only and compiled screenshots when fixtures exist.

- [ ] **Step 3: Verify Fight Night target viewports**

Capture 1920x1080, 1600x900, 1440x900, and 1366x768. Assert document `scrollHeight <= clientHeight + 1` in quiet mode and visually confirm the ring and honest status copy remain visible.

- [ ] **Step 4: Run focused tests**

Run all Slumhouse Vault and Reporting Room suites. Record exact pass/fail counts.

- [ ] **Step 5: Run repository gates**

Run the real TypeScript compiler, relevant pytest Slumhouse-independent smoke selection, `check:production-isolation`, `check:2026-compliance`, and `system-map:check`. Record exact results.

- [ ] **Step 6: Review diff and append session log**

Compare the final diff stat with the planned files, scan for fabricated values, remote modules, debug output, and unexpected deletions. Append Mission / Work completed / Verification / Known-facts updates / Carry-forward above the Known-Facts Pin.

- [ ] **Step 7: Commit verification fixes and session log**

Commit explicit paths with message `test(slumhouse): verify compiler view and fight fit`.

- [ ] **Step 8: Prepare landing evidence**

Report base SHA, head SHA, commit list, diff stat, test counts, viewport receipts, and any remaining blocker. Do not merge or push without completing the worktree landing tripwire.
