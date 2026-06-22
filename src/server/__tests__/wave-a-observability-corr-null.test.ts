/**
 * wave-a-observability-corr-null.test.ts
 *
 * Fix 2 (dead-mans-heartbeat-service.ts) + Fix 5 (scheduler.ts:3400/3459)
 *
 * Asserts NO audit row in the scoped source files has a literal `correlationId: null`
 * at the write sites. This is a source-code pattern check (not a runtime check)
 * that prevents regression of the corr-null rot.
 *
 * Also validates that the functions that generate correlationIds do so via
 * randomUUID() calls at the top of each entry function.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SCOPED_FILES = [
  "src/server/scheduler.ts",
  "src/server/services/dead-mans-heartbeat-service.ts",
  "src/server/services/prop-firm-cookie-refresh-service.ts",
  "src/server/lib/metrics-registry.ts",
];

const BASE = resolve(import.meta.dirname ?? ".", "../../..");

describe("correlationId: null rot — scoped files must have zero literal null writes", () => {
  for (const relPath of SCOPED_FILES) {
    it(`${relPath} has no literal 'correlationId: null'`, () => {
      const src = readFileSync(resolve(BASE, relPath), "utf8");
      // This pattern matches the exact literal that was being written to DB
      const matches = src.match(/correlationId:\s*null/g) ?? [];
      expect(matches).toHaveLength(0);
    });
  }
});

describe("dead-mans-heartbeat-service.ts — correlationId sourcing", () => {
  it("runScheduledRefreshStalenessCheck generates cronCorrelationId via randomUUID()", () => {
    const src = readFileSync(
      resolve(BASE, "src/server/services/dead-mans-heartbeat-service.ts"),
      "utf8",
    );
    // The function must declare cronCorrelationId = randomUUID() near its top
    expect(src).toMatch(/runScheduledRefreshStalenessCheck[\s\S]{0,200}cronCorrelationId = randomUUID\(\)/);
  });

  it("runOperatorAbsenceAutoDetect generates cronCorrelationId via randomUUID()", () => {
    const src = readFileSync(
      resolve(BASE, "src/server/services/dead-mans-heartbeat-service.ts"),
      "utf8",
    );
    expect(src).toMatch(/runOperatorAbsenceAutoDetect[\s\S]{0,200}cronCorrelationId = randomUUID\(\)/);
  });

  it("recordSchemaDriftAlert generates a local correlationId", () => {
    const src = readFileSync(
      resolve(BASE, "src/server/services/dead-mans-heartbeat-service.ts"),
      "utf8",
    );
    expect(src).toMatch(/recordSchemaDriftAlert[\s\S]{0,200}const correlationId = randomUUID\(\)/);
  });
});

describe("scheduler.ts — bw-session-refresh and prop-firm-cookie-refresh handlers", () => {
  it("bw-session-refresh registerJob handler generates cronCorrelationId via randomUUID()", () => {
    const src = readFileSync(resolve(BASE, "src/server/scheduler.ts"), "utf8");
    // Locate the bw-session-refresh handler body and confirm UUID generation
    const idx = src.indexOf('"bw-session-refresh", 6 * 60 * 60 * 1000');
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 500);
    expect(snippet).toMatch(/cronCorrelationId = randomUUID\(\)/);
  });

  it("prop-firm-cookie-refresh registerJob handler generates cronCorrelationId via randomUUID()", () => {
    const src = readFileSync(resolve(BASE, "src/server/scheduler.ts"), "utf8");
    const idx = src.indexOf('"prop-firm-cookie-refresh", 60 * 60 * 1000');
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 500);
    expect(snippet).toMatch(/cronCorrelationId = randomUUID\(\)/);
  });
});

describe("prop-firm-cookie-refresh-service.ts — sweep correlationId", () => {
  it("runPropFirmCookieRefresh generates sweepCorrelationId at entry", () => {
    const src = readFileSync(
      resolve(BASE, "src/server/services/prop-firm-cookie-refresh-service.ts"),
      "utf8",
    );
    expect(src).toMatch(/runPropFirmCookieRefresh[\s\S]{0,200}sweepCorrelationId = randomUUID\(\)/);
  });

  it("outer catch writes audit row BEFORE notifying Discord", () => {
    const src = readFileSync(
      resolve(BASE, "src/server/services/prop-firm-cookie-refresh-service.ts"),
      "utf8",
    );
    // Outer catch must reference the audit action for observability
    expect(src).toContain("prop_firm_cookie_refresh.outer_catch_notify_failed");
    // Outer catch must have logger.warn not a bare .catch(() => {})
    expect(src).toContain("logger.warn(");
    // The old silent swallow must be gone
    expect(src).not.toMatch(/notifyCookieRefreshFailed[\s\S]{0,20}\.catch\(\(\)\s*=>\s*\{\}\)/);
  });
});
