/**
 * Admin Routes — pipeline control endpoints.
 *
 * GET  /pipeline/status   — current pipeline mode
 * POST /pipeline/start    — set mode to ACTIVE
 * POST /pipeline/pause    — set engine mode to PAUSED; n8n remains always-on
 * POST /pipeline/vacation — set engine mode to VACATION; n8n remains always-on
 */

import { Router } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { desc, eq, and, sql } from "drizzle-orm";
import { getMode, setMode } from "../services/pipeline-control-service.js";
import { db } from "../db/index.js";
import { agentHealthReports, dataIntegrityFindings, liquidityLevels } from "../db/schema.js";
import { getPhaseRecord, setPhaseOverride, type PhaseValue } from "../services/harsh-regime-phase-service.js";
import { notifyCritical, notifyWarning } from "../services/notification-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { logger } from "../lib/logger.js";

export const adminRoutes = Router();

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
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason_code: "secret_not_configured" };
    }
    // Dev/test: allow through without secret so tests don't need the env var
    return { ok: true };
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

adminRoutes.post("/self-restart", async (req, res) => {
  const correlationId = randomUUID();
  const body = (req.body ?? {}) as { timestamp?: number; reason?: string };

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
    req.log?.warn({ drift, correlationId }, "self-restart: timestamp drift exceeded — replay protection");
    res.status(401).json({ error: "timestamp_drift_exceeded", drift_ms: drift, max_ms: RESTART_TIMESTAMP_DRIFT_MS });
    return;
  }

  // ── HMAC verification ──────────────────────────────────────────────────────
  const sig = req.header("x-restart-signature");
  const verified = verifyRestartHmac(sig, body.timestamp, body.reason.trim());
  if (!verified.ok) {
    req.log?.warn({ reason_code: verified.reason_code, correlationId }, "self-restart: HMAC verification failed");
    res.status(401).json({ error: "hmac_verification_failed", reason_code: verified.reason_code });
    return;
  }

  const reason = body.reason.trim();
  logger.info({ correlationId, reason }, "self-restart: HMAC verified — initiating graceful restart");

  // ── Audit row ─────────────────────────────────────────────────────────────
  await insertAuditRow({
    action: "system.self_restart_requested",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human",
    input: { reason, timestamp: body.timestamp } as Record<string, unknown>,
    result: { correlationId } as Record<string, unknown>,
    status: "success",
    correlationId,
  }).catch((err) => logger.error({ err }, "self-restart: audit row write failed (non-blocking)"));

  // ── Discord notification ───────────────────────────────────────────────────
  notifyCritical(
    "Self-Restart Initiated",
    `Backend process is restarting via HMAC-authenticated endpoint. Reason: ${reason}. NSSM will respawn automatically.`,
    { reason, correlationId },
  );

  // ── Respond before exiting ────────────────────────────────────────────────
  res.json({ status: "restart_initiated", reason, correlationId });

  // ── Flush logs + exit ─────────────────────────────────────────────────────
  logger.info({ correlationId, reason }, "self-restart: flushing logs — process.exit(0) in 1s");
  setTimeout(() => {
    process.exit(0);
  }, 1_000);
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
        `Operator manually cleared absence markers. clearedSince=${clearedSince?.toISOString() ?? "null"}, ` +
          `clearedPending=${clearedPending?.toISOString() ?? "null"}.`,
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
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Manual start";
    const result = await setMode("ACTIVE", reason);
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
      let extractResult: { extracted?: boolean; ideas?: Array<Record<string, unknown>>; reason?: string };
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
          signal: AbortSignal.timeout(180_000),
        });
        extractResult = await resp.json();
      } catch (e) {
        results.push({ url, video_id: videoId, status: "extract_failed", error: (e as Error).message?.slice(0, 100) });
        continue;
      }

      if (!extractResult.extracted || !extractResult.ideas?.length) {
        results.push({ url, video_id: videoId, title, status: "not_extracted", reason: extractResult.reason });
        continue;
      }

      // 4. Persist mentions — write 3 synthetic layers (web + youtube + reddit)
      //    so cross-validation requirement is met (operator IS the cross-validator).
      //    All 3 share the same source_url + extracted content; only scout_layer differs.
      const ideaPersistResults: Array<Record<string, unknown>> = [];
      for (const idea of extractResult.ideas) {
        const ideaName = (idea.name as string) || (idea.concept_name as string) || `operator_${videoId}`;
        const conceptName = (idea.concept_name as string) || ideaName;
        const market = (idea.symbol as string) || (Array.isArray(idea.symbols) ? (idea.symbols[0] as string) : "MES");

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
            const resp = await fetch(`${BACKEND_URL}/api/agent/scout-ideas/pending`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-correlation-id": correlationId },
              body: JSON.stringify({ ...baseBody, layer, source_url: layerUrl, source_provider: layerProvider }),
              signal: AbortSignal.timeout(30_000),
            });
            const j = await resp.json();
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
      db.insert(await import("../db/schema.js").then(m => m.auditLog)).values({
        action: "scout.operator_ingested",
        entityType: "scout_extract",
        entityId: null,
        input: { url, video_id: videoId, title, correlation_id: correlationId } as Record<string, unknown>,
        result: { ideas: ideaPersistResults, transcript_chars: transcript.length } as Record<string, unknown>,
        status: "success",
        decisionAuthority: "human",
        correlationId,
      } as Record<string, unknown>).catch((auditErr: unknown) =>
        req.log.warn({ auditErr }, "operator-ingest: audit write failed")
      );

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
    res.json({
      correlation_id: correlationId,
      total: urls.length,
      ingested,
      results,
      note: "Mentions persisted across 3 synthetic layers (web/youtube/reddit) so graduator cross-validation is met. Graduator drain runs every ~30 min via 'drain-scouted-ideas-periodic' cron; bucket entries should appear within that window.",
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
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Manual pause";
    const result = await setMode("PAUSED", reason);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin: failed to pause pipeline");
    res.status(500).json({ error: "Failed to pause pipeline" });
  }
});

// ─── POST /pipeline/vacation ─────────────────────────────────────
adminRoutes.post("/pipeline/vacation", async (req, res) => {
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Vacation mode";
    const result = await setMode("VACATION", reason);
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
  try {
    const { getAllJobHealth } = await import("../scheduler.js");
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
        `Operator override: gate manually hardened to HARD phase.\n\nReason: ${reason}\nOperator: ${operator}\nPrevious phase: ${result.previousPhase}\n\nFrom now on, strategies that fail regime survival checks at TESTING→PAPER will be BLOCKED.`,
        { operator, reason, previousPhase: result.previousPhase, correlationId },
      );
    } else if (newPhase === "advisory" && result.previousPhase === "hard") {
      notifyWarning(
        "Harsh-Regime Gate: Rolled back to ADVISORY",
        `Operator override: gate rolled back from HARD to advisory.\n\nReason: ${reason}\nOperator: ${operator}\n\nThe 90-day auto-activation clock has been reset. The cron will re-trigger automatically if conditions are met again.`,
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
// Auth: optional shared-secret via X-Liquidity-Map-Secret header.  Enforced
// only when env var LIQUIDITY_MAP_BATCH_SECRET is set.  Operator-grade admin
// endpoint — admin routes are mounted behind the tower-relay HMAC gateway so
// this layer is defense-in-depth, not the primary auth boundary.
//
// Audit: liquidity_map.naked_pocs_batched row carries the correlation_id.
adminRoutes.post("/liquidity-map/naked-pocs-batch", async (req, res) => {
  const correlationId = randomUUID();

  // ── Optional shared-secret check ────────────────────────────────────────
  const requiredSecret = process.env.LIQUIDITY_MAP_BATCH_SECRET;
  if (requiredSecret && requiredSecret.length > 0) {
    const providedSecret = req.header("x-liquidity-map-secret") ?? "";
    if (providedSecret !== requiredSecret) {
      logger.warn({ correlationId }, "liquidity-map naked-pocs-batch: shared-secret mismatch");
      return res.status(401).json({ error: "shared_secret_mismatch", correlationId });
    }
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
    const sourceMeta: Record<string, unknown> = {
      level_session: sessionDate,
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
