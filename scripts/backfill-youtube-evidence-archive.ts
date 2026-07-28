import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface BackfillArgs {
  apply: boolean;
  sourceDirs: string[];
}

export interface CachedTranscript {
  videoId: string;
  transcript: string;
  sha256: string;
  titleHint: string | null;
  sourcePath: string;
}

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const sourceDirs: string[] = [];
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") {
      apply = true;
    } else if (value === "--source-dir") {
      const sourceDir = argv[index + 1];
      if (!sourceDir) throw new Error("--source-dir requires a path");
      sourceDirs.push(path.resolve(sourceDir));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (sourceDirs.length === 0) throw new Error("At least one --source-dir is required");
  return { apply, sourceDirs };
}

export function parseCachedTranscript(raw: string): { transcript: string; titleHint: string | null } {
  const trimmed = raw.trim();
  const titleMatch = trimmed.match(/^TITLE:\s*([^\r\n]+)(?:\r?\n)+/i);
  if (!titleMatch) return { transcript: trimmed, titleHint: null };
  return {
    transcript: trimmed.slice(titleMatch[0].length).trim(),
    titleHint: titleMatch[1]?.trim() || null,
  };
}

function expectedTranscriptChars(sourceDir: string, videoId: string): number | null {
  const specPath = path.join(sourceDir, `${videoId}.spec.json`);
  if (!fs.existsSync(specPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(specPath, "utf8")) as { transcript_chars?: unknown };
  return typeof parsed.transcript_chars === "number" ? parsed.transcript_chars : null;
}

export function loadCachedTranscripts(sourceDirs: string[], requiredVideoIds: string[]): Map<string, CachedTranscript> {
  const inventory = new Map<string, CachedTranscript>();
  const missing: string[] = [];

  for (const videoId of requiredVideoIds) {
    const candidates: CachedTranscript[] = [];
    for (const sourceDir of sourceDirs) {
      const sourcePath = path.join(sourceDir, `${videoId}.transcript.txt`);
      if (!fs.existsSync(sourcePath)) continue;
      const { transcript, titleHint } = parseCachedTranscript(fs.readFileSync(sourcePath, "utf8"));
      if (transcript.length < 200) throw new Error(`Transcript ${videoId} is too short (${transcript.length} chars)`);
      const expectedChars = expectedTranscriptChars(sourceDir, videoId);
      if (expectedChars != null && transcript.length !== expectedChars) {
        throw new Error(`Transcript ${videoId} length ${transcript.length} does not match extraction spec ${expectedChars}`);
      }
      candidates.push({
        videoId,
        transcript,
        sha256: createHash("sha256").update(transcript, "utf8").digest("hex"),
        titleHint,
        sourcePath,
      });
    }

    if (candidates.length === 0) {
      missing.push(videoId);
      continue;
    }
    const hashes = new Set(candidates.map((candidate) => candidate.sha256));
    if (hashes.size !== 1) throw new Error(`Conflicting cached transcripts found for ${videoId}`);
    inventory.set(videoId, candidates.find((candidate) => candidate.titleHint) ?? candidates[0]!);
  }

  if (missing.length > 0) throw new Error(`Missing cached transcripts: ${missing.join(", ")}`);
  return inventory;
}

export async function fetchYoutubeMetadata(
  youtubeUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ title: string; channel: string | null }> {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeUrl)}`;
  const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`YouTube oEmbed failed (${response.status}) for ${youtubeUrl}`);
  const payload = await response.json() as { title?: unknown; author_name?: unknown };
  if (typeof payload.title !== "string" || !payload.title.trim()) {
    throw new Error(`YouTube oEmbed returned no title for ${youtubeUrl}`);
  }
  return {
    title: payload.title.trim(),
    channel: typeof payload.author_name === "string" && payload.author_name.trim()
      ? payload.author_name.trim()
      : null,
  };
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  const [{ sql }, { db }, { youtubeVideoId, archiveYoutubeEvidence }] = await Promise.all([
    import("drizzle-orm"),
    import("../src/server/db/index.js"),
    import("../src/server/services/youtube-evidence-archive.js"),
  ]);

  const sourceRows = (await db.execute(sql`
    SELECT config->'metadata'->>'source_url' AS youtube_url,
           MIN(created_at) AS first_strategy_at
    FROM strategies
    WHERE COALESCE(config->'metadata'->>'source_url', '') <> ''
    GROUP BY config->'metadata'->>'source_url'
    ORDER BY youtube_url
  `)) as Array<{ youtube_url: string; first_strategy_at: Date | string }>;

  const sources = sourceRows.map((row) => {
    const videoId = youtubeVideoId(row.youtube_url);
    if (!videoId) throw new Error(`Invalid strategy source URL: ${row.youtube_url}`);
    return { ...row, videoId };
  });
  if (new Set(sources.map((source) => source.videoId)).size !== sources.length) {
    throw new Error("Multiple source URLs resolve to the same YouTube video ID");
  }

  const inventory = loadCachedTranscripts(args.sourceDirs, sources.map((source) => source.videoId));
  const prepared = [];
  for (const source of sources) {
    const cached = inventory.get(source.videoId)!;
    const metadata = await fetchYoutubeMetadata(source.youtube_url);
    prepared.push({ source, cached, metadata });
  }

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    sourceVideos: sources.length,
    cachedTranscripts: inventory.size,
    transcriptChars: prepared.reduce((sum, item) => sum + item.cached.transcript.length, 0),
    missing: 0,
  };
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  for (const item of prepared) {
    await archiveYoutubeEvidence({
      youtubeUrl: item.source.youtube_url,
      videoId: item.source.videoId,
      title: item.metadata.title || item.cached.titleHint,
      channel: item.metadata.channel,
      transcript: item.cached.transcript,
      sourceProvider: "historical_extraction_cache",
      sourcePass: "corpus-v2-2026-07-04",
      discoveredAt: new Date(item.source.first_strategy_at),
    });
  }

  const archivedRows = (await db.execute(sql`
    SELECT video_id, transcript_sha256, transcript_chars, transcript_status
    FROM youtube_evidence_archive
    WHERE source_provider = 'historical_extraction_cache'
  `)) as Array<{
    video_id: string;
    transcript_sha256: string | null;
    transcript_chars: number;
    transcript_status: string;
  }>;
  const archived = new Map(archivedRows.map((row) => [row.video_id, row]));
  for (const item of prepared) {
    const row = archived.get(item.source.videoId);
    if (!row || row.transcript_status !== "available" || row.transcript_sha256 !== item.cached.sha256
      || Number(row.transcript_chars) !== item.cached.transcript.length) {
      throw new Error(`Post-write verification failed for ${item.source.videoId}`);
    }
  }

  const { insertAuditRow } = await import("../src/server/lib/audit-log-helper.js");
  await insertAuditRow({
    action: "youtube_evidence.historical_backfill_completed",
    entityType: "youtube_evidence_archive",
    status: "success",
    decisionAuthority: "operator",
    correlationId: randomUUID(),
    input: { source_dirs: args.sourceDirs, expected_videos: sources.length },
    result: { ...summary, verified: sources.length },
  });
  process.stdout.write(`${JSON.stringify({ ...summary, verified: sources.length }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  void main().catch((error: unknown) => {
    const cause = error && typeof error === "object" && "cause" in error
      ? (error as { cause?: unknown }).cause
      : null;
    const message = cause instanceof Error
      ? (cause.stack ?? `${cause.name}: ${cause.message}`)
      : error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
