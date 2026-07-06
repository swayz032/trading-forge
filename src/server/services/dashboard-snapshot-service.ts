/**
 * C2 — Dashboard Snapshot Service (W15 Team B)
 *
 * Captures hourly screenshots of each configured prop firm dashboard using
 * Playwright. Screenshots are stored locally under `data/firm-snapshots/`
 * (gitignored). They serve as evidence for payout disputes.
 *
 * Background: Anonymous traders denied $2K+ payouts citing "VPN detected" or
 * other nebulous claims unresolved for 6+ months. Having timestamped screenshots
 * of account state, balance, and trading history creates an independent evidence
 * trail that makes dispute escalation viable.
 *
 * Free-tier compliance: Playwright (MIT, free) — no paid service required.
 *
 * Each firm has a dashboard URL and a set of CSS selectors to screenshot.
 * Login is performed via stored session state (cookies/localStorage).
 * If login credentials are not configured, the firm is skipped.
 *
 * Playwright is imported lazily — if not installed, snapshots are skipped with
 * a warning rather than crashing the process.
 */

import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { randomUUID } from "node:crypto";
import path from "path";
import fs from "fs";

// ─── Firm dashboard configuration ────────────────────────────────────────────

interface FirmDashboardConfig {
  firmId: string;
  dashboardUrl: string;
  sessionStorageEnv: string; // env var with JSON session cookies
  snapshotSelectors: string[]; // CSS selectors for targeted screenshots
}

// H-5: Apex was removed in migration 0097 (2026-05-10). Only Topstep (PRIMARY)
// and MFFU (secondary) are supported. Do not re-add Apex without a migration.
const FIRM_DASHBOARDS: FirmDashboardConfig[] = [
  {
    firmId: "topstep",
    dashboardUrl: process.env.TOPSTEP_DASHBOARD_URL ?? "https://trader.topstep.com/dashboard",
    sessionStorageEnv: "TOPSTEP_SESSION_COOKIES",
    snapshotSelectors: ["[data-testid='account-status']", "body"],
  },
  {
    firmId: "mffu",
    dashboardUrl: process.env.MFFU_DASHBOARD_URL ?? "https://app.myforexfunds.com/dashboard",
    sessionStorageEnv: "MFFU_SESSION_COOKIES",
    snapshotSelectors: ["[data-testid='account-status']", "body"],
  },
];

const SNAPSHOT_BASE_DIR = process.env.FIRM_SNAPSHOT_DIR ?? path.join(process.cwd(), "data", "firm-snapshots");
const SCREENSHOT_TIMEOUT_MS = 30_000;

// ─── Single firm snapshot ─────────────────────────────────────────────────────

export interface SnapshotResult {
  firmId: string;
  status: "captured" | "skipped_no_credentials" | "skipped_playwright_unavailable" | "error";
  screenshotPaths?: string[];
  errorMessage?: string;
  capturedAt?: string;
}

async function captureOneFirm(config: FirmDashboardConfig): Promise<SnapshotResult> {
  const sessionCookiesJson = process.env[config.sessionStorageEnv];
  if (!sessionCookiesJson) {
    logger.debug(
      { firmId: config.firmId, env: config.sessionStorageEnv },
      "dashboard-snapshot: no session cookies configured — skipping",
    );
    return { firmId: config.firmId, status: "skipped_no_credentials" };
  }

  // Lazy-import Playwright — if not installed, skip gracefully.
  // Playwright types are not required at compile time (optional dependency).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any = null;
  try {
    // Dynamic import: Playwright is an optional peer dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = await import("playwright" as any);
    chromium = pw.chromium;
  } catch {
    return {
      firmId: config.firmId,
      status: "skipped_playwright_unavailable",
      errorMessage: "Playwright not installed. Run: npm install playwright && npx playwright install chromium",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;
  const screenshotPaths: string[] = [];

  try {
    // Parse session cookies
    let cookies: Record<string, unknown>[] = [];
    try {
      cookies = JSON.parse(sessionCookiesJson) as Record<string, unknown>[];
    } catch {
      return { firmId: config.firmId, status: "error", errorMessage: "Invalid JSON in session cookies env var" };
    }

    browser = await chromium.launch({ headless: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context: any = await browser.newContext();

    // Restore session cookies
    if (Array.isArray(cookies) && cookies.length > 0) {
      await context.addCookies(cookies);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page: any = await context.newPage();
    page.setDefaultTimeout(SCREENSHOT_TIMEOUT_MS);

    await page.goto(config.dashboardUrl, { waitUntil: "networkidle" });

    // deep-scan broker/cookie F-1 (HIGH): an EXPIRED cookie redirects the dashboard URL to a LOGIN page,
    // but this used to screenshot it unconditionally + return status:"captured" — storing a login screen
    // as payout-dispute evidence (a false success the F-4 audit would then faithfully record). Detect the
    // login page (password field OR login-path URL) and return an error so the stale cookie surfaces via
    // the dashboard_snapshot.capture_failed audit row instead of a fake "captured".
    try {
      const passwordField = await page.$("input[type='password']");
      const currentUrl: string = typeof page.url === "function" ? String(page.url()) : "";
      if (passwordField || /\/(login|signin|sign-in|auth)\b/i.test(currentUrl)) {
        return { firmId: config.firmId, status: "error", errorMessage: "stale_cookie_redirected_to_login" };
      }
    } catch {
      // Detection is best-effort — if it throws, fall through and capture (a snapshot beats a crash).
    }

    // Ensure the snapshot directory exists for this firm
    const firmDir = path.join(SNAPSHOT_BASE_DIR, config.firmId);
    fs.mkdirSync(firmDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Full-page screenshot
    const fullPagePath = path.join(firmDir, `${timestamp}-full.png`);
    await page.screenshot({ path: fullPagePath, fullPage: true });
    screenshotPaths.push(fullPagePath);

    // Targeted element screenshots
    for (const selector of config.snapshotSelectors) {
      if (selector === "body") continue; // already captured above
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const element: any = await page.$(selector);
        if (element) {
          const elementPath = path.join(firmDir, `${timestamp}-${selector.replace(/[^a-z0-9]/gi, "_")}.png`);
          await element.screenshot({ path: elementPath });
          screenshotPaths.push(elementPath);
        }
      } catch {
        // Non-blocking — element may not exist on all dashboard variants
      }
    }

    return {
      firmId: config.firmId,
      status: "captured",
      screenshotPaths,
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, firmId: config.firmId }, "dashboard-snapshot: screenshot capture failed");
    return { firmId: config.firmId, status: "error", errorMessage: errMsg };
  } finally {
    await browser?.close().catch(() => {});
  }
}

// ─── Main snapshot run (called by scheduler every hour) ──────────────────────

export async function runDashboardSnapshots(): Promise<SnapshotResult[]> {
  const results: SnapshotResult[] = [];
  // deep-scan broker/cookie F-4 (CRITICAL): prop-firm dashboard snapshots ARE the payout-dispute evidence
  // trail, yet this service wrote ZERO audit_log rows and its SSE carried no correlationId — so there was
  // no reconstructable record of when/whether evidence was captured or why it failed. Add a per-run
  // correlationId + an audit row per firm (captured/failed), and thread it through the SSE (§2 chain).
  const correlationId = randomUUID();

  for (const config of FIRM_DASHBOARDS) {
    const result = await captureOneFirm(config);
    results.push(result);

    if (result.status === "captured") {
      logger.info(
        { firmId: result.firmId, paths: result.screenshotPaths?.length, capturedAt: result.capturedAt, correlationId },
        "dashboard-snapshot: captured firm dashboard evidence",
      );
      await insertAuditRowSafe({
        action: "dashboard_snapshot.captured",
        entityType: "prop_firm_evidence",
        entityId: result.firmId,
        status: "success",
        decisionAuthority: "system",
        correlationId,
        result: { firmId: result.firmId, screenshotCount: result.screenshotPaths?.length ?? 0, capturedAt: result.capturedAt },
      });
      broadcastSSE("prop-firm:snapshot-captured", {
        firmId: result.firmId,
        correlationId,
        screenshotCount: result.screenshotPaths?.length ?? 0,
        capturedAt: result.capturedAt,
      });
    } else if (result.status === "error") {
      logger.warn(
        { firmId: result.firmId, error: result.errorMessage, correlationId },
        "dashboard-snapshot: capture failed (non-critical)",
      );
      await insertAuditRowSafe({
        action: "dashboard_snapshot.capture_failed",
        entityType: "prop_firm_evidence",
        entityId: result.firmId,
        status: "warning",
        decisionAuthority: "system",
        correlationId,
        result: { firmId: result.firmId, error: result.errorMessage ?? "unknown", impact: "no payout-dispute evidence captured for this firm this cycle" },
      });
    }
  }

  // Prune old snapshots: keep last 30 days per firm
  pruneOldSnapshots().catch((err) => logger.error({ err }, "dashboard-snapshot: prune failed (non-blocking)"));

  return results;
}

/**
 * Prune snapshots older than 30 days to avoid unbounded disk growth.
 */
async function pruneOldSnapshots(): Promise<void> {
  const RETENTION_DAYS = 30;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  if (!fs.existsSync(SNAPSHOT_BASE_DIR)) return;

  const firmDirs = fs.readdirSync(SNAPSHOT_BASE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(SNAPSHOT_BASE_DIR, d.name));

  let pruned = 0;
  for (const firmDir of firmDirs) {
    const files = fs.readdirSync(firmDir);
    for (const file of files) {
      const filePath = path.join(firmDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          pruned++;
        }
      } catch {
        // Non-blocking
      }
    }
  }

  if (pruned > 0) {
    logger.info({ pruned }, "dashboard-snapshot: pruned old screenshots");
  }
}

/**
 * Get snapshot directory size summary (for admin health checks).
 */
export function getSnapshotDirSummary(): { firmId: string; fileCount: number; oldestFile?: string; newestFile?: string }[] {
  if (!fs.existsSync(SNAPSHOT_BASE_DIR)) return [];

  const firmDirs = fs.readdirSync(SNAPSHOT_BASE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ firmId: d.name, dirPath: path.join(SNAPSHOT_BASE_DIR, d.name) }));

  return firmDirs.map(({ firmId, dirPath }) => {
    const files = fs.readdirSync(dirPath).sort();
    return {
      firmId,
      fileCount: files.length,
      oldestFile: files[0],
      newestFile: files[files.length - 1],
    };
  });
}
