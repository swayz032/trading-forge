/**
 * carter-issue-watcher.ts — proactive issue watcher for the Carter voice-agent.
 *
 * Responsibilities:
 *   1. Registers an SSE internal listener (onSseBroadcast) to map system events
 *      into Carter issues (upsert / resolve) in real time.
 *   2. Polls /api/health every CARTER_HEALTH_POLL_MS (default 60s) and tracks
 *      a system_health_degraded issue when health is non-ok.
 *
 * Design invariants:
 *   PIPELINE-GATE EXEMPT — watcher starts unconditionally; it MUST NOT be
 *   gated behind isActive() or any pipeline pause check. It is operational
 *   visibility infrastructure, not a pipeline participant.
 *
 *   FAIL-SOFT — startCarterIssueWatcher() is called inside a try/catch in
 *   index.ts so any startup failure never crashes the API server.
 *
 *   IDEMPOTENT — repeated calls after the first are safe no-ops (_watcherStarted guard).
 *
 *   NO SECRETS — this module MUST NEVER log credentials, tokens, or PII.
 *
 * Wave 4 backend, 2026-06-28.
 */

import { onSseBroadcast } from "../routes/sse.js";
import {
  upsertIssue,
  resolveIssue,
  hydrateFromDb,
} from "../lib/carter/carter-issues-store.js";
import { logger } from "../lib/logger.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const HEALTH_POLL_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env["CARTER_HEALTH_POLL_MS"] ?? 60_000),
);
const _serverPort = Number(process.env["PORT"] ?? 4000);
const HEALTH_ENDPOINT = `http://localhost:${_serverPort}/api/health`;

// ─── SSE event → Carter issue mappings ───────────────────────────────────────
//
// RULES:
//   - Only map events that represent actionable system problems.
//   - Each event class uses a stable issue_key (no random UUIDs in keys —
//     the key is used for dedup; same class = same key = upsert, not create).
//   - Resolve only when a clear complementary "recovery" event arrives.
//   - Unknown events are silently ignored.

function _handleSseEvent(event: string, data: unknown): void {
  try {
    const p =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : {};

    switch (event) {
      // ── alert:triggered — surface any alert sent via /api/sse/broadcast ──
      case "alert:triggered": {
        const rawSeverity = typeof p["severity"] === "string" ? p["severity"] : "warning";
        const severity =
          rawSeverity === "critical" || rawSeverity === "warning" || rawSeverity === "info"
            ? (rawSeverity as "critical" | "warning" | "info")
            : "warning";
        const title    = typeof p["title"]   === "string" ? p["title"]   : "Alert triggered";
        const detail   = typeof p["message"] === "string" ? p["message"] : undefined;
        const alertType = typeof p["alertType"] === "string"
          ? p["alertType"].toLowerCase().replace(/\s+/g, "_").slice(0, 60)
          : title.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60);
        upsertIssue({
          issue_key:    `alert:${alertType}`,
          severity,
          title,
          detail,
          source_event: event,
        });
        break;
      }

      // ── lifecycle:auto_graveyard — strategy moved to GRAVEYARD by automation ──
      case "lifecycle:auto_graveyard": {
        const strategyId = typeof p["strategyId"] === "string" ? p["strategyId"] : "unknown";
        upsertIssue({
          issue_key:    `auto_graveyard:${strategyId}`,
          severity:     "warning",
          title:        "Strategy auto-graveyarded",
          detail:       `Strategy ${strategyId} moved to GRAVEYARD after consecutive hard gate failures.`,
          source_event: event,
        });
        break;
      }

      // ── quantum_rl:kill_switch_engaged — RL kill switch tripped ───────────
      case "quantum_rl:kill_switch_engaged": {
        const strategyId = typeof p["strategy_id"] === "string" ? p["strategy_id"] : "unknown";
        const reason     = typeof p["reason"]      === "string" ? p["reason"]      : undefined;
        upsertIssue({
          issue_key:    `rl_kill_switch:${strategyId}`,
          severity:     "critical",
          title:        "RL kill switch engaged",
          detail:       reason
            ? `Strategy ${strategyId}: ${reason}`
            : `Strategy ${strategyId} — RL kill switch tripped.`,
          source_event: event,
        });
        break;
      }

      // ── paper:handler_error — paper trading handler threw ─────────────────
      case "paper:handler_error": {
        const sessionId = typeof p["session_id"] === "string" ? p["session_id"] : "unknown";
        const errMsg    = typeof p["error"]      === "string" ? p["error"]      : undefined;
        upsertIssue({
          issue_key:    `paper_handler_error:${sessionId}`,
          severity:     "warning",
          title:        "Paper handler error",
          detail:       errMsg ?? `Session ${sessionId} encountered a paper handler error.`,
          source_event: event,
        });
        break;
      }

      // ── dead_mans_heartbeat:missed — heartbeat missed ─────────────────────
      case "dead_mans_heartbeat:missed": {
        upsertIssue({
          issue_key:    "heartbeat_missed",
          severity:     "critical",
          title:        "Dead-man's heartbeat missed",
          detail:       "Automation heartbeat has not fired within the expected window.",
          source_event: event,
        });
        break;
      }

      case "dead_mans_heartbeat:ok": {
        resolveIssue("heartbeat_missed");
        break;
      }

      default:
        // Unknown event — no mapping; silent drop
        break;
    }
  } catch (err) {
    // Defensive catch — listener errors must never propagate upward
    logger.warn({ err, event }, "carter-issue-watcher: SSE handler threw (non-fatal)");
  }
}

// ─── Health polling ───────────────────────────────────────────────────────────

const HEALTH_ISSUE_KEY = "system_health_degraded";

export async function _pollHealth(): Promise<void> {
  try {
    const res = await fetch(HEALTH_ENDPOINT, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      upsertIssue({
        issue_key:    HEALTH_ISSUE_KEY,
        severity:     "warning",
        title:        "Health check returned non-200",
        detail:       `GET /api/health returned HTTP ${res.status}`,
        source_event: "health_poll",
      });
      return;
    }

    const body = (await res.json()) as { status?: string };
    if (body.status !== "ok") {
      upsertIssue({
        issue_key:    HEALTH_ISSUE_KEY,
        severity:     "warning",
        title:        "System health degraded",
        detail:       `Health status: ${body.status ?? "unknown"}`,
        source_event: "health_poll",
      });
    } else {
      // System recovered — clear the issue
      resolveIssue(HEALTH_ISSUE_KEY);
    }
  } catch (err) {
    // Network error / timeout — may happen briefly during startup; don't alarm
    logger.warn(
      { err },
      "carter-issue-watcher: health poll failed (non-fatal — will retry next interval)",
    );
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

let _watcherStarted = false;

/**
 * startCarterIssueWatcher — start the proactive issue watcher.
 *
 * Sequence:
 *   1. Hydrate in-memory issue map from DB (fail-soft).
 *   2. Register SSE internal listener.
 *   3. Start health-poll setInterval.
 *
 * PIPELINE-GATE EXEMPT: call this unconditionally — NOT behind isActive().
 * FAIL-SOFT: wrapped at call site in index.ts so errors never crash the API.
 * IDEMPOTENT: subsequent calls are no-ops.
 */
export async function startCarterIssueWatcher(): Promise<void> {
  if (_watcherStarted) return;
  _watcherStarted = true;

  // 1. Hydrate in-memory map from DB (fail-soft inside hydrateFromDb)
  await hydrateFromDb();

  // 2. Register SSE listener
  onSseBroadcast(_handleSseEvent);
  logger.info("carter-issue-watcher: SSE internal listener registered");

  // 3. Start health-poll interval
  setInterval(() => {
    _pollHealth().catch((err) => {
      logger.warn({ err }, "carter-issue-watcher: health poll promise rejected (non-fatal)");
    });
  }, HEALTH_POLL_INTERVAL_MS);

  logger.info(
    { pollIntervalMs: HEALTH_POLL_INTERVAL_MS, healthEndpoint: HEALTH_ENDPOINT },
    "carter-issue-watcher: started",
  );
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exposed for testing — resets the started flag. Do NOT call in production. */
export function _resetWatcherForTest(): void {
  _watcherStarted = false;
}

/** Exposed for testing — directly invoke the SSE event handler. */
export function _handleSseEventForTest(event: string, data: unknown): void {
  _handleSseEvent(event, data);
}
