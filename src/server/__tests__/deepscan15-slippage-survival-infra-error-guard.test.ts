// Deep-scan #15 FIX-3: source-guard coverage for the Slippage-Survival gate's
// fail-open infra-error path, mirroring the existing pattern in
// deepscan6-lifecycle-gate-failmode.test.ts:19,35 for
// `lifecycle.bif_infra_error_proceeded`. That test locks the BIF gate's
// fail-open-but-audited contract; this test locks the equivalent contract for
// `lifecycle.slippage_survival_infra_error_proceeded` (Wave A, 2026-07-03) so a
// future refactor can't silently regress either the audit-action string or the
// "fail-open, promotion continues" observability note.
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

describe("deepscan15 FIX-3 — slippage-survival gate fail-open is observable (not silent)", () => {
  it("emits an audit row for the slippage-survival fail-open infra-error path", () => {
    expect(src).toContain("lifecycle.slippage_survival_infra_error_proceeded");
  });

  it("keeps slippage-survival fail-OPEN on infra error (pinned deliberate design) — audited, not blocked", () => {
    // Mirrors deepscan6-lifecycle-gate-failmode.test.ts:33-39 for the BIF gate.
    const idx = src.indexOf("lifecycle.slippage_survival_infra_error_proceeded");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 500);
    expect(window).toContain("promotion continues");
  });

  it("still pushes data_unavailable on the fail-open path so the evidence-completeness gate can see the slip", () => {
    // Locate the slippage-survival catch block specifically (scoped window
    // around the audit-action string) rather than counting all
    // gateEvidenceStatuses.push("data_unavailable") sites repo-wide — this
    // guard only cares that THIS gate's catch block still marks evidence
    // incomplete, not the total count across every gate (which drifts as
    // gates are added).
    const idx = src.indexOf("lifecycle.slippage_survival_infra_error_proceeded");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 750);
    expect(window).toContain('gateEvidenceStatuses.push("data_unavailable")');
  });

  it("writes a non-blocking .catch() on the audit insert so a DB hiccup here cannot throw out of the gate", () => {
    const idx = src.indexOf("lifecycle.slippage_survival_infra_error_proceeded");
    const window = src.slice(idx, idx + 750);
    expect(window).toContain("slippage_survival_infra_error_proceeded audit insert failed (non-blocking)");
  });
});
