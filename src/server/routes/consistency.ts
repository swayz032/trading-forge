/**
 * consistency.ts — Wave 26 Pass 6
 *
 * REST endpoint exposing the Topstep consistency tracker state per account.
 *
 * GET /api/consistency/:accountId
 *   Returns ConsistencyState for the given broker account.
 *   Frontend wiring is deferred to Pass 2; this route provides the backend contract.
 *
 * NOTE: paper-signal-service.ts integration (shouldBlockNewEntry wiring into
 * the entry gate sequence) is the responsibility of a future coordination pass
 * and is explicitly OUT OF SCOPE for Wave 26 Pass 6. Do not modify
 * paper-signal-service.ts in this pass.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { getConsistencyState } from "../services/consistency-tracker-service.js";

export const consistencyRoutes = Router();

/**
 * GET /api/consistency/:accountId
 *
 * Returns the current ConsistencyState for a Topstep account.
 * The ?asOf=YYYY-MM-DDTHH:MM:SSZ query parameter allows time-travel for testing.
 */
consistencyRoutes.get("/:accountId", async (req: Request, res: Response) => {
  const accountId = String(req.params.accountId);
  const asOfParam = req.query.asOf;

  let asOf: Date = new Date();
  if (typeof asOfParam === "string" && asOfParam.trim().length > 0) {
    const parsed = new Date(asOfParam);
    if (!isNaN(parsed.getTime())) {
      asOf = parsed;
    } else {
      res.status(400).json({ error: "invalid_asOf", message: "asOf must be a valid ISO 8601 datetime string" });
      return;
    }
  }

  try {
    // deep-scan 2026-07-11 MED fix: dryRun=true — a GET status endpoint MUST be read-only. Without it,
    // dryRun defaulted false, so querying an account at >=40%/>=50% fired a real Discord CRITICAL and
    // wrote consistency.50pct_blocked/40pct_warned audit rows — falsifying the audit trail and spamming
    // alerts on every dashboard poll. The computed state is identical either way.
    const state = await getConsistencyState(accountId, asOf, true);
    res.json(state);
  } catch (err) {
    logger.error(
      { err, accountId, correlationId: (req as Request & { id?: string }).id },
      "consistency-route: getConsistencyState failed",
    );
    res.status(500).json({
      error: "consistency_compute_failed",
      message: err instanceof Error ? err.message : "Internal error",
    });
  }
});
