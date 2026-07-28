import { Router, type Response } from "express";
import { requireSlumhouseUserOrAdmin, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { assembleEvidenceVault } from "../../../lib/slumhouse/evidence-vault-data.js";
import { logger } from "../../../lib/logger.js";
import { adminSessionFromCookie } from "../../../lib/slumhouse/admin-session.js";

export const evidenceVaultApiRouter = Router();

export async function getEvidenceVault(req: SlumhouseRequest, res: Response): Promise<void> {
  try {
    res.json(await assembleEvidenceVault({
      videoId: typeof req.query.video === "string" ? req.query.video : undefined,
      search: typeof req.query.q === "string" ? req.query.q : undefined,
      includeOperator: adminSessionFromCookie(req.headers.cookie),
    }));
  } catch (error) {
    logger.warn({ error }, "slumhouse evidence vault query failed");
    res.status(503).json({
      error: "evidence_vault_unavailable",
      generatedAt: new Date().toISOString(),
      capabilities: { operatorViews: false },
      stats: { today: 0, available: 0, total: 0, strategies: 0, workers: 0 },
      videos: [],
      strategies: [],
      workers: [],
      selected: null,
    });
  }
}

evidenceVaultApiRouter.get(
  "/slumhouse/api/evidence-vault",
  requireSlumhouseUserOrAdmin,
  getEvidenceVault,
);
