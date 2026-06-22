/**
 * wave-a-critic-cpcv-purge.test.ts
 *
 * Wave A Critic Fix 2 — CPCV purge boundary alignment regression suite.
 *
 * Finding #16 (HIGH): Two separate purge-check implementations existed:
 *   - `harness-base.ts::checkCpcvPurge` — Date objects with `<=`
 *   - `quantum-disagreement.ts::checkPurgeViolation` — ISO string with `<=`
 *
 * Sub-day timestamp comparison diverges between string and Date.
 * The equality boundary (oos_start == is_end) was the specific failure case
 * that could grade the same fold differently across the two harnesses.
 *
 * Fix: `checkPurgeViolation` now delegates to `checkCpcvPurge` (canonical).
 * Both use Date objects with `!(oosStartDate > isEndDate)` — so equality IS
 * a purge violation.
 *
 * Tests:
 *   1. Equality boundary (oos_start == is_end to the millisecond) → violation
 *   2. Sub-day timestamp overlap → violation
 *   3. Clean separation (oos_start > is_end) → null (clean)
 *   4. Delegation: checkPurgeViolation delegates to checkCpcvPurge (same result)
 *   5. Date-only string equality boundary → violation
 */

import { describe, it, expect } from "vitest";
import { checkCpcvPurge } from "../lib/replay/harness-base.js";
import { checkPurgeViolation } from "../lib/replay/quantum-disagreement.js";

// ─── Fix 2 — boundary alignment ───────────────────────────────────────────────

describe("Fix 2 — CPCV purge boundary alignment (Finding #16)", () => {

  describe("checkCpcvPurge (canonical — harness-base.ts)", () => {
    it("equality boundary: oos_start == is_end to the millisecond → violation", () => {
      const ts = "2026-01-15T09:00:00.000Z";
      const violation = checkCpcvPurge("fold-1", ts, ts);
      expect(violation).not.toBeNull();
      expect(violation).toMatch(/PURGE VIOLATION/);
      expect(violation).toMatch(/boundary equality/);
    });

    it("sub-day overlap: oos_start is 1 second BEFORE is_end → violation", () => {
      const isEnd   = "2026-01-15T09:00:00.000Z";
      const oosStart = "2026-01-15T08:59:59.999Z";  // 1ms before is_end
      const violation = checkCpcvPurge("fold-2", isEnd, oosStart);
      expect(violation).not.toBeNull();
      expect(violation).toMatch(/PURGE VIOLATION/);
    });

    it("clean separation: oos_start is 1 day after is_end → null (no violation)", () => {
      const isEnd    = "2026-01-15T09:00:00.000Z";
      const oosStart = "2026-01-16T09:00:00.000Z";  // exactly 1 day later
      const violation = checkCpcvPurge("fold-3", isEnd, oosStart);
      expect(violation).toBeNull();
    });

    it("clean separation: oos_start is 1 millisecond after is_end → null (no violation)", () => {
      const isEnd    = "2026-01-15T09:00:00.000Z";
      const oosStart = "2026-01-15T09:00:00.001Z";  // 1ms after
      const violation = checkCpcvPurge("fold-4", isEnd, oosStart);
      expect(violation).toBeNull();
    });

    it("date-only strings: oos_start == is_end as 'YYYY-MM-DD' → violation", () => {
      const date = "2026-01-15";
      const violation = checkCpcvPurge("fold-5", date, date);
      expect(violation).not.toBeNull();
      expect(violation).toMatch(/PURGE VIOLATION/);
    });

    it("date-only strings: oos_start one day before is_end → violation", () => {
      const isEnd    = "2026-01-15";
      const oosStart = "2026-01-14";
      const violation = checkCpcvPurge("fold-6", isEnd, oosStart);
      expect(violation).not.toBeNull();
    });

    it("date-only strings: oos_start one day after is_end → null (clean)", () => {
      const isEnd    = "2026-01-15";
      const oosStart = "2026-01-16";
      const violation = checkCpcvPurge("fold-7", isEnd, oosStart);
      expect(violation).toBeNull();
    });

    it("violation message includes fold ID", () => {
      const ts = "2026-02-01T00:00:00.000Z";
      const violation = checkCpcvPurge("my-specific-fold-abc123", ts, ts);
      expect(violation).toMatch(/my-specific-fold-abc123/);
    });
  });

  describe("checkPurgeViolation (quantum-disagreement.ts — delegates to checkCpcvPurge)", () => {
    it("equality boundary: oos_start == is_end → violation (delegates to canonical)", () => {
      const ts = "2026-01-15T09:00:00.000Z";
      const violation = checkPurgeViolation("fold-q1", ts, ts);
      expect(violation).not.toBeNull();
      expect(violation).toMatch(/PURGE VIOLATION/);
    });

    it("sub-day overlap: oos_start 1ms before is_end → violation", () => {
      const isEnd    = "2026-01-15T09:00:00.000Z";
      const oosStart = "2026-01-15T08:59:59.999Z";
      const violation = checkPurgeViolation("fold-q2", isEnd, oosStart);
      expect(violation).not.toBeNull();
    });

    it("clean: oos_start 1ms after is_end → null", () => {
      const isEnd    = "2026-01-15T09:00:00.000Z";
      const oosStart = "2026-01-15T09:00:00.001Z";
      const violation = checkPurgeViolation("fold-q3", isEnd, oosStart);
      expect(violation).toBeNull();
    });

    it("delegation parity: checkPurgeViolation produces identical result to checkCpcvPurge for all inputs", () => {
      const testCases: Array<[string, string, string]> = [
        ["fold-a", "2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.000Z"],  // equality
        ["fold-b", "2026-01-15T12:00:00.000Z", "2026-01-15T11:59:59.999Z"],  // sub-day overlap
        ["fold-c", "2026-01-15T12:00:00.000Z", "2026-01-15T12:00:00.001Z"],  // 1ms after (clean)
        ["fold-d", "2026-01-15",                "2026-01-15"],                // date-only equality
        ["fold-e", "2026-01-15",                "2026-01-16"],                // date-only clean
      ];
      for (const [foldId, isEnd, oosStart] of testCases) {
        const canonical = checkCpcvPurge(foldId, isEnd, oosStart);
        const delegate  = checkPurgeViolation(foldId, isEnd, oosStart);
        // Both should agree on violation/clean — content may differ in message format
        expect(Boolean(delegate)).toBe(
          Boolean(canonical),
          `Mismatch on foldId=${foldId}, isEnd=${isEnd}, oosStart=${oosStart}`,
        );
      }
    });
  });

  describe("pre-fix regression guard: string comparison would have produced wrong result", () => {
    it("sub-day sub-second equality: string '==' would be true, but Date objects ALSO confirm violation", () => {
      // When strings are identical, both string `<=` and Date `<=` agree on violation.
      // But when strings differ in format (e.g. one has fractional seconds), string
      // comparison can disagree with Date comparison.
      // This test confirms the Date-based canonical always handles the boundary case.
      const isEnd    = "2026-03-10T15:55:00.000Z";
      const oosStart = "2026-03-10T15:55:00.000Z";
      // String comparison: oosStart <= isEnd → both equal → violation (correct)
      // Date comparison:  oosStartDate <= isEndDate → equal → violation (correct)
      const violation = checkCpcvPurge("fence-post", isEnd, oosStart);
      expect(violation).not.toBeNull();
      expect(violation).toMatch(/boundary equality/);
    });

    it("timezone-equivalent timestamps: Z and +00:00 both resolve to same Date → violation", () => {
      const isEnd    = "2026-03-10T15:55:00.000Z";
      const oosStart = "2026-03-10T15:55:00.000+00:00";  // same instant, different format
      // Date-based comparison handles this correctly; string comparison would see DIFFERENT strings
      // and might incorrectly rule them non-equal.
      const violation = checkCpcvPurge("tz-equiv", isEnd, oosStart);
      // They resolve to the same millisecond → boundary equality → violation
      expect(violation).not.toBeNull();
    });
  });
});
