/**
 * Notification Service tests — verifies Discord webhook delivery, rate limiting,
 * WARNING batching, graceful failure handling, and status reporting.
 *
 * Uses vi.stubGlobal to replace native fetch so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module-level mock setup ─────────────────────────────────────────────────
// The notification service imports `logger` from ../index.js which has side
// effects (DB init, Express). Mock it before importing the service module.

vi.mock("../index.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  notify,
  notifyCritical,
  notifyWarning,
  notifyInfo,
  flushNotifications,
  getNotificationServiceStatus,
  _resetForTests,
} from "./notification-service.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFetchSpy(ok = true, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: vi.fn().mockResolvedValue(ok ? "" : "Too Many Requests"),
  });
}

/**
 * Flush the microtask queue so fire-and-forget .then() chains complete.
 * Vitest 3 does not have vi.runAllMicrotasksAsync — chaining Promise.resolve()
 * twice is enough to drain a single .then() hop.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("NotificationService", () => {
  const WEBHOOK_URL = "https://discord.com/api/webhooks/test/token";

  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTests();
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  afterEach(async () => {
    // Drain any pending warning queue between tests
    await flushNotifications().catch(() => {});
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  // ─── No-op when unconfigured ───────────────────────────────────────────────

  describe("when DISCORD_WEBHOOK_URL is not set", () => {
    it("returns silently without calling fetch", async () => {
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      notify({ severity: "CRITICAL", title: "Test", body: "body" });
      await flushMicrotasks();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("getNotificationServiceStatus reports configured: false", () => {
      const status = getNotificationServiceStatus();
      expect(status.configured).toBe(false);
    });
  });

  // ─── CRITICAL immediate delivery ──────────────────────────────────────────

  describe("CRITICAL severity", () => {
    it("calls fetch immediately with a Discord embed payload", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      notifyCritical("Circuit breaker OPEN: ollama", "Ollama is unreachable", { endpoint: "ollama" });
      await flushMicrotasks();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(WEBHOOK_URL);
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body as string);
      expect(body).toHaveProperty("embeds");
      expect(body.embeds).toHaveLength(1);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0xff0000);
      expect(embed.title).toContain("CRITICAL");
      expect(embed.title).toContain("Circuit breaker OPEN: ollama");
    });

    it("includes metadata as embed fields when provided", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      notifyCritical("Test", "body", { endpoint: "ollama", cooldownMs: 30000 });
      await flushMicrotasks();

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      const embed = body.embeds[0];
      expect(embed.fields).toBeDefined();
      expect(embed.fields.some((f: { name: string }) => f.name === "endpoint")).toBe(true);
    });

    it("does not throw when Discord returns a non-2xx status", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy(false, 429);
      vi.stubGlobal("fetch", fetchSpy);

      // Should not throw — fire and forget
      expect(() => notifyCritical("Test", "body")).not.toThrow();
      await flushMicrotasks();
      // fetch was called, error was swallowed
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not throw when fetch rejects (Discord unreachable)", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", fetchSpy);

      expect(() => notifyCritical("Test", "body")).not.toThrow();
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── INFO immediate delivery ───────────────────────────────────────────────

  describe("INFO severity", () => {
    it("calls fetch immediately with blue embed", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      notifyInfo("Strategy promoted", "CANDIDATE → TESTING");
      await flushMicrotasks();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.embeds[0].color).toBe(0x0099ff);
    });
  });

  // ─── WARNING batching ─────────────────────────────────────────────────────

  describe("WARNING severity", () => {
    it("does NOT call fetch immediately", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      notifyWarning("Scheduler missed", "heartbeat overdue");
      await flushMicrotasks();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("queues the warning and reflects depth in status", () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      notifyWarning("Warning 1", "body 1");
      notifyWarning("Warning 2", "body 2");

      const status = getNotificationServiceStatus();
      expect(status.warningQueueDepth).toBe(2);
    });

    it("flushNotifications sends all queued warnings in a single embed", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      notifyWarning("Warning A", "body A");
      notifyWarning("Warning B", "body B");
      notifyWarning("Warning C", "body C");

      await flushNotifications();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0xffa500);
      expect(embed.title).toContain("3 warnings");
      expect(embed.description).toContain("Warning A");
      expect(embed.description).toContain("Warning B");
      expect(embed.description).toContain("Warning C");
    });

    it("clears the queue after a successful flush", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      vi.stubGlobal("fetch", makeFetchSpy());

      notifyWarning("W1", "b1");
      await flushNotifications();

      expect(getNotificationServiceStatus().warningQueueDepth).toBe(0);
    });

    it("does not call fetch if queue is empty on flush", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      await flushNotifications();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Rate limiting ────────────────────────────────────────────────────────

  describe("rate limiting", () => {
    it("drops the 6th call within a 60-second window", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      // Send 5 CRITICAL notifications (the limit)
      for (let i = 0; i < 5; i++) {
        notifyCritical(`Test ${i}`, "body");
      }
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      // 6th should be dropped by rate limiter
      notifyCritical("Test 6", "should be dropped");
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(5); // still 5
    });

    it("allows calls again after the window expires", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      // Fill the window
      for (let i = 0; i < 5; i++) {
        notifyCritical(`Burst ${i}`, "body");
      }
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      // Advance time past the 60-second window
      vi.advanceTimersByTime(61_000);

      notifyCritical("After window", "should succeed");
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(6);
    });

    it("rateLimitBudgetRemaining decreases as calls are made", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      vi.stubGlobal("fetch", makeFetchSpy());

      const before = getNotificationServiceStatus().rateLimitBudgetRemaining;

      notifyCritical("T1", "b");
      await flushMicrotasks();

      const after = getNotificationServiceStatus().rateLimitBudgetRemaining;
      expect(after).toBe(before - 1);
    });
  });

  // ─── Embed format validation ──────────────────────────────────────────────

  describe("embed format", () => {
    it("truncates title to 256 characters", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      const longTitle = "X".repeat(300);
      notifyCritical(longTitle, "body");
      await flushMicrotasks();

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.embeds[0].title.length).toBeLessThanOrEqual(256);
    });

    it("truncates description to 4000 characters", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      const longBody = "B".repeat(5000);
      notifyInfo("Title", longBody);
      await flushMicrotasks();

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.embeds[0].description.length).toBeLessThanOrEqual(4000);
    });

    it("embed includes a timestamp and footer", async () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      const fetchSpy = makeFetchSpy();
      vi.stubGlobal("fetch", fetchSpy);

      notifyInfo("Title", "body");
      await flushMicrotasks();

      const embed = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string).embeds[0];
      expect(embed.timestamp).toBeDefined();
      expect(embed.footer.text).toBe("Trading Forge");
    });
  });

  // ─── Status reporting ─────────────────────────────────────────────────────

  describe("getNotificationServiceStatus", () => {
    it("reports configured: true when URL is set", () => {
      process.env.DISCORD_WEBHOOK_URL = WEBHOOK_URL;
      expect(getNotificationServiceStatus().configured).toBe(true);
    });

    it("shape has all expected fields", () => {
      const status = getNotificationServiceStatus();
      expect(status).toHaveProperty("configured");
      expect(status).toHaveProperty("warningQueueDepth");
      expect(status).toHaveProperty("recentCallCount");
      expect(status).toHaveProperty("rateLimitBudgetRemaining");
    });
  });
});
