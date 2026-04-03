/**
 * Agent Coordinator Service — Phase 5: SSE-Based Inter-Agent Events
 *
 * Provides a typed event bus for agent-to-agent communication.
 * Each agent domain can emit events and subscribe to events from
 * other domains. Built on the existing SSE broadcast infrastructure.
 *
 * This avoids tight coupling between services — agents communicate
 * through typed events rather than direct imports.
 */

import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

// ─── Event Types ────────────────────────────────────────────────────

export type AgentEvent =
  | { type: "strategy:promoted"; payload: { strategyId: string; from: string; to: string } }
  | { type: "strategy:demoted"; payload: { strategyId: string; from: string; to: string; reason: string } }
  | { type: "drift:detected"; payload: { strategyId: string; sessionId: string; maxDeviation: number } }
  | { type: "compliance:invalidated"; payload: { firm: string; affectedStrategies: string[]; reason: string } }
  | { type: "compliance:revalidated"; payload: { firm: string; rulesetId: string } }
  | { type: "critic:completed"; payload: { runId: string; strategyId: string; outcome: string } }
  | { type: "deepar:forecast"; payload: { symbol: string; pHighVol: number; pTrending: number } }
  | { type: "decay:warning"; payload: { strategyId: string; decayScore: number; action: string } }
  | { type: "paper:session_started"; payload: { sessionId: string; strategyId: string } }
  | { type: "paper:session_stopped"; payload: { sessionId: string; strategyId: string; reason: string } }
  | { type: "risk:drawdown_breach"; payload: { sessionId: string; strategyId: string; drawdown: number } }
  | { type: "portfolio:heat_warning"; payload: { totalHeat: number; flaggedPairs: number } }
  | { type: "health:domain_down"; payload: { domain: string; message: string } }
  | { type: "meta:parameter_changed"; payload: { param: string; oldValue: number; newValue: number; reason: string } };

type EventHandler<T extends AgentEvent["type"]> = (
  payload: Extract<AgentEvent, { type: T }>["payload"],
) => void | Promise<void>;

// ─── Coordinator ────────────────────────────────────────────────────

class AgentCoordinator {
  private handlers = new Map<string, Array<EventHandler<any>>>();
  private eventLog: Array<{ timestamp: string; type: string; payload: unknown }> = [];
  private maxLogSize = 1000;

  /**
   * Subscribe to an agent event type.
   * Returns an unsubscribe function.
   */
  on<T extends AgentEvent["type"]>(
    eventType: T,
    handler: EventHandler<T>,
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);

    return () => {
      const list = this.handlers.get(eventType);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  /**
   * Emit an agent event. Broadcasts via SSE and notifies all local subscribers.
   * Handlers run in parallel, errors are logged but never propagate.
   */
  async emit<T extends AgentEvent["type"]>(
    eventType: T,
    payload: Extract<AgentEvent, { type: T }>["payload"],
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    // Log to internal ring buffer
    this.eventLog.push({ timestamp, type: eventType, payload });
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }

    // Broadcast to SSE clients (dashboard)
    broadcastSSE(`agent:${eventType}`, { ...payload, timestamp });

    // Notify local subscribers
    const handlers = this.handlers.get(eventType) ?? [];
    const settled = await Promise.allSettled(
      handlers.map((h) => {
        try {
          return Promise.resolve(h(payload));
        } catch (err) {
          return Promise.reject(err);
        }
      }),
    );

    const failures = settled.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      logger.warn(
        { eventType, failureCount: failures.length },
        "Agent coordinator: some handlers failed",
      );
    }
  }

  /**
   * Get recent event log (most recent first).
   */
  getRecentEvents(limit: number = 50): Array<{ timestamp: string; type: string; payload: unknown }> {
    return this.eventLog.slice(-limit).reverse();
  }

  /**
   * Get all registered event types and their handler counts.
   */
  getSubscriptionSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const [type, handlers] of this.handlers) {
      summary[type] = handlers.length;
    }
    return summary;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const agentCoordinator = new AgentCoordinator();

// ─── Default Cross-Domain Wiring ────────────────────────────────────

/**
 * Set up default cross-domain event handlers.
 * Call once during server initialization.
 */
export function initAgentCoordination(): void {
  // When compliance is invalidated, log a critical alert
  agentCoordinator.on("compliance:invalidated", (payload) => {
    logger.warn(
      { firm: payload.firm, affected: payload.affectedStrategies.length },
      `Compliance cascade: ${payload.firm} invalidated — ${payload.affectedStrategies.length} strategies affected`,
    );
  });

  // When a domain goes down, broadcast a critical alert
  agentCoordinator.on("health:domain_down", (payload) => {
    logger.error({ domain: payload.domain }, `Agent domain DOWN: ${payload.domain}`);
    broadcastSSE("alert:triggered", {
      type: "agent_domain_down",
      domain: payload.domain,
      message: payload.message,
      severity: "critical",
    });
  });

  // When drawdown is breached, broadcast urgently
  agentCoordinator.on("risk:drawdown_breach", (payload) => {
    logger.error(
      { sessionId: payload.sessionId, drawdown: payload.drawdown },
      "Drawdown breach detected by agent coordinator",
    );
  });

  // When portfolio heat is high, broadcast
  agentCoordinator.on("portfolio:heat_warning", (payload) => {
    logger.warn(
      { totalHeat: payload.totalHeat, flaggedPairs: payload.flaggedPairs },
      "Portfolio heat warning from correlation learning",
    );
  });

  logger.info("Agent coordinator: default cross-domain wiring initialized");
}
