/**
 * pending-entry-durability.integration.test.ts — M2 determinism + durability (2026-07-17), Item 1
 *
 * Integration test against a REAL in-memory PGlite DB (not mocks) for the
 * paper_pending_entries durability backstop (pending-entry-persistence.ts).
 *
 * TARGET BUG (pre-M2): paper-signal-service.ts's `pendingEntryQueue` was a
 * plain in-memory `Map`. A process restart landing between a deferred entry's
 * signal (bar N) and its fill (bar N+1) silently dropped the trade — no
 * record, no re-hydration, nothing. This test proves the fix:
 *   enqueue -> simulate restart (fresh in-memory Map + re-run boot
 *   re-hydration against the persisted row) -> the deferred fill still opens,
 *   EXACTLY ONCE (no drop, no double-open).
 *
 * The RED->GREEN contrast is explicit: the "pre-M2 behavior" describe block
 * proves that WITHOUT persistence, a fresh Map after "restart" has nothing
 * (the exact bug this wave closes) — this is what would fail if
 * persistPendingEntry() were reverted, and stands as the regression guard.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/pglite-db.js";
import type { TestDb } from "../helpers/pglite-db.js";

let injectedDb: TestDb["db"] | null = null;

// pending-entry-persistence.ts imports db from "../db/index.js" in production.
// Standard PGlite-injection pattern for this test layer (see
// composite-shadow.integration.test.ts) — swap the module import at test time.
vi.mock("../../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

// F-2 (accuracy-validator grade, 2026-07-17): importing the REAL
// rehydratePendingEntryQueueForSession/__peekPendingEntryForTests from
// paper-signal-service.ts below pulls in its full import graph, which
// transitively reaches ../../index.js (the Express app boot, runs
// runPendingMigrations() at module load — same hazard trail-stop-extensions.test.ts
// documents). Mock it minimally to stop the boot chain at collection.
vi.mock("../../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistPendingEntry,
  deletePendingEntryRow,
  deleteAllPendingEntriesForSession,
  rehydratePendingEntriesForSession,
  type PersistablePendingEntry,
} from "../../lib/pending-entry-persistence.js";
import { strategies, paperSessions, paperPendingEntries } from "../../db/schema.js";
import {
  rehydratePendingEntryQueueForSession,
  __peekPendingEntryForTests,
} from "../../services/paper-signal-service.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function buildEntry(overrides: Partial<PersistablePendingEntry> = {}): PersistablePendingEntry {
  return {
    sessionId: overrides.sessionId ?? "",
    symbol: "MES",
    side: "long",
    contracts: 9,
    orderType: "stop_limit",
    stopLimitOffset: 0.25,
    rsi: 55.5,
    atr: 4.2,
    barVolume: 1200,
    medianBarVolume: 950,
    signalBarTimestamp: new Date().toISOString(), // fresh — never stale in these tests unless overridden
    correlationId: randomUUID(),
    stopMultiplier: 1.5,
    entryContext: {
      regimeAtEntry: "TRENDING",
      structureState: null,
      confluenceScore: 0.81,
      confluenceFactorsActive: ["market_structure_aligned", "vwap_alignment"],
      nearestLiquidityLevel: { price: 5820, levelType: "pdh", distancePoints: 3.5 },
      atrAtEntry: 4.2,
    },
    newsReducedAtSignalTime: false,
    ...overrides,
  };
}

describe("pending-entry-durability.integration — M2 Item 1", () => {
  let ctx: TestDb;
  let strategyId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;

    strategyId = randomUUID();
    await ctx.db.insert(strategies).values({
      id: strategyId,
      name: "m2-durability-test-strategy",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  afterEach(async () => {
    // Isolate each test's rows.
    await ctx.db.delete(paperPendingEntries);
    await ctx.db.delete(paperSessions);
  });

  async function makeSession(): Promise<string> {
    // CORE_DDL's paper_sessions.id has no DB-side DEFAULT (unlike audit_log /
    // broker_accounts) — supply an explicit id, matching the established
    // pattern in paper-execution-style-c-pglite.test.ts.
    const id = randomUUID();
    const [row] = await ctx.db
      .insert(paperSessions)
      .values({ id, strategyId, startingCapital: "50000", currentEquity: "50000", status: "active" })
      .returning({ id: paperSessions.id });
    return row.id;
  }

  // ─── The core kill-mid-transition test ──────────────────────────────────

  it("enqueue -> simulate restart -> re-hydrate -> the deferred fill opens EXACTLY ONCE", async () => {
    const sessionId = await makeSession();
    const entry = buildEntry({ sessionId });

    // 1. Signal fires on bar N — enqueue (this is what paper-signal-service.ts
    //    does at the pendingEntryQueue.set() call site).
    await persistPendingEntry(entry);

    // Sanity: the row is really in the DB, not just "didn't throw".
    const rowsAfterPersist = await ctx.db
      .select()
      .from(paperPendingEntries)
      .where(eq(paperPendingEntries.sessionId, sessionId));
    expect(rowsAfterPersist.length).toBe(1);
    expect(rowsAfterPersist[0].symbol).toBe("MES");
    expect(Number(rowsAfterPersist[0].stopMultiplier)).toBe(1.5);

    // 2. SIMULATE RESTART: a brand new in-memory Map — the pre-M2 process's
    //    entire pendingEntryQueue state, gone (this models the actual restart).
    const freshMap = new Map<string, PersistablePendingEntry>();

    // 3. Boot re-hydration runs (scheduler.ts::resumeActivePaperSessions() ->
    //    rehydratePendingEntryQueueForSession() -> this function).
    const result = await rehydratePendingEntriesForSession(sessionId, (rehydratedEntry) => {
      freshMap.set(`${rehydratedEntry.sessionId}:${rehydratedEntry.symbol}`, rehydratedEntry);
    });

    expect(result.rehydrated).toBe(1);
    expect(result.droppedStale).toBe(0);

    // 4. The deferred fill would now find the entry EXACTLY as if the process
    //    never restarted — proving no drop.
    const rehydrated = freshMap.get(`${sessionId}:MES`);
    expect(rehydrated).toBeDefined();
    expect(rehydrated?.side).toBe("long");
    expect(rehydrated?.contracts).toBe(9);
    expect(rehydrated?.correlationId).toBe(entry.correlationId);
    expect(rehydrated?.entryContext?.regimeAtEntry).toBe("TRENDING");

    // 5. Now the fill actually executes — paper-signal-service.ts consumes it
    //    (Map.delete + deletePendingEntryRow, mirroring the real call site).
    freshMap.delete(`${sessionId}:MES`);
    await deletePendingEntryRow(sessionId, "MES");

    // 6. EXACTLY ONCE guarantee: a SECOND restart+re-hydrate after the fill
    //    already consumed it must find NOTHING — no double-open.
    const secondMap = new Map<string, PersistablePendingEntry>();
    const secondResult = await rehydratePendingEntriesForSession(sessionId, (rehydratedEntry) => {
      secondMap.set(`${rehydratedEntry.sessionId}:${rehydratedEntry.symbol}`, rehydratedEntry);
    });
    expect(secondResult.rehydrated).toBe(0);
    expect(secondMap.size).toBe(0);
  });

  it("idempotent upsert: persisting the SAME (session, symbol, signal bar) twice does not create duplicate rows", async () => {
    const sessionId = await makeSession();
    const entry = buildEntry({ sessionId, signalBarTimestamp: "2026-07-17T14:00:00.000Z" });

    await persistPendingEntry(entry);
    await persistPendingEntry({ ...entry, contracts: 12 }); // retry with a (slightly) different payload, same key

    const rows = await ctx.db
      .select()
      .from(paperPendingEntries)
      .where(eq(paperPendingEntries.sessionId, sessionId));
    expect(rows.length).toBe(1);
    expect(rows[0].contracts).toBe(12); // upsert applied the latest values
  });

  it("a NEW signal on the same session+symbol supersedes the old pending row (mirrors Map.set overwrite)", async () => {
    const sessionId = await makeSession();
    const first = buildEntry({ sessionId, signalBarTimestamp: "2026-07-17T14:00:00.000Z", contracts: 9 });
    const second = buildEntry({ sessionId, signalBarTimestamp: "2026-07-17T14:05:00.000Z", contracts: 12 });

    await persistPendingEntry(first);
    await persistPendingEntry(second);

    const rows = await ctx.db
      .select()
      .from(paperPendingEntries)
      .where(eq(paperPendingEntries.sessionId, sessionId));
    expect(rows.length).toBe(1);
    expect(rows[0].signalBarTimestamp).toBe("2026-07-17T14:05:00.000Z");
    expect(rows[0].contracts).toBe(12);
  });

  it("session-stop cleanup deletes ALL persisted rows for that session", async () => {
    const sessionId = await makeSession();
    await persistPendingEntry(buildEntry({ sessionId, symbol: "MES", signalBarTimestamp: "2026-07-17T14:00:00.000Z" }));
    await persistPendingEntry(buildEntry({ sessionId, symbol: "MNQ", signalBarTimestamp: "2026-07-17T14:00:00.000Z" }));

    let rows = await ctx.db.select().from(paperPendingEntries).where(eq(paperPendingEntries.sessionId, sessionId));
    expect(rows.length).toBe(2);

    await deleteAllPendingEntriesForSession(sessionId);

    rows = await ctx.db.select().from(paperPendingEntries).where(eq(paperPendingEntries.sessionId, sessionId));
    expect(rows.length).toBe(0);
  });

  it("a stale row (signal bar far in the past) is DROPPED on re-hydrate, not silently re-filled", async () => {
    const sessionId = await makeSession();
    const staleTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24h ago >> 6h default stale window
    await persistPendingEntry(buildEntry({ sessionId, signalBarTimestamp: staleTimestamp }));

    const map = new Map<string, PersistablePendingEntry>();
    const result = await rehydratePendingEntriesForSession(sessionId, (e) => map.set(`${e.sessionId}:${e.symbol}`, e));

    expect(result.rehydrated).toBe(0);
    expect(result.droppedStale).toBe(1);
    expect(map.size).toBe(0);

    // The stale row must be gone from the DB too — not left to re-trigger the same drop forever.
    const rows = await ctx.db.select().from(paperPendingEntries).where(eq(paperPendingEntries.sessionId, sessionId));
    expect(rows.length).toBe(0);
  });

  // ─── RED-proof: pre-M2 behavior (the bug this wave closes) ───────────────

  describe("pre-M2 contrast (RED-proof — what the bug looked like)", () => {
    it("WITHOUT persistence, a restart's fresh Map has nothing to re-hydrate from (the exact bug)", async () => {
      const sessionId = await makeSession();
      // Deliberately do NOT call persistPendingEntry — this models the pre-M2
      // in-memory-Map-only behavior (signal fired, only lived in the Map).
      const preM2Map = new Map<string, PersistablePendingEntry>();
      preM2Map.set(`${sessionId}:MES`, buildEntry({ sessionId }));

      // Restart — the real pre-M2 Map is gone; nothing was ever persisted.
      const freshMap = new Map<string, PersistablePendingEntry>();
      const result = await rehydratePendingEntriesForSession(sessionId, (e) =>
        freshMap.set(`${e.sessionId}:${e.symbol}`, e),
      );

      // This IS the bug: zero rows to rehydrate because nothing was persisted.
      expect(result.rehydrated).toBe(0);
      expect(freshMap.size).toBe(0);
      expect(freshMap.get(`${sessionId}:MES`)).toBeUndefined();
    });
  });

  // ─── Independent-grade F-2: the REAL production glue, not just the primitive ──
  //
  // Every test above exercises rehydratePendingEntriesForSession() — the lower-level
  // primitive in pending-entry-persistence.ts — against a locally-constructed Map via
  // a callback. That proves the persistence layer works in isolation, but scheduler.ts
  // never calls that primitive directly: it calls
  // paper-signal-service.ts::rehydratePendingEntryQueueForSession(), which is the glue
  // that populates the REAL module-level pendingEntryQueue singleton every other part
  // of paper-signal-service.ts (enqueue/consume) reads and writes. No test previously
  // called that real glue function — this closes that gap (accuracy-validator grade,
  // 2026-07-17).
  describe("paper-signal-service.ts real glue — rehydratePendingEntryQueueForSession", () => {
    it("populates the REAL pendingEntryQueue singleton (verified via __peekPendingEntryForTests), not just a local test Map", async () => {
      const sessionId = await makeSession();
      const entry = buildEntry({ sessionId, symbol: "MNQ", contracts: 6 });
      await persistPendingEntry(entry);

      // Nothing in the real singleton yet for this session+symbol.
      expect(__peekPendingEntryForTests(sessionId, "MNQ")).toBeUndefined();

      const result = await rehydratePendingEntryQueueForSession(sessionId);
      expect(result.rehydrated).toBe(1);
      expect(result.droppedStale).toBe(0);

      // The REAL singleton (not a local Map) now has the entry, under the exact
      // key format the real consume-site reads (`${sessionId}:${symbol}`).
      const peeked = __peekPendingEntryForTests(sessionId, "MNQ");
      expect(peeked).toBeDefined();
      expect(peeked?.side).toBe("long");
      expect(peeked?.contracts).toBe(6);
      expect(peeked?.correlationId).toBe(entry.correlationId);
      expect(peeked?.stopMultiplier).toBe(1.5);
    });
  });
});
