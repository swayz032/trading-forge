/**
 * paper-qualification-activation-service.test.ts — AR-1155 (2026-08-19)
 *
 * Tests the REAL production decision/wrapper (AR-1341A S5), not a mirror:
 *   - Section 1: pure `decideActivation` — every RED witness plus every mutation class,
 *     driven through the real `buildCandidateProjection`/`buildRunEnvironmentProjection`/
 *     `canonicalHash` so a "mutation blocks" assertion proves the HASH actually changed,
 *     not just that decideActivation's string comparison works.
 *   - Section 2: `verifyPaperActivation` against a real in-memory PGlite instance —
 *     first-activation stamp, verified resume with no overwrite, DB-level candidate
 *     mutation, runtime-revision mutation.
 *   - Section 3: F-5 freshness — warm the shared execution cache, mutate DB, prove the
 *     activation verifier still sees the mutation (bypasses the cache it warmed).
 *   - Section 4: F-8 TOCTOU — a mutation landing strictly between the internal read and
 *     write of ONE verifyPaperActivation call must still block (via a controlled spy on
 *     getSessionConfigFresh's two internal calls, not two separate verifyPaperActivation
 *     invocations, since the mismatch must be provably intra-call).
 *   - Section 5: F-3/F-7 atomicity — two racing first-stamp callers cannot create two
 *     identities; an unrelated concurrent config key survives the stamp.
 *   - Section 6: contract — verifyPaperActivation never calls startStream() itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted above the static imports below (vi.mock, unlike vi.doMock, is hoisted by Vitest's
// transform) — without this, the top-level `import ... from "../services/paper-qualification-
// activation-service.js"` transitively evaluates `../db/index.js`, which throws
// "DATABASE_URL environment variable is required" at test-collection time, before any test
// even runs. Section 1 below only needs the module's PURE exports and never touches `db`. Each
// PGlite-backed `it()` further down overrides this via `vi.doMock` + `vi.resetModules()` +
// dynamic import, exactly like compute-failover.test.ts's `getPipelineStatus` suite.
vi.mock("../db/index.js", () => ({ db: {} }));
// Same reason, same hoisting requirement: the static import below also transitively pulls in
// paper-signal-service.js (via the service module's own `getSessionConfigFresh` import), which
// itself transitively imports the full Express app bootstrap through unrelated dependencies
// (paper-risk-gate.js / context-gate-service.js -> ../index.js -> `new LifecycleService()` at
// module scope). PGlite-backed tests below override this via `vi.doMock` + `vi.resetModules()`
// with a faithful DB-backed fake (see `setUp()`); Section 1 (pure functions) never calls these.
vi.mock("../services/paper-signal-service.js", () => ({
  getSessionConfigFresh: vi.fn(),
  getSessionConfig: vi.fn(),
  invalidateSessionCache: vi.fn(),
}));

import {
  decideActivation,
  resolveRuntimeRevision,
  resolveCandidateSymbols,
  canonicalHash,
  buildCandidateProjection,
  buildRunEnvironmentProjection,
  sessionRiskConfig,
  type PaperQualificationIdentity,
  type PaperSessionConfigWithIdentity,
} from "../services/paper-qualification-activation-service.js";

// ─── Section 1 — pure decideActivation, driven through real hashing ────────

const BASE_CANDIDATE = {
  strategyId: "strat-1",
  symbols: ["MES"],
  timeframe: "5m",
  effectiveConfig: { entry_rules: ["a"], exit_rules: ["b"] },
  exitPlanConfig: { exit_style: "static_styleC" },
};
const BASE_RUN = {
  mode: "paper",
  firmId: "topstep" as string | null,
  feedMode: "delayed" as const,
  rawSessionConfig: { daily_loss_budget: 500 },
};
const BASE_DIAGNOSTIC = {
  strategy_id: "strat-1",
  lifecycle_state: "TESTING",
  symbols: ["MES"],
  timeframe: "5m",
  mode: "paper",
  firm_id: "topstep" as string | null,
  feed_mode: "delayed",
};

function baseDecideInput(overrides: Partial<Parameters<typeof decideActivation>[0]> = {}) {
  const candidateHash = canonicalHash(buildCandidateProjection(BASE_CANDIDATE));
  const runHash = canonicalHash(buildRunEnvironmentProjection(BASE_RUN));
  return {
    strategyId: BASE_CANDIDATE.strategyId,
    lifecycleState: "TESTING",
    symbols: BASE_CANDIDATE.symbols,
    feedMode: BASE_RUN.feedMode,
    runtimeRevision: "a".repeat(40),
    candidateVersionHash: candidateHash,
    runEnvironmentHash: runHash,
    diagnostic: BASE_DIAGNOSTIC,
    existingIdentity: null as PaperQualificationIdentity | null,
    nowIso: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveRuntimeRevision", () => {
  const ORIGINAL = process.env.TF_RUNTIME_REVISION;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.TF_RUNTIME_REVISION;
    else process.env.TF_RUNTIME_REVISION = ORIGINAL;
  });

  it("missing -> null", () => {
    delete process.env.TF_RUNTIME_REVISION;
    expect(resolveRuntimeRevision()).toBeNull();
  });
  it("blank -> null", () => {
    process.env.TF_RUNTIME_REVISION = "";
    expect(resolveRuntimeRevision()).toBeNull();
  });
  it("whitespace-only (malformed) -> null", () => {
    process.env.TF_RUNTIME_REVISION = "   \t  ";
    expect(resolveRuntimeRevision()).toBeNull();
  });
  it("set -> trimmed value", () => {
    process.env.TF_RUNTIME_REVISION = "  " + "b".repeat(40) + "  ";
    expect(resolveRuntimeRevision()).toBe("b".repeat(40));
  });
});

describe("resolveCandidateSymbols", () => {
  it("none resolves -> []", () => {
    expect(resolveCandidateSymbols(null, undefined)).toEqual([]);
  });
  it("strategy symbol only", () => {
    expect(resolveCandidateSymbols("MES", undefined)).toEqual(["MES"]);
  });
  it("adds distinct config symbol, dedupes", () => {
    expect(resolveCandidateSymbols("MES", { symbol: "MNQ" })).toEqual(["MES", "MNQ"]);
    expect(resolveCandidateSymbols("MES", { symbol: "MES" })).toEqual(["MES"]);
  });
});

describe("decideActivation — first-activation RED witnesses", () => {
  it("missing runtime revision refuses", () => {
    const r = decideActivation(baseDecideInput({ runtimeRevision: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/runtime_revision_missing/);
  });
  it("missing candidate (no strategy) refuses", () => {
    const r = decideActivation(baseDecideInput({ strategyId: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/candidate_unresolved/);
  });
  it("missing lifecycle state refuses", () => {
    const r = decideActivation(baseDecideInput({ lifecycleState: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/candidate_unresolved/);
  });
  it("unresolved symbol refuses", () => {
    const r = decideActivation(baseDecideInput({ symbols: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/candidate_unresolved/);
  });
  it("unknown feed identity refuses", () => {
    const r = decideActivation(baseDecideInput({ feedMode: "unknown" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/feed_identity_unresolved/);
  });
  it("successful first activation stamps exactly the given hashes, stamped:true", () => {
    const r = decideActivation(baseDecideInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stamped).toBe(true);
    expect(r.identity.candidate_version_hash).toBe(canonicalHash(buildCandidateProjection(BASE_CANDIDATE)));
    expect(r.identity.run_environment_hash).toBe(canonicalHash(buildRunEnvironmentProjection(BASE_RUN)));
    expect(r.identity.runtime_revision).toBe("a".repeat(40));
  });
});

describe("decideActivation — verified resume: exact match passes WITHOUT overwrite", () => {
  it("returns the SAME identity object, unmutated, stamped:false", () => {
    const first = decideActivation(baseDecideInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = decideActivation(baseDecideInput({ existingIdentity: first.identity, nowIso: "2026-08-20T00:00:00.000Z" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.stamped).toBe(false);
    expect(second.identity).toBe(first.identity); // same reference — never re-stamped
    expect(second.identity.stamped_at).toBe("2026-08-19T00:00:00.000Z"); // not the new nowIso
  });
});

describe("decideActivation — every mutation class blocks resume (hash actually changes)", () => {
  function stampedFirst(): PaperQualificationIdentity {
    const r = decideActivation(baseDecideInput());
    if (!r.ok) throw new Error("test setup: first activation must succeed");
    return r.identity;
  }

  it("strategy ID mutation blocks (candidate hash changes)", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(buildCandidateProjection({ ...BASE_CANDIDATE, strategyId: "strat-2" }));
    expect(mutatedHash).not.toBe(stamp.candidate_version_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, candidateVersionHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/candidate_mutation/);
  });

  it("symbol-set mutation blocks", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(buildCandidateProjection({ ...BASE_CANDIDATE, symbols: ["MES", "MNQ"] }));
    expect(mutatedHash).not.toBe(stamp.candidate_version_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, candidateVersionHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/candidate_mutation/);
  });

  it("timeframe mutation blocks", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(buildCandidateProjection({ ...BASE_CANDIDATE, timeframe: "15m" }));
    expect(mutatedHash).not.toBe(stamp.candidate_version_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, candidateVersionHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/candidate_mutation/);
  });

  it("post-translation effective config mutation blocks", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(
      buildCandidateProjection({ ...BASE_CANDIDATE, effectiveConfig: { entry_rules: ["a"], exit_rules: ["DIFFERENT"] } }),
    );
    expect(mutatedHash).not.toBe(stamp.candidate_version_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, candidateVersionHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/candidate_mutation/);
  });

  it("full top-level exit_plan_config mutation blocks", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(
      buildCandidateProjection({ ...BASE_CANDIDATE, exitPlanConfig: { exit_style: "adaptive" } }),
    );
    expect(mutatedHash).not.toBe(stamp.candidate_version_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, candidateVersionHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/candidate_mutation/);
  });

  it("mode mutation blocks", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(buildRunEnvironmentProjection({ ...BASE_RUN, mode: "shadow" }));
    expect(mutatedHash).not.toBe(stamp.run_environment_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, runEnvironmentHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/run_mutation/);
  });

  it("firm identity mutation blocks", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(buildRunEnvironmentProjection({ ...BASE_RUN, firmId: "mffu" }));
    expect(mutatedHash).not.toBe(stamp.run_environment_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, runEnvironmentHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/run_mutation/);
  });

  it("feed identity mutation blocks", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(buildRunEnvironmentProjection({ ...BASE_RUN, feedMode: "realtime" }));
    expect(mutatedHash).not.toBe(stamp.run_environment_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, runEnvironmentHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/run_mutation/);
  });

  it("session risk/execution config mutation blocks", () => {
    const stamp = stampedFirst();
    const mutatedHash = canonicalHash(
      buildRunEnvironmentProjection({ ...BASE_RUN, rawSessionConfig: { daily_loss_budget: 999 } }),
    );
    expect(mutatedHash).not.toBe(stamp.run_environment_hash);
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, runEnvironmentHash: mutatedHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/run_mutation/);
  });

  it("runtime revision mutation blocks", () => {
    const stamp = stampedFirst();
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, runtimeRevision: "c".repeat(40) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/runtime_revision_mismatch/);
  });

  it("a blocked resume never carries an ok:true-shaped identity (control discriminates)", () => {
    const stamp = stampedFirst();
    const r = decideActivation(baseDecideInput({ existingIdentity: stamp, runtimeRevision: "c".repeat(40) }));
    expect(r).not.toHaveProperty("identity");
    expect(r).not.toHaveProperty("stamped");
  });
});

describe("sessionRiskConfig — strips receipt keys, never self-hashes them", () => {
  it("removes qualification_identity and evidence_labels, keeps everything else", () => {
    const raw = {
      daily_loss_budget: 500,
      qualification_identity: { fake: "stamp" },
      evidence_labels: { feed_mode: "delayed" },
    } as unknown as PaperSessionConfigWithIdentity;
    expect(sessionRiskConfig(raw)).toEqual({ daily_loss_budget: 500 });
  });
  it("null/undefined -> {}", () => {
    expect(sessionRiskConfig(null)).toEqual({});
    expect(sessionRiskConfig(undefined)).toEqual({});
  });
});

// ─── Sections 2-6 — verifyPaperActivation against real PGlite ─────────────

describe("verifyPaperActivation — PGlite-backed", () => {
  const STRAT_ID = "11111111-0000-0000-0000-000000000001";
  const SESSION_ID = "22222222-0000-0000-0000-000000000001";
  const ORIGINAL_REVISION = process.env.TF_RUNTIME_REVISION;

  beforeEach(() => {
    process.env.TF_RUNTIME_REVISION = "d".repeat(40);
  });
  afterEach(() => {
    if (ORIGINAL_REVISION === undefined) delete process.env.TF_RUNTIME_REVISION;
    else process.env.TF_RUNTIME_REVISION = ORIGINAL_REVISION;
    vi.doUnmock("../db/index.js");
    vi.doUnmock("../services/paper-signal-service.js");
    vi.resetModules();
  });

  async function setUp(opts: { strategyOverrides?: Record<string, unknown>; sessionConfig?: Record<string, unknown> } = {}) {
    const { createTestDb } = await import("./helpers/pglite-db.js");
    const ctx = await createTestDb();
    vi.doMock("../db/index.js", () => ({ db: ctx.db }));
    // paper-signal-service.js cannot be imported for real here: it transitively imports
    // paper-risk-gate.js / context-gate-service.js (both of which import `../index.js`,
    // the full Express bootstrap — `new LifecycleService()` at module scope, 65 files in
    // this codebase share this pre-existing, AR-1155-unrelated anti-pattern). This mock is
    // a FAITHFUL minimal reimplementation of the exact same cached-vs-fresh contract
    // (getSessionConfig caches per sessionId forever; getSessionConfigFresh never caches,
    // always re-reads) against the SAME real PGlite `strategies`/`paper_sessions` rows —
    // it does not skip DSL translation because none of this file's fixtures are DSL-shaped
    // strategy configs (translateDSLToPaperConfig is a no-op on a plain config object).
    vi.doMock("../services/paper-signal-service.js", async () => {
      const { eq: eqFn } = await import("drizzle-orm");
      const schemaMod = await import("../db/schema.js");
      const fakeCache = new Map<string, unknown>();
      async function loadFresh(sessionId: string) {
        const [session] = await ctx.db.select().from(schemaMod.paperSessions).where(eqFn(schemaMod.paperSessions.id, sessionId));
        if (!session || !session.strategyId) return null;
        const [strategy] = await ctx.db.select().from(schemaMod.strategies).where(eqFn(schemaMod.strategies.id, session.strategyId));
        if (!strategy) return null;
        return {
          config: strategy.config,
          strategyId: strategy.id,
          name: strategy.name,
          symbol: strategy.symbol,
          timeframe: strategy.timeframe ?? "1m",
          cooldownRemaining: 0,
          lifecycleState: strategy.lifecycleState,
          shadowModeEnabled: false,
          exitPlanConfig: strategy.exitPlanConfig ?? null,
        };
      }
      return {
        getSessionConfigFresh: vi.fn(async (sessionId: string) => loadFresh(sessionId)),
        getSessionConfig: vi.fn(async (sessionId: string) => {
          if (fakeCache.has(sessionId)) return fakeCache.get(sessionId);
          const entry = await loadFresh(sessionId);
          if (entry) fakeCache.set(sessionId, entry);
          return entry;
        }),
        invalidateSessionCache: vi.fn((sessionId: string) => { fakeCache.delete(sessionId); }),
      };
    });
    vi.resetModules();
    const schema = await import("../db/schema.js");
    await ctx.db.insert(schema.strategies).values({
      id: STRAT_ID,
      name: "ar1155-test-strategy",
      symbol: "MES",
      timeframe: "5m",
      config: { entry_rules: ["a"] },
      lifecycleState: "TESTING",
      ...opts.strategyOverrides,
    });
    await ctx.db.insert(schema.paperSessions).values({
      id: SESSION_ID,
      strategyId: STRAT_ID,
      status: "active",
      mode: "paper",
      startingCapital: "50000",
      currentEquity: "50000",
      config: opts.sessionConfig ?? {},
    });
    return ctx;
  }

  it("session_not_found for an unknown session id", async () => {
    const ctx = await setUp();
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const result = await verifyPaperActivation("99999999-0000-0000-0000-000000000099");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("session_not_found");
    await ctx.close();
  });

  it("first call stamps candidate_version_hash + run_environment_hash + runtime_revision once", async () => {
    const ctx = await setUp();
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    const result = await verifyPaperActivation(SESSION_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stamped).toBe(true);
    expect(result.symbols).toEqual(["MES"]);
    expect(result.identity.candidate_version_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.identity.run_environment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.identity.runtime_revision).toBe("d".repeat(40));

    const [row] = await ctx.db.select().from(schema.paperSessions).where(eq(schema.paperSessions.id, SESSION_ID));
    const config = row.config as PaperSessionConfigWithIdentity;
    expect(config.qualification_identity?.candidate_version_hash).toBe(result.identity.candidate_version_hash);
    await ctx.close();
  });

  it("resume under exact identity passes WITHOUT overwriting the persisted stamp", async () => {
    const ctx = await setUp();
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    const first = await verifyPaperActivation(SESSION_ID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stampedAt = first.identity.stamped_at;

    const second = await verifyPaperActivation(SESSION_ID);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.stamped).toBe(false);
    expect(second.identity.stamped_at).toBe(stampedAt);

    const [row] = await ctx.db.select().from(schema.paperSessions).where(eq(schema.paperSessions.id, SESSION_ID));
    const config = row.config as PaperSessionConfigWithIdentity;
    expect(config.qualification_identity?.stamped_at).toBe(stampedAt);
    await ctx.close();
  });

  it("DB-level candidate mutation (strategy.config edited) blocks resume", async () => {
    const ctx = await setUp();
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    const first = await verifyPaperActivation(SESSION_ID);
    expect(first.ok).toBe(true);

    await ctx.db.update(schema.strategies).set({ config: { entry_rules: ["MUTATED"] } }).where(eq(schema.strategies.id, STRAT_ID));

    const second = await verifyPaperActivation(SESSION_ID);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/candidate_mutation/);
    await ctx.close();
  });

  it("runtime revision mutation (redeploy) blocks and does not touch the stored stamp", async () => {
    const ctx = await setUp();
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    const first = await verifyPaperActivation(SESSION_ID);
    expect(first.ok).toBe(true);

    process.env.TF_RUNTIME_REVISION = "e".repeat(40);
    const second = await verifyPaperActivation(SESSION_ID);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/runtime_revision_mismatch/);

    const [row] = await ctx.db.select().from(schema.paperSessions).where(eq(schema.paperSessions.id, SESSION_ID));
    const config = row.config as PaperSessionConfigWithIdentity;
    expect(config.qualification_identity?.runtime_revision).toBe("d".repeat(40));
    await ctx.close();
  });

  // ── Section 3 — F-5 freshness: warm cache, mutate DB, verify still catches it ──

  it("F-5: warm sessionCache under candidate A, mutate DB to candidate B, verification MUST BLOCK", async () => {
    const ctx = await setUp();
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const { getSessionConfig } = await import("../services/paper-signal-service.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    // Stamp once (also proves the verifier itself never relies on the cache being warm).
    const first = await verifyPaperActivation(SESSION_ID);
    expect(first.ok).toBe(true);

    // Warm the SHARED module-level cache via the normal bar-execution entry point.
    const warmed = await getSessionConfig(SESSION_ID);
    expect(warmed?.config).toEqual({ entry_rules: ["a"] });

    // Mutate the DB candidate WITHOUT invalidating the cache.
    await ctx.db.update(schema.strategies).set({ config: { entry_rules: ["MUTATED-AFTER-WARM"] } }).where(eq(schema.strategies.id, STRAT_ID));

    // The cache would still return the STALE config if getSessionConfig() were used here.
    const stillCached = await getSessionConfig(SESSION_ID);
    expect(stillCached?.config).toEqual({ entry_rules: ["a"] }); // proves the cache IS stale

    // The activation verifier must NOT be fooled by that stale cache.
    const second = await verifyPaperActivation(SESSION_ID);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/candidate_mutation/);
    await ctx.close();
  });

  // ── Section 4 — F-8 TOCTOU: mutation strictly between the internal read and write ──

  it("F-8: a candidate mutation landing between the internal read and write of ONE call still blocks", async () => {
    const ctx = await setUp();
    const psModule = await import("../services/paper-signal-service.js");
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    const realFresh = psModule.getSessionConfigFresh.bind(psModule);
    let callCount = 0;
    const spy = vi.spyOn(psModule, "getSessionConfigFresh").mockImplementation(async (sessionId: string) => {
      callCount += 1;
      if (callCount === 2) {
        // Simulate a writer mutating strategy.config strictly between this call's own
        // internal READ (call 1, used to compute the hash it is about to persist) and its
        // internal WRITE — by the time resolveActivationState() is invoked a SECOND time
        // (the F-8 post-write re-verification), the DB has already changed under it.
        await ctx.db.update(schema.strategies).set({ config: { entry_rules: ["TOCTOU-MUTATED"] } }).where(eq(schema.strategies.id, STRAT_ID));
      }
      return realFresh(sessionId);
    });

    const result = await verifyPaperActivation(SESSION_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/candidate_mutation/);
    expect(callCount).toBeGreaterThanOrEqual(2); // proves the post-write re-read actually ran

    // The stamp must NOT have been silently rewritten to chase the newer state — either no
    // stamp exists, or if the CAS write landed before the mutation was observed, the persisted
    // stamp's hash still reflects the ORIGINAL (pre-mutation) candidate, never the TOCTOU one.
    const [row] = await ctx.db.select().from(schema.paperSessions).where(eq(schema.paperSessions.id, SESSION_ID));
    const persisted = (row.config as PaperSessionConfigWithIdentity).qualification_identity;
    const toctouHash = canonicalHash(
      buildCandidateProjection({
        strategyId: STRAT_ID,
        symbols: ["MES"],
        timeframe: "5m",
        effectiveConfig: { entry_rules: ["TOCTOU-MUTATED"] },
        exitPlanConfig: null,
      }),
    );
    if (persisted) expect(persisted.candidate_version_hash).not.toBe(toctouHash);

    spy.mockRestore();
    await ctx.close();
  });

  // ── Section 5 — F-3/F-7 atomicity ──

  it("two racing first-stamp callers cannot create two identities; only one stamp persists", async () => {
    const ctx = await setUp();
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    const [a, b] = await Promise.all([verifyPaperActivation(SESSION_ID), verifyPaperActivation(SESSION_ID)]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Both callers must agree on the SAME winning identity — no two-identities outcome.
    expect(a.identity.candidate_version_hash).toBe(b.identity.candidate_version_hash);
    expect(a.identity.stamped_at).toBe(b.identity.stamped_at);

    const [row] = await ctx.db.select().from(schema.paperSessions).where(eq(schema.paperSessions.id, SESSION_ID));
    const config = row.config as PaperSessionConfigWithIdentity;
    expect(config.qualification_identity).toBeTruthy();
    expect(config.qualification_identity?.stamped_at).toBe(a.identity.stamped_at);
    await ctx.close();
  });

  it("an unrelated concurrent config key survives the first-stamp jsonb_set write", async () => {
    const ctx = await setUp({ sessionConfig: { daily_loss_budget: 500 } });
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");
    const schema = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    // Simulate a concurrent unrelated writer landing between activation's own read and
    // write by mutating the config directly via raw SQL BEFORE calling verifyPaperActivation
    // (jsonb_set's non-clobbering guarantee is what's under test here, not the read-write
    // ordering itself — F-8 above already covers the read/write ordering race).
    await ctx.pg.exec(
      `UPDATE paper_sessions SET config = jsonb_set(config, '{daily_loss_budget}', '750'::jsonb) WHERE id = '${SESSION_ID}'`,
    );

    const result = await verifyPaperActivation(SESSION_ID);
    expect(result.ok).toBe(true);

    const [row] = await ctx.db.select().from(schema.paperSessions).where(eq(schema.paperSessions.id, SESSION_ID));
    const config = row.config as PaperSessionConfigWithIdentity & { daily_loss_budget?: number };
    expect(config.daily_loss_budget).toBe(750); // the unrelated key survived
    expect(config.qualification_identity).toBeTruthy(); // the stamp was still added
    await ctx.close();
  });

  // ── Section 6 — contract: this module never calls startStream() itself ──

  it("verifyPaperActivation never calls startStream — callers own that call", async () => {
    const ctx = await setUp();
    // Mock rather than import the real paper-trading-stream.js: that module imports
    // `logger` from `../index.js`, which drags the entire Express bootstrap graph
    // (routes/, LifecycleService, etc.) into this test — exactly the class of problem
    // audit-log-helper.ts's own header comment documents. The service under test does
    // NOT import paper-trading-stream.js at all (confirmed by its own import list); this
    // mock exists only so the assertion below has a spy to check against.
    const startStreamMock = vi.fn();
    vi.doMock("../services/paper-trading-stream.js", () => ({
      startStream: startStreamMock,
      stopStream: vi.fn(),
      stopAllStreams: vi.fn(),
      getActiveStreams: vi.fn(() => new Map()),
      isStreaming: vi.fn(() => false),
      getBarBuffer: vi.fn(() => []),
      getStreamHealth: vi.fn(),
      runSerializedPerSession: vi.fn((_id: string, fn: () => unknown) => fn()),
    }));
    const { verifyPaperActivation } = await import("../services/paper-qualification-activation-service.js");

    await verifyPaperActivation(SESSION_ID);
    expect(startStreamMock).not.toHaveBeenCalled();

    vi.doUnmock("../services/paper-trading-stream.js");
    await ctx.close();
  });
});
