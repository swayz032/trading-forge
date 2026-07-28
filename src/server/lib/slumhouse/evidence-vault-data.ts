import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";

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
  stats: { today: number; available: number; total: number };
  videos: EvidenceVideoCard[];
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

export async function assembleEvidenceVault(args: { videoId?: string; search?: string }): Promise<EvidenceVaultPayload> {
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
        SELECT DISTINCT s.id::text, s.name, s.symbol, s.lifecycle_state
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
        strategies: strategyRows.map((strategy) => ({
          id: String(strategy.id),
          name: String(strategy.name),
          symbol: String(strategy.symbol),
          lifecycleState: String(strategy.lifecycle_state),
        })),
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      today: Number(counts?.today ?? 0),
      available: Number(counts?.available ?? 0),
      total: Number(counts?.total ?? 0),
    },
    videos: rows.map(toCard),
    selected,
  };
}
