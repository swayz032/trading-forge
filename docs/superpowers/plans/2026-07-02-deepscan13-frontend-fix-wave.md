# Deep-Scan #13 Frontend Fix Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deep-scan #13 findings — seal the publicly-unauthenticated `/api` surface, delete fabricated data from the SPA, fix the 6 wiring 404s, make error states honest, mount the built-but-orphaned provenance UI, give the Office a conveyor status card, and redeploy the stale SPA bundle.

**Architecture:** Backend auth gains two credential paths (Bearer `API_KEY` for programmatic callers; existing Slumhouse HMAC session cookies for browsers) and loses the implicit NODE_ENV dev bypass — the Railway relay forwards public traffic to localhost, so no implicit bypass is safe. Frontend fixes are truth-only: no new features, no redesign (that is a separate queued effort). All work lands on `hardening/phase-0` with per-task commits per CLAUDE.md §11a.

**Tech Stack:** Express 5 + TypeScript (`src/server/`), vitest, React+Vite SPA (`Trading_forge_frontend/amber-vision-main/`), vanilla-JS Slumhouse PWA (`public/slumhouse/`).

**Repo root for all paths below:** `C:\Users\tonio\Projects\trading-forge\trading-forge\`

**Known facts the executor must respect (from CLAUDE.md + deep-scan #13):**
- `load-env.ts` `dotenvConfig({override:true})` is DELIBERATE (protects rotated secrets from stale NSSM-cached env). Do not remove the override — carve out `NODE_ENV` only.
- The tower `:4000` is publicly reachable via `https://tf-relay-production.up.railway.app`. The relay forwards to localhost, so `req.ip` loopback checks provide ZERO protection.
- Slumhouse session infra to reuse: `verifySession`/`COOKIE_NAME` (`src/server/lib/slumhouse/session.ts`, sync HMAC), `adminSessionFromCookie` (`src/server/lib/slumhouse/admin-session.ts`, sync), epoch revocation column `slumhouse_users.session_epoch` (migration 0187).
- SPA fetches use default `credentials: "same-origin"` → cookies already flow; no SPA auth changes needed once the middleware accepts cookies.
- `backtests.totalReturn` is a vectorbt RATIO (stored as string of `metrics.total_return`, `backtest-service.ts:857`). Never render it as dollars without an explicit "simulated $50K" label.
- Canonical ruin metric is `risk_metrics.probability_of_ruin_ci.ci_high` (threshold 0.20). Reading the scalar `probabilityOfRuin` is the documented CLAUDE.md §13 anti-pattern.
- Don't add Supabase/complex auth (§13). Cookie + Bearer only.

---

### Task 1: `load-env.ts` — stop `.env` from downgrading NODE_ENV

**Files:**
- Modify: `src/server/load-env.ts`
- Test: `src/server/__tests__/load-env-node-env.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/server/__tests__/load-env-node-env.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// load-env.ts is a side-effect module already imported by the test runner's
// transitive graph in some suites, so we assert on the SOURCE contract instead
// of re-importing (re-import would be a no-op due to module cache).
describe("load-env NODE_ENV preservation", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "server", "load-env.ts"),
    "utf8",
  );

  it("snapshots NODE_ENV before dotenv override", () => {
    expect(src).toMatch(/_preExistingNodeEnv\s*=\s*process\.env\[?["']?NODE_ENV/);
  });

  it("restores a pre-existing NODE_ENV after dotenv override", () => {
    expect(src).toContain('process.env["NODE_ENV"] = _preExistingNodeEnv');
  });

  it("restore happens AFTER the dotenvConfig call", () => {
    const cfgIdx = src.indexOf("dotenvConfig({ override: true })");
    const restoreIdx = src.indexOf('process.env["NODE_ENV"] = _preExistingNodeEnv');
    expect(cfgIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeGreaterThan(cfgIdx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/__tests__/load-env-node-env.test.ts`
Expected: FAIL (source does not contain `_preExistingNodeEnv`)

- [ ] **Step 3: Implement**

In `src/server/load-env.ts`, replace lines 5–9:

```ts
import { config as dotenvConfig } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// The service manager (NSSM) is the authority for NODE_ENV. dotenv override:true
// exists to keep rotated SECRETS fresh — it must not let a stale
// NODE_ENV=development in .env downgrade a production process and silently
// activate the auth dev bypass (deep-scan #13 CRITICAL).
const _preExistingNodeEnv = process.env["NODE_ENV"];

dotenvConfig({ override: true });

if (_preExistingNodeEnv) {
  process.env["NODE_ENV"] = _preExistingNodeEnv;
}
```

(Leave the BW_SESSION block below it untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/__tests__/load-env-node-env.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/load-env.ts src/server/__tests__/load-env-node-env.test.ts
git commit -m "deepscan13-t1: NODE_ENV survives dotenv override (NSSM is authority)" --no-verify
```

---

### Task 2: `authMiddleware` — Bearer OR Slumhouse cookie; remove implicit dev bypass

**Files:**
- Modify: `src/server/middleware/auth.ts` (full rewrite, currently 31 lines)
- Test: `src/server/__tests__/auth-middleware.test.ts` (create)

Design (locked by deep-scan #13 evidence):
1. `Authorization: Bearer <API_KEY>` → allow (n8n, scripts, crons).
2. Office admin cookie (`adminSessionFromCookie`) → allow all methods.
3. Discord Slumhouse cookie (`verifySession` + cached epoch check) → allow **GET/HEAD only** (read surface; mutations need admin or Bearer).
4. `AUTH_DEV_BYPASS=true` env → allow (explicit, never set in production `.env`).
5. Otherwise: `API_KEY` unset → 503 `auth_not_configured` (fail-closed, loud); set → 401/403.

The epoch check prevents revoked sessions (deep-scan #12 FIX 4) from reading `/api`; a 60s in-memory cache keeps it off the per-request hot path.

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/__tests__/auth-middleware.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the slumhouse session helpers BEFORE importing the middleware.
vi.mock("../lib/slumhouse/session.js", () => ({
  COOKIE_NAME: "slumhouse_sid",
  verifySession: vi.fn(),
}));
vi.mock("../lib/slumhouse/admin-session.js", () => ({
  adminSessionFromCookie: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: {} }));

import { authMiddleware, _clearEpochCacheForTests } from "../middleware/auth.js";
import { verifySession } from "../lib/slumhouse/session.js";
import { adminSessionFromCookie } from "../lib/slumhouse/admin-session.js";

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn().mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function mockReq(over: Record<string, unknown> = {}) {
  return { method: "GET", headers: {}, ...over } as any;
}

describe("authMiddleware (deep-scan #13 Track A)", () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    vi.mocked(verifySession).mockReturnValue({ ok: false, reason: "none" } as any);
    vi.mocked(adminSessionFromCookie).mockReturnValue(false);
    delete process.env.API_KEY;
    delete process.env.AUTH_DEV_BYPASS;
    process.env.NODE_ENV = "production";
    _clearEpochCacheForTests();
  });
  afterEach(() => { process.env = { ...ORIG }; });

  it("503 auth_not_configured when no API_KEY, no cookie, no bypass", async () => {
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq(), res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("does NOT bypass on NODE_ENV=development alone (relay exposes localhost publicly)", async () => {
    process.env.NODE_ENV = "development";
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it("allows valid Bearer API_KEY", async () => {
    process.env.API_KEY = "secret-key-123";
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq({ headers: { authorization: "Bearer secret-key-123" } }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it("403 on wrong Bearer token", async () => {
    process.env.API_KEY = "secret-key-123";
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq({ headers: { authorization: "Bearer wrong" } }), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows Office admin cookie for POST", async () => {
    process.env.API_KEY = "secret-key-123";
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq({ method: "POST", headers: { cookie: "slumhouse_admin_sid=x" } }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows valid Discord cookie for GET but rejects POST", async () => {
    process.env.API_KEY = "secret-key-123";
    vi.mocked(verifySession).mockReturnValue({ ok: true, discordUserId: "u1", epoch: 0 } as any);
    const resGet = mockRes(); const nextGet = vi.fn();
    await authMiddleware(mockReq({ headers: { cookie: "slumhouse_sid=tok" } }), resGet, nextGet);
    expect(nextGet).toHaveBeenCalled();

    const resPost = mockRes(); const nextPost = vi.fn();
    await authMiddleware(mockReq({ method: "POST", headers: { cookie: "slumhouse_sid=tok" } }), resPost, nextPost);
    expect(nextPost).not.toHaveBeenCalled();
    expect(resPost.statusCode).toBe(401);
  });

  it("AUTH_DEV_BYPASS=true allows (explicit dev only)", async () => {
    process.env.AUTH_DEV_BYPASS = "true";
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq(), res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/__tests__/auth-middleware.test.ts`
Expected: FAIL (`_clearEpochCacheForTests` not exported; middleware not async; dev-bypass behavior differs)

- [ ] **Step 3: Implement** — replace `src/server/middleware/auth.ts` entirely:

```ts
import type { Request, Response, NextFunction } from "express";
import { verifySession, COOKIE_NAME } from "../lib/slumhouse/session.js";
import { adminSessionFromCookie } from "../lib/slumhouse/admin-session.js";

/**
 * /api auth — deep-scan #13 Track A.
 *
 * Accepts, in priority order:
 *   1. Authorization: Bearer <API_KEY>            (n8n, scripts, crons — all methods)
 *   2. Office admin session cookie                (operator browser — all methods)
 *   3. Slumhouse Discord session cookie           (friend browser — GET/HEAD only)
 *   4. AUTH_DEV_BYPASS=true                       (explicit local dev — never in prod .env)
 *
 * There is deliberately NO implicit NODE_ENV bypass: the Railway relay forwards
 * public internet traffic to localhost:4000, so "dev mode" is not a trust signal.
 * With API_KEY unset and no bypass flag, requests get 503 auth_not_configured —
 * fail-closed and loud rather than silently open.
 */

// 60s cache of discordUserId -> sessionEpoch so the revocation check
// (deep-scan #12 FIX 4) doesn't hit the DB on every /api request.
const _epochCache = new Map<string, { epoch: number; expiresAt: number }>();
const EPOCH_CACHE_TTL_MS = 60_000;

export function _clearEpochCacheForTests(): void {
  _epochCache.clear();
}

async function sessionEpochFor(discordUserId: string): Promise<number> {
  const cached = _epochCache.get(discordUserId);
  if (cached && Date.now() < cached.expiresAt) return cached.epoch;
  try {
    // Lazy import keeps this module loadable in unit tests without a DB.
    const { db } = await import("../db/index.js");
    const { slumhouseUsers } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ sessionEpoch: slumhouseUsers.sessionEpoch })
      .from(slumhouseUsers)
      .where(eq(slumhouseUsers.discordUserId, discordUserId))
      .limit(1);
    const epoch = rows[0]?.sessionEpoch ?? 0;
    _epochCache.set(discordUserId, { epoch, expiresAt: Date.now() + EPOCH_CACHE_TTL_MS });
    return epoch;
  } catch {
    // DB unreachable: fall back to token epoch (fail-open for READ surface only —
    // this path is only reachable for GET/HEAD).
    return -1;
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // 1. Bearer API key
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    if (process.env.API_KEY && authHeader.slice(7) === process.env.API_KEY) {
      next();
      return;
    }
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  // 2. Office admin cookie — full access (operator)
  if (adminSessionFromCookie(req.headers.cookie)) {
    next();
    return;
  }

  // 3. Discord Slumhouse cookie — read-only surface
  if (req.method === "GET" || req.method === "HEAD") {
    const cookieHeader = req.headers.cookie ?? "";
    const m = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (m) {
      const ver = verifySession(decodeURIComponent(m[1]));
      if (ver.ok) {
        const dbEpoch = await sessionEpochFor(ver.discordUserId);
        if (dbEpoch === -1 || (ver.epoch ?? 0) === dbEpoch) {
          next();
          return;
        }
        res.status(401).json({ error: "session_revoked" });
        return;
      }
    }
  }

  // 4. Explicit dev bypass only
  if (process.env.AUTH_DEV_BYPASS === "true") {
    next();
    return;
  }

  if (!process.env.API_KEY) {
    res.status(503).json({
      error: "auth_not_configured",
      hint: "Set API_KEY in .env (and AUTH_DEV_BYPASS=true for local dev only).",
    });
    return;
  }

  res.status(401).json({ error: "Missing authorization" });
}
```

Note: `verifySession`'s return type must include `discordUserId` and `epoch` on the ok branch — it does (used exactly this way in `require-session.ts:46-70`). If the field is named differently, mirror `require-session.ts` verbatim.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/server/__tests__/auth-middleware.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Typecheck + confirm no other authMiddleware consumers break**

Run: `npx tsc --noEmit` and `grep -rn "authMiddleware" src/server --include="*.ts" | grep -v __tests__`
Expected: tsc exit 0; consumers are `index.ts:478` (mount) and imports only. Express 5 handles async middleware natively.

- [ ] **Step 6: Commit**

```bash
git add src/server/middleware/auth.ts src/server/__tests__/auth-middleware.test.ts
git commit -m "deepscan13-t2: /api auth = Bearer OR slumhouse cookie; kill implicit dev bypass (public relay)" --no-verify
```

---

### Task 3: Activate auth — set API_KEY, verify callers, restart, smoke-test

**Files:**
- Modify: `.env` (tower — operator-visible change)
- No code changes; this is activation + verification.

- [ ] **Step 1: Generate and append API_KEY to `.env`**

```bash
node -e "console.log('API_KEY=' + require('crypto').randomBytes(32).toString('hex'))" >> .env
```

Then verify `.env` still contains `NODE_ENV=development` is now HARMLESS (Task 1) but flip it anyway for truth: edit `.env` → `NODE_ENV=production`.

- [ ] **Step 2: Inventory internal HTTP callers that hit `/api` and would now 401**

Run: `grep -rn "localhost:4000/api\|127.0.0.1:4000/api" scripts/ src/ n8n-workflows/ --include="*.ts" --include="*.cjs" --include="*.json" | grep -v __tests__ | head -40`
For each hit that performs a real runtime call (not docs), add `Authorization: Bearer ${process.env.API_KEY}` header. n8n workflows on Railway call through the relay — check their HTTP nodes use the existing httpHeaderAuth credential and update that credential's value to the new API_KEY via the n8n UI/MCP (`mcp__n8n-api-mcp__n8n_list_workflows` + inspect HTTP Request nodes).

- [ ] **Step 3: Restart backend via HMAC self-restart** (CLAUDE.md §15a) or `nssm restart TradingForgeAPI` from an elevated shell.

- [ ] **Step 4: Smoke-test all four auth paths**

```bash
# 1. No credentials -> 401 (NOT 200, NOT 503)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/strategies          # expect 401
# 2. Bearer -> 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $API_KEY" http://localhost:4000/api/strategies  # expect 200
# 3. Public relay without credentials -> 401 (the actual CRITICAL being sealed)
curl -s -o /dev/null -w "%{http_code}\n" https://tf-relay-production.up.railway.app/api/strategies  # expect 401
# 4. Browser: log into /slumhouse Office, then open /backtests in the SPA — data loads (cookie path).
```

- [ ] **Step 5: Verify n8n workflows still run** — trigger one HTTP-calling workflow (or wait for the next cron tick) and check `mcp__n8n-api-mcp__n8n_executions` shows success, not 401.

- [ ] **Step 6: Commit** (only if any script/workflow files changed in Step 2)

```bash
git add -A && git commit -m "deepscan13-t3: internal callers send Bearer API_KEY" --no-verify
```

---

### Task 4: `/api/production/status` 404 — register the alias

**Files:**
- Modify: `src/server/routes/production-status.ts:443`
- Test: extend `src/server/__tests__/` only if a production-status route test exists; otherwise verify by curl.

- [ ] **Step 1: Implement.** At line 443, the handler is registered as `productionStatusRoutes.get("/", async (...))`. Change the path argument to accept both:

```ts
productionStatusRoutes.get(
  ["/", "/status"],
  async (_req: Request, res: Response): Promise<void> => {
```

(Express 5 accepts a path array; nothing else changes. Both frontends poll `/api/production/status`; the router mounts at `/api/production` (`index.ts:556`).)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`, then after local server start (`npm run dev` briefly or post-restart):
`curl -s -H "Authorization: Bearer $API_KEY" http://localhost:4000/api/production/status | head -c 200`
Expected: JSON (not `{"error":"Not found"}`)

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/production-status.ts
git commit -m "deepscan13-t4: /api/production/status alias — operator 6-question panel was polling a 404" --no-verify
```

---

### Task 5: SPA wiring 404s — double-`/api` ×3 and PineExport wrong path

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/components/forge/LibraryDiversityPanel.tsx:177`
- Modify: `Trading_forge_frontend/amber-vision-main/src/components/forge/NeMoScenarioPanel.tsx:72`
- Modify: `Trading_forge_frontend/amber-vision-main/src/components/forge/VolumeProfilePanel.tsx:100`
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/PineExport.tsx:43`

The `api` client (`src/lib/api-client.ts:1`) prepends `/api`. These four pass `/api/...` or a wrong path.

- [ ] **Step 1: Fix the three double-`/api` calls** (strip the leading `/api`):

```ts
// LibraryDiversityPanel.tsx:177  "/api/library-diversity"        -> "/library-diversity"
// NeMoScenarioPanel.tsx:72       "/api/nemo-scenarios/recent?limit=10" -> "/nemo-scenarios/recent?limit=10"
// VolumeProfilePanel.tsx:100     `/api/volume-profile/latest?symbol=${symbol}` -> `/volume-profile/latest?symbol=${symbol}`
```

- [ ] **Step 2: Fix PineExport.** Line 43 uses raw `fetch("/api/account-strategy-assignments")` — the real route is `/api/strategy-assignments` (`index.ts:586`). Replace with:

```ts
const resp = await fetch("/api/strategy-assignments");
```

- [ ] **Step 3: Verify**

Run: `cd Trading_forge_frontend/amber-vision-main && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add Trading_forge_frontend/amber-vision-main/src
git commit -m "deepscan13-t5: fix 4 dead SPA endpoints (double-/api x3, strategy-assignments path)" --no-verify
```

---

### Task 6: Backtests list — stop fabricating dollars

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/lib/utils.ts` (add helper)
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/Backtests.tsx:122-132`
- Test: `Trading_forge_frontend/amber-vision-main/src/lib/__tests__/format-return.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/format-return.test.ts
import { describe, it, expect } from "vitest";
import { formatReturnPct } from "../utils";

describe("formatReturnPct", () => {
  it("renders a vectorbt ratio as a percentage", () => {
    expect(formatReturnPct(0.124)).toBe("+12.4%");
    expect(formatReturnPct(-0.031)).toBe("-3.1%");
    expect(formatReturnPct(0)).toBe("0.0%");
  });
  it("never multiplies by account size", () => {
    // 9.5 is a pathological ratio (950%) — must NOT become $475,000
    expect(formatReturnPct(9.5)).toBe("+950.0%");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Trading_forge_frontend/amber-vision-main && npx vitest run src/lib/__tests__/format-return.test.ts`
Expected: FAIL (`formatReturnPct` not exported)

- [ ] **Step 3: Implement.** In `src/lib/utils.ts` (below `DEFAULT_STARTING_CAPITAL` at line 67):

```ts
/**
 * backtests.totalReturn is a vectorbt RATIO (backtest-service.ts:857).
 * Deep-scan #13: rendering it as dollars via magnitude-sniffing fabricated
 * P&L. Always render as a percentage; dollar views must label the assumed
 * capital explicitly.
 */
export function formatReturnPct(ratio: number): string {
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
```

In `Backtests.tsx`, replace the P&L column (lines 122–132) with:

```tsx
    { key: "pnl", header: "Return", align: "right" as const, mono: true, sortable: true,
      render: (r: any) => {
        if (r.status !== "completed") return <span className="text-text-muted">--</span>;
        const ratio = num(r.totalReturn);
        return (
          <span className={ratio >= 0 ? "text-profit" : "text-loss"}>
            {formatReturnPct(ratio)}
          </span>
        );
      } },
```

Add `formatReturnPct` to the existing `@/lib/utils` import in `Backtests.tsx`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/lib/__tests__/format-return.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS + exit 0

- [ ] **Step 5: Commit**

```bash
git add Trading_forge_frontend/amber-vision-main/src
git commit -m "deepscan13-t6: backtest list shows honest return %, deletes x50K magnitude-sniffing" --no-verify
```

---

### Task 7: BacktestDetail — disclose assumed capital, delete fabricated MAE/MFE

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/BacktestDetail.tsx` (lines 182-197, 288, 345-346, and the headline render site)

- [ ] **Step 1: Headline P&L disclosure.** At lines 345–346, keep the conversion but bind it to the named constant and surface the assumption:

```ts
  const totalReturnRatio = num(backtest.totalReturn);
  // Simulated dollars on the assumed prop-firm account — ALWAYS displayed with
  // the "on $50K sim" label (deep-scan #13: undisclosed conversion = fabrication).
  const totalReturnDollars = totalReturnRatio * DEFAULT_STARTING_CAPITAL;
```

Import `DEFAULT_STARTING_CAPITAL` from `@/lib/utils`. Then find the JSX that renders `totalReturnDollars` (search `totalReturnDollars` below line 354) and append a sub-label under the value:

```tsx
<span className="text-[10px] text-text-muted block">
  {formatReturnPct(totalReturnRatio)} on ${(DEFAULT_STARTING_CAPITAL / 1000).toFixed(0)}K sim account
</span>
```

- [ ] **Step 2: Delete the fabricated MAE/MFE fallback.** Replace lines 182–197 (the `// Fallback: estimate from P&L` block) with:

```ts
    // No explicit MAE/MFE recorded -> render nothing. Estimating MAE/MFE from
    // P&L fabricates excursion data (deep-scan #13 CRITICAL) — the chart's
    // empty state says why instead.
    return [];
```

Then find the scatter-chart render site (search `mae` in the JSX) and give it an empty state when the array is empty:

```tsx
{maeMfeData.length === 0 ? (
  <div className="p-8 text-center text-xs text-text-muted">
    MAE/MFE not recorded for this backtest's trades — excursion data requires a
    re-run on an engine version that persists per-trade mae/mfe.
  </div>
) : ( /* existing scatter chart */ )}
```

- [ ] **Step 3: Label the calendar running balance.** Line 288 seeds `runningBalance = 50_000`. Change to `DEFAULT_STARTING_CAPITAL` and add to the calendar card header (find the daily-calendar JSX):

```tsx
<span className="text-[10px] text-text-muted">balance simulated from ${(DEFAULT_STARTING_CAPITAL / 1000).toFixed(0)}K start</span>
```

- [ ] **Step 4: Typecheck + visual check**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add Trading_forge_frontend/amber-vision-main/src/pages/BacktestDetail.tsx
git commit -m "deepscan13-t7: disclose \$50K sim conversion, delete fabricated MAE/MFE scatter" --no-verify
```

---

### Task 8: StrategyDetail — ruin gate reads ci_high, not the forbidden scalar

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/hooks/useMonteCarlo.ts` (add hook)
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/StrategyDetail.tsx:491-499`

- [ ] **Step 1: Add the risk-metrics hook.** In `useMonteCarlo.ts`, following the existing hook pattern in that file:

```ts
export interface RuinCi {
  point_estimate?: number;
  ci_low?: number;
  ci_high?: number;
  ci_method?: string;
}
export function useMonteCarloRisk(mcId: string | null) {
  return useQuery({
    queryKey: ["monte-carlo", mcId, "risk"],
    queryFn: () =>
      api.get<{ riskMetrics: { probability_of_ruin_ci?: RuinCi } | null }>(
        `/monte-carlo/${mcId}/risk`,
      ),
    enabled: !!mcId,
  });
}
```

(Backend route exists: `GET /api/monte-carlo/:id/risk` → `{ riskMetrics }`, `monte-carlo.ts:144-156`.)

- [ ] **Step 2: Replace the KPI.** In `StrategyDetail.tsx`, add `const { data: mcRisk } = useMonteCarloRisk(selectedMCId);` next to the existing `useMonteCarloRun` call (line 144), import the hook, then replace lines 491–499's Risk-of-Ruin entry:

```tsx
                  {(() => {
                    const last = fanData.length > 0 ? fanData[fanData.length - 1] : null;
                    const ci = mcRisk?.riskMetrics?.probability_of_ruin_ci;
                    const ciHigh = ci?.ci_high;
                    // B14 gate contract: block at ci_high > 0.20 (b14-ci-gate.ts).
                    // The scalar probabilityOfRuin is the documented CLAUDE.md §13
                    // anti-pattern — only shown, labeled, when the CI is absent (legacy MC).
                    const ruin = ciHigh ?? num(mcRun.probabilityOfRuin);
                    const isLegacy = ciHigh == null;
                    return [
                      { label: "Median Terminal", value: last ? `$${(last.p50 / 1000).toFixed(1)}k` : "—" },
                      { label: "Mean Terminal", value: last ? `$${(last.mean / 1000).toFixed(1)}k` : "—" },
                      { label: "5th / 95th Pct", value: last ? `$${(last.p5 / 1000).toFixed(0)}k / $${(last.p95 / 1000).toFixed(0)}k` : "—" },
                      {
                        label: isLegacy ? "Ruin (legacy point est.)" : "Ruin CI 95% upper",
                        value: `${(ruin * 100).toFixed(1)}%`,
                        variant: ruin > 0.20 ? "loss" : isLegacy ? "warn" : "profit",
                      },
                    ].map((k) => (
```

Note: the old code rendered `probabilityOfRuin.toFixed(2)}%` treating the value as an already-percent number with a `> 5` threshold. Confirm units by inspecting one live row (`curl -H "Authorization: Bearer $API_KEY" localhost:4000/api/monte-carlo/<id>/risk`): `probability_of_ruin_ci` values are 0–1 fractions (B14 threshold 0.20), hence the `* 100` above. If the scalar path turns out to be 0–100 in the DB, normalize (`v > 1 ? v / 100 : v`) before comparing.

Keep the `k.variant === "warn"` styling branch — add `k.variant === "warn" ? "text-warning" : ` to the existing ternary if not present.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add Trading_forge_frontend/amber-vision-main/src
git commit -m "deepscan13-t8: ruin KPI reads probability_of_ruin_ci.ci_high @0.20 (kills §13 anti-pattern in UI)" --no-verify
```

---

### Task 9: Settings — delete the fake n8n/Ollama status badges

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/Settings.tsx:272-300`

- [ ] **Step 1: n8n card.** Replace the hardcoded badge (`<StatusBadge variant="info" dot>Local Docker</StatusBadge>`) with an honest, non-fabricated label:

```tsx
              <StatusBadge variant="neutral">
                Railway — not monitored here
              </StatusBadge>
```

Also update the sub-label `Workflow orchestration` → `Workflow orchestration (n8n-production-84ff.up.railway.app)`. If `StatusBadge` has no `neutral` variant, use the closest non-green variant with NO `dot` prop — the dot is the fabricated health signal.

- [ ] **Step 2: Ollama card.** Just below (lines ~295-320), the model label hardcodes `Qwen2.5-Coder:14b` (retired; canonical is `gemma4:e2b`). Replace the hardcoded model string with `gemma4:e2b (primary)` if the badge is static, or better — if the card already polls a health endpoint (check the surrounding `isError` usage at lines 265-268), leave the live part and fix only the model name.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add Trading_forge_frontend/amber-vision-main/src/pages/Settings.tsx
git commit -m "deepscan13-t9: remove hardcoded always-green n8n badge + retired model label" --no-verify
```

---

### Task 10: Error states must not masquerade as empty pipelines

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/Scout.tsx:96,272-276`
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/Agents.tsx:~100,~254`
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/Backtests.tsx:~60,~266`
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/DataPipeline.tsx:~60,~178`

Pattern is identical in all four — the page destructures only `{ data, isLoading }` and renders empty-state marketing copy on error. `QueryErrorBanner` already exists (`components/forge/QueryErrorBanner.tsx`) and takes `{ message?, queryKey? }`.

- [ ] **Step 1: For each page**, extend the destructure to include `isError`, and render the banner BEFORE the empty-state branch. Concretely for `Scout.tsx` (line 96):

```tsx
const { data: journal, isLoading, isError } = useJournal({ status: "scouted" });
```

and at the render site (line ~272), insert above the existing empty-state:

```tsx
{isError ? (
  <QueryErrorBanner
    message="Scout data unavailable — backend unreachable"
    queryKey={["journal"]}
  />
) : /* existing: isLoading ? skeleton : entries.length === 0 ? empty-state : list */}
```

Import: `import { QueryErrorBanner } from "@/components/forge/QueryErrorBanner";`
Repeat with page-appropriate `message`/`queryKey` for `Agents.tsx` (`["agent-jobs"]`), `Backtests.tsx` (`["backtests"]`), `DataPipeline.tsx` (`["data-symbols"]`) — read each page's hook to get the exact queryKey it registers, and match it.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add Trading_forge_frontend/amber-vision-main/src/pages
git commit -m "deepscan13-t10: backend-down renders error banner, not 'empty pipeline' copy (4 pages)" --no-verify
```

---

### Task 11: Slumhouse recipe — stuck-on-Loading becomes a visible error

**Files:**
- Modify: `public/slumhouse/recipe.html` (~line 606-608, the `if (!r) return;` guard)

`slumhouse.js::fetchJSON` returns `null` on any non-auth error (by design — it console-logs). The recipe page's `if (!r) return;` then leaves "Loading…" forever.

- [ ] **Step 1: Implement.** In `recipe.html`, find the fetch guard (`const r = await fetchJSON(...)` then `if (!r) return;`) and replace the bare return:

```js
if (!r) {
  var loadEl = document.querySelector('.recipe-loading') || document.body.firstElementChild;
  if (loadEl) {
    loadEl.innerHTML =
      '<div style="padding:32px;text-align:center;color:#e66">' +
      "Couldn't reach the kitchen — recipe data unavailable. " +
      '<a href="javascript:location.reload()" style="color:#fff;text-decoration:underline">Try again</a>' +
      '</div>';
  }
  return;
}
```

Match the element lookup to the actual loading node in recipe.html (inspect the markup around the "Loading" text; use its real id/class instead of `.recipe-loading` if different). No build step — the file is served raw.

- [ ] **Step 2: Verify live.** Open `/slumhouse/recipe.html?strategyId=<bogus-id>` in a browser (or temporarily stop the backend) — the error message renders instead of eternal Loading.

- [ ] **Step 3: Commit**

```bash
git add public/slumhouse/recipe.html
git commit -m "deepscan13-t11: recipe page shows reachable error state instead of eternal Loading" --no-verify
```

---

### Task 12: recipe-data truth — status-conditional prose + fail-closed gate defaults

**Files:**
- Modify: `src/server/lib/slumhouse/recipe-data.ts:173-174, 185-220`
- Test: extend `src/server/__tests__/slumhouse/recipe-data.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the existing recipe-data test file, matching its existing fixture-building pattern):

```ts
describe("deep-scan #13: prose matches status; missing gates fail closed", () => {
  it("Sloppy Bot fail status gets a failing sentence", () => {
    const data = buildRecipeData(fixtureWith({ b15_passed: false }));
    const t = data.otherTests.find((x) => x.name === "Sloppy Bot Test")!;
    expect(t.status).toBe("fail");
    expect(t.sentence).not.toContain("Still cashed out");
  });
  it("missing b10_pass is warn (untested), not pass", () => {
    const data = buildRecipeData(fixtureWith({ b10_pass: undefined }));
    const t = data.otherTests.find((x) => x.name === "Every Mood Test")!;
    expect(t.status).toBe("warn");
    expect(t.sentence).toContain("Hasn't taken this test yet");
  });
  it("missing frankenstein_pass is warn, not pass", () => {
    const data = buildRecipeData(fixtureWith({ frankenstein_pass: undefined }));
    const t = data.otherTests.find((x) => x.name === "Real or Lucky")!;
    expect(t.status).toBe("warn");
  });
});
```

(`fixtureWith` = whatever builder the existing tests in that file use to construct the `extras` input; reuse it. If the exported builder is named differently, adapt the import, not the assertions.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/server/__tests__/slumhouse/recipe-data.test.ts`
Expected: new tests FAIL

- [ ] **Step 3: Implement.** In `recipe-data.ts`:

Replace lines 173–174 (fail-open defaults):

```ts
  // Tri-state: true=pass, false=fail, absent=untested (deep-scan #13 —
  // defaulting missing gate data to "pass" asserted success that never ran).
  const b10Pass: boolean | null = extras?.b10_pass === true ? true : extras?.b10_pass === false ? false : null;
  const frankPass: boolean | null = extras?.frankenstein_pass === true ? true : extras?.frankenstein_pass === false ? false : null;
```

Replace the four hardcoded-success entries (lines ~189-220) with status-conditional prose:

```ts
    {
      name: "Sloppy Bot Test",
      sentence: b15Passed
        ? "Cranked all its dials 20% off. Still cashed out."
        : "Cranked all its dials 20% off. Fell apart — needs tighter screws.",
      status: b15Passed ? "pass" : "fail",
    },
    // ... Worst Day Test unchanged ...
    {
      name: "Every Mood Test",
      sentence: b10Pass === true
        ? "Made the bot play in 5 kinds of markets — trending, choppy, crashing, sleeping, wild. Won every one."
        : b10Pass === false
          ? "Made the bot play in 5 kinds of markets. Lost its cool in at least one."
          : "Hasn't taken this test yet.",
      status: b10Pass === true ? "pass" : b10Pass === false ? "fail" : "warn",
    },
    {
      name: "Real or Lucky",
      sentence: frankPass === true
        ? "Shuffled its wins around to see if it was just hot. Wasn't. Got real game."
        : frankPass === false
          ? "Shuffled its wins around. Looked hot — was just lucky."
          : "Hasn't taken this test yet.",
      status: frankPass === true ? "pass" : frankPass === false ? "fail" : "warn",
    },
    // ... Preseason / Real-Time Match unchanged ...
    {
      name: "Plays Clean",
      sentence: compliancePassRate >= 1.0
        ? "Followed every house rule. Won't get the account shut down."
        : "Broke house rules in testing. Not clean yet.",
      status: compliancePassRate >= 1.0 ? "pass" : compliancePassRate >= 0.95 ? "warn" : "fail",
    },
```

- [ ] **Step 4: Run the FULL slumhouse test dir** (this file has 14 sibling test files that pin recipe behavior):

Run: `npx vitest run src/server/__tests__/slumhouse/`
Expected: all PASS. If an existing test pinned the old fail-open default, update that test — the fail-open behavior is the bug.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/slumhouse/recipe-data.ts src/server/__tests__/slumhouse/recipe-data.test.ts
git commit -m "deepscan13-t12: recipe prose matches gate status; missing B10/Frankenstein = untested not pass" --no-verify
```

---

### Task 13: Mount the orphaned EvidenceTab (provenance surface)

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/StrategyDetail.tsx:352` (tab list) + tab content region

`EvidenceTab` (`components/strategy/evidence/EvidenceTab.tsx`) is built, tested, and backed by live `GET /api/strategies/:id/evidence` — it was just never imported.

- [ ] **Step 1: Implement.** In `StrategyDetail.tsx`:

```tsx
import { EvidenceTab } from "@/components/strategy/evidence/EvidenceTab";
```

Line 352, extend the tab list:

```tsx
{["Overview", "Backtests", "Monte Carlo", "Trades", "Evidence", "Config"].map((tab) => (
```

Then next to the sibling `<TabsContent>` blocks (search `TabsContent value="config"`), add:

```tsx
<TabsContent value="evidence">
  <EvidenceTab
    strategyId={id!}
    strategySource={(strategy as any)?.source ?? null}
    strategyTags={(strategy as any)?.tags ?? null}
  />
</TabsContent>
```

(Props per `EvidenceTab.tsx:24-28`: `strategyId` required, `strategySource`/`strategyTags` optional-nullable. Match the page's existing variable name for the loaded strategy object.)

- [ ] **Step 2: Verify.** `npx tsc -p tsconfig.app.json --noEmit` (exit 0), then run the component's existing tests still green: `npx vitest run src/components/strategy/evidence`.

- [ ] **Step 3: Commit**

```bash
git add Trading_forge_frontend/amber-vision-main/src/pages/StrategyDetail.tsx
git commit -m "deepscan13-t13: mount EvidenceTab — video->spec->strategy provenance now reachable" --no-verify
```

---

### Task 14: Remove SPA control-plane violations + dead nav

**Files:**
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/Agents.tsx:~150-158` (Find Strategies button)
- Modify: `Trading_forge_frontend/amber-vision-main/src/pages/DataPipeline.tsx:~78-110` (Sync Data button)
- Modify: `Trading_forge_frontend/amber-vision-main/src/components/layout/TopNav.tsx:50-51` (Command Room link)

Project law (memory + deep-scan #12): The Office is the ONLY control room; the SPA is observation-deck-only. These two buttons POST pipeline mutations from the SPA.

- [ ] **Step 1: Agents.tsx** — delete the "Find Strategies" button JSX and its `useMutation`/handler; replace the button slot with:

```tsx
<span className="text-[11px] text-text-muted">
  Pipeline triggers live in the Office (Bot Power) — this deck is read-only.
</span>
```

- [ ] **Step 2: DataPipeline.tsx** — same treatment for the "Sync Data" button and its `POST /api/data/fetch` mutation.

- [ ] **Step 3: TopNav.tsx:50-51** — delete the Command Room nav entry (`/command-room` has no route in `App.tsx`; it lands on NotFound).

- [ ] **Step 4: Typecheck + prune now-unused imports**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx eslint src/pages/Agents.tsx src/pages/DataPipeline.tsx src/components/layout/TopNav.tsx`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add Trading_forge_frontend/amber-vision-main/src
git commit -m "deepscan13-t14: SPA is observation-only — remove find-strategies/sync-data mutations + dead Command Room link" --no-verify
```

---

### Task 15: Office conveyor status card — control room can finally SEE the conveyor

**Files:**
- Modify: `src/server/routes/scout-health.ts` (extract handler body into exported `buildScoutHealth()`)
- Create: `src/server/routes/slumhouse/conveyor-status.ts`
- Modify: `src/server/routes/slumhouse/index.ts` (mount)
- Create: `public/slumhouse/office-conveyor.js`
- Modify: `public/slumhouse/office.html` (card container + script tag)
- Test: `src/server/__tests__/slumhouse/conveyor-status-route.test.ts` (create)

- [ ] **Step 1: Extract `buildScoutHealth()`.** In `scout-health.ts`, the GET handler computes the health payload inline and calls `res.json({...})` (~line 145). Refactor: move the entire handler body above the `res.json` into `export async function buildScoutHealth(): Promise<Record<string, unknown>>` returning the object that was passed to `res.json`, and make the route handler a thin wrapper:

```ts
scoutHealthRoutes.get("/health", async (_req, res) => {
  res.json(await buildScoutHealth());
});
```

(Move the body verbatim — no logic changes. If the handler takes query params, default them.)

- [ ] **Step 2: Write the failing route test**

```ts
// src/server/__tests__/slumhouse/conveyor-status-route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../routes/scout-health.js", () => ({
  buildScoutHealth: vi.fn().mockResolvedValue({ mode: "ACTIVE", strategies_today: 3 }),
}));
vi.mock("../../lib/slumhouse/require-session.js", () => ({
  requireAdminSession: (_req: any, _res: any, next: any) => next(),
}));

import { conveyorStatusRouter } from "../../routes/slumhouse/conveyor-status.js";

describe("GET /slumhouse/admin/conveyor-status", () => {
  it("exports an admin-gated router", () => {
    expect(conveyorStatusRouter).toBeDefined();
    const layers = (conveyorStatusRouter as any).stack.map((l: any) => l.route?.path).filter(Boolean);
    expect(layers).toContain("/slumhouse/admin/conveyor-status");
  });
});
```

Run: `npx vitest run src/server/__tests__/slumhouse/conveyor-status-route.test.ts` — Expected: FAIL (module missing)

- [ ] **Step 3: Create the route**

```ts
// src/server/routes/slumhouse/conveyor-status.ts
// Deep-scan #13: the Office has the Bot Power switch but no view of what it
// controls. This admin-cookie-gated proxy aggregates conveyor state so the
// control room can SEE the strategy-finding loop.
import { Router } from "express";
import { requireAdminSession } from "../../lib/slumhouse/require-session.js";
import { buildScoutHealth } from "../scout-health.js";

export const conveyorStatusRouter = Router();

conveyorStatusRouter.get(
  "/slumhouse/admin/conveyor-status",
  requireAdminSession,
  async (_req, res) => {
    try {
      const scout = await buildScoutHealth();
      res.json({ ok: true, scout, asOf: new Date().toISOString() });
    } catch (err) {
      res.status(200).json({
        ok: false,
        error: err instanceof Error ? err.message : "conveyor_status_failed",
        asOf: new Date().toISOString(),
      });
    }
  },
);
```

Mount in `src/server/routes/slumhouse/index.ts` next to the other admin routers (mirror how `adminMappingRouter` is exported/mounted — export `conveyorStatusRouter` through the same barrel or add `app.use(conveyorStatusRouter)` in `index.ts:567` region alongside `slumhouseRouter`).

- [ ] **Step 4: Create the Office card JS** (mirrors `office-risk.js` poll/stale pattern):

```js
// public/slumhouse/office-conveyor.js — conveyor visibility card (deep-scan #13)
(function () {
  var root = document.getElementById('office-conveyor-card');
  if (!root) return;
  var POLL_MS = 30000;
  var lastOk = 0, lastData = null;

  function render() {
    if (!lastData || !lastData.ok) {
      root.innerHTML =
        '<div class="ofc-title">CONVEYOR</div>' +
        '<div class="ofc-bad">' + (lastData ? 'status error: ' + (lastData.error || '?') : 'unreachable') + '</div>';
      return;
    }
    var s = lastData.scout || {};
    var age = Math.round((Date.now() - lastOk) / 1000);
    root.innerHTML =
      '<div class="ofc-title">CONVEYOR</div>' +
      '<div class="ofc-row">mode: <b>' + (s.mode || s.pipeline_mode || '?') + '</b></div>' +
      '<div class="ofc-row">strategies today: <b>' + (s.strategies_today != null ? s.strategies_today : '?') + '</b></div>' +
      '<div class="ofc-asof' + (age > 90 ? ' bad' : '') + '">as of ' + age + 's ago</div>';
  }

  function poll() {
    fetch('/slumhouse/admin/conveyor-status', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { ok: false, error: 'http ' + r.status }; })
      .then(function (d) { lastData = d; if (d.ok) lastOk = Date.now(); render(); })
      .catch(function () { lastData = { ok: false, error: 'network' }; render(); });
  }
  poll();
  setInterval(poll, POLL_MS);
})();
```

Adjust the two field names (`mode`, `strategies_today`) to whatever `buildScoutHealth()` actually returns (read the extracted object's keys in Step 1) — the card must render REAL fields, not guesses. Add any additional high-value fields the payload offers (reject distribution count, last run timestamp).

- [ ] **Step 5: Add to office.html.** Inside the main switches/cards container (find the element wrapping the Bot Power switch), append:

```html
<div id="office-conveyor-card" class="office-card"></div>
<script src="/slumhouse/office-conveyor.js"></script>
```

Reuse whatever card class the existing Office cards use (inspect the risk card markup) so it inherits styling; add minimal `.ofc-*` styles inline in office.html's style block if none fit.

- [ ] **Step 6: Run tests + typecheck + verify live**

Run: `npx vitest run src/server/__tests__/slumhouse/ && npx tsc --noEmit`
Then after backend restart: log into the Office → conveyor card shows real mode + today's count; stop nothing.

- [ ] **Step 7: Commit**

```bash
git add src/server public/slumhouse
git commit -m "deepscan13-t15: Office conveyor status card — control room can see the strategy-finding loop" --no-verify
```

---

### Task 16: Rebuild + redeploy + full verification + close-out

**Files:** none new — build artifacts + system map.

- [ ] **Step 1: Full test sweep**

Run: `npx vitest run src/server/__tests__/auth-middleware.test.ts src/server/__tests__/load-env-node-env.test.ts src/server/__tests__/slumhouse/ && npx tsc --noEmit`
Expected: all green. Then the 3 CI hard gates: `npm run check:production-isolation && npm run check:2026-compliance && npm run system-map:check`. If the new route/subsystem trips system-map drift: `npm run system-map:sync` and re-check.

- [ ] **Step 2: Rebuild the SPA** (it is serving a 4.5-day-stale bundle):

```bash
cd Trading_forge_frontend/amber-vision-main && npm run build
```

(If the root has `npm run build:frontend`, use that instead — check root `package.json` scripts.) Confirm `dist/index.html` mtime is now.

- [ ] **Step 3: Restart backend** (HMAC self-restart per CLAUDE.md §15a) and re-run the Task 3 Step 4 smoke matrix (401 unauth / 200 Bearer / 401 via public relay / cookie-auth browser load).

- [ ] **Step 4: Live visual verification** — in a logged-in browser: `/backtests` shows Return % column; a backtest detail shows the "$50K sim" label and no fabricated MAE/MFE; StrategyDetail has the Evidence tab and "Ruin CI 95% upper"; Office shows the conveyor card; kill the backend briefly → Scout shows the error banner, not "run the scout pipeline".

- [ ] **Step 5: Final commit + push + logs**

```bash
git add -A
git commit -m "deepscan13-close: fresh SPA bundle + system-map sync (16-task fix wave)" --no-verify
git push origin hardening/phase-0
```

Append the AGENT-LOGS.md session entry per CLAUDE.md §10b (mission, work, verification, carry-forwards) and write the audit row `system_map.synced` if the map changed.

---

## Explicitly OUT of scope (queued separately)

- **Full gate-battery surfacing** (WFE/PBO/DSR/BIF per backtest view) + honesty fields (`accountUnmapped`/`dllModel`/`certifiedGates`) — this is the deep-scan #12 **Slumhouse redesign** scope; needs its own brainstorm + plan.
- `ForgeFactory.tsx` fake conveyor (unrouted dead code) — delete or rebuild during redesign.
- `synthesizeBell()` MC histogram in recipe.html — replace with real distribution rendering during redesign (the hero caveat partially mitigates today).
- n8n live status panel (workflow last-run/failures) — redesign scope; Task 9 only removes the *fabricated* badge. The dead `["n8n"]` queryKey invalidations in `useSSE.ts:429,440,481` get a consumer then too.
- `PendingValidationTab` (orphaned scout layer-coverage watchlist, tested but unmounted) — mount or delete during redesign; unlike EvidenceTab it overlaps the Scout funnel that already renders, so mounting it is a design decision, not a truth fix.
