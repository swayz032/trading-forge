/**
 * carter-memory-store.ts — Carter voice-agent continuity store.
 *
 * Persists what Carter learns across calls so the operator never has to repeat
 * themselves. Two layers:
 *   - WRITE: `insertMemory()` (used by the `remember` tool + the post-call webhook).
 *   - READ:  `queryMemories()` (used by the `recall` tool).
 *
 * Both are FAIL-SOFT — DB errors are logged and surfaced as a structured value
 * (insert → null, query → []), never thrown to the caller. Bounded outputs (voice
 * agent): content is capped on write, result set is clamped on read.
 *
 * Two voice-agent handlers live here and are spread into the canonical maps:
 *   - CARTER_MEMORY_ACTION_HANDLERS = { remember }  → CARTER_ACTION_HANDLERS (carter-actions.ts)
 *   - CARTER_MEMORY_READ_HANDLERS   = { recall }    → CARTER_READ_HANDLERS   (carter-reads.ts)
 *
 * Handler keys MUST match the CarterTool.handler field in tool-registry.ts; the
 * contract test enforces parity.
 *
 * Backed by migration 0185 (carter_memory table). logger from leaf ../logger.js.
 */

import { db } from "../../db/index.js";
import { carterMemory } from "../../db/schema.js";
import { desc, eq, ilike, and } from "drizzle-orm";
import { logger } from "../logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Valid `kind` values the voice agent may write via the `remember` tool. */
export const REMEMBER_KINDS = ["decision", "preference", "fact", "open_thread"] as const;
export type RememberKind = (typeof REMEMBER_KINDS)[number];

/** Max content length accepted on write (bounded for a voice agent). */
const MAX_CONTENT_CHARS = 4000;
/** Default + clamp bounds for the recall result set. */
const RECALL_DEFAULT_LIMIT = 10;
const RECALL_MIN_LIMIT = 1;
const RECALL_MAX_LIMIT = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InsertMemoryParams {
  kind: string;
  content: string;
  topic?: string | null;
  correlationId?: string | null;
  source?: string;
}

export interface QueryMemoriesParams {
  topic?: string | null;
  kind?: string | null;
  limit?: number;
}

// ─── Store API ──────────────────────────────────────────────────────────────

/**
 * insertMemory — append one row to carter_memory.
 * Returns the new row id, or null on any DB error (fail-soft, logged).
 */
export async function insertMemory(params: InsertMemoryParams): Promise<number | null> {
  try {
    const rows = await db
      .insert(carterMemory)
      .values({
        kind:          params.kind,
        content:       params.content,
        topic:         params.topic ?? null,
        correlationId: params.correlationId ?? null,
        source:        params.source ?? "voice",
      })
      .returning({ id: carterMemory.id });
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error({ err, kind: params.kind }, "carter-memory-store: insertMemory failed (non-fatal)");
    return null;
  }
}

/**
 * queryMemories — read carter_memory rows newest-first.
 * Optional topic (ILIKE substring) and kind (exact) filters. Bounded by limit.
 * Returns [] on any DB error (fail-soft, logged).
 */
export async function queryMemories(
  params: QueryMemoriesParams,
): Promise<Array<{ id: number; kind: string; topic: string | null; content: string; createdAt: Date }>> {
  const limit = clampLimit(params.limit);
  try {
    const conditions = [];
    if (params.topic && params.topic.trim() !== "") {
      conditions.push(ilike(carterMemory.topic, `%${params.topic.trim()}%`));
    }
    if (params.kind && params.kind.trim() !== "") {
      conditions.push(eq(carterMemory.kind, params.kind.trim()));
    }

    const rows = await db
      .select({
        id:        carterMemory.id,
        kind:      carterMemory.kind,
        topic:     carterMemory.topic,
        content:   carterMemory.content,
        createdAt: carterMemory.createdAt,
      })
      .from(carterMemory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(carterMemory.createdAt))
      .limit(limit);

    return rows;
  } catch (err) {
    logger.error({ err }, "carter-memory-store: queryMemories failed (non-fatal)");
    return [];
  }
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return RECALL_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(n), RECALL_MIN_LIMIT), RECALL_MAX_LIMIT);
}

// ─── Voice-agent handlers ─────────────────────────────────────────────────────

interface RememberParams {
  kind?: string;
  content?: string;
  topic?: string;
}

/**
 * remember (GREEN action) — Carter writes a single memory (source='voice').
 * Validates kind ∈ REMEMBER_KINDS and bounded content. Returns { ok, id }.
 */
async function remember(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as RememberParams;

  const kind = typeof p.kind === "string" ? p.kind.trim() : "";
  if (!(REMEMBER_KINDS as readonly string[]).includes(kind)) {
    return { error: "invalid_kind", allowed: [...REMEMBER_KINDS] };
  }

  const content = typeof p.content === "string" ? p.content.trim() : "";
  if (content === "") {
    return { error: "content_required" };
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return { error: "content_too_long", max: MAX_CONTENT_CHARS, length: content.length };
  }

  const topic = typeof p.topic === "string" && p.topic.trim() !== "" ? p.topic.trim() : null;

  const id = await insertMemory({ kind, content, topic, source: "voice" });
  if (id === null) {
    return { error: "persist_failed" };
  }
  return { ok: true, id };
}

interface RecallParams {
  topic?: string;
  limit?: number;
}

/**
 * recall (GREEN read) — Carter reads back memories, newest first.
 * Optional topic ILIKE filter; limit defaults to 10, clamps 1–30.
 * Returns { count, memories: [{ kind, topic, content, at }] }.
 */
async function recall(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as RecallParams;
  const topic = typeof p.topic === "string" && p.topic.trim() !== "" ? p.topic.trim() : null;

  const rows = await queryMemories({ topic, limit: p.limit });

  return {
    count: rows.length,
    memories: rows.map((r) => ({
      kind:    r.kind,
      topic:   r.topic ?? null,
      content: r.content,
      at:      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
  };
}

// ─── Handler maps ─────────────────────────────────────────────────────────────

/** Spread into CARTER_ACTION_HANDLERS (carter-actions.ts). */
export const CARTER_MEMORY_ACTION_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  remember,
};

/** Spread into CARTER_READ_HANDLERS (carter-reads.ts). */
export const CARTER_MEMORY_READ_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  recall,
};
