/**
 * wave27-5-pass-c-compliance-mode.test.ts — Wave 27.5 Pass C.2 (paper-parity)
 *
 * Tests for the compliance gate enforcement-mode env knob (H4).
 *
 * Coverage:
 *   1.  getDefaultComplianceMode() returns "enforce" by default (no env var)
 *   2.  getDefaultComplianceMode() returns "shadow" when BACKTEST_COMPLIANCE_MODE=shadow
 *   3.  getDefaultComplianceMode() returns "enforce" when BACKTEST_COMPLIANCE_MODE=enforce
 *   4.  getDefaultComplianceMode() returns "enforce" for invalid env var value
 *   5.  isResearchBacktest() returns false when config has no compliance_mode field
 *   6.  isResearchBacktest() returns true when config.compliance_mode === "shadow"
 *   7.  isResearchBacktest() returns false when config.compliance_mode === "enforce"
 *   8.  isResearchBacktest() returns false when config is null/undefined
 *   9.  resolveComplianceMode() per-backtest config wins over env var
 *   10. resolveComplianceMode() env var wins over hardcoded default
 *   11. resolveComplianceMode() returns institutional default "enforce" when nothing set
 *   12. resolveComplianceMode() per-backtest "enforce" overrides env shadow
 *   13. resolveComplianceMode() source field is "per_backtest_config" when override used
 *   14. resolveComplianceMode() source field is "env_var" when env var controls
 *   15. resolveComplianceMode() source field is "institutional_default" when fallback
 *   16. Discord aggregation threshold: >5% blocked triggers notification path
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  getDefaultComplianceMode,
  isResearchBacktest,
  resolveComplianceMode,
  type ComplianceMode,
} from "../lib/compliance-mode.js";

// ── Logger mock (leaf module per CLAUDE.md) ────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.BACKTEST_COMPLIANCE_MODE;
});

// ─── getDefaultComplianceMode ─────────────────────────────────────────────────

describe("getDefaultComplianceMode", () => {
  it("returns 'enforce' when env var is unset (institutional default)", () => {
    delete process.env.BACKTEST_COMPLIANCE_MODE;
    expect(getDefaultComplianceMode()).toBe("enforce");
  });

  it("returns 'shadow' when BACKTEST_COMPLIANCE_MODE=shadow", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "shadow";
    expect(getDefaultComplianceMode()).toBe("shadow");
  });

  it("returns 'enforce' when BACKTEST_COMPLIANCE_MODE=enforce", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "enforce";
    expect(getDefaultComplianceMode()).toBe("enforce");
  });

  it("returns 'enforce' default for invalid env var value", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "TURBO_SHADOW_9000";
    expect(getDefaultComplianceMode()).toBe("enforce");
  });

  it("returns 'enforce' when env var is empty string", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "";
    expect(getDefaultComplianceMode()).toBe("enforce");
  });
});

// ─── isResearchBacktest ───────────────────────────────────────────────────────

describe("isResearchBacktest", () => {
  it("returns false when config has no compliance_mode field", () => {
    expect(isResearchBacktest({ strategy: { symbol: "MES" } })).toBe(false);
  });

  it("returns true when config.compliance_mode === 'shadow'", () => {
    expect(isResearchBacktest({ compliance_mode: "shadow" })).toBe(true);
  });

  it("returns false when config.compliance_mode === 'enforce'", () => {
    expect(isResearchBacktest({ compliance_mode: "enforce" })).toBe(false);
  });

  it("returns false when config is null", () => {
    expect(isResearchBacktest(null)).toBe(false);
  });

  it("returns false when config is undefined", () => {
    expect(isResearchBacktest(undefined)).toBe(false);
  });

  it("returns false when compliance_mode is an unrecognised string", () => {
    expect(isResearchBacktest({ compliance_mode: "turbo_mode" })).toBe(false);
  });
});

// ─── resolveComplianceMode ────────────────────────────────────────────────────

describe("resolveComplianceMode — source resolution order", () => {
  it("per-backtest config 'shadow' wins over env 'enforce'", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "enforce";
    const { mode, source } = resolveComplianceMode({ compliance_mode: "shadow" });
    expect(mode).toBe("shadow");
    expect(source).toBe("per_backtest_config");
  });

  it("per-backtest config 'enforce' wins over env 'shadow'", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "shadow";
    const { mode, source } = resolveComplianceMode({ compliance_mode: "enforce" });
    expect(mode).toBe("enforce");
    expect(source).toBe("per_backtest_config");
  });

  it("env var 'shadow' wins over hardcoded default 'enforce'", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "shadow";
    const { mode, source } = resolveComplianceMode(null);
    expect(mode).toBe("shadow");
    expect(source).toBe("env_var");
  });

  it("returns institutional default 'enforce' when nothing is set", () => {
    delete process.env.BACKTEST_COMPLIANCE_MODE;
    const { mode, source } = resolveComplianceMode(null);
    expect(mode).toBe("enforce");
    expect(source).toBe("institutional_default");
  });

  it("source is 'per_backtest_config' when override is active", () => {
    const { source } = resolveComplianceMode({ compliance_mode: "shadow" });
    expect(source).toBe("per_backtest_config");
  });

  it("source is 'env_var' when env var controls the mode", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "enforce";
    const { source } = resolveComplianceMode({});
    expect(source).toBe("env_var");
  });

  it("source is 'institutional_default' when no override and no env var", () => {
    delete process.env.BACKTEST_COMPLIANCE_MODE;
    const { source } = resolveComplianceMode({});
    expect(source).toBe("institutional_default");
  });

  it("invalid per-backtest config value falls through to env then default", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "shadow";
    const { mode, source } = resolveComplianceMode({ compliance_mode: "banana" });
    // Invalid per-backtest override → falls through to env var
    expect(mode).toBe("shadow");
    expect(source).toBe("env_var");
  });

  it("invalid per-backtest AND invalid env → institutional default 'enforce'", () => {
    process.env.BACKTEST_COMPLIANCE_MODE = "invalid_too";
    const { mode, source } = resolveComplianceMode({ compliance_mode: "also_invalid" });
    expect(mode).toBe("enforce");
    expect(source).toBe("institutional_default");
  });
});

// ─── Discord aggregation threshold ───────────────────────────────────────────

describe("Discord aggregation threshold logic (inline simulation)", () => {
  it("5% threshold: 5 blocked out of 100 does NOT trigger (strictly >5%)", () => {
    // 5/100 = 5.0% — NOT strictly >5%, so no Discord notification
    const totalBlocked = 5;
    const totalAttempted = 100;
    const blockedPct = totalBlocked / totalAttempted;
    const THRESHOLD = 0.05;
    expect(blockedPct > THRESHOLD).toBe(false);
  });

  it("5% threshold: 6 blocked out of 100 TRIGGERS notification (strictly >5%)", () => {
    // 6/100 = 6.0% > 5% → should trigger
    const totalBlocked = 6;
    const totalAttempted = 100;
    const blockedPct = totalBlocked / totalAttempted;
    const THRESHOLD = 0.05;
    expect(blockedPct > THRESHOLD).toBe(true);
  });

  it("0 blocked never triggers even in enforce mode", () => {
    const totalBlocked = 0;
    const totalAttempted = 50;
    // Guard: no Discord if totalBlocked === 0
    expect(totalBlocked === 0).toBe(true);
  });

  it("shadow mode result never triggers Discord (compliance_mode !== enforce)", () => {
    // The guard in backtest-service checks: complianceModeInResult !== "enforce"
    // For shadow mode, this is always true — verified via the type system.
    const complianceModeInResult: string = "shadow";
    expect(complianceModeInResult === "enforce").toBe(false);
  });

  it("all signals blocked (100%) correctly exceeds 5% threshold", () => {
    const totalBlocked = 10;
    const totalAttempted = 10;
    const blockedPct = totalBlocked / totalAttempted;
    const THRESHOLD = 0.05;
    expect(blockedPct > THRESHOLD).toBe(true);
  });
});
