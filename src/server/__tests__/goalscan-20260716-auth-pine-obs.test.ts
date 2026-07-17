/**
 * goalscan-20260716-auth-pine-obs.test.ts — /goal deep-scan fix wave (2026-07-16)
 *
 * Source-contract RED-proofs for six control-plane / delivery / telemetry fixes on the
 * NON-instrument surface (no campaign-owned files). Each assertion goes RED if its fix is
 * reverted — proving the wiring is present and non-vacuous (the deep-scan "revert→red" bar).
 *
 * Findings closed (all @ base 61bb20a3):
 *  A1 HIGH  compliance.ts  — Office-guard on POST /drift/:firm/cascade (mass firm-pause)
 *  A2 HIGH  strategies.ts  — block config/symbols PATCH on a frozen/live strategy
 *  A5 MED   strategies.ts  — SHADOW added to DELETE-protected lifecycle states
 *  O1 HIGH  alert-service  — systemError() carries correlationId into metadata
 *  O1/O2    exchange-status — correlationId threaded into CME-outage alert + SSE
 *  P1 HIGH  pine-export    — zero-artifact faithful block => status "failed", both paths
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srv = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("goalscan 2026-07-16 — A1 compliance /cascade Office guard", () => {
  const src = srv("routes/compliance.ts");
  it("guards /drift/:firm/cascade with requireOfficeControlAuthority", () => {
    // The cascade handler must call the guard. Locate the route then require the guard
    // appears within its handler body (before cascadeRevalidation runs).
    const idx = src.indexOf('router.post("/drift/:firm/cascade"');
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 1000);
    expect(body).toContain("requireOfficeControlAuthority");
    expect(body).toContain("compliance.drift_cascade_denied");
    // guard must precede the actual cascadeRevalidation(firm) invocation
    expect(body.indexOf("requireOfficeControlAuthority")).toBeLessThan(body.indexOf("cascadeRevalidation(firm)"));
  });
});

describe("goalscan 2026-07-16 — A2/A5 strategies.ts route guards", () => {
  const src = srv("routes/strategies.ts");
  it("A2: PATCH /:id blocks config/symbols mutation on a frozen/live strategy", () => {
    expect(src).toContain("frozen_policy_patch_blocked");
    expect(src).toContain("frozenPolicyHash");
    // the guard keys on the live/frozen state set OR a non-null frozen hash
    expect(src).toMatch(/LIVE_OR_FROZEN_STATES[\s\S]{0,120}DEPLOYED[\s\S]{0,40}PILOT[\s\S]{0,40}DEPLOY_READY/);
  });
  it("A5: SHADOW is in the DELETE-protected lifecycle set", () => {
    const m = src.match(/PROTECTED_LIFECYCLE_STATES[^=]*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const set = m![1];
    for (const s of ["DEPLOYED", "PAPER", "DEPLOY_READY", "PILOT", "SHADOW"]) {
      expect(set).toContain(s);
    }
  });
});

describe("goalscan 2026-07-16 — O1 alert factory correlationId", () => {
  const src = srv("services/alert-service.ts");
  it("systemError accepts a correlationId param and threads it into metadata", () => {
    const idx = src.indexOf("systemError:");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 400);
    expect(body).toMatch(/systemError:\s*\(component:\s*string,\s*error:[^,]*,\s*correlationId\?/);
    // metadata must conditionally include correlationId (the key createAlert forwards to Discord)
    expect(body).toContain("correlationId != null ? { correlationId }");
  });
});

describe("goalscan 2026-07-16 — O1/O2 exchange-status correlationId propagation", () => {
  const src = srv("services/exchange-status-service.ts");
  it("CME-outage systemError call passes cronCorrelationId", () => {
    const idx = src.indexOf('"cme-outage-detected"');
    expect(idx).toBeGreaterThan(-1);
    // the systemError(...) call for cme-outage must include cronCorrelationId as an argument
    const body = src.slice(idx, idx + 500);
    expect(body).toContain("cronCorrelationId");
  });
  it("outage SSE broadcasts carry correlationId", () => {
    const detected = src.indexOf('broadcastSSE("exchange:outage-detected"');
    const resolved = src.indexOf('broadcastSSE("exchange:outage-resolved"');
    expect(detected).toBeGreaterThan(-1);
    expect(resolved).toBeGreaterThan(-1);
    expect(src.slice(detected, detected + 250)).toContain("correlationId: cronCorrelationId");
    expect(src.slice(resolved, resolved + 300)).toContain("correlationId: cronCorrelationId");
  });
});

describe("goalscan 2026-07-16 — P1 pine phantom-success closed", () => {
  const src = srv("services/pine-export-service.ts");
  it("single path derives status from artifact count (failed when zero)", () => {
    expect(src).toContain("const producedNoArtifacts = result.artifacts.length === 0");
    expect(src).toContain('const exportStatus = producedNoArtifacts ? "failed" : "completed"');
    // the returned status (read by the recipient path) must use exportStatus, not a literal
    expect(src).toMatch(/exportabilityBand: result\.exportability\.band,\s*\n\s*status: exportStatus,/);
  });
  it("dual path derives status from artifact count (failed when zero)", () => {
    expect(src).toContain("const dualProducedNoArtifacts = dualArtifacts.length === 0");
    expect(src).toContain('const dualExportStatus = dualProducedNoArtifacts ? "failed" : "completed"');
    expect(src).toContain("status: dualExportStatus");
  });
});
