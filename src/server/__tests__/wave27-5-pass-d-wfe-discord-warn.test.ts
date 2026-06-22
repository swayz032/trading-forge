/**
 * wave27-5-pass-d-wfe-discord-warn.test.ts — Wave 27.5 Pass D.3 (carry-forward from Pass B)
 *
 * Tests for the WFE gate Discord alert wiring in lifecycle-service.ts.
 *
 * PARITY FIX 2026-06-22: The [0.50, 0.70) "warn-and-allow" band was removed.
 * All WFE values below WFE_HARD_FLOOR (0.70) now BLOCK promotion (status="blocked").
 * The lifecycle-service.ts Discord WARN branch that fired for status="warned" is
 * removed. The source-audit tests now verify the NEW contract: no "warned" branch
 * in the service, and the isBlock guard is the only continuation gate.
 *
 * Retained tests that are still valid:
 *   - evaluateWfeGate gate-status correctness (updated for new behavior)
 *   - Discord WARN message body composition (helper functions unchanged)
 *   - Source-audit of lifecycle-service.ts (updated to verify removal of warned branch)
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

// ─── Gate status correctness (parity fix 2026-06-22) ───────────────────────
//
// [0.50, 0.70) was previously "warned, passed=true". It is now "blocked, passed=false".
// There is no "warned" status returned at runtime — the WfeGateStatus union retains
// the variant for backward-compat with serialized audit rows only.

describe("evaluateWfeGate — warn band now BLOCKED (parity fix 2026-06-22)", () => {
  it("WFE 0.60 (in former warn band [0.50, 0.70)) → status=blocked, passed=false", () => {
    const result = evaluateWfeGate(0.60, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false); // Promotion BLOCKED (was allowed before fix)
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("WFE 0.70 (exactly at hard floor) → status=passed, no audit", () => {
    const result = evaluateWfeGate(0.70, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.auditAction).toBeNull(); // No audit row for clean pass
  });

  it("WFE 0.45 (below warn floor) → status=blocked, passed=false", () => {
    const result = evaluateWfeGate(0.45, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false); // Promotion BLOCKED
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });
});

// ─── Discord BLOCK message body composition ─────────────────────────────────
//
// The old "ALLOWED" Discord warn body is replaced by the block path.
// These tests verify the appendFamilyGradePostscript helper still works for
// the block notification body format (which lifecycle-service.ts uses for
// any WFE block via the standard notifyWarning/notifyCritical path).

describe("WFE block Discord message body (parity fix 2026-06-22)", () => {
  it("block body includes strategy name and WFE value", () => {
    const strategyName = "orb_mes_5m";
    const wfeVal = (0.62).toFixed(2);
    const body =
      `[BLOCK] Walk-Forward Efficiency below institutional hard floor\n` +
      `Strategy: ${strategyName}\n` +
      `WFE: ${wfeVal} (warn floor: 0.50, hard floor: 0.70)\n` +
      `Promotion BLOCKED — strategy must improve WFE above 0.70`;

    expect(body).toContain(strategyName);
    expect(body).toContain(wfeVal);
    expect(body).toContain("0.50"); // warn floor
    expect(body).toContain("0.70"); // hard floor
    expect(body).toContain("BLOCKED"); // Promotion blocked (was ALLOWED before fix)
  });

  it("block body with family-grade postscript contains plain-English sections", () => {
    const operatorBody =
      `[BLOCK] Walk-Forward Efficiency below institutional hard floor\n` +
      `Strategy: crt_nq_15m\nWFE: 0.58\n` +
      `Promotion BLOCKED — strategy must improve WFE above 0.70`;
    const plainWhat =
      "A strategy's out-of-sample performance was below the institutional target. " +
      "It cannot be promoted until the walk-forward efficiency improves.";
    const plainAction = "No action needed — Tony will re-run the backtest.";

    const full = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

    expect(full).toContain("--- For family members ---");
    expect(full).toContain("What this means:");
    expect(full).toContain("What to do:");
    expect(full).toContain("Tony will re-run the backtest.");
    expect(full).toContain("institutional target");
  });

  it("block title includes strategy name and WFE value", () => {
    const strategyName = "power_of_3_mes_5m";
    const wfeVal = "0.55";
    const title = `WFE BLOCKED: ${strategyName} — wfe_overall ${wfeVal} below hard floor 0.70`;

    expect(title).toContain(strategyName);
    expect(title).toContain(wfeVal);
  });
});

// ─── lifecycle-service.ts source audit — parity fix 2026-06-22 ──────────────
//
// These tests read lifecycle-service.ts source to verify the NEW contract:
//   1. The "warned" Discord branch has been REMOVED (no wfeResult.status==="warned" check)
//   2. isBlock is the sole gate: when blocked, `continue` skips the strategy
//   3. The legacy-null path (status="legacy_null") does NOT block (no isBlock=true)
//
// Since we can't mock the full DB + scheduler in unit tests, source-reading
// is the correct structural-verification pattern (mirrors original approach).

describe("lifecycle-service.ts WFE source audit — parity fix 2026-06-22", () => {
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

  it('lifecycle-service.ts does NOT contain wfeResult.status === "warned" (warn-and-allow branch removed)', () => {
    const src = readLifecycleServiceSource();
    // The old warn-and-allow Discord branch is gone — parity fix 2026-06-22
    expect(src).not.toContain('wfeResult.status === "warned"');
  });

  it('lifecycle-service.ts uses isBlock as sole continue gate for WFE (const isBlock = wfeResult.status === "blocked")', () => {
    const src = readLifecycleServiceSource();
    // The only gate after audit insert is `if (isBlock) { continue; }`
    expect(src).toContain('const isBlock = wfeResult.status === "blocked"');
    expect(src).toContain("if (isBlock) {");
    expect(src).toContain("continue;");
  });

  it("lifecycle-service.ts WFE block path log message states hard floor 0.70", () => {
    const src = readLifecycleServiceSource();
    // The block message must reference the hard floor
    expect(src).toContain("WFE gate BLOCKED PAPER→DEPLOY_READY: wfe_overall below hard floor (0.70)");
  });

  it("lifecycle-service.ts WFE block comment documents parity fix", () => {
    const src = readLifecycleServiceSource();
    // The parity fix must be documented in source
    expect(src).toContain("Parity fix 2026-06-22");
  });
});
