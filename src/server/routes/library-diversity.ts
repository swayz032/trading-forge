/**
 * Library Diversity Route — Track 5 Phase D Readiness
 *
 * GET /api/library-diversity
 *   Returns the distribution of strategies by school and lifecycle stage.
 *   Used by the LibraryDiversityPanel dashboard component.
 *
 * Authority: observation only. Never gates any lifecycle decision.
 */

import { Router, Request, Response } from "express";
import { computeLibraryDiversity } from "../services/library-diversity-service.js";
import { logger } from "../lib/logger.js";

export const libraryDiversityRoutes = Router();

// ─── GET /api/library-diversity ──────────────────────────────────────────────

libraryDiversityRoutes.get("/", async (req: Request, res: Response) => {
  try {
    const diversity = await computeLibraryDiversity();
    res.json({
      success: true,
      data: diversity,
    });
  } catch (err) {
    logger.error({ err }, "library-diversity route: unhandled error");
    res.status(500).json({ success: false, error: "Failed to compute library diversity" });
  }
});
