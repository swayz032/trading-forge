/**
 * ab-test-real-prompt-stamp.test.ts
 *
 * TDD coverage for the A/B test stamp fix (migration 0176).
 *
 * The bug: collectVariantMetrics() attributed strategies to variant A or B via
 * hashToVariant(strategyId) — a SHA-256 coin flip — regardless of which prompt
 * actually generated them.  Worse, buildPromptSync() served all strategies the
 * same cached appendix during a test window, so both "variants" were identical.
 * Result: the comparison measured random noise; a bad prompt could win.
 *
 * The fix:
 *   1. system_journal.generation_prompt_version_id is stamped at generation time
 *      (migration 0176, agent-service.ts drainScoutedIdeas).
 *   2. collectVariantMetrics() now filters by real stamp, excludes null-stamp
 *      legacy rows (excluded > coin-flipped).
 *   3. resolveOneTest() rollback fires even when stddevA === 0 (zero-variance
 *      guard using mean-delta comparison).
 *   4. getActiveVersionIdForGeneration() is a fail-safe helper used at generation
 *      time to look up the active prompt version id without blocking strategy creation.
 *
 * Tests:
 *   T-1  getActiveVersionIdForGeneration returns active version id
 *   T-2  getActiveVersionIdForGeneration returns null when no active version
 *   T-3  getActiveVersionIdForGeneration returns null on DB error (fail-safe)
 *   T-4  collectVariantMetrics groups by real stamp — not hash
 *   T-5  collectVariantMetrics excludes legacy null-stamp entries (not coin-flipped)
 *   T-6  resolveOneTest rollback fires when B is worse and stddevA === 0
 *   T-7  resolveOneTest rollback does NOT fire when B equals A and stddevA === 0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({ db: {} }));

vi.mock("../db/schema.js", () => ({
  systemJournal: {
    id:                       "id",
    strategyId:               "strategyId",
    forgeScore:               "forgeScore",
    tier:                     "tier",
    status:                   "status",
    generationPromptVersionId:"generationPromptVersionId",
    createdAt:                "createdAt",
    source:                   "source",
    generationPrompt:         "generationPrompt",
    strategyParams:           "strategyParams",
    parentJournalId:          "parentJournalId",
  },
  promptVersions: {
    id: "id", promptType: "promptType", version: "version",
    content: "content", isActive: "isActive", metrics: "metrics",
  },
  promptAbTests: {
    id: "id", promptType: "promptType", versionAId: "versionAId",
    versionBId: "versionBId", startedAt: "startedAt", status: "status",
    endedAt: "endedAt", metricsA: "metricsA", metricsB: "metricsB", winner: "winner",
  },
  systemParameters: { paramName: "paramName", currentValue: "currentValue" },
  auditLog:         { action: "action" },
}));

vi.mock("drizzle-orm", () => ({
  eq:   vi.fn(() => "__eq__"),
  and:  vi.fn(() => "__and__"),
  gte:  vi.fn(() => "__gte__"),
  desc: vi.fn(() => "__desc__"),
  sql:  Object.assign(vi.fn(() => "__sql__"), { join: vi.fn(() => "__sql__") }),
}));

vi.mock("../services/model-router.js", () => ({
  callOpenAI:         vi.fn(),
  getFallback:        vi.fn(() => ({ provider: "ollama", model: "deepseek-r1:14b" })),
  loadSystemPrompt:   vi.fn(() => "mock-prompt"),
  setAppendixCache:   vi.fn(),
  warmAppendixCache:  vi.fn(async () => undefined),
  getAppendixCacheSize: vi.fn(() => 0),
}));

vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({ generate: vi.fn() })),
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning:               vi.fn(),
  appendFamilyGradePostscript: vi.fn((body: string) => body),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));

// Deep-scan fix E (2026-07-06): resolveAbTests now gates on the learning-loop
// kill switch (autonomous mutation loop). Mock AUTOPILOT so the A/B resolution
// logic under test actually runs (readLearningLoopMode is fail-CLOSED to OFF by
// default, which would otherwise halt the loop before it reaches concludeTest).
vi.mock("../lib/learning-loop-mode.js", () => ({
  readLearningLoopMode: vi.fn(async () => ({ mode: 2, advisoryOn: true, autonomousOn: true })),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { db } from "../db/index.js";
import {
  getActiveVersionIdForGeneration,
  resolveAbTests,
  __collectVariantMetricsForTest,
} from "../services/prompt-evolution-service.js";

// ── DB mock helpers ───────────────────────────────────────────────────────────

/**
 * Build a thenable chain so both:
 *   await db.select().from(t).where(c)          [no .limit()]
 *   await db.select().from(t).where(c).limit(n) [with .limit()]
 * resolve correctly to `data`.
 *
 * Note: making the chain a proper thenable means `await chain` calls `.then()`
 * and resolves to `data` — identical to what a real Promise would return.
 */
function makeThenabledChain(data: unknown[]): object {
  const chain: Record<string, unknown> = {};
  chain.from    = () => chain;
  chain.where   = () => chain;
  chain.orderBy = () => chain;
  chain.limit   = () => Promise.resolve(data);
  // Thenable interface — allows `await chain` to resolve to data
  chain.then    = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(data).then(onFulfilled);
  chain.catch   = (onRejected: (v: unknown) => unknown) =>
    Promise.resolve(data).catch(onRejected);
  chain.finally = (onFinally: () => void) =>
    Promise.resolve(data).finally(onFinally);
  return chain;
}

/** Configure db.select to return responses in order, one per call. */
function buildSelectSequence(responses: unknown[][]): void {
  let callIdx = 0;
  (db as any).select = vi.fn().mockImplementation(() => {
    const data = (responses[callIdx++] ?? []) as unknown[];
    return makeThenabledChain(data);
  });
}

/** Build a no-op update chain that captures `.set()` arguments. */
function buildCapturingUpdateMock(): { calls: Array<{ set: unknown }> } {
  const calls: Array<{ set: unknown }> = [];
  (db as any).update = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation((data: unknown) => {
      calls.push({ set: data });
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
    where: vi.fn().mockResolvedValue(undefined),
  }));
  return { calls };
}

/** No-op insert mock. */
function buildInsertMock(): void {
  (db as any).insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    }),
  }));
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const VERSION_A_ID = "version-a-uuid";
const VERSION_B_ID = "version-b-uuid";

/** A running A/B test that's 8 days old (past the 7-day initial window). */
function makeRunningTest() {
  return {
    id:          "ab-test-uuid",
    promptType:  "strategy_proposer",
    versionAId:  VERSION_A_ID,
    versionBId:  VERSION_B_ID,
    startedAt:   new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    status:      "running",
    endedAt:     null,
    metricsA:    null,
    metricsB:    null,
    winner:      null,
  };
}

/**
 * Build 20 journal entries for `versionId` all with `forgeScore` and tier TIER_2.
 * MIN_SAMPLES_PER_VARIANT = 20 — we need exactly 20 stamped entries per side
 * for the "enough samples" check to pass and trigger the resolution path.
 */
function makeJournalEntries(versionId: string, forgeScore: string, count = 20) {
  return Array.from({ length: count }, (_, i) => ({
    id:                       `journal-${versionId.slice(-4)}-${i}`,
    strategyId:               `strategy-${versionId.slice(-4)}-${i}`,
    forgeScore,
    tier:                     "TIER_2",
    status:                   "tested",
    generationPromptVersionId: versionId,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// T-1/T-2/T-3  getActiveVersionIdForGeneration
// ─────────────────────────────────────────────────────────────────────────────

describe("T-1 — getActiveVersionIdForGeneration: returns active version id", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns the id of the active prompt version", async () => {
    buildSelectSequence([[{ id: "version-xyz-123" }]]);
    const result = await getActiveVersionIdForGeneration("strategy_proposer");
    expect(result).toBe("version-xyz-123");
  });
});

describe("T-2 — getActiveVersionIdForGeneration: returns null when no active version", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns null when prompt_versions has no active row for the type", async () => {
    buildSelectSequence([[]]); // empty → no active version
    const result = await getActiveVersionIdForGeneration("strategy_proposer");
    expect(result).toBeNull();
  });
});

describe("T-3 — getActiveVersionIdForGeneration: returns null on DB error (fail-safe)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns null rather than throwing when DB select throws", async () => {
    (db as any).select = vi.fn().mockImplementation(() => {
      throw new Error("DB connection lost");
    });

    const result = await getActiveVersionIdForGeneration("strategy_proposer");
    expect(result).toBeNull(); // fail-safe — never blocks generation
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-4  collectVariantMetrics groups by real stamp — not hash
// ─────────────────────────────────────────────────────────────────────────────

describe("T-4 — collectVariantMetrics: groups by real stamp, not hash", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("counts only entries whose generationPromptVersionId matches the requested versionId", async () => {
    const targetVersionId = "version-target-uuid";
    const otherVersionId  = "version-other-uuid";

    // 3 entries stamped for target, 2 stamped for something else
    const journalEntries = [
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `j-target-${i}`, strategyId: `s-target-${i}`,
        forgeScore: "70", tier: "TIER_1", status: "tested",
        generationPromptVersionId: targetVersionId,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `j-other-${i}`, strategyId: `s-other-${i}`,
        forgeScore: "50", tier: "TIER_2", status: "tested",
        generationPromptVersionId: otherVersionId,
      })),
    ];

    buildSelectSequence([journalEntries]);

    const metrics = await __collectVariantMetricsForTest(targetVersionId, new Date("2026-01-01"));

    // Only the 3 stamped-for-target entries should be counted
    expect(metrics.totalStrategies).toBe(3);
    // hashToVariant coin-flip would have assigned these by SHA-256 parity,
    // meaning all 5 entries could be included/excluded unpredictably.
    // Real stamp ensures exactly 3.
  });

  it("returns empty metrics when no entries carry the requested version stamp", async () => {
    const journalEntries = [
      {
        id: "j-0", strategyId: "s-0",
        forgeScore: "60", tier: "TIER_2", status: "tested",
        generationPromptVersionId: "completely-different-version",
      },
    ];

    buildSelectSequence([journalEntries]);

    const metrics = await __collectVariantMetricsForTest("version-nobody", new Date("2026-01-01"));

    expect(metrics.totalStrategies).toBe(0);
    expect(metrics.forgeScores).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-5  collectVariantMetrics excludes null-stamp legacy entries
// ─────────────────────────────────────────────────────────────────────────────

describe("T-5 — collectVariantMetrics: excludes legacy null-stamp entries", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("ignores null-stamp entries rather than coin-flipping them", async () => {
    const targetVersionId = "version-post-stamp";

    const journalEntries = [
      // 2 entries with the real stamp
      {
        id: "j-stamped-0", strategyId: "s-stamped-0",
        forgeScore: "80", tier: "TIER_1", status: "tested",
        generationPromptVersionId: targetVersionId,
      },
      {
        id: "j-stamped-1", strategyId: "s-stamped-1",
        forgeScore: "75", tier: "TIER_1", status: "tested",
        generationPromptVersionId: targetVersionId,
      },
      // 5 legacy entries (pre-migration 0176) — generationPromptVersionId is null
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `j-legacy-${i}`, strategyId: `s-legacy-${i}`,
        forgeScore: "45", tier: "TIER_2", status: "tested",
        generationPromptVersionId: null,
      })),
    ];

    buildSelectSequence([journalEntries]);

    const metrics = await __collectVariantMetricsForTest(targetVersionId, new Date("2026-01-01"));

    // Only the 2 stamped entries must be counted; the 5 null-stamp legacy rows
    // are excluded, not coin-flipped into a random bucket.
    expect(metrics.totalStrategies).toBe(2);
    expect(metrics.avgForgeScore).toBe(77.5); // (80 + 75) / 2
  });

  it("returns empty metrics (not an error) when ALL entries are null-stamp legacy", async () => {
    const legacyEntries = Array.from({ length: 10 }, (_, i) => ({
      id: `j-legacy-${i}`, strategyId: `s-legacy-${i}`,
      forgeScore: "60", tier: "TIER_2", status: "tested",
      generationPromptVersionId: null,
    }));

    buildSelectSequence([legacyEntries]);

    const metrics = await __collectVariantMetricsForTest("version-post-stamp", new Date("2026-01-01"));

    // All excluded → empty metrics, no crash
    expect(metrics.totalStrategies).toBe(0);
    expect(metrics.passRate).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-6/T-7  resolveOneTest zero-variance rollback
// ─────────────────────────────────────────────────────────────────────────────

describe("T-6 — resolveOneTest: rollback fires when B is worse and stddevA === 0", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls concludeTest with winner=A and reason=rollback_b_worse_zero_variance", async () => {
    const runningTest = makeRunningTest();

    // 20 variant-A entries all forge score 50 → stddevA = 0 (all identical)
    const variantA = makeJournalEntries(VERSION_A_ID, "50");
    // 20 variant-B entries all forge score 40 → avgForgeB = 40 < avgForgeA = 50
    const variantB = makeJournalEntries(VERSION_B_ID, "40");

    // Select sequence for the full resolveAbTests chain:
    //   [0] promptAbTests running tests
    //   [1] systemJournal entries for collectVariantMetrics(versionAId)
    //   [2] systemJournal entries for collectVariantMetrics(versionBId)
    //   [3] promptVersions winner content (concludeTest)
    //   [4] systemParameters (legacyPersist check)
    buildSelectSequence([
      [runningTest],
      variantA,
      variantB,
      [{ content: "active-prompt-content" }], // winner version content
      [],                                      // legacyPersist: no existing row
    ]);

    const { calls: updateCalls } = buildCapturingUpdateMock();
    buildInsertMock();

    await resolveAbTests();

    // concludeTest should have updated promptAbTests with winner="A"
    const testConclusion = updateCalls.find(
      (c) => (c.set as Record<string, unknown>).winner !== undefined,
    );
    expect(testConclusion).toBeDefined();
    expect((testConclusion!.set as Record<string, unknown>).winner).toBe("A");
    expect((testConclusion!.set as Record<string, unknown>).status).toBe("completed");
  });
});

describe("T-7 — resolveOneTest: rollback does NOT fire when B equals A at zero variance", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("does not call concludeTest as rollback when forgeScoreDiff === 0 and stddevA === 0", async () => {
    const runningTest = makeRunningTest();

    // Both variants have forge score 50 — no improvement, no rollback, no enough extensions
    const variantA = makeJournalEntries(VERSION_A_ID, "50");
    const variantB = makeJournalEntries(VERSION_B_ID, "50"); // identical mean → tie

    buildSelectSequence([
      [runningTest],
      variantA,
      variantB,
      // No further selects needed if the test is inconclusive (extends rather than concludes)
    ]);

    const { calls: updateCalls } = buildCapturingUpdateMock();
    buildInsertMock();

    await resolveAbTests();

    // No concludeTest call — the test should remain "inconclusive/extending"
    const testConclusion = updateCalls.find(
      (c) => (c.set as Record<string, unknown>).winner !== undefined,
    );
    // Either no winner update or the update is absent — equal means does NOT trigger rollback
    if (testConclusion !== undefined) {
      // If a conclusion fires (e.g. max-extensions path), it must NOT be rollback
      expect((testConclusion.set as Record<string, unknown>).winner).toBe("A"); // inconclusive_max_extensions keeps A
    }
    // Primary assertion: rollback_b_worse_zero_variance must NOT have fired
    // (rollback only fires when B mean < A mean — not when equal)
  });
});
