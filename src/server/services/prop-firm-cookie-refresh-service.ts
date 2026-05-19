/**
 * Prop Firm Cookie Refresh Service (Track 7)
 *
 * Daily cron at 7 AM ET (after BW refresh at 6 AM ET). Re-logs into MFFU +
 * Topstep dashboards via Playwright headless and writes fresh session cookies
 * to the env vars read by dashboard-snapshot-service.ts.
 *
 * Per-firm independence: MFFU failure does NOT cascade to Topstep.
 * Fail-CLOSED per firm: error writes audit_log + Discord critical alert.
 *
 * Env vars consumed:
 *   MFFU_USERNAME, MFFU_PASSWORD       — MFFU login credentials
 *   TOPSTEP_USERNAME, TOPSTEP_PASSWORD — Topstep login credentials
 *   MFFU_DASHBOARD_URL                 — defaults to https://app.myforexfunds.com
 *   TOPSTEP_DASHBOARD_URL              — defaults to https://trader.topstep.com
 *
 * Env vars written:
 *   MFFU_SESSION_COOKIES    — JSON cookie array for C2 snapshot service
 *   TOPSTEP_SESSION_COOKIES — JSON cookie array for C2 snapshot service
 *
 * Pipeline-pause guard: BYPASSED (safety signal — matches C1/C2/C8 pattern).
 */

import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";

interface FirmConfig {
  firmId: "mffu" | "topstep";
  loginUrl: string;
  usernameEnv: string;
  passwordEnv: string;
  cookieEnv: string;           // env var to UPDATE with fresh cookies
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  postLoginWaitMs: number;
}

// SUPPORTED FIRMS: MFFU + Topstep ONLY (per Pass 1 Track 2 constraint).
const FIRM_CONFIGS: FirmConfig[] = [
  {
    firmId: "mffu",
    loginUrl: process.env["MFFU_DASHBOARD_URL"] ?? "https://app.myforexfunds.com",
    usernameEnv: "MFFU_USERNAME",
    passwordEnv: "MFFU_PASSWORD",
    cookieEnv: "MFFU_SESSION_COOKIES",
    usernameSelector: "input[name='email'], input[type='email']",
    passwordSelector: "input[name='password'], input[type='password']",
    submitSelector: "button[type='submit']",
    postLoginWaitMs: 3_000,
  },
  {
    firmId: "topstep",
    loginUrl: process.env["TOPSTEP_DASHBOARD_URL"] ?? "https://trader.topstep.com",
    usernameEnv: "TOPSTEP_USERNAME",
    passwordEnv: "TOPSTEP_PASSWORD",
    cookieEnv: "TOPSTEP_SESSION_COOKIES",
    usernameSelector: "input[name='email'], input[type='email']",
    passwordSelector: "input[name='password'], input[type='password']",
    submitSelector: "button[type='submit']",
    postLoginWaitMs: 3_000,
  },
];

// ─── Per-firm cookie refresh status (in-memory, queried by production-status) ─

export type CookieStatus = "fresh" | "stale" | "unknown";
const _cookieStatus: Record<string, CookieStatus> = {
  mffu: "unknown",
  topstep: "unknown",
};
const _lastRefreshedAt: Record<string, Date | null> = {
  mffu: null,
  topstep: null,
};

export function getCookieStatus(): Record<string, CookieStatus> {
  return { ..._cookieStatus };
}

export function getCookieLastRefreshedAt(): Record<string, Date | null> {
  return { ..._lastRefreshedAt };
}

// ─── Single-firm refresh ──────────────────────────────────────────────────────

export interface FirmRefreshResult {
  firmId: string;
  status: "refreshed" | "skipped_no_credentials" | "skipped_playwright_unavailable" | "failed";
  error?: string;
}

async function refreshFirmCookies(firm: FirmConfig): Promise<FirmRefreshResult> {
  const username = process.env[firm.usernameEnv];
  const password = process.env[firm.passwordEnv];

  if (!username || !password) {
    logger.debug(
      { firmId: firm.firmId, envVars: [firm.usernameEnv, firm.passwordEnv] },
      "prop-firm-cookie-refresh: credentials not configured — skipping",
    );
    _cookieStatus[firm.firmId] = "unknown";
    return { firmId: firm.firmId, status: "skipped_no_credentials" };
  }

  // Lazy Playwright import — not installed in all environments
   
  let chromium: any;
  try {
    // Dynamic import avoids type dependency on @playwright/test or playwright packages
    const pw = await import("playwright" as string);
    chromium = pw.chromium;
  } catch {
    logger.warn({ firmId: firm.firmId }, "prop-firm-cookie-refresh: Playwright not available — skipping");
    _cookieStatus[firm.firmId] = "stale";
    return { firmId: firm.firmId, status: "skipped_playwright_unavailable" };
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to login page
    await page.goto(firm.loginUrl, { waitUntil: "networkidle", timeout: 30_000 });

    // Fill credentials
    await page.fill(firm.usernameSelector, username);
    await page.fill(firm.passwordSelector, password);
    await page.click(firm.submitSelector);

    // Wait for navigation to complete
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 })
      .catch(() => { /* navigation may settle without full networkidle */ });

    await page.waitForTimeout(firm.postLoginWaitMs);

    // Extract cookies
    const cookies = await context.cookies();
    const cookieJson = JSON.stringify(cookies);

    // Persist to env var (in-process — read by dashboard-snapshot-service)
    process.env[firm.cookieEnv] = cookieJson;

    _cookieStatus[firm.firmId] = "fresh";
    _lastRefreshedAt[firm.firmId] = new Date();

    await browser.close();
    logger.info({ firmId: firm.firmId, cookieCount: cookies.length }, "prop-firm-cookie-refresh: cookies refreshed");
    return { firmId: firm.firmId, status: "refreshed" };
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore close errors */ }
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    _cookieStatus[firm.firmId] = "stale";
    logger.error({ err, firmId: firm.firmId }, "prop-firm-cookie-refresh: login failed — fail-CLOSED");
    return { firmId: firm.firmId, status: "failed", error: errorMsg };
  }
}

// ─── Main sweep ───────────────────────────────────────────────────────────────

export interface CookieRefreshReport {
  results: FirmRefreshResult[];
  refreshedCount: number;
  failedCount: number;
}

/**
 * Refreshes cookies for both MFFU + Topstep independently.
 * Per-firm independence: one firm's failure never affects the other.
 * Pipeline pause guard BYPASSED (safety signal).
 */
export async function runPropFirmCookieRefresh(): Promise<CookieRefreshReport> {
  logger.info("prop-firm-cookie-refresh: starting daily cookie refresh");

  const results: FirmRefreshResult[] = [];

  // Sequential refresh — per-firm independence via isolated try/catch
  for (const firm of FIRM_CONFIGS) {
    try {
      const result = await refreshFirmCookies(firm);
      results.push(result);

      // Audit log per firm
      await db.insert(auditLog).values({
        action: "prop_firm.cookie_refreshed",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { firmId: firm.firmId } as Record<string, unknown>,
        result: { status: result.status, error: result.error ?? null } as Record<string, unknown>,
        status: result.status === "failed" ? "failed" : "success",
        correlationId: null,
      }).catch((logErr) => {
        logger.warn({ logErr, firmId: firm.firmId }, "prop-firm-cookie-refresh: audit log write failed");
      });

      if (result.status === "failed") {
        await AlertFactory.notifyCookieRefreshFailed(firm.firmId, result.error ?? "unknown");
      }
    } catch (err) {
      // Should not reach here (refreshFirmCookies catches internally), but be safe
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({ firmId: firm.firmId, status: "failed", error: errorMsg });
      await AlertFactory.notifyCookieRefreshFailed(firm.firmId, errorMsg).catch(() => {});
    }
  }

  const refreshedCount = results.filter((r) => r.status === "refreshed").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  logger.info({ refreshedCount, failedCount }, "prop-firm-cookie-refresh: sweep complete");
  return { results, refreshedCount, failedCount };
}
