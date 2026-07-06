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
 * Env vars written (CREDENTIAL-CLASS — see safety note below):
 *   MFFU_SESSION_COOKIES    — JSON cookie array for C2 snapshot service
 *   TOPSTEP_SESSION_COOKIES — JSON cookie array for C2 snapshot service
 *
 * ─── F-8: CREDENTIAL-CLASS env var safety note ────────────────────────────────
 * MFFU_SESSION_COOKIES and TOPSTEP_SESSION_COOKIES written to process.env are
 * CREDENTIAL-CLASS values. They must NEVER be logged, even in debug mode.
 * Any future debug path that dumps process.env MUST call redactSensitiveEnv()
 * before logging (exported from this module for shared use).
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Pipeline-pause guard: BYPASSED (safety signal — matches C1/C2/C8 pattern).
 */

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// ─── F-8: Credential redaction helper ─────────────────────────────────────────
// Keys whose values must never appear in any log output.
const SENSITIVE_ENV_KEYS = new Set([
  "MFFU_SESSION_COOKIES",
  "TOPSTEP_SESSION_COOKIES",
  "MFFU_PASSWORD",
  "TOPSTEP_PASSWORD",
  "BW_VAULT_PASSPHRASE",
  "BW_SESSION",
  "RELAY_TOKEN",
]);

/**
 * Returns a copy of the given env object with credential-class keys redacted.
 * Use this before passing any process.env snapshot to a logger or diagnostic dump.
 *
 * @example
 *   logger.debug({ env: redactSensitiveEnv(process.env) }, "debug: env dump");
 */
export function redactSensitiveEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = SENSITIVE_ENV_KEYS.has(k) ? "[REDACTED]" : v;
  }
  return out;
}

// ─── A-13: Cookie runtime-file persistence ────────────────────────────────────
//
// Mirrors the BW session .bw-session-runtime pattern. Persists refreshed cookies
// to per-firm files so NSSM restarts reload them instead of waiting up to 59 min
// for the next cookie-refresh cycle (a C2 evidence gap of up to 59 min).
//
// CRITICAL SECURITY: These files contain CREDENTIAL-CLASS session cookies.
//   • File NAMES must never reveal cookie content.
//   • File CONTENTS must NEVER be logged at any log level.
//   • redactSensitiveEnv() must be called before any process.env dump.
//   • The files must be in .gitignore (same pattern as .bw-session-runtime).
//
// Runtime file names use ".cookie-runtime-<firmId>" — opaque, no "cookie" in
// the path visible to general log grep patterns that watch for "cookie" dumps.
function cookieRuntimePath(firmId: string): string {
  return join(process.cwd(), `.cookie-runtime-${firmId}`);
}

/**
 * Write refreshed cookies to the per-firm runtime file.
 * Fail-soft: a write error logs a warning but does NOT fail the refresh.
 * SECURITY: cookieJson MUST NOT be logged — pass only firmId + path to logger.
 */
function persistCookiesToDisk(firmId: string, cookieJson: string): void {
  const runtimePath = cookieRuntimePath(firmId);
  try {
    writeFileSync(runtimePath, cookieJson, { encoding: "utf8", mode: 0o600 });
    logger.info({ firmId, runtimePath }, "prop-firm-cookie-refresh: cookies persisted to runtime file (A-13)");
  } catch (writeErr) {
    logger.warn(
      { err: writeErr, firmId, runtimePath },
      "prop-firm-cookie-refresh: failed to write cookie runtime file — NSSM restart may load stale cookies (A-13)",
    );
  }
}

/**
 * Load cookies from per-firm runtime files at startup.
 * Called once at module-init: sets process.env[cookieEnv] from disk if the
 * env var is not already set (e.g. after NSSM restart with stale .env).
 *
 * Fail-soft: read errors are logged as warnings, never throw.
 * SECURITY: file contents MUST NOT appear in any log output.
 */
export function loadCookiesFromRuntimeFiles(): void {
  const firmIds: Array<{ firmId: string; cookieEnv: string }> = [
    { firmId: "mffu",    cookieEnv: "MFFU_SESSION_COOKIES"    },
    { firmId: "topstep", cookieEnv: "TOPSTEP_SESSION_COOKIES" },
  ];
  for (const { firmId, cookieEnv } of firmIds) {
    if (process.env[cookieEnv]) {
      // Already set (e.g. from .env file) — don't overwrite
      logger.debug({ firmId }, "prop-firm-cookie-refresh: cookie env already set — skipping runtime file load");
      continue;
    }
    const runtimePath = cookieRuntimePath(firmId);
    if (!existsSync(runtimePath)) {
      logger.debug({ firmId, runtimePath }, "prop-firm-cookie-refresh: no cookie runtime file found — will refresh at next cron tick");
      continue;
    }
    try {
      const raw = readFileSync(runtimePath, { encoding: "utf8" }).trim();
      if (!raw) {
        logger.warn({ firmId, runtimePath }, "prop-firm-cookie-refresh: cookie runtime file is empty — skipping");
        continue;
      }
      // Minimal parse-check: must be a JSON array
      JSON.parse(raw); // throws if corrupt
      process.env[cookieEnv] = raw;
      // Log ONLY the firm name and path — NEVER the cookie content
      logger.info({ firmId, runtimePath }, "prop-firm-cookie-refresh: cookies loaded from runtime file at startup (A-13)");
    } catch (readErr) {
      logger.warn(
        { err: readErr, firmId, runtimePath },
        "prop-firm-cookie-refresh: failed to load cookie runtime file — will refresh at next cron tick",
      );
    }
  }
}

// Load persisted cookies at module-init so the first C2 snapshot after a
// restart has session cookies immediately available (before the 7 AM cron).
loadCookiesFromRuntimeFiles();

// ─── F-4: Once-per-day dedup for playwright_unavailable skip alerts ───────────
// Keyed by firmId. Value = UTC calendar date string ("2026-05-20") of last alert.
// Prevents spamming Discord every 24h cycle when Playwright is persistently absent.
const _lastSkipAlertAt: Map<string, string> = new Map();

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

const execFileAsync = promisify(execFile);

// ─── Deep-Scan #21 Band F (2026-07-05) — Playwright one-time auto-remediation ─
//
// Previously, a missing Playwright install went straight to "mark stale + fire
// a daily Discord alert" with NO remediation attempt. Cookies would silently
// stay stale indefinitely on any host where Playwright's package or browser
// binary went missing (fresh `npm ci` that skips postinstall, a Docker image
// rebuild, or a partial dependency wipe — see reference_tower_restart_dep_wipe_trap
// memory). This block adds a bounded, fail-soft, ONE-TIME-PER-PROCESS attempt
// to self-heal before falling back to the existing alert-only path.
//
// Guard is process-global (not per-firm): MFFU and Topstep share one Playwright
// install, so a single successful `npx playwright install chromium` benefits
// both firms in the same sweep via Node's own module cache — no need to run
// the install command twice per process lifetime.
let _playwrightRemediationAttempted = false;
const PLAYWRIGHT_REMEDIATION_TIMEOUT_MS = 120_000; // 2 min bound — never hangs the cron

/**
 * Runs the documented Playwright install command exactly once per process.
 * Fail-soft: never throws. Returns true only if the command exited 0.
 * Emits audit rows for both the attempt and its outcome so the remediation
 * path is observable (previously zero visibility beyond the daily Discord alert).
 */
async function attemptPlaywrightInstallOnce(correlationId: string): Promise<boolean> {
  if (_playwrightRemediationAttempted) {
    logger.debug("prop-firm-cookie-refresh: Playwright remediation already attempted this process — not re-running install");
    return false;
  }
  _playwrightRemediationAttempted = true;

  await insertAuditRow({
    action: "prop_firm.cookie_refresh_playwright_remediation_attempted",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: { command: "npx playwright install chromium", timeoutMs: PLAYWRIGHT_REMEDIATION_TIMEOUT_MS } as Record<string, unknown>,
    result: {} as Record<string, unknown>,
    status: "success",
    correlationId,
  }).catch((auditErr) => {
    logger.warn({ auditErr }, "prop-firm-cookie-refresh: remediation-attempted audit row failed (non-blocking)");
  });

  logger.warn(
    { correlationId },
    "prop-firm-cookie-refresh: Playwright unavailable — attempting ONE-TIME auto-remediation via 'npx playwright install chromium'",
  );

  try {
    await execFileAsync("npx", ["playwright", "install", "chromium"], {
      timeout: PLAYWRIGHT_REMEDIATION_TIMEOUT_MS,
      windowsHide: true,
    });

    await insertAuditRow({
      action: "prop_firm.cookie_refresh_playwright_remediation_succeeded",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: {} as Record<string, unknown>,
      result: { command: "npx playwright install chromium" } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((auditErr) => {
      logger.warn({ auditErr }, "prop-firm-cookie-refresh: remediation-succeeded audit row failed (non-blocking)");
    });

    logger.info({ correlationId }, "prop-firm-cookie-refresh: Playwright auto-remediation install command succeeded — retrying import");
    return true;
  } catch (remediationErr) {
    const errorMsg = remediationErr instanceof Error ? remediationErr.message : String(remediationErr);

    await insertAuditRow({
      action: "prop_firm.cookie_refresh_playwright_remediation_failed",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: {} as Record<string, unknown>,
      result: { command: "npx playwright install chromium", error: errorMsg } as Record<string, unknown>,
      status: "failed",
      correlationId,
    }).catch((auditErr) => {
      logger.warn({ auditErr }, "prop-firm-cookie-refresh: remediation-failed audit row failed (non-blocking)");
    });

    logger.warn(
      { err: remediationErr, correlationId },
      "prop-firm-cookie-refresh: Playwright auto-remediation failed — falling back to alert-only (existing behavior)",
    );
    return false;
  }
}

/**
 * Attempts one-time remediation, then retries the dynamic import exactly once.
 * Fail-soft end-to-end: NEVER throws into the refresh loop. Returns the
 * resolved `chromium` launcher on success, or null if remediation didn't help
 * (or had already been attempted and failed earlier this process).
 */
async function recoverPlaywrightViaOneTimeRemediation(firmId: string, correlationId: string): Promise<any | null> {
  try {
    const installSucceeded = await attemptPlaywrightInstallOnce(correlationId);
    if (!installSucceeded) return null;

    // The install command downloads Chromium's browser binary but does NOT
    // add the "playwright" npm package to node_modules if it was never a
    // declared project dependency — both failure modes must be treated as
    // remediation-did-not-help, so re-check the import explicitly.
    const pw = await import("playwright" as string);
    return pw.chromium;
  } catch (err) {
    logger.warn({ err, firmId }, "prop-firm-cookie-refresh: post-remediation import retry failed (non-blocking)");
    return null;
  }
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
    // One-time auto-remediation attempt BEFORE falling back to alert-only
    // (deep-scan #21 Band F). Never throws — fully fail-soft.
    chromium = await recoverPlaywrightViaOneTimeRemediation(firm.firmId, randomUUID()).catch((err) => {
      logger.warn({ err, firmId: firm.firmId }, "prop-firm-cookie-refresh: remediation helper threw unexpectedly (non-blocking)");
      return null;
    });
  }

  if (!chromium) {
    logger.warn({ firmId: firm.firmId }, "prop-firm-cookie-refresh: Playwright not available — skipping");
    _cookieStatus[firm.firmId] = "stale";

    // F-4: Alert once per calendar day when Playwright is unavailable so the
    // operator knows cookies are going stale (not silently ignored).
    const todayUtc = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    if (_lastSkipAlertAt.get(firm.firmId) !== todayUtc) {
      _lastSkipAlertAt.set(firm.firmId, todayUtc);
      await AlertFactory.notifyCookieRefreshFailed(
        firm.firmId,
        "playwright_unavailable — Playwright is not installed on this host. " +
          "Session cookies for this firm will go stale. Install Playwright or " +
          "manually supply fresh cookies via the dashboard.",
      ).catch((alertErr: unknown) => {
        logger.warn({ alertErr, firmId: firm.firmId }, "prop-firm-cookie-refresh: skip alert send failed");
      });
    }

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

    // A-13: Persist to disk so NSSM restarts reload fresh cookies immediately
    // (up to 59-min gap eliminated). SECURITY: cookieJson must never be logged.
    persistCookiesToDisk(firm.firmId, cookieJson);

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
  const sweepCorrelationId = randomUUID();
  logger.info({ sweepCorrelationId }, "prop-firm-cookie-refresh: starting daily cookie refresh");

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
        correlationId: sweepCorrelationId,
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
      // Write audit row for the outer-catch path BEFORE notifying, so even if
      // Discord fails we have a traceable record of the failure.
      await insertAuditRow({
        action: "prop_firm_cookie_refresh.outer_catch_notify_failed",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { firmId: firm.firmId, errorMsg } as Record<string, unknown>,
        result: { caught: "outer_catch" } as Record<string, unknown>,
        status: "failed",
        correlationId: sweepCorrelationId,
      }).catch((auditErr) => logger.error({ auditErr, firmId: firm.firmId }, "prop-firm-cookie-refresh: outer-catch audit row failed"));
      logger.warn({ firmId: firm.firmId, errorMsg, sweepCorrelationId }, "prop-firm-cookie-refresh: outer catch — Discord alert failed");
      await AlertFactory.notifyCookieRefreshFailed(firm.firmId, errorMsg).catch((notifyErr: unknown) => {
        logger.warn({ notifyErr, firmId: firm.firmId, sweepCorrelationId }, "prop-firm-cookie-refresh: outer catch — Discord notify also failed after audit row");
      });
    }
  }

  const refreshedCount = results.filter((r) => r.status === "refreshed").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  logger.info({ refreshedCount, failedCount }, "prop-firm-cookie-refresh: sweep complete");
  return { results, refreshedCount, failedCount };
}
