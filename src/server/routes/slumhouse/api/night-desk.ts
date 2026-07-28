import { Router, type Response } from "express";
import { requireAdminSession, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { assembleNightDesk } from "../../../lib/slumhouse/night-desk-data.js";
import { logger } from "../../../lib/logger.js";

export const nightDeskApiRouter = Router();

nightDeskApiRouter.get(
  "/slumhouse/api/night-desk",
  requireAdminSession,
  async (_req: SlumhouseRequest, res: Response) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await assembleNightDesk());
    } catch (err) {
      logger.warn({ err }, "night desk assembly failed");
      res.status(503).json({
        generatedAt: new Date().toISOString(),
        health: {
          state: "degraded",
          message: "The Night Desk could not read its evidence. This is not being reported as a quiet night.",
          sources: {},
        },
      });
    }
  },
);
