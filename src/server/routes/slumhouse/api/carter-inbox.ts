/**
 * GET /slumhouse/api/carter-inbox — Carter's "deliverables inbox".
 *
 * Returns the things Carter PRODUCES, newest-first, for the Office chat panel:
 *   - research reports (carter_memory kind='research' — running/completed/failed)
 *   - daily analyst insights (carter_memory kind='insight')
 *   - open alerts (carter_issues, severity-sorted)
 *
 * Research survives hang-up (the Apify scrape runs server-side and stores the
 * result), so the inbox shows it whenever the operator opens the Office — no need
 * to stay on the call. Read-only. Auth = the same Office session as carter-session.
 */
import { Router, type Response } from "express";
import { requireSlumhouseUserOrAdmin, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { queryMemories } from "../../../lib/carter/carter-memory-store.js";
import { listOpenIssues } from "../../../lib/carter/carter-issues-store.js";
import { logger } from "../../../lib/logger.js";

interface InboxItem {
  id: string;
  type: "research" | "insight" | "alert";
  title: string;
  status: "running" | "completed" | "failed" | "info";
  headline?: string;
  summary?: string;
  items?: Array<{ title: string; url?: string; snippet?: string }>;
  severity?: string;
  at: string;
}

function parseContent(content: unknown): Record<string, unknown> {
  if (typeof content !== "string") return {};
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function iso(d: unknown): string {
  try {
    return d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

export async function getCarterInbox(_req: SlumhouseRequest, res: Response): Promise<void> {
  try {
    const out: InboxItem[] = [];

    // ── Research reports (latest row per topic wins; running then completed) ──
    const research = await queryMemories({ kind: "research", limit: 30 }).catch(() => []);
    const seenTopic = new Set<string>();
    for (const m of research) {
      const b = parseContent(m.content);
      const topic = String(b.topic ?? m.topic ?? "");
      if (seenTopic.has(topic)) continue; // newest-first → first seen is latest
      seenTopic.add(topic);
      const status = (["running", "completed", "failed"].includes(String(b.status))
        ? String(b.status)
        : "completed") as InboxItem["status"];
      out.push({
        id: `research-${m.id}`,
        type: "research",
        title: `${String(b.platform ?? "research")} · ${topic}`.trim(),
        status,
        headline: typeof b.headline === "string" ? b.headline : undefined,
        summary: typeof b.summary === "string" ? b.summary : undefined,
        items: Array.isArray(b.items)
          ? (b.items as Array<Record<string, unknown>>).slice(0, 6).map((it) => ({
              title: String(it.title ?? "").slice(0, 140),
              url: typeof it.url === "string" ? it.url : undefined,
              snippet: typeof it.snippet === "string" && it.snippet.trim() ? it.snippet.slice(0, 180) : undefined,
            }))
          : undefined,
        at: iso(m.createdAt),
      });
    }

    // ── Daily analyst insights ──
    const insights = await queryMemories({ kind: "insight", limit: 5 }).catch(() => []);
    for (const m of insights) {
      const b = parseContent(m.content);
      out.push({
        id: `insight-${m.id}`,
        type: "insight",
        title: "Daily insight",
        status: "info",
        headline: typeof b.headline === "string" ? b.headline : undefined,
        at: iso(m.createdAt),
      });
    }

    // ── Open alerts (fail-soft if the store is empty) ──
    try {
      const issues = listOpenIssues();
      for (const iss of issues.slice(0, 10)) {
        out.push({
          id: `alert-${String(iss.issue_key)}`,
          type: "alert",
          title: String(iss.title ?? "Alert"),
          status: "info",
          severity: String(iss.severity ?? ""),
          at: iso(iss.last_seen),
        });
      }
    } catch {
      /* no issues store / empty — skip */
    }

    out.sort((a, b) => (a.at < b.at ? 1 : -1));
    res.json({ items: out.slice(0, 40) });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "carter-inbox failed");
    res.status(500).json({ error: "carter_inbox_failed" });
  }
}

export const carterInboxRouter = Router();
carterInboxRouter.get("/slumhouse/api/carter-inbox", requireSlumhouseUserOrAdmin, getCarterInbox);
