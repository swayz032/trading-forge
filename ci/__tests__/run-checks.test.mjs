import { describe, expect, it } from "vitest";

import { selectChecks } from "../run-checks.mjs";

const scripts = {
  "check:production-isolation": "node hard-one.mjs",
  "check:2026-compliance": "node hard-two.mjs",
  "check:alpha": "node alpha.mjs",
  "check:beta": "node beta.mjs",
  "system-map:check": "node system-map.mjs",
  test: "vitest",
};

describe("selectChecks", () => {
  it("discovers every check script except separately-run hard gates", () => {
    const result = selectChecks({ scripts, checksSkipped: [] });

    expect(result.run).toEqual(["check:alpha", "check:beta"]);
    expect(result.skip).toEqual([]);
  });

  it("honors a named quarantine carrying a non-empty reason", () => {
    const result = selectChecks({
      scripts,
      checksSkipped: [{ name: "check:beta", reason: "needs a live external service" }],
    });

    expect(result.run).toEqual(["check:alpha"]);
    expect(result.skip).toEqual([
      { name: "check:beta", reason: "needs a live external service" },
    ]);
  });

  it("fails closed on a quarantine without a reason", () => {
    expect(() => selectChecks({
      scripts,
      checksSkipped: [{ name: "check:beta", reason: "" }],
    })).toThrow("check_quarantine_reason_missing");
  });

  it("fails closed on a stale or misspelled quarantine name", () => {
    expect(() => selectChecks({
      scripts,
      checksSkipped: [{ name: "check:missing", reason: "typo" }],
    })).toThrow("check_quarantine_unknown");
  });
});
