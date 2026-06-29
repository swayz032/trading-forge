/**
 * carter-issues-store.ts — in-memory issue map with fire-and-forget DB persistence.
 *
 * The in-memory map is the primary runtime source of truth.
 * The DB (carter_issues table, migration 0181) is the persistence layer:
 *   - Hydrated at boot via hydrateFromDb() — called once by startCarterIssueWatcher().
 *   - Updated on every upsert/resolve via fire-and-forget DB writes.
 *
 * Design invariants:
 *   - This module NEVER throws to the caller. DB errors are logged and swallowed.
 *   - resolveIssue() is a no-op for unknown issue_key values.
 *   - listOpenIssues() returns open issues sorted by severity (critical first).
 *   - Severity ordering: critical(0) < warning(1) < info(2).
 *
 * Wave 4 backend, 2026-06-28.
 */

import { db } from "../../db/index.js";
import { carterIssues } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IssueSeverity = "critical" | "warning" | "info";

export interface CarterIssue {
  issue_key:    string;
  severity:     IssueSeverity;
  title:        string;
  detail?:      string;
  source_event?: string;
  first_seen:   Date;
  last_seen:    Date;
  resolved:     boolean;
  resolved_at?: Date;
}

export interface UpsertIssueParams {
  issue_key:    string;
  severity:     IssueSeverity;
  title:        string;
  detail?:      string;
  source_event?: string;
}

// ─── In-memory map ────────────────────────────────────────────────────────────

const _issueMap = new Map<string, CarterIssue>();
let _hydrated = false;

// ─── Severity sort order ─────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  critical: 0,
  warning:  1,
  info:     2,
};

// ─── DB persistence (fire-and-forget, fail-soft) ──────────────────────────────

async function _persistUpsert(issue: CarterIssue): Promise<void> {
  try {
    await db
      .insert(carterIssues)
      .values({
        issueKey:    issue.issue_key,
        severity:    issue.severity,
        title:       issue.title,
        detail:      issue.detail ?? null,
        sourceEvent: issue.source_event ?? null,
        firstSeen:   issue.first_seen,
        lastSeen:    issue.last_seen,
        resolved:    false,
        resolvedAt:  null,
      })
      .onConflictDoUpdate({
        target: carterIssues.issueKey,
        set: {
          severity:    issue.severity,
          title:       issue.title,
          detail:      issue.detail ?? null,
          sourceEvent: issue.source_event ?? null,
          lastSeen:    issue.last_seen,
          resolved:    false,
          resolvedAt:  null,
        },
      });
  } catch (err) {
    logger.error(
      { err, issue_key: issue.issue_key },
      "carter-issues-store: DB upsert failed (non-fatal — in-memory map updated)",
    );
  }
}

async function _persistResolve(issue_key: string, resolved_at: Date): Promise<void> {
  try {
    await db
      .update(carterIssues)
      .set({ resolved: true, resolvedAt: resolved_at })
      .where(eq(carterIssues.issueKey, issue_key));
  } catch (err) {
    logger.error(
      { err, issue_key },
      "carter-issues-store: DB resolve failed (non-fatal — in-memory map updated)",
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * upsertIssue — create or update an open issue in the in-memory map and DB.
 *
 * On create: sets first_seen = last_seen = now().
 * On update: preserves first_seen, bumps last_seen to now().
 * Re-opening a resolved issue: clears resolved flag.
 *
 * DB write is fire-and-forget (non-blocking, fail-soft).
 */
export function upsertIssue(params: UpsertIssueParams): void {
  const now = new Date();
  const existing = _issueMap.get(params.issue_key);

  const issue: CarterIssue = {
    issue_key:    params.issue_key,
    severity:     params.severity,
    title:        params.title,
    detail:       params.detail,
    source_event: params.source_event,
    first_seen:   existing?.first_seen ?? now,
    last_seen:    now,
    resolved:     false,
    resolved_at:  undefined,
  };

  _issueMap.set(params.issue_key, issue);

  // Fire-and-forget — errors are caught inside _persistUpsert
  _persistUpsert(issue).catch(() => { /* already logged */ });
}

/**
 * resolveIssue — mark an open issue as resolved in map and DB.
 * No-op when issue_key is not present in the map.
 *
 * DB write is fire-and-forget (non-blocking, fail-soft).
 */
export function resolveIssue(issue_key: string): void {
  const existing = _issueMap.get(issue_key);
  if (!existing) return;

  const now = new Date();
  const resolved: CarterIssue = {
    ...existing,
    resolved:    true,
    resolved_at: now,
    last_seen:   now,
  };
  _issueMap.set(issue_key, resolved);

  // Fire-and-forget — errors are caught inside _persistResolve
  _persistResolve(issue_key, now).catch(() => { /* already logged */ });
}

/**
 * listOpenIssues — returns all currently open (unresolved) issues sorted
 * by severity (critical → warning → info), then by first_seen (oldest first).
 *
 * Returns an empty array before hydrateFromDb() completes — this is safe since
 * the watcher starts hydration before registering the SSE listener.
 */
export function listOpenIssues(): CarterIssue[] {
  const open: CarterIssue[] = [];
  for (const issue of _issueMap.values()) {
    if (!issue.resolved) open.push(issue);
  }
  return open.sort((a, b) => {
    const severityDiff =
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    if (severityDiff !== 0) return severityDiff;
    return a.first_seen.getTime() - b.first_seen.getTime();
  });
}

/**
 * hydrateFromDb — load all unresolved issues from the DB into the in-memory map.
 * Called once at startup by startCarterIssueWatcher().
 *
 * Idempotent: subsequent calls are no-ops (_hydrated guard).
 * Fail-soft: a DB error logs and leaves the map empty (watcher will build it
 * incrementally from SSE events going forward).
 */
export async function hydrateFromDb(): Promise<void> {
  if (_hydrated) return;
  _hydrated = true;
  try {
    const rows = await db
      .select()
      .from(carterIssues)
      .where(eq(carterIssues.resolved, false));

    for (const row of rows) {
      _issueMap.set(row.issueKey, {
        issue_key:    row.issueKey,
        severity:     row.severity as IssueSeverity,
        title:        row.title,
        detail:       row.detail ?? undefined,
        source_event: row.sourceEvent ?? undefined,
        first_seen:   row.firstSeen,
        last_seen:    row.lastSeen,
        resolved:     false,
      });
    }
    logger.info(
      { count: _issueMap.size },
      "carter-issues-store: hydrated from DB",
    );
  } catch (err) {
    logger.error(
      { err },
      "carter-issues-store: DB hydration failed — starting with empty issue map (will rebuild from SSE events)",
    );
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exposed for testing — resets in-memory state. Do NOT call in production. */
export function _resetForTest(): void {
  _issueMap.clear();
  _hydrated = false;
}
