import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// load-env.ts is a side-effect module already in the runner's transitive graph,
// so we assert on the SOURCE contract (re-import would be a cached no-op).
describe("load-env NODE_ENV preservation", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "server", "load-env.ts"),
    "utf8",
  );

  it("snapshots NODE_ENV before dotenv override", () => {
    expect(src).toMatch(/_preExistingNodeEnv\s*=\s*process\.env\[?["']?NODE_ENV/);
  });

  it("restores a pre-existing NODE_ENV after dotenv override", () => {
    expect(src).toContain('process.env["NODE_ENV"] = _preExistingNodeEnv');
  });

  it("restore happens AFTER the dotenvConfig call", () => {
    const cfgIdx = src.indexOf("dotenvConfig({ override: true })");
    const restoreIdx = src.indexOf('process.env["NODE_ENV"] = _preExistingNodeEnv');
    expect(cfgIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeGreaterThan(cfgIdx);
  });
});
