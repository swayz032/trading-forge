/**
 * dormant-activation-sweep-2026-07-17.test.ts
 *
 * Class-regression guard for the "built component, zero callers" species found
 * repeatedly this session (institutional-regime classifier, eligibility gate,
 * parameter-drift, market-internals-service — all re-baseline-risk, staged in
 * docs/engine-v2-shadow-contract-draft.md). A repo-wide sweep for
 * activation-shaped exported functions (start-, init-, subscribe-, connect-prefixed)
 * found two more instances with zero callers anywhere in the repo:
 * startComputeFailoverMonitor and startNetworkFailoverMonitor.
 *
 * Only startComputeFailoverMonitor was safe to wire — confirmed by an
 * independent grader that nothing branches on getComputeTarget()'s value for
 * real routing (only pipeline-control-service.ts surfaces it in a status
 * payload). startNetworkFailoverMonitor was NOT wired: its own module doc
 * claims "observation layer, not an execution modifier", but
 * isConnectivityDegraded() is actually consumed by kill-switch.ts's Layer 4
 * (unscoped — no account parameter, unlike Layers 2/3), gating
 * isHaltedForProduction() ahead of every openPosition(). Wiring it would
 * activate a real, system-wide, never-before-exercised trade-halt path with
 * no operator recovery route (confirm-tethering endpoint doesn't exist).
 * Staged instead in docs/engine-v2-shadow-contract-draft.md as a
 * coordination-packet entry.
 *
 * This test is a source-contract check (mirrors the established pattern for
 * verifying scheduler.ts wiring elsewhere in this suite) — it does not import
 * index.ts directly, since index.ts is a top-level bootstrap script with real
 * side effects (DB migrations, HTTP listen, WS connections) that every other
 * test in this suite deliberately avoids triggering.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const INDEX_PATH = path.join(REPO_ROOT, "src", "server", "index.ts");

describe("dormant-activation sweep — compute-failover monitor wired at boot", () => {
  const indexSrc = readFileSync(INDEX_PATH, "utf8");

  it("index.ts imports and calls startComputeFailoverMonitor", () => {
    expect(indexSrc).toContain("startComputeFailoverMonitor");
    expect(indexSrc).toContain("startComputeFailoverMonitor();");
  });

  it("gracefulShutdown clears the un-unref'd health-check timer", () => {
    const shutdownIdx = indexSrc.indexOf("function gracefulShutdown");
    expect(shutdownIdx).toBeGreaterThan(-1);
    const shutdownBody = indexSrc.slice(shutdownIdx, shutdownIdx + 2000);
    expect(shutdownBody).toContain("stopComputeFailoverMonitor();");
  });

  // Regression guard for the exact mistake caught by grading: don't re-wire
  // startNetworkFailoverMonitor() without also resolving the kill-switch
  // Layer 4 consequence (unscoped halt, no operator recovery route). If this
  // ever needs to change, it must be a deliberate decision documented in
  // docs/engine-v2-shadow-contract-draft.md, not an incidental re-add.
  it("index.ts does NOT call startNetworkFailoverMonitor (reserved, not wired)", () => {
    expect(indexSrc).not.toContain("startNetworkFailoverMonitor();");
  });
});
