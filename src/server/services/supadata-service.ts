/**
 * Supadata YouTube Transcript Service
 *
 * Wraps the Supadata API for pulling clean transcripts from YouTube videos
 * (and other sources). Used by the strategy scout pipeline to convert quant
 * trading YouTube videos into searchable strategy text.
 *
 * Free tier: 100 requests/month, 1 RPS.
 * Pro tier: $17/mo for 3000 credits, 10 RPS, advanced features.
 *
 * To stay safely within the 100/mo cap, the route exposes per-day rate limits
 * and the search-router only auto-extracts youtube.com/watch URLs from the
 * top-N fused results (configurable via env).
 */

import { logger } from "../lib/logger.js";
import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";

const SUPADATA_BASE = "https://api.supadata.ai/v1";

export interface SupadataTranscriptResult {
  url: string;
  videoId: string | null;
  language: string;
  availableLanguages: string[];
  text: string;
  durationSeconds?: number;
  fetchedAt: string;
}

interface SupadataYouTubeResponse {
  lang?: string;
  availableLangs?: string[];
  content?: string;
  duration?: number;
  videoId?: string;
}

/** Extract videoId from a YouTube URL — handles watch?v=, youtu.be/, /shorts/, /embed/. */
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** Quick test for whether a URL is a YouTube video page worth transcribing. */
export function isYouTubeUrl(url: string): boolean {
  return extractYouTubeVideoId(url) !== null;
}

// ─── Daily request counter (in-memory) ─────────────────────────
// Supadata free = 100/mo. We cap per-day to stay safely under monthly.
// Default 3/day = 90/mo. Override via SUPADATA_DAILY_LIMIT env.
const DAILY_LIMIT = Number(process.env.SUPADATA_DAILY_LIMIT ?? 3);
let dailyState: { date: string; count: number } = { date: today(), count: 0 };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function rolloverIfNeeded(): void {
  const t = today();
  if (dailyState.date !== t) {
    logger.info({ previousDate: dailyState.date, previousCount: dailyState.count }, "supadata: daily counter rolled over");
    dailyState = { date: t, count: 0 };
  }
}

export function getSupadataUsage(): { date: string; count: number; dailyLimit: number; remaining: number } {
  rolloverIfNeeded();
  return {
    date: dailyState.date,
    count: dailyState.count,
    dailyLimit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - dailyState.count),
  };
}

// ─── Public API ─────────────────────────────────────────────────

export async function fetchYouTubeTranscript(url: string): Promise<SupadataTranscriptResult> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) {
    throw new Error("SUPADATA_API_KEY not configured");
  }

  rolloverIfNeeded();
  if (dailyState.count >= DAILY_LIMIT) {
    throw Object.assign(
      new Error(`Supadata daily request cap (${DAILY_LIMIT}) reached — preserves free 100/mo budget`),
      { code: "SUPADATA_DAILY_CAP" },
    );
  }

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error(`Not a YouTube video URL: ${url}`);
  }

  const cb = CircuitBreakerRegistry.get("supadata", { failureThreshold: 3, cooldownMs: 60_000 });
  if (cb.currentState === "OPEN") {
    throw new CircuitOpenError("supadata", new Date(), 60_000);
  }

  try {
    return await cb.call(async () => {
      const apiUrl = new URL(`${SUPADATA_BASE}/youtube/transcript`);
      apiUrl.searchParams.set("url", url);
      apiUrl.searchParams.set("text", "true");
      apiUrl.searchParams.set("lang", "en");

      const res = await fetch(apiUrl.toString(), {
        headers: { "x-api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "(unreadable)");
        throw new Error(`Supadata HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const json = (await res.json()) as SupadataYouTubeResponse;
      dailyState.count += 1;

      const result: SupadataTranscriptResult = {
        url,
        videoId,
        language: json.lang ?? "en",
        availableLanguages: json.availableLangs ?? ["en"],
        text: json.content ?? "",
        durationSeconds: typeof json.duration === "number" ? json.duration : undefined,
        fetchedAt: new Date().toISOString(),
      };

      logger.info(
        {
          videoId,
          language: result.language,
          textLength: result.text.length,
          dailyUsage: dailyState.count,
          dailyLimit: DAILY_LIMIT,
        },
        "supadata: transcript fetched",
      );

      return result;
    });
  } catch (err: any) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ url, videoId }, "supadata: circuit open");
    } else {
      logger.error({ err: err?.message, url, videoId }, "supadata: fetch failed");
    }
    throw err;
  }
}
