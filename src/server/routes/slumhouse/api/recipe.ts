/**
 * GET /slumhouse/api/recipe/:strategyId — per-strategy validation deep-dive.
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { assembleRecipeData } from "../../../lib/slumhouse/recipe-data.js";

export async function getRecipe(req: SlumhouseRequest, res: Response): Promise<void> {
  const strategyId = String(req.params?.strategyId ?? "");
  if (!strategyId) {
    res.status(400).json({ error: "strategy_id_required" });
    return;
  }
  try {
    const data = await assembleRecipeData({ strategyId });
    res.json(data);
  } catch (err: any) {
    if (String(err?.message ?? "").startsWith("strategy_not_found")) {
      res.status(404).json({ error: "strategy_not_found" });
      return;
    }
    throw err;
  }
}

export const recipeApiRouter = Router();
recipeApiRouter.get("/slumhouse/api/recipe/:strategyId", requireSlumhouseUser, getRecipe);
