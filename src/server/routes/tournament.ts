/**
 * Adversarial Tournament Routes — Phase 4.8
 *
 * The tournament is primarily an n8n workflow, but these routes provide
 * the metrics API for reading tournament results and triggering manual runs.
 */

import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { tournamentResults } from "../db/schema.js";

export const tournamentRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const tournamentRunSchema = z.object({
  candidate_name: z.string().min(1),
  candidate_dsl: z.record(z.unknown()),
  proposer_output: z.record(z.unknown()).optional(),
  compiler_pass: z.boolean().optional(),
  graveyard_pass: z.boolean().optional(),
  critic_output: z.record(z.unknown()).optional(),
  prosecutor_output: z.record(z.unknown()).optional(),
  promoter_output: z.record(z.unknown()).optional(),
  final_verdict: z.enum(["PROMOTE", "REVISE", "KILL"]),
  revision_notes: z.string().optional(),
  backtest_id: z.string().uuid().optional(),
});

// ─── GET /api/tournament/history ─────────────────────────────────
// Past tournament results
tournamentRoutes.get("/history", async (req, res) => {
  try {
    const { limit = "50", offset = "0" } = req.query;
    const lim = Number(limit);
    const off = Number(offset);

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tournamentResults);

    const rows = await db
      .select()
      .from(tournamentResults)
      .orderBy(desc(tournamentResults.createdAt))
      .limit(lim)
      .offset(off);

    res.json({ total, limit: lim, offset: off, results: rows });
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch tournament history");
    res.status(500).json({ error: "Failed to fetch tournament history", details: err.message });
  }
});

// ─── GET /api/tournament/latest ──────────────────────────────────
// Most recent tournament result
tournamentRoutes.get("/latest", async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(tournamentResults)
      .orderBy(desc(tournamentResults.createdAt))
      .limit(1);

    if (!row) {
      res.json({ message: "No tournament results yet. Run a tournament via n8n or POST /api/tournament/run." });
      return;
    }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch latest tournament result");
    res.status(500).json({ error: "Failed to fetch latest tournament result", details: err.message });
  }
});

// ─── GET /api/tournament/stats ───────────────────────────────────
// Win/loss/revision rates
tournamentRoutes.get("/stats", async (req, res) => {
  try {
    const verdictRows = await db
      .select({
        finalVerdict: tournamentResults.finalVerdict,
        count: sql<number>`count(*)::int`,
      })
      .from(tournamentResults)
      .groupBy(tournamentResults.finalVerdict);

    const total = verdictRows.reduce((sum, r) => sum + r.count, 0);
    if (total === 0) {
      res.json({ total: 0, promoted: 0, revised: 0, killed: 0, promote_rate: 0, revise_rate: 0, kill_rate: 0 });
      return;
    }

    const promoted = verdictRows.find((r) => r.finalVerdict === "PROMOTE")?.count ?? 0;
    const revised = verdictRows.find((r) => r.finalVerdict === "REVISE")?.count ?? 0;
    const killed = verdictRows.find((r) => r.finalVerdict === "KILL")?.count ?? 0;

    res.json({
      total,
      promoted,
      revised,
      killed,
      promote_rate: Math.round((promoted / total) * 10000) / 100,
      revise_rate: Math.round((revised / total) * 10000) / 100,
      kill_rate: Math.round((killed / total) * 10000) / 100,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch tournament stats");
    res.status(500).json({ error: "Failed to fetch tournament stats", details: err.message });
  }
});

// ─── POST /api/tournament/run ────────────────────────────────────
// Store a tournament result (called by n8n or manual testing)
tournamentRoutes.post("/run", async (req, res) => {
  const parsed = tournamentRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const [row] = await db
      .insert(tournamentResults)
      .values({
        tournamentDate: new Date(),
        candidateName: parsed.data.candidate_name,
        candidateDsl: parsed.data.candidate_dsl,
        proposerOutput: parsed.data.proposer_output ?? null,
        compilerPass: parsed.data.compiler_pass ?? null,
        graveyardPass: parsed.data.graveyard_pass ?? null,
        criticOutput: parsed.data.critic_output ?? null,
        prosecutorOutput: parsed.data.prosecutor_output ?? null,
        promoterOutput: parsed.data.promoter_output ?? null,
        finalVerdict: parsed.data.final_verdict,
        revisionNotes: parsed.data.revision_notes ?? null,
        backtestId: parsed.data.backtest_id ?? null,
      })
      .returning();

    req.log.info({ candidate: parsed.data.candidate_name, verdict: parsed.data.final_verdict }, "Tournament result stored");
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Failed to store tournament result");
    res.status(500).json({ error: "Failed to store tournament result", details: err.message });
  }
});

// ─── GET /api/tournament/leaderboard ─────────────────────────────
// Strategies that survived the tournament (PROMOTE verdicts)
tournamentRoutes.get("/leaderboard", async (req, res) => {
  try {
    const { limit = "20" } = req.query;

    const rows = await db
      .select({
        candidateName: tournamentResults.candidateName,
        tournamentDate: tournamentResults.tournamentDate,
        backtestId: tournamentResults.backtestId,
      })
      .from(tournamentResults)
      .where(eq(tournamentResults.finalVerdict, "PROMOTE"))
      .orderBy(desc(tournamentResults.createdAt))
      .limit(Number(limit));

    res.json({
      total_promoted: rows.length,
      strategies: rows.map((r) => ({
        candidate_name: r.candidateName,
        tournament_date: r.tournamentDate,
        backtest_id: r.backtestId || null,
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch tournament leaderboard");
    res.status(500).json({ error: "Failed to fetch tournament leaderboard", details: err.message });
  }
});
