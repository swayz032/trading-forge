/**
 * Wave 11 (2026-05-17) — compliance-refresh FIRMS list pruning regression.
 *
 * Migration 0097 (2026-05-10) removed 9 legacy prop firms from operational
 * tables. The `FIRMS` array driving `checkComplianceRuleDrift()` still iterated
 * 8 firms — including 6 that no longer existed — so every doc-hash change
 * inserted 8 firm-rows + fired a Discord critical naming nonexistent firms.
 *
 * This test pins the post-Wave-11 invariant: only the 2 actively-supported
 * firms (MFFU + Topstep) get iterated. If anyone re-adds a legacy firm here
 * without re-adding it to migration 0097's whitelist, this fails fast.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SERVICE_PATH = path.resolve(
  process.cwd(),
  "src/server/services/compliance-refresh-service.ts",
);

describe("Wave 11 — compliance-refresh FIRMS pruned to MFFU + Topstep", () => {
  const source = fs.readFileSync(SERVICE_PATH, "utf-8");

  it("FIRMS array contains exactly MFFU and Topstep", () => {
    const match = source.match(/const FIRMS = \[([^\]]+)\]/);
    expect(match, "FIRMS array not found in compliance-refresh-service.ts").toBeTruthy();
    const inside = match![1];
    const firms = Array.from(inside.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    expect(firms.sort()).toEqual(["mffu", "topstep"].sort());
  });

  it.each(["TPT", "Apex", "FFN", "Alpha", "Tradeify", "Earn2Trade", "FundingPips"])(
    "legacy firm %s is NOT in FIRMS array",
    (legacyFirm) => {
      const match = source.match(/const FIRMS = \[([^\]]+)\]/);
      const inside = match![1];
      const firms = Array.from(inside.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
      expect(firms).not.toContain(legacyFirm);
    },
  );
});
