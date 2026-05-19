/**
 * n8n-execution-scraper-service.ts — pulls Railway n8n execution history into
 * the local `n8n_execution_log` table so backend observability (health views,
 * unhealthy-workflow alerts, drift detector, dashboards) has a single
 * authoritative source instead of querying Railway's API on every request.
 *
 * WHY THIS EXISTS:
 *   Pre-Pass-21 n8n was local Docker on the tower; workflows POSTed
 *   `/api/n8n/execution-log` directly. After the Pass 21 Railway migration,
 *   that callback was never re-wired into the 29 workflows. Result: the
 *   `n8n_execution_log` table has been empty for the entire post-migration
 *   window (~5 days as of 2026-05-17), and `/api/n8n/execution-log/health`
 *   reports zero data instead of real workflow health. This service closes
 *   that observability gap by scraping the Railway public API on a cron and
 *   inserting into the same table the route already expects.
 *
 * DEDUPE:
 *   Migration 0107 adds a partial unique index on `execution_id WHERE
 *   execution_id IS NOT NULL`. Inserts use `ON CONFLICT DO NOTHING` so the
 *   scraper is fully idempotent — re-runs on overlapping windows insert zero
 *   rows.
 *
 * NEW-FAILURE BROADCAST:
 *   Newly-inserted rows whose status is "failed"/"error" emit the same
 *   `n8n:workflow-failed` SSE event the existing POST route emits — so
 *   dashboards subscribed to that event get the same signal whether the
 *   source was a (legacy) workflow callback or this scraper.
 *
 * AUDIT TRAIL:
 *   Each cycle writes one `n8n.execution_log.scraped` audit_log row via
 *   `insertAuditRow()` with `correlationId = cycleId` so an operator can
 *   reconstruct what the scraper saw + wrote in any given tick. Empty
 *   cycles (no new executions) are NOT logged — only cycles that wrote.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { n8nExecutionLog } from "../db/schema.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";

/** Shape of one execution returned by Railway n8n REST API. */
interface RailwayExecution {
  id: string;
  workflowId: string;
  status?: string;
  finished?: boolean;
  mode?: string;
  startedAt?: string;
  stoppedAt?: string;
}

/** Shape of /api/v1/workflows response (we only need id → name). */
interface RailwayWorkflow {
  id: string;
  name: string;
}

interface ScrapeResult {
  cycleId: string;
  fetched: number;
  inserted: number;
  skipped: number;
  newFailures: number;
  errors: string[];
}

const RAILWAY_FETCH_LIMIT = 100; // covers 5-min cadence at the busiest workflow rates
const RAILWAY_HTTP_TIMEOUT_MS = 15_000;

/**
 * One scrape cycle: fetch latest executions from Railway, dedupe-insert new
 * rows, broadcast SSE for any new failures, write one audit_log summary row.
 */
export async function runN8nExecutionScrape(): Promise<ScrapeResult> {
  const cycleId = randomUUID();
  const baseUrl = process.env.N8N_BASE_URL;
  const apiKey = process.env.TF_N8N_API_KEY ?? process.env.RAILWAY_N8N_API_KEY;
  const result: ScrapeResult = {
    cycleId,
    fetched: 0,
    inserted: 0,
    skipped: 0,
    newFailures: 0,
    errors: [],
  };

  if (!baseUrl || !apiKey) {
    // Disabled mode — no env, no work. NOT an error; matches the
    // `/api/health` "disabled" pattern for missing-config.
    return result;
  }

  // 1) Pull executions + workflow-id→name map in parallel.
  let executions: RailwayExecution[];
  let workflowNames: Map<string, string>;
  try {
    const [execRes, wfRes] = await Promise.all([
      fetch(`${baseUrl}/api/v1/executions?limit=${RAILWAY_FETCH_LIMIT}`, {
        headers: { "X-N8N-API-KEY": apiKey },
        signal: AbortSignal.timeout(RAILWAY_HTTP_TIMEOUT_MS),
      }),
      fetch(`${baseUrl}/api/v1/workflows?active=true`, {
        headers: { "X-N8N-API-KEY": apiKey },
        signal: AbortSignal.timeout(RAILWAY_HTTP_TIMEOUT_MS),
      }),
    ]);

    if (!execRes.ok) throw new Error(`executions HTTP ${execRes.status}`);
    if (!wfRes.ok) throw new Error(`workflows HTTP ${wfRes.status}`);

    const execBody = await execRes.json() as { data?: RailwayExecution[] };
    const wfBody = await wfRes.json() as { data?: RailwayWorkflow[] };
    executions = execBody.data ?? [];
    workflowNames = new Map((wfBody.data ?? []).map((w) => [w.id, w.name]));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`fetch_failed: ${msg}`);
    logger.warn({ cycleId, err }, "n8n-execution-scrape: fetch failed");
    return result;
  }

  result.fetched = executions.length;
  if (executions.length === 0) return result;

  // 2) Insert each row with ON CONFLICT DO NOTHING. We do per-row inserts
  //    rather than a bulk values list so that `RETURNING` accurately tells
  //    us which rows were newly written (vs deduped).
  for (const e of executions) {
    if (!e.id) continue;
    const workflowName = workflowNames.get(e.workflowId) ?? e.workflowId;
    const status = normalizeStatus(e);
    const startedAt = e.startedAt ? new Date(e.startedAt) : null;
    const finishedAt = e.stoppedAt ? new Date(e.stoppedAt) : null;
    const durationMs =
      startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;

    try {
      const inserted = await db
        .insert(n8nExecutionLog)
        .values({
          workflowId: e.workflowId,
          workflowName,
          executionId: e.id,
          status,
          startedAt: startedAt ?? undefined,
          finishedAt: finishedAt ?? undefined,
          durationMs: durationMs ?? undefined,
          triggerType: e.mode ?? null,
          metadata: { source: "railway_scraper", cycleId },
        })
        .onConflictDoNothing({ target: n8nExecutionLog.executionId })
        .returning({ id: n8nExecutionLog.id });

      if (inserted.length > 0) {
        result.inserted += 1;
        if (status === "failed" || status === "error") {
          result.newFailures += 1;
          broadcastSSE("n8n:workflow-failed", {
            workflowName,
            executionId: e.id,
            errorMessage: null,
          });
        }
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`insert_failed: ${e.id}: ${msg}`);
    }
  }

  // 3) Audit trail — only when we wrote at least one row, to avoid filling
  //    audit_log with no-op cycle entries.
  if (result.inserted > 0) {
    await insertAuditRow({
      action: "n8n.execution_log.scraped",
      entityType: "n8n_execution_log",
      entityId: cycleId,
      status: "success",
      decisionAuthority: "scheduler",
      correlationId: cycleId,
      result: {
        fetched: result.fetched,
        inserted: result.inserted,
        skipped: result.skipped,
        newFailures: result.newFailures,
      },
    }).catch((err) => {
      logger.warn({ cycleId, err }, "n8n-execution-scrape: audit_log insert failed");
    });
  }

  logger.info(
    {
      cycleId,
      fetched: result.fetched,
      inserted: result.inserted,
      newFailures: result.newFailures,
    },
    "n8n-execution-scrape: cycle complete",
  );

  return result;
}

/**
 * Normalize Railway n8n execution status. Railway returns either an explicit
 * `status` enum ("success" | "error" | "running" | …) OR (older versions) a
 * boolean `finished` flag + no status. The local table uses the lowercase
 * strings "success" / "failed" / "running" so the existing
 * `/api/n8n/execution-log/health` query keeps working unchanged.
 */
function normalizeStatus(e: RailwayExecution): string {
  if (e.status) {
    if (e.status === "error") return "failed";
    return e.status;
  }
  if (e.finished === true) return "success";
  if (e.finished === false) return "running";
  return "unknown";
}

// Force-exported for direct invocation by `npx tsx` and admin endpoints.
export const _internal = { normalizeStatus };

// Suppress the unused-import warning if drizzle's `sql` helper is needed by a
// future query; reference it at module scope.
void sql;
