/**
 * transcript-fetch-queue.ts — W23G.4 (2026-05-19)
 *
 * Exponential-backoff retry wrapper for `youtube-transcript` npm package.
 *
 * Problem solved:
 *   Single-shot fetchTranscript calls have no retry — a transient 429 / timeout
 *   silently returns empty text and the video is discarded. Operator audit
 *   (tmp-factory-audit/manual-youtube-scout-v6.mjs) confirmed ~70% failure rate
 *   when the caption pre-filter was dropped, mostly transient rate-limit errors.
 *
 * Design:
 *   - Try lang:"en" first (matches human-captioned English content).
 *   - On any error, fall back to no-lang (auto-captions / other languages).
 *   - On 429 / timeout / ECONNRESET, back off and retry.
 *   - sleepFn is injectable so tests can pass `async () => {}` (no real waits).
 *   - Each attempt is timed and returned in attempts[]; caller can write the
 *     array to transcript_fetch_outcomes for dashboarding.
 *
 * Outcome taxonomy (TranscriptFetchAttempt.outcome):
 *   captioned_succeeded  — lang:"en" attempt succeeded on some attempt number
 *   captioned_failed     — lang:"en" threw; no-lang fallback succeeded
 *   auto_recovered       — a LATER attempt (2 or 3) succeeded after earlier fail
 *   all_failed           — all maxAttempts exhausted with no usable transcript
 *
 * Total max wall-clock per video: 2 + 8 + 30 + ~5s API ≈ 45s (per spec §7).
 */

import { logger } from "../index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscriptFetchAttempt {
  videoId: string;
  attemptNumber: 1 | 2 | 3;
  outcome: "captioned_succeeded" | "captioned_failed" | "auto_recovered" | "all_failed";
  durationMs: number;
  errorMessage?: string;
}

export interface TranscriptFetchResult {
  /** Joined transcript text, or null if all attempts failed. */
  transcript: string | null;
  /** Per-attempt telemetry for writing to transcript_fetch_outcomes. */
  attempts: TranscriptFetchAttempt[];
  /** Most-successful single attempt's outcome (last attempt's outcome). */
  finalOutcome: TranscriptFetchAttempt["outcome"];
}

// ─── Error classification ─────────────────────────────────────────────────────

/** Returns true if this error is transient and worth retrying. */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // HTTP 429 (rate limited), 5xx (server-side), timeouts, connection resets
  if (msg.includes("429") || msg.includes("too many requests")) return true;
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted")) return true;
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("network")) return true;
  if (msg.includes("fetch failed") || msg.includes("socket hang up")) return true;
  // youtube-transcript npm specific: disabled, not found, subtitles unavailable
  // These are NOT transient — video has no captions, don't retry.
  return false;
}

/** Returns true if this error means "video has no captions at all" (not retryable). */
function isNoCaptionsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("disabled") ||
    msg.includes("no captions") ||
    msg.includes("subtitles are disabled") ||
    msg.includes("transcript is disabled") ||
    msg.includes("could not find") ||
    msg.includes("not found") ||
    msg.includes("unavailable")
  );
}

// ─── Sleep with jitter ────────────────────────────────────────────────────────

const DEFAULT_BASE_DELAYS_MS = [2_000, 8_000, 30_000];
const DEFAULT_JITTER_PCT = 0.25;

function applyJitter(baseMs: number, jitterPct: number): number {
  // ±jitterPct of base delay, uniformly distributed
  const delta = baseMs * jitterPct;
  return Math.round(baseMs - delta + Math.random() * 2 * delta);
}

// ─── Core retry function ──────────────────────────────────────────────────────

/**
 * Fetch a YouTube transcript with exponential-backoff retry.
 *
 * @param videoId  The YouTube video ID (not the full URL).
 * @param opts     Optional override for maxAttempts, delays, jitter, sleepFn.
 */
export async function fetchTranscriptWithRetry(
  videoId: string,
  opts?: {
    maxAttempts?: number;
    baseDelaysMs?: number[];
    jitterPct?: number;
    sleepFn?: (ms: number) => Promise<void>;
  },
): Promise<TranscriptFetchResult> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelaysMs = opts?.baseDelaysMs ?? DEFAULT_BASE_DELAYS_MS;
  const jitterPct = opts?.jitterPct ?? DEFAULT_JITTER_PCT;
  const sleepFn = opts?.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const attempts: TranscriptFetchAttempt[] = [];
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();
    try {
      // Dynamic import keeps the module-level youtube-transcript import optional
      // (test environments mock it via vi.mock("youtube-transcript")).
      const { YoutubeTranscript } = await import("youtube-transcript");

      let segments: Array<{ text: string }> | null = null;
      let langOutcome: "captioned_succeeded" | "captioned_failed" = "captioned_succeeded";

      // Try English captions first; fall back to no-lang ONLY for language-availability
      // errors (e.g. "no English captions"). Transient errors (429, timeout, ECONNRESET)
      // must propagate so the outer retry loop can back off and retry the whole attempt.
      try {
        segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
      } catch (langErr) {
        // If this is a transient error, re-throw immediately — the outer loop handles retry.
        if (isTransientError(langErr)) {
          throw langErr;
        }
        // Language not available / video not found — try without lang restriction.
        langOutcome = "captioned_failed";
        try {
          segments = await YoutubeTranscript.fetchTranscript(videoId);
        } catch (noLangErr) {
          // Both lang paths failed — escalate the no-lang error for outer-loop handling.
          throw noLangErr;
        }
      }

      if (!Array.isArray(segments) || segments.length === 0) {
        // Treat empty segments the same as a failed fetch
        throw new Error("youtube-transcript: empty segments returned");
      }

      const text = segments
        .map((s) => String(s.text ?? ""))
        .join(" ")
        .replace(/&amp;/gi, "&")
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();

      if (text.length < 200) {
        throw new Error(`youtube-transcript: transcript too short (${text.length} chars)`);
      }

      const durationMs = Date.now() - attemptStart;
      // Determine final outcome: if this is a recovery after earlier failures, mark auto_recovered
      const outcome: TranscriptFetchAttempt["outcome"] =
        attempts.length > 0
          ? "auto_recovered"
          : langOutcome; // captioned_succeeded or captioned_failed (no-lang succeeded)

      attempts.push({
        videoId,
        attemptNumber: attempt as 1 | 2 | 3,
        outcome,
        durationMs,
      });

      logger.debug(
        { videoId, attempt, outcome, durationMs, textLen: text.length },
        "transcript-fetch-queue: succeeded",
      );

      return { transcript: text, attempts, finalOutcome: outcome };
    } catch (err) {
      const durationMs = Date.now() - attemptStart;
      lastError = err;

      const errorMessage = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempt >= maxAttempts;

      // If video has no captions at all, stop immediately — no point retrying.
      if (isNoCaptionsError(err)) {
        attempts.push({
          videoId,
          attemptNumber: attempt as 1 | 2 | 3,
          outcome: "all_failed",
          durationMs,
          errorMessage,
        });
        logger.debug(
          { videoId, attempt, errorMessage },
          "transcript-fetch-queue: no captions available — skipping retries",
        );
        return { transcript: null, attempts, finalOutcome: "all_failed" };
      }

      if (isLastAttempt) {
        attempts.push({
          videoId,
          attemptNumber: attempt as 1 | 2 | 3,
          outcome: "all_failed",
          durationMs,
          errorMessage,
        });
        logger.debug(
          { videoId, attempt, maxAttempts, errorMessage },
          "transcript-fetch-queue: all attempts exhausted",
        );
        break;
      }

      // Mark attempt as failed — outcome will be updated on next success
      attempts.push({
        videoId,
        attemptNumber: attempt as 1 | 2 | 3,
        outcome: "all_failed", // interim; will be superseded if next attempt succeeds
        durationMs,
        errorMessage,
      });

      // Only back off if this looks transient; non-transient errors still retry
      // (caller can decide; we don't abort early on non-transient unless it's "no captions").
      const delay = applyJitter(baseDelaysMs[attempt - 1] ?? baseDelaysMs[baseDelaysMs.length - 1], jitterPct);

      logger.debug(
        { videoId, attempt, maxAttempts, errorMessage, retryDelayMs: delay, transient: isTransientError(err) },
        "transcript-fetch-queue: attempt failed, retrying",
      );

      await sleepFn(delay);
    }
  }

  // All attempts failed
  const finalErrorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  return {
    transcript: null,
    attempts,
    finalOutcome: "all_failed",
  };
}
