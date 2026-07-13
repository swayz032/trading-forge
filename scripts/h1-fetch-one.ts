/**
 * h1-fetch-one.ts — H1 pilot transcript fetch bridge (conductor-authored driver, NOT instrument).
 *
 * Replicates the CORE of fetchTranscriptWithRetry() (src/server/services/transcript-fetch-queue.ts:
 * lines 118-184) BYTE-FAITHFULLY — the same `youtube-transcript` npm dynamic-import + call, the same
 * English-first / no-lang fallback, the same 3-attempt exponential backoff, and the SAME text
 * normalization + min-length checks. It deliberately does NOT `import` that module because that module's
 * `import { logger } from "../index.js"` boots the whole server (runs boot migrations at import time) —
 * a heavy side effect wholly inappropriate for a one-shot CLI fetch. Only the youtube-transcript call
 * shape matters for the production path; logger telemetry + the DB outcome-write are the queue module's
 * own concerns, not part of the fetch itself.
 *
 * INPUT (stdin JSON): {"video_id": string}
 * OUTPUT (stdout JSON): {"video_id","transcript","char_count","final_outcome","attempts"}
 *   or {"error": "..."} + exit 1 on failure (never a fabricated/empty transcript).
 */

interface Attempt { videoId: string; attemptNumber: number; outcome: string; durationMs: number; errorMessage?: string; }

const DEFAULT_BASE_DELAYS_MS = [2_000, 8_000, 30_000];
const DEFAULT_JITTER_PCT = 0.25;

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes("429") || msg.includes("too many requests")) return true;
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted")) return true;
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("network")) return true;
  if (msg.includes("fetch failed") || msg.includes("socket hang up")) return true;
  return false;
}

function applyJitter(baseMs: number, jitterPct: number): number {
  const delta = baseMs * jitterPct;
  return Math.round(baseMs - delta + Math.random() * 2 * delta);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchTranscript(videoId: string): Promise<{ transcript: string; attempts: Attempt[]; finalOutcome: string }> {
  const maxAttempts = 3;
  const attempts: Attempt[] = [];
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();
    try {
      const { YoutubeTranscript } = await import("youtube-transcript");
      let segments: Array<{ text: string }> | null = null;
      let langOutcome: "captioned_succeeded" | "captioned_failed" = "captioned_succeeded";
      try {
        segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
      } catch (langErr) {
        if (isTransientError(langErr)) throw langErr;
        langOutcome = "captioned_failed";
        segments = await YoutubeTranscript.fetchTranscript(videoId);
      }
      if (!Array.isArray(segments) || segments.length === 0) throw new Error("youtube-transcript: empty segments returned");
      const text = segments
        .map((s) => String(s.text ?? ""))
        .join(" ")
        .replace(/&amp;/gi, "&")
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length < 200) throw new Error(`youtube-transcript: transcript too short (${text.length} chars)`);
      const outcome = attempts.length > 0 ? "auto_recovered" : langOutcome;
      attempts.push({ videoId, attemptNumber: attempt, outcome, durationMs: Date.now() - attemptStart });
      return { transcript: text, attempts, finalOutcome: outcome };
    } catch (err) {
      lastError = err;
      attempts.push({
        videoId, attemptNumber: attempt, outcome: "all_failed",
        durationMs: Date.now() - attemptStart,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      if (attempt < maxAttempts) {
        await sleep(applyJitter(DEFAULT_BASE_DELAYS_MS[attempt - 1] ?? 30_000, DEFAULT_JITTER_PCT));
      }
    }
  }
  throw new Error(`all ${maxAttempts} attempts failed for ${videoId}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<void> {
  let videoId: string;
  try {
    const parsed = JSON.parse(await readStdin()) as { video_id?: string };
    videoId = parsed.video_id ?? "";
  } catch (err) {
    console.log(JSON.stringify({ error: `invalid stdin JSON: ${(err as Error).message}` }));
    process.exitCode = 1;
    return;
  }
  if (!videoId) {
    console.log(JSON.stringify({ error: "video_id is required" }));
    process.exitCode = 1;
    return;
  }
  try {
    const res = await fetchTranscript(videoId);
    console.log(JSON.stringify({ video_id: videoId, transcript: res.transcript, char_count: res.transcript.length, final_outcome: res.finalOutcome, attempts: res.attempts }));
  } catch (err) {
    console.log(JSON.stringify({ error: `fetch failed for ${videoId}: ${(err as Error).message ?? err}` }));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ error: `unhandled: ${(err as Error).message ?? String(err)}` }));
  process.exitCode = 1;
});
