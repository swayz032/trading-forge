#!/usr/bin/env node
/**
 * AR-1338A -- fetch and pin a source transcript for the 40-video modern extraction upgrade
 * factory, following the EXACT storage convention `scripts/svkm_locator_benchmark.py` already
 * uses for sVkm: `src/engine/extraction/fixtures/source-evidence/<video_id>.transcript.txt`.
 *
 * Deliberately does NOT import `src/server/services/transcript-fetch-queue.ts` -- that module
 * imports `{ logger } from "../index.js"`, which executes the ENTIRE server bootstrap (Express
 * app setup, route mounting) as a side effect of the import. Reimplements the same free
 * `youtube-transcript` npm call (no API key required) with equivalent retry/fallback behavior,
 * standalone, so fetching a transcript never risks starting a second server instance.
 *
 * "Do not re-download a video ... when an exact source-pinned transcript already exists"
 * (AR-1338A S2): refuses to overwrite an existing pinned transcript file.
 *
 * Usage: node scripts/fetch_source_transcript.mjs <video_id> [video_id ...]
 */
import { YoutubeTranscript } from "youtube-transcript";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const OUT_DIR = "src/engine/extraction/fixtures/source-evidence";
const DELAYS_MS = [2000, 8000, 30000];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOne(videoId) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let segments;
      try {
        segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
      } catch {
        segments = await YoutubeTranscript.fetchTranscript(videoId);
      }
      if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error("empty segments returned");
      }
      const text = segments
        .map((s) => String(s.text ?? ""))
        .join(" ")
        .replace(/&amp;/gi, "&")
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
      return { ok: true, text, attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(DELAYS_MS[attempt - 1]);
    }
  }
  return { ok: false, error: String(lastErr), attempts: 3 };
}

async function main() {
  const videoIds = process.argv.slice(2);
  if (videoIds.length === 0) {
    console.error("usage: node scripts/fetch_source_transcript.mjs <video_id> [video_id ...]");
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const results = [];
  for (const videoId of videoIds) {
    const outPath = `${OUT_DIR}/${videoId}.transcript.txt`;
    if (existsSync(outPath)) {
      results.push({ video_id: videoId, status: "SKIPPED_ALREADY_PINNED", path: outPath });
      continue;
    }
    const r = await fetchOne(videoId);
    if (!r.ok) {
      results.push({ video_id: videoId, status: "FETCH_FAILED", error: r.error });
      continue;
    }
    writeFileSync(outPath, r.text, { encoding: "utf-8" });
    const sha256 = createHash("sha256").update(r.text, "utf-8").digest("hex");
    results.push({
      video_id: videoId,
      status: "FETCHED",
      path: outPath,
      char_count: r.text.length,
      sha256,
      attempt: r.attempt,
    });
  }
  console.log(JSON.stringify(results, null, 2));
  const anyFailed = results.some((r) => r.status === "FETCH_FAILED");
  process.exit(anyFailed ? 1 : 0);
}

main();
