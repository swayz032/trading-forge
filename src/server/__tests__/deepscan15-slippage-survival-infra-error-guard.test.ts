// Deep-scan #15 FIX-3: source-guard coverage for the Slippage-Survival gate's
// fail-closed infra-error path. Execution-stress evidence must be present and
// readable before a strategy can reach DEPLOY_READY.
//
// (Behavioral coverage of lifecycle-service requires heavy DB/gate mocking;
// this source-grep guard is intentionally read-only — same rationale as the
// BIF test it mirrors.)
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let src: string;
beforeAll(() => {
  src = readFileSync(resolve(here, "../services/lifecycle-service.ts"), "utf8");
});

describe("slippage-survival infra errors fail closed", () => {
  it("emits an audit row for the slippage-survival infra-error path", () => {
    expect(src).toContain("lifecycle.slippage_survival_infra_error_blocked");
  });

  it("blocks promotion on a slippage-survival infra error", () => {
    const idx = src.indexOf("lifecycle.slippage_survival_infra_error_blocked");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 500);
    expect(window).toContain("promotion blocked");
  });

  it("continues the outer promotion loop without promoting the failed strategy", () => {
    const idx = src.indexOf("lifecycle.slippage_survival_infra_error_blocked");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 750);
    expect(window).toContain("continue;");
  });

  it("writes a non-blocking .catch() on the audit insert so a DB hiccup here cannot throw out of the gate", () => {
    const idx = src.indexOf("lifecycle.slippage_survival_infra_error_blocked");
    const window = src.slice(idx, idx + 750);
    expect(window).toContain("slippage_survival_infra_error_blocked audit insert failed (non-blocking)");
  });
});
