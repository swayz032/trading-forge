/**
 * Cloud QMC Stale-Job Sweep — fixwave (2026-07-17)
 *
 * REGRESSION: pollPendingJobs() previously had no upper bound on how long a
 * cloud_qmc_runs row could sit in status="queued" or "running". A row whose
 * IBM submission failed silently (ibmJobId stays null — the pre-existing
 * "submit failed silently?" comment at the skip site) or whose IBM job
 * status polling never resolves (poll_ibm_job keeps returning "running", or
 * throws every cycle) occupied one of the LIMIT-20 poll slots FOREVER,
 * crowding out fresh runs and giving the operator zero signal — the row
 * just silently never completed. This tests the new pure staleness
 * predicate (isCloudQmcRunStale) and the sweep function that uses it
 * (sweepStaleCloudQmcRuns), with the DB fully mocked (isolation contract
 * matches src/server/lib/__tests__/quantum-cost-tracker.test.ts's
 * pruneStalePendingCosts precedent).
 *
 * Vitest hoisting: vi.mock() factories are hoisted before imports, so
 * variables captured from the test module scope cannot be referenced
 * directly inside them — use vi.hoisted() for shared spies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted spies ─────────────────────────────────────────────────────────
const { mockSelectWhere, mockUpdateWhere, mockIsActive } = vi.hoisted(() => {
  const mockSelectWhere = vi.fn();
  const mockUpdateWhere = vi.fn();
  const mockIsActive = vi.fn().mockResolvedValue(true);
  return { mockSelectWhere, mockUpdateWhere, mockIsActive };
});

// ─── DB mock ────────────────────────────────────────────────────────────────
vi.mock("../../db/index.js", () => {
  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockSelectWhere,
        // pollPendingJobs' other query chains orderBy/limit — not exercised
        // by these tests (they call sweepStaleCloudQmcRuns directly), but
        // keep the shape safe if a future test imports pollPendingJobs too.
        orderBy: vi.fn(() => ({ limit: vi.fn(() => mockSelectWhere()) })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockUpdateWhere,
      })),
    })),
  };
  return { db: dbMock };
});

// ─── Schema mock ─────────────────────────────────────────────────────────────
vi.mock("../../db/schema.js", () => ({
  cloudQmcRuns: {
    id: "cloudQmcRuns_id_col",
    status: "cloudQmcRuns_status_col",
    ibmJobId: "cloudQmcRuns_ibmJobId_col",
    createdAt: "cloudQmcRuns_createdAt_col",
  },
  backtests: {},
  strategies: {},
  auditLog: {},
  quantumMcRuns: {},
}));

// ─── Pipeline control mock ───────────────────────────────────────────────────
vi.mock("../pipeline-control-service.js", () => ({
  isActive: mockIsActive,
}));

// ─── quantum-cost-tracker mock (unrelated cost telemetry — not under test) ───
vi.mock("../../lib/quantum-cost-tracker.js", () => ({
  recordCost: vi.fn().mockResolvedValue({ id: "test-cost-id" }),
  completeCost: vi.fn().mockResolvedValue(undefined),
  STALE_PENDING_SENTINEL_ID: "__no_cost_row__",
}));

// ─── Logger mock ──────────────────────────────────────────────────────────────
vi.mock("../../index.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks are registered
import {
  isCloudQmcRunStale,
  sweepStaleCloudQmcRuns,
  CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS,
  CLOUD_QMC_STALE_RUNNING_HOURS,
} from "../cloud-qmc-service.js";
import { db } from "../../db/index.js";

function resetMocks() {
  vi.clearAllMocks();
  mockIsActive.mockResolvedValue(true);
}

const NOW = new Date("2026-07-17T12:00:00Z");
function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000);
}

// ─── isCloudQmcRunStale — pure predicate ──────────────────────────────────────

describe("isCloudQmcRunStale — pure predicate", () => {
  it("completed/failed rows are never stale, regardless of age", () => {
    expect(
      isCloudQmcRunStale(
        { status: "completed", ibmJobId: "job-1", createdAt: hoursAgo(10_000) },
        NOW,
      ),
    ).toBe(false);
    expect(
      isCloudQmcRunStale(
        { status: "failed", ibmJobId: null, createdAt: hoursAgo(10_000) },
        NOW,
      ),
    ).toBe(false);
  });

  it("queued row with NO ibmJobId is stale past CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS", () => {
    const justUnder = hoursAgo(CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS - 0.1);
    const justOver = hoursAgo(CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS + 0.1);
    expect(
      isCloudQmcRunStale({ status: "queued", ibmJobId: null, createdAt: justUnder }, NOW),
    ).toBe(false);
    expect(
      isCloudQmcRunStale({ status: "queued", ibmJobId: null, createdAt: justOver }, NOW),
    ).toBe(true);
  });

  it("queued row WITH an ibmJobId gets the longer running-window grace period, not the short no-job-id one", () => {
    // Old enough to be stale under the SHORT (no-job-id) threshold but not
    // under the LONG (has-job-id) threshold — proves the two thresholds are
    // genuinely different code paths, not one constant reused twice.
    const age = hoursAgo(CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS + 1);
    expect(
      isCloudQmcRunStale({ status: "queued", ibmJobId: "job-real", createdAt: age }, NOW),
    ).toBe(false);
  });

  it("running row is stale past CLOUD_QMC_STALE_RUNNING_HOURS", () => {
    const justUnder = hoursAgo(CLOUD_QMC_STALE_RUNNING_HOURS - 0.1);
    const justOver = hoursAgo(CLOUD_QMC_STALE_RUNNING_HOURS + 0.1);
    expect(
      isCloudQmcRunStale({ status: "running", ibmJobId: "job-1", createdAt: justUnder }, NOW),
    ).toBe(false);
    expect(
      isCloudQmcRunStale({ status: "running", ibmJobId: "job-1", createdAt: justOver }, NOW),
    ).toBe(true);
  });

  it("the two thresholds are meaningfully different (no-job-id sweeps much sooner)", () => {
    expect(CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS).toBeLessThan(CLOUD_QMC_STALE_RUNNING_HOURS);
  });
});

// ─── sweepStaleCloudQmcRuns — DB wiring ───────────────────────────────────────

describe("sweepStaleCloudQmcRuns", () => {
  beforeEach(resetMocks);

  it("sweeps a stale queued row with no ibmJobId to failed with the correct reason", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        id: "row-1",
        status: "queued",
        ibmJobId: null,
        createdAt: new Date(Date.now() - (CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS + 1) * 3600_000),
      },
    ]);
    mockUpdateWhere.mockResolvedValue(undefined);

    const count = await sweepStaleCloudQmcRuns();

    expect(count).toBe(1);
    expect(db.update).toHaveBeenCalledOnce();
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock
      .calls[0][0];
    expect(setArgs.status).toBe("failed");
    expect(setArgs.errorMessage).toBe("stale_queued_no_ibm_job_id_swept");
  });

  it("sweeps a stale running row (has ibmJobId) to failed with the running-window reason", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        id: "row-2",
        status: "running",
        ibmJobId: "job-abc",
        createdAt: new Date(Date.now() - (CLOUD_QMC_STALE_RUNNING_HOURS + 1) * 3600_000),
      },
    ]);
    mockUpdateWhere.mockResolvedValue(undefined);

    const count = await sweepStaleCloudQmcRuns();

    expect(count).toBe(1);
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock
      .calls[0][0];
    expect(setArgs.status).toBe("failed");
    expect(setArgs.errorMessage).toBe("stale_pending_swept_exceeded_staleness_window");
  });

  it("does NOT sweep a fresh queued/running row", async () => {
    mockSelectWhere.mockResolvedValue([
      { id: "row-3", status: "queued", ibmJobId: null, createdAt: new Date() },
      { id: "row-4", status: "running", ibmJobId: "job-fresh", createdAt: new Date() },
    ]);

    const count = await sweepStaleCloudQmcRuns();

    expect(count).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("returns 0 and does not throw when the DB select fails", async () => {
    mockSelectWhere.mockRejectedValue(new Error("connection lost"));
    const count = await sweepStaleCloudQmcRuns();
    expect(count).toBe(0);
  });

  it("returns 0 and does not throw when the DB update fails", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        id: "row-5",
        status: "queued",
        ibmJobId: null,
        createdAt: new Date(Date.now() - (CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS + 1) * 3600_000),
      },
    ]);
    mockUpdateWhere.mockRejectedValue(new Error("update failed"));
    const count = await sweepStaleCloudQmcRuns();
    expect(count).toBe(0);
  });
});
