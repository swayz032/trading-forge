#!/usr/bin/env node
/**
 * Pass 6 Branch C — Backfill scout-journal premium fields onto legacy rows.
 *
 * Idempotent: re-running after a successful first run prints all-zeros.
 *
 * For every row in `system_journal`:
 *   1. If strategy_params.signal_type missing →
 *        - source LIKE 'brave-news%'  → 'market_news_intel'
 *        - everything else            → 'strategy_candidate'
 *   2. If strategy_params.cleaned_title missing → stripMarkdown(title field)
 *   3. If strategy_params.cleaned_lead  missing → 1-sentence lead from description
 *   4. Preserve raw_title / raw_description if not already set.
 *
 * Operator action only — never run from a cron.
 *
 * Usage:
 *   node scripts/cleanup-scout-journal.mjs
 */

import postgres from "postgres";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env") });

const DATABASE_URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_PUBLIC_URL or DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 20 });

// ─── Pure helpers (mirror src/server/services/scout-formatter.ts) ───
function stripMarkdown(s) {
  if (!s) return "";
  return String(s)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1$2$3")
    .replace(/(^|[^_])_([^_]+)_([^_]|$)/g, "$1$2$3")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function smartTruncate(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  const slice = s.slice(0, n);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace <= 0) return slice;
  return slice.slice(0, lastSpace).trimEnd();
}

function generateOneSentenceLead(s, max = 200) {
  if (!s) return "";
  const cleaned = stripMarkdown(s).trim();
  if (cleaned.length === 0) return "";
  const match = cleaned.match(/^(.*?[.!?])(\s|$)/);
  let lead = match && match[1] ? match[1].trim() : cleaned;
  if (lead.length > max) return smartTruncate(lead, max);
  return lead;
}

function inferSignalType(source) {
  if (!source) return "strategy_candidate";
  if (String(source).toLowerCase().startsWith("brave-news")) return "market_news_intel";
  return "strategy_candidate";
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log("Scanning system_journal for backfill opportunities…");

  // Fetch every row that currently has either a missing signal_type, missing
  // cleaned_title, missing cleaned_lead, or missing raw_title/raw_description.
  // Pull the columns we need to compute the new params.
  const rows = await sql`
    SELECT id, source, strategy_params, generation_prompt
    FROM system_journal
  `;

  const total = rows.length;
  let backfilledSignalType = 0;
  let backfilledCleanedTitle = 0;
  let backfilledCleanedLead = 0;
  let backfilledRawTitle = 0;
  let backfilledRawDescription = 0;
  let updatedRows = 0;

  for (const row of rows) {
    const params = row.strategy_params ?? {};
    const next = { ...params };
    let changed = false;

    // 1. signal_type
    if (next.signal_type == null) {
      next.signal_type = inferSignalType(row.source);
      backfilledSignalType += 1;
      changed = true;
    }

    // 2. cleaned_title
    if (typeof next.cleaned_title !== "string" || next.cleaned_title.trim().length === 0) {
      // Pull the source title from common locations that pre-Pass-4 used.
      const rawSourceTitle =
        (typeof params.title === "string" && params.title) ||
        (typeof params.name === "string" && params.name) ||
        (typeof row.generation_prompt === "string" ? row.generation_prompt.slice(0, 200) : "") ||
        "";
      const cleaned = stripMarkdown(rawSourceTitle);
      if (cleaned.length > 0) {
        next.cleaned_title = cleaned;
        backfilledCleanedTitle += 1;
        changed = true;
      }
    }

    // 3. cleaned_lead
    if (typeof next.cleaned_lead !== "string" || next.cleaned_lead.trim().length === 0) {
      const rawDesc =
        (typeof params.description === "string" && params.description) ||
        (typeof params.summary === "string" && params.summary) ||
        "";
      const lead = generateOneSentenceLead(rawDesc);
      if (lead.length > 0) {
        next.cleaned_lead = lead;
        backfilledCleanedLead += 1;
        changed = true;
      }
    }

    // 4. preserve raw_title / raw_description
    if (next.raw_title == null && typeof params.title === "string" && params.title.length > 0) {
      next.raw_title = params.title;
      backfilledRawTitle += 1;
      changed = true;
    }
    if (
      next.raw_description == null &&
      typeof params.description === "string" &&
      params.description.length > 0
    ) {
      next.raw_description = params.description;
      backfilledRawDescription += 1;
      changed = true;
    }

    if (changed) {
      await sql`
        UPDATE system_journal
        SET strategy_params = ${sql.json(next)}
        WHERE id = ${row.id}
      `;
      updatedRows += 1;
    }
  }

  console.log("");
  console.log("─── Cleanup Summary ───");
  console.log(`Rows scanned:                 ${total}`);
  console.log(`Rows updated:                 ${updatedRows}`);
  console.log(`signal_type backfilled:       ${backfilledSignalType}`);
  console.log(`cleaned_title backfilled:     ${backfilledCleanedTitle}`);
  console.log(`cleaned_lead backfilled:      ${backfilledCleanedLead}`);
  console.log(`raw_title preserved:          ${backfilledRawTitle}`);
  console.log(`raw_description preserved:    ${backfilledRawDescription}`);
  console.log("");
  if (updatedRows === 0) {
    console.log("No-op: every row already premium-formatted. (Idempotency confirmed.)");
  }

  await sql.end();
}

main().catch(async (err) => {
  console.error("cleanup-scout-journal failed:", err);
  try { await sql.end(); } catch {}
  process.exit(1);
});
