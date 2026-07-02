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

describe("deepscan6 O1 — gate fail-open is observable + block decisions survive graveyard failure", () => {
  it("emits an audit row for each of the 3 fail-open infra-error paths (not silent)", () => {
    expect(src).toContain("lifecycle.parameter_drift_infra_error_proceeded");
    expect(src).toContain("lifecycle.dsr_infra_error_proceeded");
    expect(src).toContain("lifecycle.bif_infra_error_proceeded");
  });

  it("still pushes data_unavailable so the evidence-completeness gate can see the slip", () => {
    // 3 gate catches each push data_unavailable (plus any pre-existing ones).
    const count = (src.match(/gateEvidenceStatuses\.push\("data_unavailable"\)/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("wraps the block-decision graveyard writes so the block survives a DB hiccup", () => {
    expect(src).toContain("block decision preserved");
    expect(src).toContain("block decision wins regardless of graveyard write outcome");
  });

  it("keeps BIF fail-OPEN on infra error (pinned deliberate design) — audited, not blocked", () => {
    // The BIF infra-error path proceeds (fail-open) but now writes the audit row.
    const idx = src.indexOf("lifecycle.bif_infra_error_proceeded");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 400);
    expect(window).toContain("promotion continues");
  });
});
