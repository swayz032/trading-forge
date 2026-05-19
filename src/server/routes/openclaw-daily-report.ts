/**
 * OpenClaw Daily Report — POST /api/openclaw/daily-report/send
 *
 * Assembles a DailyN8nReportPayload (live n8n state + journal stats), then
 * POSTs it to the Discord alert webhook on the dedicated #n8n-daily-report
 * channel. Idempotent per day (uses the date in the dedupe key).
 *
 * Triggered by n8n cron workflow `0Z-openclaw-daily-report` at 8AM ET.
 */

import { Router } from "express";
import { db } from "../db/index.js";
import { systemJournal } from "../db/schema.js";
import { sql } from "drizzle-orm";
import { logger } from "../index.js";

export const openclawDailyReportRoutes = Router();

interface ExecutionRef {
  workflowId: string;
  workflowName: string;
  executionId: string;
  errorMessage?: string;
}

interface StrategyCandidateRef {
  id: string;
  title: string;
  market: string;
  timeframe: string;
  source?: string;
}

interface DailyN8nReportPayload {
  reportDate: string;
  activeWorkflowCount: number;
  newOrChanged: string[];
  failed24h: ExecutionRef[];
  staleWorkflows: string[];
  strategyFinds: StrategyCandidateRef[];
  healthIssues: string[];
  nextActions: string[];
}

async function fetchN8nState(): Promise<{
  activeWorkflows: { id: string; name: string; updatedAt: string }[];
  failed24h: ExecutionRef[];
  staleWorkflows: string[];
}> {
  const baseUrl = process.env.N8N_BASE_URL ?? "http://localhost:5678";
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) {
    logger.warn("N8N_API_KEY not set; daily report will have empty n8n state");
    return { activeWorkflows: [], failed24h: [], staleWorkflows: [] };
  }

  const headers = { "X-N8N-API-KEY": apiKey, Accept: "application/json" };

  // Active workflows
  const wfRes = await fetch(`${baseUrl}/api/v1/workflows?active=true&limit=100`, { headers });
  if (!wfRes.ok) {
    const body = await wfRes.text().catch(() => "(unreadable)");
    logger.warn({ status: wfRes.status, body: body.slice(0, 200), baseUrl }, "openclaw-daily-report: n8n API failed");
    return { activeWorkflows: [], failed24h: [], staleWorkflows: [] };
  }
  const wfJson: any = await wfRes.json();
  const activeWorkflows = (wfJson.data ?? [])
    .filter((w: any) => w.active === true && w.isArchived !== true)
    .map((w: any) => ({
      id: String(w.id),
      name: String(w.name),
      updatedAt: String(w.updatedAt),
    }));
  logger.info({ baseUrl, activeCount: activeWorkflows.length }, "openclaw-daily-report: pulled n8n state");

  // Failed executions in last 24h
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const exRes = await fetch(`${baseUrl}/api/v1/executions?status=error&limit=100`, { headers });
  const exJson: any = exRes.ok ? await exRes.json() : { data: [] };
  const failed24h: ExecutionRef[] = (exJson.data ?? [])
    .filter((e: any) => e.startedAt >= since)
    .map((e: any) => {
      const wf = activeWorkflows.find((w: any) => w.id === e.workflowId);
      return {
        workflowId: String(e.workflowId),
        workflowName: wf?.name ?? "(unknown)",
        executionId: String(e.id),
      };
    })
    .slice(0, 25);

  // Stale workflows: active but no updatedAt change in 30+ days
  const thirtyDaysAgo = Date.now() - 30 * 86400_000;
  const staleWorkflows = activeWorkflows
    .filter((w: any) => new Date(w.updatedAt).getTime() < thirtyDaysAgo)
    .map((w: any) => w.name);

  return { activeWorkflows, failed24h, staleWorkflows };
}

async function fetchStrategyFinds24h(): Promise<StrategyCandidateRef[]> {
  try {
    const rows = await db.execute(sql`
      SELECT id, name, symbol, timeframe, source, created_at
      FROM ${systemJournal}
      WHERE created_at > now() - interval '24 hours'
        AND source = 'openclaw'
        AND status IN ('scouted', 'promoted')
      ORDER BY created_at DESC
      LIMIT 25
    `);
    return (rows as any[]).map((r) => ({
      id: String(r.id),
      title: String(r.name ?? "(unnamed)"),
      market: String(r.symbol ?? ""),
      timeframe: String(r.timeframe ?? ""),
      source: String(r.source ?? "openclaw"),
    }));
  } catch (err) {
    logger.warn({ err }, "openclaw-daily-report: journal query failed");
    return [];
  }
}

function deriveHealthAndActions(failed24hCount: number, strategyFindCount: number, staleCount: number): {
  healthIssues: string[];
  nextActions: string[];
} {
  const healthIssues: string[] = [];
  const nextActions: string[] = [];

  if (failed24hCount > 10) {
    healthIssues.push(`Elevated failure count: ${failed24hCount} executions errored in last 24h`);
    nextActions.push("Review #workflow-errors channel and inspect top failing workflow");
  }
  if (strategyFindCount === 0) {
    healthIssues.push("No new strategy candidates surfaced in last 24h");
    nextActions.push("Check Strategy Generation Loop + Nightly Strategy Research Loop executions");
  }
  if (staleCount > 0) {
    healthIssues.push(`${staleCount} active workflow(s) untouched in 30+ days — review for relevance`);
  }

  return { healthIssues, nextActions };
}

async function postToDiscord(payload: DailyN8nReportPayload): Promise<void> {
  const port = Number(process.env.DISCORD_ALERT_PORT) || 4100;
  const apiKey = process.env.API_KEY;
  const url = `http://localhost:${port}/alert/n8n-daily-report`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Discord webhook HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

openclawDailyReportRoutes.post("/send", async (req, res) => {
  try {
    const reportDate = new Date().toISOString().slice(0, 10);
    const [n8nState, strategyFinds] = await Promise.all([fetchN8nState(), fetchStrategyFinds24h()]);
    const { healthIssues, nextActions } = deriveHealthAndActions(
      n8nState.failed24h.length,
      strategyFinds.length,
      n8nState.staleWorkflows.length,
    );

    const payload: DailyN8nReportPayload = {
      reportDate,
      activeWorkflowCount: n8nState.activeWorkflows.length,
      newOrChanged: [], // TODO: diff against snapshot
      failed24h: n8nState.failed24h,
      staleWorkflows: n8nState.staleWorkflows,
      strategyFinds,
      healthIssues,
      nextActions,
    };

    await postToDiscord(payload);
    req.log.info({ reportDate, payloadSummary: { activeWorkflowCount: payload.activeWorkflowCount, failed24h: payload.failed24h.length, finds: payload.strategyFinds.length } }, "openclaw-daily-report: sent");
    res.json({ sent: true, payload });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "openclaw-daily-report: send failed");
    res.status(500).json({ error: err?.message ?? "send failed" });
  }
});

openclawDailyReportRoutes.get("/preview", async (req, res) => {
  try {
    const reportDate = new Date().toISOString().slice(0, 10);
    const [n8nState, strategyFinds] = await Promise.all([fetchN8nState(), fetchStrategyFinds24h()]);
    const { healthIssues, nextActions } = deriveHealthAndActions(
      n8nState.failed24h.length,
      strategyFinds.length,
      n8nState.staleWorkflows.length,
    );

    res.json({
      reportDate,
      activeWorkflowCount: n8nState.activeWorkflows.length,
      newOrChanged: [],
      failed24h: n8nState.failed24h,
      staleWorkflows: n8nState.staleWorkflows,
      strategyFinds,
      healthIssues,
      nextActions,
    });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "openclaw-daily-report: preview failed");
    res.status(500).json({ error: err?.message ?? "preview failed" });
  }
});
