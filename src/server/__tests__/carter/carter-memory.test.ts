/**
 * carter-memory.test.ts — unit tests for the Carter continuity store.
 *
 * Covers the two voice-agent handlers (remember / recall) plus the underlying
 * store functions. No network. DB is mocked with a chainable builder so we can
 * assert validation, clamping, fail-soft, and result shape without Postgres.
 */

// ── Hoisted mutable mock state (vi.mock factories are hoisted) ─────────────────
const state = vi.hoisted(() => ({
  insertReturn: [{ id: 1 }] as Array<{ id: number }>,
  insertThrows: false,
  selectRows: [] as Array<Record<string, unknown>>,
  selectThrows: false,
  capturedInsertValues: undefined as unknown,
  capturedLimit: undefined as number | undefined,
}));

vi.mock("../../db/index.js", () => {
  const insertChain = {
    values: (v: unknown) => {
      state.capturedInsertValues = v;
      return {
        returning: () =>
          state.insertThrows ? Promise.reject(new Error("db_down")) : Promise.resolve(state.insertReturn),
      };
    },
  };
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: (n: number) => {
      state.capturedLimit = n;
      return state.selectThrows ? Promise.reject(new Error("db_down")) : Promise.resolve(state.selectRows);
    },
  };
  return {
    db: {
      insert: () => insertChain,
      select: () => selectChain,
    },
  };
});

vi.mock("../../db/schema.js", () => ({
  carterMemory: {
    id: "id", createdAt: "created_at", kind: "kind", topic: "topic",
    content: "content", correlationId: "correlation_id", source: "source",
  },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((c: unknown) => c),
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  ilike: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  and: vi.fn((...args: unknown[]) => args),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  insertMemory,
  queryMemories,
  CARTER_MEMORY_ACTION_HANDLERS,
  CARTER_MEMORY_READ_HANDLERS,
  REMEMBER_KINDS,
} from "../../lib/carter/carter-memory-store.js";

const remember = CARTER_MEMORY_ACTION_HANDLERS.remember!;
const recall = CARTER_MEMORY_READ_HANDLERS.recall!;

beforeEach(() => {
  state.insertReturn = [{ id: 1 }];
  state.insertThrows = false;
  state.selectRows = [];
  state.selectThrows = false;
  state.capturedInsertValues = undefined;
  state.capturedLimit = undefined;
});

// ─── remember validation ──────────────────────────────────────────────────────

describe("remember — validation", () => {
  it("rejects an invalid kind with { error: 'invalid_kind', allowed }", async () => {
    const r = (await remember({ kind: "nonsense", content: "hi" })) as Record<string, unknown>;
    expect(r.error).toBe("invalid_kind");
    expect(r.allowed).toEqual([...REMEMBER_KINDS]);
    expect(state.capturedInsertValues).toBeUndefined(); // never touched DB
  });

  it("rejects a missing/empty content with content_required", async () => {
    const r1 = (await remember({ kind: "fact" })) as Record<string, unknown>;
    expect(r1.error).toBe("content_required");
    const r2 = (await remember({ kind: "fact", content: "   " })) as Record<string, unknown>;
    expect(r2.error).toBe("content_required");
    expect(state.capturedInsertValues).toBeUndefined();
  });

  it("rejects oversized content (> 4000 chars) with content_too_long", async () => {
    const big = "x".repeat(4001);
    const r = (await remember({ kind: "decision", content: big })) as Record<string, unknown>;
    expect(r.error).toBe("content_too_long");
    expect(r.max).toBe(4000);
    expect(state.capturedInsertValues).toBeUndefined();
  });

  it("accepts each valid kind and returns { ok, id }", async () => {
    for (const kind of REMEMBER_KINDS) {
      state.insertReturn = [{ id: 99 }];
      const r = (await remember({ kind, content: "remember this", topic: "sizing" })) as Record<string, unknown>;
      expect(r.ok).toBe(true);
      expect(r.id).toBe(99);
    }
    // source defaults to 'voice'; topic threaded through
    const vals = state.capturedInsertValues as Record<string, unknown>;
    expect(vals.source).toBe("voice");
    expect(vals.topic).toBe("sizing");
  });

  it("returns persist_failed when the insert fails (fail-soft)", async () => {
    state.insertThrows = true;
    const r = (await remember({ kind: "fact", content: "boom" })) as Record<string, unknown>;
    expect(r.error).toBe("persist_failed");
  });
});

// ─── recall clamping + shape ──────────────────────────────────────────────────

describe("recall — clamping + shape", () => {
  it("defaults the limit to 10 when not provided", async () => {
    await recall({});
    expect(state.capturedLimit).toBe(10);
  });

  it("clamps limit to the 1–30 range", async () => {
    await recall({ limit: 999 });
    expect(state.capturedLimit).toBe(30);
    await recall({ limit: -5 });
    expect(state.capturedLimit).toBe(1);
    await recall({ limit: 7 });
    expect(state.capturedLimit).toBe(7);
  });

  it("returns { count, memories: [{ kind, topic, content, at }] } newest-first shape", async () => {
    const now = new Date("2026-06-29T12:00:00.000Z");
    state.selectRows = [
      { id: 2, kind: "preference", topic: "ui", content: "emerald theme", createdAt: now },
      { id: 1, kind: "fact", topic: null, content: "topstep primary", createdAt: now },
    ];
    const r = (await recall({ topic: "ui" })) as { count: number; memories: Array<Record<string, unknown>> };
    expect(r.count).toBe(2);
    expect(r.memories[0]).toEqual({
      kind: "preference",
      topic: "ui",
      content: "emerald theme",
      at: now.toISOString(),
    });
    expect(r.memories[1].topic).toBeNull();
  });

  it("returns an empty result set fail-soft when the query throws", async () => {
    state.selectThrows = true;
    const r = (await recall({})) as { count: number; memories: unknown[] };
    expect(r.count).toBe(0);
    expect(r.memories).toEqual([]);
  });
});

// ─── store functions directly ─────────────────────────────────────────────────

describe("insertMemory / queryMemories — store layer", () => {
  it("insertMemory returns the new id and stamps defaults", async () => {
    state.insertReturn = [{ id: 555 }];
    const id = await insertMemory({ kind: "call_summary", content: "operator checked in", source: "webhook" });
    expect(id).toBe(555);
    const vals = state.capturedInsertValues as Record<string, unknown>;
    expect(vals.source).toBe("webhook");
    expect(vals.correlationId).toBeNull();
  });

  it("insertMemory returns null on DB error (fail-soft)", async () => {
    state.insertThrows = true;
    const id = await insertMemory({ kind: "fact", content: "x" });
    expect(id).toBeNull();
  });

  it("queryMemories returns [] on DB error (fail-soft)", async () => {
    state.selectThrows = true;
    const rows = await queryMemories({ limit: 5 });
    expect(rows).toEqual([]);
  });
});
