/**
 * Tests for runComplianceGateForFirms (P0-2 part 2).
 *
 * Verifies the helper:
 *   - returns no failures when all firms have fresh, non-drift rulesets
 *   - flags firms with stale rulesets (compliance_gate.check_freshness fresh=false)
 *   - flags firms with drift (drift_detected=true causes Python to fail closed)
 *   - flags firms with no ruleset row at all (fail-closed at the helper layer)
 *   - fails closed when the Python subprocess throws (subprocess_error)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock python-runner so we control the compliance_gate.check_freshness output ───
vi.mock("../lib/python-runner.js", () => {
  const runPythonModule = vi.fn();
  return { runPythonModule };
});

// ─── Mock DB so we control which firms have rulesets ─────────────────
// We model: db.select(...).from(...).where(...).orderBy(...).limit(1) → []
// per firm; tests override the awaited result via `mockRulesetByFirm`.
const mockRulesetByFirm = new Map<
  string,
  {
    firm: string;
    parsedRules: Record<string, unknown>;
    retrievedAt: Date;
    driftDetected: boolean;
    contentHash: string | null;
    status: string;
  }
>();

vi.mock("../db/index.js", () => {
  const buildChain = (firmFilter?: string) => {
    const result = firmFilter ? mockRulesetByFirm.get(firmFilter) : undefined;
    const chain: any = {
      select: () => chain,
      from: () => chain,
      where: (_eqExpr: any) => {
        // We don't introspect the eq call here; instead the test seeds
        // mockRulesetByFirm by firm key and the wrapper passes the firm.
        return chain;
      },
      orderBy: () => chain,
      limit: () => Promise.resolve(result ? [result] : []),
    };
    return chain;
  };
  return {
    db: {
      select: () => {
        // Return a chain that, when awaited at .limit(1), reads from the map.
        // We need to know which firm is being looked up: the test passes one
        // firm at a time so we can grab it from a per-call context. To keep
        // the mock simple, we use a "current firm" cursor which the test
        // sets before each helper call.
        return buildChain((globalThis as any).__currentFirm__);
      },
    },
  };
});

vi.mock("../db/schema.js", () => ({
  complianceRulesets: {
    firm: "firm",
    parsedRules: "parsedRules",
    retrievedAt: "retrievedAt",
    driftDetected: "driftDetected",
    contentHash: "contentHash",
    status: "status",
  },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./evolution-service.js", () => ({ evolveStrategy: vi.fn() }));
vi.mock("./alert-service.js", () => ({
  AlertFactory: { decayAlert: vi.fn().mockResolvedValue(undefined), deployReady: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("./pine-export-service.js", () => ({
  compileDualPineExport: vi.fn(),
  compilePineExport: vi.fn(),
}));
vi.mock("./agent-coordinator-service.js", () => ({
  agentCoordinator: { emit: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: () => ({ setAttribute: vi.fn(), end: vi.fn() }),
  },
}));
vi.mock("../lib/metrics-registry.js", () => ({
  strategyPromotions: { labels: () => ({ inc: vi.fn() }) },
}));

const pythonRunner = await import("../lib/python-runner.js");
const { runComplianceGateForFirms } = await import("./lifecycle-service.js");

// ─── Test helper ────────────────────────────────────────────────────

function setRulesetForFirm(firm: string, opts: { driftDetected?: boolean; status?: string; ageHours?: number } = {}) {
  const ageMs = (opts.ageHours ?? 1) * 3600 * 1000;
  mockRulesetByFirm.set(firm, {
    firm,
    parsedRules: {},
    retrievedAt: new Date(Date.now() - ageMs),
    driftDetected: !!opts.driftDetected,
    contentHash: "hash",
    status: opts.status ?? "verified",
  });
}

async function callForOneFirm(firm: string) {
  // Set the current-firm cursor so the DB mock returns the right row.
  (globalThis as any).__currentFirm__ = firm;
  return await runComplianceGateForFirms([firm]);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("runComplianceGateForFirms (P0-2 part 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRulesetByFirm.clear();
    (pythonRunner.runPythonModule as any).mockReset();
  });

  it("returns no failures when ruleset is fresh and Python says fresh=true", async () => {
    setRulesetForFirm("Topstep", { ageHours: 1 });
    (pythonRunner.runPythonModule as any).mockResolvedValueOnce({
      fresh: true,
      status: "verified",
      message: "Topstep: ruleset verified",
      drift_detected: false,
    });

    const { firmsFailing, details } = await callForOneFirm("Topstep");

    expect(firmsFailing).toEqual([]);
    expect(details["Topstep"].fresh).toBe(true);
    expect(details["Topstep"].status).toBe("verified");
  });

  it("flags firm when Python returns fresh=false (stale ruleset)", async () => {
    setRulesetForFirm("MFFU", { ageHours: 30 });
    (pythonRunner.runPythonModule as any).mockResolvedValueOnce({
      fresh: false,
      status: "stale",
      message: "MFFU: ruleset STALE",
      drift_detected: false,
    });

    const { firmsFailing, details } = await callForOneFirm("MFFU");

    expect(firmsFailing).toEqual(["MFFU"]);
    expect(details["MFFU"].fresh).toBe(false);
    expect(details["MFFU"].status).toBe("stale");
  });

  it("flags firm when ruleset has drift_detected=true (Python returns blocked_drift)", async () => {
    setRulesetForFirm("Apex", { driftDetected: true, ageHours: 1 });
    (pythonRunner.runPythonModule as any).mockResolvedValueOnce({
      fresh: false,
      status: "blocked_drift",
      message: "Apex: drift detected",
      drift_detected: true,
    });

    const { firmsFailing, details } = await callForOneFirm("Apex");

    expect(firmsFailing).toEqual(["Apex"]);
    expect(details["Apex"].fresh).toBe(false);
    expect(details["Apex"].status).toBe("blocked_drift");
  });

  it("flags firm when no ruleset row exists (fail-closed at helper layer)", async () => {
    // Do NOT set the ruleset — DB mock returns []
    const { firmsFailing, details } = await callForOneFirm("UnknownFirm");

    expect(firmsFailing).toEqual(["UnknownFirm"]);
    expect(details["UnknownFirm"].status).toBe("no_ruleset");
    // Python should not have been called when the row is missing
    expect((pythonRunner.runPythonModule as any).mock.calls.length).toBe(0);
  });

  it("fails closed when Python subprocess throws", async () => {
    setRulesetForFirm("Tradeify", { ageHours: 1 });
    (pythonRunner.runPythonModule as any).mockRejectedValueOnce(new Error("subprocess died"));

    const { firmsFailing, details } = await callForOneFirm("Tradeify");

    expect(firmsFailing).toEqual(["Tradeify"]);
    expect(details["Tradeify"].fresh).toBe(false);
    expect(details["Tradeify"].status).toBe("subprocess_error");
    expect(details["Tradeify"].message).toContain("subprocess died");
  });

  it("returns empty arrays for empty firmNames input", async () => {
    const { firmsFailing, details } = await runComplianceGateForFirms([]);
    expect(firmsFailing).toEqual([]);
    expect(details).toEqual({});
    expect((pythonRunner.runPythonModule as any).mock.calls.length).toBe(0);
  });
});
