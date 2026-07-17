/**
 * pending-entry-persistence.ts — M2 determinism + durability (2026-07-17)
 *
 * Durability backstop for paper-signal-service.ts's in-memory `pendingEntryQueue`
 * (a module-level `Map<string, PendingEntry>` at paper-signal-service.ts:673).
 *
 * WHY THIS EXISTS:
 *   A deferred entry (signal fires bar N, fill executes bar N+1 per next-bar
 *   fill parity — see paper-signal-service.ts "FIX 1 (B2 PARITY CRITICAL)") lived
 *   ONLY in-process. A restart (NSSM respawn, tower reboot, deploy) landing in
 *   the window between signal and fill silently dropped the trade with no
 *   record. Under D6/D7 the internal paper engine becomes promotion-evidence
 *   authority, so this is a real evidence hole, not cosmetic.
 *
 * DESIGN:
 *   - The in-memory Map remains the fast-path source of truth for the current
 *     process — every read in paper-signal-service.ts still hits the Map.
 *   - This module is a pure DB-persistence side-channel: enqueue writes a row,
 *     consume (fill or drop) deletes it, session-stop deletes all of a
 *     session's rows, and boot re-hydrates the Map from surviving rows.
 *   - Every function is fail-soft (catches internally, logs, never throws) —
 *     a persistence-layer failure must never block the fast in-memory path,
 *     matching the fire-and-forget pattern used elsewhere in this codebase
 *     for non-blocking audit/observability writes.
 *   - Isolated in its own module (not inlined into paper-signal-service.ts)
 *     so it can be integration-tested against a real PGlite DB without
 *     dragging in paper-signal-service.ts's SSE/kill-switch/Python-subprocess
 *     side-effect graph.
 *
 * Table: paper_pending_entries (migration 0204). Columns mirror the
 * `PendingEntry` TS interface (paper-signal-service.ts:644-671) field-for-field.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { paperPendingEntries } from "../db/schema.js";
import { insertAuditRow } from "./audit-log-helper.js";
import { logger } from "./logger.js";
import type { EntryDecisionContext } from "../db/jsonb-shapes.js";

/**
 * Structural mirror of paper-signal-service.ts's `PendingEntry` interface.
 * Kept as an independent type (not a shared import) so this module has zero
 * compile-time dependency on paper-signal-service.ts — TS structural typing
 * means a real `PendingEntry` object satisfies this shape without any cast.
 */
export interface PersistablePendingEntry {
  sessionId: string;
  symbol: string;
  side: "long" | "short";
  contracts: number;
  orderType: "stop_limit";
  stopLimitOffset: number | undefined;
  rsi: number | undefined;
  atr: number | undefined;
  barVolume: number | undefined;
  medianBarVolume: number | undefined;
  signalBarTimestamp: string;
  correlationId: string | undefined;
  stopMultiplier: number;
  entryContext: EntryDecisionContext | undefined;
  newsReducedAtSignalTime?: boolean;
}

function numOrNull(v: number | undefined): string | null {
  return v != null && Number.isFinite(v) ? String(v) : null;
}

/**
 * Persist a queued deferred entry — idempotent upsert on the
 * (session_id, symbol, signal_bar_timestamp) key. Also clears any STALE row
 * for the same (session_id, symbol) pair first, mirroring the in-memory Map's
 * `.set()` overwrite semantics: only one live pending entry per session+symbol
 * at a time — a new signal on the same session+symbol supersedes the old one.
 *
 * Fire-and-forget from the caller's perspective. Never throws.
 */
export async function persistPendingEntry(entry: PersistablePendingEntry): Promise<void> {
  try {
    const values = {
      sessionId: entry.sessionId,
      symbol: entry.symbol,
      side: entry.side,
      contracts: entry.contracts,
      orderType: entry.orderType,
      stopLimitOffset: numOrNull(entry.stopLimitOffset),
      rsi: numOrNull(entry.rsi),
      atr: numOrNull(entry.atr),
      barVolume: numOrNull(entry.barVolume),
      medianBarVolume: numOrNull(entry.medianBarVolume),
      signalBarTimestamp: entry.signalBarTimestamp,
      correlationId: entry.correlationId ?? null,
      stopMultiplier: String(entry.stopMultiplier),
      entryContext: entry.entryContext ?? null,
      newsReducedAtSignalTime: entry.newsReducedAtSignalTime ?? false,
    };
    await db.transaction(async (tx) => {
      // Clear any stale row for this session+symbol (different signal bar) —
      // mirrors Map.set() overwrite: only the newest signal's entry survives.
      await tx
        .delete(paperPendingEntries)
        .where(
          and(
            eq(paperPendingEntries.sessionId, entry.sessionId),
            eq(paperPendingEntries.symbol, entry.symbol),
          ),
        );
      await tx
        .insert(paperPendingEntries)
        .values(values)
        .onConflictDoUpdate({
          target: [
            paperPendingEntries.sessionId,
            paperPendingEntries.symbol,
            paperPendingEntries.signalBarTimestamp,
          ],
          set: values,
        });
    });
    await insertAuditRow({
      action: "paper.pending_entry_persisted",
      entityType: "paper_session",
      entityId: entry.sessionId,
      decisionAuthority: "system",
      status: "info",
      input: {
        symbol: entry.symbol,
        signalBarTimestamp: entry.signalBarTimestamp,
      } as Record<string, unknown>,
      result: { persisted: true } as Record<string, unknown>,
      correlationId: entry.correlationId ?? null,
    }).catch((err: unknown) =>
      logger.warn({ err }, "paper.pending_entry_persisted audit insert failed (non-blocking)"),
    );
  } catch (err) {
    logger.error(
      { err, sessionId: entry.sessionId, symbol: entry.symbol },
      "persistPendingEntry failed — durability backstop only, in-memory queue unaffected",
    );
  }
}

/** Delete the persisted row for a session+symbol key (fill or drop consume). Never throws. */
export async function deletePendingEntryRow(sessionId: string, symbol: string): Promise<void> {
  try {
    await db
      .delete(paperPendingEntries)
      .where(
        and(
          eq(paperPendingEntries.sessionId, sessionId),
          eq(paperPendingEntries.symbol, symbol),
        ),
      );
  } catch (err) {
    logger.error({ err, sessionId, symbol }, "deletePendingEntryRow failed (non-blocking)");
  }
}

/** Delete all persisted rows for a session (session-stop cleanup). Never throws. */
export async function deleteAllPendingEntriesForSession(sessionId: string): Promise<void> {
  try {
    await db.delete(paperPendingEntries).where(eq(paperPendingEntries.sessionId, sessionId));
  } catch (err) {
    logger.error({ err, sessionId }, "deleteAllPendingEntriesForSession failed (non-blocking)");
  }
}

// Rows older than this many ms are dropped (not re-hydrated) on boot rather
// than filled many bars stale — a "next bar" fill executed hours later would
// violate the fill-parity contract the queue exists to preserve. Generous vs
// normal next-bar latency (minutes): covers a multi-hour outage across a
// session gap without silently re-firing a genuinely abandoned signal.
const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000; // 6h

function resolveStaleMs(): number {
  const raw = process.env.PAPER_PENDING_ENTRY_STALE_MS;
  if (raw == null) return DEFAULT_STALE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_MS;
}

export interface RehydrateResult {
  rehydrated: number;
  droppedStale: number;
}

/**
 * Re-hydrate one session's persisted pending entries. The caller supplies
 * `onRehydrate`, invoked once per surviving row with the reconstructed
 * entry shape — this module has zero knowledge of the caller's Map key
 * format or exact TS type, keeping the coupling one-directional.
 *
 * Never throws — a failure here degrades to the PRE-M2 behavior (row stays
 * un-rehydrated for this boot; still safely re-attempted on the next boot),
 * strictly no worse than before this wave.
 */
export async function rehydratePendingEntriesForSession(
  sessionId: string,
  onRehydrate: (entry: PersistablePendingEntry) => void,
): Promise<RehydrateResult> {
  let rehydrated = 0;
  let droppedStale = 0;
  try {
    const rows = await db
      .select()
      .from(paperPendingEntries)
      .where(eq(paperPendingEntries.sessionId, sessionId));

    const staleMs = resolveStaleMs();
    const now = Date.now();

    for (const row of rows) {
      const signalMs = Date.parse(row.signalBarTimestamp);
      const isStale = !Number.isFinite(signalMs) || now - signalMs > staleMs;

      if (isStale) {
        droppedStale++;
        await db
          .delete(paperPendingEntries)
          .where(eq(paperPendingEntries.id, row.id))
          .catch((err: unknown) =>
            logger.error({ err, sessionId, rowId: row.id }, "Failed to delete stale pending entry row (non-blocking)"),
          );
        await insertAuditRow({
          action: "paper.pending_entry_dropped_stale",
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          status: "warning",
          input: {
            symbol: row.symbol,
            signalBarTimestamp: row.signalBarTimestamp,
          } as Record<string, unknown>,
          result: { dropped: true, reason: "stale_on_rehydrate" } as Record<string, unknown>,
          correlationId: row.correlationId ?? null,
        }).catch((err: unknown) =>
          logger.warn({ err }, "paper.pending_entry_dropped_stale audit insert failed (non-blocking)"),
        );
        continue;
      }

      onRehydrate({
        sessionId: row.sessionId,
        symbol: row.symbol,
        side: row.side as "long" | "short",
        contracts: row.contracts,
        orderType: row.orderType as "stop_limit",
        stopLimitOffset: row.stopLimitOffset != null ? Number(row.stopLimitOffset) : undefined,
        rsi: row.rsi != null ? Number(row.rsi) : undefined,
        atr: row.atr != null ? Number(row.atr) : undefined,
        barVolume: row.barVolume != null ? Number(row.barVolume) : undefined,
        medianBarVolume: row.medianBarVolume != null ? Number(row.medianBarVolume) : undefined,
        signalBarTimestamp: row.signalBarTimestamp,
        correlationId: row.correlationId ?? undefined,
        stopMultiplier: Number(row.stopMultiplier),
        entryContext: (row.entryContext ?? undefined) as EntryDecisionContext | undefined,
        newsReducedAtSignalTime: row.newsReducedAtSignalTime ?? false,
      });
      rehydrated++;

      await insertAuditRow({
        action: "paper.pending_entry_rehydrated",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        status: "info",
        input: {
          symbol: row.symbol,
          signalBarTimestamp: row.signalBarTimestamp,
        } as Record<string, unknown>,
        result: { rehydrated: true } as Record<string, unknown>,
        correlationId: row.correlationId ?? null,
      }).catch((err: unknown) =>
        logger.warn({ err }, "paper.pending_entry_rehydrated audit insert failed (non-blocking)"),
      );
    }
  } catch (err) {
    logger.error(
      { err, sessionId },
      "rehydratePendingEntriesForSession failed — pending entries for this session NOT re-hydrated this boot (fail-soft, no worse than pre-M2 drop behavior)",
    );
  }
  return { rehydrated, droppedStale };
}
