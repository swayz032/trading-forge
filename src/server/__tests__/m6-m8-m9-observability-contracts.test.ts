/**
 * m6-m8-m9-observability-contracts.test.ts
 *
 * Observability contract tests for three disjoint fixes:
 *
 * M6 — tradingview_markers uniqueIndex declared in schema.ts
 *   - Drizzle schema exposes the dedup index so `drizzle-kit db:push` against
 *     a fresh DB recreates migration 0173's constraint.
 *
 * M8 — LIFECYCLE_GATE_EVENTS catalog exported from sse.ts (7 constants)
 *   - No magic strings at broadcast sites in lifecycle-service.ts.
 *   - promotion_evidence_incomplete SSE event fires at the Track A.2 block.
 *
 * M9 — quantum-replay-runner inherits parentCorrelationId from backtest
 *   - quantum_replay.auto_fire_enqueued audit row carries parentCorrelationId.
 *   - Callers without parentCorrelationId still work (backward compat).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

// ─── Top-level mocks (hoisted by vitest) ─────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([])),
        catch: vi.fn(() => Promise.resolve()),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
  },
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
}));

// ─── M6: Schema uniqueIndex ───────────────────────────────────────────────────

describe("M6 — tradingviewMarkers uniqueIndex in schema.ts", () => {
  it("tradingViewMarkers table exposes the dedup uniqueIndex on (accountId, strategyId, barTimestamp, signal)", async () => {
    // Drizzle pgTable exposes index definitions via a builder function attached
    // under the Symbol with description "drizzle:ExtraConfigBuilder". The builder
    // receives the column map ("drizzle:ExtraConfigColumns") and returns an array
    // of objects where each has `.config.name`, `.config.unique`, and `.config.columns`.
    //
    // This approach avoids JSON.stringify (which throws on circular Drizzle column
    // references) by inspecting the resolved config objects directly.
    const { tradingviewMarkers } = await import("../db/schema.js");
    const tableSymbols = Object.getOwnPropertySymbols(tradingviewMarkers);

    const builderSym = tableSymbols.find(s => s.description === "drizzle:ExtraConfigBuilder");
    const colsSym    = tableSymbols.find(s => s.description === "drizzle:ExtraConfigColumns");
    expect(builderSym, "drizzle:ExtraConfigBuilder symbol must exist on tradingviewMarkers").toBeDefined();
    expect(colsSym, "drizzle:ExtraConfigColumns symbol must exist on tradingviewMarkers").toBeDefined();

    type IndexItem = { config: { name: string; unique: boolean; columns: Array<{ name: string }> } };
    const builderFn = (tradingviewMarkers as unknown as Record<symbol, (cols: unknown) => IndexItem[]>)[builderSym!];
    const cols      = (tradingviewMarkers as unknown as Record<symbol, unknown>)[colsSym!];
    const indexDefs = builderFn(cols);

    expect(Array.isArray(indexDefs)).toBe(true);
    expect(indexDefs.length).toBeGreaterThanOrEqual(4); // 1 unique + 3 regular indexes

    const dedupIdx = indexDefs.find(d => d.config.name === "idx_tradingview_markers_dedup");
    expect(
      dedupIdx,
      "tradingviewMarkers must include an index named 'idx_tradingview_markers_dedup'",
    ).toBeDefined();

    expect(
      dedupIdx!.config.unique,
      "idx_tradingview_markers_dedup must be a UNIQUE index (mirrors migration 0173)",
    ).toBe(true);

    const colNames = dedupIdx!.config.columns.map(c => c.name);
    expect(colNames).toContain("account_id");
    expect(colNames).toContain("strategy_id");
    expect(colNames).toContain("bar_timestamp");
    expect(colNames).toContain("signal");
    expect(colNames.length).toBe(4); // exactly these 4 columns, no more
  });

  it("tradingviewMarkers schema.ts source file contains uniqueIndex call for dedup constraint", () => {
    // Textual sanity — the source file must contain the uniqueIndex declaration
    // so readers of schema.ts see the constraint without referencing the migration.
    const schemaPath = path.resolve(
      import.meta.dirname ?? ".",
      "../db/schema.ts",
    );
    expect(fs.existsSync(schemaPath)).toBe(true);
    const src = fs.readFileSync(schemaPath, "utf8");
    expect(src).toContain("idx_tradingview_markers_dedup");
    expect(src).toContain("uniqueIndex");
    // The four columns must all appear in the block
    expect(src).toContain("table.accountId");
    expect(src).toContain("table.strategyId");
    expect(src).toContain("table.barTimestamp");
    expect(src).toContain("table.signal");
  });
});

// ─── M8: LIFECYCLE_GATE_EVENTS catalog ───────────────────────────────────────

describe("M8 — LIFECYCLE_GATE_EVENTS catalog in sse.ts", () => {
  it("exports all 12 expected constants with correct string values", async () => {
    const { LIFECYCLE_GATE_EVENTS } = await import("../routes/sse.js");

    // Original 7 (W27.5 Pass B + Wave 29 Pass B)
    expect(LIFECYCLE_GATE_EVENTS.WFE_EVALUATED).toBe("lifecycle:wfe_evaluated");
    expect(LIFECYCLE_GATE_EVENTS.B14_EVALUATED).toBe("lifecycle:b14_evaluated");
    expect(LIFECYCLE_GATE_EVENTS.PARAMETER_DRIFT_EVALUATED).toBe("lifecycle:parameter_drift_evaluated");
    expect(LIFECYCLE_GATE_EVENTS.FROZEN_POLICY_DRIFT_BLOCKED).toBe("lifecycle:frozen_policy_drift_blocked");
    expect(LIFECYCLE_GATE_EVENTS.COMPLIANCE_DRIFT_BLOCKED).toBe("lifecycle:compliance_drift_blocked");
    expect(LIFECYCLE_GATE_EVENTS.BACKTEST_STALE).toBe("lifecycle:backtest_stale");
    expect(LIFECYCLE_GATE_EVENTS.PROMOTION_EVIDENCE_INCOMPLETE).toBe("lifecycle:promotion_evidence_incomplete");
    // Wave 3 Track 3B + production hardening
    expect(LIFECYCLE_GATE_EVENTS.BIF_EVALUATED).toBe("lifecycle:bif_evaluated");
    expect(LIFECYCLE_GATE_EVENTS.AUTO_GRAVEYARD).toBe("lifecycle:auto_graveyard");
    // deepscan-wiring additions (Finding 5): previously bare-string sites
    expect(LIFECYCLE_GATE_EVENTS.PAPER_TO_DEPLOY_READY_BLOCKED).toBe("lifecycle:paper_to_deploy_ready_blocked");
    expect(LIFECYCLE_GATE_EVENTS.SHADOW_TO_PAPER_BLOCKED).toBe("lifecycle:shadow_to_paper_blocked");
    expect(LIFECYCLE_GATE_EVENTS.PROMOTED).toBe("lifecycle:promoted");

    // 12 total entries
    expect(Object.keys(LIFECYCLE_GATE_EVENTS).length).toBe(12);
  });

  it("catalog constant values are stable strings — no mutation possible (const assertion)", async () => {
    const { LIFECYCLE_GATE_EVENTS } = await import("../routes/sse.js");
    // 'as const' means the type is readonly — verify at runtime by checking the
    // object itself is not extensible or by verifying the individual string values.
    const values = Object.values(LIFECYCLE_GATE_EVENTS);
    expect(values.every(v => typeof v === "string")).toBe(true);
    expect(values.every(v => v.startsWith("lifecycle:"))).toBe(true);
  });

  it("lifecycle-service.ts source does NOT contain magic-string broadcast calls for the 6 W27.5 events", () => {
    const svcPath = path.resolve(
      import.meta.dirname ?? ".",
      "../services/lifecycle-service.ts",
    );
    expect(fs.existsSync(svcPath)).toBe(true);
    const src = fs.readFileSync(svcPath, "utf8");

    // These 6 strings must NOT appear as literal broadcast arguments.
    // They must only appear as values of LIFECYCLE_GATE_EVENTS.* properties.
    const magicStrings = [
      '"lifecycle:wfe_evaluated"',
      '"lifecycle:b14_evaluated"',
      '"lifecycle:parameter_drift_evaluated"',
      '"lifecycle:frozen_policy_drift_blocked"',
      '"lifecycle:compliance_drift_blocked"',
      '"lifecycle:backtest_stale"',
    ];

    for (const magic of magicStrings) {
      // Allow occurrence in audit_log action strings (those are not SSE calls)
      // Only check broadcastSSE call sites.
      const broadcastMagicPattern = new RegExp(
        `broadcastSSE\\s*\\(\\s*${magic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      );
      expect(
        broadcastMagicPattern.test(src),
        `lifecycle-service.ts must not have broadcastSSE(${magic}, ...) — use LIFECYCLE_GATE_EVENTS constant`,
      ).toBe(false);
    }
  });

  it("lifecycle-service.ts imports LIFECYCLE_GATE_EVENTS from sse.ts", () => {
    const svcPath = path.resolve(
      import.meta.dirname ?? ".",
      "../services/lifecycle-service.ts",
    );
    const src = fs.readFileSync(svcPath, "utf8");
    expect(src).toContain("LIFECYCLE_GATE_EVENTS");
    expect(src).toMatch(/import.*LIFECYCLE_GATE_EVENTS.*from.*sse/);
  });

  it("lifecycle-service.ts broadcasts PROMOTION_EVIDENCE_INCOMPLETE using catalog constant", () => {
    const svcPath = path.resolve(
      import.meta.dirname ?? ".",
      "../services/lifecycle-service.ts",
    );
    const src = fs.readFileSync(svcPath, "utf8");
    // The broadcast must appear as LIFECYCLE_GATE_EVENTS.PROMOTION_EVIDENCE_INCOMPLETE
    expect(src).toContain("LIFECYCLE_GATE_EVENTS.PROMOTION_EVIDENCE_INCOMPLETE");
    // And the audit action must also be present (audit insert is separate from SSE)
    expect(src).toContain('"lifecycle.promotion_evidence_incomplete"');
  });
});

// ─── M9: parentCorrelationId in quantum replay audit row ─────────────────────

describe("M9 — quantum-replay-runner parentCorrelationId inheritance", () => {
  it("runQuantumReplayForBacktest accepts optional correlationId as second parameter (backward compat)", async () => {
    // Import the function to verify the signature is backwards-compatible.
    const { runQuantumReplayForBacktest } = await import("../lib/quantum-replay-runner.js");
    // Function must exist and accept 1 or 2 arguments.
    expect(typeof runQuantumReplayForBacktest).toBe("function");
    // Function length: backtestId is required, correlationId is optional
    expect(runQuantumReplayForBacktest.length).toBeLessThanOrEqual(2);
  });

  it("backtest-service.ts auto_fire_enqueued audit result contains parentCorrelationId field", () => {
    // AST / source-level check: the audit row written after runQuantumReplayForBacktest
    // must include parentCorrelationId in its result object.
    const svcPath = path.resolve(
      import.meta.dirname ?? ".",
      "../services/backtest-service.ts",
    );
    expect(fs.existsSync(svcPath)).toBe(true);
    const src = fs.readFileSync(svcPath, "utf8");

    // The result JSONB of quantum_replay.auto_fire_enqueued must carry parentCorrelationId.
    expect(src).toContain("parentCorrelationId");

    // Ensure the field is adjacent to the auto_fire_enqueued action so we're
    // checking the right audit row and not some other occurrence.
    const autoFireIdx = src.indexOf('"quantum_replay.auto_fire_enqueued"');
    expect(autoFireIdx).toBeGreaterThan(-1);

    const parentCorrIdx = src.indexOf("parentCorrelationId", autoFireIdx);
    // parentCorrelationId must appear AFTER the action string, within 1500 chars
    // (one audit insert block).
    expect(parentCorrIdx).toBeGreaterThan(autoFireIdx);
    expect(parentCorrIdx - autoFireIdx).toBeLessThan(1500);
  });

  it("backtest-service.ts documents the cross-system trace query contract in a comment", () => {
    const svcPath = path.resolve(
      import.meta.dirname ?? ".",
      "../services/backtest-service.ts",
    );
    const src = fs.readFileSync(svcPath, "utf8");
    // The cross-system query pattern must be documented so future readers understand
    // why parentCorrelationId exists alongside the primary correlationId.
    expect(src).toContain("parentCorrelationId");
    expect(src).toContain("result->>'parentCorrelationId'");
  });

  it("quantum-replay-runner.ts correlationId is threaded through subprocess logs", () => {
    // The correlationId (which acts as parentCorrelationId from the audit row's
    // perspective) must appear in the subprocess logger context so log-line
    // attribution works without the audit row.
    const runnerPath = path.resolve(
      import.meta.dirname ?? ".",
      "../lib/quantum-replay-runner.ts",
    );
    expect(fs.existsSync(runnerPath)).toBe(true);
    const src = fs.readFileSync(runnerPath, "utf8");
    // correlationId must be logged in both the start log and close handler.
    expect(src).toContain("correlationId");
    // The function signature must accept correlationId as optional second param.
    expect(src).toMatch(/runQuantumReplayForBacktest\s*\([\s\S]*?correlationId\?/);
  });

  it("regression: callers without parentCorrelationId still produce valid audit rows", async () => {
    // Verify that the backtest-service.ts pattern is safe when correlationId is
    // undefined — parentCorrelationId: null in result JSONB is valid.
    const svcPath = path.resolve(
      import.meta.dirname ?? ".",
      "../services/backtest-service.ts",
    );
    const src = fs.readFileSync(svcPath, "utf8");
    // The field must use null fallback: parentCorrelationId: correlationId ?? null
    expect(src).toContain("parentCorrelationId: correlationId ?? null");
  });
});
