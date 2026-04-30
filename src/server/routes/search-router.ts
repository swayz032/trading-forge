/**
 * Search Router Route — POST /api/search/strategy-hunt
 *
 * Replaces the per-workflow scout fan-out (5G/5H/5I) with one endpoint.
 * n8n workflows POST {intent, query, regime?, market?, maxResults?} and
 * receive a unified, deduped, graveyard-filtered candidate list.
 */

import { Router } from "express";
import { z } from "zod";

import { strategyHunt } from "../services/search-router.js";

export const searchRouterRoutes = Router();

const HuntRequest = z.object({
  intent: z.string().min(1),
  query: z.string().min(1),
  regime: z.string().optional(),
  market: z.string().optional(),
  maxResults: z.number().int().positive().max(50).optional(),
  // Wave 2 — two-tier cost knob. "basic" stays in 100% free tier.
  // "advanced" enables Tavily 2-cred + Exa contents (~$2/mo at 200 calls).
  depth: z.enum(["basic", "advanced"]).optional(),
  timeRange: z.enum(["day", "week", "month", "year"]).optional(),
  includeDomains: z.array(z.string()).max(300).optional(),
  excludeDomains: z.array(z.string()).max(300).optional(),
  category: z.enum(["research paper", "financial report", "news", "company"]).optional(),
});

searchRouterRoutes.post("/strategy-hunt", async (req, res) => {
  const parsed = HuntRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }

  try {
    const result = await strategyHunt(parsed.data);
    res.json(result);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "search-router route failed");
    res.status(502).json({ error: err?.message ?? "search failed" });
  }
});
