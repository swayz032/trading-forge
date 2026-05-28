/**
 * GET /slumhouse/api/crib — assembles The Crib data for the authenticated friend.
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { assembleCribData } from "../../../lib/slumhouse/crib-data.js";

export async function getCrib(req: SlumhouseRequest, res: Response): Promise<void> {
  const user = req.slumhouseUser!;
  const data = await assembleCribData({ brokerAccountId: user.brokerAccountId ?? null });
  res.json(data);
}

export const cribApiRouter = Router();
cribApiRouter.get("/slumhouse/api/crib", requireSlumhouseUser, getCrib);
