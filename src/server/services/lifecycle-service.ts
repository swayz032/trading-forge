/**
 * Strategy Lifecycle Service — state machine for strategy pipeline.
 *
 * Valid transitions:
 * CANDIDATE → TESTING → PAPER → DEPLOY_READY → DEPLOYED → DECLINING → RETIRED → GRAVEYARD
 * DECLINING → TESTING (retry)
 * TESTING → DECLINING (catastrophic failure)
 * PAPER → DECLINING (drift demotion)
 * Every state → GRAVEYARD (terminal burial)
 *
 * DEPLOY_READY is the "strategy library" — strategies that passed paper trading
 * and are ready for human review. Only manual approval moves them to DEPLOYED.
 * The system NEVER auto-deploys to TradingView.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyNames, strategyGraveyard, backtests, auditLog, monteCarloRuns } from "../db/schema.js";
import { logger } from "../index.js";
import { evolveStrategy } from "./evolution-service.js";
import { AlertFactory } from "./alert-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { compilePineExport } from "./pine-export-service.js";

const VALID_STATES = [
  "CANDIDATE",
  "TESTING",
  "PAPER",
  "DEPLOY_READY",
  "DEPLOYED",
  "DECLINING",
  "RETIRED",
  "GRAVEYARD",
] as const;

type LifecycleState = (typeof VALID_STATES)[number];

interface PromoteStrategyOptions {
  actor?: "system" | "human_release";
  reason?: string;
}

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  CANDIDATE: ["TESTING", "GRAVEYARD"],
  TESTING: ["PAPER", "DECLINING", "GRAVEYARD"],  // Demotable on catastrophic failure
  PAPER: ["DEPLOY_READY", "DECLINING", "GRAVEYARD"],  // Demotable on drift
  DEPLOY_READY: ["DEPLOYED", "PAPER", "GRAVEYARD"],  // Human approves deploy OR sends back to paper
  DEPLOYED: ["DECLINING", "GRAVEYARD"],
  DECLINING: ["TESTING", "RETIRED", "GRAVEYARD"],
  RETIRED: ["GRAVEYARD"],
  GRAVEYARD: [],  // Terminal state
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
    options: PromoteStrategyOptions = {},
  ): Promise<{ success: boolean; error?: string }> {
    if (fromState === "DEPLOY_READY" && toState === "DEPLOYED" && options.actor !== "human_release") {
      const error = "Only manual release authority can promote DEPLOY_READY -> DEPLOYED";
      logger.warn({ id, fromState, toState, actor: options.actor ?? "system" }, error);
      return { success: false, error };
    }

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

    // Bury in graveyard on demotion to DECLINING (on-demotion per System Map).
    // This captures the strategy's last known metrics before it is potentially retried
    // or retired, giving the graveyard a full record of why it was demoted.
    if (toState === "DECLINING") {
      this.buryInGraveyard(id, strategy).catch((buryErr) => {
        logger.warn({ strategyId: id, err: buryErr }, "Failed to auto-bury declining strategy in graveyard (non-blocking)");
      });
    }

    // Retire Forge name when strategy transitions to RETIRED.
    // Graveyard entry was already created on DECLINING; don't double-insert.
    if (toState === "RETIRED") {
      // Retire the Forge name
      try {
        const [retiredName] = await db
          .update(strategyNames)
          .set({ retired: true, retiredAt: new Date() })
          .where(eq(strategyNames.strategyId, id))
          .returning();
        if (retiredName) {
          logger.info({ strategyId: id, codename: retiredName.codename }, "Forge name retired with strategy");
        }
      } catch (retireErr) {
        logger.warn(retireErr, "Failed to retire Forge name (non-blocking)");
      }

      // Graveyard: upsert (buryInGraveyard is already idempotent — skips if row exists)
      this.buryInGraveyard(id, strategy).catch((buryErr) => {
        logger.warn({ strategyId: id, err: buryErr }, "Failed to auto-bury retired strategy in graveyard (non-blocking)");
      });
    }

    // Audit log
    await db.insert(auditLog).values({
      action: "strategy.lifecycle",
      entityType: "strategy",
      entityId: id,
      input: { fromState, toState },
      result: {
        success: true,
        actor: options.actor ?? "system",
        reason: options.reason ?? null,
      },
      status: "success",
      decisionAuthority: options.actor === "human_release" ? "human" : "gate",
    });

    logger.info({ id, fromState, toState }, "Strategy lifecycle transition");
    return { success: true };
  }

  /**
   * Bury a retired strategy in the graveyard for duplicate-checking.
   * Loads the latest backtest, extracts failure modes, inserts graveyard row.
   */
  private async buryInGraveyard(
    strategyId: string,
    strategy: { name: string; config: unknown },
  ): Promise<void> {
    // Check if already buried (idempotent)
    const [existing] = await db
      .select({ id: strategyGraveyard.id })
      .from(strategyGraveyard)
      .where(eq(strategyGraveyard.strategyId, strategyId))
      .limit(1);
    if (existing) return;

    // Fetch latest completed backtest for failure analysis
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    // Derive failure modes from metrics
    const failureModes: string[] = [];
    if (latestBt) {
      const sharpe = Number(latestBt.sharpeRatio ?? 0);
      const pf = Number(latestBt.profitFactor ?? 0);
      const wr = Number(latestBt.winRate ?? 0);
      const dd = Number(latestBt.maxDrawdown ?? 0);
      const avgDaily = Number(latestBt.avgDailyPnl ?? 0);

      if (sharpe < 0.8) failureModes.push("low_sharpe");
      if (pf < 1.0) failureModes.push("unprofitable");
      if (wr < 0.4) failureModes.push("low_win_rate");
      if (dd > 3000) failureModes.push("excessive_drawdown");
      if (avgDaily < 250) failureModes.push("below_minimum_daily_pnl");
      if (latestBt.tier === "REJECTED") failureModes.push("rejected_by_gate");
    }
    if (failureModes.length === 0) failureModes.push("alpha_decay");

    const backtestSummary = latestBt
      ? {
          sharpe: latestBt.sharpeRatio,
          profitFactor: latestBt.profitFactor,
          winRate: latestBt.winRate,
          maxDrawdown: latestBt.maxDrawdown,
          avgDailyPnl: latestBt.avgDailyPnl,
          tier: latestBt.tier,
          totalTrades: latestBt.totalTrades,
        }
      : null;

    await db.insert(strategyGraveyard).values({
      strategyId,
      name: strategy.name,
      dslSnapshot: strategy.config ?? {},
      failureModes,
      failureDetails: { backtestId: latestBt?.id ?? null, autoAnalysis: true },
      backtestSummary,
      deathReason: `Auto-retired: ${failureModes.join(", ")}`,
      deathDate: new Date(),
      source: "auto",
    });

    // Audit trail — graveyard burial is a non-reversible terminal transition
    await db.insert(auditLog).values({
      action: "strategy.graveyard_burial",
      entityType: "strategy",
      entityId: strategyId,
      input: {
        name: strategy.name,
        source: "auto",
        failureModes,
      },
      result: {
        deathReason: `Auto-retired: ${failureModes.join(", ")}`,
        backtestId: latestBt?.id ?? null,
        backtestSummary,
      },
      status: "success",
      decisionAuthority: "gate",
    });

    // Fire alert for visibility
    AlertFactory.decayAlert(strategyId, "retire").catch(() => {});

    logger.info(
      { strategyId, failureModes, name: strategy.name },
      "Strategy auto-buried in graveyard",
    );
  }

  /**
   * Check for auto-promotions across all lifecycle gates:
   *   1. CANDIDATE → TESTING  (backtest + WF + tier + forgeScore)
   *   2. TESTING → PAPER      (MC survival + tier)
   *   3. PAPER → DEPLOY_READY (30 profitable days + rolling Sharpe)
   *
   * DEPLOY_READY → DEPLOYED is ALWAYS manual. The system NEVER auto-deploys.
   */
  async checkAutoPromotions(): Promise<string[]> {
    const promoted: string[] = [];

    // ──────────────────────────────────────────────────────────────
    // Gate 1: CANDIDATE → TESTING
    // Requires: completed backtest with walk-forward, non-REJECTED tier, forgeScore >= 50
    // ──────────────────────────────────────────────────────────────
    const candidates = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "CANDIDATE"));

    for (const s of candidates) {
      try {
        // Find latest completed backtest
        const [latestBt] = await db
          .select()
          .from(backtests)
          .where(
            and(
              eq(backtests.strategyId, s.id),
              eq(backtests.status, "completed"),
            ),
          )
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (!latestBt) continue;
        if (!latestBt.walkForwardResults) continue;

        const tier = latestBt.tier;
        if (!tier || tier === "REJECTED") continue;

        const forgeScore = s.forgeScore ? parseFloat(String(s.forgeScore)) : 0;
        if (forgeScore < 50) continue;

        const result = await this.promoteStrategy(s.id, "CANDIDATE", "TESTING");
        if (result.success) {
          promoted.push(s.id);

          broadcastSSE("lifecycle:promoted", {
            strategyId: s.id,
            from: "CANDIDATE",
            to: "TESTING",
            name: s.name,
            forgeScore,
            tier,
          });

          logger.info(
            { id: s.id, forgeScore, tier },
            "Auto-promoted CANDIDATE → TESTING",
          );
        }
      } catch (err) {
        logger.error({ strategyId: s.id, err }, "Error checking CANDIDATE → TESTING promotion");
      }
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 2: TESTING → PAPER
    // Requires: completed backtest with WF, MC survival > 0.70, non-REJECTED tier
    // Prop compliance is checked if data exists but does NOT block if absent
    // ──────────────────────────────────────────────────────────────
    const testingStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "TESTING"));

    for (const s of testingStrategies) {
      try {
        // Find latest completed backtest with walk-forward
        const [latestBt] = await db
          .select()
          .from(backtests)
          .where(
            and(
              eq(backtests.strategyId, s.id),
              eq(backtests.status, "completed"),
            ),
          )
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (!latestBt) continue;
        if (!latestBt.walkForwardResults) continue;

        const tier = latestBt.tier;
        if (!tier || tier === "REJECTED") continue;

        // Check MC survival rate > 0.70
        const [mcRun] = await db
          .select({
            probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
          })
          .from(monteCarloRuns)
          .where(eq(monteCarloRuns.backtestId, latestBt.id))
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1);

        if (!mcRun) continue;

        const ruinProb = mcRun.probabilityOfRuin != null ? parseFloat(String(mcRun.probabilityOfRuin)) : null;
        if (ruinProb === null) continue;

        const survivalRate = 1 - ruinProb;
        if (survivalRate <= 0.70) {
          logger.debug(
            { id: s.id, survivalRate: survivalRate.toFixed(3) },
            "TESTING → PAPER blocked: MC survival rate <= 0.70",
          );
          continue;
        }

        // Prop compliance: check backtests.propCompliance if present, but don't block if absent
        // The propCompliance field is a per-firm results blob set during backtest
        if (latestBt.propCompliance) {
          const propResults = latestBt.propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
          const anyPassing = Object.values(propResults).some(
            (r) => r.passed === true || r.pass === true,
          );
          if (!anyPassing) {
            logger.debug(
              { id: s.id },
              "TESTING → PAPER blocked: no passing prop compliance result",
            );
            continue;
          }
        }
        // If propCompliance is null/undefined, skip this check — don't block on missing optional data

        const result = await this.promoteStrategy(s.id, "TESTING", "PAPER");
        if (result.success) {
          promoted.push(s.id);

          broadcastSSE("lifecycle:promoted", {
            strategyId: s.id,
            from: "TESTING",
            to: "PAPER",
            name: s.name,
            survivalRate: survivalRate.toFixed(3),
            tier,
          });

          logger.info(
            { id: s.id, survivalRate: survivalRate.toFixed(3), tier },
            "Auto-promoted TESTING → PAPER",
          );
        }
      } catch (err) {
        logger.error({ strategyId: s.id, err }, "Error checking TESTING → PAPER promotion");
      }
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 3: PAPER → DEPLOY_READY (existing logic — 30 days + rolling Sharpe >= 1.5)
    // After promotion, fire-and-forget Pine compile for TradingView export.
    // DEPLOY_READY → DEPLOYED remains HUMAN-ONLY.
    // ──────────────────────────────────────────────────────────────
    const paperStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "PAPER"));

    for (const s of paperStrategies) {
      if (!s.lifecycleChangedAt) continue;

      const daysSincePaper = Math.floor(
        (Date.now() - s.lifecycleChangedAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      const rollingSharpe = s.rollingSharpe30d ? parseFloat(String(s.rollingSharpe30d)) : 0;
      if (daysSincePaper >= 30 && rollingSharpe >= 1.5) {
        const result = await this.promoteStrategy(s.id, "PAPER", "DEPLOY_READY");
        if (result.success) {
          promoted.push(s.id);

          // Alert the human — strategy is ready for deployment review
          broadcastSSE("strategy:deploy-ready", {
            strategyId: s.id,
            name: s.name,
            symbol: s.symbol,
            rollingSharpe,
            daysSincePaper,
            message: `Strategy "${s.name}" qualified for deployment — review in library`,
          });

          AlertFactory.deployReady(
            s.id,
            `Strategy "${s.name}" is DEPLOY_READY — Sharpe ${rollingSharpe.toFixed(2)}, ${daysSincePaper} days paper. Awaiting your approval.`,
          ).catch(() => {});

          logger.info(
            { id: s.id, rollingSharpe, daysSincePaper },
            "Strategy moved to DEPLOY_READY library — awaiting human approval",
          );

          // Fire-and-forget: compile Pine export for TradingView
          this.triggerPineCompile(s.id).catch((pineErr) => {
            logger.warn(
              { strategyId: s.id, err: pineErr },
              "Pine compile failed after DEPLOY_READY promotion (non-blocking)",
            );
          });
        }
      } else if (daysSincePaper >= 30 && rollingSharpe < 1.5) {
        logger.warn({ id: s.id, rollingSharpe, daysSincePaper }, "DEPLOY_READY blocked: rolling Sharpe < 1.5");
      }
    }

    return promoted;
  }

  /**
   * Fire-and-forget Pine compile for a strategy that just reached DEPLOY_READY.
   * Fetches latest backtest + MC data to build risk intelligence for the export.
   */
  private async triggerPineCompile(strategyId: string): Promise<void> {
    // Fetch strategy for firm association
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, strategyId));

    if (!strategy) return;

    // Find latest completed backtest
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    // Build risk intelligence from MC if available
    let riskIntelligence: Record<string, number | string | null> | null = null;
    if (latestBt) {
      const [mcRun] = await db
        .select({
          probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
          sharpeP50: monteCarloRuns.sharpeP50,
          riskMetrics: monteCarloRuns.riskMetrics,
        })
        .from(monteCarloRuns)
        .where(eq(monteCarloRuns.backtestId, latestBt.id))
        .orderBy(desc(monteCarloRuns.createdAt))
        .limit(1);

      if (mcRun) {
        const ruinProb = mcRun.probabilityOfRuin != null ? Number(mcRun.probabilityOfRuin) : null;
        const survivalRate = ruinProb != null ? 1 - ruinProb : null;
        const rm = (mcRun.riskMetrics as Record<string, unknown> | null) ?? {};
        const breachProb = rm.breach_probability != null ? Number(rm.breach_probability) : null;
        const sharpeP50 = mcRun.sharpeP50 != null ? Number(mcRun.sharpeP50) : null;

        riskIntelligence = {
          breach_probability: breachProb,
          ruin_probability: ruinProb,
          survival_rate: survivalRate,
          mc_sharpe_p50: sharpeP50,
        };
      }
    }

    // Derive firm key from prop compliance if available
    let firmKey = "topstep_50k";
    if (latestBt?.propCompliance) {
      const propResults = latestBt.propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
      const passingFirm = Object.entries(propResults).find(
        ([, r]) => r.passed === true || r.pass === true,
      );
      if (passingFirm) {
        firmKey = passingFirm[0];
      }
    }

    const result = await compilePineExport(strategyId, firmKey, "pine_indicator", riskIntelligence);
    logger.info(
      { strategyId, firmKey, exportId: result?.id },
      "Pine compile completed for DEPLOY_READY strategy",
    );
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

    // Alert if strategies waiting for deployment approval
    if (counts.DEPLOY_READY > 0) {
      alerts.push(`${counts.DEPLOY_READY} strateg${counts.DEPLOY_READY === 1 ? "y" : "ies"} ready for deployment — review at GET /api/strategies/library`);
    }

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
