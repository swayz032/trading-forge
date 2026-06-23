/**
 * ollama-keepwarm-watchdog-service.ts
 *
 * Self-healing keep-warm watchdog for the local Ollama/gemma transcript-extractor
 * dependency. Fires on a 4-minute cron, every hour of every day (no RTH gate,
 * no pipeline gate).
 *
 * PURPOSE:
 *   The gemma4:e2b cold-load spiral (diagnosed 2026-06-23) occurs when:
 *     1. Model idles out of VRAM (keep_alive expires)
 *     2. Next caller cold-loads → takes >60s → timeout → Ollama ABORTS load
 *     3. Next caller cold-loads again → aborts again → forever
 *
 *   This watchdog prevents the spiral by:
 *     A. Probing Ollama every 4 minutes with keep_alive:-1 to BOTH verify health
 *        AND pin the model in VRAM (prevents idle-out)
 *     B. Running a 3-step recovery ladder on DEGRADED/DOWN:
 *        Step A: patient warm-load (keep_alive:-1, 300s)
 *        Step B: model reset (unload keep_alive:0 then immediate warm keep_alive:-1)
 *        Step C: set OLLAMA_HEALTHY=false → route to cloud fallback, emit deduped alert
 *     C. Auto-closing on recovery (calls recheckOllamaHealth, resets dedup key)
 *
 * HARD CONSTRAINTS:
 *   - No OS process spawning or killing
 *   - keep_alive:0 is ONLY used in Step B, immediately followed by keep_alive:-1
 *   - OLLAMA_HEALTHY=false is set only as last resort (Step C) — cloud fallback takes over
 *   - Alert deduped via alert-dedup.ts (1h window, escalation exception)
 *   - All audit events via insertAuditRowSafe (fail-soft, never throws)
 *   - Never throws out of the cron tick — fully fail-soft
 *
 * ENV VARS:
 *   OLLAMA_WATCHDOG_ENABLED          — default "true"; set "false" to disable
 *   OLLAMA_WATCHDOG_PROBE_MS         — probe timeout in ms, default 120000 (2 min)
 *   OLLAMA_WATCHDOG_INTERVAL_MIN     — cron interval in minutes (informational; actual
 *                                      cron string must match), default 4
 *   OLLAMA_WATCHDOG_STEP_A_TIMEOUT_MS — Step A patient warm timeout, default 300000 (5 min)
 *   OLLAMA_WATCHDOG_STEP_B_UNLOAD_MS  — Step B unload timeout, default 30000 (30s)
 *   OLLAMA_WATCHDOG_STEP_B_WARM_MS    — Step B re-warm timeout, default 300000 (5 min)
 *   ALERT_DEDUP_WINDOW_MS            — shared with alert-dedup.ts, default 3600000 (1h)
 *
 * AUDIT EVENT KEYS:
 *   ollama_watchdog.healthy
 *   ollama_watchdog.degraded
 *   ollama_watchdog.down
 *   ollama_watchdog.recovery_attempt    (step + outcome per attempt)
 *   ollama_watchdog.recovered           (includes consecutive_unhealthy_ticks)
 *   ollama_watchdog.recovery_exhausted
 *   ollama_watchdog.skipped_lock_contention
 *   ollama_watchdog.disabled
 */

import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { shouldEmitAlert, markAlertEmitted, clearAlertKey } from "../lib/alert-dedup.js";
import { notifyCritical, notifyInfo } from "./notification-service.js";
import {
  recheckOllamaHealth,
  setOllamaUnhealthy,
} from "./model-router.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALERT_KEY_CIRCUIT_OPEN = "ollama.circuit_open";
const AUDIT_ENTITY_TYPE = "system" as const;

export type WatchdogHealthClass = "HEALTHY" | "DEGRADED" | "DOWN";

export interface ProbeResult {
  healthClass: WatchdogHealthClass;
  latencyMs: number;
  reason?: string;
}

// ─── Config helpers ───────────────────────────────────────────────────────────

function getOllamaBase(): string {
  return (
    process.env.OLLAMA_HOST ??
    process.env.OLLAMA_BASE_URL ??
    "http://localhost:11434"
  );
}

function getTargetModel(): string {
  return process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";
}

function getProbePms(): number {
  const raw = process.env.OLLAMA_WATCHDOG_PROBE_MS;
  if (!raw) return 120_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

function getStepATimeoutMs(): number {
  const raw = process.env.OLLAMA_WATCHDOG_STEP_A_TIMEOUT_MS;
  if (!raw) return 300_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

function getStepBUnloadMs(): number {
  const raw = process.env.OLLAMA_WATCHDOG_STEP_B_UNLOAD_MS;
  if (!raw) return 30_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

function getStepBWarmMs(): number {
  const raw = process.env.OLLAMA_WATCHDOG_STEP_B_WARM_MS;
  if (!raw) return 300_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

function isWatchdogEnabled(): boolean {
  const raw = (process.env.OLLAMA_WATCHDOG_ENABLED ?? "true").toLowerCase().trim();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

// ─── In-process unhealthy tick counter ───────────────────────────────────────
// Track consecutive unhealthy ticks so recovery audit includes the count.

let _consecutiveUnhealthyTicks = 0;

/** Exported for tests. */
export function _resetConsecutiveUnhealthyForTests(): void {
  _consecutiveUnhealthyTicks = 0;
}

/** Exported for tests. */
export function _getConsecutiveUnhealthyForTests(): number {
  return _consecutiveUnhealthyTicks;
}

// ─── Probe ────────────────────────────────────────────────────────────────────

/**
 * POST /api/chat with keep_alive:-1 to both verify health AND pin the model.
 *
 * Returns HEALTHY if we get a valid non-empty response within timeoutMs.
 * Returns DEGRADED if response is empty/invalid.
 * Returns DOWN if connection refused, timeout, or any fetch error.
 */
export async function probeOllamaHealth(
  ollamaBase: string,
  model: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const response = await fetch(`${ollamaBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        options: { num_predict: 1 },
        keep_alive: -1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Date.now() - t0;

    if (!response.ok) {
      return {
        healthClass: "DOWN",
        latencyMs,
        reason: `HTTP ${response.status}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        healthClass: "DEGRADED",
        latencyMs,
        reason: "invalid_json_response",
      };
    }

    // A valid chat response has message.content
    const content = (body as Record<string, unknown>)?.message;
    if (!content) {
      return {
        healthClass: "DEGRADED",
        latencyMs,
        reason: "empty_or_missing_message",
      };
    }

    return { healthClass: "HEALTHY", latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const reason =
      err instanceof Error
        ? err.name === "AbortError" || err.name === "TimeoutError"
          ? "timeout"
          : err.name === "TypeError"
            ? "connection_refused"
            : err.message.slice(0, 80)
        : String(err).slice(0, 80);
    return { healthClass: "DOWN", latencyMs, reason };
  }
}

// ─── Recovery ladder ──────────────────────────────────────────────────────────

/**
 * POST /api/chat with keep_alive:-1 and a long patient timeout.
 * Used for Step A (patient warm) and Step B part 2 (re-pin after unload).
 */
async function patientWarm(
  ollamaBase: string,
  model: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const resp = await fetch(`${ollamaBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "warmup" }],
        stream: false,
        options: { num_predict: 1 },
        keep_alive: -1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * POST /api/chat with keep_alive:0 to UNLOAD the model.
 * ONLY safe when immediately followed by patientWarm with keep_alive:-1.
 */
async function unloadModel(
  ollamaBase: string,
  model: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const resp = await fetch(`${ollamaBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "unload" }],
        stream: false,
        options: { num_predict: 1 },
        keep_alive: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Main watchdog tick ───────────────────────────────────────────────────────

/**
 * Single watchdog tick. Called by the cron scheduler.
 *
 * Never throws — all errors are caught and audited internally.
 */
export async function runOllamaKeepaliveWatchdogTick(): Promise<void> {
  if (!isWatchdogEnabled()) {
    logger.debug({ jobName: "ollama-keepwarm-watchdog" }, "watchdog disabled — skipping");
    return;
  }

  const correlationId = randomUUID();
  const ollamaBase = getOllamaBase();
  const model = getTargetModel();
  const probeMs = getProbePms();

  logger.debug(
    { correlationId, jobName: "ollama-keepwarm-watchdog", ollamaBase, model, probeMs },
    "ollama-keepwarm-watchdog: tick start",
  );

  try {
    // ── Probe ──────────────────────────────────────────────────
    const probe = await probeOllamaHealth(ollamaBase, model, probeMs);

    if (probe.healthClass === "HEALTHY") {
      _consecutiveUnhealthyTicks = 0;

      logger.debug(
        { correlationId, latencyMs: probe.latencyMs, model },
        "ollama-keepwarm-watchdog: HEALTHY",
      );

      insertAuditRowSafe({
        action: "ollama_watchdog.healthy",
        entityType: AUDIT_ENTITY_TYPE,
        entityId: "ollama",
        correlationId,
        decisionAuthority: "system",
        status: "success",
        result: { latency_ms: probe.latencyMs, model } as Record<string, unknown>,
      }).catch(() => {});
      return;
    }

    // ── DEGRADED or DOWN ───────────────────────────────────────
    _consecutiveUnhealthyTicks++;

    const auditAction =
      probe.healthClass === "DEGRADED"
        ? "ollama_watchdog.degraded"
        : "ollama_watchdog.down";

    logger.warn(
      {
        correlationId,
        healthClass: probe.healthClass,
        reason: probe.reason,
        latencyMs: probe.latencyMs,
        consecutiveUnhealthyTicks: _consecutiveUnhealthyTicks,
        model,
      },
      `ollama-keepwarm-watchdog: ${probe.healthClass}`,
    );

    insertAuditRowSafe({
      action: auditAction,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: "ollama",
      correlationId,
      decisionAuthority: "system",
      status: "warning",
      result: {
        health_class: probe.healthClass,
        reason: probe.reason,
        latency_ms: probe.latencyMs,
        consecutive_unhealthy_ticks: _consecutiveUnhealthyTicks,
        model,
      } as Record<string, unknown>,
    }).catch(() => {});

    // ── Recovery ladder ────────────────────────────────────────
    // Step A: patient warm-load
    logger.info(
      { correlationId, step: "A", timeoutMs: getStepATimeoutMs() },
      "ollama-keepwarm-watchdog: Step A — patient warm-load",
    );
    insertAuditRowSafe({
      action: "ollama_watchdog.recovery_attempt",
      entityType: AUDIT_ENTITY_TYPE,
      entityId: "ollama",
      correlationId,
      decisionAuthority: "system",
      status: "info",
      result: { step: "A", description: "patient_warm_load" } as Record<string, unknown>,
    }).catch(() => {});

    const stepAWarm = await patientWarm(ollamaBase, model, getStepATimeoutMs());
    if (stepAWarm) {
      // Verify health after Step A
      const checkA = await probeOllamaHealth(ollamaBase, model, probeMs);
      if (checkA.healthClass === "HEALTHY") {
        await _onRecovered(correlationId, "A", checkA.latencyMs);
        return;
      }
    }

    logger.warn(
      { correlationId, step: "A", stepAWarm },
      "ollama-keepwarm-watchdog: Step A did not restore health — proceeding to Step B",
    );

    // Step B: model reset (unload then immediate warm)
    // NOTE: keep_alive:0 is ONLY safe here because immediately followed by keep_alive:-1
    logger.info(
      { correlationId, step: "B" },
      "ollama-keepwarm-watchdog: Step B — model reset (unload + re-pin)",
    );
    insertAuditRowSafe({
      action: "ollama_watchdog.recovery_attempt",
      entityType: AUDIT_ENTITY_TYPE,
      entityId: "ollama",
      correlationId,
      decisionAuthority: "system",
      status: "info",
      result: { step: "B", description: "model_reset_unload_then_pin" } as Record<string, unknown>,
    }).catch(() => {});

    await unloadModel(ollamaBase, model, getStepBUnloadMs());
    const stepBWarm = await patientWarm(ollamaBase, model, getStepBWarmMs());

    if (stepBWarm) {
      const checkB = await probeOllamaHealth(ollamaBase, model, probeMs);
      if (checkB.healthClass === "HEALTHY") {
        await _onRecovered(correlationId, "B", checkB.latencyMs);
        return;
      }
    }

    logger.warn(
      { correlationId, step: "B", stepBWarm },
      "ollama-keepwarm-watchdog: Step B did not restore health — proceeding to Step C",
    );

    // Step C: set OLLAMA_HEALTHY=false (routes extraction to cloud fallback)
    // NO OS process spawning. Emit single deduped CRITICAL alert.
    logger.error(
      {
        correlationId,
        step: "C",
        consecutiveUnhealthyTicks: _consecutiveUnhealthyTicks,
        model,
      },
      "ollama-keepwarm-watchdog: Step C — recovery exhausted, setting OLLAMA_HEALTHY=false",
    );

    // Set OLLAMA_HEALTHY=false so extraction routes to cloud fallback
    setOllamaUnhealthy("watchdog_recovery_exhausted");

    insertAuditRowSafe({
      action: "ollama_watchdog.recovery_exhausted",
      entityType: AUDIT_ENTITY_TYPE,
      entityId: "ollama",
      correlationId,
      decisionAuthority: "system",
      status: "error",
      result: {
        step: "C",
        consecutive_unhealthy_ticks: _consecutiveUnhealthyTicks,
        model,
        action_taken: "ollama_healthy_set_false_cloud_fallback_active",
      } as Record<string, unknown>,
    }).catch(() => {});

    // Deduped CRITICAL alert — at most once per ALERT_DEDUP_WINDOW_MS (default 1h)
    if (shouldEmitAlert(ALERT_KEY_CIRCUIT_OPEN, "CRITICAL")) {
      markAlertEmitted(ALERT_KEY_CIRCUIT_OPEN, "CRITICAL");
      notifyCritical(
        "Ollama gemma4 extraction DOWN — cloud fallback active",
        [
          `Recovery ladder (Steps A+B) exhausted after ${_consecutiveUnhealthyTicks} consecutive unhealthy ticks.`,
          `Model ${model} could not be restored in VRAM.`,
          `Extraction routing to cloud fallback (gpt-5-mini) — no action needed unless cloud budget is a concern.`,
          "",
          "**Operator runbook:**",
          "1. Check Ollama log: `%LOCALAPPDATA%\\Ollama\\server.log` — look for 'aborting load'",
          "2. Run: `ollama ps` — if empty, model is unloaded",
          "3. Verify OLLAMA_KEEP_ALIVE=-1 is set as a User environment variable (persist across reboots)",
          "4. Restart Ollama: stop + start `ollama serve`",
          "5. Wait 3-5 min — watchdog will auto-detect recovery and flip OLLAMA_HEALTHY back to true",
        ].join("\n"),
        {
          correlationId,
          consecutiveUnhealthyTicks: _consecutiveUnhealthyTicks,
          model,
          recoveryStep: "C",
          cloudFallbackActive: true,
        },
      );
    }
  } catch (outerErr) {
    // Fail-soft — never propagate out of cron tick
    logger.error(
      { err: outerErr, correlationId, jobName: "ollama-keepwarm-watchdog" },
      "ollama-keepwarm-watchdog: unexpected error in tick — suppressed",
    );
    insertAuditRowSafe({
      action: "ollama_watchdog.down",
      entityType: AUDIT_ENTITY_TYPE,
      entityId: "ollama",
      correlationId,
      decisionAuthority: "system",
      status: "error",
      result: {
        reason: outerErr instanceof Error ? outerErr.message : String(outerErr),
        source: "unexpected_tick_error",
      } as Record<string, unknown>,
    }).catch(() => {});
  }
}

// ─── Recovery helper ──────────────────────────────────────────────────────────

async function _onRecovered(
  correlationId: string,
  recoveryStep: string,
  latencyMs: number,
): Promise<void> {
  const previousUnhealthyTicks = _consecutiveUnhealthyTicks;
  _consecutiveUnhealthyTicks = 0;

  // Call recheckOllamaHealth to flip OLLAMA_HEALTHY=true and reset circuit breaker
  try {
    const recheck = await recheckOllamaHealth();
    logger.info(
      {
        correlationId,
        recoveryStep,
        latencyMs,
        previousUnhealthyTicks,
        recheckHealthy: recheck.healthy,
        recheckReason: recheck.reason,
      },
      "ollama-keepwarm-watchdog: recovered",
    );
  } catch (recheckErr) {
    logger.warn(
      { err: recheckErr, correlationId, recoveryStep },
      "ollama-keepwarm-watchdog: recheckOllamaHealth threw after recovery (non-blocking)",
    );
  }

  insertAuditRowSafe({
    action: "ollama_watchdog.recovered",
    entityType: AUDIT_ENTITY_TYPE,
    entityId: "ollama",
    correlationId,
    decisionAuthority: "system",
    status: "success",
    result: {
      recovery_step: recoveryStep,
      latency_ms: latencyMs,
      consecutive_unhealthy_ticks_before_recovery: previousUnhealthyTicks,
    } as Record<string, unknown>,
  }).catch(() => {});

  // Clear dedup key so next failure fires immediately
  clearAlertKey(ALERT_KEY_CIRCUIT_OPEN);

  // All-clear notification (not deduped — always fires on recovery)
  if (previousUnhealthyTicks > 0) {
    notifyInfo(
      "Ollama gemma4 extraction recovered",
      `Model restored via Step ${recoveryStep} after ${previousUnhealthyTicks} unhealthy tick(s). Extraction routing restored to local Ollama.`,
      { correlationId, recoveryStep, previousUnhealthyTicks, latencyMs },
    );
  }
}
