/**
 * contract-specs-micro-mini-gating.test.ts — deep-scan #22 Track D, fix D6.
 *
 * Bug context:
 *   contract-specs-service.ts CONTRACT_SPECS_HARDCODED held FULL-SIZE MINI point
 *   values for ES/NQ (50/20) while config.py + firm-config.ts alias ES/NQ/CL → MICRO.
 *   A literal ES/NQ/CL symbol reaching a P&L path through getContractSpec() would
 *   silently pull 10× point values — a latent risk-inflation landmine.
 *
 * Fix (D6):
 *   ES/NQ/CL resolve to MICRO point values by default. Full-size mini specs are
 *   reachable ONLY via getContractSpec(sym, "mini") while TF_PHASE_5_ENABLED=true,
 *   matching config.py::resolve_contract_spec / firm-config.ts::resolveContractSpec.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((...a: string[]) => a.join(" | ")),
}));
vi.mock("../services/notification-service.js", () => ({ notifyWarning: vi.fn(), notifyCritical: vi.fn(), notifyInfo: vi.fn() }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));

// DB read returns no row → hardcoded fallback path exercised.
vi.mock("../db/index.js", () => {
  const noRow = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  return { db: { select: vi.fn(() => noRow) } };
});

const { getContractSpec } = await import("../services/contract-specs-service.js");

describe("D6 — ES/NQ/CL resolve to MICRO point values by default", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getContractSpec('ES') returns MICRO point value (5), not the mini 50", async () => {
    const spec = await getContractSpec("ES");
    expect(spec.pointValue).toBe(5);
    expect(spec.multiplier).toBe(5);
  });

  it("getContractSpec('NQ') returns MICRO point value (2), not the mini 20", async () => {
    const spec = await getContractSpec("NQ");
    expect(spec.pointValue).toBe(2);
  });

  it("getContractSpec('CL') returns MICRO point value (100), not the mini 1000", async () => {
    const spec = await getContractSpec("CL");
    expect(spec.pointValue).toBe(100);
  });

  it("explicit contractClass='micro' also yields micro values", async () => {
    expect((await getContractSpec("ES", "micro")).pointValue).toBe(5);
  });

  it("the true micro symbols (MES/MNQ/MCL) are unchanged", async () => {
    expect((await getContractSpec("MES")).pointValue).toBe(5);
    expect((await getContractSpec("MNQ")).pointValue).toBe(2);
    expect((await getContractSpec("MCL")).pointValue).toBe(100);
  });

  it("contractClass='mini' is REFUSED (fail-closed) while TF_PHASE_5_ENABLED=false", async () => {
    await expect(getContractSpec("ES", "mini")).rejects.toThrow(/TF_PHASE_5_ENABLED=false/);
  });
});

describe("D6 — mini point values reachable ONLY when Phase-5 explicitly declared + enabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getContractSpec('ES','mini') returns the full-size 50 when TF_PHASE_5_ENABLED=true", async () => {
    vi.stubEnv("TF_PHASE_5_ENABLED", "true");
    vi.resetModules();
    const { getContractSpec: gcs } = await import("../services/contract-specs-service.js");
    const spec = await gcs("ES", "mini");
    expect(spec.pointValue).toBe(50);
    // ...and the DEFAULT path is STILL micro even with Phase 5 on (no explicit class).
    expect((await gcs("ES")).pointValue).toBe(5);
  });
});
