/**
 * D-10 `F-7` — the agent-service outcome mapping (R-767 §5, as AMENDED by R-768 §7).
 *
 * ─── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `agent-service.ts` had ZERO refusal awareness — `grep isExecutionRefused` over it
 * returned nothing — while carrying TEN completed-based binary mappings that sort
 * every non-`completed` outcome into ONE bucket named `failed`:
 *
 *     7 positive   `result.status === "completed" ? "tested"  : "failed"`      (journal)
 *                  `result.status === "completed" ? "success" : "failure"`     (audit)
 *     3 negative   `result.status !== "completed" ? result.error ?? "backtest failed" : undefined`
 *
 * An execution REFUSAL is not a failure. It is the engine declining to execute a
 * strategy whose source is too ambiguous to compile deterministically — a governance
 * decision that carries no metrics at all. Filed as `failed` with the fabricated
 * reason `"backtest failed"`, it becomes indistinguishable from a crash, and the one
 * record that says WHY is overwritten by a string nobody measured.
 *
 *   `A BINARY MAPPING CANNOT REPRESENT THREE OUTCOMES. THE THIRD ONE DOES NOT GET
 *    LOST — IT GETS RENAMED AS THE ONE YOU ALREADY HAVE A BUCKET FOR.`
 *
 * ★★★ AND THE THREE `!==` SITES ARE THE FINDING, NOT AN AFTERTHOUGHT (R-768 §3):
 *   they are where `"backtest failed"` is FABRICATED. `AR-881`'s member table listed
 *   them correctly and its summary sentence generalised them away as "every one is
 *   `=== "completed"`" — so a worker sweeping `grep '=== "completed"'` finds SEVEN and
 *   silently drops the exact three the finding exists for.
 *     `A CAPTION THAT OVER-GENERALISES ITS OWN TABLE DELETES THE MEMBERS THAT DIFFER.`
 *
 * ─── HARNESS PROVENANCE (R-767 §5: adapt a real suite, never write a replica) ──
 *
 * The mock scaffolding is adapted from `src/server/services/agent-service.test.ts`,
 * which was AUDITED as a genuine harness before being copied: it imports
 * `AgentService` from the real module, `agent-service.js` is NOT in its own
 * `vi.mock` list, and it drives `runStrategy()` for real. This file drives the same
 * subject through THREE real entrypoints plus the drain.
 *   `THE ONE-GREP REPLICA TEST MUST INCLUDE `await import(` — AND THE SUBJECT MUST
 *    NOT APPEAR IN ITS OWN MOCK LIST.`
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ─── Recorded production effects ─────────────────────────────────────────────
const rec = vi.hoisted(() => ({
  journal: [] as Array<Record<string, unknown>>,
  journalUpdates: [] as Array<Record<string, unknown>>,
  audit: [] as Array<Record<string, unknown>>,
}));

const btResult = vi.hoisted(() => ({ value: null as unknown }));

/**
 * 🛑 THE TABLE IS IDENTIFIED BY NAME, NEVER BY OBJECT IDENTITY.
 *
 * MEASURED, not assumed: an earlier draft used `table === schema.systemJournal`.
 * `vi.resetModules()` in `beforeEach` gives every test a FRESH `db/schema.js`
 * instance, so the identity held only for the first test and silently matched
 * NOTHING afterwards — six controls read an EMPTY journal and looked like six
 * production defects. The production code was correct; the recorder was blind.
 *   `AN IDENTITY COMPARISON ACROSS A MODULE-REGISTRY RESET SILENTLY BECOMES
 *    `false`, AND A RECORDER THAT CAPTURES NOTHING READS EXACTLY LIKE A
 *    PRODUCTION PATH THAT WROTE NOTHING.`
 */
const tableName = (t: unknown): string => {
  try {
    // drizzle's own accessor — stable across module instances.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return String((require("drizzle-orm") as { getTableName: (x: unknown) => string }).getTableName(t as never));
  } catch {
    return "";
  }
};

vi.mock("../db/index.js", () => {
  return {
    db: {
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (tableName(table) === "system_journal") rec.journal.push(v);
          if (tableName(table) === "audit_log") rec.audit.push(v);
          return {
            returning: () => Promise.resolve([{ id: "strategy-uuid-1" }]),
            catch: () => Promise.resolve(undefined),
            then: (r: (v: unknown) => void) =>
              Promise.resolve([{ id: "strategy-uuid-1" }]).then(r),
          };
        },
      }),
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => {
          if (tableName(table) === "system_journal") rec.journalUpdates.push(patch);
          return { where: () => Promise.resolve([]) };
        },
      }),
      select: () => {
        const chain: Record<string, unknown> = {};
        const resolve = () => Promise.resolve([] as unknown[]);
        chain["where"] = () => chain;
        chain["orderBy"] = () => chain;
        chain["limit"] = () => resolve();
        chain["then"] = (r: (v: unknown[]) => void) => resolve().then(r);
        return { from: () => chain };
      },
    },
  };
});

// The audit helper is a SEPARATE write path from `db.insert(auditLog)` — cluster 1
// uses it (`agent-service.ts:779`) while clusters 2 and 3 use the raw insert. Both
// are captured into the SAME record so a control cannot pass by reading the wrong one.
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn(async (row: Record<string, unknown>) => {
    rec.audit.push(row);
  }),
  insertAuditRowSafe: vi.fn(async (row: Record<string, unknown>) => {
    rec.audit.push(row);
  }),
}));

vi.mock("../services/backtest-service.js", () => ({
  runBacktest: vi.fn(async () => btResult.value),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(async () => true),
  getMode: vi.fn(async () => "ACTIVE"),
}));

vi.mock("../services/strategy-prevalidator.js", () => ({
  prevalidateCandidate: vi.fn(async () => ({
    passed: true,
    fingerprint: "fp",
    reasons: [],
    checks: {
      graveyard: { passed: true, existingCount: 0 },
      correlation: { passed: true, deployedCount: 0 },
      regime: { passed: true },
    },
  })),
}));

vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn(async () => ({ response: "{}" })),
  })),
}));

vi.mock("../services/graveyard-gate.js", () => ({
  GraveyardGate: vi.fn().mockImplementation(() => ({
    check: vi.fn(async () => ({ warnings: [] })),
  })),
}));

// The Python compiler bridge — `runStrategyFromDSL` compiles before it backtests.
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(async () => ({
    ok: true,
    strategy: {
      name: "compiled",
      symbol: "MES",
      timeframe: "5m",
      indicators: [],
      entry_long: "",
      entry_short: "",
      exit: "",
      stop_loss: { type: "atr", multiplier: 2.0 },
      position_size: { type: "dynamic_atr", target_risk_dollars: 500 },
    },
  })),
}));

// ─── AN UPSTREAM QUALITY GATE, STUBBED TO ACCEPT — AND WHY THAT IS HONEST ───
// MEASURED before stubbing: with the real auditor, `runStrategyFromDSL` returns
// `audit_rejected` with defects B3_FIXED_POINT_STOP / B4_TIME_STOP_MISSING /
// POSITION_SIZE_TYPE_WRONG / E1_REGIME_GATE_DISABLED, and NEVER REACHES the outcome
// mapping this file exists to test. The gate is a real production behaviour and it is
// not F-7's subject; the same stub is used by the sibling `d10-n3` suite.
//   `A FIXTURE THAT CANNOT REACH THE BRANCH UNDER TEST MEASURES THE GATE IN FRONT
//    OF IT — AND REPORTS THE GATE'S VERDICT AS THOUGH IT WERE THE BRANCH'S.`
// F-7.2's reach therefore depends on this stub; stated so no reader mistakes this
// file for evidence that the DSL path passes the auditor.
vi.mock("../services/graduated-strategy-auditor.js", () => ({
  auditGraduatedConfig: vi.fn(() => ({ passed: true, defects: [], warnings: [] })),
  formatAuditResult: vi.fn(() => "ok"),
}));

vi.mock("../services/dsl-diversity-service.js", () => ({
  checkDslDiversity: vi.fn(async () => ({ passed: true, rejected: false, reasons: [] })),
  persistDslFeatureVector: vi.fn(async () => undefined),
  auditDslDiversityRejection: vi.fn(async () => undefined),
}));

vi.mock("../services/prompt-evolution-service.js", () => ({
  getActiveVersionIdForGeneration: vi.fn(async () => null),
}));

vi.mock("../lib/dlq-service.js", () => ({ captureToDLQ: vi.fn(async () => undefined) }));
vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(async () => undefined),
}));

// ─── Fixtures — the REAL envelopes, not invented ones ────────────────────────

/** The refusal envelope as the Python boundary emits it (same shape as D-10 N-1). */
const REFUSED = {
  id: "bt-refused",
  status: "refused",
  execution_status: "REFUSED",
  condition_id: "opening_range_trigger",
  disposition: "SOURCE_AMBIGUOUS",
  reason: "opening range duration not stated by the source",
};

const COMPLETED = { id: "bt-ok", status: "completed", tier: "TIER_1", forge_score: 85 };

/** A GENUINE failure carrying a real engine error. */
const FAILED_REAL = { id: "bt-bad", status: "failed", error: "python bridge exited 137 (OOM)" };

/** A genuine failure with NO error string — the only case a generic fallback may serve. */
const FAILED_BARE = { id: "bt-bad2", status: "failed" };

const SKIPPED = { id: "bt-skip", status: "skipped" };

const SRC = join(process.cwd(), "src/server/services/agent-service.ts");

function journalStatuses(): unknown[] {
  return rec.journal.map((r) => r.status);
}

/**
 * Only the rows produced by the OUTCOME mapping. Gate and rejection audits carry
 * their own actions and are not what `F-7` maps — including them would let a
 * control pass on a row the mapper never touched.
 */
function auditRows(): Array<Record<string, unknown>> {
  return rec.audit.filter((r) => String(r.action ?? "").startsWith("agent."));
}

beforeEach(() => {
  rec.journal.length = 0;
  rec.journalUpdates.length = 0;
  rec.audit.length = 0;
  vi.resetModules();
});

async function service() {
  const mod = await import("../services/agent-service.js");
  return new mod.AgentService();
}

const RUN_STRATEGY_INPUT = {
  strategy_name: "BB Mean Reversion",
  one_sentence: "Buy when price touches lower BB on MES 15min",
  python_code: "import vectorbt as vbt",
  params: { period: 20 },
  symbol: "MES" as const,
  timeframe: "15min",
  start_date: "2024-01-01",
  end_date: "2024-12-31",
  // assertCrossValidatedSource() hard-rejects every source but this one.
  source: "graduated_bucket" as const,
};

const DSL = {
  name: "dsl-strat",
  strategy: { name: "dsl-strat", symbol: "MES", timeframe: "5m", contract_class: "micro" },
};

const CLASS_INPUT = {
  strategy_name: "class-strat",
  strategy_class: "OpeningRangeBreakout",
  symbol: "MES",
  timeframe: "5m",
  source: "graduated_bucket" as any,
  description: "opening range breakout",
  params: {},
};

describe("D-10 F-7 — a refusal is not a failure, on every agent path (R-767 §5)", () => {
  it("F-7.1 [runStrategy] a REFUSAL is journalled `refused`, audited `refused`, and fabricates NO error", async () => {
    btResult.value = REFUSED;
    const svc = await service();
    // @ts-ignore — partial input shape, as the adapted harness does
    await svc.runStrategy(RUN_STRATEGY_INPUT);

    expect(journalStatuses(), "the journal filed a refusal as something else").toContain("refused");
    expect(journalStatuses()).not.toContain("failed");

    const a = auditRows();
    expect(a.length, "no agent audit row was written — the path did not run").toBeGreaterThan(0);
    expect(a.map((r) => r.status)).toContain("refused");
    // THE FABRICATION: the reason must be absent, not invented.
    for (const row of a) {
      expect(row.errorMessage ?? null, "a refusal carried a fabricated errorMessage").toBeNull();
    }
  });


  it("F-7.2 [runStrategyFromDSL] the same, on the second production caller", async () => {
    btResult.value = REFUSED;
    const svc = await service();
    await svc.runStrategyFromDSL(DSL, { source: "graduated_bucket" });

    expect(journalStatuses()).toContain("refused");
    expect(journalStatuses()).not.toContain("failed");
    const a = auditRows();
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((r) => r.status)).toContain("refused");
    for (const row of a) expect(row.errorMessage ?? null).toBeNull();
  });

  it("F-7.3 [runClassStrategy] the same, on the third — two callers fixed is not the defect fixed", async () => {
    btResult.value = REFUSED;
    const svc = await service();
    // @ts-ignore — partial input shape
    await svc.runClassStrategy(CLASS_INPUT);

    expect(journalStatuses()).toContain("refused");
    expect(journalStatuses()).not.toContain("failed");
    const a = auditRows();
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((r) => r.status)).toContain("refused");
    for (const row of a) expect(row.errorMessage ?? null).toBeNull();
  });

  // ─── THE POSITIVES MUST STAY DISTINCT ──────────────────────────────────────
  it("F-7.4 POSITIVE CONTROL — a completed run is still `tested` / `success`, unchanged", async () => {
    btResult.value = COMPLETED;
    const svc = await service();
    // @ts-ignore
    await svc.runStrategy(RUN_STRATEGY_INPUT);

    expect(journalStatuses()).toContain("tested");
    expect(journalStatuses()).not.toContain("refused");
    expect(auditRows().map((r) => r.status)).toContain("success");
  });

  it("F-7.5 POSITIVE CONTROL — a GENUINE failure keeps its ACTUAL error, never a generic one", async () => {
    btResult.value = FAILED_REAL;
    const svc = await service();
    // @ts-ignore
    await svc.runStrategy(RUN_STRATEGY_INPUT);

    expect(journalStatuses()).toContain("failed");
    const a = auditRows();
    expect(a.map((r) => r.status)).toContain("failure");
    expect(
      a.some((r) => r.errorMessage === "python bridge exited 137 (OOM)"),
      "the real engine error was replaced by a generic string",
    ).toBe(true);
  });

  it("F-7.6 the generic fallback is permitted ONLY after failure is established", async () => {
    btResult.value = FAILED_BARE;
    const svc = await service();
    // @ts-ignore
    await svc.runStrategy(RUN_STRATEGY_INPUT);

    expect(journalStatuses()).toContain("failed");
    expect(
      auditRows().some((r) => r.errorMessage === "backtest failed"),
      "an established failure with no error lost its fallback reason",
    ).toBe(true);
  });

  it("F-7.7 a SKIPPED run is its own outcome, not a failure", async () => {
    btResult.value = SKIPPED;
    const svc = await service();
    // @ts-ignore
    await svc.runStrategy(RUN_STRATEGY_INPUT);

    expect(journalStatuses()).toContain("skipped");
    expect(journalStatuses()).not.toContain("failed");
    expect(auditRows().map((r) => r.status)).toContain("skipped");
    for (const row of auditRows()) expect(row.errorMessage ?? null).toBeNull();
  });

  // ─── THE DRAIN (the tenth mapping — NOT a direct runBacktest caller) ──────
  /**
   * 🛑 SCOPE, STATED RATHER THAN IMPLIED: this control does NOT drive
   * `drainScoutedIdeas` end-to-end. Reaching its status stamp requires the LLM
   * proposer path (`agent-service.ts:2048` parses a generated DSL) plus output
   * validation — four more boundary stubs — and a fixture built to satisfy them
   * would be measuring my own mocks, not the drain.
   *
   * MEASURED: an earlier version of this control asserted `out.failed === 0` after
   * calling the real drain with an empty stub `select()`. The drain returns
   * `{scanned:0, drained:0, failed:0}` immediately when no rows are scouted, so that
   * assertion COULD NOT FAIL — it passed against the UNFIXED code.
   *   `A COMPARISON THAT CANNOT FAIL IS A PRINTOUT.`
   *
   * So the drain's site is covered two ways that CAN fail instead:
   *   - F-7.8 proves ZERO executable binary ternaries remain anywhere in the file,
   *     and its red listed the drain's line among the survivors.
   *   - this control feeds the mapper the EXACT shape the drain passes it.
   */
  it("F-7.10 [drain] the mapper, fed the drain's own input shape, yields `refused` — never `failed`", async () => {
    const mod = await import("../services/agent-service.js");

    // Exactly what `drainScoutedIdeas` builds at the stamp site: a
    // `runStrategyFromDSL` return's status plus the refusal evidence it carries.
    const fromDsl = { status: "refused", refusal: { disposition: "SOURCE_AMBIGUOUS" } };
    const outcome = mod.mapAgentOutcome({ status: fromDsl.status, ...fromDsl.refusal });

    expect(outcome.journalStatus, "the drain would stamp a refusal as failed").toBe("refused");
    expect(outcome.journalStatus).not.toBe("failed");
    expect(outcome.errorMessage ?? null, "the drain would fabricate a reason").toBeNull();

    // POSITIVE WITNESS that the drain itself is callable and returns its counter
    // shape — so "no failure counted" is a statement about a method that RAN.
    const svc = await service();
    const out = await svc.drainScoutedIdeas(5);
    expect(out).toHaveProperty("drained");
    expect(out).toHaveProperty("failed");
  });
});

describe("D-10 F-7 — the production-use guard (R-767 §5 controls)", () => {
  it("F-7.8 ZERO executable copies of the old binary ternary remain at the ten named sites", async () => {
    const src = readFileSync(SRC, "utf8");
    const executable = src
      .split("\n")
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
      });

    const positives = executable.filter(({ l }) => /=== *"completed" *\?/.test(l));
    const negatives = executable.filter(({ l }) => /!== *"completed" *\?/.test(l));

    expect(
      positives.map((p) => p.n),
      'an executable `=== "completed" ? …` binary mapping survived',
    ).toEqual([]);
    expect(
      negatives.map((p) => p.n),
      'an executable `!== "completed" ? …` fabrication site survived — these three ARE the finding (R-768 §3)',
    ).toEqual([]);
    expect(
      executable.filter(({ l }) => l.includes('"backtest failed"')).map((p) => p.n).length,
      "the fabricated reason is still written outside the mapper",
    ).toBe(1);
  });

  it("F-7.9 the SHARED classifier is used — F-7 does not introduce a second one", async () => {
    const src = readFileSync(SRC, "utf8");
    expect(src, "agent-service must consume the SHARED classifier").toContain("backtest-refusal.js");
    expect(src).toContain("isExecutionRefused");

    // A restated literal would be a second classifier wearing a shared one's name.
    const restated = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .filter((l) => /status *=== *"refused"/.test(l));
    expect(restated, 'a bare `status === "refused"` literal is a second classifier').toEqual([]);
  });
});
