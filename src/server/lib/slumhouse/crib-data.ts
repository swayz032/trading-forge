/**
 * Crib data assembler — aggregates "today's bag" data for one friend.
 *
 * The data path through TF schema:
 *   slumhouse_users.broker_account_id
 *     → account_strategy_assignments.account_id (status='active')
 *     → strategies referenced by paper_sessions
 *     → paper_trades (closed P&L) + paper_positions (open positions)
 *
 * Every section fails-soft to empty/zero — Slumhouse is read-only and a DB
 * hiccup must not break the friend's portal experience.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { formatBag } from "./translate.js";

export interface CribData {
  banner: {
    todayBag: string;
    tradesToday: { count: number; wins: number; losses: number };
    openNow: number;
    inPot: number;
    killSwitch: "green" | "red";
  };
  discordFeed: Array<{ name: string; source: string; status: string; ageMin: number }>;
  pot: Array<{ id: string; name: string; stage: string; netPnl: string; tradesCount: number }>;
  crew: Array<{ jersey: number; displayName: string; weekBag: string }>;
}

export async function assembleCribData(args: { brokerAccountId: string }): Promise<CribData> {
  const { brokerAccountId } = args;

  // 1. Today's closed P&L + W/L counts for THIS account's assigned strategies
  const todayRow = await firstRow(db.execute(sql`
    SELECT
      COALESCE(SUM(pt.pnl::float), 0)::float AS today_pnl,
      COUNT(pt.*)::int                       AS trades_today,
      SUM(CASE WHEN pt.pnl::float > 0 THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN pt.pnl::float <= 0 THEN 1 ELSE 0 END)::int AS losses
    FROM paper_trades pt
    JOIN paper_sessions ps ON ps.id = pt.session_id
    JOIN account_strategy_assignments asa
      ON asa.strategy_id = ps.strategy_id AND asa.status = 'active'
    WHERE asa.account_id = ${brokerAccountId}::uuid
      AND pt.exit_time::date = CURRENT_DATE
  `).catch(() => [] as any[]));

  // 2. Open positions count for THIS account
  const openRow = await firstRow(db.execute(sql`
    SELECT COUNT(pp.*)::int AS open_now
    FROM paper_positions pp
    JOIN paper_sessions ps ON ps.id = pp.session_id
    JOIN account_strategy_assignments asa
      ON asa.strategy_id = ps.strategy_id AND asa.status = 'active'
    WHERE asa.account_id = ${brokerAccountId}::uuid
      AND pp.closed_at IS NULL
  `).catch(() => [] as any[]));

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

  // 5. Discord feed — recent scout ingest rows (graceful fallback if scout_audit absent)
  const discordRows = (await db.execute(sql`
    SELECT name, source, status,
      EXTRACT(EPOCH FROM (NOW() - created_at))::int / 60 AS age_min
    FROM scout_audit
    WHERE status IN ('queued','extracting','graduated')
    ORDER BY created_at DESC LIMIT 4
  `).catch(() => [] as any[])) as any[];

  // 6. Pot horizontal feed — strategies currently in testing stages with recent P&L
  const potRows = (await db.execute(sql`
    SELECT s.id::text AS id, s.name, s.lifecycle_state AS stage,
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

  // 7. Crew leaderboard — top 4 mapped friends this week by P&L
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
    WHERE u.broker_account_id IS NOT NULL
    ORDER BY week_pnl DESC
    LIMIT 4
  `).catch(() => [] as any[])) as any[];

  return {
    banner: {
      todayBag: formatBag(Number(todayRow?.today_pnl ?? 0)),
      tradesToday: {
        count: Number(todayRow?.trades_today ?? 0),
        wins: Number(todayRow?.wins ?? 0),
        losses: Number(todayRow?.losses ?? 0),
      },
      openNow: Number(openRow?.open_now ?? 0),
      inPot: Number(potRow?.in_pot ?? 0),
      killSwitch,
    },
    discordFeed: discordRows.map((r) => ({
      name: String(r.name ?? "unknown"),
      source: String(r.source ?? "?"),
      status: String(r.status ?? "?"),
      ageMin: Number(r.age_min ?? 0),
    })),
    pot: potRows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "unnamed"),
      stage: String(r.stage ?? ""),
      netPnl: formatBag(Number(r.net_pnl ?? 0)),
      tradesCount: Number(r.trades_count ?? 0),
    })),
    crew: crewRows.map((r) => ({
      jersey: Number(r.jersey ?? 0),
      displayName: String(r.display_name ?? "?"),
      weekBag: formatBag(Number(r.week_pnl ?? 0)),
    })),
  };
}

async function firstRow(p: Promise<unknown>): Promise<any> {
  const rows = (await p) as any;
  if (Array.isArray(rows)) return rows[0] ?? {};
  // pg drizzle returns { rows: [...] } sometimes
  if (rows?.rows && Array.isArray(rows.rows)) return rows.rows[0] ?? {};
  return {};
}
