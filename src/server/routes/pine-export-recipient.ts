/**
 * pine-export-recipient.ts — Track 6 / Pass 2
 *
 * POST /api/pine-export/recipient
 *
 * Body: { strategy_id: string, account_id: string, qty_override?: number }
 * Returns: { artifact_path, artifact_hash, setup_readme, presigned_url, expires_at }
 *
 * Pipeline-pause-guarded: returns 423 when pipeline is paused.
 * Legacy-firm guard: returns 403 when account_id references a non-MFFU/Topstep firm.
 * Rate-limited via strictRateLimit.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { generateRecipientExport } from "../services/pine-export-recipient-service.js";
import { strictRateLimit } from "../middleware/rate-limit.js";
import { logger } from "../index.js";

export const pineExportRecipientRoutes = Router();

// ─── Pipeline pause gate ──────────────────────────────────────────────────────

async function pipelinePauseGate(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  next();
}

// ─── Request schema ────────────────────────────────────────────────────────────

const recipientExportSchema = z.object({
  strategy_id: z.string().uuid("strategy_id must be a UUID"),
  account_id: z.string().uuid("account_id must be a UUID"),
  qty_override: z.number().int().positive().optional(),
});

// ─── POST /api/pine-export/recipient ──────────────────────────────────────────

pineExportRecipientRoutes.post(
  "/",
  strictRateLimit,
  pipelinePauseGate,
  async (req, res) => {
    const parsed = recipientExportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const { strategy_id, account_id, qty_override } = parsed.data;

    try {
      const result = await generateRecipientExport({
        strategyId: strategy_id,
        accountId: account_id,
        qtyOverride: qty_override,
      });

      res.json({
        artifact_path: result.artifactPath,
        artifact_hash: result.artifactHash,
        export_id: result.exportId,
        recipient_label: result.recipientLabel,
        qty: result.qty,
        setup_readme: result.setupReadme,
        presigned_url: result.presignedUrl,
        expires_at: result.expiresAt,
        // A2 (Pass 3 Track A): propagate download URL so the frontend can wire
        // a "Download .pine" button without constructing the URL itself.
        // Shape: /api/pine-export/:exportId/artifacts/:artifactId/download
        // null when export was not persisted (dry-run).
        download_url: result.downloadUrl,
      });
    } catch (err) {
      const error = err as Error & { pipelinePaused?: boolean; legacyFirmRejection?: boolean; shadowStrategyBlocked?: boolean };

      if (error.pipelinePaused) {
        res.status(423).json({ error: "pipeline_paused" });
        return;
      }

      if (error.legacyFirmRejection) {
        res.status(403).json({
          error: "forbidden_firm",
          message: "Account does not belong to a supported firm (mffu or topstep)",
        });
        return;
      }

      // C3 (Pass 3 Track C): SHADOW strategy blocked — audit + Discord already
      // fired inside generateRecipientExport. Return 403 to the caller.
      if (error.shadowStrategyBlocked) {
        res.status(403).json({
          error: "shadow_strategy_pine_blocked",
          reason: "shadow_strategy_pine_blocked",
          message: "Pine export blocked: strategy is in SHADOW state and cannot produce artifacts",
        });
        return;
      }

      logger.error({ err, strategyId: strategy_id, accountId: account_id }, "pine-export-recipient: generation failed");
      res.status(500).json({ error: "Export generation failed" });
    }
  },
);
