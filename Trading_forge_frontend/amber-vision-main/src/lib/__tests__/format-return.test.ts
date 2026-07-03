import { describe, it, expect } from "vitest";
import { formatReturnPct } from "../utils";

describe("formatReturnPct", () => {
  it("renders a vectorbt ratio as a percentage", () => {
    expect(formatReturnPct(0.124)).toBe("+12.4%");
    expect(formatReturnPct(-0.031)).toBe("-3.1%");
    expect(formatReturnPct(0)).toBe("0.0%");
  });
  it("never multiplies by account size", () => {
    // 9.5 is a pathological ratio (950%) — must NOT become $475,000
    expect(formatReturnPct(9.5)).toBe("+950.0%");
  });
});
