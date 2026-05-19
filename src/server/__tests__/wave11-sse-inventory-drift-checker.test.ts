/**
 * Wave 11 (2026-05-17) — SSE inventory drift checker regression.
 *
 * Pins the parser shape and end-to-end behavior of `buildSseInventoryDriftItems`
 * (in `src/server/lib/system-topology.ts`).
 *
 * Why: the Wave 9 architect found that 3 new SSE events (walkforward:window_complete,
 * compliance:drift_detected, pine_export:failed) were added to the SSEEvent union
 * but never documented in the System Map inventory — and `system-map:sync` regen
 * doesn't touch the manual inventory section. Wave 11 added a drift checker that
 * fails the CI gate when the surfaces diverge. This test pins the contract.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), "src/server/lib/system-topology.ts"),
  "utf-8",
);
const MAP = fs.readFileSync(
  path.resolve(process.cwd(), "Trading Forge System Map v2.md"),
  "utf-8",
);
const SSE_TYPES = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "Trading_forge_frontend/amber-vision-main/src/types/sse-events.ts",
  ),
  "utf-8",
);

describe("Wave 11 — SSE inventory drift checker", () => {
  it("system-topology.ts exports the drift helpers", () => {
    expect(SOURCE).toMatch(/function buildSseInventoryDriftItems/);
    expect(SOURCE).toMatch(/function extractSseUnionTypes/);
    expect(SOURCE).toMatch(/function extractSseInventoryEvents/);
  });

  it("checkSystemMapDrift merges SSE drift items into the result", () => {
    const checkFnIdx = SOURCE.indexOf("export async function checkSystemMapDrift");
    expect(checkFnIdx).toBeGreaterThan(0);
    const fnBody = SOURCE.slice(checkFnIdx, checkFnIdx + 1500);
    expect(fnBody).toMatch(/buildSseInventoryDriftItems\s*\(\s*rootDir/);
  });

  it("syncSystemMapArtifacts merges SSE drift items into the result", () => {
    const syncFnIdx = SOURCE.indexOf("export async function syncSystemMapArtifacts");
    expect(syncFnIdx).toBeGreaterThan(0);
    const fnBody = SOURCE.slice(syncFnIdx, syncFnIdx + 1500);
    expect(fnBody).toMatch(/buildSseInventoryDriftItems/);
  });

  it("System Map inventory contains all Wave 9/W9-3 events that originally exposed the gap", () => {
    const inventorySection = MAP.match(/## §SSE Events Canonical Inventory([\s\S]*)/);
    expect(inventorySection).toBeTruthy();
    const inv = inventorySection![1];
    for (const event of [
      "walkforward:window_complete",
      "compliance:drift_detected",
      "pine_export:failed",
    ]) {
      expect(inv).toContain(event);
    }
  });

  it("SSEEvent union still has the same Wave 9/W9-3 events", () => {
    for (const event of [
      "walkforward:window_complete",
      "compliance:drift_detected",
      "pine_export:failed",
    ]) {
      expect(SSE_TYPES).toContain(`type: "${event}"`);
    }
  });

  it("inventory does NOT document the dead macro:regime-updated event", () => {
    const inventorySection = MAP.match(/## §SSE Events Canonical Inventory([\s\S]*)/);
    const inv = inventorySection![1];
    expect(inv).not.toMatch(/^###[^\n]*\bmacro:regime-updated\b/m);
  });
});
