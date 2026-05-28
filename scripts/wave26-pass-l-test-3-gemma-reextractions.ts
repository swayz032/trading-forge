/**
 * Wave 26 Pass L — Test 3 gemma re-extractions side-by-side (TRUE DRY RUN)
 *
 * Picks library strategies WITH source URLs, fetches their YouTube transcripts,
 * runs them through the NEW minimal extractor via direct callScoutExtractLlm()
 * (bypasses /api/agent/scout-extract route to avoid any bucket writes).
 *
 * READ-ONLY. No DB writes whatsoever. No graduator. No bucket pipeline.
 *
 * Run: npx tsx scripts/wave26-pass-l-test-3-gemma-reextractions.ts
 *      npx tsx scripts/wave26-pass-l-test-3-gemma-reextractions.ts --video=N7uP9V0Iktc
 */

import "dotenv/config";
import postgres from "postgres";
import { YoutubeTranscript } from "youtube-transcript";
import { callScoutExtractLlm } from "../src/server/services/model-router.js";
import { coerceDirectionsInPlace } from "../src/server/lib/direction-coercion.js";
import { checkExtractionQuality } from "../src/server/lib/extraction-quality-gate.js";
import { runRecallPassOnStrategies } from "../src/server/lib/transcript-extractor-recall.js";
import {
  extractTranscriptChunked,
  shouldChunk,
  CHUNKING_THRESHOLD_CHARS,
} from "../src/server/lib/transcript-chunker.js";

const onlyVideo = process.argv.find((a) => a.startsWith("--video="))?.split("=")[1];
const videoIdsCsv = process.argv.find((a) => a.startsWith("--video-ids="))?.split("=")[1];
const explicitVideoIds = videoIdsCsv ? videoIdsCsv.split(",").map((s) => s.trim()) : null;

interface OldExtraction {
  id: string;
  name: string;
  symbol: string;
  description: string | null;
  source_url: string;
  entry_rule: string | null;
  confluence_factors: unknown;
  preferred_regime: string | null;
  stop: unknown;
  targets: unknown;
  archetype: string | null;
}

function extractVideoId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function fetchTranscript(videoId: string): Promise<string> {
  const items = await YoutubeTranscript.fetchTranscript(videoId);
  return items.map((i) => i.text).join(" ");
}

async function callExtractorDirect(transcript: string, sourceUrl: string, title: string): Promise<unknown> {
  // Wave 26 Pass L (2026-05-27) — chunked path for long transcripts.
  // RTX 5060 8 GB VRAM OOMs on >24K-char transcripts at the global
  // TRANSCRIPT_EXTRACTOR_NUM_CTX=32768. The chunker splits into ~10K
  // overlapping windows at a safer per-chunk ctx (12288) and merges by
  // concept_name. See src/server/lib/transcript-chunker.ts for rationale.
  if (shouldChunk(transcript.length)) {
    console.log(`      [chunker] transcript ${transcript.length} chars > ${CHUNKING_THRESHOLD_CHARS} threshold → chunking`);
    const { merged, rawChunks } = await extractTranscriptChunked(transcript, {
      sourceUrl,
      title: title || sourceUrl,
      channel: "youtube",
    });
    for (const rc of rawChunks) {
      const tag = rc.errorReason ? `ERR=${rc.errorReason}` : `parsed=${rc.parsed !== null}`;
      console.log(`      [chunker] chunk ${rc.chunkIndex + 1}/${rawChunks.length} (${rc.chunkChars} chars, ${(rc.durationMs/1000).toFixed(1)}s) ${tag}`);
    }
    return merged;
  }

  // Short transcript — single-pass path preserved (5 working videos depend on it).
  const userPayload = JSON.stringify({
    youtube_url: sourceUrl,
    title: title || sourceUrl,
    channel: "youtube",
    transcript_text: transcript.slice(0, 16_000),
  });
  const raw = await callScoutExtractLlm([{ role: "user", content: userPayload }]);
  if (!raw) throw new Error("LLM returned null (unavailable)");
  try {
    return JSON.parse(raw);
  } catch {
    return { __parse_error: true, raw: raw.slice(0, 500) };
  }
}

function fmt(label: string, val: unknown, indent = "    "): string {
  if (val === undefined || val === null) return `${indent}${label}: <none>`;
  if (Array.isArray(val)) {
    if (val.length === 0) return `${indent}${label}: []`;
    return `${indent}${label}:\n${val.map((v) => `${indent}  - ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n")}`;
  }
  if (typeof val === "object") return `${indent}${label}: ${JSON.stringify(val)}`;
  return `${indent}${label}: ${val}`;
}

function diffSide(label: string, oldVal: unknown, newVal: unknown): string {
  const changed = JSON.stringify(oldVal ?? null) !== JSON.stringify(newVal ?? null);
  const marker = changed ? "  >>> CHANGED" : "  (unchanged)";
  return `  ${label}${marker}\n${fmt("OLD", oldVal)}\n${fmt("NEW", newVal)}`;
}

async function main(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = postgres(DATABASE_URL, { max: 1 });

  console.log("=== Wave 26 Pass L — 3-Strategy Gemma Re-extraction Test ===\n");
  console.log("Mode: TRUE DRY RUN — bypasses /api/agent/scout-extract route");
  console.log("      Calls callScoutExtractLlm() directly. No DB writes.\n");

  // Wave 26 Pass L Round 2 — resolve URLs via BOTH config.source_url AND
  // bucket→mentions path (the 15 extra videos operator's curated graduations
  // never propagated into config.source_url).
  const rows = (await sql`
    WITH bucket_urls AS (
      SELECT DISTINCT ON (b.concept_name)
        b.concept_name,
        b.graduated_strategy_id,
        m.source_url
      FROM strategy_pending_buckets b
      JOIN strategy_pending_mentions m ON m.bucket_id = b.id
      WHERE m.source_url ILIKE '%youtube%'
      ORDER BY b.concept_name, m.created_at DESC NULLS LAST
    )
    SELECT DISTINCT ON (COALESCE(s.config->>'source_url', bu.source_url))
      s.id, s.name, s.symbol, s.description,
      COALESCE(s.config->>'source_url', bu.source_url) AS source_url,
      s.config->>'entry_rule' AS entry_rule,
      s.config->'entry_quality'->'confluence_factors' AS confluence_factors,
      s.config->'entry_quality'->>'preferred_regime' AS preferred_regime,
      s.config->'stop' AS stop,
      s.config->'targets' AS targets,
      s.config->>'archetype' AS archetype
    FROM strategies s
    LEFT JOIN bucket_urls bu ON bu.graduated_strategy_id = s.id
    WHERE s.archived_at IS NULL
      AND COALESCE(s.config->>'source_url', bu.source_url) IS NOT NULL
      AND COALESCE(s.config->>'source_url', bu.source_url) ILIKE '%youtube%'
    ORDER BY COALESCE(s.config->>'source_url', bu.source_url),
             (CASE WHEN s.symbol='MES' THEN 0 WHEN s.symbol='MNQ' THEN 1 ELSE 2 END)
  `) as unknown as OldExtraction[];

  let pool = rows.map((r) => ({ ...r, video_id: extractVideoId(r.source_url) ?? "?" }));
  if (onlyVideo) pool = pool.filter((r) => r.video_id === onlyVideo);
  if (explicitVideoIds) {
    pool = pool.filter((r) => explicitVideoIds.includes(r.video_id));
  }
  const picks = pool.slice(0, 3);

  if (picks.length === 0) {
    console.log("No matching strategies found.");
    await sql.end();
    return;
  }

  console.log(`Testing ${picks.length} strategy(ies):\n`);
  for (const p of picks) console.log(`  - ${p.name.padEnd(45)} video=${p.video_id}`);

  for (const [idx, pick] of picks.entries()) {
    const sep = "=".repeat(80);
    console.log(`\n${sep}\n[${idx + 1}/${picks.length}] ${pick.name}\n${sep}`);
    console.log(`URL:    ${pick.source_url}`);
    console.log(`Symbol: ${pick.symbol}`);
    const titleMatch = (pick.description ?? "").match(/extracted from (.+?)(?:\.|$)/i);
    const title = titleMatch ? titleMatch[1].trim() : pick.name;
    console.log(`Title:  ${title}`);

    try {
      console.log(`\n[1/2] Fetching transcript...`);
      const transcript = await fetchTranscript(pick.video_id);
      console.log(`      ${transcript.length} chars fetched`);

      console.log(`[2/2] Calling extractor (gemma4:e2b default; cloud fallback)...`);
      const t0 = Date.now();
      const fresh = (await callExtractorDirect(transcript, pick.source_url, title)) as Record<string, unknown>;
      console.log(`      ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

      // Schema is { strategies: [...] } from the scout-extract LLM contract
      const strategies = (fresh.strategies as unknown[]) ?? [];

      // Wave 26 Pass L Fix G — coerce direction=both when step text mirrors.
      const coercionLog = coerceDirectionsInPlace(strategies as Array<{ direction?: string; entry_sequence?: Array<{action?: string; rationale?: string|null}> }>);
      if (coercionLog.length > 0) {
        for (const c of coercionLog) {
          console.log(`  >>> POST-VALIDATOR: strategy[${c.index}] direction "${c.originalDirection}" → "both" (matched: "${c.matchedPhrase}")`);
        }
      }

      // Wave 26 Pass L Fix K — recall pass (5 laser-focused questions, sequential gemma calls).
      console.log(`  [recall-pass] firing 5-question recall on ${strategies.length} strategy(ies)...`);
      const tRecall = Date.now();
      const recallResults = await runRecallPassOnStrategies(transcript, strategies as any);
      console.log(`  [recall-pass] ${((Date.now() - tRecall) / 1000).toFixed(1)}s`);
      for (let i = 0; i < recallResults.length; i++) {
        const r = recallResults[i];
        if (r.failed) {
          console.log(`  [recall-pass] strategy[${i}] FAILED: ${r.failureReason}`);
          continue;
        }
        // Mutate the primary strategies array in place with the patched version
        (strategies as any[])[i] = r.patched;
        if (r.appliedChanges.length === 0) {
          console.log(`  [recall-pass] strategy[${i}] no gaps found by recall`);
        } else {
          console.log(`  [recall-pass] strategy[${i}] APPLIED ${r.appliedChanges.length} change(s):`);
          for (const c of r.appliedChanges) console.log(`    ${c}`);
        }
        const rejected = (r.recall as Record<string, unknown>)._rejected;
        if (rejected && typeof rejected === "object" && Object.keys(rejected).length > 0) {
          console.log(`  [recall-pass] strategy[${i}] REJECTED ${Object.keys(rejected).length} hallucination(s):`);
          for (const [field, msg] of Object.entries(rejected)) console.log(`    ✗ ${field}: ${msg}`);
        }
      }

      // Wave 26 Pass L Fix J — quality gate scans for trade-example contamination + R-ratio.
      const qualityReports = checkExtractionQuality(strategies as Array<{ name?: string; entry_sequence?: Array<{action?: string; rationale?: string|null; step?: number}>; source_claim_avg_r?: number|null }>);
      for (const rep of qualityReports) {
        if (rep.warnings.length > 0) {
          console.log(`  >>> QUALITY-GATE: strategy[${rep.strategyIndex}] ${rep.warnings.length} warning(s)${rep.underExtracted ? " — UNDER-EXTRACTED" : ""}`);
          for (const w of rep.warnings) {
            console.log(`        [${w.severity.toUpperCase()}] ${w.field}: ${w.message}`);
            if (w.evidence) console.log(`          evidence: ${w.evidence.slice(0, 150)}`);
          }
        }
      }
      console.log(`      Extracted ${strategies.length} strategy candidate(s)`);
      if (fresh.empty_reason) console.log(`      empty_reason: ${fresh.empty_reason}`);
      if (fresh.instrument_classification) console.log(`      instrument_classification: ${fresh.instrument_classification}`);

      const first = (strategies[0] ?? {}) as Record<string, unknown>;
      console.log("\nOLD vs NEW (most relevant fields):");
      console.log(`  direction: ${first.direction ?? "<missing>"}`);
      const seq = (first.entry_sequence as Array<{step: number, action: string, rationale?: string}>) ?? [];
      console.log(`  entry_sequence (${seq.length} step${seq.length !== 1 ? "s" : ""}):`);
      for (const s of seq) {
        console.log(`    [${s.step}] ${s.action}`);
        if (s.rationale) console.log(`        why: ${s.rationale}`);
      }
      console.log(`  source claims: win_rate=${first.source_claim_win_rate ?? "—"} avg_r=${first.source_claim_avg_r ?? "—"}`);
      console.log(diffSide("preferred_regime", pick.preferred_regime, first.preferred_regime));
      console.log(diffSide("confluences/factors", pick.confluence_factors, first.confluences ?? first.confluence_factors));
      console.log(diffSide("stop", pick.stop, first.stop));
      console.log(diffSide("targets", pick.targets, first.targets));
      if (first.higher_timeframe || first.lower_timeframe) {
        console.log(`    new timeframes: htf=${first.higher_timeframe ?? "?"} ltf=${first.lower_timeframe ?? "?"}`);
      }
      if (first.stop_management) console.log(`    new stop_management: ${first.stop_management}`);
      if (first.rejected_strategies && Array.isArray(first.rejected_strategies) && first.rejected_strategies.length > 0) {
        console.log(`\n  >>> NEW emitted ${(first.rejected_strategies as unknown[]).length} rejected_strategies:`);
        for (const r of first.rejected_strategies as unknown[]) console.log(`      ${JSON.stringify(r)}`);
      }

      if (strategies.length > 1) {
        console.log(`\n  Additional candidates (${strategies.length - 1}):`);
        for (const s of strategies.slice(1)) {
          const sr = s as Record<string, unknown>;
          console.log(`    - ${(sr.concept_name as string) ?? "<no name>"}: ${(sr.entry_rule as string)?.slice(0, 80) ?? "?"}`);
        }
      }
    } catch (e) {
      console.log(`\n  ERROR: ${(e as Error).message}`);
    }
  }

  console.log(`\n${"=".repeat(80)}\nDONE. No DB writes performed.`);
  await sql.end();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
