/**
 * Admin Routes — pipeline control endpoints.
 *
 * GET  /pipeline/status   — current pipeline mode
 * POST /pipeline/start    — set mode to ACTIVE
 * POST /pipeline/pause    — set engine mode to PAUSED; n8n remains always-on
 * POST /pipeline/vacation — set engine mode to VACATION; n8n remains always-on
 */

import { Router, type Request, type Response } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { desc, eq, and, sql, count, gte } from "drizzle-orm";
import { getMode, setMode } from "../services/pipeline-control-service.js";
import { db } from "../db/index.js";
import { agentHealthReports, dataIntegrityFindings, liquidityLevels, needsArchetypeQueue, strategies, systemParameters } from "../db/schema.js";
import { AgentService } from "../services/agent-service.js";
import { getPhaseRecord, setPhaseOverride, type PhaseValue } from "../services/harsh-regime-phase-service.js";
import { notifyCritical, notifyWarning } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { insertAuditRow, insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { logger } from "../lib/logger.js";
import { getStrategySourceUrls } from "../lib/strategy-source-resolver.js";
import {
  parseLearningLoopMode,
  LEARNING_LOOP_MODE_PARAM,
  MODE_OBSERVE,
  MODE_AUTOPILOT,
} from "../lib/learning-loop-mode.js";
import { requireOfficeControlAuthority } from "../lib/office-control-guard.js";

export const adminRoutes = Router();

// ─── Layer-4 Office P0 (2026-07-02): pipeline mutation guard ─────────────────
//
// ARCHITECTURE DECISION (operator, pinned): the Slumhouse Office is the ONLY
// control room; the React SPA is a read-only observation deck. The SPA's
// pause/resume dispatch was removed, and these generic pipeline mutations are
// now Office/operator-only via the SHARED requireOfficeControlAuthority guard
// (lib/office-control-guard.ts — Office admin cookie OR direct loopback with
// no x-forwarded-for; 401 office_only + blocked-attempt audit row otherwise).
// The same guard protects POST /api/strategies/:id/deploy + /reject-deploy.
//
// Known callers audited 2026-07-02: React SPA usePipelineMode (mutations
// REMOVED this pass — read-only now), operator runbook curls (localhost —
// still allowed), crons/services (call setMode() in-process, never HTTP —
// unaffected), n8n workflows (none call these routes). The Office Bot Power
// switch uses /slumhouse/admin/switch, not these routes. GET /pipeline/status
// stays open (read-only display feed for the SPA).
function requirePipelineControlAuthority(req: Request, res: Response): boolean {
  return requireOfficeControlAuthority(req, res, "admin.pipeline_mutation_blocked");
}

// ─── Wave 24 Pass 1 Item 8: POST /self-restart — HMAC-authenticated self-restart ─
//
// Problem: NSSM auto-respawns on port 4000 keeping stale code. Non-admin `sc stop`
// is denied — every code deploy requires admin operator. Unacceptable for 30-day
// unattended vacation mode.
//
// Solution: HMAC-signed endpoint triggers a graceful process.exit(0) so NSSM
// auto-respawns to fresh code. HMAC uses ADMIN_RESTART_HMAC_SECRET env var.
//
// Signature: X-Restart-Signature = HMAC-SHA256(secret, body.timestamp + ":" + body.reason)
// Replay protection: timestamp drift > 60s → 401.
//
// Curl example:
//   TIMESTAMP=$(date +%s)
//   REASON="deploy_2026-05-23"
//   SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
//   curl -X POST https://<relay>/api/admin/self-restart \
//     -H "Content-Type: application/json" \
//     -H "X-Restart-Signature: $SIG" \
//     -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"
//
// NSSM config: set RestartDelay to 2000ms so the process has time to flush logs
// before the port re-binds.

const RESTART_TIMESTAMP_DRIFT_MS = 60_000; // 60 seconds replay window

function verifyRestartHmac(
  headerValue: string | undefined,
  timestamp: number,
  reason: string,
  exitFn?: (code: number) => never,
): { ok: true } | { ok: false; reason_code: string } {
  const secret = process.env.ADMIN_RESTART_HMAC_SECRET;
  if (!secret) {
    // deep-scan Security re-cert HIGH: fail CLOSED when the secret is unset — in EVERY environment.
    // The old `NODE_ENV !== "production"` dev-bypass returned {ok:true} (a FULL auth bypass) on these
    // Bearer-exempt admin routes in staging/test/unset — anyone could curl self-restart /
    // clear-kill-switch-cache unauthenticated. Mirrors admin-frozen-policy-override's unconditional
    // fail-closed. Tests must set ADMIN_RESTART_HMAC_SECRET + sign (deepscan16 / wave24 already do).
    return { ok: false, reason_code: "secret_not_configured" };
  }
  if (!headerValue || typeof headerValue !== "string" || headerValue.length === 0) {
    return { ok: false, reason_code: "missing_header" };
  }
  const payload = `${timestamp}:${reason}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  if (headerValue.length !== expected.length) {
    return { ok: false, reason_code: "signature_mismatch" };
  }
  try {
    const ok = timingSafeEqual(Buffer.from(headerValue, "hex"), Buffer.from(expected, "hex"));
    return ok ? { ok: true } : { ok: false, reason_code: "signature_mismatch" };
  } catch {
    return { ok: false, reason_code: "signature_mismatch" };
  }
}

// Pass 6 Track D: RFC 4122 UUID validation regex for parentCorrelationId stitching.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

adminRoutes.post("/self-restart", async (req, res) => {
  const handlerCorrelationId = randomUUID(); // always mint a fresh handler id
  const body = (req.body ?? {}) as { timestamp?: number; reason?: string; parentCorrelationId?: string };

  // ── Validate body ─────────────────────────────────────────────────────────
  if (typeof body.timestamp !== "number") {
    res.status(400).json({ error: "missing_body_field", field: "timestamp" });
    return;
  }
  if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
    res.status(400).json({ error: "missing_body_field", field: "reason" });
    return;
  }

  // ── Replay protection ─────────────────────────────────────────────────────
  const nowMs = Date.now();
  const tsMs = body.timestamp * 1000; // body.timestamp is Unix seconds
  const drift = Math.abs(nowMs - tsMs);
  if (drift > RESTART_TIMESTAMP_DRIFT_MS) {
    req.log?.warn({ drift, correlationId: handlerCorrelationId }, "self-restart: timestamp drift exceeded — replay protection");
    res.status(401).json({ error: "timestamp_drift_exceeded", drift_ms: drift, max_ms: RESTART_TIMESTAMP_DRIFT_MS });
    return;
  }

  // ── HMAC verification ──────────────────────────────────────────────────────
  const sig = req.header("x-restart-signature");
  const verified = verifyRestartHmac(sig, body.timestamp, body.reason.trim());
  if (!verified.ok) {
    req.log?.warn({ reason_code: verified.reason_code, correlationId: handlerCorrelationId }, "self-restart: HMAC verification failed");
    res.status(401).json({ error: "hmac_verification_failed", reason_code: verified.reason_code });
    return;
  }

  const reason = body.reason.trim();

  // ── Pass 6 Track D: correlation_id stitching ──────────────────────────────
  // When the dead-man's heartbeat service triggers an auto-restart it plumbs
  // its cronCorrelationId as `body.parentCorrelationId`. Using it as the audit
  // row's correlation_id lets a single SQL WHERE clause reconstruct all three
  // rows (stale_detected → auto_restart_attempted → self_restart_requested).
  // When parentCorrelationId is absent or malformed (manual curl invocation),
  // fall back to the freshly-minted handlerCorrelationId.
  const parentId = typeof body.parentCorrelationId === "string" && UUID_V4_RE.test(body.parentCorrelationId)
    ? body.parentCorrelationId
    : null;
  const correlationId = parentId ?? handlerCorrelationId;

  logger.info(
    { correlationId, handlerCorrelationId, parentCorrelationId: parentId, reason },
    "self-restart: HMAC verified — initiating graceful restart",
  );

  // ── Audit row ─────────────────────────────────────────────────────────────
  // freshscan10 MED (2026-07-12): missed sibling of the deep-scan #28 setMode
  // authority fix. `getLastOperatorActivityAt()` (dead-mans-heartbeat-service.ts)
  // treats ANY decision_authority='human' row as operator activity and resets the
  // vacation operator-absence silence clock. The dead-man's heartbeat auto-restart
  // is the single most-likely AUTONOMOUS action during unattended operation — if it
  // audits as 'human' it silently keeps operator_absent_since from ever latching, so
  // Tier-1 vacation autopilot never engages. `parentId` is non-null ONLY on the
  // autonomous heartbeat path (it plumbs parentCorrelationId); a manual operator curl
  // omits it. So: autonomous restart → 'system' (not operator activity); manual
  // operator-triggered restart → 'human' (genuine operator activity). Mirrors
  // pipeline-control-service.ts:136 authority param.
  await insertAuditRow({
    action: "system.self_restart_requested",
    entityType: "system",
    entityId: null,
    decisionAuthority: parentId ? "system" : "human",
    input: { reason, timestamp: body.timestamp } as Record<string, unknown>,
    // Preserve the handler's own UUID in metadata for debugging even when
    // we're using the parent's UUID as the correlation_id.
    result: {
      correlationId,
      handler_correlation_id: handlerCorrelationId,
      parent_correlation_id: parentId,
    } as Record<string, unknown>,
    status: "success",
    correlationId,
  }).catch((err) => logger.error({ err }, "self-restart: audit row write failed (non-blocking)"));

  // ── Discord notification ───────────────────────────────────────────────────
  notifyCritical(
    "Self-Restart Initiated",
    appendFamilyGradePostscript(
      `Backend process is restarting via HMAC-authenticated endpoint. Reason: ${reason}. NSSM will respawn automatically.`,
      "The trading bot restarted itself automatically.",
      "No action needed — the bot will be back online in 30 seconds.",
    ),
    { reason, correlationId, parentCorrelationId: parentId },
  );

  // ── Respond before exiting ────────────────────────────────────────────────
  res.json({ status: "restart_initiated", reason, correlationId });

  // ── Graceful shutdown (Wave 26 Pass K Phase 7 v2 — 2026-05-27 fix) ────────
  // Pass K Phase 7 v1 used a plain setTimeout → process.exit(0). The audit row
  // confirmed the route was hit, but the process kept running past the 1s exit
  // window (operator caught this when uptime kept incrementing instead of
  // resetting). Root cause hypothesis: process.exit(0) is forceful but the
  // setTimeout callback never fired — event loop was busy / a downstream
  // microtask was blocking macrotask processing, OR process.exit was being
  // intercepted somewhere.
  //
  // Hardened sequence:
  //   1. Schedule a SIGKILL fallback at +5s — process.kill(SIGKILL) is
  //      OS-level termination, cannot be intercepted by Node.
  //   2. Call server.close() to stop accepting new HTTP connections.
  //   3. Force-close any remaining connections after server.close completes.
  //   4. Call process.exit(0) for clean exit.
  // If any step hangs, the SIGKILL fallback at +5s guarantees death.
  // NSSM AppRestartDelay=2000 + AppThrottle=5000 then auto-respawns.
  logger.info({ correlationId, reason }, "self-restart: scheduling graceful shutdown (SIGKILL fallback at +5s)");

  const HARD_KILL_FALLBACK_MS = 5_000;
  const killTimer = setTimeout(() => {
    logger.warn({ correlationId }, "self-restart: graceful shutdown timed out — sending SIGKILL");
    try { process.kill(process.pid, "SIGKILL"); } catch { /* if SIGKILL fails, nothing will save us */ }
    // Belt-and-suspenders: process.exit if kill silently no-op'd
    process.exit(1);
  }, HARD_KILL_FALLBACK_MS);
  killTimer.unref();

  // Best-effort graceful close. If `server` import fails (legacy code path
  // pre-Phase-7v2 didn't export it), skip straight to process.exit.
  try {
    const { server } = await import("../index.js");
    server.close(() => {
      logger.info({ correlationId }, "self-restart: server closed cleanly — calling process.exit(0)");
      process.exit(0);
    });
    // server.close() only kills LISTENING sockets, not active connections.
    // Force-destroy any keep-alive sockets to actually let it return.
    if (typeof (server as { closeAllConnections?: () => void }).closeAllConnections === "function") {
      (server as { closeAllConnections: () => void }).closeAllConnections();
    }
  } catch (importErr) {
    logger.warn({ err: importErr, correlationId }, "self-restart: could not import server for graceful close — calling process.exit(0) directly");
    setTimeout(() => process.exit(0), 200);
  }
});

// ─── W3.3: POST /ollama-health-recheck ────────────────────────────────────────
//
// Problem: OLLAMA_HEALTHY is set ONCE at boot via checkTranscriptExtractorOllamaHealth.
// After Ollama unloads (keep_alive:0) or NSSM respawns, the flag stays stuck false →
// every transcript_extractor call silently routes to cloud (forbidden + unavailable) →
// returns null → llm_unavailable in 0.0s. This took down the Slumdawg Discord bot
// mid-Pass-L.
//
// Solution: This endpoint re-runs the same 2-phase Ollama health probe (registry +
// test-inference) at runtime and resets OLLAMA_HEALTHY atomically. HMAC-authenticated
// (mirrors self-restart pattern) so it cannot be triggered by unauthorized callers.
//
// Signature: X-Restart-Signature = HMAC-SHA256(secret, body.timestamp + ":" + body.reason)
// Replay window: 60s (same as self-restart).
// Fail-closed: when ADMIN_RESTART_HMAC_SECRET is unset, verification fails closed
// in EVERY environment — there is no dev/test bypass.
//
// Curl example:
//   TIMESTAMP=$(date +%s)
//   REASON="ollama_respawn_2026-06-22"
//   SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
//   curl -X POST https://<relay>/api/admin/ollama-health-recheck \
//     -H "Content-Type: application/json" \
//     -H "X-Restart-Signature: $SIG" \
//     -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"

adminRoutes.post("/ollama-health-recheck", async (req, res) => {
  const correlationId = randomUUID();
  const body = (req.body ?? {}) as { timestamp?: number; reason?: string };

  // ── Validate body ──────────────────────────────────────────────────────────
  if (typeof body.timestamp !== "number") {
    res.status(400).json({ error: "missing_body_field", field: "timestamp" });
    return;
  }
  if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
    res.status(400).json({ error: "missing_body_field", field: "reason" });
    return;
  }

  // ── Replay protection ──────────────────────────────────────────────────────
  const nowMs = Date.now();
  const tsMs = body.timestamp * 1000;
  const drift = Math.abs(nowMs - tsMs);
  if (drift > RESTART_TIMESTAMP_DRIFT_MS) {
    logger.warn({ drift, correlationId }, "ollama-health-recheck: timestamp drift exceeded — replay protection");
    res.status(401).json({ error: "timestamp_drift_exceeded", drift_ms: drift, max_ms: RESTART_TIMESTAMP_DRIFT_MS });
    return;
  }

  // ── HMAC verification ──────────────────────────────────────────────────────
  const sig = req.header("x-restart-signature");
  const verified = verifyRestartHmac(sig, body.timestamp, body.reason.trim());
  if (!verified.ok) {
    logger.warn({ reason_code: verified.reason_code, correlationId }, "ollama-health-recheck: HMAC verification failed");
    res.status(401).json({ error: "hmac_verification_failed", reason_code: verified.reason_code });
    return;
  }

  const reason = body.reason.trim();
  logger.info({ correlationId, reason }, "ollama-health-recheck: HMAC verified — running 2-phase Ollama probe");

  // ── Run the 2-phase health probe ───────────────────────────────────────────
  let recheckResult: { healthy: boolean; reason?: string };
  try {
    const { recheckOllamaHealth } = await import("../services/model-router.js");
    recheckResult = await recheckOllamaHealth();
  } catch (err) {
    logger.error({ err, correlationId }, "ollama-health-recheck: recheckOllamaHealth threw unexpectedly");
    res.status(500).json({ error: "recheck_threw", correlationId });
    return;
  }

  const status = recheckResult.healthy ? "success" : "failure";

  // ── Audit row ──────────────────────────────────────────────────────────────
  await insertAuditRow({
    action: "system.ollama_health_rechecked",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human",
    input: { reason, timestamp: body.timestamp } as Record<string, unknown>,
    result: {
      healthy: recheckResult.healthy,
      probe_reason: recheckResult.reason ?? null,
      correlationId,
    } as Record<string, unknown>,
    status,
    correlationId,
  }).catch((err) => logger.error({ err }, "ollama-health-recheck: audit row write failed (non-blocking)"));

  // ── Discord notification ───────────────────────────────────────────────────
  if (recheckResult.healthy) {
    notifyWarning(
      "Ollama Health Restored",
      appendFamilyGradePostscript(
        `OLLAMA_HEALTHY reset to true via runtime recheck. transcript_extractor routing restored to local gemma4:e4b-it-qat. Reason: ${reason}`,
        "The local AI model is working again.",
        "No action needed — the bot's AI features are restored.",
      ),
      { correlationId },
    );
  } else {
    notifyCritical(
      "Ollama Health Recheck FAILED",
      appendFamilyGradePostscript(
        `Runtime recheck returned healthy=false. transcript_extractor will continue routing to cloud. Probe failure: ${recheckResult.reason ?? "unknown"}. Reason: ${reason}`,
        "The local AI is still down — using cloud backup.",
        "No action needed — the bot is using its cloud backup. Call Tony if this persists for more than 2 hours.",
      ),
      { correlationId },
    );
  }

  // ── Respond ────────────────────────────────────────────────────────────────
  res.json({
    status: recheckResult.healthy ? "healthy" : "unhealthy",
    ollama_healthy: recheckResult.healthy,
    probe_failure_reason: recheckResult.reason ?? null,
    correlationId,
    recommendation: recheckResult.healthy
      ? "Local Ollama is now active. transcript_extractor routing restored."
      : "Ollama is still down. Check Ollama service status and retry.",
  });
});

// ─── Wave 24 Pass 1.5 Item 6: POST /operator-mark-present ────────────────────
//
// Clears system_state.operator_absent_since AND operator_absent_pending
// atomically. The auto-flip detector (runOperatorAbsenceAutoDetect) sets these
// after 24h/48h of silence; this route is how the operator says "I'm back".
//
// Auth: any successful authenticated session is sufficient. The request itself
// is also a presence marker (audit row decisionAuthority='human' becomes the
// activity signal future detector ticks will see).
adminRoutes.post("/operator-mark-present", async (req, res) => {
  // goalscan 2026-07-16 (vacation-autopilot disengage, MED): this route clears the STICKY
  // operator_absent_since marker — the only way to disengage Tier-1 vacation autopilot — and
  // stamps decisionAuthority:"human". Bearer-only, a relay-tunneled family/n8n key holder could
  // silently disengage vacation mode during the operator's absence, and the "human" tag would be
  // false. Require the same pipeline/vacation-control authority its siblings (/pipeline/pause,
  // /vacation, /start) carry — this makes the "human" authority honest (guard confirmed operator)
  // and closes the disengage gap. (The lighter "hit any admin endpoint clears PENDING" convenience
  // path in CLAUDE.md §3 still works for the non-sticky pending marker via other endpoints.)
  if (!requirePipelineControlAuthority(req, res)) return;
  const correlationId = randomUUID();
  try {
    const { clearOperatorAbsenceMarkers } = await import("../services/dead-mans-heartbeat-service.js");
    const { clearedSince, clearedPending } = await clearOperatorAbsenceMarkers();

    await insertAuditRow({
      action: "operator_presence.confirmed",
      entityType: "system",
      entityId: null,
      decisionAuthority: "human",
      input: { source: "POST /api/admin/operator-mark-present" } as Record<string, unknown>,
      result: {
        clearedSince: clearedSince ? clearedSince.toISOString() : null,
        clearedPending: clearedPending ? clearedPending.toISOString() : null,
      } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((err) => logger.error({ err }, "operator-mark-present: audit row failed (non-blocking)"));

    if (clearedSince || clearedPending) {
      notifyWarning(
        "Operator presence confirmed — vacation autopilot disengaged",
        appendFamilyGradePostscript(
          `Operator manually cleared absence markers. clearedSince=${clearedSince?.toISOString() ?? "null"}, ` +
            `clearedPending=${clearedPending?.toISOString() ?? "null"}.`,
          "Tony confirmed he's back — vacation mode is off.",
          "No action needed — trading is back to normal operator supervision.",
        ),
        { correlationId },
      );
    }

    res.json({
      status: "presence_confirmed",
      clearedSince: clearedSince ? clearedSince.toISOString() : null,
      clearedPending: clearedPending ? clearedPending.toISOString() : null,
      correlationId,
    });
  } catch (err) {
    req.log?.error({ err, correlationId }, "operator-mark-present: failed");
    res.status(500).json({ error: "operator_mark_present_failed", correlationId });
  }
});

// ─── GET /kill-switch ────────────────────────────────────────────
// Read-only exposure of the `system_parameters.auto_patch_loop_enabled`
// flag for the Layer-14 nightly intelligence orchestrator (n8n 14A-master).
// This is the SAME operator-phone-tappable halt that gates the Wave 26
// pattern-aggregator and Wave 27 quantum-replay loops (CLAUDE.md §13).
//
// 3-MODE semantics (NUMERIC current_value — see lib/learning-loop-mode.ts):
//   0 = OFF        — nothing autonomous, no nightly advisory.
//   1 = OBSERVE    — nightly ADVISORY intelligence runs; NO autonomous changes.
//   2 = AUTOPILOT  — advisory + autonomous mutation loops.
// FAIL-CLOSED: absent row / non-numeric / read error → mode 0 (OFF).
//
// BACKWARD-COMPAT CONTRACT: `enabled` historically meant "autonomous loop ON".
// It is preserved EXACTLY as `enabled = autonomous_on` (mode >= 2). OBSERVE
// (mode 1) MUST report enabled:false — 14A and every autonomous reader gate on
// `enabled`/`autonomous_on`, so OBSERVE must not wake them. `advisory_on` is the
// additive signal for advisory-only consumers (the nightly intelligence run).
adminRoutes.get("/kill-switch", async (req, res) => {
  try {
    const rows = await db
      .select({ val: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, LEARNING_LOOP_MODE_PARAM))
      .limit(1);
    const raw = rows.length > 0 ? rows[0].val : null;
    // Derive via the shared clamp/validate helper — the single source of truth
    // for mode interpretation across every reader.
    const mode = parseLearningLoopMode(raw);
    const advisoryOn = mode >= MODE_OBSERVE;
    const autonomousOn = mode >= MODE_AUTOPILOT;
    const enabled = autonomousOn; // backward-compat: enabled === autonomous_on
    // GAP 5 fix: fire-and-forget audit row so Layer-14 read events are reconstructable.
    // Previously the 14A nightly orchestrator could read this endpoint repeatedly with
    // no trace in audit_log — silent reads are not reconstructable after an incident.
    // Fail-soft: insertAuditRowSafe never throws; response is never blocked.
    void insertAuditRowSafe({
      action: "kill_switch.autonomous_loop_read",
      entityType: "system",
      status: "info",
      result: {
        enabled,
        mode,
        advisory_on: advisoryOn,
        autonomous_on: autonomousOn,
        raw: raw ?? null,
        key: LEARNING_LOOP_MODE_PARAM,
      },
      correlationId: req.id,
    });
    res.json({
      key: LEARNING_LOOP_MODE_PARAM,
      mode,
      advisory_on: advisoryOn,
      autonomous_on: autonomousOn,
      enabled,
      raw: raw ?? null,
      source: "system_parameters",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to read kill-switch");
    // FAIL-CLOSED on error: report mode 0 / enabled=false so the autonomous loop
    // stays halted when we cannot confirm it was explicitly enabled.
    res.status(200).json({
      key: LEARNING_LOOP_MODE_PARAM,
      mode: 0,
      advisory_on: false,
      autonomous_on: false,
      enabled: false,
      raw: null,
      source: "error_fail_closed",
      error: String(err),
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── GET /pipeline/status ────────────────────────────────────────
adminRoutes.get("/pipeline/status", async (req, res) => {
  try {
    const mode = await getMode();
    const subsystems: Record<string, string> = {
      scheduler: mode === "ACTIVE" ? "running" : "paused",
      lifecycle: mode === "ACTIVE" ? "running" : "paused",
      n8n: "always_on",
      openclaw: "always_on",
      paper_trading: mode === "VACATION" ? "stopped" : mode === "ACTIVE" ? "active" : "paused",
    };
    res.json({ mode, subsystems, timestamp: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to get pipeline status");
    res.status(500).json({ error: "Failed to get pipeline status" });
  }
});

// ─── POST /pipeline/start ────────────────────────────────────────
adminRoutes.post("/pipeline/start", async (req, res) => {
  if (!requirePipelineControlAuthority(req, res)) return;
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Manual start";
    const result = await setMode("ACTIVE", reason, req.id ?? null);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin: failed to start pipeline");
    res.status(500).json({ error: "Failed to start pipeline" });
  }
});

// ─── POST /scout/operator-ingest ─────────────────────────────────
// W23H-operator-curation (2026-05-20) — operator submits YouTube URL(s)
// directly to the factory. Bypasses keyword-based discovery (operator's
// judgment IS the discovery layer for this entry). Still goes through:
//   1. youtube-transcript fetch (no Data API quota)
//   2. scout-extract LLM (Wave 23H v9 prompt + all postmortem fix waves)
//   3. pending_mention write with source_provider='operator_manual'
//   4. Cross-validation via 3 synthetic layers (operator is the validator)
//   5. Graduator drain → CANDIDATE bucket entry
//   6. Existing lifecycle gates (backtest, A4 Frankenstein, A7 signal correlation, etc.)
//
// Body: { urls: string[] } or { url: string }
// Response: { results: [{ url, status, ideas, error? }, ...] }
adminRoutes.post("/scout/operator-ingest", async (req, res) => {
  if (!requirePipelineControlAuthority(req, res)) return;
  try {
    const body = (req.body as { url?: string; urls?: string[] }) ?? {};
    const urls = Array.isArray(body.urls) ? body.urls : (body.url ? [body.url] : []);
    if (urls.length === 0) {
      return res.status(400).json({ error: "Provide { url: string } or { urls: string[] }" });
    }
    if (urls.length > 20) {
      return res.status(400).json({ error: "Max 20 URLs per request (token-budget guardrail)" });
    }

    const { YoutubeTranscript } = await import("youtube-transcript");
    const correlationId = randomUUID();

    function extractVideoId(url: string): string | null {
      const m = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
      return m?.[1] ?? null;
    }

    const BACKEND_URL = `http://127.0.0.1:${process.env.PORT ?? 4000}`;
    const results: Array<Record<string, unknown>> = [];

    for (const url of urls) {
      const videoId = extractVideoId(url);
      if (!videoId) {
        results.push({ url, status: "invalid_url", error: "Not a recognizable YouTube URL" });
        continue;
      }

      // 1. Fetch transcript (no Data API quota — uses internal timedtext endpoint)
      let transcript: string | null = null;
      try {
        const segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" })
          .catch(() => YoutubeTranscript.fetchTranscript(videoId));
        transcript = segs.map((s: { text: string }) => s.text).join(" ");
      } catch (e) {
        results.push({ url, video_id: videoId, status: "transcript_unavailable", error: (e as Error).message?.slice(0, 100) });
        continue;
      }
      if (!transcript || transcript.length < 500) {
        results.push({ url, video_id: videoId, status: "transcript_too_short", chars: transcript?.length ?? 0 });
        continue;
      }

      // 2. Fetch YouTube title via oEmbed (no API key, no quota)
      let title = `Operator-ingested video ${videoId}`;
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${videoId}&format=json`, {
          signal: AbortSignal.timeout(5000),
        });
        if (oembed.ok) {
          const j = (await oembed.json()) as { title?: string };
          if (j.title) title = j.title;
        }
      } catch { /* keep default title */ }

      // W23H-postmortem-fix18 (2026-05-21) — operator hard-reject of
      // swing-trader + screenshot/recap content. Trading Forge is day-trade
      // only (4H bias + intraday execution); multi-day holds incompatible
      // with MFFU/Topstep EOD trailing drawdowns. Screenshot recaps show
      // past trades without rule sets. Reject BEFORE LLM call (saves tokens).
      const HARD_REJECT_TITLE = /\b(swing trad(?:er|ers|ing)|swing setup|hold(?:ing)? overnight|multi.?day hold|weekly chart strategy|monthly chart strategy|long.?term hold|position trad(?:er|ing)|screenshot(?:s)?|trade recap|my best trades|my trades this week|my trades today|recap of (?:my|this) trades|trade screenshots)\b/i;
      if (HARD_REJECT_TITLE.test(title)) {
        results.push({
          url,
          video_id: videoId,
          status: "rejected_swing_or_screenshot",
          title: title.slice(0, 200),
          rule: "day-trader-only mandate (CLAUDE.md §4)",
        });
        continue;
      }

      // 3. Run through scout-extract (same pipeline as autonomous cron uses)
      let extractResult: { extracted?: boolean; ideas?: Array<Record<string, unknown>>; reason?: string; gemma_saw?: string[]; gemma_saw_count?: number; compilability_results?: Array<{ ideaIndex: number; compilable: boolean }> };
      try {
        const resp = await fetch(`${BACKEND_URL}/api/agent/scout-extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-correlation-id": correlationId },
          body: JSON.stringify({
            // sourceProvider enum is strict (brave/tavily/parallel/exa); use tavily as
            // canonical for operator-curated YouTube content. The actual "operator_manual"
            // provenance tag goes on the pending_mention below + audit row.
            markdown: transcript,
            sourceProvider: "tavily",
            sourceUrl: `https://youtube.com/watch?v=${videoId}`,
            title,
          }),
          signal: AbortSignal.timeout(420_000), // v12 Gemma thinking mode + 32K ctx can take 4-6 min on RTX 5060 8GB
        });
        extractResult = await resp.json();
      } catch (e) {
        results.push({ url, video_id: videoId, status: "extract_failed", error: (e as Error).message?.slice(0, 100) });
        continue;
      }

      if (!extractResult.extracted || !extractResult.ideas?.length) {
        // Wave 26 Pass K Phase 7 (2026-05-27) — forward `gemma_saw` so the Discord
        // bot can render "Slumdawg almost had it" instead of generic "mostly talk"
        // when gemma extracted a strategy name but ideas[] ended up empty.
        const extra = (extractResult as { gemma_saw?: string[]; gemma_saw_count?: number });
        results.push({
          url,
          video_id: videoId,
          title,
          status: "not_extracted",
          reason: extractResult.reason,
          ...(extra.gemma_saw ? { gemma_saw: extra.gemma_saw } : {}),
          ...(extra.gemma_saw_count != null ? { gemma_saw_count: extra.gemma_saw_count } : {}),
        });
        continue;
      }

      // ─── E-INGEST-GATE (2026-06-22) — compilability gate on the persist path ──
      // The operator-ingest path previously persisted EVERY extracted idea into a bucket,
      // in parallel with scout-extract's W3.2 quarantine — so incomplete/quarantined
      // extractions still pooled into the sha256("extracted")=c25828a8 junk bucket.
      // Drop ideas that failed the scout-extract compilability gate BEFORE the merge/persist
      // (indices align with the pre-merge ideas array). Layer 4 naming already gives compilable
      // ideas a real concept_name so their fingerprint no longer collides into c25828a8.
      {
        const compResults = extractResult.compilability_results;
        if (Array.isArray(compResults) && compResults.length > 0) {
          const compilableIdx = new Set(compResults.filter((c) => c.compilable).map((c) => c.ideaIndex));
          const before = extractResult.ideas?.length ?? 0;
          extractResult.ideas = (extractResult.ideas ?? []).filter((_, i) => compilableIdx.has(i));
          const dropped = before - extractResult.ideas.length;
          if (dropped > 0) {
            req.log?.warn?.(
              { video_id: videoId, dropped, kept: extractResult.ideas.length },
              "operator-ingest: dropped non-compilable ideas — not persisted (W3.2 quarantine owns them)",
            );
          }
          if (extractResult.ideas.length === 0) {
            results.push({ url, video_id: videoId, title, status: "quarantined", reason: "all_ideas_failed_compilability" });
            continue;
          }
        }
      }

      // ─── Wave 26 Pass H1 (2026-05-26) Bug 1 — Multi-Layer Archetype Merge ──
      // When Gemma extracts N ideas that are actually N layers of ONE ICT strategy
      // (e.g. HTF bias + MSS + FVG + liquidity target from a single ICT video),
      // creating N separate buckets causes over-fragmentation. Detect this by
      // checking if ANY idea names a multi-layer archetype. If so, keep only the
      // master idea and record siblings in config.absorbed_sub_concepts.
      //
      // Multi-layer archetypes: archetype names that by definition bundle sub-layers.
      // Sub-layers: known sub-concept names Gemma emits for each multi-layer archetype.
      const MULTI_LAYER_ARCHETYPES = new Set<string>([
        "ict_bias_aligned_continuation",
        "ict_power_of_3",
      ]);
      const SUB_LAYERS_BY_ARCHETYPE: Record<string, string[]> = {
        ict_bias_aligned_continuation: [
          "market_structure_shift_confirmation", "market_structure_shift", "mss_confirmation",
          "fvg_retrace_entry", "fvg_entry", "fair_value_gap_entry", "fvg_retrace",
          "liquidity_targeting", "liquidity_target", "liquidity_sweep", "liquidity_raid",
          "htf_bias", "htf_bias_confirmation", "daily_bias", "4h_bias",
          "bos_confirmation", "choch_entry", "change_of_character_entry",
          "displacement_entry", "killzone_entry", "asian_range_raid",
          // Wave 26 Pass H Phase 1.5 Fix 5 (2026-05-26) — Gemma v10 synonyms
          // observed in live ingests (e.g. video dE4lPhAWke8, htf_bias_and_ms_*).
          // Gemma fabricates bogus `entry_indicator: ema_crossover` for these
          // structural concepts; the merger re-routes them to the master archetype.
          "htf_bias_and_ms_confirmation", "htf_bias_and_market_structure",
          "bias_and_structure", "mss_continuation",
          "daily_bias_market_structure", "daily_bias_market_structure_and_targets",
          "market_structure_shift_confirmation",
          "fvg_retrace_entry", "liquidity_targeting",
          // Compact one-word sub-layer aliases also observed.
          "htf_bias_and_ms", "bias_and_ms", "ms_confirmation",
        ],
        ict_power_of_3: [
          "accumulation", "accumulation_phase", "manipulation", "manipulation_phase",
          "distribution", "distribution_phase", "asian_range",
        ],
      };

      // Determine if any idea references a multi-layer archetype
      let masterIdeaIdx = -1;
      let masterArchetype: string | null = null;
      for (let i = 0; i < extractResult.ideas.length; i++) {
        const idea = extractResult.ideas[i];
        const entryInd = String((idea.entry_indicator as string) ?? "").trim().toLowerCase();
        const archetypeKey = entryInd.startsWith("archetype:") ? entryInd.slice("archetype:".length) : entryInd;
        if (MULTI_LAYER_ARCHETYPES.has(archetypeKey)) {
          masterIdeaIdx = i;
          masterArchetype = archetypeKey;
          break;
        }
      }

      // If no explicit archetype idea found, check concept names against SUB_LAYERS
      if (masterIdeaIdx === -1 && extractResult.ideas.length > 1) {
        for (const [arch, subLayers] of Object.entries(SUB_LAYERS_BY_ARCHETYPE)) {
          const subLayerSet = new Set(subLayers.map(s => s.toLowerCase()));
          const siblingCount = extractResult.ideas.filter((idea) => {
            const cn = String((idea.concept_name as string) ?? "").toLowerCase().replace(/\s+/g, "_");
            return subLayerSet.has(cn);
          }).length;
          // If ≥50% of ideas are sub-layers of this archetype, treat as multi-layer
          if (siblingCount >= Math.ceil(extractResult.ideas.length * 0.5)) {
            masterArchetype = arch;
            // Pick the first idea as master
            masterIdeaIdx = 0;
            break;
          }
        }
      }

      // ─── Wave 26 Pass H Phase 1.5 Fix 5 (2026-05-26) — single-idea sub-layer re-route ──
      // When a SINGLE idea's concept_name is a known sub-layer of a multi-layer
      // archetype X but Gemma did NOT emit master-archetype entry_indicator
      // (typically because Gemma fabricates a bogus parametric entry_indicator
      // like "ema_crossover" for the structural concept), re-route the idea to
      // the master archetype. The operator's intent was clearly one layered
      // strategy — without this Fix the graduator would honor Gemma's bogus
      // ema_crossover via gemma_archetype_respected, producing 3 EMA strategies
      // for an ICT bias+MS video. Captured as _absorbed_sub_concepts for trace.
      if (masterIdeaIdx === -1 && extractResult.ideas.length === 1) {
        const onlyIdea = extractResult.ideas[0];
        const cn = String((onlyIdea.concept_name as string) ?? "").toLowerCase().replace(/\s+/g, "_");
        for (const [arch, subLayers] of Object.entries(SUB_LAYERS_BY_ARCHETYPE)) {
          const subLayerSet = new Set(subLayers.map(s => s.toLowerCase()));
          if (subLayerSet.has(cn)) {
            masterArchetype = arch;
            masterIdeaIdx = 0;
            break;
          }
        }
      }

      let ideasToProcess: Array<Record<string, unknown>>;
      let absorbedSubConcepts: string[] = [];

      if (masterIdeaIdx >= 0 && masterArchetype !== null && extractResult.ideas.length >= 1) {
        // Wave 26 Pass H Phase 1.5 Fix 5: relaxed to ≥1 so single-idea sub-layer
        // re-route fires. Multi-idea path: master idea kept + siblings absorbed.
        // Single-idea path: the only idea IS the master; the absorbed_sub_concepts
        // list captures the original concept_name as Gemma emitted it (so the
        // re-route is replay-traceable in audit_log).
        const masterIdea = extractResult.ideas[masterIdeaIdx];
        const isSingleIdeaRoute = extractResult.ideas.length === 1;
        absorbedSubConcepts = isSingleIdeaRoute
          ? [String((masterIdea.concept_name as string) ?? (masterIdea.name as string) ?? "unknown")]
          : extractResult.ideas
              .filter((_, i) => i !== masterIdeaIdx)
              .map((idea) => String((idea.concept_name as string) ?? (idea.name as string) ?? "unknown"));
        ideasToProcess = [{
          ...masterIdea,
          // Ensure entry_indicator reflects the archetype (overrides any bogus
          // parametric entry_indicator Gemma may have emitted, e.g. ema_crossover
          // for an ICT bias+MS concept).
          entry_indicator: `archetype:${masterArchetype}`,
          // Embed absorbed sub-concepts into the idea so the bucket config can store them
          _absorbed_sub_concepts: absorbedSubConcepts,
        }];

        // Audit row + Discord NOTE (fire-and-forget). Single-idea re-route uses
        // a distinct action so it can be queried separately from multi-idea merge.
        const auditAction = isSingleIdeaRoute
          ? "scout.single_idea_sub_layer_rerouted"
          : "scout.ideas_merged_under_archetype";
        void insertAuditRowSafe({
          action: auditAction,
          entityType: "scout_extract",
          entityId: null,
          input: { url, video_id: videoId, correlation_id: correlationId, archetype: masterArchetype } as Record<string, unknown>,
          result: {
            total_ideas: extractResult.ideas.length,
            absorbed: absorbedSubConcepts,
            master_concept: (masterIdea.concept_name as string) ?? "unknown",
            single_idea_route: isSingleIdeaRoute,
          } as Record<string, unknown>,
          status: "success",
          decisionAuthority: "system",
          correlationId,
        });

        // Discord NOTE (not WARN — this is expected behavior for multi-layer ICT videos)
        // notifyInfo/notifyWarning return void; no .catch() needed
        try {
          const notifySvc = await import("../services/notification-service.js");
          const notifyFn = (notifySvc as Record<string, unknown>).notifyInfo as
            ((title: string, body: string) => void) | undefined
            ?? notifySvc.notifyWarning;
          notifyFn(
            `[Scout] Multi-layer archetype merge`,
            `Merged ${extractResult.ideas.length} sub-concepts from "${title.slice(0, 60)}" under \`${masterArchetype}\`. Absorbed: ${absorbedSubConcepts.slice(0, 3).join(", ")}${absorbedSubConcepts.length > 3 ? ` + ${absorbedSubConcepts.length - 3} more` : ""}`
          );
        } catch { /* non-blocking */ }
      } else {
        ideasToProcess = extractResult.ideas;
      }

      // Wave 26 Pass I v12 (2026-05-26) — Server-side speaker-vocabulary extraction.
      // Moved AFTER ideasToProcess is assigned (Fix 1: null-safety — the original
      // loop at ~line 404 iterated extractResult.ideas directly, crashing when
      // extraction returned null ideas after the merge path defined ideasToProcess).
      // Now iterates ideasToProcess so the speaker-concepts are attached to exactly
      // the ideas that will be persisted (merged master idea, or raw list).
      try {
        const { extractSpeakerConceptsFromTranscript } = await import("../lib/transcript-speaker-concepts.js");
        const transcriptConcepts = extractSpeakerConceptsFromTranscript(transcript);
        if (transcriptConcepts.length > 0) {
          for (const idea of ideasToProcess) {
            // Don't override if Gemma actually emitted speaker_concepts (future-proofing)
            const existing = (idea as Record<string, unknown>).speaker_concepts;
            if (!Array.isArray(existing) || existing.length === 0) {
              (idea as Record<string, unknown>).speaker_concepts = transcriptConcepts;
            }
          }
          req.log?.info?.(
            { video_id: videoId, concepts_found: transcriptConcepts.length, terms: transcriptConcepts.slice(0, 5).map(c => c.term) },
            "operator-ingest: server-side speaker concepts attached"
          );
        }
      } catch (conceptErr) {
        req.log?.warn?.({ err: conceptErr instanceof Error ? conceptErr.message : String(conceptErr) }, "operator-ingest: speaker concept extraction failed (non-blocking)");
      }

      // 4. Persist mentions — write 3 synthetic layers (web + youtube + reddit)
      //    so cross-validation requirement is met (operator IS the cross-validator).
      //    All 3 share the same source_url + extracted content; only scout_layer differs.
      // ─── Wave 26 Pass H1 Bug 4 — source-URL sibling-accept tracking ──────
      // Track bucket_ids that successfully pass source URL verification within this
      // ingest's correlationId. If a later layer fails URL verification with
      // reason="unreachable" but the same video_id already has ≥1 validated bucket,
      // the agent.ts endpoint can accept-by-sibling when we pass the sibling bucket_id.
      const validatedBucketIdsForVideoId = new Set<string>();
      const ideaPersistResults: Array<Record<string, unknown>> = [];
      for (const idea of ideasToProcess) {
        const ideaName = (idea.name as string) || (idea.concept_name as string) || `operator_${videoId}`;
        const conceptName = (idea.concept_name as string) || ideaName;
        // Wave 26 Pass I v12 (2026-05-26) — bug fix: prior logic returned undefined
        // when idea.symbols was an empty array (fallback "MES" only fired when
        // idea.symbols wasn't an array at all). z3Qn3fBoe2I exposed this:
        // Gemma emitted symbols:[] → market undefined → /scout-ideas/pending 400.
        const symbolFromArray = Array.isArray(idea.symbols) && (idea.symbols as unknown[]).length > 0
          ? (idea.symbols[0] as string)
          : null;
        const market = (idea.symbol as string) || symbolFromArray || "MES";

        // Schema enforces min-length on entry/exit/risk rules. When LLM idea is
        // sparse (archetype with no entry_condition / no exit_params), pad with
        // structured fallback so the pending route doesn't 400-reject silently.
        const padRules = (s: string, min: number, fallback: string): string => {
          const trimmed = (s ?? "").trim();
          return trimmed.length >= min ? trimmed : (trimmed.length > 0 ? `${trimmed} | ${fallback}` : fallback);
        };
        const entryRulesRaw = (idea.entry_condition as string) || "";
        const exitParamsStr = typeof idea.exit_params === "object" && idea.exit_params
          ? JSON.stringify(idea.exit_params) : "";
        const baseBody = {
          thesis: padRules(
            (idea.description as string) || "",
            20,
            `Operator-curated strategy ${ideaName} extracted from ${title}`
          ),
          market,
          timeframe: (idea.timeframe as string) || "5m",
          entry_rules: padRules(
            entryRulesRaw,
            20,
            `Indicator ${idea.entry_indicator ?? "structural"} fires entry per archetype handler`
          ),
          exit_rules: padRules(
            exitParamsStr,
            20,
            `Style C exit applied: TP1 1R / TP2 2R / runner trail; framework-overlay authoritative`
          ),
          risk_rules: padRules(
            `stop_atr=${idea.stop_loss_atr_multiple ?? 1.5} tp_atr=${idea.take_profit_atr_multiple ?? 2.0}`,
            10,
            "stop_atr=1.5 tp_atr=2.0 risk_pct=2"
          ),
          source_url: `https://youtube.com/watch?v=${videoId}`,
          regime: (idea.preferred_regime as string) || "TRENDING",
          concept_name: conceptName,
          source_provider: "manual",
          is_cross_validation_result: false,
          entry_indicator: idea.entry_indicator,
          entry_archetype: idea.entry_archetype,
          entry_params: idea.entry_params,
          entry_condition: idea.entry_condition,
          entry_type: idea.entry_type,
          direction: idea.direction,
          exit_type: idea.exit_type,
          exit_params: idea.exit_params,
          stop_loss_atr_multiple: idea.stop_loss_atr_multiple,
          take_profit_atr_multiple: idea.take_profit_atr_multiple,
          preferred_regime: idea.preferred_regime,
          session_filter: idea.session_filter,
          extraction_confidence: idea.extraction_confidence,
          name: ideaName,
          symbols: idea.symbols,
          confluence_factors: idea.confluence_factors,
          min_factors_satisfied: idea.min_factors_satisfied,
          source_claim_win_rate: idea.source_claim_win_rate,
          source_claim_avg_r: idea.source_claim_avg_r,
          // Wave 26 Pass I (2026-05-26) — v11 deep-extraction fields forwarded
          // from scout-extract response (synthesized from Gemma prose by
          // gemma-prose-to-v11.ts). Without these forwards the v11 fields are
          // silently dropped at the operator-ingest → /scout-ideas/pending hop.
          entry_sequence: idea.entry_sequence,
          stop_loss: idea.stop_loss,
          targets: idea.targets,
          filters: idea.filters,
          timeframes: idea.timeframes,
          indicators_used: idea.indicators_used,
          extraction_gap_reason: idea.extraction_gap_reason,
          _v11_synthesis_source: idea._v11_synthesis_source,
          // Wave 26 Pass I v12 — speaker vocabulary preservation
          speaker_concepts: idea.speaker_concepts,
        };

        // Drop null/undefined fields before posting — pending schema rejects null
        // for optional fields (zod expects either valid type or field absent).
        // First ingest passed because LLM populated all fields; later ingests
        // returned LLM responses with null on optional fields (session_filter, etc.).
        for (const k of Object.keys(baseBody) as Array<keyof typeof baseBody>) {
          if (baseBody[k] === null || baseBody[k] === undefined) {
            delete (baseBody as Record<string, unknown>)[k];
          }
        }

        const layerResults: Record<string, unknown> = {};
        // Graduator gates require distinct_providers >= 2 (silver path) or >= 3 (gold).
        // 3 synthetic mentions all using source_provider='manual' yield distinct=1 → no graduation.
        // Use a distinct provider value per synthetic layer (all are valid enum values in
        // pendingSourceProviderEnum) so distinct_providers=3 and gold path is reached.
        const LAYER_PROVIDER_MAP: Record<"web" | "youtube" | "reddit", string> = {
          web: "manual",                  // operator's curation = manual web
          youtube: "youtube_transcript_npm", // the transcript pipeline IS the youtube source
          reddit: "reddit_json",           // synthetic reddit corroboration tag
        };
        for (const layer of ["web", "youtube", "reddit"] as const) {
          try {
            // strategy_pending_mentions has UNIQUE(bucket_id, source_url) — posting
            // same URL 3× to the same bucket gets silently deduped to 1.
            // Make per-layer URL distinct so all 3 layers actually land + flip
            // layer_coverage_json flags to true so graduator cross-validation passes.
            const layerUrl = `${baseBody.source_url}#operator_layer=${layer}`;
            const layerProvider = LAYER_PROVIDER_MAP[layer];
            // Wave 26 Pass H1 Bug 4: pass sibling_bucket_id when this video_id already
            // has ≥1 validated bucket — allows agent.ts to accept-by-sibling on
            // intermittent URL verification failures for the same video.
            const siblingBucketId = validatedBucketIdsForVideoId.size > 0
              ? [...validatedBucketIdsForVideoId][0]
              : undefined;
            // Wave 26 Pass H1 Bug 1: pass absorbed_sub_concepts so the bucket
            // config can store sibling idea names.
            const absorbedSubConceptsField = (idea as Record<string, unknown>)._absorbed_sub_concepts as string[] | undefined;
            const extraFields: Record<string, unknown> = {};
            if (siblingBucketId) extraFields.operator_ingest_sibling_bucket_id = siblingBucketId;
            if (absorbedSubConceptsField && absorbedSubConceptsField.length > 0) {
              extraFields.absorbed_sub_concepts = absorbedSubConceptsField;
            }
            const resp = await fetch(`${BACKEND_URL}/api/agent/scout-ideas/pending`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-correlation-id": correlationId },
              body: JSON.stringify({ ...baseBody, layer, source_url: layerUrl, source_provider: layerProvider, ...extraFields }),
              signal: AbortSignal.timeout(30_000),
            });
            const j = await resp.json();
            // Track validated bucket IDs for sibling-accept (Bug 4)
            if (j.accepted && j.bucket_id && typeof j.bucket_id === "string") {
              validatedBucketIdsForVideoId.add(j.bucket_id);
            }
            // Surface real error if endpoint rejected (validation, etc.) so operator can see why
            layerResults[layer] = {
              accepted: Boolean(j.accepted),
              status: j.status,
              bucket_id: j.bucket_id,
              http: resp.status,
              ...(j.accepted ? {} : { error: j.error, details: Array.isArray(j.details) ? j.details.slice(0, 3) : undefined }),
            };
          } catch (e) {
            layerResults[layer] = { accepted: false, error: (e as Error).message?.slice(0, 80) };
          }
        }

        ideaPersistResults.push({
          idea_name: ideaName,
          entry_indicator: idea.entry_indicator,
          direction: idea.direction,
          layers: layerResults,
        });
      }

      // 5. Audit
      void insertAuditRowSafe({
        action: "scout.operator_ingested",
        entityType: "scout_extract",
        entityId: null,
        input: { url, video_id: videoId, title, correlation_id: correlationId } as Record<string, unknown>,
        result: { ideas: ideaPersistResults, transcript_chars: transcript.length } as Record<string, unknown>,
        status: "success",
        decisionAuthority: "human",
        correlationId,
      });

      results.push({
        url,
        video_id: videoId,
        title,
        status: "ingested",
        idea_count: extractResult.ideas.length,
        ideas: ideaPersistResults,
      });
    }

    const ingested = results.filter(r => r.status === "ingested").length;

    // ─── INLINE DRAIN (Wave 26 Pass G — Discord/operator-ingest sync path) ───
    // Run the drain right now so the response contains the final per-market
    // strategy rows + lifecycle stage + Wave 25 shape — instead of making the
    // caller wait 10 min for the periodic cron to pick them up.
    let drainSummary: { scanned: number; drained: number; failed: number } | null = null;
    let graduatedStrategies: Array<Record<string, unknown>> = [];
    if (ingested > 0) {
      try {
        const agent = new AgentService();
        const drainResult = await agent.drainScoutedIdeas(10, undefined, { correlationId });
        drainSummary = { scanned: drainResult.scanned, drained: drainResult.drained, failed: drainResult.failed };
        // Query strategies created from this ingest (match by source_url present in entry_quality OR last-N-minutes window)
        const sourceUrls = results.filter(r => r.video_id).map(r => `https://youtube.com/watch?v=${r.video_id}`);
        if (sourceUrls.length > 0) {
          const rows = await db
            .select({
              id: strategies.id,
              name: strategies.name,
              symbols: strategies.symbols,
              lifecycleState: strategies.lifecycleState,
              useWeightedScoring: strategies.useWeightedScoring,
              exitPlanConfig: strategies.exitPlanConfig,
              preferredRegimes: strategies.preferredRegimes,
              dailyTf: strategies.dailyTf,
              htfTf: strategies.htfTf,
              itfTf: strategies.itfTf,
              triggerTf: strategies.triggerTf,
            })
            .from(strategies)
            .where(sql`${strategies.createdAt} > NOW() - INTERVAL '5 minutes'`)
            .orderBy(desc(strategies.createdAt))
            .limit(20);
          graduatedStrategies = rows;
        }
      } catch (drainErr) {
        req.log.warn({ err: drainErr instanceof Error ? drainErr.message : String(drainErr) }, "operator-ingest: inline drain failed (will be caught by next cron tick)");
      }
    }

    res.json({
      correlation_id: correlationId,
      total: urls.length,
      ingested,
      results,
      drain: drainSummary,
      graduated_strategies: graduatedStrategies,
      note: drainSummary
        ? `Drain fired inline (drained ${drainSummary.drained}/${drainSummary.scanned}). Strategies sitting in CANDIDATE/TESTING — backtest gates queued.`
        : "Mentions persisted; next drain cron tick (~10 min) will create the per-market strategy rows.",
    });
  } catch (err) {
    req.log.error({ err }, "Admin: operator-ingest failed");
    res.status(500).json({ error: "Operator ingest failed", detail: (err as Error).message?.slice(0, 200) });
  }
});

// ─── POST /scout/run-autonomous-cycle ────────────────────────────
// Pass 21 — manual trigger for the layered scout cycle. Runs in-process,
// returns immediately; cycle completes async over 3-10 min.
// Restored W23F.N (2026-05-19) after route was dropped during 86-file corruption recovery.
adminRoutes.post("/scout/run-autonomous-cycle", async (req, res) => {
  if (!requirePipelineControlAuthority(req, res)) return;
  try {
    const { runAutonomousScoutCycle } = await import("../services/autonomous-scout-runner.js");
    res.setHeader("Content-Type", "application/json");
    res.write('{"status":"started","note":"running async, may take 3-10 min"}');
    res.end();
    runAutonomousScoutCycle()
      .then((result) => req.log.info({ result }, "autonomous-scout: manual cycle complete"))
      .catch((err) => req.log.error({ err }, "autonomous-scout: manual cycle failed"));
  } catch (err) {
    req.log.error({ err }, "Admin: failed to start autonomous scout cycle");
    res.status(500).json({ error: "Failed to start autonomous scout cycle" });
  }
});

// ─── POST /pipeline/pause ────────────────────────────────────────
adminRoutes.post("/pipeline/pause", async (req, res) => {
  if (!requirePipelineControlAuthority(req, res)) return;
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Manual pause";
    const result = await setMode("PAUSED", reason, req.id ?? null);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin: failed to pause pipeline");
    res.status(500).json({ error: "Failed to pause pipeline" });
  }
});

// ─── POST /pipeline/vacation ─────────────────────────────────────
adminRoutes.post("/pipeline/vacation", async (req, res) => {
  if (!requirePipelineControlAuthority(req, res)) return;
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Vacation mode";
    const result = await setMode("VACATION", reason, req.id ?? null);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin: failed to set vacation mode");
    res.status(500).json({ error: "Failed to set vacation mode" });
  }
});

// ─── GET /scheduler/jobs — List all jobs with health ─────────────
adminRoutes.get("/scheduler/jobs", async (req, res) => {
  try {
    const { getSchedulerJobs, getSchedulerHealth, getSchedulerHealthExtended, getAllJobHealth } = await import("../scheduler.js");

    const jobs = getSchedulerJobs();
    const health = getSchedulerHealth();
    const healthExtended = getSchedulerHealthExtended();
    const jobHealth = getAllJobHealth();

    const result = Object.entries(jobs).map(([name, info]) => ({
      name,
      ...info,
      lastError: healthExtended[name]?.lastError ?? null,
      health: (() => {
        const h = jobHealth.get(name);
        return h
          ? { consecutiveFailures: h.consecutiveFailures, lastFailure: h.lastFailure, disabled: h.disabled, disabledAt: h.disabledAt, disableReason: h.disableReason }
          : { consecutiveFailures: 0, disabled: false };
      })(),
    }));

    res.json({ jobs: result, schedulerHealth: health, schedulerHealthExtended: healthExtended });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to list scheduler jobs");
    res.status(500).json({ error: "Failed to list scheduler jobs" });
  }
});

// ─── POST /scheduler/jobs/:name/enable — Re-enable a disabled job ──
adminRoutes.post("/scheduler/jobs/:name/enable", async (req, res) => {
  // MED (freshscan9 2026-07-12): office-control authority guard — re-enabling a scheduler job is a
  // pipeline-mutating control-plane action (reverses an operator disable or re-arms a job the health
  // system quarantined). Its sibling /disable got this guard in freshscan5 and /harsh-regime in freshscan8;
  // /enable was the last unguarded scheduler-mutation route → a relay-Bearer-only caller (no operator
  // cookie) could re-arm a deliberately-disabled cron. Closes the last hole in this security-parity class.
  if (!requirePipelineControlAuthority(req, res)) return;
  try {
    const { enableJob } = await import("../scheduler.js");
    const enabled = enableJob(req.params.name);
    if (!enabled) {
      res.status(404).json({ error: `Job "${req.params.name}" not found or not disabled` });
      return;
    }
    res.json({ enabled: true, job: req.params.name });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to enable scheduler job");
    res.status(500).json({ error: "Failed to enable scheduler job" });
  }
});

// ─── POST /scheduler/jobs/:name/disable — Manually disable a job ──
adminRoutes.post("/scheduler/jobs/:name/disable", async (req, res) => {
  // HIGH#2 (freshscan5 2026-07-12): office-control authority guard (parity with the sibling
  // pipeline/start|pause|vacation routes). Disabling a scheduler job is a pipeline-mutating
  // privileged action — without this a relay-tunneled caller holding only the shared Bearer API_KEY
  // (the exact threat office-control-guard was created to close) could silence safety crons.
  if (!requirePipelineControlAuthority(req, res)) return;
  try {
    const { getAllJobHealth, isNeverDisableJob } = await import("../scheduler.js");
    // HIGH#2: fail-CLOSED on the NEVER_DISABLE_JOBS set — the manual route must not be able to stop
    // the exact jobs the AUTO-disable path is forbidden from stopping (db-backup = silent total-loss
    // exposure; heartbeat-* = the ONLY vacation-window liveness probes). No override via this route.
    if (isNeverDisableJob(req.params.name)) {
      res.status(403).json({
        error: `Job "${req.params.name}" is protected (NEVER_DISABLE_JOBS) and cannot be manually disabled`,
      });
      return;
    }
    const healthMap = getAllJobHealth();
    const health = healthMap.get(req.params.name);
    if (!health) {
      res.status(404).json({ error: `Job "${req.params.name}" not found` });
      return;
    }
    health.disabled = true;
    health.disabledAt = new Date();
    health.disableReason = "Manually disabled via admin API";
    res.json({ disabled: true, job: req.params.name });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to disable scheduler job");
    res.status(500).json({ error: "Failed to disable scheduler job" });
  }
});

// ─── GET /admin/agent-health-reports ────────────────────────────
// Surfaces the most-recent rows from agent_health_reports for the operator
// dashboard. The agent-audit-service writes here every 2 h (agent-health-sweep
// cron) but until the 2026-04-30 integration audit, no consumer existed.
// Optional ?limit (default 50, max 200).
adminRoutes.get("/agent-health-reports", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db
      .select()
      .from(agentHealthReports)
      .orderBy(desc(agentHealthReports.createdAt))
      .limit(limit);
    res.json({ data: rows, count: rows.length });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to fetch agent health reports");
    res.status(500).json({ error: "Failed to fetch agent health reports" });
  }
});

// ─── GET /admin/harsh-regime-phase — Read current phase + evidence ───────────
//
// Returns the current harsh-regime gate phase (advisory|hard) along with
// activation evidence (activatedAt, firstStrategyId, activatedBy, updatedAt).
// Used by the operator dashboard to display gate status without modifying state.
//
// Phase semantics:
//   advisory — gate warns but never blocks TESTING→PAPER promotion
//   hard     — gate BLOCKS TESTING→PAPER if regime survival fails
//
// The phase flips automatically to "hard" 90 days after the first strategy
// reaches PAPER state (via harsh-regime-phase-activation-check cron at 03:00 UTC).
adminRoutes.get("/harsh-regime-phase", async (req, res) => {
  const correlationId = randomUUID();
  try {
    const record = await getPhaseRecord();
    if (!record) {
      // No row — migration 0115 not applied yet
      req.log.warn({ correlationId }, "Admin harsh-regime-phase: no phase record found — migration 0115 may not be applied");
      return res.status(503).json({
        error: "Phase record unavailable (migration 0115 not applied)",
        correlationId,
      });
    }
    return res.json({
      phase: record.phase,
      activatedAt: record.activatedAt?.toISOString() ?? null,
      firstStrategyId: record.firstStrategyId ?? null,
      activatedBy: record.activatedBy,
      updatedAt: record.updatedAt.toISOString(),
      correlationId,
    });
  } catch (err) {
    req.log.error({ err, correlationId }, "Admin: failed to read harsh-regime phase");
    return res.status(500).json({ error: "Failed to read harsh-regime phase", correlationId });
  }
});

// ─── POST /admin/harsh-regime-phase — Operator phase override ────────────────
//
// Allows the operator to manually override the harsh-regime gate phase.
// Required body fields:
//   phase  — "advisory" | "hard"
//   reason — human-readable string, min 5 chars (stored in audit_log)
//
// Every override (any direction) writes an audit_log row with:
//   action: "harsh_regime_phase.manual_override"
//   decisionAuthority: "human"
//   input: { previousPhase, newPhase, operator, reason }
//
// Rolling back to advisory also clears activatedAt + firstStrategyId so the
// cron can re-trigger auto-activation if conditions are met again later.
//
// Security: this route is admin-authenticated (same auth as all /api/admin/*).
adminRoutes.post("/harsh-regime-phase", async (req, res) => {
  // MED (freshscan8 2026-07-12): office-control authority guard. Flipping the harsh-regime gate
  // hard↔advisory loosens the TESTING→PAPER regime-survival HARD gate — a pipeline-mutating control-plane
  // action. Without this, a relay-tunneled caller holding only the shared Bearer API_KEY (distributed to
  // n8n/crons/scripts — the exact actor office-control-guard excludes) could loosen the gate with no
  // operator cookie. Parity with the sibling pipeline/scheduler-disable routes (freshscan5 HIGH#2).
  if (!requirePipelineControlAuthority(req, res)) return;
  const correlationId = randomUUID();
  const body = req.body as { phase?: string; reason?: string };

  // Input validation
  if (!body.phase || (body.phase !== "advisory" && body.phase !== "hard")) {
    return res.status(400).json({
      error: "Invalid phase: must be 'advisory' or 'hard'",
      correlationId,
    });
  }
  if (!body.reason || typeof body.reason !== "string" || body.reason.trim().length < 5) {
    return res.status(400).json({
      error: "reason required (min 5 characters)",
      correlationId,
    });
  }

  const newPhase = body.phase as PhaseValue;
  const reason = body.reason.trim();
  const operator = (req as { user?: { email?: string } }).user?.email ?? "operator";

  try {
    const result = await setPhaseOverride(newPhase, reason, operator, correlationId);

    // Notify Discord: critical for hard activation, warning for advisory rollback
    if (newPhase === "hard") {
      notifyCritical(
        "Harsh-Regime Gate: MANUALLY ACTIVATED (HARD phase)",
        appendFamilyGradePostscript(
          `Operator override: gate manually hardened to HARD phase.\n\nReason: ${reason}\nOperator: ${operator}\nPrevious phase: ${result.previousPhase}\n\nFrom now on, strategies that fail regime survival checks at TESTING→PAPER will be BLOCKED.`,
          "Tony manually tightened the strategy quality gates.",
          "No action needed — Tony is managing the trading filters.",
        ),
        { operator, reason, previousPhase: result.previousPhase, correlationId },
      );
    } else if (newPhase === "advisory" && result.previousPhase === "hard") {
      notifyWarning(
        "Harsh-Regime Gate: Rolled back to ADVISORY",
        appendFamilyGradePostscript(
          `Operator override: gate rolled back from HARD to advisory.\n\nReason: ${reason}\nOperator: ${operator}\n\nThe 90-day auto-activation clock has been reset. The cron will re-trigger automatically if conditions are met again.`,
          "Tony relaxed the strategy quality gates back to normal.",
          "No action needed — trading is running under standard filters.",
        ),
        { operator, reason, previousPhase: result.previousPhase, correlationId },
      );
    }

    req.log.info(
      { correlationId, operator, newPhase, previousPhase: result.previousPhase, flipped: result.flipped, reason },
      "Admin: harsh-regime phase override applied",
    );

    return res.json({
      phase: newPhase,
      previousPhase: result.previousPhase,
      flipped: result.flipped,
      reason: result.reason,
      correlationId,
    });
  } catch (err) {
    req.log.error({ err, correlationId, newPhase, reason }, "Admin: failed to apply harsh-regime phase override");
    return res.status(500).json({ error: "Failed to apply harsh-regime phase override", correlationId });
  }
});

// ─── GET /admin/data-integrity-findings ─────────────────────────
// Surfaces unresolved (default) or all rows from data_integrity_findings (A8).
// data-integrity-service writes here nightly at 4:00 AM ET but until the
// 2026-04-30 integration audit, no consumer existed — the consolidated
// reconciliation + drift-detection rows were a write-only sink.
// Query params:
//   ?resolved=true     — include resolved findings (default false)
//   ?severity=critical|warning|info — filter by severity
//   ?limit=50          — max 500
adminRoutes.get("/data-integrity-findings", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const includeResolved = req.query.resolved === "true";
    const severity = req.query.severity as string | undefined;

    const conditions = [];
    if (!includeResolved) conditions.push(eq(dataIntegrityFindings.resolved, false));
    if (severity && ["critical", "warning", "info"].includes(severity)) {
      conditions.push(eq(dataIntegrityFindings.severity, severity));
    }

    const rows = await db
      .select()
      .from(dataIntegrityFindings)
      .where(conditions.length === 0 ? undefined : (conditions.length === 1 ? conditions[0] : and(...conditions)))
      .orderBy(desc(dataIntegrityFindings.runAt))
      .limit(limit);
    res.json({ data: rows, count: rows.length, filters: { includeResolved, severity: severity ?? null } });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to fetch data integrity findings");
    res.status(500).json({ error: "Failed to fetch data integrity findings" });
  }
});

// ─── Wave 25 Pass 3 P3.A5 architect close-out ─────────────────────────────────
// POST /admin/liquidity-map/naked-pocs-batch
//
// Persistence endpoint consumed by:
//   - scripts/sync_naked_pocs_to_liquidity_map.py (cron `naked-poc-sync-daily` 16:30 ET)
//   - scripts/sync_naked_pocs_to_liquidity_map.py extended path for HOD/LOD (Wave 26)
//
// Request body:
//   {
//     "symbol": "MES",
//     "as_of_date": "2026-05-24",       // ISO YYYY-MM-DD
//     "records": [
//       {
//         "session_date": "2026-05-20", // when the level was established
//         "price": 5312.25,
//         "level_type": "naked_poc",    // optional: defaults to "naked_poc" for backward compat
//                                       // Wave 26: also accepts "hod" | "lod"
//         "age_days": 2,
//         "establishing_high": 5320.0,
//         "establishing_low": 5298.75,
//         "establishing_volume": 18432.0
//       }, ...
//     ]
//   }
//
// Response: { ok: true, upserted: N, symbol, as_of_date, correlation_id }
//
// Idempotency: UPSERT on (symbol, session_date, level_type, price bucketed to nearest 0.25).
// Re-running the script for the same date produces no duplicate rows.
// HOD/LOD records: expire_at = end_of_session (not implemented; same as naked_poc — no expiry set
// here, operator cron re-runs daily and existing active rows are skipped via idempotency check).
//
// Auth (goalscan 2026-07-16, MED + false-safeguard-doc, A3/A6): this route injects
// liquidity_levels rows that the LIVE 11-factor confluence gate (liquidity_target_clear, w=0.13)
// and adaptive TP1/TP2 selection consume — fabricated rows can push a signal over the 0.72
// threshold or seed bogus exit targets. The prior comment claimed "admin routes are mounted
// behind the tower-relay HMAC gateway so this is defense-in-depth" — that gateway DOES NOT EXIST
// (verified: the only /api boundary is the shared Bearer API_KEY in middleware/auth.ts; the relay
// forwards it verbatim and adds no HMAC). So the shared secret was the ONLY route-level control and
// it was OPTIONAL (unset by default → no control at all).
//
// This is an AUTOMATION endpoint (the daily scripts/sync_naked_pocs_to_liquidity_map.py sync), so an
// Office-cookie-only guard is wrong — a cron can't hold a cookie, and via the relay it can't satisfy
// the loopback branch either. Fix: admit EITHER (a) a valid shared batch secret (the automation path —
// the sync script sends X-Liquidity-Map-Secret) OR (b) Office/operator control authority (manual
// operator on loopback / admin cookie). A relay-tunneled Bearer-only caller with neither is BLOCKED.
// The secret is now an ADMISSION path, not merely a reject-on-mismatch-when-set check.
//
// Audit: liquidity_map.naked_pocs_batched row carries the correlation_id.
adminRoutes.post("/liquidity-map/naked-pocs-batch", async (req, res) => {
  const correlationId = randomUUID();

  // ── Auth: shared-batch-secret OR Office/operator control authority ──
  const requiredSecret = process.env.LIQUIDITY_MAP_BATCH_SECRET;
  const providedSecret = req.header("x-liquidity-map-secret") ?? "";
  const hasValidSecret =
    typeof requiredSecret === "string" && requiredSecret.length > 0 && providedSecret === requiredSecret;
  if (!hasValidSecret) {
    if (requiredSecret && requiredSecret.length > 0 && providedSecret.length > 0) {
      // a secret was configured and one was supplied but did not match — explicit 401 (not a fallthrough)
      logger.warn({ correlationId }, "liquidity-map naked-pocs-batch: shared-secret mismatch");
      return res.status(401).json({ error: "shared_secret_mismatch", correlationId });
    }
    // no valid secret presented → require Office/operator control authority (blocks relay-Bearer injection)
    if (!requirePipelineControlAuthority(req, res)) return;
  }

  // ── Body validation ─────────────────────────────────────────────────────
  const body = (req.body ?? {}) as {
    symbol?: unknown;
    as_of_date?: unknown;
    records?: unknown;
  };

  if (typeof body.symbol !== "string" || body.symbol.trim().length === 0) {
    return res.status(400).json({ error: "missing_or_invalid_field", field: "symbol", correlationId });
  }
  if (typeof body.as_of_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.as_of_date)) {
    return res.status(400).json({ error: "missing_or_invalid_field", field: "as_of_date", correlationId });
  }
  if (!Array.isArray(body.records)) {
    return res.status(400).json({ error: "missing_or_invalid_field", field: "records", correlationId });
  }

  const symbol = body.symbol.trim().toUpperCase();
  const asOfDate = body.as_of_date;
  const records = body.records as Array<Record<string, unknown>>;

  // ── Per-record validation + UPSERT ──────────────────────────────────────
  // We use insert + ON CONFLICT DO NOTHING because the migration 0140 index
  // does not declare a composite unique key; instead we de-dupe by querying
  // for an existing active row at the bucketed price first.  This honours the
  // "±0.25 MES tolerance" spec from the P3.A3 docstring without requiring a
  // new migration.
  let upserted = 0;
  const skipped: Array<{ price: number; reason: string }> = [];

  for (const rec of records) {
    const price = typeof rec.price === "number" ? rec.price : Number.NaN;
    if (!Number.isFinite(price) || price <= 0) {
      skipped.push({ price, reason: "invalid_price" });
      continue;
    }
    const sessionDate = typeof rec.session_date === "string" ? rec.session_date : null;
    if (!sessionDate || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      skipped.push({ price, reason: "invalid_session_date" });
      continue;
    }

    // Resolve level_type: Wave 26 extension allows "hod" | "lod"; default "naked_poc" for compat.
    // Day-trader mandate: PWH/PWL/PMH/PML MUST NOT be accepted here.
    const ALLOWED_BATCH_LEVEL_TYPES = new Set(["naked_poc", "hod", "lod"]);
    const rawLevelType = typeof rec.level_type === "string" ? rec.level_type : "naked_poc";
    if (!ALLOWED_BATCH_LEVEL_TYPES.has(rawLevelType)) {
      skipped.push({ price, reason: `disallowed_level_type:${rawLevelType}` });
      continue;
    }
    const levelType = rawLevelType as "naked_poc" | "hod" | "lod";

    // htf_significance: naked_poc=2 (session), hod/lod=1 (intraday, per Wave 26 spec).
    const htfSignificance = levelType === "naked_poc" ? 2 : 1;

    // Bucket price to nearest 0.25 (MES tick).  Honours idempotency tolerance.
    const priceBucketed = Math.round(price * 4) / 4;
    const priceBucketStr = String(priceBucketed);

    // Build source_meta from the record
    // naked_poc_session is the legacy key consumers (wave25-naked-pocs tests) read;
    // level_session is the newer generalised key. Emit both for backward-compat.
    const sourceMeta: Record<string, unknown> = {
      level_session: sessionDate,
      naked_poc_session: sessionDate,  // backward-compat alias required by batch-endpoint contract
      source: levelType === "naked_poc" ? "naked_poc_sync_cron" : "hod_lod_sync_cron",
      level_type: levelType,
    };
    if (typeof rec.age_days === "number") sourceMeta.age_days = rec.age_days;
    if (typeof rec.establishing_high === "number") sourceMeta.establishing_high = rec.establishing_high;
    if (typeof rec.establishing_low === "number") sourceMeta.establishing_low = rec.establishing_low;
    if (typeof rec.establishing_volume === "number") sourceMeta.establishing_volume = rec.establishing_volume;

    // Check for existing active row at the bucketed price (idempotency window).
    const existing = await db
      .select({ id: liquidityLevels.id })
      .from(liquidityLevels)
      .where(
        and(
          eq(liquidityLevels.symbol, symbol),
          eq(liquidityLevels.levelType, levelType),
          eq(liquidityLevels.price, priceBucketStr),
          // Active rows only — expired rows do not block re-insert
          sql`expired_at IS NULL`,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Idempotent no-op
      continue;
    }

    try {
      await db.insert(liquidityLevels).values({
        symbol,
        sessionDate,
        levelType,
        price: priceBucketStr,
        htfSignificance,
        sourceMeta,
      });
      upserted++;
    } catch (err) {
      logger.warn({ err, symbol, sessionDate, price, levelType }, "liquidity-map naked-pocs-batch: insert failed (skipped)");
      skipped.push({ price, reason: "insert_failed" });
    }
  }

  // ── Audit row (carries correlation_id) ──────────────────────────────────
  await insertAuditRow({
    action: "liquidity_map.naked_pocs_batched",
    entityType: "liquidity_levels",
    entityId: null,
    decisionAuthority: "system",
    input: {
      symbol,
      as_of_date: asOfDate,
      records_submitted: records.length,
    } as Record<string, unknown>,
    result: {
      upserted,
      skipped_count: skipped.length,
      skipped_sample: skipped.slice(0, 5),
    } as Record<string, unknown>,
    status: "success",
    correlationId,
  }).catch((err) =>
    logger.warn({ err, correlationId }, "liquidity-map naked-pocs-batch: audit row write failed (non-blocking)"),
  );

  logger.info(
    { correlationId, symbol, asOfDate, submitted: records.length, upserted, skipped: skipped.length },
    "liquidity-map naked-pocs-batch: complete",
  );

  return res.json({
    ok: true,
    symbol,
    as_of_date: asOfDate,
    upserted,
    skipped: skipped.length,
    correlation_id: correlationId,
  });
});

// ─── Wave 26 Pass G Pass D: GET /strategies/needs-attention ──────────────────
//
// Returns all strategies that need operator attention:
//   - status ∈ {NEEDS_ARCHETYPE, NEEDS_REVISION}  (hard lifecycle blockers)
//   - config.entry_quality.factor_quality = 'fallback_only'  (thin library debt)
//   - config.lifecycle_metadata.stale_since != null  (inactive candidates)
//
// Each row includes a suggested_action so the dashboard tile is self-contained.
//
// Response shape:
// {
//   ok: true,
//   count: number,
//   strategies: Array<{
//     id: string,
//     name: string,
//     status: string,
//     factor_quality: string | null,
//     stale_since: string | null,
//     last_extraction_outcome: string | null,
//     last_graduation_outcome: string | null,
//     extraction_attempt_count: number | null,
//     source_urls: string[],
//     suggested_action: string
//   }>
// }

adminRoutes.get("/strategies/needs-attention", async (req, res) => {
  const correlationId = randomUUID();

  try {
    const rows = await db.execute(sql`
      SELECT
        id::text                                                        AS id,
        name,
        lifecycle_state                                                 AS status,
        config->'entry_quality'->>'factor_quality'                     AS factor_quality,
        config->'lifecycle_metadata'->>'stale_since'                   AS stale_since,
        config->'lifecycle_metadata'->>'last_extraction_outcome'       AS last_extraction_outcome,
        config->'lifecycle_metadata'->>'last_graduation_outcome'       AS last_graduation_outcome,
        (config->'lifecycle_metadata'->>'extraction_attempt_count')::int AS extraction_attempt_count
      FROM strategies
      WHERE
        lifecycle_state IN ('NEEDS_ARCHETYPE', 'NEEDS_REVISION')
        OR config->'entry_quality'->>'factor_quality' = 'fallback_only'
        OR (config->'lifecycle_metadata'->>'stale_since') IS NOT NULL
      ORDER BY
        CASE lifecycle_state
          WHEN 'NEEDS_ARCHETYPE' THEN 0
          WHEN 'NEEDS_REVISION'  THEN 1
          ELSE 2
        END,
        name ASC
    `);

    type RawRow = {
      id: string;
      name: string;
      status: string;
      factor_quality: string | null;
      stale_since: string | null;
      last_extraction_outcome: string | null;
      last_graduation_outcome: string | null;
      extraction_attempt_count: number | null;
    };

    const rawRows = (rows as unknown) as RawRow[];

    // Resolve source URLs for all strategies in one pass
    const names = rawRows.map((r) => r.name);
    let urlMap: Record<string, string[]> = {};
    try {
      urlMap = await getStrategySourceUrls(names);
    } catch (err) {
      logger.warn({ err, correlationId }, "needs-attention: source URL resolution failed — proceeding without URLs");
    }

    const strategiesOut = rawRows.map((r) => {
      const suggestedAction = deriveSuggestedAction(r.status, r.factor_quality, r.stale_since, r.last_extraction_outcome);
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        factor_quality: r.factor_quality ?? null,
        stale_since: r.stale_since ?? null,
        last_extraction_outcome: r.last_extraction_outcome ?? null,
        last_graduation_outcome: r.last_graduation_outcome ?? null,
        extraction_attempt_count: r.extraction_attempt_count ?? null,
        source_urls: urlMap[r.name] ?? [],
        suggested_action: suggestedAction,
      };
    });

    logger.info(
      { correlationId, count: strategiesOut.length },
      "admin: needs-attention query complete",
    );

    return res.json({
      ok: true,
      count: strategiesOut.length,
      strategies: strategiesOut,
    });
  } catch (err) {
    logger.error({ err, correlationId }, "admin: needs-attention query failed");
    return res.status(500).json({ error: "needs_attention_query_failed", correlationId });
  }
});

function deriveSuggestedAction(
  status: string,
  factorQuality: string | null,
  staleSince: string | null,
  lastExtractionOutcome: string | null,
): string {
  if (status === "NEEDS_ARCHETYPE") {
    return "Register archetype in ARCHETYPE_REGISTRY and re-run extraction";
  }
  if (status === "NEEDS_REVISION") {
    if (lastExtractionOutcome === "source_url_unreachable") {
      return "Source URL is unreachable — find a replacement video or update source URL, then re-extract";
    }
    if (lastExtractionOutcome === "gemma_failed") {
      return "Gemma extraction failed — check Ollama health, then trigger manual re-extraction";
    }
    if (lastExtractionOutcome === "no_archetype_match") {
      return "Register missing archetype in ARCHETYPE_REGISTRY and re-run extraction";
    }
    if (staleSince) {
      const staleDays = Math.floor((Date.now() - new Date(staleSince).getTime()) / 86_400_000);
      return `Inactive ${staleDays}+ days — run a backtest or paper session to re-activate, or manually revise`;
    }
    return "Review strategy config and re-extract or manually edit; then reset lifecycle to CANDIDATE";
  }
  if (factorQuality === "fallback_only") {
    return "Re-extract: all confluence factors are auto-floor injections — no LLM-extracted factors present";
  }
  if (staleSince) {
    const staleDays = Math.floor((Date.now() - new Date(staleSince).getTime()) / 86_400_000);
    return `Stale ${staleDays}+ days — run a backtest or paper session to resume activity`;
  }
  return "Review strategy config";
}

// ─── GET /needs-archetype-queue/summary ─────────────────────────────────────
//
// Returns a summary of the needs_archetype_queue table for the Archetype Queue
// dashboard tile. All counts are scoped to status='pending' rows only.
//
// Response shape:
// {
//   ok: true,
//   total: number,                               // total pending terms
//   top: Array<{ term: string, extractionCount: number }>,  // top 10 by count
//   readyCount: number                           // pending rows with count >= 3
// }
//
// Read-only — no mutations. No auth beyond the standard /api/* auth middleware.

adminRoutes.get(
  "/needs-archetype-queue/summary",
  async (_req: Request, res: Response): Promise<void> => {
    const correlationId = randomUUID();

    try {
      const [totalRow] = await db
        .select({ value: count() })
        .from(needsArchetypeQueue)
        .where(eq(needsArchetypeQueue.status, "pending"));

      const total = Number(totalRow?.value ?? 0);

      const topRows = await db
        .select({
          term: needsArchetypeQueue.speakerTerm,
          extractionCount: needsArchetypeQueue.extractionCount,
        })
        .from(needsArchetypeQueue)
        .where(eq(needsArchetypeQueue.status, "pending"))
        .orderBy(desc(needsArchetypeQueue.extractionCount))
        .limit(10);

      const [readyRow] = await db
        .select({ value: count() })
        .from(needsArchetypeQueue)
        .where(
          and(
            eq(needsArchetypeQueue.status, "pending"),
            gte(needsArchetypeQueue.extractionCount, 3),
          ),
        );

      const readyCount = Number(readyRow?.value ?? 0);

      logger.info(
        { correlationId, total, readyCount },
        "admin: needs-archetype-queue summary complete",
      );

      res.json({
        ok: true,
        total,
        top: topRows.map((r) => ({
          term: r.term,
          extractionCount: r.extractionCount,
        })),
        readyCount,
      });
    } catch (err) {
      logger.error(
        { err, correlationId },
        "admin: needs-archetype-queue summary failed",
      );
      res
        .status(500)
        .json({ error: "needs_archetype_queue_summary_failed", correlationId });
    }
  },
);
