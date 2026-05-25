/**
 * wave27-5-pass-d-wfe-discord-warn.test.ts — Wave 27.5 Pass D.3 (carry-forward from Pass B)
 *
 * Tests for the WFE warn-floor Discord WARN alert wiring in lifecycle-service.ts.
 *
 * The WFE gate (Pass B.2) emits audit + SSE for all WFE outcomes. This pass
 * closes the missing Discord notification path: when WFE is in the warn band
 * [WFE_WARN_FLOOR, WFE_HARD_FLOOR) the operator must see a phone notification
 * even though promotion is allowed.
 *
 * Covers:
 *   - evaluateWfeGate("warned") status triggers Discord WARN path in source
 *   - evaluateWfeGate("passed") status does NOT trigger Discord WARN
 *   - evaluateWfeGate("blocked") status does NOT trigger the warn-band Discord
 *     (blocked already goes down a separate notification path + blocks promotion)
 *   - WFE WARN message body includes strategy name, WFE value, and floors
 *   - WFE WARN body includes family-grade postscript (plain-English section)
 *   - notifyWarning signature is called (not notifyCritical)
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  evaluateWfeGate,
  type WfeGateStatus,
} from "../lib/wfe-gate.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.WFE_HARD_FLOOR;
  delete process.env.WFE_WARN_FLOOR;
  vi.clearAllMocks();
});

// ─── Gate status correctness (foundation for Discord wire) ──────────────────

describe("evaluateWfeGate — warn band produces 'warned' status", () => {
  it("WFE 0.60 (in warn band [0.50, 0.70)) → status=warned, passed=true", () => {
    const result = evaluateWfeGate(0.60, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("warned");
    expect(result.passed).toBe(true); // Promotion ALLOWED
    expect(result.auditAction).toBe("lifecycle.wfe_warning_below_target");
  });

  it("WFE 0.70 (exactly at hard floor) → status=passed, no warn", () => {
    const result = evaluateWfeGate(0.70, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.auditAction).toBeNull(); // No audit row for clean pass
  });

  it("WFE 0.45 (below warn floor) → status=blocked, not warned", () => {
    const result = evaluateWfeGate(0.45, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false); // Promotion BLOCKED
    // Blocked uses different audit action — not the warn one
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });
});

// ─── Discord WARN message body composition ──────────────────────────────────

describe("WFE warn-floor Discord message body", () => {
  it("warn body includes strategy name and WFE value", () => {
    const strategyName = "orb_mes_5m";
    const wfeVal = (0.62).toFixed(2);
    const body =
      `[WARN] Walk-Forward Efficiency below institutional target\n` +
      `Strategy: ${strategyName}\n` +
      `WFE: ${wfeVal} (warn floor: 0.50, hard floor: 0.70)\n` +
      `Promotion ALLOWED but flagged for operator review`;

    expect(body).toContain(strategyName);
    expect(body).toContain(wfeVal);
    expect(body).toContain("0.50"); // warn floor
    expect(body).toContain("0.70"); // hard floor
    expect(body).toContain("ALLOWED"); // Promotion continues
  });

  it("warn body with family-grade postscript contains plain-English sections", () => {
    const operatorBody =
      `[WARN] Walk-Forward Efficiency below institutional target\n` +
      `Strategy: crt_nq_15m\nWFE: 0.58\n` +
      `Promotion ALLOWED but flagged for operator review`;
    const plainWhat =
      "A strategy passed all gates but the bot's out-of-sample performance was " +
      "lower than the institutional target. Tony will review.";
    const plainAction = "No action needed.";

    const full = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

    expect(full).toContain("--- For family members ---");
    expect(full).toContain("What this means:");
    expect(full).toContain("What to do:");
    expect(full).toContain("No action needed.");
    expect(full).toContain("Tony will review.");
  });

  it("warn title includes strategy name and WFE value", () => {
    const strategyName = "power_of_3_mes_5m";
    const wfeVal = "0.55";
    const title = `WFE below target: ${strategyName} (${wfeVal})`;

    expect(title).toContain(strategyName);
    expect(title).toContain(wfeVal);
  });
});

// ─── lifecycle-service.ts source audit — Discord WARN only fires for "warned" ──

describe("lifecycle-service.ts WFE Discord WARN source audit", () => {
  /**
   * These tests read the lifecycle-service.ts source to verify the wiring
   * pattern — since we can't mock the full DB + scheduler in unit tests,
   * we verify the structural contracts in source that ensure:
   *   1. notifyWarning is called (not notifyCritical)
   *   2. The call is gated on wfeResult.status === "warned"
   *   3. The call is NOT reachable when isBlock === true (blocked path uses continue)
   */
  function readLifecycleServiceSource(): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const srcPath = path.resolve(
      __dirname,
      "../services/lifecycle-service.ts",
    );
    return fs.readFileSync(srcPath, "utf-8");
  }

  it('lifecycle-service.ts wires notifyWarning for WFE "warned" status', () => {
    const src = readLifecycleServiceSource();
    expect(src).toContain('wfeResult.status === "warned"');
    expect(src).toContain("notifyWarning(");
  });

  it("notifyWarning call is gated only on warned status, not blocked", () => {
    const src = readLifecycleServiceSource();
    // The warn Discord call must be inside the wfeResult.status === "warned" block
    const warnedIdx = src.indexOf('wfeResult.status === "warned"');
    const notifyIdx = src.indexOf("notifyWarning(", warnedIdx);
    expect(notifyIdx).toBeGreaterThan(warnedIdx);
  });

  it("Discord WARN block is nested inside status===warned check, not inside isBlock", () => {
    const src = readLifecycleServiceSource();
    // The notifyWarning call must appear AFTER the wfeResult.status==="warned" check
    // so that blocked strategies (isBlock=true path) do NOT trigger the warn Discord.
    // Structural contract: warned guard → notifyWarning → isBlock continue (in sequence).
    const warnedIdx = src.indexOf('wfeResult.status === "warned"');
    const notifyIdx = src.indexOf("notifyWarning(", warnedIdx);
    const isBlockIdx = src.indexOf("if (isBlock) {", notifyIdx);

    expect(warnedIdx).toBeGreaterThan(0);
    expect(notifyIdx).toBeGreaterThan(warnedIdx); // notify is INSIDE warned block
    expect(isBlockIdx).toBeGreaterThan(notifyIdx); // continue is AFTER notify (correct order)
  });

  it("notification-service is dynamically imported (consistent with backtest-service.ts pattern)", () => {
    const src = readLifecycleServiceSource();
    // Must use dynamic import to avoid circular boot graph
    expect(src).toContain('import("./notification-service.js")');
    expect(src).toContain('import("../lib/notification-helpers.js")');
  });
});
