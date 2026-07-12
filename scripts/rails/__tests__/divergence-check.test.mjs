import { describe, expect, it } from "vitest";

import { decideDivergence } from "../divergence-check.cjs";

describe("decideDivergence", () => {
  it("is OK when every branch is within threshold and fast-forwardable", () => {
    const result = decideDivergence({
      pairs: [
        { name: "hardening/phase-0", ahead: 2, behind: 3, ffPossible: true },
        { name: "main", ahead: 0, behind: 0, ffPossible: true },
      ],
      threshold: 10,
    });

    expect(result.verdict).toBe("OK");
    expect(result.lines).toEqual([]);
  });

  it("alarms when skew exceeds the threshold in either direction", () => {
    const result = decideDivergence({
      pairs: [
        { name: "main", ahead: 11, behind: 0, ffPossible: true },
        { name: "hardening/phase-0", ahead: 0, behind: 12, ffPossible: true },
      ],
      threshold: 10,
    });

    expect(result.verdict).toBe("ALARM");
    expect(result.lines.join(" ")).toContain("main");
    expect(result.lines.join(" ")).toContain("hardening/phase-0");
  });

  it("does not alarm at the exact threshold boundary", () => {
    const result = decideDivergence({
      pairs: [{ name: "main", ahead: 10, behind: 0, ffPossible: true }],
      threshold: 10,
    });

    expect(result.verdict).toBe("OK");
  });

  it("alarms on forked histories regardless of commit counts", () => {
    const result = decideDivergence({
      pairs: [{ name: "main", ahead: 1, behind: 1, ffPossible: false }],
      threshold: 10,
    });

    expect(result.verdict).toBe("ALARM");
    expect(result.lines[0].toLowerCase()).toContain("forked");
  });

  it("fails closed on unreadable branch state", () => {
    const result = decideDivergence({
      pairs: [{ name: "main", ahead: null, behind: null, ffPossible: null }],
      threshold: 10,
    });

    expect(result.verdict).toBe("ALARM");
    expect(result.lines[0]).toContain("UNREADABLE");
  });

  it("fails closed on an invalid threshold", () => {
    const result = decideDivergence({
      pairs: [{ name: "main", ahead: 0, behind: 0, ffPossible: true }],
      threshold: Number.NaN,
    });

    expect(result.verdict).toBe("ALARM");
    expect(result.lines[0]).toContain("threshold");
  });
});
