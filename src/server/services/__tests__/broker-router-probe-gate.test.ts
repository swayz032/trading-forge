/**
 * broker-router-probe-gate.test.ts — R-359 (2026-07-28)
 *
 * The boot-time TradersPost credential probe used to POST a real API key to the
 * LIVE broker endpoint through no gate at all — no flag, no kill switch, no
 * pipeline check — scheduled from module scope, so merely IMPORTING this module
 * (a test, a script, a migration runner, a REPL) fired it. It was harmless only
 * because no credential resolved on the tower: safety by starvation, not design.
 *
 * RED-PROOF CONTRACT: remove any single clause of checkProbeGate() and the
 * matching test below goes RED. The discrimination test (#2) is what makes the
 * rest non-vacuous — it proves the gate CAN open, so the "did not fire" cases
 * are real refusals rather than a probe that never runs under any conditions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Mock factories (mirrors broker-router-non-success-discord.test.ts) ───────

const { mockIsHalted, mockIsPipelineActive, mockIsLiveConfigured, mockLoadCreds } = vi.hoisted(() => ({
  mockIsHalted: vi.fn(),
  mockIsPipelineActive: vi.fn(),
  mockIsLiveConfigured: vi.fn(),
  mockLoadCreds: vi.fn(),
}));

// Probe reads: db.select({...}).from(x).where(y) -> rows (no .limit()).
// Other call sites use .limit(), so expose both shapes off the same object.
const { mockSelect } = vi.hoisted(() => {
  const rows = [{ accountId: "acct-1", enabled: true }];
  const terminal = Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
  return { mockSelect: vi.fn(() => ({ from: () => ({ where: () => terminal }) })) };
});

vi.mock("../../db/index.js", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: "audit-1" }]) }),
  },
}));
vi.mock("../../db/schema.js", () => ({
  brokerAccounts: {}, auditLog: {}, productionTrades: {}, strategies: {}, complianceRulesets: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  desc: vi.fn((col: unknown) => col),
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../../services/pipeline-control-service.js", () => ({ isActive: mockIsPipelineActive }));
vi.mock("../../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: mockIsHalted },
}));
vi.mock("../../lib/execution-mode.js", () => ({ isLiveExecutionConfigured: mockIsLiveConfigured }));
vi.mock("../../lib/credential-loader.js", () => ({ loadBrokerCredentials: mockLoadCreds }));
vi.mock("../../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn(),
  buildDeterministicIdempotencyKey: vi.fn(() => "k"),
}));
vi.mock("../../integrations/traderspost/webhook-builder.js", () => ({ buildWebhookPayload: vi.fn() }));
vi.mock("../../services/notification-service.js", () => ({
  notifyCritical: vi.fn(), notifyWarning: vi.fn(), notify: vi.fn(), flushNotifications: vi.fn(),
}));
vi.mock("../../services/strategy-assignment-service.js", () => ({
  getEnabledFirms: vi.fn().mockResolvedValue(["mffu"]),
}));
vi.mock("../../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn().mockReturnValue({ maxContracts: 50 }),
  CONTRACT_CAP_MAX: 60, getFirmAccount: vi.fn().mockReturnValue(null),
  CONTRACT_SPECS: {}, DEFAULT_ACCOUNT_SIZE: 50_000,
}));
vi.mock("../../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ violation: false, violations: [] }),
}));
vi.mock("../../lib/metrics-registry.js", () => ({
  traderspostRejectsTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** All gates open — the state in which the probe SHOULD run. */
function allGatesOpen(): void {
  process.env.BROKER_KEY_PROBE_ENABLED = "true";
  mockIsLiveConfigured.mockReturnValue(true);
  mockIsHalted.mockResolvedValue(false);
  mockIsPipelineActive.mockResolvedValue(true);
  mockLoadCreds.mockResolvedValue({ apiKey: "test-key" });
}

async function runProbe(): Promise<void> {
  const mod = await import("../broker-router.js");
  await mod.probeTradersPostApiKeys();
}

/**
 * R-367: the inertness fix (R-365) traded an un-deletable module-scope side
 * effect for a SINGLE call site in index.ts. That is the right trade, but it
 * introduces a failure the old design could not have: delete, comment out or
 * reorder that one line and the probe silently never runs, with nothing red
 * anywhere. A diagnostic's ABSENCE is invisible by construction — the alert it
 * fails to raise is the only thing that would have reported it missing.
 *
 * Static source guard, same shape as broker-router.test.ts's F-2 scoping guard
 * (which caught a real regression 18 minutes after it was written). Severity of
 * the thing it protects is LOW — this is a key-revocation detector, not a safety
 * gate — but the guard is nearly free.
 *
 * RED-PROOF (both mutations, R-368): delete the `startBootProbe();` call → RED;
 * COMMENT IT OUT → RED. The second is the one that matters — nobody deletes a
 * boot call, they comment it out while debugging a slow boot and mean to put it
 * back. The first version of this guard matched commented text and stayed green.
 *
 * ★ BOUND, stated because the name used to over-claim: THIS GUARD PROVES
 * TEXTUAL PRESENCE, NOT EXECUTION. A call relocated into a dead branch, an
 * early-return path or an `if (false)` block still satisfies it. Proving the
 * probe actually runs needs a boot harness, which is disproportionate for a
 * LOW-severity key-revocation diagnostic.
 */
describe("boot probe is actually started (R-367 static guard)", () => {
  const indexSrc = readFileSync(resolve(import.meta.dirname, "../../index.ts"), "utf8");

  it("index.ts contains exactly one non-commented startBootProbe() call site", () => {
    // BOUND (R-369 §3), stated for the next engineer rather than left to be
    // discovered: this predicate requires the call to be a BARE STATEMENT ON ITS
    // OWN LINE. `if (someCondition) startBootProbe();` therefore goes RED — and
    // that is DELIBERATE, not an oversight. A conditionally-invoked boot probe is
    // a probe that runs "sometimes", invisibly, which is the exact family of
    // defect this whole guard exists to remove. If you legitimately need to
    // condition it, change the GATE (checkProbeGate) — not the call site, and
    // not this guard.
    //
    // Line-SHAPE assertion, not comment-stripping. A first attempt stripped
    // comments with /\/\*[\s\S]*?\*\//g and broke on the real file: an unpaired
    // `/*` inside a string or glob swallows everything up to the next `*/`,
    // including real code. Requiring the statement to START its line needs no
    // stripping — `// startBootProbe();` and `/* startBootProbe(); */` both fail
    // to match because the line begins with the comment token, not the call.
    const callLines = indexSrc
      .split("\n")
      .filter((line) => /^\s*startBootProbe\(\)\s*;/.test(line));
    expect(callLines).toHaveLength(1);
  });

  it("index.ts imports startBootProbe from broker-router", () => {
    expect(indexSrc).toMatch(/import\s*\{[^}]*\bstartBootProbe\b[^}]*\}\s*from\s*["'][^"']*broker-router\.js["']/);
  });
});

describe("broker-router boot probe gate (R-359)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const savedFlag = process.env.BROKER_KEY_PROBE_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn().mockResolvedValue({ status: 400 });
    vi.stubGlobal("fetch", fetchSpy);
    delete process.env.BROKER_KEY_PROBE_ENABLED;
    mockIsLiveConfigured.mockReturnValue(true);
    mockIsHalted.mockResolvedValue(false);
    mockIsPipelineActive.mockResolvedValue(true);
    mockLoadCreds.mockResolvedValue({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedFlag === undefined) delete process.env.BROKER_KEY_PROBE_ENABLED;
    else process.env.BROKER_KEY_PROBE_ENABLED = savedFlag;
  });

  // ── THE DISCRIMINATION CONTROL — without this the rest is vacuous ──────────
  it("DISCRIMINATES: with every gate open the probe DOES contact the broker", async () => {
    allGatesOpen();
    await runProbe();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("flag unset (production default) → no broker contact, and no DB read at all", async () => {
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Short-circuits BEFORE the account query — the gate is not merely filtering rows.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("flag set to a non-'true' value → no broker contact (exact-string convention)", async () => {
    allGatesOpen();
    process.env.BROKER_KEY_PROBE_ENABLED = "1";
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("kill switch halted → no broker contact", async () => {
    allGatesOpen();
    mockIsHalted.mockResolvedValue(true);
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("kill-switch check throws → fail-CLOSED, no broker contact", async () => {
    allGatesOpen();
    mockIsHalted.mockRejectedValue(new Error("db down"));
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pipeline paused → no broker contact", async () => {
    allGatesOpen();
    mockIsPipelineActive.mockResolvedValue(false);
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pipeline check throws → fail-CLOSED, no broker contact", async () => {
    allGatesOpen();
    mockIsPipelineActive.mockRejectedValue(new Error("db down"));
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live execution not configured → no broker contact", async () => {
    allGatesOpen();
    mockIsLiveConfigured.mockReturnValue(false);
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── INVARIANCE EXHIBIT (R-359 required) ───────────────────────────────────
  it("INVARIANCE: with zero credentials (the tower's measured state) behaviour is unchanged — no contact, gate open or shut", async () => {
    allGatesOpen();
    mockLoadCreds.mockRejectedValue(new Error("Broker credentials missing"));
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.clearAllMocks();
    delete process.env.BROKER_KEY_PROBE_ENABLED;
    mockLoadCreds.mockRejectedValue(new Error("Broker credentials missing"));
    await runProbe();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
