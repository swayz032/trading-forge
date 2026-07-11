import { describe, expect, it } from "vitest";

import {
  compareBaseline,
  parsePytestJunit,
  parseVitestJson,
  validateManifest,
} from "../compare-baseline.mjs";

const baseline = {
  knownFailures: ["a.test.ts > old bug"],
  collectionFloor: 3,
};

describe("compareBaseline", () => {
  it("is green when failures match the baseline", () => {
    const result = compareBaseline({
      results: { failures: ["a.test.ts > old bug"], collected: 5 },
      baseline,
    });

    expect(result.verdict).toBe("GREEN");
    expect(result.newFailures).toEqual([]);
  });

  it("is red and names every new failure", () => {
    const result = compareBaseline({
      results: {
        failures: ["a.test.ts > old bug", "b.test.ts > fresh"],
        collected: 5,
      },
      baseline,
    });

    expect(result.verdict).toBe("RED");
    expect(result.newFailures).toEqual(["b.test.ts > fresh"]);
  });

  it("stays green but reports fixed baseline failures", () => {
    const result = compareBaseline({
      results: { failures: [], collected: 5 },
      baseline,
    });

    expect(result.verdict).toBe("GREEN");
    expect(result.fixedFailures).toEqual(["a.test.ts > old bug"]);
  });

  it("is red when collection falls below the frozen floor", () => {
    const result = compareBaseline({
      results: { failures: [], collected: 2 },
      baseline,
    });

    expect(result.verdict).toBe("RED");
    expect(result.floorBreached).toBe(true);
  });

  it("fails closed on malformed result counts", () => {
    const result = compareBaseline({
      results: { failures: [], collected: Number.NaN },
      baseline,
    });

    expect(result.verdict).toBe("RED");
    expect(result.resultsMalformed).toBe(true);
  });

  it("parses the vitest JSON reporter shape", () => {
    const report = {
      testResults: [
        {
          name: "/x/a.test.ts",
          assertionResults: [
            { status: "passed", fullName: "a ok" },
            { status: "failed", fullName: "a bad" },
          ],
        },
      ],
    };

    expect(parseVitestJson(report)).toEqual({
      failures: ["a.test.ts > a bad"],
      collected: 2,
    });
  });

  it("fails closed when vitest output has no testResults array", () => {
    expect(() => parseVitestJson({})).toThrow("vitest_report_malformed");
  });

  it("parses pytest junit failures and errors", () => {
    const xml = `<testsuite tests="3">
      <testcase classname="t_a" name="ok"/>
      <testcase classname="t_a" name="bad"><failure>x</failure></testcase>
      <testcase classname="t_b" name="boom"><error>x</error></testcase>
    </testsuite>`;

    expect(parsePytestJunit(xml)).toEqual({
      failures: ["t_a::bad", "t_b::boom"],
      collected: 3,
    });
  });

  it("fails closed when pytest output has no testcase records", () => {
    expect(() => parsePytestJunit("<testsuite tests=\"2\"/>")).toThrow(
      "pytest_report_malformed",
    );
  });
});

describe("validateManifest", () => {
  it("refuses to grade an unfrozen seed manifest", () => {
    expect(() => validateManifest({ frozen: false })).toThrow(
      "baseline_manifest_unfrozen",
    );
  });

  it("accepts only the pre-registered threshold version", () => {
    expect(() => validateManifest({
      frozen: true,
      thresholdVersion: "rails_thresholds_v0",
    })).toThrow("baseline_manifest_version_invalid");

    expect(() => validateManifest({
      frozen: true,
      thresholdVersion: "rails_thresholds_v1",
    })).not.toThrow();
  });
});
