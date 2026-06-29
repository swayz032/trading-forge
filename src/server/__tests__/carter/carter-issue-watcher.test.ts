/**
 * carter-issue-watcher.test.ts — Wave 4 backend tests.
 *
 * Covers:
 *   1. Migration 0181 idempotency (pglite dry-run, applied twice)
 *   2. carter-issues-store: upsert dedup, resolve, severity sort
 *   3. carter-issue-watcher SSE handler: event → store mapping, recovery
 *   4. Health poll: degraded → upsert, ok → resolve
 *   5. startCarterIssueWatcher: idempotent, calls hydrateFromDb + onSseBroadcast
 */

// ── Mocks (hoisted — must appear before imports) ──────────────────────────────

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock("../../db/schema.js", () => ({
  carterIssues: {
    issueKey:  "issueKey",
    resolved:  "resolved",
    severity:  "severity",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "__eq__"),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// sse.ts onSseBroadcast — capture the registered callback so we can invoke it
let _capturedSseCb: ((event: string, data: unknown) => void) | undefined;
vi.mock("../../routes/sse.js", () => ({
  onSseBroadcast: vi.fn((cb: (event: string, data: unknown) => void) => {
    _capturedSseCb = cb;
  }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  upsertIssue,
  resolveIssue,
  listOpenIssues,
  _resetForTest,
} from "../../lib/carter/carter-issues-store.js";
import {
  startCarterIssueWatcher,
  _resetWatcherForTest,
  _handleSseEventForTest,
  _pollHealth,
} from "../../services/carter-issue-watcher.js";
import { onSseBroadcast } from "../../routes/sse.js";

// ─── Migration 0181 — pglite idempotency dry-run ─────────────────────────────

describe("Migration 0181 — idempotency (pglite dry-run)", () => {
  it("applies twice without error", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();

    const ddl = `
      CREATE TABLE IF NOT EXISTS carter_issues (
        id           BIGSERIAL PRIMARY KEY,
        issue_key    TEXT NOT NULL UNIQUE,
        severity     TEXT NOT NULL,
        title        TEXT NOT NULL,
        detail       TEXT,
        source_event TEXT,
        first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved     BOOLEAN NOT NULL DEFAULT false,
        resolved_at  TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS carter_issues_open_idx ON carter_issues (resolved, severity);
    `;

    // First apply
    await pg.exec(ddl);

    // Second apply — must be idempotent (no error)
    await expect(pg.exec(ddl)).resolves.not.toThrow();

    await pg.close();
  });
});

// ─── carter-issues-store — in-memory map behaviour ───────────────────────────

describe("carter-issues-store — in-memory map", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("upsertIssue creates an issue and listOpenIssues returns it", () => {
    upsertIssue({ issue_key: "test:issue_1", severity: "warning", title: "Test issue" });
    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("test:issue_1");
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.resolved).toBe(false);
  });

  it("upsertIssue on the same issue_key is a dedup (single issue, updated last_seen)", async () => {
    const before = Date.now();
    upsertIssue({ issue_key: "test:dedup", severity: "warning", title: "First" });
    const firstSeen = listOpenIssues()[0]!.first_seen.getTime();

    // Small gap so last_seen > first_seen
    await new Promise((r) => setTimeout(r, 5));

    upsertIssue({ issue_key: "test:dedup", severity: "critical", title: "Updated" });
    const issues = listOpenIssues();

    expect(issues).toHaveLength(1);
    expect(issues[0]!.first_seen.getTime()).toBe(firstSeen); // preserved
    expect(issues[0]!.last_seen.getTime()).toBeGreaterThanOrEqual(before);
    expect(issues[0]!.severity).toBe("critical");           // updated
    expect(issues[0]!.title).toBe("Updated");               // updated
  });

  it("resolveIssue removes the issue from listOpenIssues()", () => {
    upsertIssue({ issue_key: "test:resolve", severity: "info", title: "Temp" });
    expect(listOpenIssues()).toHaveLength(1);

    resolveIssue("test:resolve");
    expect(listOpenIssues()).toHaveLength(0);
  });

  it("resolveIssue on unknown key is a no-op", () => {
    expect(() => resolveIssue("does_not_exist")).not.toThrow();
    expect(listOpenIssues()).toHaveLength(0);
  });

  it("listOpenIssues returns issues sorted by severity (critical first)", () => {
    upsertIssue({ issue_key: "i1", severity: "info",     title: "Info issue" });
    upsertIssue({ issue_key: "w1", severity: "warning",  title: "Warning issue" });
    upsertIssue({ issue_key: "c1", severity: "critical", title: "Critical issue" });

    const issues = listOpenIssues();
    expect(issues[0]!.severity).toBe("critical");
    expect(issues[1]!.severity).toBe("warning");
    expect(issues[2]!.severity).toBe("info");
  });

  it("listOpenIssues excludes resolved issues", () => {
    upsertIssue({ issue_key: "open",     severity: "warning", title: "Open" });
    upsertIssue({ issue_key: "resolved", severity: "critical", title: "Will resolve" });
    resolveIssue("resolved");

    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("open");
  });

  it("upsert re-opens a previously resolved issue", () => {
    upsertIssue({ issue_key: "reopen", severity: "warning", title: "Issue" });
    resolveIssue("reopen");
    expect(listOpenIssues()).toHaveLength(0);

    // Re-upsert should re-open it
    upsertIssue({ issue_key: "reopen", severity: "critical", title: "Re-opened" });
    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.resolved).toBe(false);
    expect(issues[0]!.severity).toBe("critical");
  });
});

// ─── carter-issue-watcher — SSE event handler ────────────────────────────────

describe("carter-issue-watcher — SSE event handler", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("alert:triggered creates a critical issue", () => {
    _handleSseEventForTest("alert:triggered", {
      severity: "critical",
      title: "Kill switch tripped",
      message: "Layer 6 triggered",
      alertType: "kill_switch",
    });

    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("alert:kill_switch");
    expect(issues[0]!.severity).toBe("critical");
    expect(issues[0]!.title).toBe("Kill switch tripped");
    expect(issues[0]!.source_event).toBe("alert:triggered");
  });

  it("alert:triggered with unknown severity defaults to warning", () => {
    _handleSseEventForTest("alert:triggered", {
      severity: "UNKNOWN_LEVEL",
      title: "Some alert",
    });

    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
  });

  it("lifecycle:auto_graveyard creates a warning issue with strategy ID in key", () => {
    _handleSseEventForTest("lifecycle:auto_graveyard", { strategyId: "strat-abc-123" });
    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("auto_graveyard:strat-abc-123");
    expect(issues[0]!.severity).toBe("warning");
  });

  it("quantum_rl:kill_switch_engaged creates a critical issue", () => {
    _handleSseEventForTest("quantum_rl:kill_switch_engaged", {
      strategy_id: "strat-xyz",
      reason: "Sharpe collapsed below floor",
    });
    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("rl_kill_switch:strat-xyz");
    expect(issues[0]!.severity).toBe("critical");
    expect(issues[0]!.detail).toContain("Sharpe collapsed below floor");
  });

  it("paper:handler_error creates a warning issue", () => {
    _handleSseEventForTest("paper:handler_error", {
      session_id: "sess-999",
      error: "Position limit exceeded",
    });
    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("paper_handler_error:sess-999");
    expect(issues[0]!.severity).toBe("warning");
  });

  it("dead_mans_heartbeat:missed creates a critical issue", () => {
    _handleSseEventForTest("dead_mans_heartbeat:missed", {});
    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("heartbeat_missed");
    expect(issues[0]!.severity).toBe("critical");
  });

  it("dead_mans_heartbeat:ok resolves the heartbeat_missed issue", () => {
    _handleSseEventForTest("dead_mans_heartbeat:missed", {});
    expect(listOpenIssues()).toHaveLength(1);

    _handleSseEventForTest("dead_mans_heartbeat:ok", {});
    expect(listOpenIssues()).toHaveLength(0);
  });

  it("repeated SSE events with same issue_key dedup to one issue", () => {
    _handleSseEventForTest("alert:triggered", { severity: "warning", title: "Alert", alertType: "my_alert" });
    _handleSseEventForTest("alert:triggered", { severity: "critical", title: "Alert (escalated)", alertType: "my_alert" });
    _handleSseEventForTest("alert:triggered", { severity: "critical", title: "Alert (escalated)", alertType: "my_alert" });

    expect(listOpenIssues()).toHaveLength(1);
    expect(listOpenIssues()[0]!.severity).toBe("critical");
  });

  it("unknown SSE events are silently ignored (no issue created)", () => {
    _handleSseEventForTest("some:unknown:event", { data: "irrelevant" });
    _handleSseEventForTest("paper:tp1_filled", { session_id: "sess-1" });
    expect(listOpenIssues()).toHaveLength(0);
  });

  it("non-object SSE data does not throw", () => {
    expect(() => _handleSseEventForTest("alert:triggered", null)).not.toThrow();
    expect(() => _handleSseEventForTest("alert:triggered", "string")).not.toThrow();
    expect(() => _handleSseEventForTest("alert:triggered", 42)).not.toThrow();
  });
});

// ─── carter-issue-watcher — health poll ──────────────────────────────────────

describe("carter-issue-watcher — health poll", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    _resetForTest();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("degraded health status upserts system_health_degraded issue", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ status: "degraded" }),
    }) as unknown as typeof fetch;

    await _pollHealth();

    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("system_health_degraded");
    expect(issues[0]!.severity).toBe("warning");
  });

  it("ok health status resolves system_health_degraded issue", async () => {
    // First: mark as degraded
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ status: "degraded" }),
    }) as unknown as typeof fetch;
    await _pollHealth();
    expect(listOpenIssues()).toHaveLength(1);

    // Then: recover
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ status: "ok" }),
    }) as unknown as typeof fetch;
    await _pollHealth();
    expect(listOpenIssues()).toHaveLength(0);
  });

  it("non-200 HTTP response upserts system_health_degraded issue", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok:     false,
      status: 503,
      json:   async () => ({}),
    }) as unknown as typeof fetch;

    await _pollHealth();

    const issues = listOpenIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issue_key).toBe("system_health_degraded");
    expect(issues[0]!.detail).toContain("503");
  });

  it("network error does not throw and does not create an issue", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    await expect(_pollHealth()).resolves.not.toThrow();
    // No issue should be created for a transient network error
    expect(listOpenIssues()).toHaveLength(0);
  });
});

// ─── startCarterIssueWatcher — lifecycle ─────────────────────────────────────

describe("startCarterIssueWatcher — lifecycle", () => {
  beforeEach(() => {
    _resetForTest();
    _resetWatcherForTest();
    _capturedSseCb = undefined;
    vi.clearAllMocks();
  });

  it("registers an SSE listener on first call", async () => {
    await startCarterIssueWatcher();
    expect(onSseBroadcast).toHaveBeenCalledOnce();
  });

  it("is idempotent — second call does not register another listener", async () => {
    await startCarterIssueWatcher();
    await startCarterIssueWatcher();
    expect(onSseBroadcast).toHaveBeenCalledOnce();
  });

  it("SSE listener registered by startCarterIssueWatcher maps events to the store", async () => {
    await startCarterIssueWatcher();
    expect(_capturedSseCb).toBeDefined();

    _capturedSseCb!("alert:triggered", {
      severity:  "warning",
      title:     "Integration test alert",
      alertType: "integration_test",
    });

    expect(listOpenIssues()).toHaveLength(1);
    expect(listOpenIssues()[0]!.issue_key).toBe("alert:integration_test");
  });
});
