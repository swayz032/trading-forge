import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { getEvidenceVaultWorkers, type EvidenceVaultWorker } from "./worker-directory.js";
import { resolvePremiumName, type NamedStrategyRow } from "./premium-names.js";

export interface EvidenceVideoCard {
  id: string;
  videoId: string;
  youtubeUrl: string;
  title: string;
  channel: string | null;
  transcriptStatus: string;
  transcriptChars: number;
  sourceProvider: string;
  sourceQuery: string | null;
  discoveredAt: string;
  lastSeenAt: string;
  isToday: boolean;
}

export interface EvidenceVaultPayload {
  generatedAt: string;
  capabilities: { operatorViews: boolean };
  stats: { today: number; available: number; total: number; strategies: number; workers: number };
  videos: EvidenceVideoCard[];
  strategies: Array<{
    id: string;
    name: string;
    symbol: string;
    timeframe: string;
    lifecycleState: string;
    sourceVideoId: string | null;
    sourceTitle: string | null;
    sourceDiscoveredAt: string | null;
    sourceIsToday: boolean;
    transcriptStatus: string | null;
  }>;
  workers: EvidenceVaultWorker[];
  selected: (EvidenceVideoCard & {
    transcript: string | null;
    transcriptSha256: string | null;
    strategies: Array<{ id: string; name: string; symbol: string; lifecycleState: string }>;
  }) | null;
}

function toCard(row: any): EvidenceVideoCard {
  return {
    id: String(row.id),
    videoId: String(row.video_id),
    youtubeUrl: String(row.youtube_url),
    title: String(row.title),
    channel: row.channel == null ? null : String(row.channel),
    transcriptStatus: String(row.transcript_status),
    transcriptChars: Number(row.transcript_chars ?? 0),
    sourceProvider: String(row.source_provider),
    sourceQuery: row.source_query == null ? null : String(row.source_query),
    discoveredAt: new Date(row.discovered_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    isToday: Boolean(row.is_today),
  };
}

function strategyPresentation(row: any): { name: string; symbol: string } {
  const symbols = Array.isArray(row.symbols)
    ? row.symbols.map(String)
    : row.symbol == null ? [] : [String(row.symbol)];
  const named: NamedStrategyRow = {
    name: String(row.name ?? ""),
    symbols,
    timeframe: String(row.timeframe ?? ""),
    config: row.config && typeof row.config === "object" ? row.config : null,
  };
  return {
    name: resolvePremiumName(named).displayName,
    symbol: symbols[0] ?? String(row.symbol ?? ""),
  };
}

export async function assembleEvidenceVault(args: { videoId?: string; search?: string; includeOperator?: boolean }): Promise<EvidenceVaultPayload> {
  const search = args.search?.trim().slice(0, 120) ?? "";
  const rows = (await db.execute(sql`
    SELECT id::text, video_id, youtube_url, title, channel, transcript_status,
           transcript_chars, source_provider, source_query, discovered_at,
           last_seen_at,
           ((discovered_at AT TIME ZONE 'America/New_York')::date =
            (now() AT TIME ZONE 'America/New_York')::date) AS is_today
    FROM youtube_evidence_archive
    WHERE (${search} = '' OR title ILIKE ${`%${search}%`} OR channel ILIKE ${`%${search}%`}
           OR source_query ILIKE ${`%${search}%`} OR video_id = ${search})
    ORDER BY discovered_at DESC, title ASC
    LIMIT 120
  `)) as any[];

  const [counts] = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE (discovered_at AT TIME ZONE 'America/New_York')::date =
                              (now() AT TIME ZONE 'America/New_York')::date)::int AS today,
      COUNT(*) FILTER (WHERE transcript_status = 'available')::int AS available,
      COUNT(*)::int AS total
    FROM youtube_evidence_archive
  `)) as any[];

  const strategyRows = args.includeOperator ? (await db.execute(sql`
    SELECT s.id::text, s.name, s.symbol, s.symbols, s.timeframe, s.config, s.lifecycle_state,
           evidence.video_id AS source_video_id,
           evidence.title AS source_title,
           evidence.discovered_at AS source_discovered_at,
           evidence.transcript_status,
           CASE WHEN evidence.discovered_at IS NULL THEN false ELSE
             ((evidence.discovered_at AT TIME ZONE 'America/New_York')::date =
              (now() AT TIME ZONE 'America/New_York')::date)
           END AS source_is_today
    FROM strategies s
    LEFT JOIN LATERAL (
      SELECT e.video_id, e.title, e.discovered_at, e.transcript_status
      FROM youtube_evidence_archive e
      WHERE COALESCE(s.config->'metadata'->>'source_url', '') ILIKE ('%' || e.video_id || '%')
         OR COALESCE(s.config->'compiled_spec'->>'video', '') ILIKE ('%' || e.video_id || '%')
         OR EXISTS (
           SELECT 1
           FROM strategy_pending_buckets b
           JOIN strategy_pending_mentions m ON m.bucket_id = b.id
           WHERE b.graduated_strategy_id = s.id
             AND COALESCE(m.source_url, '') ILIKE ('%' || e.video_id || '%')
         )
      ORDER BY e.discovered_at DESC
      LIMIT 1
    ) evidence ON true
    ORDER BY s.created_at DESC, s.name ASC
    LIMIT 300
  `)) as any[] : [];

  const workers = args.includeOperator ? getEvidenceVaultWorkers() : [];

  const requestedVideoId = args.videoId?.trim() || rows[0]?.video_id || null;
  let selected: EvidenceVaultPayload["selected"] = null;
  if (requestedVideoId) {
    const [detail] = (await db.execute(sql`
      SELECT id::text, video_id, youtube_url, title, channel, transcript_status,
             transcript_chars, transcript_sha256, transcript_text, source_provider,
             source_query, discovered_at, last_seen_at,
             ((discovered_at AT TIME ZONE 'America/New_York')::date =
              (now() AT TIME ZONE 'America/New_York')::date) AS is_today
      FROM youtube_evidence_archive
      WHERE video_id = ${requestedVideoId}
      LIMIT 1
    `)) as any[];

    if (detail) {
      const strategyRows = (await db.execute(sql`
        SELECT DISTINCT s.id::text, s.name, s.symbol, s.symbols, s.timeframe, s.config, s.lifecycle_state
        FROM strategies s
        LEFT JOIN strategy_pending_buckets b ON b.graduated_strategy_id = s.id
        LEFT JOIN strategy_pending_mentions m ON m.bucket_id = b.id
        WHERE COALESCE(s.config->'metadata'->>'source_url', '') ILIKE ${`%${requestedVideoId}%`}
           OR COALESCE(s.config->'compiled_spec'->>'video', '') ILIKE ${`%${requestedVideoId}%`}
           OR COALESCE(m.source_url, '') ILIKE ${`%${requestedVideoId}%`}
        ORDER BY s.name
      `)) as any[];
      selected = {
        ...toCard(detail),
        transcript: detail.transcript_text == null ? null : String(detail.transcript_text),
        transcriptSha256: detail.transcript_sha256 == null ? null : String(detail.transcript_sha256),
        strategies: strategyRows.map((strategy) => {
          const presentation = strategyPresentation(strategy);
          return {
            id: String(strategy.id),
            name: presentation.name,
            symbol: presentation.symbol,
            lifecycleState: String(strategy.lifecycle_state),
          };
        }),
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    capabilities: { operatorViews: Boolean(args.includeOperator) },
    stats: {
      today: Number(counts?.today ?? 0),
      available: Number(counts?.available ?? 0),
      total: Number(counts?.total ?? 0),
      strategies: strategyRows.length,
      workers: workers.length,
    },
    videos: rows.map(toCard),
    strategies: strategyRows.map((strategy) => {
      const presentation = strategyPresentation(strategy);
      return {
        id: String(strategy.id),
        name: presentation.name,
        symbol: presentation.symbol,
        timeframe: String(strategy.timeframe),
        lifecycleState: String(strategy.lifecycle_state),
        sourceVideoId: strategy.source_video_id == null ? null : String(strategy.source_video_id),
        sourceTitle: strategy.source_title == null ? null : String(strategy.source_title),
        sourceDiscoveredAt: strategy.source_discovered_at == null
          ? null
          : new Date(strategy.source_discovered_at).toISOString(),
        sourceIsToday: Boolean(strategy.source_is_today),
        transcriptStatus: strategy.transcript_status == null ? null : String(strategy.transcript_status),
      };
    }),
    workers,
    selected,
  };
}
