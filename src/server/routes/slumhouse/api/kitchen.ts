/**
 * GET /slumhouse/api/kitchen      — 6-stage pipeline counts + totals
 * GET /slumhouse/api/kitchen/menu — Today's Menu dishes (DEPLOYED)
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { assembleKitchenData, assembleTodaysMenu } from "../../../lib/slumhouse/kitchen-data.js";

export async function getKitchen(_req: SlumhouseRequest, res: Response): Promise<void> {
  res.json(await assembleKitchenData());
}

export async function getMenu(_req: SlumhouseRequest, res: Response): Promise<void> {
  res.json({ dishes: await assembleTodaysMenu() });
}

export const kitchenApiRouter = Router();
kitchenApiRouter.get("/slumhouse/api/kitchen", requireSlumhouseUser, getKitchen);
kitchenApiRouter.get("/slumhouse/api/kitchen/menu", requireSlumhouseUser, getMenu);
