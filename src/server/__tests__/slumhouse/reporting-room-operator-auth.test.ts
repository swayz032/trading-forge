import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Reporting Room operator authorization wiring", () => {
  it("accepts the Office admin session as well as a mapped Discord session", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/routes/slumhouse/api/reports.ts"),
      "utf8",
    );

    expect(source).toContain("requireSlumhouseUserOrAdmin");
    expect(source).not.toMatch(/reportsApiRouter\.get\([\s\S]*?requireSlumhouseUser,/);
  });
});
