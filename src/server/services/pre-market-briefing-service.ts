/**
 * pre-market-briefing-service.ts — W25.5d Daily 09:00 ET Pre-Market Briefing
 *
 * Composes and posts a Discord pre-market briefing at 09:00 ET (14:00 UTC),
 * AFTER the pre-market routine (which fires at 08:30 ET / 12:00–13:00 UTC)
 * has completed and populated pre_market_sessions.
 *
 * Closes the "trading without a written bias on news days" failure mode cited
 * as #1 funded-trader blowup cause in the Steenbarger/Topstep 2025 podcast.
 *
 * Design:
 *   - Idempotent: audit_log check (W23F.U pattern) prevents double-posting
 *   - Fail-soft: Discord unreachable → log + audit, never throw
 *   - Pipeline-gate EXEMPT: operator wants briefing even during PAUSE
 *   - Degraded briefing: if pre_market_sessions rows missing, posts with
 *     "(data pending)" markers instead of silently skipping
 *   - No new env vars: reuses DISCORD_WEBHOOK_URL via notification-service
 *   - §10b: audit_log carries full briefing payload for 90-day reconstruction
 */

import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreMarketSessionRow {
  sessionDate: string;
  symbol: string;
  writtenBias: string | null;
  pdh: string | null;
  pdl: string | null;
  pwh: string | null;
  pwl: string | null;
  pwhIso: string | null;     // W25.5a ISO-week prior-week high
  pwlIso: string | null;     // W25.5a ISO-week prior-week low
  overnightRangePoints: string | null;
  openingGapPct: string | null;
  vixBucket: string | null;
  vixProxyAtrPercentile: string | null;
  economicCalendarClear: boolean | null;
  blackoutWindows: Array<{ event_type: string; start_utc: string; end_utc: string; severity: string }> | null;
  // W25.5a extended fields — nullable (may not be populated yet)
  bondAuctionToday: boolean | null;
  extendedCalendarEvents: Array<{ name: string; time_utc?: string }> | null;
  nearbyNakedPocs: Array<{ price: number; session_date: string; symbol: string }> | null;
  dxyDirection: string | null;
  us10yDirection: string | null;
  crossAssetAligned: boolean | null;
  tickOpen: string | null;
  addOpen: string | null;
}

export interface BriefingDataAccessLayer {
  /** Query pre_market_sessions for all 3 symbols for today */
  getPreMarketRows(sessionDate: string): Promise<PreMarketSessionRow[]>;
  /** Check audit_log for prior briefing sent today */
  checkBriefingAlreadySent(sessionDate: string): Promise<boolean>;
  /** Write audit row */
  insertAuditRow(values: {
    action: string;
    entityId: string | null;
    entityType: string;
    result: Record<string, unknown>;
    status: string;
    decisionAuthority: string;
    correlationId: string;
    input?: Record<string, unknown>;
    errorMessage?: string;
  }): Promise<void>;
  /** Post to Discord (injectable for tests) */
  postToDiscord(title: string, body: string, metadata?: Record<string, unknown>): void;
}

export interface SendPreMarketBriefingResult {
  sent: boolean;
  reason?: string;
  sessionDate?: string;
  symbolsFound?: number;
  correlationId?: string;
}

// ─── VIX bucket → sizing recommendation ──────────────────────────────────────

const VIX_SIZING: Record<string, string> = {
  normal: "FULL SIZE — conditions normal",
  elevated: "REDUCED SIZE (75%) — elevated volatility",
  extreme: "MINIMAL SIZE (50%) — extreme volatility caution",
};

function vixSizingLabel(bucket: string | null): string {
  if (!bucket) return "UNKNOWN — VIX data unavailable";
  return VIX_SIZING[bucket.toLowerCase()] ?? `${bucket.toUpperCase()} — check manually`;
}

// ─── Markdown builder ─────────────────────────────────────────────────────────

function fmt(val: string | null | undefined, fallback = "(data pending)"): string {
  if (val == null || val === "" || val === "null") return fallback;
  return val;
}

function fmtBool(val: boolean | null | undefined, trueStr: string, falseStr: string, fallback = "(pending)"): string {
  if (val == null) return fallback;
  return val ? trueStr : falseStr;
}

function fmtNum(val: string | null | undefined, decimals = 2, fallback = "(pending)"): string {
  if (val == null) return fallback;
  const n = parseFloat(val);
  if (isNaN(n)) return fallback;
  return n.toFixed(decimals);
}

/** Build the per-symbol section of the briefing markdown. */
function buildSymbolSection(row: PreMarketSessionRow | null, symbol: string): string {
  const pending = "(data pending)";
  const NA = "N/A";

  if (!row) {
    return [
      `## ${symbol}`,
      `> Pre-market routine data not yet available. Will populate after 08:30 ET.`,
      "",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`## ${symbol}`);

  // Written bias — the key operator intent
  lines.push(`**Bias:** ${fmt(row.writtenBias, pending)}`);

  // Key levels
  lines.push("");
  lines.push("**Key Levels:**");
  lines.push(`- PDH / PDL: ${fmtNum(row.pdh)} / ${fmtNum(row.pdl)}`);
  lines.push(`- PWH (ISO) / PWL (ISO): ${fmtNum(row.pwhIso, 2, fmt(row.pwh, NA))} / ${fmtNum(row.pwlIso, 2, fmt(row.pwl, NA))}`);

  // Overnight stats
  lines.push("");
  lines.push("**Overnight:**");
  lines.push(`- Range: ${fmtNum(row.overnightRangePoints, 2)} pts`);
  lines.push(`- Opening gap: ${fmtNum(row.openingGapPct, 3, pending)}%`);

  // VIX / sizing
  lines.push("");
  lines.push("**Volatility:**");
  lines.push(`- VIX bucket: ${fmt(row.vixBucket)}`);
  lines.push(`- Sizing recommendation: ${vixSizingLabel(row.vixBucket)}`);
  if (row.vixProxyAtrPercentile != null) {
    lines.push(`- ATR pctile vs 60d baseline: ${fmtNum(row.vixProxyAtrPercentile, 1)}%`);
  }

  // Calendar
  lines.push("");
  lines.push("**Calendar:**");
  lines.push(`- Bond auction today: ${fmtBool(row.bondAuctionToday, "YES — 1pm ET Treasury auction", "No", "(unknown)")}`);

  const extEvents = row.extendedCalendarEvents;
  if (extEvents && extEvents.length > 0) {
    const eventStr = extEvents.map((e) => e.name).join(", ");
    lines.push(`- Extended calendar events: ${eventStr}`);
  } else if (row.economicCalendarClear === true) {
    lines.push(`- Extended calendar events: Clear (no high-impact events)`);
  } else if (row.economicCalendarClear === false) {
    // Legacy blackout windows
    const bw = row.blackoutWindows;
    if (bw && bw.length > 0) {
      const eventStr = bw.map((b) => b.event_type).join(", ");
      lines.push(`- Extended calendar events: ${eventStr} (BLACKOUT ACTIVE)`);
    } else {
      lines.push(`- Extended calendar events: ${pending}`);
    }
  } else {
    lines.push(`- Extended calendar events: ${pending}`);
  }

  // Nearby naked POCs
  const pocs = row.nearbyNakedPocs;
  if (pocs && pocs.length > 0) {
    const pocStr = pocs
      .slice(0, 5) // cap at 5 to keep message readable
      .map((p) => p.price.toFixed(2))
      .join(", ");
    lines.push(`- Nearby naked POCs (±1 ADR): ${pocStr}`);
  } else {
    lines.push(`- Nearby naked POCs: ${pending}`);
  }

  // Cross-asset
  lines.push("");
  lines.push("**Cross-Asset:**");
  lines.push(`- DXY: ${fmt(row.dxyDirection, "(pending)")} | 10Y: ${fmt(row.us10yDirection, "(pending)")}`);
  lines.push(`- Cross-asset aligned with bias: ${fmtBool(row.crossAssetAligned, "YES", "NO", "(pending)")}`);

  // Market internals (MES/MNQ only — not applicable to MCL)
  if (symbol !== "MCL") {
    lines.push("");
    lines.push("**Internals (09:30 ET open):**");
    lines.push(`- $TICK: ${fmt(row.tickOpen, "(pending)")} | $ADD: ${fmt(row.addOpen, "(pending)")}`);
  }

  lines.push("");
  return lines.join("\n");
}

/** Compose the full briefing markdown. */
export function composeBriefingMarkdown(
  sessionDate: string,
  rows: PreMarketSessionRow[],
  symbols: string[],
): string {
  const rowMap = new Map<string, PreMarketSessionRow>();
  for (const row of rows) {
    rowMap.set(row.symbol, row);
  }

  const headerLines = [
    `## Pre-Market Briefing — ${sessionDate}`,
    `Generated at ${new Date().toUTCString()}`,
    `Source: Trading Forge pre_market_sessions table`,
    "",
    "---",
    "",
  ];

  const symbolSections = symbols.map((sym) =>
    buildSymbolSection(rowMap.get(sym) ?? null, sym),
  );

  const footerLines = [
    "---",
    "_Use this briefing to confirm your trade bias before market open._",
    "_Execution mandate: 1 A+ trade per day per account. Bias is the filter._",
  ];

  return [...headerLines, ...symbolSections, ...footerLines].join("\n");
}

// ─── Live DAL ─────────────────────────────────────────────────────────────────

function buildLiveDal(): BriefingDataAccessLayer {
  return {
    async getPreMarketRows(sessionDate: string): Promise<PreMarketSessionRow[]> {
      // Dynamic import to avoid pulling entire DB graph into test isolation boundary
      const { db } = await import("../db/index.js");
      const { preMarketSessions } = await import("../db/schema.js");
      const { eq } = await import("drizzle-orm");

      const rows = await db
        .select()
        .from(preMarketSessions)
        .where(eq(preMarketSessions.sessionDate, sessionDate));

      return rows.map((r) => ({
        sessionDate: typeof r.sessionDate === "string" ? r.sessionDate : (r.sessionDate as unknown as Date).toISOString().slice(0, 10),
        symbol: r.symbol,
        writtenBias: r.writtenBias ?? null,
        pdh: r.pdh ?? null,
        pdl: r.pdl ?? null,
        pwh: r.pwh ?? null,
        pwl: r.pwl ?? null,
        // W25.5a extended fields — nullable; gracefully absent until migration 0134 runs
        pwhIso: (r as Record<string, unknown>).pwhIso as string | null ?? null,
        pwlIso: (r as Record<string, unknown>).pwlIso as string | null ?? null,
        overnightRangePoints: r.overnightRangePoints ?? null,
        openingGapPct: r.openingGapPct ?? null,
        vixBucket: r.vixBucket ?? null,
        vixProxyAtrPercentile: r.vixProxyAtrPercentile ?? null,
        economicCalendarClear: r.economicCalendarClear ?? null,
        blackoutWindows: (r.blackoutWindows as PreMarketSessionRow["blackoutWindows"]) ?? null,
        bondAuctionToday: (r as Record<string, unknown>).bondAuctionToday as boolean | null ?? null,
        extendedCalendarEvents: (r as Record<string, unknown>).extendedCalendarEvents as PreMarketSessionRow["extendedCalendarEvents"] ?? null,
        nearbyNakedPocs: (r as Record<string, unknown>).nearbyNakedPocs as PreMarketSessionRow["nearbyNakedPocs"] ?? null,
        dxyDirection: (r as Record<string, unknown>).dxyDirection as string | null ?? null,
        us10yDirection: (r as Record<string, unknown>).us10yDirection as string | null ?? null,
        crossAssetAligned: (r as Record<string, unknown>).crossAssetAligned as boolean | null ?? null,
        tickOpen: (r as Record<string, unknown>).tickOpen as string | null ?? null,
        addOpen: (r as Record<string, unknown>).addOpen as string | null ?? null,
      }));
    },

    async checkBriefingAlreadySent(sessionDate: string): Promise<boolean> {
      const { db } = await import("../db/index.js");
      const { auditLog } = await import("../db/schema.js");
      const { and, gte, sql: _sql } = await import("drizzle-orm");

      const startOfDay = new Date(`${sessionDate}T00:00:00Z`);
      const rows = await db
        .select({ n: _sql<number>`COUNT(*)::int` })
        .from(auditLog)
        .where(
          and(
            _sql`action = 'pre_market.briefing_sent'`,
            gte(auditLog.createdAt, startOfDay),
            _sql`result->>'session_date' = ${sessionDate}`,
          ),
        );
      return (rows[0]?.n ?? 0) > 0;
    },

    async insertAuditRow(values): Promise<void> {
      const { db } = await import("../db/index.js");
      const { auditLog } = await import("../db/schema.js");
      await db.insert(auditLog).values(values as typeof auditLog.$inferInsert);
    },

    postToDiscord(title: string, body: string, metadata?: Record<string, unknown>): void {
      // Dynamic import at call-time to avoid circular dep:
      // notification-service → this file would create a cycle if imported top-level.
      // INFO severity sends immediately (not batched like WARNING).
      import("./notification-service.js").then(({ notifyInfo }) => {
        notifyInfo(title, body, metadata);
      }).catch((err) => {
        // Import failure is not fatal — log and continue
        logger.warn({ err }, "pre-market-briefing: failed to import notification-service for Discord post");
      });
    },
  };
}

// ─── Singleton live DAL ───────────────────────────────────────────────────────
let _liveDal: BriefingDataAccessLayer | null = null;

async function getLiveDal(): Promise<BriefingDataAccessLayer> {
  if (_liveDal) return _liveDal;
  _liveDal = buildLiveDal();
  return _liveDal;
}

/** Test-only: reset the cached live DAL. */
export function __resetLiveDalForTests(): void {
  _liveDal = null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

const BRIEFING_SYMBOLS = ["MES", "MNQ", "MCL"] as const;

/**
 * sendPreMarketBriefing — compose and post the daily operator briefing to Discord.
 *
 * Idempotent (W23F.U pattern): checks audit_log for prior briefing today before posting.
 * Fail-soft: Discord errors are logged and audited, never thrown.
 * Pipeline-gate EXEMPT: operator wants briefing even during PAUSE.
 *
 * @param opts.date   Override session date (YYYY-MM-DD). Defaults to today UTC.
 * @param opts.force  If true, skip idempotency check (for manual re-sends / dry-run).
 * @param opts.dalOverride  Injectable DAL for tests.
 */
export async function sendPreMarketBriefing(
  opts: { date?: string; force?: boolean; dalOverride?: BriefingDataAccessLayer } = {},
): Promise<SendPreMarketBriefingResult> {
  const correlationId = randomUUID();
  const sessionDate = opts.date ?? new Date().toISOString().slice(0, 10);
  const dal = opts.dalOverride ?? (await getLiveDal());

  logger.info(
    { sessionDate, correlationId, force: opts.force ?? false },
    "pre-market-briefing: starting",
  );

  // ── Idempotency check ────────────────────────────────────────────────────────
  if (!opts.force) {
    const alreadySent = await dal.checkBriefingAlreadySent(sessionDate);
    if (alreadySent) {
      logger.info(
        { sessionDate, correlationId },
        "pre-market-briefing: already sent today — skipping (idempotency)",
      );

      await dal.insertAuditRow({
        action: "pre_market.briefing_skipped_already_ran_today",
        entityId: null,
        entityType: "pre_market_briefing",
        result: { session_date: sessionDate, reason: "already_sent_today" },
        status: "success",
        decisionAuthority: "scheduler",
        correlationId,
      });

      return { sent: false, reason: "already_sent_today", sessionDate, correlationId };
    }
  }

  // ── Fetch pre_market_sessions data ───────────────────────────────────────────
  let rows: PreMarketSessionRow[] = [];
  let fetchError: string | null = null;

  try {
    rows = await dal.getPreMarketRows(sessionDate);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
    logger.warn(
      { sessionDate, correlationId, err: fetchError },
      "pre-market-briefing: failed to fetch pre_market_sessions — will send degraded briefing",
    );
  }

  const symbolsFound = rows.length;

  // ── Compose briefing ─────────────────────────────────────────────────────────
  const briefingMarkdown = composeBriefingMarkdown(sessionDate, rows, [...BRIEFING_SYMBOLS]);
  const title = `Pre-Market Briefing — ${sessionDate}`;

  // ── Post to Discord ─────────────────────────────────────────────────────────
  let postError: string | null = null;
  try {
    dal.postToDiscord(title, briefingMarkdown, {
      session_date: sessionDate,
      symbols_found: symbolsFound,
      correlation_id: correlationId,
    });
    logger.info(
      { sessionDate, correlationId, symbolsFound, titleLength: title.length, bodyLength: briefingMarkdown.length },
      "pre-market-briefing: posted to Discord",
    );
  } catch (err) {
    // Fail-soft: Discord errors must never block the audit write
    postError = err instanceof Error ? err.message : String(err);
    logger.warn(
      { sessionDate, correlationId, err: postError },
      "pre-market-briefing: Discord post threw (fail-soft) — audit will still fire",
    );
  }

  // ── Audit — §10b: full payload for 90-day reconstruction ─────────────────────
  const auditStatus = postError ? "warning" : "success";
  const auditAction = postError ? "pre_market.briefing_failed" : "pre_market.briefing_sent";

  try {
    await dal.insertAuditRow({
      action: auditAction,
      entityId: null,
      entityType: "pre_market_briefing",
      result: {
        session_date: sessionDate,
        symbols_found: symbolsFound,
        briefing_markdown: briefingMarkdown,
        title,
        fetch_error: fetchError ?? null,
        post_error: postError ?? null,
        forced: opts.force ?? false,
      },
      status: auditStatus,
      decisionAuthority: "scheduler",
      correlationId,
      ...(postError ? { errorMessage: postError } : {}),
    });
  } catch (auditErr) {
    // Audit failures must NOT propagate — they're observability, not business logic
    logger.error(
      { sessionDate, correlationId, err: auditErr },
      "pre-market-briefing: AUDIT WRITE FAILED — row lost",
    );
  }

  if (postError) {
    return {
      sent: false,
      reason: `discord_post_error: ${postError}`,
      sessionDate,
      symbolsFound,
      correlationId,
    };
  }

  return { sent: true, sessionDate, symbolsFound, correlationId };
}
