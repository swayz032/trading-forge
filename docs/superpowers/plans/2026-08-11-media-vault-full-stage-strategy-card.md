# Media Vault Full-Stage Strategy Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing Compiler View into a full-stage Category 5 transformation that settles into a simple strategy card, and move Fight Night telemetry into its upper-right header.

**Architecture:** Extend the existing pure browser view model with five trader-facing groups derived only from persisted chambers. Replace the settled orbit composition with an accessible full-stage DOM layout over a local cinematic plate and adaptive WebGL2 storm. Keep the Vault page as mode owner and move existing Paper Floor aggregate facts into the existing immersive header without changing either data route.

**Tech Stack:** TypeScript, Vitest, static HTML/CSS/ES modules, WebGL2, local WebP asset, Playwright CLI.

## Global Constraints

- Presentation hardening only: do not change extraction, compilation, gates, lifecycle, paper execution, or n8n authority.
- The browser can format persisted values but cannot infer, summarize, or fabricate trading rules.
- Every Compiler View activation replays the complete seven-second sequence.
- The settled main stage has no default drawer or internal scrollbar.
- The local environment plate contains no text, charts, prices, people, logos, rules, or performance claims.
- No runtime image generation, CDN, remote module, or new dependency.
- Desktop Fight Night remains fully visible without page scrolling at 1920x1080, 1600x900, 1440x900, and 1366x768.
- Preserve unrelated changes and commit only explicit paths.

---

### Task 1: Full-stage strategy-card model

**Files:**
- Modify: `public/slumhouse/evidence-vault-compiler.js`
- Modify: `public/slumhouse/evidence-vault-compiler.d.ts`
- Test: `src/server/__tests__/slumhouse/evidence-vault-compiler-view.test.ts`

**Interfaces:**
- Consumes: existing `CompilerSceneModel.chambers` and persisted `direction`.
- Produces: `buildStrategyCardGroups(model)` with fixed keys `trade_when`, `enter`, `protect`, `manage`, and `avoid`; each group contains no more than two display rules and an `additionalCount`.

- [ ] **Step 1: Write failing model tests**

Assert exact chamber-to-group mapping, two-rule display cap, additional count, direction preservation, and zero values for an uncompiled receipt.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/evidence-vault-compiler-view.test.ts`

Expected: FAIL because `buildStrategyCardGroups` and the five group keys do not exist.

- [ ] **Step 3: Implement the minimal pure grouping and formatting layer**

Map Context+Setup to `Trade When`, Entry to `Enter`, Stop+Sizing to `Protect`, Exit to `Manage`, and Filters to `Avoid`. Preserve rule IDs, labels, origins, expressions, and evidence. Format only known persisted scalar/config structures; fall back to the persisted label without inventing a value.

- [ ] **Step 4: Run the focused test and verify GREEN**

- [ ] **Step 5: Commit Task 1**

Commit the three explicit paths with message `refactor(slumhouse): shape compiler rules for stage card`.

### Task 2: Category 5 renderer and generated environment

**Files:**
- Create: `public/slumhouse/images/compiler-strategy-environment-v1.webp`
- Modify: `public/slumhouse/evidence-vault-compiler.js`
- Modify: `public/slumhouse/evidence-vault-compiler.css`
- Test: `src/server/__tests__/slumhouse/evidence-vault-compiler-view.test.ts`

**Interfaces:**
- Consumes: existing deterministic identity and `buildStrategyCardGroups(model)`.
- Produces: full-stage phase sequence `source -> rupture -> vortex -> compression -> shockwave -> settled`, adaptive render profiles, full-stage strategy-card markup, and closed-by-default technical receipt overlay.

- [ ] **Step 1: Write failing renderer contract tests**

Pin the six phase names, seven-second duration, high/mid/low density ordering, local environment URL, five settled groups, no default-open receipt, uncompiled dormant copy, and full-stage accessibility controls.

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL on missing phase names and settled markup.

- [ ] **Step 3: Generate and validate the neutral environment plate**

Generate one wide, text-free cinematic 3D storm-forge chamber. Reject any output containing charts, numbers, text, people, logos, or recognizable trading claims. Save the selected optimized asset at the exact path above.

- [ ] **Step 4: Implement the Category 5 WebGL sequence**

Increase adaptive particle density, add turbulent radial velocity, stage-filling fog, seeded lightning, compression, and a shockwave. Keep capped DPR, cleanup, context-loss fallback, and reduced-motion behavior.

- [ ] **Step 5: Replace the settled orbit with the full-stage strategy card**

Render the five groups directly across the available stage, keep the top rail narrow, hide storm-only layers after settlement, and move complete provenance into the `Technical Receipt` overlay.

- [ ] **Step 6: Run the focused test and verify GREEN**

- [ ] **Step 7: Commit Task 2**

Commit explicit renderer, stylesheet, asset, and test paths with message `feat(slumhouse): reveal full-stage strategy card`.

### Task 3: Fight Night header telemetry HUD

**Files:**
- Modify: `public/slumhouse/office.html`
- Test: `src/server/__tests__/slumhouse/reporting-room-scopes-honesty.test.ts`

**Interfaces:**
- Consumes: existing Paper Floor summary, event count, feed state, and connection state.
- Produces: one `.fight-head-hud` inside the right side of `.imm-head`; no standalone aggregate panel in quiet or live Paper Floor.

- [ ] **Step 1: Write failing Reporting Room contracts**

Assert `.fight-head-hud` contains the four existing facts, aggregate-strip markup is absent from Paper Floor output, and desktop CSS gives the arena the recovered height.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run src/server/__tests__/slumhouse/reporting-room-scopes-honesty.test.ts`

- [ ] **Step 3: Move the existing facts into the header HUD**

Reuse existing real values and honesty states. Keep title/copy left, HUD right, and mobile stacking below 780px. Do not modify routes or fabricate metrics.

- [ ] **Step 4: Remove the standalone strip and expand the arena budget**

Delete its Paper Floor render call and its scoped spacing reservation. Retain live result cards and desktop overflow containment.

- [ ] **Step 5: Run the focused test and verify GREEN**

- [ ] **Step 6: Commit Task 3**

Commit Office and its test with message `fix(slumhouse): move fight telemetry into header`.

### Task 4: Browser and completion verification

**Files:**
- Modify only for observed defects: Task 1-3 files.
- Modify: `AGENT-LOGS.md`

**Interfaces:**
- Consumes: completed hardened UI.
- Produces: real-browser viewport evidence and repository gate results.

- [ ] **Step 1: Run the complete Slumhouse test selection and real TypeScript compiler**

Run the relevant Vitest files and `node node_modules/typescript/bin/tsc --noEmit`.

- [ ] **Step 2: Verify Compiler View in Chromium**

Capture the vortex, compiled settled card, uncompiled dormant card, replay, Technical Receipt, Media View restoration, and 1920x1080/1366x768 no-scroll behavior.

- [ ] **Step 3: Verify Fight Night in Chromium**

Capture 1920x1080, 1600x900, 1440x900, and 1366x768. Verify the HUD is upper-right, the strip is absent, the ring remains visible, and the host has no page overflow.

- [ ] **Step 4: Run hard gates**

Run `npm run check:production-isolation`, `npm run check:2026-compliance`, `npm run system-map:check`, and `git diff --check`.

- [ ] **Step 5: Append production evidence and commit**

Append Mission, Work completed, Verification, Known-facts updates, and Carry-forward to `AGENT-LOGS.md`. Commit only the log and any verified fixes.

- [ ] **Step 6: Land and deploy**

Review diff stat against planned paths, push the isolated branch, fast-forward `main`, monitor GitHub checks, deploy through the connected Railway production project, and verify public authenticated assets through two independent paths.
