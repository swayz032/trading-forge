/**
 * Kitchen data assembler — pipeline counts + Today's Menu dishes.
 *
 * Two exports:
 *   assembleKitchenData()  → 6 stages + totals
 *   assembleTodaysMenu()   → DEPLOYED strategies with monthly $ + critique note
 *
 * All queries fail-soft to zero/empty per Slumhouse read-only contract.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { symbolToStreet, formatBag } from "./translate.js";

export interface KitchenStage {
  name: string;
  subtitle: string;
  count: number;
  countLabel: string;
}

export interface KitchenData {
  stages: KitchenStage[];
  totalCooking: number;
  totalOnMenu: number;
  totalTossed: number;
}

const STAGE_MAP: Array<{
  name: string;
  subtitle: string;
  countLabel: string;
  states: string[];
}> = [
  { name: "Ingredients",  subtitle: "just dropped",          countLabel: "cooking down",   states: ["__INGEST__"] },
  { name: "Prep Station", subtitle: "recipes ready to cook", countLabel: "on the counter", states: ["CANDIDATE"] },
  { name: "On the Stove", subtitle: "getting tested",        countLabel: "heat up",        states: ["TESTING", "SHADOW"] },
  { name: "Taste Test",   subtitle: "fake money trial",      countLabel: "on the spoon",   states: ["PAPER"] },
  { name: "Small Plates", subtitle: "small real money",      countLabel: "soft launch",    states: ["DEPLOY_READY", "PILOT"] },
  { name: "On the Menu",  subtitle: "full real money",       countLabel: "serving daily",  states: ["DEPLOYED", "DECLINING"] },
];

export async function assembleKitchenData(): Promise<KitchenData> {
  const groupRows = (await db.execute(sql`
    SELECT lifecycle_state, COUNT(*)::int AS count
    FROM strategies GROUP BY lifecycle_state
  `).catch(() => [] as unknown[])) as Array<{ lifecycle_state: string; count: number }>;

  const byState: Record<string, number> = {};
  for (const r of groupRows) byState[String(r.lifecycle_state)] = Number(r.count);

  const ingestRow = await firstRow(db.execute(sql`
    SELECT COUNT(*)::int AS ingest_count FROM scout_audit
    WHERE status IN ('queued','extracting') AND created_at >= NOW() - INTERVAL '7 days'
  `).catch(() => [] as unknown[]));

  const stages: KitchenStage[] = STAGE_MAP.map((s) => {
    let count = 0;
    if (s.states[0] === "__INGEST__") {
      count = Number((ingestRow as any)?.ingest_count ?? 0);
    } else {
      for (const st of s.states) count += byState[st] ?? 0;
    }
    return { name: s.name, subtitle: s.subtitle, count, countLabel: s.countLabel };
  });

  const totalCooking = stages.slice(1, 5).reduce((acc, s) => acc + s.count, 0);
  const totalOnMenu = stages[5].count;
  const totalTossed = (byState["GRAVEYARD"] ?? 0) + (byState["RETIRED"] ?? 0);

  return { stages, totalCooking, totalOnMenu, totalTossed };
}

export interface MenuDish {
  id: string;
  dishName: string;
  monthMade: string;
  plays: number;
  avgPerPlay: number;
  slumdawgNote: string | null;
  recentDailyPnL: number[];
}

export async function assembleTodaysMenu(): Promise<MenuDish[]> {
  const rows = (await db.execute(sql`
    SELECT s.id::text AS id, s.name, s.symbol,
      COALESCE(
        (SELECT SUM(pt.pnl::float)
         FROM paper_trades pt
         JOIN paper_sessions ps ON ps.id = pt.session_id
         WHERE ps.strategy_id = s.id
           AND pt.exit_time >= date_trunc('month', NOW())),
        0
      )::float AS month_pnl,
      COALESCE(
        (SELECT COUNT(pt.*)
         FROM paper_trades pt
         JOIN paper_sessions ps ON ps.id = pt.session_id
         WHERE ps.strategy_id = s.id
           AND pt.exit_time >= date_trunc('month', NOW())),
        0
      )::int AS trades,
      (SELECT plain_english_summary->>'what_happened'
       FROM trade_critique tc
       WHERE tc.strategy_id = s.id
       ORDER BY tc.critiqued_at DESC
       LIMIT 1) AS latest_critique
    FROM strategies s
    WHERE s.lifecycle_state IN ('DEPLOYED', 'DECLINING')
    ORDER BY month_pnl DESC
    LIMIT 12
  `).catch(() => [] as unknown[])) as Array<{
    id: string; name: string; symbol: string;
    month_pnl: number; trades: number;
    latest_critique: string | null;
  }>;

  return rows.map((r) => {
    const trades = Number(r.trades ?? 0);
    const pnl = Number(r.month_pnl ?? 0);
    return {
      id: String(r.id),
      dishName: `${r.name} · ${symbolToStreet(r.symbol)}`,
      monthMade: formatBag(pnl),
      plays: trades,
      avgPerPlay: trades > 0 ? pnl / trades : 0,
      slumdawgNote: r.latest_critique ?? null,
      recentDailyPnL: [], // operator can extend with last-10-day sparkline query if needed
    };
  });
}

async function firstRow(p: Promise<unknown>): Promise<unknown> {
  const r = (await p) as any;
  if (Array.isArray(r)) return r[0] ?? {};
  if (r?.rows && Array.isArray(r.rows)) return r.rows[0] ?? {};
  return {};
}
