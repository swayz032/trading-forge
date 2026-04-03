import { Router } from "express";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { systemJournal } from "../db/schema.js";

export const journalRoutes = Router();

// List journal entries (most recent first, optional filters)
journalRoutes.get("/", async (req, res) => {
  const { status, tier, source, limit, offset } = req.query;

  // Build conditions array
  const conditions = [];
  if (status) conditions.push(eq(systemJournal.status, status as string));
  if (tier) conditions.push(eq(systemJournal.tier, tier as string));
  if (source) conditions.push(eq(systemJournal.source, source as string));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(systemJournal)
    .where(whereClause);

  let query = db.select().from(systemJournal).orderBy(desc(systemJournal.createdAt));

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  if (limit) {
    query = query.limit(Number(limit)) as typeof query;
  }

  if (offset) {
    query = query.offset(Number(offset)) as typeof query;
  }

  const rows = await query;
  res.json({ data: rows, total });
});

// ─── GET /api/journal/scout-fingerprints ─────────────────────
// Returns recent scout title hashes + URLs for client-side (n8n) dedup
// NOTE: Must be defined BEFORE /:id to avoid route collision
journalRoutes.get("/scout-fingerprints", async (req, res) => {
  const days = Number(req.query.days) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = await db
    .select({
      id: systemJournal.id,
      title_hash: sql<string>`strategy_params->>'title_hash'`,
      url: sql<string>`strategy_params->>'url'`,
      title: sql<string>`strategy_params->>'title'`,
      createdAt: systemJournal.createdAt,
    })
    .from(systemJournal)
    .where(
      and(
        eq(systemJournal.status, "scouted"),
        gte(systemJournal.createdAt, cutoff),
      )
    )
    .orderBy(desc(systemJournal.createdAt));

  res.json({
    count: rows.length,
    days,
    fingerprints: rows.map((r) => ({
      id: r.id,
      title_hash: r.title_hash,
      url: r.url,
      title: r.title,
      created_at: r.createdAt,
    })),
  });
});

// ─── GET /api/journal/scout-funnel ──────────────────────────
// Aggregated funnel: scouted → tested → passed → deployed, grouped by source
// NOTE: Must be defined BEFORE /:id to avoid route collision
journalRoutes.get("/scout-funnel", async (req, res) => {
  const days = Number(req.query.days) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = await db
    .select({
      source: systemJournal.source,
      status: systemJournal.status,
      count: sql<number>`count(*)::int`,
    })
    .from(systemJournal)
    .where(gte(systemJournal.createdAt, cutoff))
    .groupBy(systemJournal.source, systemJournal.status);

  // Build funnel by source
  const funnel: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};

  for (const row of rows) {
    if (!funnel[row.source]) funnel[row.source] = {};
    funnel[row.source][row.status] = row.count;
    totals[row.status] = (totals[row.status] || 0) + row.count;
  }

  res.json({ days, by_source: funnel, totals });
});

// Get summary stats for the self-critique dashboard
// NOTE: Must be defined BEFORE /:id to avoid route collision
journalRoutes.get("/stats/summary", async (req, res) => {
  // Use SQL aggregation instead of loading all rows into memory
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(systemJournal);

  const tierRows = await db
    .select({ tier: systemJournal.tier, count: sql<number>`count(*)::int` })
    .from(systemJournal)
    .groupBy(systemJournal.tier);

  const sourceRows = await db
    .select({ source: systemJournal.source, count: sql<number>`count(*)::int` })
    .from(systemJournal)
    .groupBy(systemJournal.source);

  const statusRows = await db
    .select({ status: systemJournal.status, count: sql<number>`count(*)::int` })
    .from(systemJournal)
    .groupBy(systemJournal.status);

  const byTier: Record<string, number> = { TIER_1: 0, TIER_2: 0, TIER_3: 0, REJECTED: 0 };
  for (const r of tierRows) {
    if (r.tier) byTier[r.tier] = r.count;
  }

  const bySource: Record<string, number> = {};
  for (const r of sourceRows) bySource[r.source] = r.count;

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const promoted = byStatus["promoted"] ?? 0;
  const passRate = total > 0 ? ((total - (byTier.REJECTED || 0)) / total) * 100 : 0;

  res.json({
    total,
    promoted,
    passRate: Math.round(passRate * 100) / 100,
    byTier,
    bySource,
    byStatus,
  });
});

// ─── GET /api/journal/source-stats ───────────────────────────
// Hit rate metrics per source: scouted → promoted conversion rates
// NOTE: Must be defined BEFORE /:id to avoid route collision
journalRoutes.get("/source-stats", async (req, res) => {
  const days = Number(req.query.days) || 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = await db
    .select({
      source: systemJournal.source,
      status: systemJournal.status,
      tier: systemJournal.tier,
      count: sql<number>`count(*)::int`,
    })
    .from(systemJournal)
    .where(gte(systemJournal.createdAt, cutoff))
    .groupBy(systemJournal.source, systemJournal.status, systemJournal.tier);

  // Build per-source stats
  const sources: Record<string, {
    total: number;
    scouted: number;
    tested: number;
    promoted: number;
    rejected: number;
    promotionRate: number;
    byTier: Record<string, number>;
  }> = {};

  for (const row of rows) {
    if (!sources[row.source]) {
      sources[row.source] = { total: 0, scouted: 0, tested: 0, promoted: 0, rejected: 0, promotionRate: 0, byTier: {} };
    }
    const s = sources[row.source];
    s.total += row.count;
    if (row.status === "scouted") s.scouted += row.count;
    if (row.status === "tested") s.tested += row.count;
    if (row.status === "promoted") s.promoted += row.count;
    if (row.status === "failed" || row.tier === "REJECTED") s.rejected += row.count;
    if (row.tier) {
      s.byTier[row.tier] = (s.byTier[row.tier] || 0) + row.count;
    }
  }

  // Compute promotion rates
  for (const s of Object.values(sources)) {
    s.promotionRate = s.total > 0 ? Math.round((s.promoted / s.total) * 10000) / 100 : 0;
  }

  // Sort by promotion rate descending
  const ranked = Object.entries(sources)
    .sort(([, a], [, b]) => b.promotionRate - a.promotionRate)
    .map(([source, stats]) => ({ source, ...stats }));

  res.json({ days, sources: ranked });
});

// Get single journal entry
// NOTE: Must be AFTER all named routes (scout-fingerprints, scout-funnel, stats/summary, source-stats)
journalRoutes.get("/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(systemJournal)
    .where(eq(systemJournal.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Journal entry not found" });
    return;
  }
  res.json(row);
});

// Log a new journal entry (called by n8n after every backtest)
journalRoutes.post("/", async (req, res) => {
  const {
    strategyId,
    backtestId,
    source,
    generationPrompt,
    strategyCode,
    strategyParams,
    simulatedEquity,
    dailyPnls,
    forgeScore,
    propComplianceResults,
    performanceGateResult,
    tier,
    analystNotes,
    parentJournalId,
    status,
  } = req.body;

  const [row] = await db
    .insert(systemJournal)
    .values({
      strategyId,
      backtestId,
      source,
      generationPrompt,
      strategyCode,
      strategyParams,
      simulatedEquity,
      dailyPnls,
      forgeScore,
      propComplianceResults,
      performanceGateResult,
      tier,
      analystNotes,
      parentJournalId,
      status,
    })
    .returning();
  res.status(201).json(row);
});

// Update journal entry (e.g., Ollama Analyst adds self-critique notes)
journalRoutes.patch("/:id", async (req, res) => {
  const { analystNotes, status, tier, propComplianceResults, performanceGateResult } = req.body;
  const [row] = await db
    .update(systemJournal)
    .set({
      ...(analystNotes !== undefined && { analystNotes }),
      ...(status && { status }),
      ...(tier && { tier }),
      ...(propComplianceResults && { propComplianceResults }),
      ...(performanceGateResult && { performanceGateResult }),
    })
    .where(eq(systemJournal.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Journal entry not found" });
    return;
  }
  res.json(row);
});

// DELETE /api/journal — Purge all journal entries (clean slate)
journalRoutes.delete("/", async (req, res) => {
  if (req.query.confirm !== "true") {
    res.status(400).json({ error: "Add ?confirm=true to confirm purge" });
    return;
  }
  await db.delete(systemJournal);
  res.json({ deleted: true, message: "All journal entries purged" });
});
