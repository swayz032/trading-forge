# Slumhouse Kitchen Menu + Premium Naming + Variant Families + Progress Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Slumhouse Kitchen into a full premium strategy library — menu with category pages, operator-curated premium names, variant families with a cook-off + champion, and an animated matte-black 3D progress line showing each strategy passing/failing the gates — plus a banner swap.

**Architecture:** Pure read-time resolvers on the backend (`premium-names.ts`, family grouping, gate-journey) feed new Slumhouse API routes and the recipe/menu pages. The progress line is a shared vanilla-JS component reused by the recipe page and the kitchen cook-off. No DB migration, no engine changes, no build step (Slumhouse is served raw). All presentation + naming only — gate/lifecycle logic is untouched.

**Tech Stack:** Express + TypeScript (`src/server/`), Drizzle (read-only queries), vitest, vanilla JS + `fetchJSON` (`public/slumhouse/`), the v6 black-glass CSS from the approved mockup at `.superpowers/brainstorm/843-1783112689/content/progress-line-v6.html`.

**Repo root:** `C:\Users\tonio\Projects\trading-forge\trading-forge\`. Branch: `hardening/phase-0`. Commit with `--no-verify` per CLAUDE.md §11a.

---

## File structure

| File | Responsibility | New/Mod |
|---|---|---|
| `src/server/lib/slumhouse/premium-names.ts` | Curated familyKey→premium name map + `resolvePremiumName()` + `familyKeyFor()` | Create |
| `src/server/lib/slumhouse/strategy-families.ts` | `groupIntoFamilies()` + champion selection | Create |
| `src/server/lib/slumhouse/gate-journey.ts` | `resolveGateJourney()` → `Gate[]` from lifecycle + recipe gate signals | Create |
| `src/server/lib/slumhouse/menu-data.ts` | Category assemblers (now-serving / deploy-ready / kitchen / graveyard) | Create |
| `src/server/routes/slumhouse/api/menu.ts` | 4 `GET /slumhouse/api/menu/*` routes | Create |
| `src/server/routes/slumhouse/index.ts` | Mount the menu router | Modify |
| `public/slumhouse/progress-line.js` | Shared renderer: `Gate[]` + container → animated card+line | Create |
| `public/slumhouse/progress-line.css` | v6 styles (ported from the mockup) | Create |
| `public/slumhouse/recipe.html` | Render the progress line from gate data | Modify |
| `public/slumhouse/menu.html` | Tabbed menu (Now Serving / Deploy-Ready / In the Kitchen / Graveyard) | Create |
| `public/slumhouse/kitchen.html` | Banner swap (image-only hero) + link to menu | Modify |
| `src/server/__tests__/slumhouse/premium-names.test.ts` etc. | Unit tests per resolver + route | Create |

---

## Phase 1 — Premium naming + variant families (pure libs)

### Task 1: Premium name resolver

**Files:**
- Create: `src/server/lib/slumhouse/premium-names.ts`
- Test: `src/server/__tests__/slumhouse/premium-names.test.ts`

**Context:** Strategies carry raw names (`orb_15m`, `ict_silver_bullet_ny_am`). A strategy row (from `strategies` table) has `name: string`, `symbols: string[]`, `timeframe: string`, and `config` JSONB where `config.entry_indicator` may be `"archetype:opening_range_breakout"`. We derive a family key from the archetype/concept and map it to a premium name. Every strategy must resolve to *some* name (fallback to Title-Cased raw).

- [ ] **Step 1: Write the failing test**

```ts
// src/server/__tests__/slumhouse/premium-names.test.ts
import { describe, it, expect } from "vitest";
import { familyKeyFor, resolvePremiumName } from "../../lib/slumhouse/premium-names.js";

const base = { name: "orb_15m", symbols: ["MES"], timeframe: "15m", config: { entry_indicator: "archetype:opening_range_breakout" } };

describe("familyKeyFor", () => {
  it("prefers the archetype from config.entry_indicator, stripped + normalized", () => {
    expect(familyKeyFor(base)).toBe("opening_range_breakout");
  });
  it("falls back to the raw name with timeframe/symbol/session suffixes stripped", () => {
    expect(familyKeyFor({ name: "connors_rsi2_mes_15m", symbols: ["MES"], timeframe: "15m", config: {} })).toBe("connors_rsi2");
  });
});

describe("resolvePremiumName", () => {
  it("maps a known family to its premium name", () => {
    const r = resolvePremiumName(base);
    expect(r.premiumName).toBe("Opening Heist");
    expect(r.family).toBe("opening_range_breakout");
    expect(r.variantTag).toBe("15m · MES");
  });
  it("adds a session to the variant tag when present in the raw name", () => {
    const r = resolvePremiumName({ name: "ict_silver_bullet_ny_am", symbols: ["MNQ"], timeframe: "15m", config: { entry_indicator: "archetype:silver_bullet" } });
    expect(r.premiumName).toBe("Silver Bullet");
    expect(r.variantTag).toBe("15m · MNQ · NY AM");
  });
  it("never returns blank — falls back to Title-Cased raw name", () => {
    const r = resolvePremiumName({ name: "weird_new_thing_9000", symbols: ["MES"], timeframe: "5m", config: {} });
    expect(r.premiumName).toBe("Weird New Thing 9000");
    expect(r.family).toBe("weird_new_thing_9000");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/server/__tests__/slumhouse/premium-names.test.ts`) — module not found.

- [ ] **Step 3: Implement**

```ts
// src/server/lib/slumhouse/premium-names.ts
export interface NamedStrategyRow {
  name: string;
  symbols: string[];
  timeframe: string;
  config?: Record<string, unknown> | null;
}

// Operator-curated. familyKey (normalized archetype/concept) → premium menu name.
// Add/rename freely; unmapped families fall back to a Title-Cased raw name.
export const PREMIUM_NAMES: Record<string, string> = {
  opening_range_breakout: "Opening Heist",
  orb: "Opening Heist",
  orb_15m: "Opening Heist",
  silver_bullet: "Silver Bullet",
  ict_silver_bullet_ny_am: "Silver Bullet",
  connors_rsi2: "The Dip Snatch",
  ema_9_21_pullback: "Trend Rider",
  ema_20_50_pullback: "Trend Rider",
  vwap_fade: "The Fade",
  vwap_hod_lod_rejection: "The Fade",
  liquidity_sweep_reversal: "Crude Sweep",
  bollinger_squeeze: "Squeeze Play",
  keltner_squeeze: "Squeeze Play",
  nr7: "Coiled Spring",
  ict_bias_aligned_continuation: "The Continuation",
  bounce_off_level: "The Bounce",
};

const SESSION_MAP: Record<string, string> = { ny_am: "NY AM", ny_pm: "NY PM", london: "London", asian: "Asian", asia: "Asian" };
const TF_RE = /_(\d+m|\d+min|\d+h|daily|weekly)$/i;
const SYM_RE = /_(mes|mnq|mcl|es|nq|cl)$/i;
const SESSION_RE = /_(ny_am|ny_pm|london|asian|asia)$/i;

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function familyKeyFor(row: NamedStrategyRow): string {
  const ind = typeof row.config?.["entry_indicator"] === "string" ? String(row.config["entry_indicator"]) : "";
  if (ind.startsWith("archetype:")) return ind.slice("archetype:".length).toLowerCase();
  // else strip variant suffixes off the raw name
  let k = (row.name || "").toLowerCase();
  for (const re of [SESSION_RE, SYM_RE, TF_RE]) { let prev; do { prev = k; k = k.replace(re, ""); } while (k !== prev); }
  return k;
}

export function resolvePremiumName(row: NamedStrategyRow): { family: string; premiumName: string; variantTag: string } {
  const family = familyKeyFor(row);
  const premiumName = PREMIUM_NAMES[family] ?? PREMIUM_NAMES[(row.name || "").toLowerCase()] ?? titleCase(row.name || family);
  const parts: string[] = [];
  if (row.timeframe) parts.push(row.timeframe);
  if (row.symbols?.[0]) parts.push(row.symbols[0]);
  const sessMatch = (row.name || "").toLowerCase().match(/(ny_am|ny_pm|london|asian|asia)/);
  if (sessMatch) parts.push(SESSION_MAP[sessMatch[1]] ?? sessMatch[1]);
  return { family, premiumName, variantTag: parts.join(" · ") };
}
```

- [ ] **Step 4: Run — expect PASS** (all tests green).
- [ ] **Step 5: Commit**
```bash
git add src/server/lib/slumhouse/premium-names.ts src/server/__tests__/slumhouse/premium-names.test.ts
git commit --no-verify -m "slumhouse-menu-p1: premium name resolver + curated family map"
```

### Task 2: Variant family grouping + champion

**Files:**
- Create: `src/server/lib/slumhouse/strategy-families.ts`
- Test: `src/server/__tests__/slumhouse/strategy-families.test.ts`

**Context:** Group strategy rows into families by `familyKeyFor`. The champion = variant furthest along the lifecycle (order below), tie-broken by higher `forgeScore`. Lifecycle order: `CANDIDATE < TESTING < SHADOW < PAPER < DEPLOY_READY < PILOT < DEPLOYED`; `GRAVEYARD`/`DECLINING` rank below CANDIDATE for champion purposes.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/__tests__/slumhouse/strategy-families.test.ts
import { describe, it, expect } from "vitest";
import { groupIntoFamilies, LIFECYCLE_ORDER } from "../../lib/slumhouse/strategy-families.js";

const mk = (over: any) => ({ id: over.id, name: over.name, symbols: over.symbols ?? ["MES"], timeframe: over.timeframe ?? "15m", lifecycleState: over.lifecycleState, forgeScore: over.forgeScore ?? 0, config: over.config ?? { entry_indicator: "archetype:orb" } });

describe("groupIntoFamilies", () => {
  it("groups variants under one family and picks the furthest-along champion", () => {
    const rows = [
      mk({ id: "a", name: "orb_15m", timeframe: "15m", lifecycleState: "PAPER", forgeScore: 7 }),
      mk({ id: "b", name: "orb_30m", timeframe: "30m", lifecycleState: "TESTING", forgeScore: 9 }),
      mk({ id: "c", name: "orb_5m", timeframe: "5m", lifecycleState: "PAPER", forgeScore: 8 }),
    ];
    const fams = groupIntoFamilies(rows);
    expect(fams.length).toBe(1);
    expect(fams[0].premiumName).toBe("Opening Heist");
    expect(fams[0].variants.length).toBe(3);
    // champion = PAPER (furthest) with higher forgeScore among PAPER → "c" (8 > 7)
    expect(fams[0].champion.id).toBe("c");
  });
  it("keeps distinct archetypes in separate families", () => {
    const rows = [ mk({ id: "a", name: "orb_15m", lifecycleState: "TESTING", config: { entry_indicator: "archetype:orb" } }),
                   mk({ id: "b", name: "silver_bullet", lifecycleState: "TESTING", config: { entry_indicator: "archetype:silver_bullet" } }) ];
    expect(groupIntoFamilies(rows).length).toBe(2);
  });
});

describe("LIFECYCLE_ORDER", () => {
  it("ranks DEPLOYED above PAPER above TESTING", () => {
    expect(LIFECYCLE_ORDER.DEPLOYED).toBeGreaterThan(LIFECYCLE_ORDER.PAPER);
    expect(LIFECYCLE_ORDER.PAPER).toBeGreaterThan(LIFECYCLE_ORDER.TESTING);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/server/lib/slumhouse/strategy-families.ts
import { resolvePremiumName, familyKeyFor, type NamedStrategyRow } from "./premium-names.js";

export const LIFECYCLE_ORDER: Record<string, number> = {
  GRAVEYARD: -2, DECLINING: -1, CANDIDATE: 0, TESTING: 1, SHADOW: 2, PAPER: 3, DEPLOY_READY: 4, PILOT: 5, DEPLOYED: 6,
};

export interface FamilyRow extends NamedStrategyRow { id: string; lifecycleState: string; forgeScore?: number | null; }
export interface Variant { id: string; premiumName: string; variantTag: string; lifecycleState: string; forgeScore: number; symbol: string; timeframe: string; }
export interface Family { familyKey: string; premiumName: string; variants: Variant[]; champion: Variant; }

export function groupIntoFamilies(rows: FamilyRow[]): Family[] {
  const byKey = new Map<string, FamilyRow[]>();
  for (const r of rows) { const k = familyKeyFor(r); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(r); }
  const families: Family[] = [];
  for (const [familyKey, group] of byKey) {
    const variants: Variant[] = group.map((r) => {
      const n = resolvePremiumName(r);
      return { id: r.id, premiumName: n.premiumName, variantTag: n.variantTag, lifecycleState: r.lifecycleState, forgeScore: Number(r.forgeScore ?? 0), symbol: r.symbols?.[0] ?? "MES", timeframe: r.timeframe };
    });
    const champion = [...variants].sort((a, b) => {
      const la = LIFECYCLE_ORDER[a.lifecycleState] ?? 0, lb = LIFECYCLE_ORDER[b.lifecycleState] ?? 0;
      return lb - la || b.forgeScore - a.forgeScore;
    })[0];
    families.push({ familyKey, premiumName: variants[0].premiumName, variants, champion });
  }
  return families;
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**
```bash
git add src/server/lib/slumhouse/strategy-families.ts src/server/__tests__/slumhouse/strategy-families.test.ts
git commit --no-verify -m "slumhouse-menu-p1: variant family grouping + champion selection"
```

---

## Phase 2 — Progress line (gate journey + component)

### Task 3: Gate-journey resolver

**Files:**
- Create: `src/server/lib/slumhouse/gate-journey.ts`
- Test: `src/server/__tests__/slumhouse/gate-journey.test.ts`

**Context:** Build the `Gate[]` a strategy has travelled. Input: the strategy's `lifecycleState` + a `gateSignals` object of booleans/tri-states already computed by `recipe-data.ts` (its "8 tests" — reuse those: `wfe_pass`, `frankenstein_pass`, `blackswan_pass`, `paper_done`, `shadow_pass`, `compliance_pass`; plus `backtested` = has a completed backtest). Each `Gate.status`: `pass` if its check passed; `fail` if it's the gate that killed the strategy (state GRAVEYARD and this is the first failing gate); `now` if it's the current lifecycle frontier and not yet passed; else `wait`. The 8 gates in order match the spec table.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/__tests__/slumhouse/gate-journey.test.ts
import { describe, it, expect } from "vitest";
import { resolveGateJourney, GATE_DEFS } from "../../lib/slumhouse/gate-journey.js";

describe("resolveGateJourney", () => {
  it("marks cleared gates pass, the frontier now, the rest wait", () => {
    const gates = resolveGateJourney({
      lifecycleState: "PAPER",
      signals: { backtested: true, wfe_pass: true, frankenstein_pass: true, blackswan_pass: true, paper_done: false, shadow_pass: false, compliance_pass: false },
    });
    const byKey = Object.fromEntries(gates.map((g) => [g.key, g.status]));
    expect(byKey.profitable).toBe("pass");
    expect(byKey.holds_up).toBe("pass");
    expect(byKey.real_edge).toBe("pass");
    expect(byKey.crash_proof).toBe("pass");
    expect(byKey.paper_trial).toBe("now");   // frontier
    expect(byKey.live_match).toBe("wait");
    expect(byKey.live_money).toBe("wait");
    expect(gates.map((g) => g.label)).toEqual(GATE_DEFS.map((d) => d.label));
  });
  it("marks the first failing gate as fail for a graveyard strategy", () => {
    const gates = resolveGateJourney({
      lifecycleState: "GRAVEYARD",
      signals: { backtested: true, wfe_pass: true, frankenstein_pass: false, blackswan_pass: false, paper_done: false, shadow_pass: false, compliance_pass: false },
    });
    const byKey = Object.fromEntries(gates.map((g) => [g.key, g.status]));
    expect(byKey.real_edge).toBe("fail");
    expect(byKey.crash_proof).toBe("wait"); // never reached
  });
  it("marks every gate pass + live_money pass for a DEPLOYED strategy", () => {
    const gates = resolveGateJourney({ lifecycleState: "DEPLOYED", signals: { backtested: true, wfe_pass: true, frankenstein_pass: true, blackswan_pass: true, paper_done: true, shadow_pass: true, compliance_pass: true } });
    expect(gates.every((g) => g.status === "pass")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/server/lib/slumhouse/gate-journey.ts
export type GateStatus = "pass" | "now" | "fail" | "wait";
export interface Gate { key: string; label: string; sub: string; status: GateStatus; }
export interface GateSignals {
  backtested: boolean; wfe_pass: boolean; frankenstein_pass: boolean; blackswan_pass: boolean;
  paper_done: boolean; shadow_pass: boolean; compliance_pass: boolean;
}
export interface JourneyInput { lifecycleState: string; signals: GateSignals; }

export const GATE_DEFS: Array<{ key: string; label: string; sub: string; signal: keyof GateSignals }> = [
  { key: "profitable",  label: "Profitable",  sub: "made money in testing",   signal: "backtested" },
  { key: "holds_up",    label: "Holds Up",    sub: "works on unseen data",    signal: "wfe_pass" },
  { key: "real_edge",   label: "Real Edge",   sub: "not just luck",           signal: "frankenstein_pass" },
  { key: "crash_proof", label: "Crash-Proof", sub: "survives a bad day",      signal: "blackswan_pass" },
  { key: "paper_trial", label: "Paper Trial", sub: "fake money",              signal: "paper_done" },
  { key: "live_match",  label: "Live Match",  sub: "live = the test",         signal: "shadow_pass" },
  { key: "rule_safe",   label: "Rule-Safe",   sub: "won't break firm rules",  signal: "compliance_pass" },
  { key: "live_money",  label: "Live Money",  sub: "on the menu",             signal: "compliance_pass" },
];

export function resolveGateJourney({ lifecycleState, signals }: JourneyInput): Gate[] {
  const dead = lifecycleState === "GRAVEYARD" || lifecycleState === "DECLINING";
  const deployed = lifecycleState === "DEPLOYED";
  let frontierAssigned = false;
  let failAssigned = false;
  return GATE_DEFS.map((d, i) => {
    // "live_money" (last) only passes when DEPLOYED; others pass on their signal.
    const passed = d.key === "live_money" ? deployed : Boolean(signals[d.signal]);
    let status: GateStatus;
    if (passed) status = "pass";
    else if (dead && !failAssigned) { status = "fail"; failAssigned = true; }
    else if (!dead && !frontierAssigned) { status = "now"; frontierAssigned = true; }
    else status = "wait";
    return { key: d.key, label: d.label, sub: d.sub, status };
  });
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**
```bash
git add src/server/lib/slumhouse/gate-journey.ts src/server/__tests__/slumhouse/gate-journey.test.ts
git commit --no-verify -m "slumhouse-menu-p2: gate-journey resolver"
```

### Task 4: Progress-line CSS + JS component

**Files:**
- Create: `public/slumhouse/progress-line.css`
- Create: `public/slumhouse/progress-line.js`

**Context:** Port the approved v6 visual. The full styles + markup already exist at `.superpowers/brainstorm/843-1783112689/content/progress-line-v6.html` — copy the `<style>` block (everything from `.stage` / `.track` / `.rail` / `.fill` / `.node` / `.orb` / `.bezel` / `.body` / `.reflect` / `.lbl` / `.legend` down, plus the `@keyframes`) verbatim into `progress-line.css`. Do NOT copy the page-level `body`/`.card`/`.wrap` rules — the card comes from the host page. The JS builds the node markup from a `Gate[]`.

- [ ] **Step 1: Create `progress-line.css`** by copying the node/rail/orb/animation CSS from the v6 mockup `<style>` (the `.stage`…`.legend` + `@keyframes` rules). Prefix nothing — these classes are component-scoped.

- [ ] **Step 2: Create `progress-line.js`**

```js
// public/slumhouse/progress-line.js — renders a Gate[] into a container as the animated line.
// Gate = { key, label, sub, status: "pass"|"now"|"fail"|"wait" }
(function () {
  const ICON = { pass: "✓", now: "▸", fail: "✗", wait: "·" };
  function orb(g) {
    const halo = g.status === "now" ? '<div class="halo"></div>' : "";
    return `<div class="node ${g.status}"><div class="shadow"></div>${halo}` +
      `<div class="orb"><div class="bezel"></div><div class="body">${ICON[g.status] || "·"}</div><div class="reflect"></div></div>` +
      `<div class="lbl"><b>${g.label}</b><span>${g.sub}</span></div></div>`;
  }
  function pctFor(gates) {
    const lastPass = gates.map((g) => g.status).lastIndexOf("pass");
    const n = gates.length - 1;
    return n <= 0 ? 0 : Math.round(((lastPass < 0 ? 0 : lastPass) / n) * 100);
  }
  // opts.dead=true renders the red "dead" conduit for graveyard
  window.renderProgressLine = function (container, gates, opts) {
    const dead = opts && opts.dead;
    container.innerHTML =
      '<div class="stage"><div class="track">' +
      `<div class="rail"></div><div class="fill${dead ? " dead" : ""}" style="width:${pctFor(gates)}%"></div>` +
      '<div class="nodes">' + gates.map(orb).join("") + "</div>" +
      "</div></div>";
  };
})();
```

- [ ] **Step 3: Manual verify** — create a throwaway `public/slumhouse/_pltest.html` that loads the css+js and calls `renderProgressLine` with a sample `Gate[]`; open `http://localhost:4000/slumhouse/_pltest.html`, confirm it matches v6; then delete `_pltest.html`.

- [ ] **Step 4: Commit**
```bash
git add public/slumhouse/progress-line.css public/slumhouse/progress-line.js
git commit --no-verify -m "slumhouse-menu-p2: shared progress-line component (v6 visual)"
```

### Task 5: Wire the progress line into the recipe page + expose gate signals

**Files:**
- Modify: `src/server/lib/slumhouse/recipe-data.ts` (add a `gateJourney: Gate[]` field to the recipe payload, computed via `resolveGateJourney` from the existing 8-test signals)
- Modify: `public/slumhouse/recipe.html` (include the css/js, render `data.gateJourney` into a container)

- [ ] **Step 1:** In `recipe-data.ts`, import `resolveGateJourney` + map the existing `otherTests`/gate booleans into a `GateSignals` object (backtested from `extras`, wfe_pass from the Surprise test status==="pass", frankenstein_pass from Real-or-Lucky, blackswan_pass from Worst-Day, paper_done from Preseason, shadow_pass from Real-Time-Match, compliance_pass from Plays-Clean, `dead` = lifecycle GRAVEYARD). Add `gateJourney` + `dead` to the returned `RecipeData`. Add a unit test in `recipe-data.test.ts` asserting `gateJourney` is present and reflects a killed strategy's fail gate.

- [ ] **Step 2:** In `recipe.html`, add `<link rel="stylesheet" href="/slumhouse/progress-line.css">` + `<script src="/slumhouse/progress-line.js">`, add a `<div id="r-progress" class="glass-card"></div>` where the "8 tests" list is (keep the honest status logic), and in `render(r)` call `renderProgressLine(document.getElementById("r-progress"), r.gateJourney, { dead: r.dead })`.

- [ ] **Step 3:** Verify live on a real recipe URL; run `npx vitest run src/server/__tests__/slumhouse/`.

- [ ] **Step 4: Commit**
```bash
git add src/server/lib/slumhouse/recipe-data.ts public/slumhouse/recipe.html src/server/__tests__/slumhouse/recipe-data.test.ts
git commit --no-verify -m "slumhouse-menu-p2: progress line on recipe page from gate journey"
```

---

## Phase 3 — Menu category pages

### Task 6: Category assemblers

**Files:**
- Create: `src/server/lib/slumhouse/menu-data.ts`
- Test: `src/server/__tests__/slumhouse/menu-data.test.ts`

**Context:** Mirror the existing `kitchen-data.ts` query style (raw `db.execute(sql\`…\`)`). Four assemblers reading `strategies` (+ joins already used by `assembleTodaysMenu` for $ stats). Each returns dishes/families with `resolvePremiumName` applied. `assembleNowServing` (DEPLOYED/DECLINING champions) can delegate to the existing `assembleTodaysMenu` and add premium names. `assembleDeployReady` (DEPLOY_READY champions). `assembleKitchenMenu(symbol)` (lifecycle in CANDIDATE/TESTING/SHADOW/PAPER, filtered by `symbol = ANY(symbols)`, grouped via `groupIntoFamilies`, each variant carrying a compact `gates` summary). `assembleGraveyardMenu` (GRAVEYARD grouped by family with kill reason from audit/last transition).

- [ ] **Step 1:** Write `menu-data.test.ts` with mocked `db.execute` (follow the exact mock pattern in the existing `recipe-data.test.ts` / `kitchen-data` tests) asserting: now-serving applies premium names; kitchen filters by symbol + groups families; graveyard groups by family. (Full fixtures per the sibling tests' style.)
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement the four assemblers using `resolvePremiumName` + `groupIntoFamilies`, reusing `assembleTodaysMenu`'s query for the $ stats on now-serving.
- [ ] **Step 4:** Run — expect PASS + full `slumhouse/` dir green.
- [ ] **Step 5: Commit** (`slumhouse-menu-p3: category assemblers`).

### Task 7: Menu API routes

**Files:**
- Create: `src/server/routes/slumhouse/api/menu.ts`
- Modify: `src/server/routes/slumhouse/index.ts` (mount)
- Test: `src/server/__tests__/slumhouse/menu-route.test.ts`

**Context:** Follow `kitchen.ts` route file verbatim (Router + `requireSlumhouseUser` + thin handlers calling the assemblers).

- [ ] **Step 1:** Write `menu-route.test.ts` (mirror `conveyor-status-route.test.ts` / kitchen route test): assert the router exports and registers `/slumhouse/api/menu/now-serving`, `/deploy-ready`, `/kitchen`, `/graveyard`, each behind `requireSlumhouseUser`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement `menu.ts` (4 GET routes → 4 assemblers, `/kitchen` reads `?symbol=` default `MES`). Mount in `index.ts` next to the other slumhouse api routers.
- [ ] **Step 4:** Run — expect PASS + `npx tsc --noEmit` clean on the new files.
- [ ] **Step 5: Commit** (`slumhouse-menu-p3: menu category routes`).

### Task 8: Menu frontend (tabbed)

**Files:**
- Create: `public/slumhouse/menu.html`
- Modify: `public/slumhouse/kitchen.html` (add a nav link/button to the menu)

**Context:** Plain JS + `SH.fetchJSON`, black-glass cards (reuse the card style from kitchen/office). Tabs: `Now Serving · Deploy-Ready · In the Kitchen · Graveyard`; In-the-Kitchen has `MES · MNQ · MCL` sub-pills. Each dish is a card showing `premiumName` (big) + `variantTag` (small) + key stats, linking to `recipe.html?id=<id>`. Honest error/empty states (real "couldn't reach the kitchen" like recipe.html's deep-scan #13 fix, not a fake empty).

- [ ] **Step 1:** Build `menu.html` shell (header/nav matching kitchen.html, tab bar, `#menu-body`). Include the shared card CSS.
- [ ] **Step 2:** JS: on tab click, `fetchJSON` the matching `/slumhouse/api/menu/*` route, render dish cards; for In-the-Kitchen render families (champion headline + variants). On `null` (fetch fail) render the reachable error state, not empty.
- [ ] **Step 3:** Add the menu link to `kitchen.html` nav.
- [ ] **Step 4:** Verify live: each tab loads, dishes link to recipes, error state shows when backend refuses.
- [ ] **Step 5: Commit** (`slumhouse-menu-p3: tabbed menu page`).

---

## Phase 4 — Kitchen cook-off

### Task 9: Family cook-off (variants racing) in the In-the-Kitchen tab

**Files:**
- Modify: `public/slumhouse/menu.html` (expand each kitchen family into a cook-off: champion highlighted + each variant with a **compact** progress line inline via `renderProgressLine`)
- Modify: `src/server/lib/slumhouse/menu-data.ts` (ensure each kitchen variant carries its `gateJourney` — reuse `resolveGateJourney` with signals from a lightweight per-strategy gate lookup)

- [ ] **Step 1:** Extend `assembleKitchenMenu` so each variant includes `gateJourney: Gate[]` (compute from the same signals source recipe-data uses; if a per-strategy signal fetch is heavy, cap the kitchen list and note it). Add a test asserting variants carry a gateJourney.
- [ ] **Step 2:** In `menu.html`, render each family as a group: champion card on top, then variant rows each calling `renderProgressLine(el, variant.gateJourney)` in a compact mode (add a `.compact` class to the component that shrinks node/label sizes — add those CSS overrides to `progress-line.css`).
- [ ] **Step 3:** Verify live: a family (e.g. ORB) shows 15m/30m/5m racing, champion marked.
- [ ] **Step 4: Commit** (`slumhouse-menu-p4: kitchen cook-off with per-variant progress lines`).

---

## Phase 5 — Banner swap

### Task 10: Image-only hero banner

**Files:**
- Modify: `public/slumhouse/kitchen.html` (hero)
- Asset: `public/slumhouse/images/<new-banner>.png` (operator drops the render in; filename TBD by operator — use `slumdawg-kitchen-banner.png`)

**Context:** The hero is `.kv-hero` = `.kv-hero-art` (background image) + `.kv-hero-body` (text). Requirement: full-width image only, no text body to the right.

- [ ] **Step 1:** Replace `.kv-hero-art` background `url('/slumhouse/images/slumdawg-kitchen.png')` with `url('/slumhouse/images/slumdawg-kitchen-banner.png')`; make `.kv-hero` a single full-width column (remove the 2-column grid) and set the art to full width with a sensible aspect ratio (`aspect-ratio` or `min-height`, `background-size:cover`).
- [ ] **Step 2:** Remove the `.kv-hero-body` block (eyebrow + "Slumdawg is cooking N plays" + paragraph) from the hero markup. Move the "cooking N plays / N on the menu" line, if kept, into the pipeline `.kv-section-label` (optional; else drop).
- [ ] **Step 3:** Verify live at `/slumhouse/kitchen.html`: banner is full-width image, no side text.
- [ ] **Step 4: Commit** (`slumhouse-menu-p5: image-only hero banner`).

---

## Final task: close-out

- [ ] Run `npx vitest run src/server/__tests__/slumhouse/` (all green) + `npx tsc --noEmit` (no new errors) + the 3 CI gates (`check:production-isolation`, `check:2026-compliance`, `system-map:check`).
- [ ] `git push origin hardening/phase-0`.
- [ ] Append an AGENT-LOGS.md entry (§10b) and update memory.

---

## Self-review notes

- **Spec coverage:** Component 1 → Task 1; Component 2 → Task 2 + Task 9; Component 3 → Tasks 6-8; Component 4 → Tasks 3-5 (+ compact mode Task 9); Component 5 → Task 10. All covered.
- **Type consistency:** `Gate`/`GateStatus` defined in `gate-journey.ts` (Task 3), consumed by `progress-line.js` (Task 4) + `recipe-data.ts` (Task 5) + `menu-data.ts` (Task 9). `Family`/`Variant` defined in `strategy-families.ts` (Task 2), consumed by `menu-data.ts` (Task 6/9). `resolvePremiumName`/`familyKeyFor` names consistent across Tasks 1/2/6.
- **Naming:** `renderProgressLine(container, gates, opts)` is the single component entry, used identically in Tasks 5 and 9.
- **Known dependency:** Task 5 assumes `recipe-data.ts` already computes the 8-test pass/warn/fail signals (it does — deep-scan #13 Task 12). Task 9's per-variant signals reuse the same source; if too heavy for a large kitchen list, cap it and `log()` the cap (honest truncation).
