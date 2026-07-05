/**
 * deepscan18-rl-cpcv-audit-bridge.test.ts
 *
 * Deep-Scan #18 (2026-07-05) — RL CPCV audit bridge.
 *
 * db_loader.py::load_backtest_bar_data (RL-training-only) emits an
 * `AUDIT_EVENT_JSON {json}` stderr sentinel when it purges OOS bars or hits a
 * malformed fold. quantum-rl-training-runner.ts::_writeStderrAuditEvents parses
 * those sentinels from the child's stderr and writes the documented
 * `quantum_rl.training_cpcv_purge_violation` audit row (the subprocess cannot
 * write audit_log directly). Closes the Band-H gap: the audit action was
 * documented but never actually fired.
 *
 * Authority boundary: no lifecycle / paper-signal / order-routing import.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// spy on db.insert(...).values(...) — vi.hoisted so the vi.mock factory (hoisted to
// top of module) can reference these without a TDZ ReferenceError.
const { insertSpy, insertValues } = vi.hoisted(() => {
  const insertValues = vi.fn((_values: any) => Promise.resolve());
  const insertSpy = vi.fn(() => ({ values: insertValues }));
  return { insertSpy, insertValues };
});

vi.mock("../db/index.js", () => ({
  db: {
    insert: insertSpy,
    // circuit-breaker init path (unused here, but the module imports it) — harmless no-op
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
  },
}));

// avoid the module-load mkdirSync side effect
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), mkdirSync: vi.fn() }));
vi.mock("child_process", () => ({ spawn: vi.fn(), execSync: vi.fn() }));

import { _writeStderrAuditEvents } from "../lib/quantum-rl-training-runner.js";

describe("Deep-Scan #18 — RL CPCV audit bridge (_writeStderrAuditEvents)", () => {
  beforeEach(() => {
    insertSpy.mockClear();
    insertValues.mockClear();
  });

  it("parses an AUDIT_EVENT_JSON sentinel and writes the documented audit row", () => {
    const stderr = [
      "[db_loader] some pino warn line",
      'AUDIT_EVENT_JSON {"event":"quantum_rl.training_cpcv_purge_violation","status":"warning","backtest_id":42,"purged_bar_count":3,"bars_retained":10,"malformed_fold_count":0}',
      "another non-sentinel line",
    ].join("\n");

    const n = _writeStderrAuditEvents(stderr, "strat-1", "corr-abc");

    expect(n).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const arg = insertValues.mock.calls[0][0];
    expect(arg.action).toBe("quantum_rl.training_cpcv_purge_violation");
    expect(arg.status).toBe("warning");
    expect(arg.entityType).toBe("strategy");
    expect(arg.entityId).toBe("strat-1");
    expect(arg.correlationId).toBe("corr-abc");
    // event/status are stripped from the result payload (they map to action/status columns)
    expect(arg.result.event).toBeUndefined();
    expect(arg.result.status).toBeUndefined();
    expect(arg.result.purged_bar_count).toBe(3);
    expect(arg.result.bars_retained).toBe(10);
    expect(arg.result.backtest_id).toBe(42);
  });

  it("defaults status to info and null correlationId when absent", () => {
    const stderr = 'AUDIT_EVENT_JSON {"event":"quantum_rl.training_cpcv_purge_violation","purged_bar_count":1}';
    const n = _writeStderrAuditEvents(stderr, 7);
    expect(n).toBe(1);
    const arg = insertValues.mock.calls[0][0];
    expect(arg.status).toBe("info");
    expect(arg.correlationId).toBeNull();
    expect(arg.entityId).toBe("7");
  });

  it("ignores non-sentinel lines, malformed JSON, and event-less payloads", () => {
    const stderr = [
      "AUDIT_EVENT_JSON not-valid-json",
      "regular log line without sentinel",
      'AUDIT_EVENT_JSON {"no_event_field":true}',
      "AUDIT_EVENT_JSONno-space-prefix",
    ].join("\n");
    const n = _writeStderrAuditEvents(stderr, 9);
    expect(n).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("caps at 50 audit events per run (flood guard)", () => {
    const line =
      'AUDIT_EVENT_JSON {"event":"quantum_rl.training_cpcv_purge_violation","purged_bar_count":1}';
    const stderr = Array.from({ length: 60 }, () => line).join("\n");
    const n = _writeStderrAuditEvents(stderr, 11);
    expect(n).toBe(50);
    expect(insertSpy).toHaveBeenCalledTimes(50);
  });

  it("returns 0 for empty stderr", () => {
    expect(_writeStderrAuditEvents("", 1)).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
