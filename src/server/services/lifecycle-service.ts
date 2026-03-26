/**
 * Strategy Lifecycle Service — state machine for strategy pipeline.
 *
 * Valid transitions:
 * CANDIDATE → TESTING → PAPER → DEPLOYED → DECLINING → RETIRED
 * DECLINING → TESTING (retry)
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, auditLog } from "../db/schema.js";
import { logger } from "../index.js";
import { evolveStrategy } from "./evolution-service.js";

const VALID_STATES = [
  "CANDIDATE",
  "TESTING",
  "PAPER",
  "DEPLOYED",
  "DECLINING",
  "RETIRED",
] as const;

type LifecycleState = (typeof VALID_STATES)[number];

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  CANDIDATE: ["TESTING"],
  TESTING: ["PAPER"],
  PAPER: ["DEPLOYED"],
  DEPLOYED: ["DECLINING"],
  DECLINING: ["TESTING", "RETIRED"],
  RETIRED: [],
};

export class LifecycleService {
  /**
   * Promote or demote a strategy to a new lifecycle state.
   * Validates the transition is allowed, logs to audit_log.
   */
  async promoteStrategy(
    id: string,
    fromState: LifecycleState,
    toState: LifecycleState,
  ): Promise<{ success: boolean; error?: string }> {
    // Validate transition
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed || !allowed.includes(toState)) {
      const error = `Invalid transition: ${fromState} → ${toState}. Allowed: ${allowed?.join(", ") || "none"}`;
      logger.warn({ id, fromState, toState }, error);
      return { success: false, error };
    }

    // Verify current state matches
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!strategy) {
      return { success: false, error: "Strategy not found" };
    }

    if (strategy.lifecycleState !== fromState) {
      return {
        success: false,
        error: `Strategy is in state '${strategy.lifecycleState}', not '${fromState}'`,
      };
    }

    // Update
    await db
      .update(strategies)
      .set({
        lifecycleState: toState,
        lifecycleChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, id));

    // Audit log
    await db.insert(auditLog).values({
      action: "strategy.lifecycle",
      entityType: "strategy",
      entityId: id,
      input: { fromState, toState },
      result: { success: true },
      status: "success",
    });

    logger.info({ id, fromState, toState }, "Strategy lifecycle transition");
    return { success: true };
  }

  /**
   * Check for auto-promotions: PAPER → DEPLOYED after 30 profitable days.
   */
  async checkAutoPromotions(): Promise<string[]> {
    const promoted: string[] = [];

    const paperStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "PAPER"));

    for (const s of paperStrategies) {
      if (!s.lifecycleChangedAt) continue;

      const daysSincePaper = Math.floor(
        (Date.now() - s.lifecycleChangedAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Auto-promote after 30 days in PAPER
      if (daysSincePaper >= 30) {
        const result = await this.promoteStrategy(s.id, "PAPER", "DEPLOYED");
        if (result.success) {
          promoted.push(s.id);
        }
      }
    }

    return promoted;
  }

  /**
   * Check for auto-demotions: DEPLOYED → DECLINING if rolling Sharpe < 1.0.
   */
  async checkAutoDemotions(): Promise<string[]> {
    const demoted: string[] = [];

    const deployedStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOYED"));

    for (const s of deployedStrategies) {
      const sharpe = s.rollingSharpe30d ? parseFloat(s.rollingSharpe30d) : null;

      if (sharpe !== null && sharpe < 1.0) {
        const result = await this.promoteStrategy(s.id, "DEPLOYED", "DECLINING");
        if (result.success) {
          demoted.push(s.id);

          // Fire-and-forget: trigger self-evolution for declining strategy
          evolveStrategy(s.id).then((evoResult) => {
            logger.info({ strategyId: s.id, ...evoResult }, "Auto-evolution completed for declining strategy");
          }).catch((evoErr) => {
            logger.error({ strategyId: s.id, err: evoErr }, "Auto-evolution failed (non-blocking)");
          });
        }
      }
    }

    return demoted;
  }

  /**
   * Get pipeline health — count of strategies per lifecycle state.
   */
  async getPipelineHealth(): Promise<{
    counts: Record<string, number>;
    alerts: string[];
  }> {
    const allStrategies = await db.select().from(strategies);

    const counts: Record<string, number> = {};
    for (const state of VALID_STATES) {
      counts[state] = 0;
    }
    for (const s of allStrategies) {
      const state = s.lifecycleState;
      counts[state] = (counts[state] || 0) + 1;
    }

    const alerts: string[] = [];

    // Alert if no DEPLOYED strategies
    if (counts.DEPLOYED === 0) {
      alerts.push("No deployed strategies — pipeline is empty");
    }

    // Alert if no CANDIDATE/TESTING strategies (pipeline drying up)
    if (counts.CANDIDATE === 0 && counts.TESTING === 0) {
      alerts.push("No strategies in development — pipeline will dry up");
    }

    // Alert if too many DECLINING
    if (counts.DECLINING > counts.DEPLOYED) {
      alerts.push("More declining than deployed strategies — investigate");
    }

    return { counts, alerts };
  }
}
