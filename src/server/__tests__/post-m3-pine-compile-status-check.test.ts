/**
 * post-m3-pine-compile-status-check.test.ts
 *
 * post-m3-paper-execution-lifecycle wave (2026-07-17), HIGH — re-verified against current
 * (M3-touched, but NOT in this specific region) lifecycle-service.ts and confirmed STILL
 * PRESENT: lifecycle callers never checked compileDualPineExport's returned status field — a
 * resolved {status:"failed"} was silently treated as success.
 *
 * ROOT CAUSE (confirmed by direct code read): compileDualPineExport (pine-export-service.ts)
 * FAIL-SOFTS internally — a SHADOW-guard block, a DB write failure, or a pine_compiler.py
 * subprocess error all resolve NORMALLY with `{status: "failed", error: <msg>}` rather than
 * throwing (grep confirms 4+ internal `return {..., status: "failed", ...}` paths, e.g. line 471,
 * 704, 960, 1243). Two lifecycle-service.ts call sites relied on the promise merely resolving
 * (never throwing) as their sole success signal:
 *
 *   1. triggerPineCompile() — fire-and-forget Pine compile after DEPLOY_READY promotion. Its only
 *      caller wraps it in `.catch(pineErr => logger.warn(...))`, which never fires for a resolved
 *      failure. Pre-fix, `logger.info("Pine dual compile completed...")` fired unconditionally.
 *
 *   2. PILOT -> DEPLOYED auto-promote retry loop — a 3-attempt retry-with-backoff (30s/2m/10m)
 *      wrapped in try/catch, with a `lifecycle.deployed_pine_compile_failed` audit row + Discord
 *      WARN on exhaustion. Pre-fix, `pineSuccess = true` was set unconditionally right after the
 *      await resolved, regardless of `.status` — so the ENTIRE retry/audit/Discord safety net
 *      this mechanism was built for never engaged on a resolved failure, only on a genuine thrown
 *      exception (network drop, DB connection loss).
 *
 * Test strategy: source-text assertions. compileDualPineExport's own internals (DB writes, Python
 * subprocess spawn, artifact persistence) make a full behavioral mock of these two call sites a
 * very large integration surface for zero incremental confidence over asserting the actual status
 * check exists at the actual call site with the actual gating structure — this repo's own
 * convention for this exact code region (cf1-cf3-pbo-rename-and-gateway-threading.test.ts,
 * pass6-ab-routing.test.ts) is source-text analysis for the identical reason.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");

function readLifecycleSrc(): string {
  return readFileSync(resolve(ROOT, "src/server/services/lifecycle-service.ts"), "utf-8");
}

describe("post-m3-paper-execution-lifecycle wave — triggerPineCompile checks compileDualPineExport's resolved status", () => {
  it("checks result.status !== 'completed' immediately after the compileDualPineExport call, before assuming success", () => {
    const src = readLifecycleSrc();
    const callIdx = src.indexOf(
      'const result = await compileDualPineExport(strategyId, firmKey, riskIntelligence',
    );
    expect(callIdx).toBeGreaterThan(-1);
    // The status check must appear shortly AFTER the call (not just anywhere in the file).
    const afterCall = src.slice(callIdx, callIdx + 1500);
    expect(afterCall).toContain('status !== "completed"');
  });

  it("the 'Pine dual compile completed' success log is now gated behind the status check (not unconditional)", () => {
    const src = readLifecycleSrc();
    const callIdx = src.indexOf(
      'const result = await compileDualPineExport(strategyId, firmKey, riskIntelligence',
    );
    const statusCheckIdx = src.indexOf('status !== "completed"', callIdx);
    const successLogIdx = src.indexOf('"Pine dual compile completed for DEPLOY_READY strategy"', callIdx);
    expect(statusCheckIdx).toBeGreaterThan(-1);
    expect(successLogIdx).toBeGreaterThan(-1);
    // Success log must come AFTER the status check (i.e. only reached on the non-failure path,
    // since the failure branch `return`s before falling through to it).
    expect(successLogIdx).toBeGreaterThan(statusCheckIdx);
  });

  it("a failed compile writes a distinct audit action + Discord warning instead of silently succeeding", () => {
    const src = readLifecycleSrc();
    expect(src).toContain("lifecycle.deploy_ready_pine_compile_failed");
    // Must be near the DEPLOY_READY triggerPineCompile call (not some unrelated occurrence).
    const callIdx = src.indexOf(
      'const result = await compileDualPineExport(strategyId, firmKey, riskIntelligence',
    );
    const auditIdx = src.indexOf("lifecycle.deploy_ready_pine_compile_failed", callIdx);
    expect(auditIdx).toBeGreaterThan(callIdx);
    expect(auditIdx).toBeLessThan(callIdx + 3000);
  });

  it("the failure branch returns early — never falls through to the success log", () => {
    const src = readLifecycleSrc();
    const callIdx = src.indexOf(
      'const result = await compileDualPineExport(strategyId, firmKey, riskIntelligence',
    );
    const statusCheckIdx = src.indexOf('status !== "completed"', callIdx);
    const successLogIdx = src.indexOf('"Pine dual compile completed for DEPLOY_READY strategy"', callIdx);
    const between = src.slice(statusCheckIdx, successLogIdx);
    expect(between).toContain("return;");
  });
});

describe("post-m3-paper-execution-lifecycle wave — PILOT auto-promote retry loop checks the resolved status, not just thrown exceptions", () => {
  it("the compileDualPineExport call inside the retry loop captures its return value and checks .status", () => {
    const src = readLifecycleSrc();
    const retryCallIdx = src.indexOf(
      "const pineResult = await compileDualPineExport(s.id, undefined, undefined, true, correlationId",
    );
    expect(retryCallIdx).toBeGreaterThan(-1);
    const afterCall = src.slice(retryCallIdx, retryCallIdx + 1500);
    expect(afterCall).toContain('status !== "completed"');
  });

  it("a resolved non-completed status THROWS inside the try block — converts a silent-success into a retry-triggering error", () => {
    const src = readLifecycleSrc();
    const retryCallIdx = src.indexOf(
      "const pineResult = await compileDualPineExport(s.id, undefined, undefined, true, correlationId",
    );
    const pineSuccessIdx = src.indexOf("pineSuccess = true;", retryCallIdx);
    expect(retryCallIdx).toBeGreaterThan(-1);
    expect(pineSuccessIdx).toBeGreaterThan(retryCallIdx);
    // The throw for a non-completed status must appear BETWEEN the call and the
    // unconditional pineSuccess=true — i.e. it gates reaching that line.
    const between = src.slice(retryCallIdx, pineSuccessIdx);
    expect(between).toContain("throw new Error(");
    expect(between).toContain('status !== "completed"');
  });

  it("pineSuccess = true is reached ONLY after the status check passes (not immediately after the bare await)", () => {
    const src = readLifecycleSrc();
    const retryCallIdx = src.indexOf(
      "const pineResult = await compileDualPineExport(s.id, undefined, undefined, true, correlationId",
    );
    const pineSuccessIdx = src.indexOf("pineSuccess = true;", retryCallIdx);
    const statusCheckIdx = src.indexOf('status !== "completed"', retryCallIdx);
    expect(statusCheckIdx).toBeGreaterThan(retryCallIdx);
    expect(statusCheckIdx).toBeLessThan(pineSuccessIdx);
  });

  it("the existing retry/audit/Discord failure mechanism (lifecycle.deployed_pine_compile_failed) is preserved and now actually reachable via the thrown status error", () => {
    const src = readLifecycleSrc();
    expect(src).toContain("lifecycle.deployed_pine_compile_failed");
    expect(src).toContain("Pine Compile Failed: strategy");
    // catch block that records lastPineErr must exist after the retry call (unchanged mechanism).
    const retryCallIdx = src.indexOf(
      "const pineResult = await compileDualPineExport(s.id, undefined, undefined, true, correlationId",
    );
    const catchIdx = src.indexOf("} catch (pineErr) {", retryCallIdx);
    expect(catchIdx).toBeGreaterThan(retryCallIdx);
  });
});
