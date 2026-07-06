/**
 * paper-signal-eligibility-uuid-fix.test.ts
 *
 * Deep-scan C-1 regression: the live context/eligibility gate must be passed the
 * strategy CONCEPT NAME, not the strategy UUID.
 *
 * Bug: `evaluateContextGate(..., sessionConfig.strategyId, ...)` passed the Postgres
 * UUID where `eligibility_gate.py` name-matches against playbook allowed_strategies.
 * A UUID never matches → every live/paper signal SKIPped on any non-NO_TRADE playbook,
 * while backtest (which passes strategy.name) graded clean — a silent paper/backtest
 * parity break of the entire live eligibility overlay.
 *
 * Source-code structural assertions, per the convention documented in
 * paper-signal-service-deepscan-findings.test.ts (evaluatePaperSignals has too many
 * gateway dependencies for an isolated behavioral test; structural assertions verify
 * the invariant directly).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

describe("deep-scan C-1 — context gate must receive the concept name, not the UUID", () => {
  it("CachedSession carries a `name` field", () => {
    const ifaceStart = SRC.indexOf("interface CachedSession {");
    expect(ifaceStart).toBeGreaterThan(-1);
    const ifaceBody = SRC.slice(ifaceStart, SRC.indexOf("}", ifaceStart));
    expect(ifaceBody).toMatch(/\bname:\s*string;/);
  });

  it("getSessionConfig populates name from strategy.name", () => {
    expect(SRC).toContain("name: strategy.name,");
  });

  it("the evaluateContextGate call passes sessionConfig.name", () => {
    expect(SRC).toContain("sessionConfig.name, barBuffer, indicators");
  });

  it("REGRESSION GUARD: the gate call must NOT pass sessionConfig.strategyId (the UUID)", () => {
    expect(SRC).not.toContain("sessionConfig.strategyId, barBuffer, indicators");
  });
});
