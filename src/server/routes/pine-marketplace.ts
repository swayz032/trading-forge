/**
 * Pine Marketplace Routes — B9 (W14)
 *
 * Internal admin endpoints for managing TradingView marketplace listings.
 *
 * Routes:
 *   GET  /api/pine-marketplace/listings          — list marketplace candidates
 *   POST /api/pine-marketplace/package/:strategyId — generate package for a strategy
 *
 * PIPELINE PAUSE GUARD:
 *   The package generation route returns 423 when the pipeline is paused.
 *   Listing is always available (read-only, no Python subprocess).
 *
 * AUTHORITY:
 *   These routes are ADMIN-only operations (operator use only).
 *   They trigger compileDualPineExport() which spawns a Python subprocess.
 *   The route is therefore covered by the standard rate limit at /api.
 *   We do NOT apply strictRateLimit here because:
 *     - Package generation is a human-triggered, deliberate action
 *     - It will never be called in batch/burst by n8n or automation
 *     - Pine compiler pool semaphore (PINE_MAX_SUBPROCESSES=3) already backpressures
 *
 * RESPONSE SHAPES:
 *
 *   GET /listings → 200 { listings: Array<{...}> }
 *   GET /listings → 500 { error: "..." }
 *
 *   POST /package/:strategyId → 200 { package: MarketplacePackage }
 *   POST /package/:strategyId → 400 { error: "..." }       (invalid request)
 *   POST /package/:strategyId → 404 { error: "..." }       (strategy not found)
 *   POST /package/:strategyId → 423 { error: "pipeline_paused" }
 *   POST /package/:strategyId → 500 { error: "..." }       (compile failed)
 *
 * SEMANTIC FIDELITY:
 *   Package generation calls compileDualPineExport() → all export decisions
 *   (repaint risk, unsupported constructs, exportability scoring) are made by
 *   the existing Pine compiler pipeline. This route is a thin admin wrapper.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import {
  generateMarketplacePackage,
  listMarketplaceCandidates,
  PRICING_TIERS,
  type MarketplacePricingTier,
} from "../services/pine-marketplace-service.js";
import { logger } from "../index.js";

export const pineMarketplaceRoutes = Router();

// ─── Pipeline pause gate ──────────────────────────────────────────────────────

async function pipelinePauseGate(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  next();
}

// ─── GET /api/pine-marketplace/listings ──────────────────────────────────────

/**
 * List all strategies that are candidates for marketplace publishing.
 *
 * Returns strategies with completed Pine exports and exportability score >= 50.
 * For each candidate, includes the recommended pricing tier and export score.
 *
 * This endpoint is READ-ONLY and does not invoke the Pine compiler.
 * No pipeline pause gate — safe to call at any time.
 */
pineMarketplaceRoutes.get("/listings", async (_req: Request, res: Response) => {
  try {
    const listings = await listMarketplaceCandidates();
    res.json({
      listings,
      pricingTiers: PRICING_TIERS,
      count: listings.length,
    });
  } catch (err) {
    logger.error({ err }, "pine-marketplace: failed to list candidates");
    res.status(500).json({ error: "Failed to retrieve marketplace listings" });
  }
});

// ─── POST /api/pine-marketplace/package/:strategyId ──────────────────────────

/**
 * Generate a complete marketplace package for a strategy.
 *
 * This triggers compileDualPineExport() → spawns Python Pine compiler subprocess.
 * Protected by the pipeline pause gate (returns 423 when paused).
 *
 * Body (all optional):
 *   pricingTierOverride?: "basic" | "alerts" | "premium"
 *   firmKey?: string  (e.g. "topstep_50k" for prop overlay)
 *
 * The response includes the full package in-memory:
 *   - pineContent: the raw .pine script
 *   - metadataYaml: the TV submission aide YAML
 *   - readmeMarkdown: customer-facing documentation
 *
 * NOTE: The .pine content is also persisted to strategy_export_artifacts by
 * compileDualPineExport(). The metadataYaml and readmeMarkdown are returned
 * in-memory only — they are not persisted to DB (they are regenerated on
 * each package generation call). Operators should save them locally via the
 * runbook process at docs/pine-marketplace-publishing.md.
 */
pineMarketplaceRoutes.post(
  "/package/:strategyId",
  pipelinePauseGate,
  async (req: Request, res: Response) => {
    const strategyId = String(req.params.strategyId ?? "");

    // Basic UUID format check
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(strategyId)) {
      res.status(400).json({ error: "strategyId must be a valid UUID" });
      return;
    }

    // Parse optional body
    const body = req.body ?? {};
    let pricingTierOverride: MarketplacePricingTier | undefined;
    let firmKey: string | undefined;

    if (body.pricingTierOverride !== undefined) {
      if (!["basic", "alerts", "premium"].includes(body.pricingTierOverride)) {
        res.status(400).json({ error: "pricingTierOverride must be one of: basic, alerts, premium" });
        return;
      }
      pricingTierOverride = body.pricingTierOverride as MarketplacePricingTier;
    }

    if (body.firmKey !== undefined) {
      if (typeof body.firmKey !== "string") {
        res.status(400).json({ error: "firmKey must be a string" });
        return;
      }
      firmKey = body.firmKey;
    }

    try {
      const pkg = await generateMarketplacePackage(strategyId, { pricingTierOverride, firmKey });

      if (!pkg) {
        // generateMarketplacePackage returns null for strategy-not-found OR export failure
        // We need to distinguish: check if the strategy exists to return correct status code.
        // pine-marketplace-service already logged the reason — return 404 generically.
        res.status(404).json({
          error: "Package could not be generated — strategy not found or export compilation failed. Check server logs for details.",
        });
        return;
      }

      res.json({ package: pkg });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ strategyId, err }, "pine-marketplace: package generation failed");
      res.status(500).json({ error: `Package generation failed: ${errorMsg}` });
    }
  },
);

// ─── GET /api/pine-marketplace/pricing-tiers ─────────────────────────────────

/**
 * Return the static pricing tier definitions.
 * Useful for the dashboard to render pricing tier selector UI.
 */
pineMarketplaceRoutes.get("/pricing-tiers", (_req: Request, res: Response) => {
  res.json({ pricingTiers: PRICING_TIERS });
});
