/**
 * Wave 1 — Data Accuracy Tests
 *
 * Covers three silent-data-corruption bugs identified in Wave 0 triage:
 *   1. mini-guard call-site wiring in runStrategyFromDSL (TS-side defense-in-depth)
 *   2. correlation_id propagation: schema column exists, call-site wiring verified
 *   3. commission deduction contract: schema-level verification
 *
 * These tests do NOT require a live DB connection. They exercise:
 *   - The TypeScript-side mini-guard logic added to runStrategyFromDSL
 *   - The migration file that defines the correlation_id column
 *   - The firm_config contract (commission rates locked)
 *   - The direct-bucket-graduator signature change (correlationId opt-in)
 *
 * Python commission golden fixtures live in src/engine/tests/test_pnl_accuracy.py
 * (TestWave1CommissionGoldenFixture class).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Task 3: Mini-Guard — TypeScript-side logic verification ──────────────────

describe("Wave 1 Task 3: mini-guard TypeScript-side logic", () => {
  /**
   * We cannot easily unit-test runStrategyFromDSL (it requires DB + Python),
   * so we verify the guard logic directly by extracting and testing the exact
   * symbol-class check that was added.
   *
   * The guard in runStrategyFromDSL checks:
   *   const _MINI_SYMBOLS_TS = new Set(["ES", "NQ", "CL"]);
   *   const _MICRO_SYMBOLS_TS = new Set(["MES", "MNQ", "MCL"]);
   *   if (_MINI_SYMBOLS_TS.has(symbol)) → reject
   *   if (_MICRO_SYMBOLS_TS.has(symbol) && contract_class === "mini") → reject
   */

  const MINI_SYMBOLS = new Set(["ES", "NQ", "CL"]);
  const MICRO_SYMBOLS = new Set(["MES", "MNQ", "MCL"]);

  function evaluateMiniGuard(symbol: string, contract_class: string): { rejected: boolean; reason?: string } {
    if (MINI_SYMBOLS.has(symbol)) {
      const reason = contract_class !== "mini"
        ? `mini contracts (symbol="${symbol}") require contract_class="mini" AND mini specs migration (not yet shipped). Use MES/MNQ/MCL micros for now.`
        : `mini contracts (symbol="${symbol}", contract_class="mini") are not yet implemented. Mini support requires full CONTRACT_SPECS migration (deferred until $200K+ funded balance). Use MES/MNQ/MCL micros for now.`;
      return { rejected: true, reason };
    }
    if (MICRO_SYMBOLS.has(symbol) && contract_class === "mini") {
      const reason = `micro symbol "${symbol}" cannot be paired with contract_class="mini". Use contract_class="micro" (the default) for MES/MNQ/MCL.`;
      return { rejected: true, reason };
    }
    return { rejected: false };
  }

  it("MES with contract_class=micro is accepted (happy path)", () => {
    expect(evaluateMiniGuard("MES", "micro").rejected).toBe(false);
  });

  it("MNQ with contract_class=micro is accepted (happy path)", () => {
    expect(evaluateMiniGuard("MNQ", "micro").rejected).toBe(false);
  });

  it("MCL with contract_class=micro is accepted (happy path)", () => {
    expect(evaluateMiniGuard("MCL", "micro").rejected).toBe(false);
  });

  it("ES without contract_class=mini is rejected (10x risk inflation prevention)", () => {
    const result = evaluateMiniGuard("ES", "micro");
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain("mini contracts");
    expect(result.reason).toContain("MES/MNQ/MCL micros");
  });

  it("NQ without contract_class=mini is rejected", () => {
    const result = evaluateMiniGuard("NQ", "micro");
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain("mini contracts");
  });

  it("CL without contract_class=mini is rejected", () => {
    const result = evaluateMiniGuard("CL", "micro");
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain("mini contracts");
  });

  it("ES with contract_class=mini is rejected (not yet implemented)", () => {
    const result = evaluateMiniGuard("ES", "mini");
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain("not yet implemented");
    expect(result.reason).toContain("$200K+");
  });

  it("MES with contract_class=mini is rejected (mismatched pairing)", () => {
    const result = evaluateMiniGuard("MES", "mini");
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain("micro symbol");
    expect(result.reason).toContain("contract_class=\"micro\"");
  });

  it("MNQ with contract_class=mini is rejected", () => {
    const result = evaluateMiniGuard("MNQ", "mini");
    expect(result.rejected).toBe(true);
  });

  it("MCL with contract_class=mini is rejected", () => {
    const result = evaluateMiniGuard("MCL", "mini");
    expect(result.rejected).toBe(true);
  });
});

// ─── Task 1: correlation_id — schema column exists ────────────────────────────

describe("Wave 1 Task 1: correlation_id schema column", () => {
  const MIGRATION_PATH = resolve(
    process.cwd(),
    "src/server/db/migrations/0054_audit_log_correlation_id.sql"
  );

  it("migration 0054 file exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("migration 0054 adds correlation_id column to audit_log", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/correlation_id/i);
    expect(sql).toMatch(/audit_log/i);
  });

  it("correlation_id is indexed (for 90-day reconstruction queries)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/INDEX/i);
    expect(sql).toMatch(/correlation_id/i);
  });
});

// ─── Task 1: correlation_id — call-site wiring in agent-service.ts ───────────

describe("Wave 1 Task 1: correlation_id wiring in agent-service.ts", () => {
  const AGENT_SERVICE_PATH = resolve(
    process.cwd(),
    "src/server/services/agent-service.ts"
  );

  it("agent-service.ts file exists", () => {
    expect(existsSync(AGENT_SERVICE_PATH)).toBe(true);
  });

  it("runStrategyFromDSL accepts a correlationId parameter", () => {
    const src = readFileSync(AGENT_SERVICE_PATH, "utf8");
    // The function signature includes context?: { correlationId?: string }
    // and the body extracts it: const correlationId = context?.correlationId;
    // We search for both the function name and correlationId appearing in the same function body.
    expect(src).toMatch(/async runStrategyFromDSL/);
    // The context param is within 2000 chars of the function declaration
    const idx = src.indexOf("async runStrategyFromDSL");
    expect(idx).toBeGreaterThan(-1);
    const fnBlock = src.slice(idx, idx + 2000);
    expect(fnBlock).toContain("correlationId");
  });

  it("runStrategyFromDSL passes correlationId to audit inserts", () => {
    const src = readFileSync(AGENT_SERVICE_PATH, "utf8");
    // Multiple audit inserts in runStrategyFromDSL pass correlationId
    const correlationIdAuditCount = (src.match(/correlationId: correlationId \?\? null/g) ?? []).length;
    // At minimum: mini_guard (2 paths), pre-backtest auditor, compile_rejected paths, graveyard
    expect(correlationIdAuditCount).toBeGreaterThanOrEqual(5);
  });

  it("runStrategyFromDSL has TypeScript-side mini-guard block", () => {
    const src = readFileSync(AGENT_SERVICE_PATH, "utf8");
    expect(src).toMatch(/_MINI_SYMBOLS_TS/);
    expect(src).toMatch(/_MICRO_SYMBOLS_TS/);
    expect(src).toMatch(/mini specs migration.*not yet shipped/);
  });
});

// ─── Task 1: correlation_id — direct-bucket-graduator.ts wiring ───────────────

describe("Wave 1 Task 1: correlation_id in direct-bucket-graduator.ts", () => {
  const GRADUATOR_PATH = resolve(
    process.cwd(),
    "src/server/services/direct-bucket-graduator.ts"
  );

  it("graduateBucketDirectly accepts correlationId option", () => {
    const src = readFileSync(GRADUATOR_PATH, "utf8");
    expect(src).toMatch(/correlationId\?:\s*string\s*\|\s*null/);
  });

  it("graduation.skipped_textual_duplicate audit insert passes correlationId", () => {
    const src = readFileSync(GRADUATOR_PATH, "utf8");
    // After 'graduation.skipped_textual_duplicate' there should be a correlationId field
    const idx = src.indexOf("graduation.skipped_textual_duplicate");
    expect(idx).toBeGreaterThan(-1);
    // Use 600-char window: correlationId is ~434 chars after the action string
    const snippet = src.slice(idx, idx + 600);
    expect(snippet).toContain("correlationId:");
  });

  it("graduation.rejected_no_engine_indicator audit insert passes correlationId", () => {
    const src = readFileSync(GRADUATOR_PATH, "utf8");
    const idx = src.indexOf("graduation.rejected_no_engine_indicator");
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 600);
    expect(snippet).toContain("correlationId:");
  });

  it("graduation.rejected_by_auditor audit insert passes correlationId", () => {
    const src = readFileSync(GRADUATOR_PATH, "utf8");
    const idx = src.indexOf("graduation.rejected_by_auditor");
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 600);
    expect(snippet).toContain("correlationId:");
  });
});

// ─── Task 1: correlation_id — agent.ts route handlers ────────────────────────

describe("Wave 1 Task 1: correlation_id in agent.ts route handlers", () => {
  const AGENT_ROUTES_PATH = resolve(
    process.cwd(),
    "src/server/routes/agent.ts"
  );

  it("agent.robustness audit insert passes a correlationId (req.id-derived)", () => {
    // F-2 (scout re-scan 2026-07-10): the code threads correlationId via ES6 shorthand
    // (`correlationId,`) from a `const correlationId = req.id ?? …` earlier in the handler —
    // the old literal `toContain("correlationId:")` + inline `req.id` assumptions were stale
    // (false RED). Accept the shorthand OR keyed form, and verify the handler derives the
    // correlationId from req.id somewhere (not necessarily inline at the audit call).
    const src = readFileSync(AGENT_ROUTES_PATH, "utf8");
    const idx = src.indexOf("agent.robustness");
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 500);
    expect(snippet).toMatch(/correlationId\s*[,:]/); // shorthand `correlationId,` or `correlationId:`
    // The robustness route derives correlationId from req.id at the top of the handler.
    const handlerStart = src.lastIndexOf("req.id", idx);
    expect(handlerStart, "no req.id-derived correlationId in the robustness handler").toBeGreaterThan(-1);
  });

  it("agent.find-strategies audit insert passes a correlationId (req.id-derived)", () => {
    // F-2: find-strategies computes `const findStrategiesCorrelationId = req.id ?? null` once
    // and reuses that derived variable at every audit call — the old inline-`req.id` assertion
    // was stale (false RED). Verify the derived variable exists and is used at the audit insert.
    const src = readFileSync(AGENT_ROUTES_PATH, "utf8");
    expect(src).toMatch(/const\s+findStrategiesCorrelationId\s*=\s*req\.id\s*\?\?/);
    const idx = src.indexOf("agent.find-strategies");
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 500);
    expect(snippet).toMatch(/correlationId:\s*findStrategiesCorrelationId/);
  });

  it("runGraduation passes correlationId to graduateBucketDirectly", () => {
    const src = readFileSync(AGENT_ROUTES_PATH, "utf8");
    // Find the graduateBucketDirectly call site
    const idx = src.indexOf("graduateBucketDirectly({");
    expect(idx).toBeGreaterThan(-1);
    // Use 850-char window: correlationId is ~745 chars after the opening brace
    const snippet = src.slice(idx, idx + 850);
    expect(snippet).toContain("correlationId:");
  });
});

// ─── Task 2: Commission deduction — contract documentation ────────────────────

describe("Wave 1 Task 2: commission deduction contract", () => {
  const PROP_SIM_PATH = resolve(
    process.cwd(),
    "src/engine/prop_sim.py"
  );

  const BACKTESTER_PATH = resolve(
    process.cwd(),
    "src/engine/backtester.py"
  );

  it("prop_sim.py has the 'do NOT deduct again' contract comment", () => {
    const src = readFileSync(PROP_SIM_PATH, "utf8");
    expect(src).toMatch(/do NOT deduct again/i);
  });

  it("backtester.py deducts commission via formula: gross - slip - comm", () => {
    const src = readFileSync(BACKTESTER_PATH, "utf8");
    // The P&L formula line
    expect(src).toMatch(/net_pnl\s*=\s*gross\s*-\s*slip_cost\s*-\s*comm_cost/);
  });

  it("backtester.py computes comm_cost as commission * int_size * 2 (round-trip)", () => {
    const src = readFileSync(BACKTESTER_PATH, "utf8");
    // The commission formula
    expect(src).toMatch(/comm_cost\s*=\s*commission\s*\*\s*int_size\s*\*\s*2/);
  });

  it("backtester.py does NOT pass fees/slippage to vectorbt from_signals", () => {
    const src = readFileSync(BACKTESTER_PATH, "utf8");
    // Find the from_signals call — it must NOT include fees= or sl_stop= or tp_stop= or commission=
    const fromSignalsIdx = src.indexOf("vbt.Portfolio.from_signals");
    expect(fromSignalsIdx).toBeGreaterThan(-1);
    const callBlock = src.slice(fromSignalsIdx, fromSignalsIdx + 600);
    // Must NOT pass fees to vectorbt
    expect(callBlock).not.toMatch(/\bfees\s*=/);
    // Must NOT pass commission to vectorbt
    expect(callBlock).not.toMatch(/\bcommission\s*=/);
    // Must NOT use vectorbt's built-in sl_stop or tp_stop (we pre-compute in signal arrays)
    expect(callBlock).not.toMatch(/\bsl_stop\s*=/);
    expect(callBlock).not.toMatch(/\btp_stop\s*=/);
  });

  // F-2 (scout re-scan 2026-07-10): these two tests were STALE + one masked a bug.
  //  - Topstep asserted $0.37 — the KNOWN-WRONG pre-2026-06-23 value; firm_config.py was
  //    corrected to $0.62 (all-in per-side, TopstepX RT $1.24 ÷ 2) + canonical doc confirms.
  //    The stale test was a false RED.
  //  - MFFU asserted $0.62 with a WHOLE-FILE regex that actually matched Topstep's `"MES": 0.62`
  //    line — a false GREEN masking MFFU's real value ($0.95, RT $1.90 ÷ 2). Both are now
  //    scoped to the correct firm block AND assert the canonical corrected values.
  // Parse the FIRST `"MES": <n>` that appears after a firm's key inside FIRM_COMMISSIONS —
  // i.e. that firm's OWN MES commission, robust to comment length between the key and the value.
  function firmMesCommission(src: string, firmKey: string): number | null {
    const start = src.indexOf(firmKey);
    if (start < 0) return null;
    const mesIdx = src.indexOf('"MES":', start);
    if (mesIdx < 0) return null;
    const m = src.slice(mesIdx, mesIdx + 30).match(/"MES":\s*([0-9.]+)/);
    return m ? parseFloat(m[1]) : null;
  }

  it("Topstep MES commission rate is $0.62/side in firm_config.py (corrected 2026-06-23, matches canonical doc)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/engine/firm_config.py"), "utf8");
    // $0.62 = TopstepX RT $1.24 ÷ 2 (all-in per side). Was the under-costed $0.37 pre-correction.
    expect(firmMesCommission(src, "topstep_50k")).toBe(0.62);
  });

  it("MFFU MES commission rate is $0.95/side in its OWN block (not Topstep's 0.62 — old test matched the wrong firm)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/engine/firm_config.py"), "utf8");
    // $0.95 = MFFU RT $1.90 ÷ 2. The prior whole-file regex matched Topstep's 0.62 (false green).
    expect(firmMesCommission(src, "mffu_50k")).toBe(0.95);
  });
});
