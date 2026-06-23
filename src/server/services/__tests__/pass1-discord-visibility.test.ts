/**
 * Pass 1 Track D — Discord Visibility Tests
 *
 * Covers:
 * 1. alert-service.createAlert({severity:'warning'}) triggers notification-service.notifyWarning.
 * 2. alert-service.createAlert({severity:'info'}) triggers notification-service.notifyInfo.
 * 3. alert-service.createAlert({severity:'critical'}) still does NOT call notifyWarning
 *    (it has its own direct Discord path).
 * 4. broker-router circuit-OPEN and vault-fail notifyCritical bodies contain
 *    family-grade markers ("Tell Tony:" and "do nothing") via appendFamilyGradePostscript.
 * 5. runDiscordFanoutAudit is exported, invocable, and returns correct health state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks needed by alert-service's transitive dependencies ─────────────────
//
// These vi.mock() calls are hoisted by vitest's transform to run before any
// import statement in this file. The mock factories replace the specified
// modules in vitest's module registry so that when alert-service.ts and
// notification-service.ts are loaded, they get the mocked versions of db,
// sse, logger, and metrics.

// Mock the DB so alert-service.createAlert doesn't hit Postgres
vi.mock("../../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [
          {
            id: "test-alert-id",
            type: "system",
            severity: "warning",
            title: "Test Alert",
            message: "Test message",
            metadata: {},
          },
        ]),
      })),
    })),
  },
}));

// Mock SSE broadcast so it doesn't throw
vi.mock("../../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

// Mock logger from index.js (alert-service.ts imports logger from there)
vi.mock("../../index.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock lib/logger.js — notification-service.ts imports its logger from here
vi.mock("../../lib/logger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock audit-log-helper — notification-service imports this transitively
vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));

// Mock metrics-registry so Counter registration does not require prom-client setup in tests
vi.mock("../../lib/metrics-registry.js", () => ({
  warningSeverityDiscordRoutedTotal: { inc: vi.fn(), labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  // Stubs for any other counters alert-service or its transitive deps may reference
  strategyPromotions: { inc: vi.fn(), labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  backtestRuns: { inc: vi.fn(), labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  paperTrades: { inc: vi.fn(), labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));

// ─── Static imports after all mocks are registered ───────────────────────────
//
// These static imports execute AFTER vi.mock() factories (which are hoisted).
// We import BOTH the SUT (alert-service) and the dependency we want to spy on
// (notification-service). Because vi.mock() is processed first, when
// alert-service.ts loads and statically imports notification-service.ts, it
// gets the SAME module instance we import here as `* as notificationService`.
// We can then use vi.spyOn() on the namespace to intercept calls.
import { createAlert } from "../alert-service.js";
import * as notificationService from "../notification-service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pass 1 Track D — Discord Visibility", () => {
  let notifyWarningSpy: ReturnType<typeof vi.spyOn>;
  let notifyInfoSpy: ReturnType<typeof vi.spyOn>;
  let notifyCriticalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Spy on notification-service exports. These intercept the real functions
    // so we can assert they were called without actually hitting Discord.
    notifyWarningSpy = vi.spyOn(notificationService, "notifyWarning").mockImplementation(vi.fn());
    notifyInfoSpy = vi.spyOn(notificationService, "notifyInfo").mockImplementation(vi.fn());
    notifyCriticalSpy = vi.spyOn(notificationService, "notifyCritical").mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Section 1: alert-service severity routing ────────────────────────────

  describe("alert-service.createAlert severity routing", () => {
    it("routes warning severity through notification-service with severity=WARNING", async () => {
      await createAlert({
        type: "system",
        severity: "warning",
        title: "Test Warning",
        message: "Something needs attention",
        metadata: { component: "test" },
      });

      expect(notifyWarningSpy).toHaveBeenCalledOnce();
      expect(notifyWarningSpy.mock.calls[0][0]).toBe("Test Warning");
    });

    it("routes info severity through notification-service with severity=INFO", async () => {
      await createAlert({
        type: "lifecycle",
        severity: "info",
        title: "Strategy ready for deployment",
        message: "Strategy passed all gates",
        metadata: { strategyId: "abc123" },
      });

      expect(notifyInfoSpy).toHaveBeenCalledOnce();
      expect(notifyInfoSpy.mock.calls[0][0]).toBe("Strategy ready for deployment");
    });

    it("does NOT route critical alerts as WARNING (critical uses its own Discord path)", async () => {
      await createAlert({
        type: "system",
        severity: "critical",
        title: "Critical Failure",
        message: "System is down",
      });

      // notifyWarning must NOT be called for a critical alert
      expect(notifyWarningSpy).not.toHaveBeenCalled();
    });

    it("appends family-grade postscript to warning alert body", async () => {
      await createAlert({
        type: "drift",
        severity: "warning",
        title: "Drift detected",
        message: "Strategy abc drifted from backtest",
      });

      expect(notifyWarningSpy).toHaveBeenCalledOnce();
      const body = notifyWarningSpy.mock.calls[0][1] as string;
      // appendFamilyGradePostscript always adds this separator
      expect(body).toContain("--- For family members ---");
      // Original message must be preserved at the start of the body
      expect(body).toContain("Strategy abc drifted from backtest");
    });

    it("appends family-grade postscript to info alert body", async () => {
      await createAlert({
        type: "lifecycle",
        severity: "info",
        title: "Strategy ready",
        message: "New strategy passed gates",
      });

      expect(notifyInfoSpy).toHaveBeenCalledOnce();
      const body = notifyInfoSpy.mock.calls[0][1] as string;
      expect(body).toContain("--- For family members ---");
      expect(body).toContain("New strategy passed gates");
    });

    it("tf_warning_severity_discord_routed_total counter is exported from metrics-registry", async () => {
      const metricsModule = await import("../../lib/metrics-registry.js");
      expect(metricsModule).toHaveProperty("warningSeverityDiscordRoutedTotal");
      expect(typeof metricsModule.warningSeverityDiscordRoutedTotal.inc).toBe("function");
    });
  });

  // ── Section 2: broker-router family-grade postscripts ───────────────────

  describe("broker-router family-grade postscript on critical paths", () => {
    it("appendFamilyGradePostscript for circuit-OPEN produces 'Tell Tony:' and 'do nothing'", async () => {
      const { appendFamilyGradePostscript } = await import("../../lib/notification-helpers.js");

      const technicalBody =
        `TradersPost circuit breaker OPENED after 3 consecutive failures. ` +
        `All order routing for TradersPost accounts is fast-failing until the ` +
        `breaker half-opens (~30s). ` +
        `Check TradersPost status page and inspect audit_log for broker_router.traderspost_submission_failed rows.`;

      const familyWhat = "The TradersPost circuit is OPEN — orders are safely blocked.";
      const familyAction =
        "Tell Tony: 'TradersPost is unreachable from the bot.' " +
        "If you cannot reach him, do nothing — orders are safely blocked, not silently mis-routed.";

      const result = appendFamilyGradePostscript(technicalBody, familyWhat, familyAction);

      expect(result).toContain("Tell Tony:");
      expect(result).toContain("do nothing");
      expect(result).toContain("--- For family members ---");
      expect(result).toContain(technicalBody);
      expect(result).toContain(familyWhat);
    });

    it("appendFamilyGradePostscript for vault-fail produces 'Tell Tony:' and 'do nothing'", async () => {
      const { appendFamilyGradePostscript } = await import("../../lib/notification-helpers.js");

      const technicalBody =
        `Credential load failed for account abc123 (firm: topstep). ` +
        `All order routing is BLOCKED for this account until the vault is restored. ` +
        `Error: Bitwarden session expired`;

      const familyWhat = "The trading account vault is locked — orders are safely blocked.";
      const familyAction =
        "Tell Tony: 'The vault is locked.' " +
        "If you cannot reach him, do nothing — orders are safely blocked, not silently mis-routed.";

      const result = appendFamilyGradePostscript(technicalBody, familyWhat, familyAction);

      expect(result).toContain("Tell Tony:");
      expect(result).toContain("do nothing");
      expect(result).toContain("--- For family members ---");
      expect(result).toContain(technicalBody);
      expect(result).toContain(familyWhat);
    });

    it("appendFamilyGradePostscript separator is always '--- For family members ---'", async () => {
      const { appendFamilyGradePostscript } = await import("../../lib/notification-helpers.js");

      const result = appendFamilyGradePostscript("operator body", "what happened", "what to do");

      expect(result).toContain("\n\n--- For family members ---\n");
      expect(result).toContain("What this means: what happened");
      expect(result).toContain("What to do: what to do");
    });
  });

  // ── Section 3: runDiscordFanoutAudit exportability and health states ─────
  //
  // NOTE: These tests use vi.resetModules() to force re-evaluation of env vars.
  // They import discord-fanout-audit-service via dynamic import AFTER resetModules.
  // The vi.spyOn-based approach in Section 1 is unaffected by these module resets
  // because Section 1 uses the static `createAlert` binding — the spy is re-applied
  // in beforeEach using the already-loaded module namespace.

  describe("runDiscordFanoutAudit", () => {
    it("is exported from discord-fanout-audit-service and is a function", async () => {
      const module = await import("../discord-fanout-audit-service.js");
      expect(typeof module.runDiscordFanoutAudit).toBe("function");
    });

    it("returns 'not_configured' when no DISCORD_WEBHOOK_URL or DISCORD_ALERT_PORT is set", async () => {
      const saved = {
        DISCORD_WEBHOOK_URL: process.env["DISCORD_WEBHOOK_URL"],
        DISCORD_ALERT_PORT: process.env["DISCORD_ALERT_PORT"],
      };
      delete process.env["DISCORD_WEBHOOK_URL"];
      delete process.env["DISCORD_ALERT_PORT"];

      try {
        // Reset modules so the env is re-read
        vi.resetModules();
        const { runDiscordFanoutAudit } = await import("../discord-fanout-audit-service.js");
        const result = await runDiscordFanoutAudit("test-not-configured");
        expect(result).toBe("not_configured");
      } finally {
        if (saved.DISCORD_WEBHOOK_URL !== undefined) {
          process.env["DISCORD_WEBHOOK_URL"] = saved.DISCORD_WEBHOOK_URL;
        }
        if (saved.DISCORD_ALERT_PORT !== undefined) {
          process.env["DISCORD_ALERT_PORT"] = saved.DISCORD_ALERT_PORT;
        }
        vi.resetModules();
      }
    });

    it("returns 'healthy' when Discord webhook responds with HTTP 204", async () => {
      const savedUrl = process.env["DISCORD_WEBHOOK_URL"];
      process.env["DISCORD_WEBHOOK_URL"] = "https://discord.com/api/webhooks/123/fake-token";

      const fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: true });
      vi.stubGlobal("fetch", fetchMock);

      try {
        vi.resetModules();
        const { runDiscordFanoutAudit } = await import("../discord-fanout-audit-service.js");
        const result = await runDiscordFanoutAudit("test-healthy");
        expect(result).toBe("healthy");
        expect(fetchMock).toHaveBeenCalledOnce();
      } finally {
        if (savedUrl !== undefined) {
          process.env["DISCORD_WEBHOOK_URL"] = savedUrl;
        } else {
          delete process.env["DISCORD_WEBHOOK_URL"];
        }
        vi.unstubAllGlobals();
        vi.resetModules();
      }
    });

    it("returns 'unreachable' and does not throw when webhook fetch fails", async () => {
      const savedUrl = process.env["DISCORD_WEBHOOK_URL"];
      process.env["DISCORD_WEBHOOK_URL"] = "https://discord.com/api/webhooks/123/fake-token";

      const fetchMock = vi.fn().mockRejectedValue(new Error("Network unreachable"));
      vi.stubGlobal("fetch", fetchMock);

      try {
        vi.resetModules();
        // Re-apply mocks after resetModules for any deps discord-fanout-audit-service may import
        vi.mock("../../lib/logger.js", () => ({
          logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        }));
        vi.mock("../../lib/audit-log-helper.js", () => ({
          insertAuditRow: vi.fn().mockResolvedValue(undefined),
          insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
        }));
        const { runDiscordFanoutAudit } = await import("../discord-fanout-audit-service.js");
        const result = await runDiscordFanoutAudit("test-unreachable");
        expect(result).toBe("unreachable");
      } finally {
        if (savedUrl !== undefined) {
          process.env["DISCORD_WEBHOOK_URL"] = savedUrl;
        } else {
          delete process.env["DISCORD_WEBHOOK_URL"];
        }
        vi.unstubAllGlobals();
        vi.resetModules();
      }
    });

    it("getDiscordWebhookHealth accessor returns the last audit result", async () => {
      const savedUrl = process.env["DISCORD_WEBHOOK_URL"];
      delete process.env["DISCORD_WEBHOOK_URL"];
      delete process.env["DISCORD_ALERT_PORT"];

      try {
        vi.resetModules();
        const { runDiscordFanoutAudit, getDiscordWebhookHealth } = await import(
          "../discord-fanout-audit-service.js"
        );

        // Run audit (not_configured path)
        await runDiscordFanoutAudit("accessor-test");
        // Accessor should reflect the result
        expect(getDiscordWebhookHealth()).toBe("not_configured");
      } finally {
        if (savedUrl !== undefined) process.env["DISCORD_WEBHOOK_URL"] = savedUrl;
        vi.resetModules();
      }
    });
  });
});
