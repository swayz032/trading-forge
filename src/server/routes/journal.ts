import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { systemJournal } from "../db/schema.js";

export const journalRoutes = Router();

// List journal entries (most recent first, optional filters)
journalRoutes.get("/", async (req, res) => {
  const { status, tier, source, limit } = req.query;

  let query = db.select().from(systemJournal).orderBy(desc(systemJournal.createdAt));

  // Build conditions array
  const conditions = [];
  if (status) conditions.push(eq(systemJournal.status, status as string));
  if (tier) conditions.push(eq(systemJournal.tier, tier as string));
  if (source) conditions.push(eq(systemJournal.source, source as string));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  if (limit) {
    query = query.limit(Number(limit)) as typeof query;
  }

  const rows = await query;
  res.json(rows);
});

// Get single journal entry
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

// Get summary stats for the self-critique dashboard
journalRoutes.get("/stats/summary", async (req, res) => {
  const all = await db.select().from(systemJournal);

  const total = all.length;
  const byTier = { TIER_1: 0, TIER_2: 0, TIER_3: 0, REJECTED: 0 };
  const bySource = {} as Record<string, number>;
  const byStatus = {} as Record<string, number>;

  for (const entry of all) {
    if (entry.tier && entry.tier in byTier) byTier[entry.tier as keyof typeof byTier]++;
    bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
  }

  const promoted = all.filter((e) => e.status === "promoted").length;
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
