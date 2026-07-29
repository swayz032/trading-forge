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
    // ★★★ UPDATED BY R-444. This previously passed `{failures: [], collected: 5}`
    //     with no passed-set and expected the entry to be reported FIXED — which
    //     encoded the exact defect: "did not fail" was treated as "passed". A
    //     never-run test also does not fail. The entry is now only FIXED when it
    //     is positively observed to have PASSED.
    const result = compareBaseline({
      results: { failures: [], passed: ["a.test.ts > old bug"], collected: 5 },
      baseline,
    });

    expect(result.verdict).toBe("GREEN");
    expect(result.fixedFailures).toEqual(["a.test.ts > old bug"]);
    expect(result.unresolvedEntries).toEqual([]);
    expect(result.staleBaseline).toBe(true);
  });

  it("DISCRIMINATOR: a baselined test that did NOT run is UNRESOLVED, never fixed", () => {
    // ★★★ The control that gives the test above its meaning. Same inputs except
    //     the entry is absent from the passed-set (skipped, or never collected).
    //     If this ever reports `fixedFailures`, the guard would propose deleting
    //     the safety net for a test that never executed.
    const result = compareBaseline({
      results: { failures: [], passed: ["b.test.ts > unrelated"], collected: 5 },
      baseline,
    });

    expect(result.verdict).toBe("GREEN");
    expect(result.fixedFailures).toEqual([]);
    expect(result.unresolvedEntries).toEqual(["a.test.ts > old bug"]);
    expect(result.staleBaseline).toBe(false);
  });

  it("FAILS CLOSED when the parser supplies no passed-set at all", () => {
    // An older/unknown report shape proves nothing ran, so nothing may be
    // called fixed — everything not-failing becomes unresolved.
    const result = compareBaseline({
      results: { failures: [], collected: 5 },
      baseline,
    });

    expect(result.fixedFailures).toEqual([]);
    expect(result.unresolvedEntries).toEqual(["a.test.ts > old bug"]);
    expect(result.staleBaseline).toBe(false);
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

    // ★ R-444: the parser now also returns the PASSED set, so "did not fail"
    //   can be distinguished from "ran and passed" downstream.
    expect(parseVitestJson(report)).toEqual({
      passed: ["a.test.ts > a ok"],
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

    // ★ R-444: `passed` excludes failures/errors AND <skipped> testcases.
    expect(parsePytestJunit(xml)).toEqual({
      failures: ["t_a::bad", "t_b::boom"],
      passed: ["t_a::ok"],
      collected: 3,
    });
  });

  it("DISCRIMINATOR: a pytest <skipped> testcase is not counted as passed", () => {
    // Skipped is the pytest twin of the vitest case above: it did not fail
    // because it did not run, so it must not license a baseline removal.
    const xml = `<testsuite tests="2">
      <testcase classname="t_a" name="ran"/>
      <testcase classname="t_a" name="never"><skipped/></testcase>
    </testsuite>`;

    const parsed = parsePytestJunit(xml);
    expect(parsed.passed).toEqual(["t_a::ran"]);
    expect(parsed.passed).not.toContain("t_a::never");
    expect(parsed.failures).toEqual([]);
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
      vitest: { knownFailures: [], collectionFloor: 1 },
      pytest: { knownFailures: [], collectionFloor: 1 },
    })).not.toThrow();
  });

  it("requires positive collection floors before freezing", () => {
    expect(() => validateManifest({
      frozen: true,
      thresholdVersion: "rails_thresholds_v1",
      vitest: { knownFailures: [], collectionFloor: 0 },
      pytest: { knownFailures: [], collectionFloor: 1 },
    })).toThrow("baseline_collection_floor_invalid");
  });

  it("requires a reason for every frozen known failure", () => {
    expect(() => validateManifest({
      frozen: true,
      thresholdVersion: "rails_thresholds_v1",
      vitest: {
        knownFailures: [{ id: "a.test.ts > old bug", reason: "" }],
        collectionFloor: 1,
      },
      pytest: { knownFailures: [], collectionFloor: 1 },
    })).toThrow("baseline_failure_reason_missing");
  });
});
