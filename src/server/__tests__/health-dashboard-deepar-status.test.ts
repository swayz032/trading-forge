/**
 * Unit tests for health-dashboard.ts::deriveDeepARDashboardStatus()
 *
 * deep-scan (DeepAR HIGH-2, 2026-07-17): the dashboard's `advancedModels.deepar.status`
 * used to be hardcoded "ok" whenever the getDeepARRuntimeStatus() RPC merely resolved
 * (it never rejects), even when trainingFresh=false / forecastFresh=false / daysTracked=0
 * — a false-green that hid ~2.5 months of DeepAR silence from the operator. This test
 * exercises the pure derivation function directly (no HTTP) so the false-green
 * regression is caught without depending on live DB freshness state.
 *
 * Note on import order: health-dashboard.ts's dependency chain (via deepar-service.ts)
 * imports `logger` from "../index.js", which forms a circular import back to
 * routes/health-dashboard.ts (index.ts mounts healthDashboardRoutes). Importing
 * "../routes/health-dashboard.js" as the FIRST module in a fresh test file re-enters
 * that cycle mid-evaluation and yields an uninitialized `router` export. The existing
 * integration suite (health-dashboard.test.ts) sidesteps this by entering through
 * "../index.js" first; we do the same here before pulling the named export.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";

let server: Server;
let deriveDeepARDashboardStatus: typeof import("../routes/health-dashboard.js")["deriveDeepARDashboardStatus"];

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  delete process.env.API_KEY;

  const { app } = await import("../index.js");
  ({ deriveDeepARDashboardStatus } = await import("../routes/health-dashboard.js"));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
}, 15_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("deriveDeepARDashboardStatus", () => {
  it("reports ok when both training and forecast are fresh", () => {
    const result = deriveDeepARDashboardStatus({ trainingFresh: true, forecastFresh: true });
    expect(result.status).toBe("ok");
    expect(result.staleReason).toBeNull();
  });

  it("reports stale (not ok) when both training and forecast are stale", () => {
    // This is the exact production scenario the HIGH-2 finding caught:
    // trainingFresh:false / forecastFresh:false / daysTracked:0 / latestTrainingAt ~2.5mo stale.
    const result = deriveDeepARDashboardStatus({ trainingFresh: false, forecastFresh: false });
    expect(result.status).not.toBe("ok");
    expect(result.status).toBe("stale");
    expect(result.staleReason).toBe("both_stale");
  });

  it("reports degraded (not ok) when only training is fresh", () => {
    const result = deriveDeepARDashboardStatus({ trainingFresh: true, forecastFresh: false });
    expect(result.status).not.toBe("ok");
    expect(result.status).toBe("degraded");
    expect(result.staleReason).toBe("forecast_stale");
  });

  it("reports degraded (not ok) when only forecast is fresh", () => {
    const result = deriveDeepARDashboardStatus({ trainingFresh: false, forecastFresh: true });
    expect(result.status).not.toBe("ok");
    expect(result.status).toBe("degraded");
    expect(result.staleReason).toBe("training_stale");
  });
});
