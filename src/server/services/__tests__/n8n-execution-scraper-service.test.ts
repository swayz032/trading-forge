/**
 * n8n-execution-scraper-service.test.ts
 *
 * Wave-7 B-fix — n8n execution scraper.
 *
 * Closes the observability gap created by the Pass 21 Railway migration
 * (workflows no longer POST `/api/n8n/execution-log` callbacks; backend now
 * scrapes Railway's REST API on a 5-min cron).
 *
 * Test coverage:
 *   1. normalizeStatus — translates Railway's status / finished fields into
 *      the local "success" / "failed" / "running" vocabulary.
 *   2. Missing env (no N8N_BASE_URL or TF_N8N_API_KEY) — no-op, returns
 *      zeroed result, no fetch, no DB write.
 *   3. Fetch failure — returns errors array populated, no DB write.
 *   4. Empty Railway response — zero inserts, no audit_log row.
 *   5. New executions inserted — onConflictDoNothing called per row, audit
 *      row written with correlation_id = cycleId.
 *   6. Dedupe — when conflict returns empty .returning(), skipped counter
 *      increments; row not double-counted.
 *   7. New failure broadcasts SSE — `n8n:workflow-failed` event fired only
 *      for newly-inserted rows whose status is "failed".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted; top-level `const` references would fire before
// declaration. Use vi.hoisted() to share mock fns across factory + test bodies.

const mocks = vi.hoisted(() => {
  const onConflictMock = vi.fn();
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictMock });
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  const insertAuditRowMock = vi.fn().mockResolvedValue(undefined);
  const broadcastSSEMock = vi.fn();
  return { onConflictMock, valuesMock, insertMock, insertAuditRowMock, broadcastSSEMock };
});

vi.mock("../../db/index.js", () => ({
  db: { insert: mocks.insertMock },
}));

vi.mock("../../db/schema.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    n8nExecutionLog: { _tableName: "n8n_execution_log", executionId: "execution_id" },
    auditLog: { _tableName: "audit_log" },
  };
});

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRow: mocks.insertAuditRowMock,
}));

vi.mock("../../routes/sse.js", () => ({
  broadcastSSE: mocks.broadcastSSEMock,
}));

const { onConflictMock, insertMock, insertAuditRowMock, broadcastSSEMock } = mocks;

// ── Import subject after mocks ────────────────────────────────────────────────
import {
  runN8nExecutionScrape,
  _internal,
  getLastN8nScrapeState,
  _resetLastN8nScrapeStateForTest,
} from "../n8n-execution-scraper-service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setEnv(present: boolean) {
  if (present) {
    process.env.N8N_BASE_URL = "https://example-n8n.up.railway.app";
    process.env.TF_N8N_API_KEY = "test-key-aaa";
  } else {
    delete process.env.N8N_BASE_URL;
    delete process.env.TF_N8N_API_KEY;
    delete process.env.RAILWAY_N8N_API_KEY;
  }
}

function mockFetchResponses(executions: unknown[], workflows: unknown[]) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/executions")) {
      return {
        ok: true,
        json: async () => ({ data: executions }),
      } as Response;
    }
    if (url.includes("/workflows")) {
      return {
        ok: true,
        json: async () => ({ data: workflows }),
      } as Response;
    }
    throw new Error("unexpected URL: " + url);
  }) as typeof fetch;
}

function withInsertReturning(returningRows: Array<{ id: string }>) {
  onConflictMock.mockReturnValue({
    returning: vi.fn().mockResolvedValue(returningRows),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default insert behavior: 1 row written (no conflict).
  withInsertReturning([{ id: "row-uuid-1" }]);
  _resetLastN8nScrapeStateForTest();
});

afterEach(() => {
  setEnv(false);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("normalizeStatus", () => {
  it("maps explicit 'error' → 'failed'", () => {
    expect(_internal.normalizeStatus({ id: "x", workflowId: "w", status: "error" })).toBe("failed");
  });
  it("passes through 'success' verbatim", () => {
    expect(_internal.normalizeStatus({ id: "x", workflowId: "w", status: "success" })).toBe("success");
  });
  it("passes through 'running' verbatim", () => {
    expect(_internal.normalizeStatus({ id: "x", workflowId: "w", status: "running" })).toBe("running");
  });
  it("maps finished=true (no status) → 'success'", () => {
    expect(_internal.normalizeStatus({ id: "x", workflowId: "w", finished: true })).toBe("success");
  });
  it("maps finished=false (no status) → 'running'", () => {
    expect(_internal.normalizeStatus({ id: "x", workflowId: "w", finished: false })).toBe("running");
  });
  it("returns 'unknown' when neither status nor finished is set", () => {
    expect(_internal.normalizeStatus({ id: "x", workflowId: "w" })).toBe("unknown");
  });
});

describe("runN8nExecutionScrape — env disabled", () => {
  it("returns zeroed result when N8N_BASE_URL is missing", async () => {
    setEnv(false);
    const result = await runN8nExecutionScrape();
    expect(result.fetched).toBe(0);
    expect(result.inserted).toBe(0);
    expect(result.errors).toEqual([]);
    expect(insertMock).not.toHaveBeenCalled();
    expect(insertAuditRowMock).not.toHaveBeenCalled();
  });
});

describe("runN8nExecutionScrape — fetch failures", () => {
  it("records fetch_failed in errors[] and does not insert", async () => {
    setEnv(true);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("simulated network failure");
    }) as typeof fetch;
    const result = await runN8nExecutionScrape();
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/fetch_failed/);
    expect(result.fetched).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("records fetch_failed when executions endpoint returns non-OK", async () => {
    setEnv(true);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/executions")) {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    }) as typeof fetch;
    const result = await runN8nExecutionScrape();
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/HTTP 500/);
  });
});

describe("runN8nExecutionScrape — empty Railway response", () => {
  it("inserts nothing and writes no audit row when fetched=0", async () => {
    setEnv(true);
    mockFetchResponses([], []);
    const result = await runN8nExecutionScrape();
    expect(result.fetched).toBe(0);
    expect(result.inserted).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
    expect(insertAuditRowMock).not.toHaveBeenCalled();
  });
});

describe("runN8nExecutionScrape — new executions inserted", () => {
  it("inserts each fetched execution and writes one audit row per cycle", async () => {
    setEnv(true);
    mockFetchResponses(
      [
        { id: "e1", workflowId: "w1", status: "success", startedAt: "2026-05-17T08:00:00Z", stoppedAt: "2026-05-17T08:00:01Z", mode: "trigger" },
        { id: "e2", workflowId: "w2", status: "success", startedAt: "2026-05-17T08:01:00Z", stoppedAt: "2026-05-17T08:01:02Z", mode: "webhook" },
      ],
      [
        { id: "w1", name: "Workflow One" },
        { id: "w2", name: "Workflow Two" },
      ],
    );
    const result = await runN8nExecutionScrape();
    expect(result.fetched).toBe(2);
    expect(result.inserted).toBe(2);
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertAuditRowMock).toHaveBeenCalledTimes(1);
    const auditCall = insertAuditRowMock.mock.calls[0][0];
    expect(auditCall.action).toBe("n8n.execution_log.scraped");
    expect(auditCall.decisionAuthority).toBe("scheduler");
    expect(auditCall.correlationId).toBe(auditCall.entityId);
    expect(auditCall.result.inserted).toBe(2);
  });
});

describe("runN8nExecutionScrape — dedupe via onConflictDoNothing", () => {
  it("counts conflicting rows as skipped, not inserted", async () => {
    setEnv(true);
    mockFetchResponses(
      [
        { id: "e1", workflowId: "w1", status: "success" },
        { id: "e2", workflowId: "w1", status: "success" },
      ],
      [{ id: "w1", name: "Workflow One" }],
    );
    // First call returns 1 inserted row, second call returns 0 (conflict).
    let callCount = 0;
    onConflictMock.mockImplementation(() => ({
      returning: vi.fn().mockImplementation(async () => {
        callCount += 1;
        return callCount === 1 ? [{ id: "row-uuid-1" }] : [];
      }),
    }));
    const result = await runN8nExecutionScrape();
    expect(result.fetched).toBe(2);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(insertAuditRowMock).toHaveBeenCalledTimes(1); // only when inserted > 0
  });

  it("writes no audit_log row when every execution is a duplicate", async () => {
    setEnv(true);
    mockFetchResponses(
      [{ id: "e1", workflowId: "w1", status: "success" }],
      [{ id: "w1", name: "Workflow One" }],
    );
    withInsertReturning([]); // every insert conflicts
    const result = await runN8nExecutionScrape();
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(insertAuditRowMock).not.toHaveBeenCalled();
  });
});

describe("runN8nExecutionScrape — new failure SSE broadcast", () => {
  it("emits n8n:workflow-failed only for newly-inserted error rows", async () => {
    setEnv(true);
    mockFetchResponses(
      [
        { id: "e1", workflowId: "w1", status: "error" },   // new failure → broadcast
        { id: "e2", workflowId: "w1", status: "success" }, // success → no broadcast
        { id: "e3", workflowId: "w1", status: "error" },   // dup failure → no broadcast
      ],
      [{ id: "w1", name: "Workflow One" }],
    );
    let callCount = 0;
    onConflictMock.mockImplementation(() => ({
      returning: vi.fn().mockImplementation(async () => {
        callCount += 1;
        return callCount === 3 ? [] : [{ id: "row-uuid-" + callCount }];
      }),
    }));
    const result = await runN8nExecutionScrape();
    expect(result.newFailures).toBe(1);
    expect(broadcastSSEMock).toHaveBeenCalledTimes(1);
    expect(broadcastSSEMock.mock.calls[0][0]).toBe("n8n:workflow-failed");
    expect(broadcastSSEMock.mock.calls[0][1]).toMatchObject({
      workflowName: "Workflow One",
      executionId: "e1",
    });
  });
});

// fixwave2-scheduler-health-monitoring (2026-07-17): getLastN8nScrapeState()
// is the state the n8n-health-check cron reads to distinguish "genuinely
// healthy" (empty execution log, but the scraper is fine) from
// "indeterminate" (empty execution log because THIS scraper is down). These
// tests drive runN8nExecutionScrape() through each state transition and
// assert the snapshot getLastN8nScrapeState() returns.
describe("getLastN8nScrapeState — scrape-attempt state tracking", () => {
  it("starts unattempted before any scrape has run", () => {
    const state = getLastN8nScrapeState();
    expect(state).toEqual({
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      disabled: false,
    });
  });

  it("marks disabled=true (not an error) when env is missing, and records the attempt", async () => {
    setEnv(false);
    const before = Date.now();
    await runN8nExecutionScrape();
    const state = getLastN8nScrapeState();
    expect(state.disabled).toBe(true);
    expect(state.lastAttemptAt).not.toBeNull();
    expect(state.lastAttemptAt!).toBeGreaterThanOrEqual(before);
    expect(state.lastError).toBeNull();
    expect(state.lastSuccessAt).toBeNull();
  });

  it("records lastError (and does NOT set lastSuccessAt) on a fetch failure", async () => {
    setEnv(true);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("simulated network failure");
    }) as typeof fetch;
    await runN8nExecutionScrape();
    const state = getLastN8nScrapeState();
    expect(state.disabled).toBe(false);
    expect(state.lastAttemptAt).not.toBeNull();
    expect(state.lastError).toMatch(/simulated network failure/);
    expect(state.lastSuccessAt).toBeNull();
  });

  it("records lastError on a non-OK HTTP response (stale API key / outage)", async () => {
    setEnv(true);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/executions")) {
        return { ok: false, status: 401, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    }) as typeof fetch;
    await runN8nExecutionScrape();
    const state = getLastN8nScrapeState();
    expect(state.lastError).toMatch(/HTTP 401/);
    expect(state.lastSuccessAt).toBeNull();
  });

  it("sets lastSuccessAt and clears lastError on a successful scrape (even with zero executions)", async () => {
    setEnv(true);
    mockFetchResponses([], []);
    await runN8nExecutionScrape();
    const state = getLastN8nScrapeState();
    expect(state.lastError).toBeNull();
    expect(state.lastSuccessAt).not.toBeNull();
    expect(state.disabled).toBe(false);
  });

  it("recovery: a prior error is cleared by a subsequent successful scrape", async () => {
    setEnv(true);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("outage");
    }) as typeof fetch;
    await runN8nExecutionScrape();
    expect(getLastN8nScrapeState().lastError).toMatch(/outage/);

    mockFetchResponses([], []);
    await runN8nExecutionScrape();
    const state = getLastN8nScrapeState();
    expect(state.lastError).toBeNull();
    expect(state.lastSuccessAt).not.toBeNull();
  });

  it("getLastN8nScrapeState returns a copy — mutating the result does not affect module state", async () => {
    setEnv(true);
    mockFetchResponses([], []);
    await runN8nExecutionScrape();
    const state = getLastN8nScrapeState();
    state.lastError = "tampered";
    expect(getLastN8nScrapeState().lastError).toBeNull();
  });
});
