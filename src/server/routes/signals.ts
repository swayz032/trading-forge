import { Router } from "express";
import { checkSignalConfirmation } from "../services/signal-confirmation-service.js";


export const signalRoutes = Router();

// GET /api/signals/confirmation/:symbol — check cross-strategy agreement
signalRoutes.get("/confirmation/:symbol", async (req, res) => {
  try {
    const result = await checkSignalConfirmation(req.params.symbol);
    if (!result) {
      res.json({ confirmed: false, message: "No multi-strategy confirmation found" });
      return;
    }
    res.json({ confirmed: true, ...result });
  } catch (err: any) {
    req.log.error({ err, symbol: req.params.symbol }, "Signal confirmation check failed");
    res.status(500).json({ error: "Signal confirmation check failed", details: err.message });
  }
});
