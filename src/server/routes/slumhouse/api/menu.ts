/**
 * GET /slumhouse/api/menu/now-serving  — champions of DEPLOYED/DECLINING families ($ merged)
 * GET /slumhouse/api/menu/deploy-ready  — champions of DEPLOY_READY families
 * GET /slumhouse/api/menu/kitchen       — full families cooking for a symbol (?symbol=, default MES)
 * GET /slumhouse/api/menu/graveyard     — full families of tossed strategies (+ killReason)
 */
import { Router } from "express";
import { requireSlumhouseUser } from "../../../lib/slumhouse/require-session.js";
import {
  assembleNowServing,
  assembleDeployReady,
  assembleKitchenMenu,
  assembleGraveyardMenu,
} from "../../../lib/slumhouse/menu-data.js";

export const menuApiRouter = Router();

menuApiRouter.get("/slumhouse/api/menu/now-serving", requireSlumhouseUser, async (_req, res) => {
  res.json({ dishes: await assembleNowServing() });
});

menuApiRouter.get("/slumhouse/api/menu/deploy-ready", requireSlumhouseUser, async (_req, res) => {
  res.json({ dishes: await assembleDeployReady() });
});

menuApiRouter.get("/slumhouse/api/menu/kitchen", requireSlumhouseUser, async (req, res) => {
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : "MES";
  res.json({ families: await assembleKitchenMenu(symbol) });
});

menuApiRouter.get("/slumhouse/api/menu/graveyard", requireSlumhouseUser, async (_req, res) => {
  res.json({ families: await assembleGraveyardMenu() });
});
