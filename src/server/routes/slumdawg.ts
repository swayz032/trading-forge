/**
 * Slumdawg Analyst routes — read-only API surface for the Anam.ai avatar agent.
 *
 * 5 endpoints powering the 5 conversational capabilities:
 *   GET  /slumdawg/activity-today    — today's bot activity (signals, trades, P&L)
 *   GET  /slumdawg/journal-today     — today's GPT-5.4 trade critiques
 *   GET  /slumdawg/status-now        — live state (open positions, regime, kill switch)
 *   GET  /slumdawg/lifecycle/:name?  — per-strategy lifecycle + gates + metrics
 *   POST /slumdawg/ingest-youtube    — proxy to operator-ingest with progress polling
 *
 * Auth: HMAC shared-secret header `X-Slumdawg-Signature` via SLUMDAWG_WEBHOOK_SECRET.
 *       n8n holds the secret; Anam never touches TF directly.
 *
 * Hallucination guard: every endpoint returns BOTH structured data AND a
 * baby_jargon_summary string the Anam LLM can speak verbatim. The LLM is
 * instructed (system prompt) to prefer the summary over restating numbers.
 *
 * Wave 26 Pass G (2026-05-25) — Slumdawg Analyst integration.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import {
  isUnconfiguredSlumdawgSecret,
  verifySlumdawgHmac,
} from "../slumdawg-hmac.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";

export const slumdawgRoutes = Router();

// ─── HMAC auth gate ──────────────────────────────────────────────────────
//
// SECURITY: No NODE_ENV bypass. The secret must be rotated before first use.
// When SLUMDAWG_WEBHOOK_SECRET is unset or equals the documented placeholder,
// every request returns HTTP 503 — in dev AND in prod. This is the only safe
// default because the live tower .env shipped with the placeholder value.
//
// Pattern mirrors admin-frozen-policy-override.ts (Wave 29 Pass B.2) but
// deliberately omits the `&& NODE_ENV === "production"` guard that file uses,
// because the slumdawg route had an active bypass in the wild.
async function requireSlumdawgAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const secret = process.env.SLUMDAWG_WEBHOOK_SECRET;

  // ── 503: Secret not configured or equals placeholder ──────────────────
  if (isUnconfiguredSlumdawgSecret(secret)) {
    const correlationId = randomUUID();
    logger.warn(
      { route: req.path, correlationId },
      "SLUMDAWG_WEBHOOK_SECRET unset or equals placeholder — returning 503. Rotate the secret before use.",
    );
    // Audit row (non-blocking — must not prevent the 503 from returning)
    db.insert(auditLog)
      .values({
        action: "slumdawg.webhook_secret_unconfigured",
        entityType: "paper_session",
        status: "warning",
        decisionAuthority: "system",
        result: {
          route: req.path,
          detail: "SLUMDAWG_WEBHOOK_SECRET is unset or equals the placeholder. Rotate it per .env.example instructions.",
          correlation_id: correlationId,
        },
        correlationId,
      })
      .catch((err) => {
        logger.warn({ err, correlationId }, "slumdawg: webhook_secret_unconfigured audit insert failed (non-blocking)");
      });
    res.status(503).json({
      error: "webhook_secret_unconfigured",
      detail:
        "SLUMDAWG_WEBHOOK_SECRET must be set to a ≥32-char random value before use. " +
        "See .env.example for instructions. No NODE_ENV bypass exists — rotate the secret.",
      correlationId,
    });
    return;
  }

  // ── HMAC validation ───────────────────────────────────────────────────
  const sig = String(req.headers["x-slumdawg-signature"] ?? "");
  const ts  = String(req.headers["x-slumdawg-timestamp"] ?? "");
  if (!sig || !ts) {
    res.status(401).json({ error: "missing_signature_or_timestamp" });
    return;
  }
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) {
    res.status(401).json({ error: "timestamp_drift_exceeds_5min" });
    return;
  }
  const verified = verifySlumdawgHmac(sig, ts, req.path, secret!);
  if (!verified.ok) {
    res.status(401).json({ error: "signature_mismatch" });
    return;
  }
  next();
}

slumdawgRoutes.use(requireSlumdawgAuth);

// ─── Plain-English translators (jargon → baby talk) ──────────────────────
function regimeBaby(regime: string | null | undefined): string {
  switch (String(regime ?? "").toUpperCase()) {
    case "TRENDING_UP":     return "market is climbing";
    case "TRENDING_DOWN":   return "market is dropping";
    case "RANGE_BOUND":     return "market is bouncing in a box, no clear direction";
    case "EXPANSION":       return "market just woke up — big moves happening";
    case "COMPRESSION":     return "market is sleeping, getting ready to pop";
    case "HIGH_VOL_MACRO":  return "wild day — news drop or FOMC, crazy moves";
    case "LOW_LIQ_CHOP":    return "dead zone between sessions, choppy";
    default:                return "market mood unclear";
  }
}

function lifecycleBaby(state: string): string {
  switch (state) {
    case "CANDIDATE":     return "fresh rookie, just signed — not played a real game yet";
    case "TESTING":       return "rookie in practice scrimmages, learning the playbook";
    case "PAPER":         return "rookie playing preseason — fake money, real moves";
    case "DEPLOY_READY":  return "passed all tryouts, coach reviewing the tape";
    case "PILOT":         return "bench player getting minutes — small real money";
    case "DEPLOYED":      return "starter on the squad — full money plays";
    case "GRAVEYARD":     return "cut from the team — didn't pass the tests";
    case "RETIRED":       return "retired veteran — was good, no longer playing";
    default:              return `unknown stage: ${state}`;
  }
}

function gradeBaby(grade: string): string {
  switch (grade) {
    case "A+": case "A":  return "straight A — clean win, textbook execution";
    case "B+": case "B":  return "solid B — winner, small thing to clean up";
    case "C+": case "C":  return "average C — neither great nor terrible";
    case "D":             return "D — sloppy, real problem to fix";
    case "F":             return "F — blew it, needs a hard rule change";
    default:              return `grade ${grade}`;
  }
}

function pnlBaby(pnl: number): string {
  if (pnl > 0) return `+$${pnl.toFixed(0)} (green day)`;
  if (pnl < 0) return `-$${Math.abs(pnl).toFixed(0)} (red day)`;
  return "flat $0";
}

// ─── 1) GET /slumdawg/activity-today ─────────────────────────────────────
slumdawgRoutes.get("/activity-today", async (_req, res) => {
  try {
    const since = sql`NOW() - INTERVAL '24 hours'`;

    const signalsRow = await db.execute<{ fired: number; rejected: number }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE action = 'signal.fired' AND status = 'success')::int AS fired,
        COUNT(*) FILTER (WHERE action LIKE 'signal.%' AND status = 'rejected')::int AS rejected
      FROM audit_log WHERE created_at > ${since}
    `);
    const fired = Number((signalsRow as any[])[0]?.fired ?? 0);
    const rejected = Number((signalsRow as any[])[0]?.rejected ?? 0);

    const tradesRow = await db.execute<{ taken: number; winners: number; losers: number; pnl: string }>(sql`
      SELECT
        COUNT(*)::int AS taken,
        COUNT(*) FILTER (WHERE (unrealized_pnl)::numeric > 0)::int AS winners,
        COUNT(*) FILTER (WHERE (unrealized_pnl)::numeric < 0)::int AS losers,
        COALESCE(SUM((unrealized_pnl)::numeric), 0)::text AS pnl
      FROM paper_positions
      WHERE closed_at IS NOT NULL AND closed_at > ${since}
    `);
    const taken = Number((tradesRow as any[])[0]?.taken ?? 0);
    const winners = Number((tradesRow as any[])[0]?.winners ?? 0);
    const losers = Number((tradesRow as any[])[0]?.losers ?? 0);
    const pnl = Number((tradesRow as any[])[0]?.pnl ?? 0);

    const haltsRow = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM audit_log
      WHERE created_at > ${since} AND action ILIKE '%halt%' AND status = 'success'
    `);
    const halts = Number((haltsRow as any[])[0]?.n ?? 0);

    const today = new Date().toISOString().slice(0, 10);
    const baby_jargon_summary =
      taken === 0
        ? `Today (${today}): Slumdawg Bot didn't take any trades. ${fired} signals fired but ${rejected} got rejected by safety gates. No trades, no losses — clean slate.`
        : `Today (${today}): Slumdawg Bot took ${taken} trade${taken === 1 ? "" : "s"} — ${winners} winner${winners === 1 ? "" : "s"}, ${losers} loser${losers === 1 ? "" : "s"}. Net ${pnlBaby(pnl)}. ${fired} signals fired total, ${rejected} got blocked by safety gates. ${halts > 0 ? `Hit ${halts} safety brake${halts === 1 ? "" : "s"} today.` : "No safety brakes hit — smooth day."}`;

    res.json({
      date: today,
      signals_fired: fired,
      signals_rejected_by_gate: rejected,
      trades_taken: taken,
      winners,
      losers,
      net_pnl_dollars: pnl,
      halt_events: halts,
      baby_jargon_summary,
    });
  } catch (err) {
    logger.error({ err }, "slumdawg activity-today failed");
    res.status(500).json({ error: "internal_error", baby_jargon_summary: "I can't pull today's activity right now — the database hiccupped. Try again in a sec." });
  }
});

// ─── 2) GET /slumdawg/journal-today ──────────────────────────────────────
slumdawgRoutes.get("/journal-today", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT id::text, position_id::text, grade, plain_english_summary, technical_diagnosis, critiqued_at
      FROM trade_critique
      WHERE critiqued_at > NOW() - INTERVAL '24 hours'
      ORDER BY critiqued_at DESC LIMIT 20
    `);
    const list = rows as any[];
    if (list.length === 0) {
      res.json({
        critique_count: 0,
        critiques: [],
        baby_jargon_summary: "GPT hasn't written any trade journals today yet. Either Slumdawg didn't take any trades, or the journals are still being written (they fire when each trade closes). Check back at the end of the session.",
      });
      return;
    }

    const critiques = list.map((r) => {
      const pes = r.plain_english_summary as Record<string, any> ?? {};
      const tech = r.technical_diagnosis as Record<string, any> ?? {};
      return {
        position_id: r.position_id,
        grade: r.grade,
        grade_baby: gradeBaby(r.grade),
        what_happened: pes.what_happened ?? pes.summary ?? "no summary",
        what_to_do_better: pes.improvement ?? pes.next_time ?? tech.parameter_hints ?? "no suggestion",
        critiqued_at: r.critiqued_at,
      };
    });

    const gradeCounts: Record<string, number> = {};
    for (const c of critiques) gradeCounts[c.grade] = (gradeCounts[c.grade] ?? 0) + 1;
    const summaries = critiques.slice(0, 3).map((c) => `${c.grade_baby}: ${String(c.what_happened).slice(0, 150)}`);

    const baby_jargon_summary =
      `GPT graded ${critiques.length} trade${critiques.length === 1 ? "" : "s"} today. Grade breakdown: ${Object.entries(gradeCounts).map(([g, n]) => `${n} ${g}`).join(", ")}. Top notes: ${summaries.join("  |  ")}. Tomorrow's homework: ${critiques[0]?.what_to_do_better ?? "no specific change suggested"}.`;

    res.json({ critique_count: critiques.length, critiques, baby_jargon_summary });
  } catch (err) {
    logger.error({ err }, "slumdawg journal-today failed");
    res.status(500).json({ error: "internal_error", baby_jargon_summary: "Can't read GPT's journal right now — DB hiccupped." });
  }
});

// ─── 3) GET /slumdawg/status-now ─────────────────────────────────────────
slumdawgRoutes.get("/status-now", async (_req, res) => {
  try {
    const openRows = await db.execute(sql`
      SELECT id::text, symbol, side, contracts, entry_price::text, current_price::text, unrealized_pnl::text, entry_time
      FROM paper_positions WHERE closed_at IS NULL ORDER BY entry_time DESC LIMIT 10
    `);
    const positions = (openRows as any[]).map((p) => ({
      symbol: p.symbol,
      side: p.side,
      contracts: p.contracts,
      entry_price: Number(p.entry_price),
      current_price: Number(p.current_price),
      unrealized_pnl: Number(p.unrealized_pnl ?? 0),
      entry_time: p.entry_time,
    }));
    const openPnl = positions.reduce((a, p) => a + p.unrealized_pnl, 0);

    const closedTodayRow = await db.execute<{ pnl: string }>(sql`
      SELECT COALESCE(SUM((unrealized_pnl)::numeric), 0)::text AS pnl
      FROM paper_positions WHERE closed_at IS NOT NULL AND closed_at > NOW() - INTERVAL '24 hours'
    `);
    const closedPnl = Number((closedTodayRow as any[])[0]?.pnl ?? 0);
    const todayPnl = openPnl + closedPnl;

    // Regime (latest published)
    const regimeRow = await db.execute(sql`
      SELECT regime, institutional_regime, narrative_state FROM bias_state ORDER BY updated_at DESC NULLS LAST LIMIT 1
    `).catch(() => [] as any[]);
    const regime = (regimeRow as any[])[0]?.institutional_regime ?? (regimeRow as any[])[0]?.regime ?? null;
    const narrative = (regimeRow as any[])[0]?.narrative_state ?? null;

    // Kill switch / pipeline mode
    const modeRow = await db.execute(sql`SELECT value FROM system_parameters WHERE key = 'pipeline_mode' LIMIT 1`).catch(() => [] as any[]);
    const mode = (modeRow as any[])[0]?.value ?? "UNKNOWN";

    // Time-to-flatten (15:55 ET = 19:55 UTC during EST / 20:55 UTC during EDT — approx)
    const nowMinUTC = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
    const flattenMinUTC = 19 * 60 + 55; // assumes EST; close enough for narration
    const minsToFlatten = flattenMinUTC > nowMinUTC ? flattenMinUTC - nowMinUTC : null;

    const baby_jargon_summary =
      positions.length === 0
        ? `Right now: no trades open. Today's locked-in P&L: ${pnlBaby(closedPnl)}. ${regime ? `Market mood: ${regimeBaby(regime)}.` : ""} Pipeline is ${mode === "ACTIVE" ? "running normally" : mode === "PAUSED" ? "PAUSED — not taking new trades" : mode === "VACATION" ? "in vacation mode" : `in ${mode} state`}.`
        : `Right now: ${positions.length} trade${positions.length === 1 ? "" : "s"} open. ${positions.map((p) => `${p.side === "long" ? "Long" : "Short"} ${p.contracts} ${p.symbol} from ${p.entry_price}, currently ${pnlBaby(p.unrealized_pnl)}`).join(". ")}. Today P&L (open + closed): ${pnlBaby(todayPnl)}. ${regime ? `Market mood: ${regimeBaby(regime)}.` : ""} ${minsToFlatten ? `Bot closes everything in ${minsToFlatten} minutes at 3:55pm ET — that's the daily safety brake.` : ""}`;

    res.json({
      open_positions: positions,
      open_pnl_dollars: openPnl,
      closed_today_pnl_dollars: closedPnl,
      total_today_pnl_dollars: todayPnl,
      regime,
      regime_baby: regimeBaby(regime),
      narrative_phase: (narrative as any)?.phase ?? null,
      pipeline_mode: mode,
      minutes_to_flatten: minsToFlatten,
      baby_jargon_summary,
    });
  } catch (err) {
    logger.error({ err }, "slumdawg status-now failed");
    res.status(500).json({ error: "internal_error", baby_jargon_summary: "Can't read live status right now — DB hiccupped." });
  }
});

// ─── 4) GET /slumdawg/lifecycle  +  GET /slumdawg/lifecycle/:name ─────────
// Express 5 / path-to-regexp v8 dropped the `?` optional-param syntax; we
// register two separate routes that share the same handler.
const lifecycleHandler = async (req: Request, res: Response) => {
  try {
    const filter = (req.params as Record<string, string | undefined>).name ? sql`AND name ILIKE ${"%" + (req.params as Record<string, string | undefined>).name + "%"}` : sql``;
    const rows = await db.execute(sql`
      SELECT id::text, name, symbol, timeframe, lifecycle_state, preferred_regimes, created_at,
             config->'metadata'->>'source' as src
      FROM strategies WHERE source='graduated_bucket' ${filter}
      ORDER BY created_at DESC LIMIT 50
    `);
    const list = rows as any[];

    if (list.length === 0) {
      res.json({
        strategy_count: 0,
        strategies: [],
        baby_jargon_summary: (req.params as Record<string, string | undefined>).name
          ? `No strategy named "${(req.params as Record<string, string | undefined>).name}" in the library. Names look like "ema_crossover_4h_retrace_mes_4h" — try the concept word.`
          : "Library is empty.",
      });
      return;
    }

    const byState: Record<string, number> = {};
    for (const r of list) byState[r.lifecycle_state] = (byState[r.lifecycle_state] ?? 0) + 1;
    const strategies = list.map((r) => ({
      name: r.name,
      symbol: r.symbol,
      timeframe: r.timeframe,
      stage: r.lifecycle_state,
      stage_baby: lifecycleBaby(r.lifecycle_state),
      regimes: r.preferred_regimes ?? [],
    }));

    const baby_jargon_summary = (req.params as Record<string, string | undefined>).name
      ? strategies.length === 1
        ? `Strategy "${strategies[0].name}" is on ${strategies[0].symbol} ${strategies[0].timeframe}. Stage: ${lifecycleBaby(strategies[0].stage)}. Works best when ${strategies[0].regimes.length ? strategies[0].regimes.map((r: string) => regimeBaby(r)).join(" OR ") : "any market mood"}.`
        : `Found ${strategies.length} strategies matching "${(req.params as Record<string, string | undefined>).name}". ${strategies.slice(0, 5).map((s: any) => `${s.name} (${s.symbol} ${s.timeframe}, ${s.stage_baby})`).join("; ")}.`
      : `Library has ${list.length} strategies across ${Object.keys(byState).length} stage${Object.keys(byState).length === 1 ? "" : "s"}: ${Object.entries(byState).map(([s, n]) => `${n} in ${lifecycleBaby(s)}`).join(" — ")}.`;

    res.json({ strategy_count: list.length, by_stage: byState, strategies, baby_jargon_summary });
  } catch (err) {
    logger.error({ err }, "slumdawg lifecycle failed");
    res.status(500).json({ error: "internal_error", baby_jargon_summary: "Can't read the strategy library right now — DB hiccupped." });
  }
};
slumdawgRoutes.get("/lifecycle", lifecycleHandler);
slumdawgRoutes.get("/lifecycle/:name", lifecycleHandler);

// ─── 5) POST /slumdawg/ingest-youtube ───────────────────────────────────
// Wave 2 Track 2A: idempotencyMiddleware (runs AFTER the router-level
// requireSlumdawgAuth HMAC gate) deduplicates identical POSTs by
// X-Idempotency-Key (fail-open — no key ⇒ pass straight through). Closes the
// Slumdawg gateway webhook double-fire → duplicate YouTube ingestion.
slumdawgRoutes.post("/ingest-youtube", idempotencyMiddleware, async (req, res) => {
  try {
    const url = String((req.body as any)?.url ?? "").trim();
    if (!url || !/youtu/i.test(url)) {
      res.status(400).json({ error: "invalid_url", baby_jargon_summary: "That's not a YouTube link — paste me a youtube.com or youtu.be URL." });
      return;
    }
    // Proxy to existing operator-ingest endpoint (preserves all validation, day-trader filter, Gemma routing).
    const PORT = process.env.PORT ?? "4000";
    // This is a tower self-call through the /api gate — send the shared API_KEY
    // Bearer so it survives auth activation (deep-scan #13). Omitted when unset
    // (dev: authMiddleware dev-bypass ignores it).
    const _ingestHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.API_KEY) _ingestHeaders["Authorization"] = `Bearer ${process.env.API_KEY}`;
    const ingest = await fetch(`http://127.0.0.1:${PORT}/api/admin/scout/operator-ingest`, {
      method: "POST",
      headers: _ingestHeaders,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(180_000),
    });
    const result = await ingest.json() as {
      results?: Array<{ url: string; video_id?: string; status?: string; title?: string; idea_count?: number; ideas?: Array<{ idea_name?: string; concept_name?: string; preferred_regime?: string; entry_indicator?: string; confluence_factors?: string[] }> }>;
      drain?: { scanned: number; drained: number; failed: number } | null;
      graduated_strategies?: Array<{
        id: string;
        name: string;
        symbols: string[];
        lifecycleState: string;
        useWeightedScoring: boolean | null;
        exitPlanConfig: { exit_style?: string } | null;
        preferredRegimes: string[] | null;
        dailyTf: string | null; htfTf: string | null; itfTf: string | null; triggerTf: string | null;
        entryQuality: { confluence_factors?: string[]; min_factors_satisfied?: number } | null;
      }>;
    };
    const r = result.results?.[0];

    if (!r) {
      res.status(502).json({ error: "ingest_empty", baby_jargon_summary: "The ingest pipeline returned nothing — something glitched. Try again or pick a different video." });
      return;
    }

    let baby_jargon_summary = "";
    switch (r.status) {
      case "ingested":
        baby_jargon_summary = `Got it. Video "${r.title?.slice(0, 80) ?? r.video_id}" — extracted ${r.idea_count ?? 0} strategy idea${r.idea_count === 1 ? "" : "s"}: ${(r.ideas ?? []).map((i) => i.idea_name).filter(Boolean).join(", ")}. Pushing it into the kitchen now. In about 30 minutes you'll see 3 versions in the library — one for MES, one for MNQ, one for MCL. Backtest gates run automatically. I'll let you know which ones earned their keep.`;
        break;
      case "transcript_unavailable":
        baby_jargon_summary = "Couldn't pull the transcript from that video — it may be private, age-restricted, or missing captions. Try a different one.";
        break;
      case "transcript_too_short":
        baby_jargon_summary = "That video's transcript is too short to extract a real strategy from. Probably a Short or a clip — find a longer tutorial.";
        break;
      case "rejected_swing_or_screenshot":
        baby_jargon_summary = "Skipped that one — it's a swing-trader or trade-recap video. Slumdawg only takes day-trader content (we close every position by 3:55pm — no overnight risk).";
        break;
      case "not_extracted":
        baby_jargon_summary = "Gemma couldn't find a real strategy in that video — it talked about trading but didn't give concrete entry/exit rules. Find one with specific setups.";
        break;
      default:
        baby_jargon_summary = `Ingest status: ${r.status ?? "unknown"}. That's a state I don't have a plain-English line for yet.`;
    }

    res.json({
      ingest_result: r,
      baby_jargon_summary,
      drain: result.drain ?? null,
      graduated_strategies: result.graduated_strategies ?? [],
    });
  } catch (err) {
    logger.error({ err }, "slumdawg ingest-youtube failed");
    res.status(500).json({ error: "internal_error", baby_jargon_summary: "The ingest pipeline broke mid-extraction. Tower API might be down — check with the operator." });
  }
});
