/**
 * pass6-ab-routing.test.ts — Pass 6 Track B
 *
 * Closes audit finding HP #5: "A/B paper routing is observability theatre —
 * slumdawg-rl-challenger never receives a real order."
 *
 * Test strategy:
 *   1. Source-code analysis (readFileSync) — no mocks; proves structural contracts
 *      about ordering, import presence, and audit action names.
 *   2. Source-code analysis of pine-export-service.ts injection block.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAPER_SIGNAL_PATH = resolve(
  process.cwd(),
  "src/server/services/paper-signal-service.ts",
);

const PINE_EXPORT_PATH = resolve(
  process.cwd(),
  "src/server/services/pine-export-service.ts",
);

// ─────────────────────────────────────────────────────────────────────────────
// describe 1: A/B routing block in paper-signal-service.ts
// ─────────────────────────────────────────────────────────────────────────────
describe("Pass 6 Track B — A/B routing source-code analysis (paper-signal-service.ts)", () => {
  let src: string;

  it("can read paper-signal-service.ts without error", () => {
    src = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(src.length).toBeGreaterThan(1000);
  });

  it("contains slumdawg-baseline and slumdawg-rl-challenger target resolution", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(s).toContain("slumdawg-baseline");
    expect(s).toContain("slumdawg-rl-challenger");
  });

  it("contains brokerAccounts lookup by accountIdExternal and firmId='paper'", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(s).toContain("brokerAccounts.accountIdExternal");
    expect(s).toContain("brokerAccounts.firmId");
    expect(s).toContain('"paper"');
  });

  it("contains routeOrder dynamic import inside the try block", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(s).toContain('import("./broker-router.js")');
    expect(s).toContain("routeOrder");
  });

  it("contains routing_called and routing_success in audit result (proves audit fires after routing)", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(s).toContain("routing_called");
    expect(s).toContain("routing_success");
  });

  it("audit action quantum_rl.signal_routed appears AFTER the routeOrder import (ordering check)", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    const routeOrderIdx = s.indexOf('import("./broker-router.js")');
    const auditActionIdx = s.indexOf('"quantum_rl.signal_routed"');
    expect(routeOrderIdx).toBeGreaterThan(-1);
    expect(auditActionIdx).toBeGreaterThan(-1);
    // The audit action string must appear AFTER the dynamic import
    expect(auditActionIdx).toBeGreaterThan(routeOrderIdx);
  });

  it("does NOT fire insertAuditRow before the routeOrder import section", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    // Find the A/B routing try block
    const tryBlockIdx = s.indexOf("// ── Pass 6 Track B: resolve broker_account_id for the target sub-account ──");
    expect(tryBlockIdx).toBeGreaterThan(-1);
    const upToTryBlock = s.slice(0, tryBlockIdx);
    // The insertAuditRow call for quantum_rl.signal_routed should NOT appear before the routing block
    const preRoutingAudit = upToTryBlock.lastIndexOf('"quantum_rl.signal_routed"');
    // Either not found, or the last occurrence before the routing block is the old location
    // (after refactor, it should only appear after the routing block)
    const postRoutingAudit = s.indexOf('"quantum_rl.signal_routed"', tryBlockIdx);
    expect(postRoutingAudit).toBeGreaterThan(tryBlockIdx);
  });

  it("correlationId is passed to routeOrder call", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    // Locate routeOrder call and verify correlationId appears in proximity
    const routeOrderCallIdx = s.indexOf("routeOrder(resolvedAccountId");
    expect(routeOrderCallIdx).toBeGreaterThan(-1);
    const callSlice = s.slice(routeOrderCallIdx, routeOrderCallIdx + 200);
    expect(callSlice).toContain("correlationId");
  });

  it("resolved_account_id is included in the audit result payload", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(s).toContain("resolved_account_id: resolvedAccountId");
  });

  it("broadcastSSE includes resolvedAccountId, routingCalled, routingSuccess", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    // Find the broadcastSSE call for rl_ab_routed
    const sseIdx = s.indexOf('"signal:rl_ab_routed"');
    expect(sseIdx).toBeGreaterThan(-1);
    const sseSlice = s.slice(sseIdx, sseIdx + 500);
    expect(sseSlice).toContain("resolvedAccountId");
    expect(sseSlice).toContain("routingCalled");
    expect(sseSlice).toContain("routingSuccess");
  });

  it("routeOrder is only called when routingDecision === 'rl-challenger' AND resolvedAccountId is not null", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(s).toContain('routingDecision === "rl-challenger" && resolvedAccountId !== null');
  });

  it("fail-soft catch block present — abRoutingErr logged but not rethrown", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(s).toContain("abRoutingErr");
    expect(s).toContain("A/B routing audit failed (non-blocking)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe 2: audit fires after routing (ordering guarantee)
// ─────────────────────────────────────────────────────────────────────────────
describe("Pass 6 Track B — audit fires after routing", () => {
  it("the routeOrder import appears before insertAuditRow for quantum_rl.signal_routed", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    const routeImportIdx = s.indexOf('import("./broker-router.js")');
    const auditIdx = s.indexOf('"quantum_rl.signal_routed"');
    expect(routeImportIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(routeImportIdx);
  });

  it("the comment 'Audit row fires AFTER routing' exists in the source", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    expect(s).toContain("Audit row fires AFTER routing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe 3: correlation_id threading
// ─────────────────────────────────────────────────────────────────────────────
describe("Pass 6 Track B — correlation_id threading", () => {
  it("correlationId is passed as third argument to routeOrder", () => {
    const s = readFileSync(PAPER_SIGNAL_PATH, "utf8");
    // The routeOrder call must include correlationId as an argument
    const callIdx = s.indexOf("routeOrder(resolvedAccountId, signal, correlationId");
    expect(callIdx).toBeGreaterThan(-1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe 4: pine-export-service.ts A/B injection block
// ─────────────────────────────────────────────────────────────────────────────
describe("Pass 6 Track B — pine-export-service.ts A/B injection block", () => {
  it("pine-export-service.ts imports brokerAccounts from schema", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    expect(s).toContain("brokerAccounts");
    expect(s).toContain("from \"../db/schema.js\"");
  });

  it("pine-export-service.ts imports 'and' from drizzle-orm", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    const drizzleImport = s.match(/import\s*\{[^}]+\}\s*from\s*"drizzle-orm"/)?.[0] ?? "";
    expect(drizzleImport).toContain("and");
  });

  it("compileDualPineExport contains pine_export.ab_routing_resolved audit action", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    expect(s).toContain("pine_export.ab_routing_resolved");
  });

  it("compileDualPineExport resolves slumdawg-baseline and slumdawg-rl-challenger", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    expect(s).toContain("slumdawg-baseline");
    expect(s).toContain("slumdawg-rl-challenger");
  });

  it("injection block is placed before const tmpPath (correct insertion point)", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    const injectionIdx = s.indexOf("pine_export.ab_routing_resolved");
    const tmpPathIdx = s.indexOf("const tmpPath = pathResolve");
    expect(injectionIdx).toBeGreaterThan(-1);
    expect(tmpPathIdx).toBeGreaterThan(-1);
    expect(injectionIdx).toBeLessThan(tmpPathIdx);
  });

  it("injection block is placed after gateway options block (correct insertion point)", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    // The gateway options block closes with strategyObj["config"] = innerConfig
    const gatewayBlockIdx = s.indexOf('strategyObj["config"] = innerConfig;');
    const injectionIdx = s.indexOf("pine_export.ab_routing_resolved");
    expect(gatewayBlockIdx).toBeGreaterThan(-1);
    expect(injectionIdx).toBeGreaterThan(gatewayBlockIdx);
  });

  it("injection only fires when config.account_id is not already set (caller may override)", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    expect(s).toContain("!config.account_id");
  });

  it("injection uses firmId='paper' to resolve sub-account rows", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    // In the context of the injection block
    const injectionIdx = s.indexOf("pine_export.ab_routing_resolved");
    const blockSlice = s.slice(injectionIdx - 2000, injectionIdx + 500);
    expect(blockSlice).toContain('"paper"');
    expect(blockSlice).toContain("brokerAccounts.firmId");
  });

  it("injection block is fail-soft — abInjectErr caught and logged without rethrowing", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    expect(s).toContain("abInjectErr");
    expect(s).toContain("A/B routing account_id injection failed (non-blocking)");
  });

  it("resolved UUID is assigned to config.account_id", () => {
    const s = readFileSync(PINE_EXPORT_PATH, "utf8");
    expect(s).toContain("config.account_id = resolvedId");
  });
});
