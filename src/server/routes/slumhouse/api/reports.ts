/**
 * GET /slumhouse/api/reports — GPT trade-critique reports for the Office
 * "Reporting Room" page. `?scope=all` returns the full history; anything else
 * (default) returns just the last 24 hours ("night" scope).
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { assembleGptReports } from "../../../lib/slumhouse/reports-data.js";

export const reportsApiRouter = Router();

reportsApiRouter.get(
  "/slumhouse/api/reports",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    const scope = req.query.scope === "all" ? "all" : "night";
    try {
      res.json(await assembleGptReports({ scope }));
    } catch {
      res.json({ reports: [], accounts: [], stats: { total: 0, lastNight: 0, byGrade: {} } });
    }
  },
);
