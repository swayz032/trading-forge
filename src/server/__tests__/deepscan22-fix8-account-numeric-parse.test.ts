/**
 * deepscan22-fix8-account-numeric-parse.test.ts — deep-scan #22 fix #8 (MED).
 *
 * `parseFloat(x) || 50_000` at 4 sizing call sites (paper-signal-service.ts:2662,3390,
 * 5220,5221 pre-fix) turned a legitimate `"0"` account balance / starting-capital string
 * into a phantom $50K default, because `0` is falsy in JS — `parseFloat("0") || 50_000`
 * evaluates to `50_000`, not `0`. That phantom balance then flowed into
 * computeRiskDerivedContracts() and the DLL gate, sizing/gating a drained or
 * not-yet-funded session as if it had $50K.
 *
 * Fix: parseAccountNumericOrDefault() only falls back to the default on NaN/null/undefined
 * (a genuinely missing or malformed numeric column) — a real 0 survives unchanged.
 *
 * Note: paper-signal-service.ts imports DB — mocked here so the pure helper can be
 * tested without a real Postgres connection (same mock set as trail-stop-extensions.test.ts).
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mocks (must come before service import) ─────────────────────────────────
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../db/index.js", () => ({
  db: {
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    transaction: vi.fn((cb: any) => cb({ execute: vi.fn(), select: vi.fn(), insert: vi.fn() })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  },
}));
vi.mock("../db/schema.js", () => ({
  paperSessions: {},
  paperPositions: {},
  strategies: {},
  paperSignalLogs: {},
  skipDecisions: {},
  shadowSignals: {},
  paperTrades: {},
  paperSessionFeedback: {},
  complianceRulesets: {},
  complianceReviews: {},
  complianceDriftLog: {},
}));
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));
vi.mock("../services/paper-execution-service.js", () => ({
  openPosition: vi.fn(),
  closePosition: vi.fn(),
}));
vi.mock("../services/paper-risk-gate.js", () => ({
  checkRiskGate: vi.fn(),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/telemetry.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })) },
}));
vi.mock("../services/skip-engine-service.js", () => ({
  evaluateSkipDecision: vi.fn(),
}));
vi.mock("../services/anti-setup-gate-service.js", () => ({
  checkAntiSetupGate: vi.fn(),
}));
vi.mock("../services/context-gate-service.js", () => ({
  evaluateContextGate: vi.fn(),
}));
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startActiveSpan: vi.fn((_n: string, _o: unknown, fn: (s: unknown) => unknown) => fn({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })), startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })) },
}));
vi.mock("../services/dsl-translator.js", () => ({
  isDSLStrategy: vi.fn(() => false),
  translateDSLToPaperConfig: vi.fn(),
}));
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(() => true),
}));
vi.mock("../lib/dst-utils.js", () => ({
  isUsDst: vi.fn(() => false),
}));
vi.mock("../../shared/firm-config.js", () => ({
  CONTRACT_SPECS: {},
  CONTRACT_CAP_MIN: 1,
  CONTRACT_CAP_MAX: 20,
}));

import { parseAccountNumericOrDefault } from "../services/paper-signal-service.js";

describe("deep-scan #22 fix #8 — parseAccountNumericOrDefault preserves a legitimate 0", () => {
  it('"0" string balance parses to 0, NOT the 50_000 default (the core regression)', () => {
    expect(parseAccountNumericOrDefault("0", 50_000)).toBe(0);
  });

  it("numeric 0 (already-parsed) also survives as 0", () => {
    expect(parseAccountNumericOrDefault(0, 50_000)).toBe(0);
  });

  it("undefined falls back to the default", () => {
    expect(parseAccountNumericOrDefault(undefined, 50_000)).toBe(50_000);
  });

  it("null falls back to the default", () => {
    expect(parseAccountNumericOrDefault(null, 50_000)).toBe(50_000);
  });

  it("a malformed / non-numeric string (NaN) falls back to the default", () => {
    expect(parseAccountNumericOrDefault("not-a-number", 50_000)).toBe(50_000);
  });

  it("a genuine positive balance parses through unchanged", () => {
    expect(parseAccountNumericOrDefault("48250.75", 50_000)).toBeCloseTo(48250.75);
  });

  it("empty string (Postgres numeric columns never emit this, but defensively) falls back to default", () => {
    expect(parseAccountNumericOrDefault("", 50_000)).toBe(50_000);
  });
});
