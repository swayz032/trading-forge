/**
 * Strategy Pre-Validator Route — POST /api/prevalidate
 *
 * n8n workflows call this BEFORE pushing a candidate into the backtest queue.
 * If passed=false, the candidate is dropped and never burns compute.
 */

import { Router } from "express";
import { z } from "zod";

import { prevalidateCandidate } from "../services/strategy-prevalidator.js";

export const prevalidatorRoutes = Router();

const PrevalidateRequest = z.object({
  conceptName: z.string().min(1),
  market: z.string().min(1),
  timeframe: z.string().min(1),
  preferredRegime: z.string().optional(),
  intendedRegime: z.string().optional(),
  entryRules: z.string().optional(),
  exitRules: z.string().optional(),
});

prevalidatorRoutes.post("/", async (req, res) => {
  const parsed = PrevalidateRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }

  try {
    const result = await prevalidateCandidate(parsed.data);
    res.json(result);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "prevalidator route failed");
    res.status(500).json({ error: err?.message ?? "prevalidator failed" });
  }
});
