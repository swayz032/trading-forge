// deepscan6 O1: source-guard coverage for the PAPER→DEPLOY_READY gate fail-mode hardening.
// (Behavioral coverage of lifecycle-service requires heavy DB/gate mocking; these guards
// lock the specific fixes so a future refactor can't silently regress them.)
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let src: string;
beforeAll(() => {
  src = readFileSync(resolve(here, "../services/lifecycle-service.ts"), "utf8");
});

describe("deepscan6 O1 — gate infra-errors block promotion and block decisions survive graveyard failure", () => {
  it("emits a failure audit row for each of the 3 infra-error paths", () => {
    expect(src).toContain("lifecycle.parameter_drift_infra_error_blocked");
    expect(src).toContain("lifecycle.dsr_infra_error_blocked");
    expect(src).toContain("lifecycle.bif_infra_error_blocked");
  });

  it("uses a continue in each catch so the cron path cannot promote past an unavailable hard gate", () => {
    for (const action of [
      "lifecycle.parameter_drift_infra_error_blocked",
      "lifecycle.dsr_infra_error_blocked",
      "lifecycle.bif_infra_error_blocked",
    ]) {
      const index = src.indexOf(action);
      expect(index).toBeGreaterThan(-1);
      expect(src.slice(index, index + 950)).toContain("continue;");
    }
  });

  it("wraps the block-decision graveyard writes so the block survives a DB hiccup", () => {
    expect(src).toContain("block decision preserved");
    expect(src).toContain("block decision wins regardless of graveyard write outcome");
  });

  it("fails closed on BIF infra error", () => {
    const idx = src.indexOf("lifecycle.bif_infra_error_blocked");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 950);
    expect(window).toContain("promotion blocked fail-closed");
    expect(window).toContain("continue;");
  });
});
