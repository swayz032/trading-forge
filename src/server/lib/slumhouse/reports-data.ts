/**
 * GPT trade-critique reports assembler — the Office "Reporting Room" feed.
 *
 * Reads the `trade_critique` table (one autopsy row per closed position) and
 * joins strategy + broker-account context so the Reporting Room can render each
 * GPT critique with its plain-English summary + technical attribution.
 *
 * Every query fail-softs to empty per the Slumhouse read-only contract — mirrors
 * the style in kitchen-data.ts / recipe-data.ts (raw `db.execute(sql\`...\`)`
 * with a `.catch(() => [])`). node-postgres returns jsonb columns already parsed
 * as JS objects, so the two JSONB blocks are consumed as plain objects.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { logger } from "../logger.js";
import { buildABComparisonData } from "../../routes/ab-comparison.js";

export interface GptReport {
  id: string;
  positionId: string;
  accountId: string | null;
  accountLabel: string | null;
  strategy: string;
  symbol: string;
  grade: string;
  realizedR: number | null;
  entryQuality: number | null;
  oneLiner: string;
  whatWentRight: string;
  whatToWatch: string;
  actionNeeded: string;
  attribution: Record<string, number>;
  parameterHint: { field: string; current: string | number | null; suggested: string; confidence: number | null } | null;
  confluenceMissed: string[];
  regimeMismatch: boolean;
  model: string;
  provider: string;
  dataCompleteness: string;
  critiquedAt: string; // ISO
}

export interface ReportsPayload {
  reports: GptReport[];
  accounts: Array<{ id: string; label: string; count: number }>;
  stats: { total: number; lastNight: number; byGrade: Record<string, number> };
  /**
   * OR-042 F-2 closure. The two queries below keep their pre-existing fail-soft
   * `.catch(() => [])` — deliberately: this is a DISPLAY assembler, and on a PARTIAL outage a
   * rendered page beats a blank room. What was missing is that the failure left NO trace in the
   * return value, so an outage was byte-identical to a genuinely quiet night.
   * These fields carry that distinction. Optional + additive: existing consumers are untouched.
   */
  degraded?: boolean;
  error?: string;
}

/**
 * Prettify a firm_id into a display label:
 *   'topstep_50k' → 'Topstep 50K'
 * Underscores become spaces, each word Title-Cased, and a trailing bare "k"
 * (e.g. "50k") is uppercased to "K".
 */
function prettifyFirmId(firmId: string | null | undefined): string | null {
  if (!firmId) return null;
  const words = String(firmId).split("_").filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((w) => {
      // "50k" / "150k" → "50K" / "150K"
      if (/^\d+k$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

export async function assembleGptReports(opts: { scope: "night" | "all" }): Promise<ReportsPayload> {
  // Collects which source(s) failed, so a swallowed query is visible in the RETURN VALUE rather
  // than vanishing into an empty-but-successful payload (OR-042 F-2).
  const degradedSources: string[] = [];
  const timeFilter = opts.scope === "night"
    ? sql`AND tc.critiqued_at > NOW() - INTERVAL '24 hours'`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT
      tc.id::text            AS id,
      tc.position_id::text   AS position_id,
      tc.account_id::text    AS account_id,
      tc.critiqued_at        AS critiqued_at,
      tc.grade               AS grade,
      tc.technical_diagnosis AS technical_diagnosis,
      tc.plain_english_summary AS plain_english_summary,
      tc.data_completeness   AS data_completeness,
      tc.provider            AS provider,
      tc.model               AS model,
      s.name                 AS name,
      s.symbols              AS symbols,
      ba.firm_id             AS firm_id
    FROM trade_critique tc
    LEFT JOIN strategies s ON s.id = tc.strategy_id
    LEFT JOIN broker_accounts ba ON ba.account_id = tc.account_id
    WHERE 1 = 1
    ${timeFilter}
    ORDER BY tc.critiqued_at DESC
    LIMIT 200
  `).catch(() => { degradedSources.push("reports_query_failed"); return [] as unknown[]; })) as Array<{
    id: string;
    position_id: string;
    account_id: string | null;
    critiqued_at: string | Date;
    grade: string;
    technical_diagnosis: any;
    plain_english_summary: any;
    data_completeness: string;
    provider: string;
    model: string;
    name: string | null;
    symbols: string[] | null;
    firm_id: string | null;
  }>;

  const reports: GptReport[] = rows.map((r) => {
    const tech = (r.technical_diagnosis ?? {}) as any;
    const plain = (r.plain_english_summary ?? {}) as any;

    const paramHintRaw = tech.parameter_hint ?? null;
    const parameterHint = paramHintRaw
      ? {
          field: String(paramHintRaw.field ?? ""),
          current: paramHintRaw.current ?? null,
          suggested: String(paramHintRaw.suggested_range ?? ""),
          confidence: paramHintRaw.confidence != null ? Number(paramHintRaw.confidence) : null,
        }
      : null;

    return {
      id: String(r.id),
      positionId: String(r.position_id),
      accountId: r.account_id ?? null,
      accountLabel: r.account_id ? prettifyFirmId(r.firm_id) : null,
      strategy: String(r.name || "Strategy"),
      symbol: r.symbols?.[0] || "",
      grade: String(r.grade ?? ""),
      realizedR: tech.realized_r ?? null,
      entryQuality: tech.entry_quality_score ?? null,
      oneLiner: String(plain.one_liner ?? ""),
      whatWentRight: String(plain.what_went_right ?? ""),
      whatToWatch: String(plain.what_to_watch ?? ""),
      actionNeeded: String(plain.action_needed ?? ""),
      attribution: (tech.attribution ?? {}) as Record<string, number>,
      parameterHint,
      confluenceMissed: Array.isArray(tech.confluence_factors_missed) ? tech.confluence_factors_missed : [],
      regimeMismatch: !!tech.regime_mismatch,
      model: String(r.model ?? ""),
      provider: String(r.provider ?? ""),
      dataCompleteness: String(r.data_completeness ?? ""),
      critiquedAt: new Date(r.critiqued_at).toISOString(),
    };
  });

  // Distinct non-null accounts from the returned reports + their label + count.
  const accountMap = new Map<string, { id: string; label: string; count: number }>();
  for (const rep of reports) {
    if (!rep.accountId) continue;
    const existing = accountMap.get(rep.accountId);
    if (existing) {
      existing.count += 1;
    } else {
      accountMap.set(rep.accountId, {
        id: rep.accountId,
        label: rep.accountLabel ?? rep.accountId,
        count: 1,
      });
    }
  }
  const accounts = Array.from(accountMap.values());

  // byGrade computed from the returned reports.
  const byGrade: Record<string, number> = {};
  for (const rep of reports) {
    if (!rep.grade) continue;
    byGrade[rep.grade] = (byGrade[rep.grade] ?? 0) + 1;
  }

  // Total + last-night counts from the whole table (independent of scope filter).
  const statRows = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE critiqued_at > NOW() - INTERVAL '24 hours')::int AS last_night
    FROM trade_critique
  `).catch(() => { degradedSources.push("stats_query_failed"); return [] as unknown[]; })) as Array<{ total: number; last_night: number }>;
  const statRow = statRows[0] ?? { total: 0, last_night: 0 };

  return {
    reports,
    accounts,
    stats: {
      total: Number(statRow.total ?? 0),
      lastNight: Number(statRow.last_night ?? 0),
      byGrade,
    },
    // Absent (not `false`) on a healthy run, so a genuinely quiet night stays clean.
    ...(degradedSources.length > 0
      ? { degraded: true, error: degradedSources.join(",") }
      : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOAK scope — the hardening-rails nightly certification history (Rail 3).
//
// A DIFFERENT SHAPE from the GPT night critique: one immutable cert row per run,
// carrying report_date / build_sha / verdict + the full certificate JSONB. The rig
// that writes this table (scripts/rails/cert-rig.cjs → cert-diff.cjs) emits only
// `green` (all invariants pass) or `drift` (any invariant fails); a `skipped` run is
// recorded in a SEPARATE audit table, and `invalid` is never written. The renderer
// still falls back gracefully for any other string. This is NOT a 7-slide critique —
// forcing it into the
// GptReport shape would fabricate slides that do not exist (HANDOFF §2). Read-side
// takes the LATEST row per report_date (the table's own convention, migration 0202).
//
// Honest-empty: an empty rails table (the rig is inert until it writes its first
// nightly certificate) returns `soak: []` with NO degraded flag — a genuinely
// empty history, not a failure. A query failure sets `degraded: true`, exactly as
// the night scope does, so "the desk is broken" never masquerades as "no soak runs".
// ─────────────────────────────────────────────────────────────────────────────

export interface SoakReport {
  /** ISO date (YYYY-MM-DD) — one calendar night per row. */
  reportDate: string;
  /** The commit the rig certified, if the rig recorded it. */
  buildSha: string | null;
  /** The rig's own verdict string. In practice this table only ever holds `green` or
   *  `drift` (see the type-level note above); typed as string so the renderer degrades
   *  gracefully if the rig's vocabulary ever widens. */
  verdict: string;
  /**
   * A plain-English line pulled from the certificate JSONB IF the rig wrote one.
   * Null when absent — never fabricated. The rig's certificate shape is not frozen
   * (it is inert pre-first-run), so only string fields that actually exist surface.
   */
  summary: string | null;
  /** Optional {passed,total} check tally IF the certificate carries one, else null. */
  checks: { passed: number; total: number } | null;
}

export interface SoakPayload {
  scope: "soak";
  soak: SoakReport[];
  degraded?: boolean;
  error?: string;
}

/** Read a string field off the certificate JSONB only if it is genuinely a non-empty string. */
function certString(cert: Record<string, unknown>, key: string): string | null {
  const v = cert[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

export async function assembleSoakReports(): Promise<SoakPayload> {
  const degradedSources: string[] = [];

  const rows = (await db
    .execute(sql`
      SELECT DISTINCT ON (report_date)
        report_date AS report_date,
        build_sha   AS build_sha,
        verdict     AS verdict,
        certificate AS certificate
      FROM rails_nightly_reports
      ORDER BY report_date DESC, id DESC
      LIMIT 60
    `)
    .catch(() => {
      degradedSources.push("soak_query_failed");
      return [] as unknown[];
    })) as Array<{
    report_date: string | Date;
    build_sha: string | null;
    verdict: string;
    certificate: unknown;
  }>;

  const soak: SoakReport[] = rows.map((r) => {
    const cert = (r.certificate ?? {}) as Record<string, unknown>;
    // Defensive, no-fabrication check tally: only when the certificate actually
    // carries a numeric passed/total pair.
    const checksRaw = cert.checks as Record<string, unknown> | undefined;
    const passed = checksRaw && typeof checksRaw.passed === "number" ? checksRaw.passed : null;
    const total = checksRaw && typeof checksRaw.total === "number" ? checksRaw.total : null;

    return {
      reportDate:
        r.report_date instanceof Date
          ? r.report_date.toISOString().slice(0, 10)
          : String(r.report_date).slice(0, 10),
      buildSha: r.build_sha ?? null,
      verdict: String(r.verdict ?? ""),
      summary:
        certString(cert, "summary") ??
        certString(cert, "headline") ??
        certString(cert, "note"),
      checks: passed != null && total != null ? { passed, total } : null,
    };
  });

  return {
    scope: "soak",
    soak,
    ...(degradedSources.length > 0
      ? { degraded: true, error: degradedSources.join(",") }
      : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY-A/B scope — the RL challenger vs baseline digest.
//
// A THIRD SHAPE: Sharpe / P&L deltas, not a critique and not a cert verdict. This
// READ-ONLY CONSUMES the money-path-produced A/B data by importing the SAME builder
// `/api/ab-comparison/recent` uses (`buildABComparisonData`, already a shared export
// consumed by carter-reads.ts) — we do NOT re-query their tables and we do NOT edit
// their code (HANDOFF §3, §5).
//
// Honest-empty: pre-deploy the challenger has not routed, so both sub-accounts have
// trade_count 0 → `hasData: false`. The room renders "no A/B sessions yet — live on
// deploy", never a fabricated delta. A builder throw → `ab: null, degraded: true`.
// ─────────────────────────────────────────────────────────────────────────────

export interface WeeklyAbSide {
  sharpe: number;
  pnl: number;
  drawdown: number;
  trades: number;
}

export interface WeeklyAbPayload {
  scope: "weekly-ab";
  ab: {
    /** False until the challenger has logged at least one paper session (pre-deploy = false). */
    hasData: boolean;
    sharpeDelta: number;
    pnlDelta: number;
    drawdownDelta: number;
    challenger: WeeklyAbSide;
    baseline: WeeklyAbSide;
    killSwitch: { isArmed: boolean; currentlyDormant: boolean; lastEvaluated: string | null };
    lastUpdated: string | null;
  } | null;
  degraded?: boolean;
  error?: string;
}

export async function assembleWeeklyAbReports(): Promise<WeeklyAbPayload> {
  try {
    const p = await buildABComparisonData();
    const hasData = p.sub_account_1.trade_count + p.sub_account_2.trade_count > 0;
    return {
      scope: "weekly-ab",
      ab: {
        hasData,
        sharpeDelta: p.delta.sharpe_delta,
        pnlDelta: p.delta.pnl_delta,
        drawdownDelta: p.delta.drawdown_delta,
        challenger: {
          sharpe: p.sub_account_2.rolling_20_session_sharpe,
          pnl: p.sub_account_2.cumulative_pnl,
          drawdown: p.sub_account_2.max_drawdown,
          trades: p.sub_account_2.trade_count,
        },
        baseline: {
          sharpe: p.sub_account_1.rolling_20_session_sharpe,
          pnl: p.sub_account_1.cumulative_pnl,
          drawdown: p.sub_account_1.max_drawdown,
          trades: p.sub_account_1.trade_count,
        },
        killSwitch: {
          isArmed: p.kill_switch_status.is_armed,
          currentlyDormant: p.kill_switch_status.currently_dormant,
          lastEvaluated: p.kill_switch_status.last_evaluated
            ? new Date(p.kill_switch_status.last_evaluated).toISOString()
            : null,
        },
        lastUpdated: p.last_updated ? new Date(p.last_updated).toISOString() : null,
      },
    };
  } catch (err) {
    // Fail-soft to honest-empty, same contract as the other assemblers: a broken
    // read is carried as `degraded`, never a silent-empty that reads as "no edge yet".
    logger.warn({ err }, "slumhouse weekly-ab assemble failed — returning degraded payload");
    return { scope: "weekly-ab", ab: null, degraded: true, error: "ab_comparison_failed" };
  }
}

export interface PaperFloorPosition {
  id: string;
  symbol: string;
  side: string;
  contracts: number;
  entryPrice: number;
  currentPrice: number | null;
  unrealizedPnl: number;
  entryTime: string;
}

export interface PaperFloorFighter {
  rank: number;
  sessionId: string;
  strategyId: string;
  strategyName: string;
  symbols: string[];
  timeframe: string | null;
  status: string;
  startedAt: string;
  lastActivityAt: string | null;
  startingCapital: number;
  currentEquity: number;
  netPnl: number;
  returnPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  openPositionCount: number;
  positions: PaperFloorPosition[];
  feed: {
    provider: "Massive";
    connected: boolean;
    state: "connected" | "disconnected" | "paused" | "not_started";
    symbols: string[];
  };
}

export interface PaperFloorPayload {
  scope: "paper-floor";
  fighters: PaperFloorFighter[];
  summary: {
    activeStrategies: number;
    pausedStrategies: number;
    openPositions: number;
    combinedNetPnl: number;
    leaderStrategyIds: string[];
    tiedForLead: boolean;
    scoreBasis: "net_paper_pnl";
  };
  degraded?: boolean;
  error?: string;
}

type PaperStreamSnapshot = ReadonlyMap<string, { symbols: string[]; connected: boolean }>;

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function assemblePaperFloorReports(
  streams: PaperStreamSnapshot = new Map(),
): Promise<PaperFloorPayload> {
  let queryFailed = false;
  const rows = (await db.execute(sql`
    WITH trade_stats AS (
      SELECT
        session_id,
        COUNT(*)::int AS trades,
        COUNT(*) FILTER (WHERE pnl::numeric > 0)::int AS wins,
        COUNT(*) FILTER (WHERE pnl::numeric < 0)::int AS losses,
        COALESCE(SUM(pnl::numeric), 0) AS realized_pnl,
        MAX(exit_time) AS last_trade_at
      FROM paper_trades
      GROUP BY session_id
    ),
    open_position_stats AS (
      SELECT
        session_id,
        COUNT(*)::int AS open_position_count,
        COALESCE(SUM(unrealized_pnl::numeric), 0) AS unrealized_pnl,
        MAX(entry_time) AS last_position_at,
        jsonb_agg(
          jsonb_build_object(
            'id', id::text,
            'symbol', symbol,
            'side', side,
            'contracts', contracts,
            'entryPrice', entry_price,
            'currentPrice', current_price,
            'unrealizedPnl', unrealized_pnl,
            'entryTime', entry_time
          ) ORDER BY entry_time DESC
        ) AS positions
      FROM paper_positions
      WHERE closed_at IS NULL
      GROUP BY session_id
    )
    SELECT
      ps.id::text AS session_id,
      ps.strategy_id::text AS strategy_id,
      COALESCE(s.name, 'Strategy') AS strategy_name,
      COALESCE(s.symbols, ARRAY[s.symbol]) AS symbols,
      s.timeframe AS timeframe,
      ps.status AS status,
      ps.started_at AS started_at,
      ps.last_signal_time AS last_signal_at,
      ps.starting_capital AS starting_capital,
      ps.current_equity AS current_equity,
      COALESCE(ts.trades, 0) AS trades,
      COALESCE(ts.wins, 0) AS wins,
      COALESCE(ts.losses, 0) AS losses,
      COALESCE(ts.realized_pnl, 0) AS realized_pnl,
      ts.last_trade_at AS last_trade_at,
      COALESCE(ops.open_position_count, 0) AS open_position_count,
      COALESCE(ops.unrealized_pnl, 0) AS unrealized_pnl,
      ops.last_position_at AS last_position_at,
      COALESCE(ops.positions, '[]'::jsonb) AS positions
    FROM paper_sessions ps
    LEFT JOIN strategies s ON s.id = ps.strategy_id
    LEFT JOIN trade_stats ts ON ts.session_id = ps.id
    LEFT JOIN open_position_stats ops ON ops.session_id = ps.id
    WHERE ps.status IN ('active', 'paused')
      AND ps.strategy_id IS NOT NULL
    ORDER BY ps.started_at ASC
  `).catch((err) => {
    queryFailed = true;
    logger.warn({ err }, "slumhouse paper-floor assemble failed — returning degraded payload");
    return [] as unknown[];
  })) as Array<Record<string, unknown>>;

  const fighters = rows.map((row) => {
    const sessionId = String(row.session_id);
    const stream = streams.get(sessionId);
    const status = String(row.status ?? "active");
    const startingCapital = numeric(row.starting_capital);
    const currentEquity = numeric(row.current_equity);
    const netPnl = currentEquity - startingCapital;
    const trades = numeric(row.trades);
    const wins = numeric(row.wins);
    const symbols = Array.isArray(row.symbols) ? row.symbols.map(String) : [];
    const positionsRaw = Array.isArray(row.positions) ? row.positions : [];
    const activity = [row.last_signal_at, row.last_trade_at, row.last_position_at]
      .filter((value): value is string | Date => value instanceof Date || typeof value === "string")
      .map((value) => new Date(value).getTime())
      .filter(Number.isFinite);
    const feedState = status === "paused"
      ? "paused"
      : !stream
        ? "not_started"
        : stream.connected
          ? "connected"
          : "disconnected";

    return {
      rank: 0,
      sessionId,
      strategyId: String(row.strategy_id),
      strategyName: String(row.strategy_name ?? "Strategy"),
      symbols,
      timeframe: row.timeframe == null ? null : String(row.timeframe),
      status,
      startedAt: new Date(row.started_at as string | Date).toISOString(),
      lastActivityAt: activity.length > 0 ? new Date(Math.max(...activity)).toISOString() : null,
      startingCapital,
      currentEquity,
      netPnl,
      returnPct: startingCapital > 0 ? (netPnl / startingCapital) * 100 : 0,
      realizedPnl: numeric(row.realized_pnl),
      unrealizedPnl: numeric(row.unrealized_pnl),
      trades,
      wins,
      losses: numeric(row.losses),
      winRate: trades > 0 ? wins / trades : null,
      openPositionCount: numeric(row.open_position_count),
      positions: positionsRaw.map((position) => {
        const p = position as Record<string, unknown>;
        return {
          id: String(p.id),
          symbol: String(p.symbol ?? ""),
          side: String(p.side ?? ""),
          contracts: numeric(p.contracts),
          entryPrice: numeric(p.entryPrice),
          currentPrice: p.currentPrice == null ? null : numeric(p.currentPrice),
          unrealizedPnl: numeric(p.unrealizedPnl),
          entryTime: new Date(p.entryTime as string | Date).toISOString(),
        };
      }),
      feed: {
        provider: "Massive" as const,
        connected: feedState === "connected",
        state: feedState,
        symbols: stream?.symbols?.length ? [...stream.symbols] : symbols,
      },
    } satisfies PaperFloorFighter;
  });

  fighters.sort((a, b) =>
    Math.round(b.netPnl * 100) - Math.round(a.netPnl * 100) ||
    a.strategyName.localeCompare(b.strategyName),
  );
  let priorScore: number | null = null;
  let priorRank = 0;
  fighters.forEach((fighter, index) => {
    const score = Math.round(fighter.netPnl * 100) / 100;
    if (priorScore === null || score !== priorScore) priorRank = index + 1;
    fighter.rank = priorRank;
    priorScore = score;
  });

  const leadScore = fighters.length > 0 ? Math.round(fighters[0].netPnl * 100) / 100 : null;
  const leaderStrategyIds = leadScore == null
    ? []
    : fighters
        .filter((fighter) => Math.round(fighter.netPnl * 100) / 100 === leadScore)
        .map((fighter) => fighter.strategyId);

  return {
    scope: "paper-floor",
    fighters,
    summary: {
      activeStrategies: fighters.filter((fighter) => fighter.status === "active").length,
      pausedStrategies: fighters.filter((fighter) => fighter.status === "paused").length,
      openPositions: fighters.reduce((total, fighter) => total + fighter.openPositionCount, 0),
      combinedNetPnl: fighters.reduce((total, fighter) => total + fighter.netPnl, 0),
      leaderStrategyIds,
      tiedForLead: leaderStrategyIds.length > 1,
      scoreBasis: "net_paper_pnl",
    },
    ...(queryFailed ? { degraded: true, error: "paper_floor_query_failed" } : {}),
  };
}
