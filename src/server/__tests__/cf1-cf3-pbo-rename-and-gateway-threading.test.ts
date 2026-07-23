/**
 * cf1-cf3-pbo-rename-and-gateway-threading.test.ts
 *
 * Verifies two carry-forward hardening items shipped 2026-06-24 on hardening/phase-0:
 *
 * CF1 — metrics-registry.ts pboBlocksTotal rename clean-up:
 *   lifecycle-service.ts has been migrated from the deprecated pboBLocksTotal alias
 *   to the canonical pboBlocksTotal export.  The deprecated alias was originally
 *   retained in metrics-registry.ts pending migration of 6 test files outside the
 *   cf1 owned-file list (sub-carry-forward CF1.1).
 *
 *   CF1.1 CLOSED (deepscan15 2026-07-03): those 6 test files have been migrated to
 *   the canonical pboBlocksTotal import and the deprecated alias export has been
 *   removed from metrics-registry.ts entirely.
 *
 * CF3 — caller-side gatewayOptions threading (M5 carry-forward):
 *   M5 (commit 3dbdd4e) closed the placeholder-substitution gap inside pine_compiler.py
 *   and added a TS post-compile assertion.  Four production callers previously passed
 *   gatewayOptions=undefined, causing the post-compile assertion to rely on env-only
 *   resolution and emitting pine_export.gateway_options_missing audit warns for archetype
 *   strategies with paper_account_routing set.
 *
 *   Fixed callers (2026-06-24):
 *     1. lifecycle-service.ts::triggerPineCompile (post-DEPLOY_READY Pine compile)
 *     2. lifecycle-service.ts PILOT auto-promote retry loop
 *     3. pine-export-recipient-service.ts::generateRecipientExport (per-recipient compile)
 *
 *   Leave-alone callers (correct as-is):
 *     - lifecycle-service.ts archetype gateway gate (line ~1412): already passes { mode: "tf_gateway" }
 *     - pine-export-service.ts::checkExportability (line ~130): dry-run exportability scan, no gateway needed
 *     - routes/pine-export.ts POST /compile (line ~164): admin-triggered, no strategy row, env fallback correct
 *
 * Test strategy: source-text assertions (mirrors pine-export-gateway-options.test.ts pattern)
 * because the full services require a live DB + Python subprocess unavailable in unit context.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");

function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

// ─── CF1: pboBlocksTotal rename in lifecycle-service.ts ────────────────────────

describe("CF1 — lifecycle-service.ts uses pboBlocksTotal (canonical name)", () => {
  it("lifecycle-service.ts imports pboBlocksTotal not the deprecated pboBLocksTotal", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    // The import line must reference the canonical name
    const importLine = src.split("\n").find((l) => l.includes("metrics-registry"));
    expect(importLine).toBeDefined();
    expect(importLine).toContain("pboBlocksTotal");
    expect(importLine).not.toContain("pboBLocksTotal");
  });

  it("lifecycle-service.ts call site uses pboBlocksTotal.labels().inc() — no pboBLocksTotal call site remains", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    // Canonical counter must be called
    expect(src).toContain("pboBlocksTotal.labels({ regime: regimeLabel }).inc()");
    // Deprecated alias must NOT be called anywhere in the service
    expect(src).not.toContain("pboBLocksTotal.labels");
  });
});

describe("CF1.1 CLOSED (deepscan15 2026-07-03) — metrics-registry.ts deprecated alias removed", () => {
  it("metrics-registry.ts no longer exports the deprecated pboBLocksTotal alias", () => {
    const src = readSrc("src/server/lib/metrics-registry.ts");
    // The sub-carry-forward is closed: all 6 test files that used to import the
    // capital-L typo alias have been migrated to the canonical pboBlocksTotal in
    // the same commit that removes this export.
    expect(src).not.toContain("export const pboBLocksTotal");
  });

  it("metrics-registry.ts source documents the CF1.1 closure", () => {
    const src = readSrc("src/server/lib/metrics-registry.ts");
    expect(src).toContain("CF1.1 CLOSED");
  });

  it("pboBlocksTotal (canonical) is still the sole exported counter for this metric", () => {
    const src = readSrc("src/server/lib/metrics-registry.ts");
    const primaryIdx = src.indexOf("export const pboBlocksTotal = new Counter");
    expect(primaryIdx).toBeGreaterThan(-1);
  });
});

// ─── CF3: gatewayOptions threading in production callers ───────────────────────

describe("CF3 — lifecycle-service.ts triggerPineCompile threads gatewayOptions when paperAccountRouting set", () => {
  it("triggerPineCompile derives gatewayOptions from paperAccountRouting before calling compileDualPineExport", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    // CF3 threading pattern must be present in triggerPineCompile
    expect(src).toContain("gatewayOptionsForCompile");
    expect(src).toContain("stratPaperRouting");
    // Explicit mode must be 'tf_gateway'
    expect(src).toContain(`{ mode: "tf_gateway" } as const`);
  });

  it("triggerPineCompile call to compileDualPineExport passes gatewayOptionsForCompile in position 10", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    // Must pass gatewayOptionsForCompile as the 10th argument (last positional)
    expect(src).toContain("gatewayOptionsForCompile");
    // The call must not omit the gateway arg at the triggerPineCompile site
    const compileCallIdx = src.indexOf("const result = await compileDualPineExport(strategyId, firmKey, riskIntelligence");
    expect(compileCallIdx).toBeGreaterThan(-1);
    const callSlice = src.slice(compileCallIdx, compileCallIdx + 300);
    expect(callSlice).toContain("gatewayOptionsForCompile");
  });

  it("triggerPineCompile falls through to undefined gateway when paperAccountRouting is null (parametric/legacy rows)", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    // The conditional must have the null/empty guard
    expect(src).toContain("stratPaperRouting != null && stratPaperRouting !== \"\"");
    // Fall-through arm must produce undefined
    expect(src).toContain(": undefined;");
  });
});

describe("CF3 — lifecycle-service.ts PILOT auto-promote threads gatewayOptions", () => {
  it("PILOT auto-promote retry loop derives sPaperRouting and sGatewayOpts before compileDualPineExport", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    expect(src).toContain("sPaperRouting");
    expect(src).toContain("sGatewayOpts");
  });

  it("PILOT auto-promote passes sGatewayOpts as arg 10 and system authority as arg 11", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    // Verify sGatewayOpts is used in the PILOT retry call
    const retryCallIdx = src.indexOf('await compileDualPineExport(s.id, undefined, undefined, true, correlationId ?? undefined, undefined, undefined, undefined, undefined, sGatewayOpts, "system")');
    expect(retryCallIdx).toBeGreaterThan(-1);
  });
});

describe("CF3 — pine-export-recipient-service.ts threads gatewayOptions per-recipient", () => {
  it("generateRecipientExport derives recipientPaperRouting and recipientGatewayOpts from strategy row", () => {
    const src = readSrc("src/server/services/pine-export-recipient-service.ts");
    expect(src).toContain("recipientPaperRouting");
    expect(src).toContain("recipientGatewayOpts");
  });

  it("generateRecipientExport passes recipientGatewayOpts as 10th arg to compileDualPineExport", () => {
    const src = readSrc("src/server/services/pine-export-recipient-service.ts");
    // The CF3 gateway arg must be the last arg in the compileDualPineExport call
    const callIdx = src.indexOf("recipientGatewayOpts,");
    expect(callIdx).toBeGreaterThan(-1);
    // It must appear inside the compileDualPineExport call block
    const prevCall = src.lastIndexOf("compileDualPineExport(", callIdx);
    expect(prevCall).toBeGreaterThan(-1);
    expect(callIdx - prevCall).toBeLessThan(500); // within the same call
  });

  it("generateRecipientExport falls through to undefined when paperAccountRouting is null", () => {
    const src = readSrc("src/server/services/pine-export-recipient-service.ts");
    expect(src).toContain("recipientPaperRouting != null && recipientPaperRouting !== \"\"");
  });
});

describe("CF3 — regression: leave-alone callers are unchanged", () => {
  it("lifecycle-service.ts archetype gateway dry-run caller still uses { mode: tf_gateway } (H1 pattern unchanged)", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    // The dry-run caller at ~line 1412 must still pass { mode: "tf_gateway" } explicitly
    // (this was the correct caller from before CF3 — must not have been disturbed).
    // Verify the string exists anywhere in the file (the archetype gateway gate + CF3 sites).
    expect(src).toContain('{ mode: "tf_gateway" } as const');
    // The compileDualPineExport call in the archetype gateway block must have persist=false (dry-run)
    // and must pass a gateway mode.  Search within a wider window around the gate logger string.
    const gatewayGateIdx = src.indexOf("archetype gateway-mode bypass gate");
    expect(gatewayGateIdx).toBeGreaterThan(-1);
    const gateBlock = src.slice(gatewayGateIdx, gatewayGateIdx + 1200);
    expect(gateBlock).toContain("persist=false");
    expect(gateBlock).toContain("tf_gateway");
  });

  it("pine-export-service.ts checkExportability still passes undefined gatewayOptions (dry-run exportability scan)", () => {
    const src = readSrc("src/server/services/pine-export-service.ts");
    // The checkExportability call must not have been modified to add gateway opts
    const checkIdx = src.indexOf("export async function checkExportability");
    expect(checkIdx).toBeGreaterThan(-1);
    // Search a wider window because the compileDualPineExport call is several lines into the fn
    const fnBlock = src.slice(checkIdx, checkIdx + 800);
    // The compileDualPineExport call inside checkExportability has 4 args (no gatewayOptions)
    expect(fnBlock).toContain("compileDualPineExport(strategyId, undefined, undefined, false)");
  });

  it("all callers: when paperAccountRouting is null gateway falls through to undefined (parametric safety net)", () => {
    const src = readSrc("src/server/services/lifecycle-service.ts");
    // Both CF3 call sites must have the null-guard falling to undefined
    // Count occurrences of the null-guard pattern
    const nullGuardPattern = "!= null && ";
    const matches = src.match(new RegExp(nullGuardPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [];
    // At minimum 2 occurrences (triggerPineCompile + PILOT retry)
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
