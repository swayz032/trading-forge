/**
 * deepscan7-c1-c2-money-path-correlation.test.ts — Deep-scan #7 Track C (2026-07-02)
 *
 * C1 (HIGH obs-H1): the five audit rows inside the paper-signal-service
 *     cross-symbol DLL gate + daily-trade-cap gate must thread the in-scope
 *     correlationId (self-generated at evaluateSignals entry — never null at
 *     runtime). Previously all five omitted it while the sibling fail-closed
 *     error row threaded it correctly.
 *
 * C2 (HIGH obs-H3): the SME exit-context resolver hard-set
 *     `correlationId: null`. paper_positions persists the entry-time
 *     correlation_id (BL-9, migration 0180) — the resolver must thread it from
 *     the position row, falling back to a fresh UUID for legacy pre-0180 rows
 *     (never null).
 *
 * Source-code analysis is the established pattern for these two services
 * (see paper-signal-service-deepscan-findings.test.ts F1/F2 and
 * paper-execution-service-deepscan-findings.test.ts F4/F5/F7):
 * evaluateSignals() / the exit chain have too many gateway dependencies for
 * isolated behavioral tests, and the structural assertions verify the exact
 * threading contract. The C2 fallback contract additionally gets a behavioral
 * mirror test pinned to the exact source expression.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIGNAL_SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);
const EXEC_SRC = readFileSync(
  resolve(__dirname, "../services/paper-execution-service.ts"),
  "utf-8",
);

// ─── C1: five DLL-gate / trade-cap audit rows thread correlationId ────────────

const DLL_GATE_AUDIT_ACTIONS = [
  "cross_symbol_force_close_triggered",
  "cross_symbol_force_close_failed",
  "cross_symbol_dll_halt_triggered",
  "sizing.dll_reduce_size_band_entered",
  "consistency.daily_trade_cap_blocked",
] as const;

/**
 * Extracts the insertAuditRow object-literal window for a given action:
 * from `action: "<name>",` to the terminating `}).catch`.
 */
function auditRowWindow(src: string, action: string): string {
  const anchor = `action: "${action}",`;
  const start = src.indexOf(anchor);
  expect(start, `expected exactly one insertAuditRow anchor for ${action}`).toBeGreaterThan(-1);
  // The action must appear exactly once as an audit-row anchor
  expect(src.indexOf(anchor, start + 1)).toBe(-1);
  const end = src.indexOf("}).catch", start);
  expect(end, `expected }).catch terminator after ${action}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("C1 — DLL-gate audit rows receive non-null correlation_id", () => {
  for (const action of DLL_GATE_AUDIT_ACTIONS) {
    it(`${action} audit row threads the in-scope correlationId`, () => {
      const window = auditRowWindow(SIGNAL_SRC, action);
      expect(window).toContain("correlationId: correlationId ?? null");
    });
  }

  it("evaluateSignals self-generates correlationId — the threaded value is never null at runtime", () => {
    // MED-2 (2026-06-29): every bar cycle resolves a real UUID before the gates run,
    // so `correlationId ?? null` in the five rows above always resolves to a string.
    expect(SIGNAL_SRC).toContain(
      "const correlationId = context?.correlationId ?? randomUUID();",
    );
  });

  it("the fail-closed error row (mirrored pattern) still threads correlationId", () => {
    const window = auditRowWindow(SIGNAL_SRC, "consistency.cross_symbol_dll_failclosed");
    expect(window).toContain("correlationId: correlationId ?? null");
  });
});

// ─── C2: SME exit context threads entry correlationId from the position row ──

describe("C2 — SME exit context resolves entry correlationId (BL-9), never null", () => {
  it("_resolveSmeContextForExit signature accepts entryCorrelationId", () => {
    const fnIdx = EXEC_SRC.indexOf("async function _resolveSmeContextForExit(");
    expect(fnIdx).toBeGreaterThan(-1);
    const sig = EXEC_SRC.slice(fnIdx, fnIdx + 900);
    expect(sig).toContain("entryCorrelationId?: string | null");
  });

  it("returns entryCorrelationId ?? randomUUID() — legacy pre-0180 rows get a fresh UUID", () => {
    expect(EXEC_SRC).toContain("correlationId: entryCorrelationId ?? randomUUID()");
  });

  it("the old hard-null assignment is gone", () => {
    expect(EXEC_SRC).not.toContain(
      "correlationId: null, // exit decisions don't carry a correlationId from signal chain",
    );
  });

  it("all SME exit call sites pass pos.correlationId (no remaining 2-arg calls)", () => {
    const threeArg =
      EXEC_SRC.split("_resolveSmeContextForExit(pos.sessionId, pos.id, pos.correlationId)").length - 1;
    const twoArg =
      EXEC_SRC.split("_resolveSmeContextForExit(pos.sessionId, pos.id)").length - 1;
    expect(threeArg).toBeGreaterThanOrEqual(7);
    expect(twoArg).toBe(0);
  });

  it("entry side persists correlationId onto paper_positions (BL-9) so the exit read is recoverable", () => {
    // openPosition INSERT carries the entry correlationId (migration 0180 column)
    const insertIdx = EXEC_SRC.indexOf(".insert(paperPositions).values({");
    expect(insertIdx).toBeGreaterThan(-1);
    const insertWindow = EXEC_SRC.slice(insertIdx, EXEC_SRC.indexOf(".returning()", insertIdx));
    expect(insertWindow).toContain("correlationId,");
  });

  // Behavioral mirror of the exact source expression asserted above
  // (`entryCorrelationId ?? randomUUID()`): documents the open→exit thread and
  // the legacy-null fallback contract without importing the 4000-line module.
  const resolveExitCorrelationId = (entryCorrelationId?: string | null): string =>
    entryCorrelationId ?? randomUUID();

  it("behavioral: open→exit thread — entry correlationId is passed through verbatim", () => {
    const entryId = randomUUID();
    expect(resolveExitCorrelationId(entryId)).toBe(entryId);
  });

  it("behavioral: legacy position (null correlationId) falls back to a fresh UUID, never null", () => {
    const resolvedFromNull = resolveExitCorrelationId(null);
    const resolvedFromUndefined = resolveExitCorrelationId(undefined);
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(resolvedFromNull).toMatch(uuidRe);
    expect(resolvedFromUndefined).toMatch(uuidRe);
    // Fresh per call — not a shared sentinel
    expect(resolveExitCorrelationId(null)).not.toBe(resolvedFromNull);
  });
});
