/**
 * paper-execution-cache-ttl-env.test.ts — M4 (capital-decision freshness path)
 *
 * Proves the env-overridable, NaN/≤0-clamped parse used for the staleness-gating
 * constants in paper-execution-service.ts:
 *   - KILL_SWITCH_CACHE_TTL_MS   (default 5_000)
 *   - COMPLIANCE_CACHE_TTL_MS    (default 60_000)
 *   - CALENDAR_FAILURE_WINDOW_MS (default 600_000)
 *   - CALENDAR_FAILURE_THRESHOLD (default 3)
 *
 * These constants are module-private (computed at load time) and the host service
 * has heavy module-load side effects, so we validate the load-bearing parse
 * expression in isolation. The expression MUST stay byte-identical to the one in
 * paper-execution-service.ts. Institutional bar: validated env parse, default
 * preserved, no NaN/negative slips through onto a capital-freshness gate.
 */

import { describe, it, expect, afterEach } from "vitest";

/** Exact mirror of the parse used for the *_MS staleness constants. */
function parsePositiveIntEnv(raw: string | undefined, def: number): number {
  const v = parseInt(raw ?? String(def), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

describe("paper-execution staleness-gate env parse (M4)", () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("KILL_SWITCH_CACHE_TTL_MS (default 5000)", () => {
    it("default preserved when unset", () => {
      delete process.env.KILL_SWITCH_CACHE_TTL_MS;
      expect(parsePositiveIntEnv(process.env.KILL_SWITCH_CACHE_TTL_MS, 5000)).toBe(5000);
    });
    it("honors a valid positive override", () => {
      process.env.KILL_SWITCH_CACHE_TTL_MS = "2500";
      expect(parsePositiveIntEnv(process.env.KILL_SWITCH_CACHE_TTL_MS, 5000)).toBe(2500);
    });
    it("falls back to default on NaN", () => {
      process.env.KILL_SWITCH_CACHE_TTL_MS = "abc";
      expect(parsePositiveIntEnv(process.env.KILL_SWITCH_CACHE_TTL_MS, 5000)).toBe(5000);
    });
    it("falls back to default on ≤0", () => {
      process.env.KILL_SWITCH_CACHE_TTL_MS = "0";
      expect(parsePositiveIntEnv(process.env.KILL_SWITCH_CACHE_TTL_MS, 5000)).toBe(5000);
      process.env.KILL_SWITCH_CACHE_TTL_MS = "-100";
      expect(parsePositiveIntEnv(process.env.KILL_SWITCH_CACHE_TTL_MS, 5000)).toBe(5000);
    });
  });

  describe("COMPLIANCE_CACHE_TTL_MS (default 60000)", () => {
    it("default preserved when unset", () => {
      delete process.env.COMPLIANCE_CACHE_TTL_MS;
      expect(parsePositiveIntEnv(process.env.COMPLIANCE_CACHE_TTL_MS, 60000)).toBe(60000);
    });
    it("honors a valid override", () => {
      process.env.COMPLIANCE_CACHE_TTL_MS = "30000";
      expect(parsePositiveIntEnv(process.env.COMPLIANCE_CACHE_TTL_MS, 60000)).toBe(30000);
    });
    it("falls back to default on garbage", () => {
      process.env.COMPLIANCE_CACHE_TTL_MS = "-1";
      expect(parsePositiveIntEnv(process.env.COMPLIANCE_CACHE_TTL_MS, 60000)).toBe(60000);
    });
  });

  describe("CALENDAR_FAILURE_WINDOW_MS (default 600000)", () => {
    it("default preserved when unset", () => {
      delete process.env.CALENDAR_FAILURE_WINDOW_MS;
      expect(parsePositiveIntEnv(process.env.CALENDAR_FAILURE_WINDOW_MS, 600000)).toBe(600000);
    });
    it("honors a valid override", () => {
      process.env.CALENDAR_FAILURE_WINDOW_MS = "120000";
      expect(parsePositiveIntEnv(process.env.CALENDAR_FAILURE_WINDOW_MS, 600000)).toBe(120000);
    });
  });

  describe("CALENDAR_FAILURE_THRESHOLD (default 3)", () => {
    it("default preserved when unset", () => {
      delete process.env.CALENDAR_FAILURE_THRESHOLD;
      expect(parsePositiveIntEnv(process.env.CALENDAR_FAILURE_THRESHOLD, 3)).toBe(3);
    });
    it("honors a valid override", () => {
      process.env.CALENDAR_FAILURE_THRESHOLD = "5";
      expect(parsePositiveIntEnv(process.env.CALENDAR_FAILURE_THRESHOLD, 3)).toBe(5);
    });
    it("falls back to default on NaN / ≤0", () => {
      process.env.CALENDAR_FAILURE_THRESHOLD = "xyz";
      expect(parsePositiveIntEnv(process.env.CALENDAR_FAILURE_THRESHOLD, 3)).toBe(3);
      process.env.CALENDAR_FAILURE_THRESHOLD = "0";
      expect(parsePositiveIntEnv(process.env.CALENDAR_FAILURE_THRESHOLD, 3)).toBe(3);
    });
  });
});
