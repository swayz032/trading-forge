/**
 * GET /slumhouse/api/reports — the Office "Reporting Room" feed.
 *
 * ONE endpoint, a PER-SCOPE DISCRIMINATED payload (ops-experience 2026-07-21,
 * observability-room upgrade). Each scope is a genuinely different shape — the room
 * renders a different body per scope rather than forcing all three into the 7-slide
 * GPT critique (which would fabricate slides that don't exist):
 *   scope=night (default) / all → GptReport[] 7-slide critique   (assembleGptReports)
 *   scope=soak                  → cert-verdict rows              (assembleSoakReports)
 *   scope=weekly-ab             → Sharpe / P&L delta             (assembleWeeklyAbReports)
 * Unknown scopes fall back to `night`. Everything here is READ-ONLY display.
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import {
  assembleGptReports,
  assembleSoakReports,
  assembleWeeklyAbReports,
} from "../../../lib/slumhouse/reports-data.js";
import { logger } from "../../../lib/logger.js";

export const reportsApiRouter = Router();

reportsApiRouter.get(
  "/slumhouse/api/reports",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    const raw = req.query.scope;
    const scope: "night" | "all" | "soak" | "weekly-ab" =
      raw === "all" ? "all" : raw === "soak" ? "soak" : raw === "weekly-ab" ? "weekly-ab" : "night";
    try {
      if (scope === "soak") {
        res.json(await assembleSoakReports());
        return;
      }
      if (scope === "weekly-ab") {
        res.json(await assembleWeeklyAbReports());
        return;
      }
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
      // Scope-appropriate honest-empty: the failure carries `degraded` in the SAME
      // shape the scope's happy path returns, so the room's per-scope renderer sees a
      // degraded signal it understands rather than a night-shaped payload it can't read.
      if (scope === "soak") {
        res.json({ scope: "soak", soak: [], degraded: true, error: "reports_query_failed" });
        return;
      }
      if (scope === "weekly-ab") {
        res.json({ scope: "weekly-ab", ab: null, degraded: true, error: "reports_query_failed" });
        return;
      }
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
