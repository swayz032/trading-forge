/**
 * Adversarial Tournament Routes — Phase 4.8
 *
 * The tournament is primarily an n8n workflow, but these routes provide
 * the metrics API for reading tournament results and triggering manual runs.
 */

import { Router } from "express";
import { z } from "zod";
import { logger } from "../index.js";

export const tournamentRoutes = Router();

// ─── In-memory store (replaced by DB queries in production) ─────

// Tournament results are stored by n8n via POST /api/tournament/run
// For now, use a simple in-memory array as a staging area
const tournamentResults: Record<string, unknown>[] = [];

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
  const { limit = "50", offset = "0" } = req.query;
  const start = Number(offset);
  const end = start + Number(limit);

  // In production, query tournament_results table
  const slice = tournamentResults.slice(start, end);
  res.json({
    total: tournamentResults.length,
    limit: Number(limit),
    offset: start,
    results: slice,
  });
});

// ─── GET /api/tournament/latest ──────────────────────────────────
// Most recent tournament result
tournamentRoutes.get("/latest", async (_req, res) => {
  if (tournamentResults.length === 0) {
    res.json({ message: "No tournament results yet. Run a tournament via n8n or POST /api/tournament/run." });
    return;
  }
  res.json(tournamentResults[tournamentResults.length - 1]);
});

// ─── GET /api/tournament/stats ───────────────────────────────────
// Win/loss/revision rates
tournamentRoutes.get("/stats", async (_req, res) => {
  const total = tournamentResults.length;
  if (total === 0) {
    res.json({
      total: 0,
      promoted: 0,
      revised: 0,
      killed: 0,
      promote_rate: 0,
      revise_rate: 0,
      kill_rate: 0,
    });
    return;
  }

  const promoted = tournamentResults.filter((r) => r.final_verdict === "PROMOTE").length;
  const revised = tournamentResults.filter((r) => r.final_verdict === "REVISE").length;
  const killed = tournamentResults.filter((r) => r.final_verdict === "KILL").length;

  res.json({
    total,
    promoted,
    revised,
    killed,
    promote_rate: Math.round((promoted / total) * 10000) / 100,
    revise_rate: Math.round((revised / total) * 10000) / 100,
    kill_rate: Math.round((killed / total) * 10000) / 100,
  });
});

// ─── POST /api/tournament/run ────────────────────────────────────
// Store a tournament result (called by n8n or manual testing)
tournamentRoutes.post("/run", async (req, res) => {
  const parsed = tournamentRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const result = {
    id: crypto.randomUUID(),
    tournament_date: new Date().toISOString(),
    ...parsed.data,
    created_at: new Date().toISOString(),
  };

  tournamentResults.push(result);
  logger.info({ candidate: parsed.data.candidate_name, verdict: parsed.data.final_verdict }, "Tournament result stored");

  res.status(201).json(result);
});

// ─── GET /api/tournament/leaderboard ─────────────────────────────
// Strategies that survived the tournament (PROMOTE verdicts)
tournamentRoutes.get("/leaderboard", async (req, res) => {
  const { limit = "20" } = req.query;

  const promoted = tournamentResults
    .filter((r) => r.final_verdict === "PROMOTE")
    .slice(-(Number(limit)));

  res.json({
    total_promoted: promoted.length,
    strategies: promoted.map((r) => ({
      candidate_name: r.candidate_name,
      tournament_date: r.tournament_date,
      backtest_id: r.backtest_id || null,
    })),
  });
});
