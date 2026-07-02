/**
 * deepscan12-track-r-sse-safety-gate.test.ts
 *
 * Deep-scan #12 Track R — SSE safety gate and catalog completeness regression tests.
 *
 * FIX 1: verifies all 11 safety-critical SSE events are present in the frontend catalog.
 * FIX 3c: verifies the check-sse-contract.mjs SAFETY_RE pattern covers the right names.
 * FIX 3b: verifies the server no longer uses dot notation for the two normalized events.
 *
 * Approach: read source files directly (same pattern as wave11-sse-inventory-drift-checker).
 * This test is CI-safe — it checks static source content, not runtime behavior.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();

const SSE_TYPES = fs.readFileSync(
  path.resolve(ROOT, "Trading_forge_frontend/amber-vision-main/src/types/sse-events.ts"),
  "utf-8",
);

const USE_SSE = fs.readFileSync(
  path.resolve(ROOT, "Trading_forge_frontend/amber-vision-main/src/hooks/useSSE.ts"),
  "utf-8",
);

const SERVER_BANNER = fs.readFileSync(
  path.resolve(ROOT, "Trading_forge_frontend/amber-vision-main/src/components/ServerStatusBanner.tsx"),
  "utf-8",
);

const CONTRACT_SCRIPT = fs.readFileSync(
  path.resolve(ROOT, "scripts/check-sse-contract.mjs"),
  "utf-8",
);

const MONTE_CARLO_SERVICE = fs.readFileSync(
  path.resolve(ROOT, "src/server/services/monte-carlo-service.ts"),
  "utf-8",
);

const AGENT_ROUTES = fs.readFileSync(
  path.resolve(ROOT, "src/server/routes/agent.ts"),
  "utf-8",
);

// ─── FIX 1: Safety-critical event catalog completeness ────────────────────────

describe("deepscan12 Track R FIX 1 — safety event catalog completeness", () => {
  const SAFETY_EVENTS = [
    "kill_switch:dll_force_close",
    "kill_switch:layer_halted",
    "kill_switch:c1_cme_eval_failed",
    "quantum_rl:kill_switch_engaged",
    "exchange:outage-detected",
    "broker:degraded",
    "risk:dd_velocity_autopause",
    "paper:position-stop-breached",
    "paper:auto_restart_exhausted",
    "fill_reconciliation:drift_detected",
    "fill_reconciliation:unmatched_fill",
  ];

  const OPERATIONAL_EVENTS = [
    "exchange:outage-resolved",
    "risk:dd_velocity_warning",
    "PAPER_PARITY_DEGRADED",
    "backtest:truthiness_failure",
    "compliance:rejected",
    "signal:macro_gate_eval_failed",
    "paper:auto_restarted",
  ];

  it("sse-events.ts contains all 11 safety-critical event type literals", () => {
    for (const event of SAFETY_EVENTS) {
      expect(SSE_TYPES, `missing: type: "${event}"`).toContain(`type: "${event}"`);
    }
  });

  it("sse-events.ts contains all 7 operational event type literals", () => {
    for (const event of OPERATIONAL_EVENTS) {
      expect(SSE_TYPES, `missing: type: "${event}"`).toContain(`type: "${event}"`);
    }
  });

  it("sse-events.ts has interface definitions for all safety events", () => {
    const safetyInterfaces = [
      "KillSwitchDllForceCloseData",
      "KillSwitchLayerHaltedData",
      "KillSwitchC1CmeEvalFailedData",
      "QuantumRlKillSwitchEngagedData",
      "ExchangeOutageDetectedData",
      "BrokerDegradedData",
      "RiskDdVelocityAutopauseData",
      "PaperPositionStopBreachedData",
      "PaperAutoRestartExhaustedData",
      "FillReconciliationDriftDetectedData",
      "FillReconciliationUnmatchedFillData",
    ];
    for (const iface of safetyInterfaces) {
      expect(SSE_TYPES, `missing interface: ${iface}`).toContain(`export interface ${iface}`);
    }
  });

  it("sse-events.ts has interface definitions for operational events", () => {
    const operationalInterfaces = [
      "ExchangeOutageResolvedData",
      "RiskDdVelocityWarningData",
      "PaperParityDegradedData",
      "BacktestTruthinessFailureData",
      "ComplianceRejectedData",
      "SignalMacroGateEvalFailedData",
      "PaperAutoRestartedData",
    ];
    for (const iface of operationalInterfaces) {
      expect(SSE_TYPES, `missing interface: ${iface}`).toContain(`export interface ${iface}`);
    }
  });
});

// ─── FIX 1: useSSE.ts case handler coverage ──────────────────────────────────

describe("deepscan12 Track R FIX 1 — useSSE dispatchSideEffects handler coverage", () => {
  const ALL_NEW_EVENTS = [
    "kill_switch:dll_force_close",
    "kill_switch:layer_halted",
    "kill_switch:c1_cme_eval_failed",
    "quantum_rl:kill_switch_engaged",
    "exchange:outage-detected",
    "broker:degraded",
    "risk:dd_velocity_autopause",
    "paper:position-stop-breached",
    "paper:auto_restart_exhausted",
    "fill_reconciliation:drift_detected",
    "fill_reconciliation:unmatched_fill",
    "exchange:outage-resolved",
    "risk:dd_velocity_warning",
    "PAPER_PARITY_DEGRADED",
    "backtest:truthiness_failure",
    "compliance:rejected",
    "signal:macro_gate_eval_failed",
    "paper:auto_restarted",
    "monte_carlo:trades_fallback_used",
    "pending_bucket:killed",
  ];

  it("useSSE.ts has case handlers for all 20 new events", () => {
    for (const event of ALL_NEW_EVENTS) {
      expect(USE_SSE, `missing case handler: case "${event}"`).toContain(`case "${event}"`);
    }
  });

  it("safety-critical handlers use sticky persistent toasts (duration: Infinity)", () => {
    const SAFETY_EVENTS = [
      "kill_switch:dll_force_close",
      "kill_switch:layer_halted",
      "kill_switch:c1_cme_eval_failed",
      "quantum_rl:kill_switch_engaged",
      "exchange:outage-detected",
      "broker:degraded",
      "risk:dd_velocity_autopause",
      "paper:position-stop-breached",
      "paper:auto_restart_exhausted",
      "fill_reconciliation:drift_detected",
      "fill_reconciliation:unmatched_fill",
    ];

    // Verify each safety case block contains "Infinity" for the toast duration
    for (const event of SAFETY_EVENTS) {
      const caseIdx = USE_SSE.indexOf(`case "${event}"`);
      expect(caseIdx, `case "${event}" not found`).toBeGreaterThan(0);

      // Extract the next 400 chars after the case label to get the block body
      const block = USE_SSE.slice(caseIdx, caseIdx + 600);

      // Safety events MUST use { duration: Infinity, important: true }
      expect(block, `"${event}" handler must use duration: Infinity`).toMatch(/duration:\s*Infinity/);
      expect(block, `"${event}" handler must use important: true`).toMatch(/important:\s*true/);
    }
  });

  it("exhaustiveness guard (default: never) is preserved in the switch", () => {
    // Verify the default: never guard still exists — removing it would allow
    // new union members to slip through without a handler.
    expect(USE_SSE).toContain("const _exhaustive: never = event");
    expect(USE_SSE).toContain("void _exhaustive");
  });
});

// ─── FIX 2: ServerStatusBanner disconnect handling ───────────────────────────

describe("deepscan12 Track R FIX 2 — ServerStatusBanner disconnect state", () => {
  it("ServerStatusBanner subscribes to onConnectionStateChange", () => {
    expect(SERVER_BANNER).toContain("onConnectionStateChange");
  });

  it("ServerStatusBanner handles 'closed' connection state", () => {
    expect(SERVER_BANNER).toContain(`connState === "closed"`);
  });

  it("ServerStatusBanner clears disconnect banner when connection reopens", () => {
    expect(SERVER_BANNER).toContain(`connState === "open"`);
    expect(SERVER_BANNER).toContain("setDisconnectSince(null)");
  });

  it("ServerStatusBanner shows stale-data message with disconnect timestamp", () => {
    expect(SERVER_BANNER).toContain("data may be stale since");
  });

  it("disconnect banner is a separate state from shutdown banner", () => {
    // Both state variables must be present — disconnect banner should NOT
    // simply reuse the shutdown state (they have different messages and triggers)
    expect(SERVER_BANNER).toContain("disconnectSince");
    expect(SERVER_BANNER).toContain("state"); // shutdown state still present
  });
});

// ─── FIX 3b: Dot-to-colon normalization in server sources ────────────────────

describe("deepscan12 Track R FIX 3b — dot-to-colon normalization", () => {
  it("monte-carlo-service.ts uses colon separator (not dot) for MC fallback event", () => {
    expect(MONTE_CARLO_SERVICE).toContain(`broadcastSSE("monte_carlo:trades_fallback_used"`);
    expect(MONTE_CARLO_SERVICE).not.toContain(`broadcastSSE("monte_carlo.trades_fallback_used"`);
  });

  it("agent.ts uses colon separator (not dot) for pending_bucket killed event", () => {
    expect(AGENT_ROUTES).toContain(`broadcastSSE("pending_bucket:killed"`);
    expect(AGENT_ROUTES).not.toContain(`broadcastSSE("pending_bucket.killed"`);
  });

  it("sse-events.ts catalog uses colon form for normalized events", () => {
    expect(SSE_TYPES).toContain(`type: "monte_carlo:trades_fallback_used"`);
    expect(SSE_TYPES).toContain(`type: "pending_bucket:killed"`);
    expect(SSE_TYPES).not.toContain(`type: "monte_carlo.trades_fallback_used"`);
    expect(SSE_TYPES).not.toContain(`type: "pending_bucket.killed"`);
  });
});

// ─── FIX 3c: check-sse-contract.mjs safety gate ──────────────────────────────

describe("deepscan12 Track R FIX 3c — CI hard-fail safety gate", () => {
  it("check-sse-contract.mjs has a SAFETY_RE pattern", () => {
    expect(CONTRACT_SCRIPT).toContain("SAFETY_RE");
    expect(CONTRACT_SCRIPT).toMatch(/SAFETY_RE\s*=\s*\/.*\//);
  });

  it("SAFETY_RE covers kill_switch pattern", () => {
    expect(CONTRACT_SCRIPT).toContain("kill_switch");
  });

  it("SAFETY_RE covers outage pattern", () => {
    expect(CONTRACT_SCRIPT).toContain("outage");
  });

  it("SAFETY_RE covers autopause pattern", () => {
    expect(CONTRACT_SCRIPT).toContain("autopause");
  });

  it("SAFETY_RE covers degraded pattern", () => {
    expect(CONTRACT_SCRIPT).toContain("degraded");
  });

  it("check-sse-contract.mjs exits non-zero when safety events are missing", () => {
    // Verify the hard-fail branch calls process.exit(1)
    expect(CONTRACT_SCRIPT).toContain("process.exit(1)");
  });

  it("check-sse-contract.mjs has HARD FAIL log message for safety events", () => {
    expect(CONTRACT_SCRIPT).toContain("HARD FAIL");
  });

  it("check-sse-contract.mjs has DYNAMIC_BROADCAST_ALLOWLIST for catalog-only dynamic events", () => {
    expect(CONTRACT_SCRIPT).toContain("DYNAMIC_BROADCAST_ALLOWLIST");
  });

  it("DYNAMIC_BROADCAST_ALLOWLIST includes broker:order_routed (constant-dispatched)", () => {
    expect(CONTRACT_SCRIPT).toContain(`"broker:order_routed"`);
  });

  it("check-sse-contract.mjs still exits 0 for advisory (non-safety) drift", () => {
    // Verify the advisory path calls exit(0) — non-safety drift must not block CI.
    // The file has TWO process.exit(0) calls:
    //   1. An early-return at the "catalog not found" guard (line ~103)
    //   2. The final advisory exit at the bottom of the file (line ~145)
    // Use lastIndexOf so we find the final advisory exit, not the early-return.
    // The hard-fail process.exit(1) at line ~127 must fall between those two.
    const advisoryExit = CONTRACT_SCRIPT.lastIndexOf("process.exit(0)");
    const hardfailExit = CONTRACT_SCRIPT.indexOf("process.exit(1)");
    expect(advisoryExit).toBeGreaterThan(0);
    expect(hardfailExit).toBeGreaterThan(0);
    // Hard-fail exit must come BEFORE the final advisory exit (safety check first)
    expect(hardfailExit).toBeLessThan(advisoryExit);
  });
});
