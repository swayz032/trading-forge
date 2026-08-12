/**
 * MP1-CANDIDATE-INGRESS-1 — the `/api/backtests` half of the seam.
 *
 * Ruling: AR-1031 (gpt-rulings `f98dc291`) §4 REPAIR A / B / D, §5 controls 1,2,3,5.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * `spec-onboarding-service.ts:929-935` persists three candidate-identity siblings into
 * `strategies.config` (`execution_candidate_id`, `execution_candidate_cache_identity`,
 * `execution_candidate_receipt`), alongside `compiled_spec.spec_hash` (`:896-898`) which
 * is the parent anchor. Pre-repair, `POST /api/backtests` read that row and threw all of
 * it away: `config` is built from the REQUEST BODY (`backtests.ts:157`) and the DB-derived
 * `strategy` is an explicit nine-field whitelist (`:187-197`). Neither carries the sidecar.
 *
 * 🛑 THIS TEST DRIVES THE REAL REGISTERED ROUTE HANDLER — it pulls the handler off
 * `backtestRoutes`' own Express layer stack and invokes it. It does NOT re-implement or
 * copy the object-building logic, which is exactly what AR-1031 §4 RED-1 forbids
 * ("Use the real route construction boundary"). The assertion subject is the config
 * object the REAL route hands to the REAL `runBacktest` call site.
 *
 * `AN INGRESS TEST THAT BUILDS ITS OWN CONFIG PROVES THE TEST CAN BUILD A CONFIG.`
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Leaf stubs so the router imports in a unit context ────────────────────────
// backtests.js reaches the full Express bootstrap through its transitive imports
// (migrations + app.listen at module load); stub the logger module it lands on.
const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};
vi.mock("../../index.js", () => ({ logger: noopLogger }));

// The captured call. `runBacktest` is fire-and-forget in the route, so the spy both
// records and resolves.
const runBacktestSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ id: "bt-1" }));
vi.mock("../../services/backtest-service.js", () => ({
  runBacktest: (...args: unknown[]) => runBacktestSpy(...args),
}));
vi.mock("../../services/matrix-backtest-service.js", () => ({
  runMatrix: () => Promise.resolve({}),
  getMatrixStatus: () => Promise.resolve({}),
}));
vi.mock("../../middleware/idempotency.js", () => ({
  idempotencyMiddleware: function idempotencyMiddleware(_req: any, _res: any, next: any) {
    next();
  },
}));

// ── The strategy row the DB hands back ───────────────────────────────────────
let strategyRow: Record<string, unknown> | undefined;

vi.mock("../../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(strategyRow ? [strategyRow] : []),
      }),
    }),
    insert: () => ({
      values: () => ({ catch: () => undefined }),
    }),
  },
}));

// ── Fixture ──────────────────────────────────────────────────────────────────
// Values are opaque to the route: it must move them, never interpret them. The
// Python half (test_mp1_backtester_ingress.py) uses REAL minted receipts.
const PARENT_SPEC_HASH = "spec-hash-parent-aaaa1111";
const CANDIDATE_ID = "cand-15m-bbbb2222";
const CACHE_IDENTITY = "cache-ident-cccc3333";
const RECEIPT = { schema: "execution_candidate_receipt/v1", candidate_id: CANDIDATE_ID };

const STRATEGY_ID = "11111111-2222-4333-8444-555555555555";

function baseStrategyRow(configExtra: Record<string, unknown>) {
  return {
    id: STRATEGY_ID,
    name: "OR-15m MES",
    symbol: "MES",
    timeframe: "5m",
    tags: [`spec_hash:${PARENT_SPEC_HASH}`],
    config: {
      strategy_class: undefined,
      compiled_spec: { spec_hash: PARENT_SPEC_HASH },
      strategy: {
        indicators: [],
        entry_long: "close > open",
        entry_short: "close < open",
        exit: "bar_index > 10",
        stop_loss: { type: "atr", multiplier: 2.0 },
        position_size: { type: "fixed", fixed_contracts: 1 },
      },
      ...configExtra,
    },
  };
}

const CANDIDATE_AWARE_EXTRA = {
  execution_candidate_id: CANDIDATE_ID,
  execution_candidate_cache_identity: CACHE_IDENTITY,
  execution_candidate_receipt: RECEIPT,
};

// ── The real route handler, pulled off the real router ───────────────────────
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> };
};

async function realPostHandler(): Promise<Function> {
  const { backtestRoutes } = await import("../backtests.js");
  const layer = (backtestRoutes as unknown as { stack: Layer[] }).stack.find(
    (l) => l.route?.path === "/" && l.route?.methods?.post === true,
  );
  if (!layer?.route) throw new Error("POST / not registered on backtestRoutes");
  // Last handler in the chain is the body handler (idempotencyMiddleware precedes it).
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

type Captured = { status: number; body: any };

async function post(body: unknown): Promise<Captured> {
  const handler = await realPostHandler();
  const captured: Captured = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  };
  const req = { body, id: "corr-1", log: { error: () => {}, info: () => {}, warn: () => {} } };
  await handler(req, res);
  // The route's runBacktest call is fire-and-forget; let its microtasks drain.
  await new Promise((r) => setImmediate(r));
  return captured;
}

/** The config object the REAL route handed to the REAL runBacktest call site. */
function configHandedToRunBacktest(): Record<string, unknown> {
  expect(runBacktestSpy).toHaveBeenCalled();
  return runBacktestSpy.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  runBacktestSpy.mockClear();
  strategyRow = undefined;
});

describe("MP1-CANDIDATE-INGRESS-1 — /api/backtests carries DB-authoritative candidate identity", () => {
  // ── §5 control 1 — candidate-aware happy path ──────────────────────────────
  it("control 1 — a candidate-aware row's exact persisted identity reaches runBacktest", async () => {
    strategyRow = baseStrategyRow(CANDIDATE_AWARE_EXTRA);

    const res = await post({ strategyId: STRATEGY_ID });
    expect(res.status).toBe(202);

    const cfg = configHandedToRunBacktest();
    // The whole point of the unit: these four must survive the route.
    expect(cfg.execution_candidate_id).toBe(CANDIDATE_ID);
    expect(cfg.execution_candidate_cache_identity).toBe(CACHE_IDENTITY);
    expect(cfg.execution_candidate_receipt).toEqual(RECEIPT);
    expect(cfg.execution_candidate_parent_spec_hash).toBe(PARENT_SPEC_HASH);
  });

  it("control 1b — the identity is sourced from the DB, NOT from the request body", async () => {
    // A request-body sidecar must not be able to supply or colour the identity.
    // (Distinct from control 2, which covers a `strategy` override.)
    strategyRow = baseStrategyRow(CANDIDATE_AWARE_EXTRA);

    const res = await post({
      strategyId: STRATEGY_ID,
      execution_candidate_id: "attacker-candidate-zzzz9999",
      execution_candidate_parent_spec_hash: "attacker-parent-zzzz9999",
    });
    expect(res.status).toBe(202);

    const cfg = configHandedToRunBacktest();
    expect(cfg.execution_candidate_id).toBe(CANDIDATE_ID);
    expect(cfg.execution_candidate_parent_spec_hash).toBe(PARENT_SPEC_HASH);
  });

  // ── §5 control 2 — request strategy override on a candidate-aware row ──────
  it("control 2 — candidate-aware row + request `strategy` override is REFUSED, Python never launched", async () => {
    strategyRow = baseStrategyRow(CANDIDATE_AWARE_EXTRA);

    const res = await post({
      strategyId: STRATEGY_ID,
      strategy: {
        name: "attacker",
        symbol: "MES",
        timeframe: "5m",
        indicators: [],
        entry_long: "true",
        entry_short: "true",
        exit: "true",
        stop_loss: { type: "atr", multiplier: 2.0 },
        position_size: { type: "fixed", fixed_contracts: 1 },
      },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("candidate_authority_conflict");
    // The refusal must be BEFORE the spawn, not a post-hoc annotation.
    expect(runBacktestSpy).not.toHaveBeenCalled();
  });

  // ── §5 control 3 — partial sidecar refuses, no defaults ────────────────────
  it.each([
    ["missing receipt", { execution_candidate_id: CANDIDATE_ID, execution_candidate_cache_identity: CACHE_IDENTITY }],
    ["missing cache identity", { execution_candidate_id: CANDIDATE_ID, execution_candidate_receipt: RECEIPT }],
    ["missing candidate id", { execution_candidate_cache_identity: CACHE_IDENTITY, execution_candidate_receipt: RECEIPT }],
  ])("control 3 — partial sidecar (%s) is REFUSED with no defaults", async (_label, extra) => {
    strategyRow = baseStrategyRow(extra);

    const res = await post({ strategyId: STRATEGY_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("candidate_authority_incomplete");
    expect(runBacktestSpy).not.toHaveBeenCalled();
  });

  it("control 3b — a candidate-aware row with NO parent anchor is REFUSED, never guessed", async () => {
    // STOP[3]'s shape: binding to a parent must never be inferred.
    const row = baseStrategyRow(CANDIDATE_AWARE_EXTRA);
    delete (row.config as Record<string, unknown>).compiled_spec;
    strategyRow = row;

    const res = await post({ strategyId: STRATEGY_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("candidate_authority_incomplete");
    expect(runBacktestSpy).not.toHaveBeenCalled();
  });

  // ── §5 control 5 — legacy stays legacy (REPAIR D) ──────────────────────────
  it("control 5 — a receiptless legacy row is unchanged and mints no candidate", async () => {
    strategyRow = baseStrategyRow({});

    const res = await post({ strategyId: STRATEGY_ID });
    expect(res.status).toBe(202);

    const cfg = configHandedToRunBacktest();
    // Absence, asserted key by key — no candidate invented from timeframe, name or index.
    expect(cfg).not.toHaveProperty("execution_candidate_id");
    expect(cfg).not.toHaveProperty("execution_candidate_cache_identity");
    expect(cfg).not.toHaveProperty("execution_candidate_receipt");
    expect(cfg).not.toHaveProperty("execution_candidate_parent_spec_hash");
    // POSITIVE CONTROL: the legacy path really did run and really did build a config —
    // otherwise the four absences above would be vacuously true.
    expect((cfg.strategy as Record<string, unknown>).entry_long).toBe("close > open");
  });

  it("control 5b — a legacy row still accepts a request `strategy` override", async () => {
    // REPAIR B is scoped to candidate-aware rows; legacy behaviour must not change.
    strategyRow = baseStrategyRow({});

    const res = await post({
      strategyId: STRATEGY_ID,
      strategy: {
        name: "legacy-override",
        symbol: "MES",
        timeframe: "5m",
        indicators: [],
        entry_long: "override_entry",
        entry_short: "false",
        exit: "true",
        stop_loss: { type: "atr", multiplier: 2.0 },
        position_size: { type: "fixed", fixed_contracts: 1 },
      },
    });

    expect(res.status).toBe(202);
    const cfg = configHandedToRunBacktest();
    expect((cfg.strategy as Record<string, unknown>).entry_long).toBe("override_entry");
  });
});
