import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scheduler = readFileSync(new URL("../scheduler.ts", import.meta.url), "utf8");

describe("post-cutover runtime hardening", () => {
  it("selects the first PAPER transition without an invalid mixed aggregate", () => {
    expect(scheduler).toContain("createdAt: lifecycleTransitions.createdAt");
    expect(scheduler).toContain(".orderBy(asc(lifecycleTransitions.createdAt))");
    expect(scheduler).not.toMatch(/earliest:\s*min\(lifecycleTransitions\.createdAt\)[\s\S]{0,120}strategyId:/);
  });

  it("runs naked-POC sync with the configured Python and user-site dependencies", () => {
    expect(scheduler).toContain("const pythonCmd = process.env.PYTHON_BIN");
    expect(scheduler).toContain("const proc = spawn(pythonCmd, args");
    expect(scheduler).toContain('PYTHONUSERSITE: "1"');
    expect(scheduler).toContain("PYTHONPATH: pythonPath");
  });
});
