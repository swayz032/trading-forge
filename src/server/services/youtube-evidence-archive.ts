import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { youtubeEvidenceArchive } from "../db/schema.js";

export type TranscriptArchiveStatus = "available" | "pending" | "unavailable" | "too_short";

export interface ArchiveYoutubeEvidenceInput {
  youtubeUrl: string;
  videoId?: string | null;
  title?: string | null;
  channel?: string | null;
  transcript?: string | null;
  sourceProvider: string;
  sourceQuery?: string | null;
  sourcePass?: string | null;
  status?: TranscriptArchiveStatus;
}

export function youtubeVideoId(value: string): string | null {
  const candidate = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be") return null;
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
    const segment = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return /^[A-Za-z0-9_-]{11}$/.test(segment) ? segment : null;
  } catch {
    return null;
  }
}

/**
 * Idempotently persists a video discovery and, when present, its complete
 * transcript. A later successful fetch upgrades an earlier pending/failure
 * row; a later failure can never erase transcript evidence already archived.
 */
export async function archiveYoutubeEvidence(input: ArchiveYoutubeEvidenceInput): Promise<string> {
  const videoId = input.videoId ? youtubeVideoId(input.videoId) : youtubeVideoId(input.youtubeUrl);
  if (!videoId) throw new Error("youtube_evidence_invalid_video_id");

  const transcript = input.transcript?.trim() || null;
  const transcriptSha256 = transcript
    ? createHash("sha256").update(transcript, "utf8").digest("hex")
    : null;
  const status: TranscriptArchiveStatus = transcript ? "available" : (input.status ?? "pending");
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const title = input.title?.trim() || `YouTube video ${videoId}`;
  const now = new Date();

  const [row] = await db.insert(youtubeEvidenceArchive).values({
    videoId,
    youtubeUrl: canonicalUrl,
    title,
    channel: input.channel?.trim() || null,
    transcriptText: transcript,
    transcriptSha256,
    transcriptChars: transcript?.length ?? 0,
    sourceProvider: input.sourceProvider,
    sourceQuery: input.sourceQuery?.trim() || null,
    sourcePass: input.sourcePass?.trim() || null,
    transcriptStatus: status,
    transcriptFetchedAt: transcript ? now : null,
    lastSeenAt: now,
  }).onConflictDoUpdate({
    target: youtubeEvidenceArchive.videoId,
    set: {
      youtubeUrl: canonicalUrl,
      title: sql`CASE WHEN ${title} LIKE 'YouTube video %' THEN ${youtubeEvidenceArchive.title} ELSE ${title} END`,
      channel: sql`COALESCE(${input.channel?.trim() || null}, ${youtubeEvidenceArchive.channel})`,
      transcriptText: sql`COALESCE(${transcript}, ${youtubeEvidenceArchive.transcriptText})`,
      transcriptSha256: sql`COALESCE(${transcriptSha256}, ${youtubeEvidenceArchive.transcriptSha256})`,
      transcriptChars: sql`CASE WHEN ${transcript} IS NOT NULL THEN ${transcript?.length ?? 0} ELSE ${youtubeEvidenceArchive.transcriptChars} END`,
      sourceProvider: input.sourceProvider,
      sourceQuery: sql`COALESCE(${input.sourceQuery?.trim() || null}, ${youtubeEvidenceArchive.sourceQuery})`,
      sourcePass: sql`COALESCE(${input.sourcePass?.trim() || null}, ${youtubeEvidenceArchive.sourcePass})`,
      transcriptStatus: sql`CASE WHEN ${transcript} IS NOT NULL THEN 'available' WHEN ${youtubeEvidenceArchive.transcriptStatus} = 'available' THEN 'available' ELSE ${status} END`,
      transcriptFetchedAt: sql`CASE WHEN ${transcript} IS NOT NULL THEN ${now} ELSE ${youtubeEvidenceArchive.transcriptFetchedAt} END`,
      lastSeenAt: now,
    },
  }).returning({ id: youtubeEvidenceArchive.id });

  if (!row) throw new Error("youtube_evidence_archive_write_failed");
  return row.id;
}
