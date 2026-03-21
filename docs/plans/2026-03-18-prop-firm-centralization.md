# Prop Firm Rules Centralization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a single source of truth for all prop firm rules, sync it across the entire Trading Forge stack (TypeScript backend, Python engine, React frontend), and enforce firm rules wherever capital/drawdown/contracts are referenced.

**Architecture:** Extract firm configs from 4 duplicate locations into one shared TypeScript module (`src/shared/firm-config.ts`) and one Python mirror (`src/engine/firm_config.py` — already exists, needs sync). All backend routes, frontend pages, and engine defaults reference these shared configs. Capital defaults change from $100K to $50K everywhere.

**Tech Stack:** TypeScript (Express routes, React hooks), Python (backtester, Monte Carlo, compliance), PostgreSQL (Drizzle schema defaults), Zod validation

---

## Current State Audit

### Config Duplication (4 locations, all diverged)

| Location | What It Has | Issues |
|----------|-------------|--------|
| `src/server/routes/prop-firm.ts` FIRMS | Full firm config: fees, DD, contracts, trailing, split, consistency | Fee inaccuracies vs docs (see below) |
| `src/server/routes/risk.ts` FIRM_LIMITS | DD, contracts, daily loss, trailing only | Missing fees/splits, `alpha_standard` key mismatch |
| `src/engine/firm_config.py` | Commissions, contract caps, scaling plans | No DD/fees/splits, only 50K accounts |
| `docs/prop-firm-rules.md` | Authoritative source with full detail | Not machine-readable, agents parse it |

### Fee Discrepancies (prop-firm.ts vs docs/prop-firm-rules.md)

| Firm | Field | Code | Docs | Fix |
|------|-------|------|------|-----|
| MFFU 100K | monthlyFee | $167 | $137 | $137 |
| Apex 50K | monthlyFee | $147 | $167 | $167 |
| Alpha Standard 50K | monthlyFee | $97 | $99 | $99 |
| Alpha Standard 50K | activationFee | $0 | $149 | $149 |
| TPT 100K | monthlyFee | $350 | $250 | $250 |
| FFN 50K | monthlyFee | $115 | $150 (Standard) | $150 |
| FFN 100K | monthlyFee | $200 | $260 (Standard) | $260 |
| Alpha 50K | overnightOk | true | NOT_ALLOWED | false |
| Topstep | overnightOk | false | allowed (higher margin) | true |
| TPT | minPayoutDays | 15 | 5 | 5 |
| Earn2Trade | minPayoutDays | 15 | unknown, keep 15 | 15 |

### Missing Features

| Feature | Status |
|---------|--------|
| Apex $85/mo ongoing funded fee | Not modeled in payout projection |
| FFN $126/mo ongoing data fee | Not modeled |
| Alpha tiered payout splits (70/75/80/90) | Flat 80% in code |
| TPT PRO->PRO+ split escalation (80->90) | Flat 80% in code |
| Apex 100% first $25K then 90% | Flat 100% in code |
| Daily loss limits (FFN has one) | Only in risk.ts, not prop-firm.ts |
| Consistency rule enforcement in paper trading | Not implemented |
| Weekend position restrictions | Not enforced |
| Overnight position restrictions (Alpha, FFN) | Not enforced |

### Capital Defaults (100K -> 50K needed)

| File | Current | Should Be |
|------|---------|-----------|
| `src/engine/backtester.py:591` | 100_000 | Configurable, default 50_000 |
| `src/engine/backtester.py:1160` | 100_000 | Configurable, default 50_000 |
| `src/engine/backtester.py:874` | `abs(max_dd) * 100_000` | Use actual starting capital |
| `src/engine/config.py:192` | 100_000.0 | 50_000.0 |
| `src/server/routes/monte-carlo.ts:17` | 100_000 | 50_000 |
| `src/server/services/monte-carlo-service.ts:143` | 100_000.0 | 50_000.0 |
| `src/server/services/backtest-service.ts:310-311` | "100000" | "50000" |
| `src/server/db/schema.ts:499-500` | "100000" | "50000" |
| `src/server/routes/paper.ts:16` | "100000" | "50000" |

---

## Execution Plan — 5 Sequential Tasks

### Task 1: Create Shared TypeScript Firm Config Module

**Files:**
- Create: `src/shared/firm-config.ts`
- Modify: `src/server/routes/prop-firm.ts` — import from shared
- Modify: `src/server/routes/risk.ts` — import from shared, delete FIRM_LIMITS

**Step 1: Create `src/shared/firm-config.ts`**

This is the single source of truth for all TypeScript code. Export:
- `FirmAccountConfig` interface (all fields including dailyLoss, ongoingMonthlyFee, overnightOk, weekendOk)
- `FirmConfig` interface
- `FIRMS` record with corrected values from docs
- `CONTRACT_SPECS` (move from risk.ts)
- Helper functions: `getFirmAccount()`, `getFirmLimit()`, `getAllFirms()`

```typescript
// src/shared/firm-config.ts

export interface FirmAccountConfig {
  accountSize: number;
  monthlyFee: number;
  activationFee: number;
  ongoingMonthlyFee: number;     // NEW: Apex $85/mo, FFN $126/mo, others $0
  profitTarget: number;
  maxDrawdown: number;
  maxContracts: number;
  trailing: "eod" | "realtime";
  payoutSplit: number;            // Initial split
  payoutSplitTiers?: { threshold: number; split: number }[];  // NEW: escalating splits
  minPayoutDays: number;
  consistencyRule: number | null; // max % from best day
  dailyLossLimit: number | null;  // NEW: FFN has this
  overnightOk: boolean;
  weekendOk: boolean;             // NEW: all firms = false
}

export interface FirmConfig {
  name: string;
  displayName: string;
  evaluationType: "one_step" | "two_step";
  accountTypes: Record<string, FirmAccountConfig>;
}

export const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  ES:  { tickSize: 0.25, tickValue: 12.50, pointValue: 50.00 },
  NQ:  { tickSize: 0.25, tickValue: 5.00,  pointValue: 20.00 },
  CL:  { tickSize: 0.01, tickValue: 10.00, pointValue: 1000.00 },
  YM:  { tickSize: 1.00, tickValue: 5.00,  pointValue: 5.00 },
  RTY: { tickSize: 0.10, tickValue: 5.00,  pointValue: 50.00 },
  GC:  { tickSize: 0.10, tickValue: 10.00, pointValue: 100.00 },
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
};

export const DEFAULT_ACCOUNT_SIZE = 50_000;
export const DEFAULT_ACCOUNT_TYPE = "50k";

export const FIRMS: Record<string, FirmConfig> = {
  mffu: {
    name: "mffu",
    displayName: "MyFundedFutures (MFFU)",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 77, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2500, maxContracts: 5, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 1, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 137, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 5500, maxDrawdown: 3500, maxContracts: 10, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 1, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "150k": {
        accountSize: 150000, monthlyFee: 197, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 9000, maxDrawdown: 5000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 1, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },
  topstep: {
    name: "topstep",
    displayName: "Topstep",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 49, activationFee: 149, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 5, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 5, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 99, activationFee: 149, ongoingMonthlyFee: 0,
        profitTarget: 6000, maxDrawdown: 3000, maxContracts: 10, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 5, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "150k": {
        accountSize: 150000, monthlyFee: 149, activationFee: 149, ongoingMonthlyFee: 0,
        profitTarget: 9000, maxDrawdown: 4500, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 5, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },
  tpt: {
    name: "tpt",
    displayName: "Take Profit Trader (TPT)",
    evaluationType: "one_step",
    accountTypes: {
      "25k": {
        accountSize: 25000, monthlyFee: 150, activationFee: 130, ongoingMonthlyFee: 0,
        profitTarget: 1500, maxDrawdown: 1500, maxContracts: 3, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 5, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "50k": {
        accountSize: 50000, monthlyFee: 150, activationFee: 130, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 3000, maxContracts: 6, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 5, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 250, activationFee: 130, ongoingMonthlyFee: 0,
        profitTarget: 6000, maxDrawdown: 6000, maxContracts: 12, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 5, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "150k": {
        accountSize: 150000, monthlyFee: 360, activationFee: 130, ongoingMonthlyFee: 0,
        profitTarget: 9000, maxDrawdown: 9000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 5, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },
  apex: {
    name: "apex",
    displayName: "Apex Trader Funding",
    evaluationType: "one_step",
    accountTypes: {
      "25k": {
        accountSize: 25000, monthlyFee: 147, activationFee: 85, ongoingMonthlyFee: 85,
        profitTarget: 1500, maxDrawdown: 1500, maxContracts: 4, trailing: "eod",
        payoutSplit: 1.00,
        payoutSplitTiers: [{ threshold: 25000, split: 0.90 }],
        minPayoutDays: 7, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "50k": {
        accountSize: 50000, monthlyFee: 167, activationFee: 85, ongoingMonthlyFee: 85,
        profitTarget: 3000, maxDrawdown: 2500, maxContracts: 10, trailing: "eod",
        payoutSplit: 1.00,
        payoutSplitTiers: [{ threshold: 25000, split: 0.90 }],
        minPayoutDays: 7, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 237, activationFee: 85, ongoingMonthlyFee: 85,
        profitTarget: 6000, maxDrawdown: 3000, maxContracts: 14, trailing: "eod",
        payoutSplit: 1.00,
        payoutSplitTiers: [{ threshold: 25000, split: 0.90 }],
        minPayoutDays: 7, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "150k": {
        accountSize: 150000, monthlyFee: 297, activationFee: 85, ongoingMonthlyFee: 85,
        profitTarget: 9000, maxDrawdown: 5000, maxContracts: 17, trailing: "eod",
        payoutSplit: 1.00,
        payoutSplitTiers: [{ threshold: 25000, split: 0.90 }],
        minPayoutDays: 7, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },
  ffn: {
    name: "ffn",
    displayName: "Funded Futures Network (FFN)",
    evaluationType: "two_step",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 150, activationFee: 120, ongoingMonthlyFee: 126,
        profitTarget: 3000, maxDrawdown: 2500, maxContracts: 5, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 3, consistencyRule: null,  // Standard has no consistency rule
        dailyLossLimit: 1250, overnightOk: false, weekendOk: false,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 260, activationFee: 120, ongoingMonthlyFee: 126,
        profitTarget: 6000, maxDrawdown: 3500, maxContracts: 10, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 3, consistencyRule: null,
        dailyLossLimit: 2000, overnightOk: false, weekendOk: false,
      },
      "150k": {
        accountSize: 150000, monthlyFee: 350, activationFee: 120, ongoingMonthlyFee: 126,
        profitTarget: 9000, maxDrawdown: 5000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 3, consistencyRule: null,
        dailyLossLimit: null, overnightOk: false, weekendOk: false,
      },
    },
  },
  alpha: {
    name: "alpha",
    displayName: "Alpha Futures",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 99, activationFee: 149, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 12, trailing: "eod",
        payoutSplit: 0.70,
        payoutSplitTiers: [
          { threshold: 0, split: 0.70 },    // 1st payout
          { threshold: 1, split: 0.75 },     // 2nd payout (count-based)
          { threshold: 2, split: 0.80 },     // 3rd payout
          { threshold: 3, split: 0.90 },     // 4th+ payout
        ],
        minPayoutDays: 2, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: false, weekendOk: false,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 179, activationFee: 149, ongoingMonthlyFee: 0,
        profitTarget: 6000, maxDrawdown: 4000, maxContracts: 20, trailing: "eod",
        payoutSplit: 0.70,
        payoutSplitTiers: [
          { threshold: 0, split: 0.70 },
          { threshold: 1, split: 0.75 },
          { threshold: 2, split: 0.80 },
          { threshold: 3, split: 0.90 },
        ],
        minPayoutDays: 2, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: false, weekendOk: false,
      },
      "150k": {
        accountSize: 150000, monthlyFee: 279, activationFee: 149, ongoingMonthlyFee: 0,
        profitTarget: 9000, maxDrawdown: 6000, maxContracts: 30, trailing: "eod",
        payoutSplit: 0.70,
        payoutSplitTiers: [
          { threshold: 0, split: 0.70 },
          { threshold: 1, split: 0.75 },
          { threshold: 2, split: 0.80 },
          { threshold: 3, split: 0.90 },
        ],
        minPayoutDays: 2, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: false, weekendOk: false,
      },
    },
  },
  tradeify: {
    name: "tradeify",
    displayName: "Tradeify",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 99, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2500, maxContracts: 5, trailing: "realtime",
        payoutSplit: 0.80, minPayoutDays: 10, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 150, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 6000, maxDrawdown: 5000, maxContracts: 10, trailing: "realtime",
        payoutSplit: 0.80, minPayoutDays: 10, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },
  earn2trade: {
    name: "earn2trade",
    displayName: "Earn2Trade",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 150, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 5, trailing: "eod",
        payoutSplit: 0.80, minPayoutDays: 15, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },
};

// Helper functions
export function getFirmAccount(firmName: string, accountType: string = DEFAULT_ACCOUNT_TYPE): FirmAccountConfig | null {
  return FIRMS[firmName]?.accountTypes[accountType] ?? null;
}

export function getFirmLimit(firmName: string, accountType: string = DEFAULT_ACCOUNT_TYPE): { maxDrawdown: number; maxContracts: number; dailyLossLimit: number | null; trailing: string } | null {
  const acct = getFirmAccount(firmName, accountType);
  if (!acct) return null;
  return { maxDrawdown: acct.maxDrawdown, maxContracts: acct.maxContracts, dailyLossLimit: acct.dailyLossLimit, trailing: acct.trailing };
}

export function getAllFirms(): FirmConfig[] {
  return Object.values(FIRMS);
}

export function getTightestDrawdown(accountType: string = DEFAULT_ACCOUNT_TYPE): { firm: string; maxDrawdown: number } {
  let tightest = { firm: "", maxDrawdown: Infinity };
  for (const [name, firm] of Object.entries(FIRMS)) {
    const acct = firm.accountTypes[accountType];
    if (acct && acct.maxDrawdown < tightest.maxDrawdown) {
      tightest = { firm: name, maxDrawdown: acct.maxDrawdown };
    }
  }
  return tightest;
}
```

**Step 2: Update `src/server/routes/prop-firm.ts`**

- Delete the inline `FirmConfig` interface and `FIRMS` constant (lines 10-152)
- Import from `../../shared/firm-config.js`
- Update the `/rank` endpoint to use `ongoingMonthlyFee` in payout calculations
- Update the `/payout` endpoint to subtract ongoing fees from funded months

**Step 3: Update `src/server/routes/risk.ts`**

- Delete `CONTRACT_SPECS` and `FIRM_LIMITS` (lines 6-53)
- Import `CONTRACT_SPECS`, `FIRMS`, `getFirmLimit` from `../../shared/firm-config.js`
- Update `max-contracts` handler to use `getFirmLimit()` instead of `FIRM_LIMITS`
- Update `portfolio-heat` handler similarly

**Step 4: Run `npx tsc --noEmit`**

Expected: Zero type errors

**Step 5: Commit**

```bash
git add src/shared/firm-config.ts src/server/routes/prop-firm.ts src/server/routes/risk.ts
git commit -m "refactor: centralize prop firm config into shared module"
```

---

### Task 2: Fix All $100K Capital Defaults to $50K

**Files:**
- Modify: `src/server/routes/monte-carlo.ts:17`
- Modify: `src/server/services/monte-carlo-service.ts:143`
- Modify: `src/server/services/backtest-service.ts:310-311`
- Modify: `src/server/db/schema.ts:499-500`
- Modify: `src/server/routes/paper.ts:16`
- Modify: `src/engine/backtester.py:591,874,1160`
- Modify: `src/engine/config.py:192`
- Modify: `src/engine/monte_carlo.py:848`

**Step 1: Fix TypeScript files**

In each file, change the default from `100000`/`100_000` to `50000`/`50_000`:

- `monte-carlo.ts:17`: `initialCapital: z.number().positive().default(50_000)`
- `monte-carlo-service.ts:143`: `initial_capital: options.initialCapital ?? 50_000.0`
- `backtest-service.ts:310`: `startingCapital: "50000"`
- `backtest-service.ts:311`: `currentEquity: "50000"`
- `db/schema.ts:499`: `.default("50000")`
- `db/schema.ts:500`: `.default("50000")`
- `paper.ts:16`: `startingCapital = "50000"`

Import `DEFAULT_ACCOUNT_SIZE` from shared config where practical. At minimum, use `50_000` literal.

**Step 2: Fix Python files**

- `backtester.py:591`: `STARTING_CAPITAL = 50_000.0`
- `backtester.py:1160`: `STARTING_CAPITAL = 50_000.0`
- `backtester.py:874`: `max_dd_dollars = abs(max_dd) * 50_000` (or better: use the actual starting capital variable)
- `config.py:192`: `initial_capital: float = 50_000.0`
- `monte_carlo.py:848`: `initial_capital=config.get("initial_capital", 50_000.0)`

**Step 3: Run `npx tsc --noEmit` and `python -m pytest src/engine/tests/ -x --tb=short`**

Expected: TS compiles clean. Python tests may need fixture updates (test_risk_metrics.py uses 100_000 but that's test-internal, leave it).

**Step 4: Commit**

```bash
git add -u
git commit -m "fix: change all capital defaults from $100K to $50K (prop firm standard)"
```

---

### Task 3: Wire Dashboard Prop Firm Panel to Real Data

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/Dashboard.tsx`
- Modify: `Trading_forge_frontend/amber-vision-main/src/hooks/usePropFirm.ts`

**Step 1: Add `useFirmConfig` hook**

In `usePropFirm.ts`, add a new hook that fetches the full firm config from `/api/prop-firm/firms` with account details:

```typescript
// New API endpoint needed (or enhance existing /firms to return full config)
export function useFirmConfig(firmName: string, accountType: string = "50k") {
  return useQuery({
    queryKey: ["prop-firm", "config", firmName, accountType],
    queryFn: () => api.get<FirmAccountConfig>(`/prop-firm/firms/${firmName}/${accountType}`),
    enabled: !!firmName,
  });
}
```

**Step 2: Add backend endpoint for single firm config**

In `prop-firm.ts`, add:

```typescript
propFirmRoutes.get("/firms/:firm/:accountType?", (req, res) => {
  const { firm, accountType = "50k" } = req.params;
  const firmConfig = FIRMS[firm];
  if (!firmConfig) { res.status(404).json({ error: "Firm not found" }); return; }
  const acct = firmConfig.accountTypes[accountType];
  if (!acct) { res.status(404).json({ error: "Account type not found" }); return; }
  res.json({ ...acct, firm: firmConfig.name, displayName: firmConfig.displayName });
});
```

**Step 3: Update Dashboard prop firm panel**

Replace the hardcoded `firmLimit = 2000` with dynamic lookup:

```typescript
// In Dashboard.tsx — add state for selected firm
const [selectedFirm] = useState("topstep"); // TODO: persist in user settings
const [selectedAccountType] = useState("50k");

// Import useFirms
const { data: firms } = useFirms();

// Compute firmLimit dynamically
const firmAccount = useMemo(() => {
  // Use the firms list to find the tightest DD across all selected firms
  // For now, use Topstep 50K as default (tightest at $2,000)
  // This will be replaced with user's actual firm selection
  const firmMap: Record<string, Record<string, { maxDrawdown: number }>> = {
    topstep: { "50k": { maxDrawdown: 2000 }, "100k": { maxDrawdown: 3000 } },
    mffu: { "50k": { maxDrawdown: 2500 }, "100k": { maxDrawdown: 3500 } },
    // ... populated from API
  };
  return firmMap[selectedFirm]?.[selectedAccountType] ?? { maxDrawdown: 2000 };
}, [selectedFirm, selectedAccountType]);
```

Better approach: fetch from the API so it stays in sync:

```typescript
const { data: firmConfigData } = useFirmConfig(selectedFirm, selectedAccountType);
const firmLimit = firmConfigData?.maxDrawdown ?? 2000;
const firmDisplayName = firmConfigData?.displayName ?? "Topstep";
const accountCapital = firmConfigData?.accountSize ?? 50_000;
```

Then in the prop firm panel, replace the hardcoded "MFFU 50K" card with:
- Show the user's selected firm + account type
- Balance = `accountCapital + totalPnl` (clamped to `accountCapital - firmLimit` floor)
- DD Used = `ddUsage.currentDD` / `firmLimit`
- Daily Loss = show today's loss vs `firmConfigData.dailyLossLimit` (if firm has one)
- Add a dropdown to switch between firms (for multi-firm users)

**Step 4: Update `INITIAL_CAPITAL` to be dynamic**

Replace `const INITIAL_CAPITAL = 50_000;` with:
```typescript
const INITIAL_CAPITAL = firmConfigData?.accountSize ?? 50_000;
```

This makes the entire Dashboard P&L curve, KPI cards, and DD calculations reflect the selected firm's account size.

**Step 5: Run `npm run build` in frontend**

Expected: Compiles with no errors

**Step 6: Commit**

```bash
git add -u
git commit -m "feat: wire Dashboard prop firm panel to real API data"
```

---

### Task 4: Sync Python Engine Firm Config

**Files:**
- Modify: `src/engine/firm_config.py`

**Step 1: Update firm_config.py to match shared config**

The Python config already has commissions, contract caps, and scaling plans. Add the missing fields to make it a full mirror:

```python
# Add to firm_config.py:

FIRM_RULES: dict[str, dict] = {
    "topstep_50k": {
        "account_size": 50_000,
        "monthly_fee": 49,
        "activation_fee": 149,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 5,
        "trailing": "eod",
        "payout_split": 0.90,
        "min_payout_days": 5,
        "consistency_rule": None,
        "daily_loss_limit": None,
        "overnight_ok": True,
        "weekend_ok": False,
    },
    # ... all 8 firms × all account types
}

def get_firm_rules(firm_key: str) -> dict:
    """Get full rules for a firm. Raises ValueError if not found."""
    if firm_key not in FIRM_RULES:
        raise ValueError(f"Unknown firm '{firm_key}'. Valid: {sorted(FIRM_RULES.keys())}")
    return FIRM_RULES[firm_key]

def get_max_drawdown(firm_key: str) -> float:
    """Get max drawdown for a firm."""
    return get_firm_rules(firm_key)["max_drawdown"]
```

**Step 2: Update backtester.py to use firm config**

Instead of hardcoded `STARTING_CAPITAL = 50_000.0`, accept it from config:

```python
# In backtester.py — wherever STARTING_CAPITAL is used
starting_capital = config.get("starting_capital", 50_000.0)
```

And the DD calculation at line 874:
```python
max_dd_dollars = abs(max_dd) * starting_capital  # Use actual capital, not hardcoded
```

**Step 3: Run `python -m pytest src/engine/tests/ -x --tb=short`**

Expected: Tests pass (test fixtures use their own values)

**Step 4: Commit**

```bash
git add src/engine/firm_config.py src/engine/backtester.py
git commit -m "feat: sync Python firm config with shared rules, use dynamic capital"
```

---

### Task 5: Update Payout Projections with Ongoing Fees and Tiered Splits

**Files:**
- Modify: `src/server/routes/prop-firm.ts` (rank and payout endpoints)

**Step 1: Update `/rank` endpoint**

The current ranking doesn't account for:
- Apex's $85/mo ongoing fee during funded months
- FFN's $126/mo ongoing data fee
- Tiered payout splits (TPT 80->90%, Alpha 70->75->80->90%)

Fix the ranking calculation:
```typescript
// In the ranking map function:
const ongoingFee = acct.ongoingMonthlyFee ?? 0;
const monthlyNet = monthlyGross * acct.payoutSplit - ongoingFee;
const totalPayouts = monthlyNet * (months - evalMonths);
```

**Step 2: Update `/payout` endpoint**

Same fix — subtract ongoing fees from funded months:
```typescript
const monthlyGross = isEval ? 0 : avgDailyPnl * tradingDaysPerMonth * numAccounts;
const ongoingFee = isEval ? 0 : (acct.ongoingMonthlyFee ?? 0) * numAccounts;
const monthlyNet = monthlyGross * acct.payoutSplit - ongoingFee;
```

**Step 3: Add tiered split modeling**

For firms with `payoutSplitTiers`, compute the effective split based on cumulative withdrawals:
```typescript
function getEffectiveSplit(acct: FirmAccountConfig, cumulativeWithdrawn: number): number {
  if (!acct.payoutSplitTiers?.length) return acct.payoutSplit;
  // Find highest tier the trader qualifies for
  let split = acct.payoutSplit;
  for (const tier of acct.payoutSplitTiers) {
    if (cumulativeWithdrawn >= tier.threshold) split = tier.split;
  }
  return split;
}
```

Apply this in the payout projection month-by-month loop.

**Step 4: Run `npx tsc --noEmit`**

Expected: Clean compile

**Step 5: Commit**

```bash
git add src/server/routes/prop-firm.ts
git commit -m "feat: model ongoing fees and tiered splits in payout projections"
```

---

## Verification Checklist

1. `npx tsc --noEmit` — zero errors
2. `npm run build` (frontend) — compiles clean
3. `python -m pytest src/engine/tests/ -x` — all pass
4. `grep -r "100.000\|100_000\|100000" src/server/ src/engine/config.py` — no capital defaults left at 100K (except test fixtures and accountTypes[100k] which are legitimate)
5. `grep -r "FIRM_LIMITS" src/server/routes/risk.ts` — gone, replaced with shared import
6. Dashboard prop firm panel shows firm name, real DD limit, dynamic balance
7. Payout projection for Apex 50K shows $85/mo ongoing fee reducing net payout
8. Payout projection for TPT shows 80% split upgrading to 90% after $5K withdrawn
9. FFN ranking shows daily loss limit as a constraint
10. Alpha ranking shows `overnightOk: false` and consistency rule 50%
11. Paper trading sessions default to $50K starting capital
12. Monte Carlo simulations default to $50K initial capital
13. Backtest engine uses $50K starting capital

---

## Future Work (Not in This Plan)

- **User settings for firm selection** — persist which firms the user actively evaluates with
- **Paper trading rule enforcement** — reject trades that violate firm overnight/weekend/contract rules
- **Consistency rule enforcement during paper trading** — track best day % in real-time
- **Multi-firm dashboard** — show multiple firm accounts simultaneously with independent DD tracking
- **Firm rule freshness** — compare code config against docs/prop-firm-rules.md automatically
- **Commission modeling in payout** — net P&L should subtract per-trade commissions per firm
