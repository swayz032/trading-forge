/**
 * GET /slumhouse/api/reports — GPT trade-critique reports for the Office
 * "Reporting Room" page. `?scope=all` returns the full history; anything else
 * (default) returns just the last 24 hours ("night" scope).
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { assembleGptReports } from "../../../lib/slumhouse/reports-data.js";
import { logger } from "../../../lib/logger.js";

export const reportsApiRouter = Router();

reportsApiRouter.get(
  "/slumhouse/api/reports",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    const scope = req.query.scope === "all" ? "all" : "night";
    try {
      res.json(await assembleGptReports({ scope }));
    } catch (err) {
      // Green-board truth-test finding #2 (ops-experience 2026-07-20, OR-029 §2).
      //
      // This previously swallowed the error in a bare `catch {` and returned HTTP 200 with
      // empty arrays — byte-identical to a genuinely quiet night. On a pre-live system where
      // quiet nights ARE the norm, "the report system is broken" masquerading as "nothing
      // happened last night" is a lie that never self-corrects. Its two sibling surfaces
      // (scout-health, deploy-approvals) both fail with an honest 500; this one was the outlier.
      //
      // Still 200 so the page renders — but `degraded` carries the distinction the response
      // previously destroyed. Both fields are NEW and OPTIONAL: consumers reading
      // reports/accounts/stats are untouched; only a consumer that wants the distinction looks.
      logger.warn({ err, scope }, "slumhouse reports query failed — returning degraded payload");
      res.json({
        reports: [],
        accounts: [],
        stats: { total: 0, lastNight: 0, byGrade: {} },
        degraded: true,
        error: "reports_query_failed",
      });
    }
  },
);
