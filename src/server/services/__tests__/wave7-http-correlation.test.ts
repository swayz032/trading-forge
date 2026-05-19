/**
 * wave7-http-correlation.test.ts
 *
 * Wave-7 D — HTTP-callable service correlation_id propagation.
 *
 * Closes Wave 5 carry-forward #2: prop-firm-health-service, exchange-status-service,
 * and pipeline-control-service used to write audit_log rows with correlationId: null,
 * even though the callers had a request id in scope. After this fix:
 *
 *   - pipeline-control.setMode() accepts an optional correlationId param. Admin
 *     routes pass req.id; internal cron callers either pass their own UUID or
 *     setMode() generates one (opCorrelationId) so the row is never null.
 *   - prop-firm-health.pollPropFirmHealth() generates one cronCorrelationId per
 *     15-min sweep tick and threads it through to both suspension_detected /
 *     suspension_cleared audit rows.
 *   - exchange-status.pollCmeStatus() generates one cronCorrelationId per
 *     60-second sweep tick and threads it through to outage_detected /
 *     outage_resolved audit rows.
 *
 * This file verifies the source contracts (signatures + call shapes) by
 * inspecting the compiled module exports + reading the source file for the
 * pattern guards. Mirrors the wave6-cron-correlation.test.ts shape.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_CONTROL = resolve(__dirname, "../pipeline-control-service.ts");
const PROP_FIRM_HEALTH = resolve(__dirname, "../prop-firm-health-service.ts");
const EXCHANGE_STATUS = resolve(__dirname, "../exchange-status-service.ts");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("Wave-7 D — no correlationId: null in 3 HTTP-callable services", () => {
  it("pipeline-control-service has zero correlationId: null literals", () => {
    expect(read(PIPELINE_CONTROL)).not.toMatch(/correlationId:\s*null/);
  });
  it("prop-firm-health-service has zero correlationId: null literals", () => {
    expect(read(PROP_FIRM_HEALTH)).not.toMatch(/correlationId:\s*null/);
  });
  it("exchange-status-service has zero correlationId: null literals", () => {
    expect(read(EXCHANGE_STATUS)).not.toMatch(/correlationId:\s*null/);
  });
});

describe("Wave-7 D — audit writes use insertAuditRow, not raw db.insert(auditLog)", () => {
  it("pipeline-control-service does not call db.insert(auditLog) directly", () => {
    expect(read(PIPELINE_CONTROL)).not.toMatch(/db\.insert\(auditLog\)/);
  });
  it("prop-firm-health-service does not call db.insert(auditLog) directly", () => {
    expect(read(PROP_FIRM_HEALTH)).not.toMatch(/db\.insert\(auditLog\)/);
  });
  it("exchange-status-service does not call db.insert(auditLog) directly", () => {
    expect(read(EXCHANGE_STATUS)).not.toMatch(/db\.insert\(auditLog\)/);
  });
  it("pipeline-control-service imports insertAuditRow", () => {
    expect(read(PIPELINE_CONTROL)).toMatch(/from\s+["']\.\.\/lib\/audit-log-helper\.js["']/);
  });
  it("prop-firm-health-service imports insertAuditRow", () => {
    expect(read(PROP_FIRM_HEALTH)).toMatch(/from\s+["']\.\.\/lib\/audit-log-helper\.js["']/);
  });
  it("exchange-status-service imports insertAuditRow", () => {
    expect(read(EXCHANGE_STATUS)).toMatch(/from\s+["']\.\.\/lib\/audit-log-helper\.js["']/);
  });
});

describe("Wave-7 D — cron paths generate cronCorrelationId at tick top", () => {
  it("pollPropFirmHealth generates cronCorrelationId via randomUUID() inside function body", () => {
    const src = read(PROP_FIRM_HEALTH);
    const fnIdx = src.indexOf("export async function pollPropFirmHealth");
    expect(fnIdx).toBeGreaterThan(0);
    const fnBody = src.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/cronCorrelationId\s*=\s*randomUUID\(\)/);
  });
  it("pollCmeStatus generates cronCorrelationId via randomUUID() inside function body", () => {
    const src = read(EXCHANGE_STATUS);
    const fnIdx = src.indexOf("export async function pollCmeStatus");
    expect(fnIdx).toBeGreaterThan(0);
    const fnBody = src.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/cronCorrelationId\s*=\s*randomUUID\(\)/);
  });
  it("setMode accepts correlationId parameter and falls back to randomUUID()", () => {
    const src = read(PIPELINE_CONTROL);
    expect(src).toMatch(/setMode\([\s\S]*?correlationId:\s*string\s*\|\s*null/);
    expect(src).toMatch(/opCorrelationId\s*=\s*correlationId\s*\?\?\s*randomUUID\(\)/);
  });
});

describe("Wave-7 D — admin routes pass req.id to setMode", () => {
  it("admin pipeline/start route passes req.id as 3rd setMode arg", () => {
    const adminPath = resolve(__dirname, "../../routes/admin.ts");
    const src = read(adminPath);
    // Each of /pipeline/start, /pause, /vacation should pass req.id ?? null as 3rd arg.
    const matches = src.match(/setMode\(\s*["'](?:ACTIVE|PAUSED|VACATION)["']\s*,\s*reason\s*,\s*req\.id\s*\?\?\s*null/g);
    expect(matches?.length).toBe(3);
  });
});
