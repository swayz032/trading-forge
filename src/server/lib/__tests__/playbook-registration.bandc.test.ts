/**
 * playbook-registration.bandc.test.ts — Band C (spec-execution-semantics, 2026-07-02)
 *
 * Unit tests for deriveCategoryFromConditionSpec() — the follow-up fix that
 * gives condition-compiled specs a RESOLVED playbook category instead of the
 * blanket CONTINUATION_STRATS default `deriveCategoryFromArchetype(null)`
 * produces. A SEPARATE file from Band B's playbook-registration.test.ts (not
 * edited) to keep file ownership clean.
 */
import { describe, it, expect } from "vitest";
import { deriveCategoryFromConditionSpec } from "../playbook-registration.js";

describe("playbook-registration — deriveCategoryFromConditionSpec (Band C)", () => {
  it("routes reversal vocabulary to REVERSAL_STRATS", () => {
    const spec = {
      entry_conditions: [
        { object: "liquidity sweep and reclaim", role: "spine" },
        { object: "vwap slope", role: "confluence" },
      ],
    };
    expect(deriveCategoryFromConditionSpec(spec)).toBe("REVERSAL_STRATS");
  });

  it("routes mean-reversion vocabulary to MEAN_REV_STRATS", () => {
    const spec = {
      entry_conditions: [{ object: "vwap mean reversion setup", role: "trigger" }],
    };
    expect(deriveCategoryFromConditionSpec(spec)).toBe("MEAN_REV_STRATS");
  });

  it("routes opening-range/breakout vocabulary to ORB_STRATS", () => {
    const spec = {
      entry_conditions: [{ object: "opening range breakout", role: "trigger" }],
    };
    expect(deriveCategoryFromConditionSpec(spec)).toBe("ORB_STRATS");
  });

  it("defaults to CONTINUATION_STRATS on generic/unmatched vocabulary", () => {
    const spec = {
      entry_conditions: [{ object: "ny am session", role: "spine" }],
    };
    expect(deriveCategoryFromConditionSpec(spec)).toBe("CONTINUATION_STRATS");
  });

  it("defaults to CONTINUATION_STRATS on empty entry_conditions", () => {
    expect(deriveCategoryFromConditionSpec({ entry_conditions: [] })).toBe("CONTINUATION_STRATS");
    expect(deriveCategoryFromConditionSpec({})).toBe("CONTINUATION_STRATS");
  });

  it("only considers spine and trigger roles, not confluence", () => {
    const spec = {
      entry_conditions: [
        { object: "opening range breakout mentioned in passing", role: "confluence" },
        { object: "generic entry", role: "trigger" },
      ],
    };
    // confluence-role "breakout" text must NOT influence the category —
    // only the trigger's generic text is considered, which has no keyword hit.
    expect(deriveCategoryFromConditionSpec(spec)).toBe("CONTINUATION_STRATS");
  });
});
