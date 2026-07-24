/**
 * Crib data assembler — aggregates "today's bag" data for one friend.
 *
 * The data path through TF schema:
 *   slumhouse_users.broker_account_id
 *     → account_strategy_assignments.account_id (status='active')
 *     → paper_sessions.strategy_id (all sessions for assigned strategies)
 *     → paper_trades.session_id (all trades for those sessions)
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { getExecutionMode } from "../execution-mode.js";
import { unmappedAccountDisclosure, liveModeDataDisclosure } from "./translate.js";
import { resolvePremiumName } from "./premium-names.js";

export type CribData = {
  banner: {
    todayBag: string;
    todayBagRaw: number;
    todayBagSpark: number[];
    tradesToday: { count: number; wins: number; losses: number };
    tradesSpark: number[];
    openNow: number;
    inPot: number;
    inPotSpark: number[];
    killSwitch: "green" | "red";
  };
  discordFeed: Array<{
    name: string;
    source: string;
    status: string;
    ageMin: number;
  }>;
  pot: Array<{
    id: string;
    name: string;
    stage: string;
    netPnl: string;
    tradesCount: number;
  }>;
  crew: Array<{
    jersey: number;
    displayName: string;
    weekBag: string;
  }>;
  /** Effective execution mode driving these stats. */
  executionMode: "paper" | "live";
  /**
   * Human-readable label for the mode badge.
   * "PAPER · practice" (paper mode) or "LIVE" (live mode).
   */
  executionModeLabel: string;
  /**
   * False when account-scoped data (todayBag, openNow, sparklines) is unavailable.
   * Two causes: user has no broker_account_id (accountUnmapped=true) OR
   * execution_mode=live and the live tape is not wired yet.
   * Consumer must check accountDisclosure for the reason.
   */
  accountDataAvailable: boolean;
  /**
   * True when the user has no broker_account_id mapping.
   * In this state todayBag/openNow are zeroed — NOT real trading data.
   */
  accountUnmapped: boolean;
  /**
   * Plain-English disclosure when account data is unavailable.
   * Null when all data is available normally (mapped user, paper mode).
   * Consumers MUST surface this copy instead of displaying a bare $0.
   */
  accountDisclosure: string | null;
};

const FRESH_DISCORD_FEED_STATUSES = new Set([
  "queued",
  "extracting",
  "scouted",
  "accepted",
  "success",
  "graduated",
  "pending",
]);

const SLUMDAWG_FEED_CHANNEL_ID =
  process.env.DISCORD_CH_SLUMDAWG_FEED || "1482571931222937642";
const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

type SlumdawgFeedRow = {
  name: string;
  source: string;
  status: string;
  ageMin: number;
  sortAt: string;
};

type DiscordMessage = {
  id?: string;
  author?: { bot?: boolean | null } | null;
  content?: string | null;
  embeds?: Array<any> | null;
  referenced_message?: DiscordMessage | null;
  timestamp?: string | null;
  edited_timestamp?: string | null;
};

function extractVideoTitleFromEmbed(embed: any): string {
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  const videoField = fields.find((field: any) => String(field?.name ?? "").toLowerCase().includes("video"));
  if (videoField?.value) {
    const match = String(videoField.value).match(/\*\*(.+?)\*\*/);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function determineFeedSource(message: DiscordMessage): string {
  const referenced = message.referenced_message?.embeds?.[0];
  const provider = String(referenced?.provider?.name ?? "").toLowerCase();
  if (provider.includes("youtube")) return "youtube";

  const embed = message.embeds?.[0];
  const sourceText = [
    message.referenced_message?.content ?? "",
    String(embed?.title ?? ""),
    String(embed?.description ?? ""),
    ...(Array.isArray(embed?.fields)
      ? embed.fields.map((field: any) => `${field?.name ?? ""} ${field?.value ?? ""}`)
      : []),
  ].join(" ").toLowerCase();

  if (sourceText.includes("youtube.com") || sourceText.includes("youtu.be")) return "youtube";
  if (sourceText.includes("discord")) return "discord";
  return "discord";
}

function parseSlumdawgFeedRow(message: DiscordMessage): SlumdawgFeedRow | null {
  if (!message.author?.bot) return null;
  const embed = message.embeds?.[0];
  if (!embed) return null;
  if (!/slumdawg cooked it/i.test(String(embed.title ?? ""))) return null;

  const referenced = message.referenced_message?.embeds?.[0];
  const name =
    String(referenced?.title ?? "").trim() ||
    extractVideoTitleFromEmbed(embed) ||
    String(embed.title ?? "").replace(/^.*?—\s*/, "").trim() ||
    "unknown";
  const ts =
    message.timestamp ||
    message.edited_timestamp ||
    String(embed.timestamp ?? "") ||
    new Date().toISOString();
  const ageMin = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60_000));

  return {
    name,
    source: determineFeedSource(message),
    status: "graduated",
    ageMin,
    sortAt: ts,
  };
}

async function fetchDiscordChannelFeedRows(limit = 20): Promise<SlumdawgFeedRow[]> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    console.warn("[crib-data] DISCORD_BOT_TOKEN missing — live feed skipped");
    return [];
  }

  const url = `${DISCORD_API_BASE_URL}/channels/${SLUMDAWG_FEED_CHANNEL_ID}/messages?limit=${encodeURIComponent(String(limit))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(4000),
  }).catch((err) => {
    console.error("[crib-data] Discord fetch failed", err);
    return null;
  });
  if (!res) return [];
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn("[crib-data] Discord API error", res.status, txt);
    return [];
  }

  const messages = (await res.json().catch(() => [])) as DiscordMessage[];
  if (!Array.isArray(messages)) return [];

  return messages
    .map(parseSlumdawgFeedRow)
    .filter((row): row is SlumdawgFeedRow => Boolean(row))
    .sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime())
    .slice(0, 4);
}

async function fetchSlumdawgFeedRows(limit = 20): Promise<SlumdawgFeedRow[]> {
  const directRows = await fetchDiscordChannelFeedRows(limit).catch(() => []);
  if (directRows.length > 0) return directRows;

  const proxyUrl =
    process.env.SLUMDAWG_FEED_PROXY_URL ||
    `http://127.0.0.1:${process.env.DISCORD_ALERT_PORT || 4100}/slumdawg/feed`;
  const url = `${proxyUrl}?limit=${encodeURIComponent(String(limit))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  if (!res || !res.ok) return [];
  const payload = (await res.json().catch(() => null)) as { rows?: SlumdawgFeedRow[] } | SlumdawgFeedRow[] | null;
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.rows) ? payload.rows : [];
  return rows.slice(0, 4);
}

export async function assembleCribData(args: { brokerAccountId: string | null }): Promise<CribData> {
  const { brokerAccountId } = args;
  const brokerAccountSql = brokerAccountId ? sql`${brokerAccountId}::uuid` : sql`NULL::uuid`;

  // ─── Execution mode — fail-closed to "paper" on any error ────────────────
  // LIVE mode: account-scoped stats (todayBag / openNow / sparklines) are
  // zeroed — no live tape exists yet.  Global stats (inPot, discordFeed,
  // pot, crew) are returned normally in both modes.
  // NEVER fall back to paper numbers while claiming live — return zeroed instead.
  const mode = await getExecutionMode().catch(() => "paper" as const);
  const canReadAccountScopedData = Boolean(brokerAccountId) && mode !== "live";

  // ─── Account-data availability disclosure (FIX 2 + FIX 3) ───────────────
  // When data is unavailable, the consumer MUST surface accountDisclosure
  // instead of displaying a bare $0 (which reads as "I lost nothing").
  const accountUnmapped = !brokerAccountId;
  const liveModeSuppressed = Boolean(brokerAccountId) && mode === "live";
  const accountDataAvailable = !accountUnmapped && !liveModeSuppressed;
  const accountDisclosure: string | null = accountUnmapped
    ? unmappedAccountDisclosure()
    : liveModeSuppressed
      ? liveModeDataDisclosure()
      : null;

  // 1. Today's closed P&L + W/L counts for THIS account's assigned strategies
  const todayRow = canReadAccountScopedData
    ? await firstRow(db.execute(sql`
        SELECT
          COALESCE(SUM(pt.pnl::float), 0)::float AS today_pnl,
          COUNT(pt.*)::int                       AS trades_today,
          SUM(CASE WHEN pt.pnl::float > 0 THEN 1 ELSE 0 END)::int AS wins,
          SUM(CASE WHEN pt.pnl::float <= 0 THEN 1 ELSE 0 END)::int AS losses
        FROM paper_trades pt
        JOIN paper_sessions ps ON ps.id = pt.session_id
        JOIN account_strategy_assignments asa
          ON asa.strategy_id = ps.strategy_id AND asa.status = 'active'
        WHERE asa.account_id = ${brokerAccountSql}
          AND pt.exit_time::date = CURRENT_DATE
      `).catch(() => [] as any[]))
    : null;

  // 2. Open positions count for THIS account
  const openRow = canReadAccountScopedData
    ? await firstRow(db.execute(sql`
        SELECT COUNT(pp.*)::int AS open_now
        FROM paper_positions pp
        JOIN paper_sessions ps ON ps.id = pp.session_id
        JOIN account_strategy_assignments asa
          ON asa.strategy_id = ps.strategy_id AND asa.status = 'active'
        WHERE asa.account_id = ${brokerAccountSql}
          AND pp.closed_at IS NULL
      `).catch(() => [] as any[]))
    : null;

  // 3. Global "In the Pot" — strategies in test stages (not account-scoped)
  const potRow = await firstRow(db.execute(sql`
    SELECT COUNT(*)::int AS in_pot
    FROM strategies
    WHERE lifecycle_state IN ('CANDIDATE','TESTING','SHADOW','PAPER')
  `).catch(() => [] as any[]));

  // 4. Kill switch — read from system_parameters (TF's operator-tappable halt)
  const killRow = await firstRow(db.execute(sql`
    SELECT value FROM system_parameters
    WHERE key = 'pipeline_active' LIMIT 1
  `).catch(() => [] as any[]));
  const killSwitch: "green" | "red" =
    killRow?.value === "false" || killRow?.value === false ? "red" : "green";

  // 4b. Sparklines — last 7 trading days
  const sparkPnlRows = canReadAccountScopedData
    ? ((await db.execute(sql`
        SELECT (pt.exit_time::date) AS d,
          COALESCE(SUM(pt.pnl::float), 0)::float AS pnl,
          COUNT(pt.*)::int AS cnt
        FROM paper_trades pt
        JOIN paper_sessions ps ON ps.id = pt.session_id
        JOIN account_strategy_assignments asa
          ON asa.strategy_id = ps.strategy_id AND asa.status = 'active'
        WHERE asa.account_id = ${brokerAccountSql}
          AND pt.exit_time >= NOW() - INTERVAL '7 days'
        GROUP BY pt.exit_time::date
        ORDER BY pt.exit_time::date ASC
      `).catch(() => [] as any[])) as any[])
    : [];
  const todayBagSpark = sparkPnlRows.map((r) => Number(r.pnl ?? 0));
  const tradesSpark = sparkPnlRows.map((r) => Number(r.cnt ?? 0));

  // In-pot history sparkline is harder (would need a daily snapshot table) —
  // approximate by emitting flat current value, frontend interprets as no trend.
  const inPotValue = Number((potRow as any)?.in_pot ?? 0);
  const inPotSpark = [inPotValue, inPotValue, inPotValue, inPotValue, inPotValue, inPotValue, inPotValue];

  // 5. Discord feed — read the live Slumdawg feed channel directly when the
  // bot token is available. Keep the proxy/DB fallbacks only for local tests
  // or env misconfiguration.
  const liveDiscordRows = await fetchSlumdawgFeedRows().catch(() => []);
  const dbRowsRaw = (liveDiscordRows.length > 0 ? liveDiscordRows : (await db.execute(sql`
    SELECT concept_name AS name, 'discord' AS source, status, first_seen_at AS sort_at,
      EXTRACT(EPOCH FROM (NOW() - first_seen_at))::int / 60 AS age_min
    FROM strategy_pending_buckets
    ORDER BY first_seen_at DESC LIMIT 50
  `).catch(() => [] as any[])) as any);

  const dbRows = Array.isArray(dbRowsRaw) ? dbRowsRaw : Array.isArray(dbRowsRaw?.rows) ? dbRowsRaw.rows : [];
  
  const freshDiscordRows = dbRows
    .filter((r: Record<string, unknown>) => FRESH_DISCORD_FEED_STATUSES.has(String(r["status"] ?? "").toLowerCase()))
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const aTime = new Date((a["sortAt"] ?? a["sort_at"] ?? a["first_seen_at"] ?? 0) as string | number).getTime();
      const bTime = new Date((b["sortAt"] ?? b["sort_at"] ?? b["first_seen_at"] ?? 0) as string | number).getTime();
      return bTime - aTime;
    })
    .slice(0, 4);

  // 6. Pot horizontal feed — strategies currently in testing stages with recent P&L
  const potRows = (await db.execute(sql`
    SELECT s.id::text AS id, s.name, s.symbols, s.timeframe, s.config, s.lifecycle_state AS stage,
      COALESCE(
        (SELECT SUM(pt.pnl::float)
         FROM paper_trades pt
         JOIN paper_sessions ps ON ps.id = pt.session_id
         WHERE ps.strategy_id = s.id
           AND pt.exit_time >= NOW() - INTERVAL '30 days'),
        0
      )::float AS net_pnl,
      COALESCE(
        (SELECT COUNT(pt.*)
         FROM paper_trades pt
         JOIN paper_sessions ps ON ps.id = pt.session_id
         WHERE ps.strategy_id = s.id),
        0
      )::int AS trades_count
    FROM strategies s
    WHERE s.lifecycle_state IN ('CANDIDATE','TESTING','SHADOW','PAPER')
    ORDER BY net_pnl DESC NULLS LAST
    LIMIT 8
  `).catch(() => [] as any[])) as any[];

  // 7. Crew leaderboard — every mapped friend, ordered by week P&L.
  const crewRows = (await db.execute(sql`
    SELECT u.jersey_number AS jersey, u.display_name,
      COALESCE(
        (SELECT SUM(pt.pnl::float)
         FROM paper_trades pt
         JOIN paper_sessions ps ON ps.id = pt.session_id
         JOIN account_strategy_assignments asa
           ON asa.strategy_id = ps.strategy_id AND asa.status = 'active'
         WHERE asa.account_id = u.broker_account_id
           AND pt.exit_time >= date_trunc('week', NOW())),
        0
      )::float AS week_pnl
    FROM slumhouse_users u
    ORDER BY week_pnl DESC, u.jersey_number ASC
    LIMIT 8
  `).catch(() => [] as any[])) as any[];

  const todayPnl = Number(todayRow?.today_pnl ?? 0);
  const potNameCounts = new Map<string, number>();
  return {
    banner: {
      todayBag: formatBag(todayPnl),
      todayBagRaw: todayPnl,
      todayBagSpark,
      tradesToday: {
        count: Number(todayRow?.trades_today ?? 0),
        wins: Number(todayRow?.wins ?? 0),
        losses: Number(todayRow?.losses ?? 0),
      },
      tradesSpark,
      openNow: Number(openRow?.open_now ?? 0),
      inPot: inPotValue,
      inPotSpark,
      killSwitch,
    },
    discordFeed: freshDiscordRows.map((r: Record<string, unknown>) => ({
      name: String(r["name"] ?? "unknown"),
      source: String(r["source"] ?? "?"),
      status: String(r["status"] ?? "?"),
      ageMin: Number(r["ageMin"] ?? r["age_min"] ?? 0),
    })),
    pot: potRows.map((r) => {
      const named = resolvePremiumName({
        name: String(r.name ?? "unnamed"),
        symbols: Array.isArray(r.symbols) ? r.symbols.map(String) : [],
        timeframe: String(r.timeframe ?? ""),
        config: r.config && typeof r.config === "object" ? r.config : null,
      });
      const occurrence = (potNameCounts.get(named.displayName) ?? 0) + 1;
      potNameCounts.set(named.displayName, occurrence);
      return {
        id: String(r.id),
        name: named.displayName,
        stage: String(r.stage ?? ""),
        netPnl: formatBag(Number(r.net_pnl ?? 0)),
        tradesCount: Number(r.trades_count ?? 0),
        duplicate: occurrence > 1,
      };
    }).filter((card) => !card.duplicate).map(({ duplicate: _duplicate, ...card }) => card),
    crew: crewRows.map((r) => ({
      jersey: Number(r.jersey ?? 0),
      displayName: String(r.display_name ?? "?"),
      weekBag: formatBag(Number(r.week_pnl ?? 0)),
    })),
    executionMode: mode,
    executionModeLabel: mode === "live" ? "LIVE" : "PAPER · practice",
    accountDataAvailable,
    accountUnmapped,
    accountDisclosure,
  };
}

async function firstRow(p: Promise<unknown>): Promise<any> {
  const rows = (await p) as any;
  if (Array.isArray(rows)) return rows[0] ?? {};
  // pg drizzle returns { rows: [...] } sometimes
  if (rows?.rows && Array.isArray(rows.rows)) return rows.rows[0] ?? {};
  return {};
}

function formatBag(val: number): string {
  const sign = val >= 0 ? "+" : "−"; // Using special minus sign for aesthetics
  return `${sign}$${Math.abs(Math.round(val)).toLocaleString()}`;
}
