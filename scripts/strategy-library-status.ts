/**
 * scripts/strategy-library-status.ts — Read-only strategy library status reporter.
 *
 * Produces a Markdown dashboard + JSON snapshot covering:
 *   - Lifecycle state distribution
 *   - Factor quality histogram (rich / thin / fallback_only / null)
 *   - Archetype distribution (archetype:* / uncatalogued / parametric / none)
 *   - Needs-archetype queue depth + top 10 pending terms
 *   - Per-strategy 4-bit composite promotion-readiness ranking
 *
 * Usage:
 *   npx tsx scripts/strategy-library-status.ts [--top N] [--json-only]
 *
 * Outputs:
 *   - Markdown to stdout (unless --json-only)
 *   - JSON to docs/strategy-library-status.json always
 *
 * Hard rules:
 *   - Read-only: no DB mutations
 *   - Fail-closed on DB unavailability (exit 1 with clear message)
 *   - Pipeline-gate exempt: runs even when trading is paused
 */

import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { strategies, needsArchetypeQueue } from "../src/server/db/schema.js";
import { sql, eq, desc, count } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlagValue(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1] !== undefined) return args[idx + 1];
  return undefined;
}

const TOP_N_RAW = getFlagValue("--top");
const TOP_N: number | null = TOP_N_RAW !== undefined ? parseInt(TOP_N_RAW, 10) : null;
const JSON_ONLY = args.includes("--json-only");

if (TOP_N !== null && (isNaN(TOP_N) || TOP_N < 1)) {
  console.error("ERROR: --top must be a positive integer");
  process.exit(1);
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LifecycleRow {
  state: string;
  count: number;
}

interface FactorQualityHistogram {
  rich: number;
  thin: number;
  fallback_only: number;
  null: number;
}

interface ArchetypeHistogram {
  [category: string]: number;
}

interface QueueEntry {
  speakerTerm: string;
  extractionCount: number;
  ready: boolean;
}

interface StrategyRankBits {
  hasBacktest: boolean;
  hasPassingFrankenstein: boolean;
  isRich: boolean;
  isArchetype: boolean;
}

interface StrategyRankRow {
  rank: number;
  score: number;
  name: string;
  lifecycleState: string;
  factorQuality: string | null;
  entryIndicator: string | null;
  bits: StrategyRankBits;
}

interface NeedsArchetypeQueueResult {
  pendingCount: number;
  top10: QueueEntry[];
}

interface StatusJson {
  generatedAt: string;
  lifecycleDistribution: LifecycleRow[];
  factorQualityHistogram: FactorQualityHistogram;
  archetypeHistogram: ArchetypeHistogram;
  needsArchetypeQueue: NeedsArchetypeQueueResult;
  strategyRanking: StrategyRankRow[];
}

// ─── Query: Lifecycle state distribution ───────────────────────────────────────

async function queryLifecycleDistribution(): Promise<LifecycleRow[]> {
  const rows = await db.execute<{ lifecycle_state: string; count: string }>(
    sql`SELECT lifecycle_state, COUNT(*)::text AS count
        FROM strategies
        GROUP BY lifecycle_state
        ORDER BY COUNT(*) DESC`
  );
  return rows.map((r: { lifecycle_state: string; count: string }) => ({
    state: r.lifecycle_state,
    count: parseInt(r.count, 10),
  }));
}

// ─── Query: Factor quality histogram ───────────────────────────────────────────

async function queryFactorQualityHistogram(): Promise<FactorQualityHistogram> {
  const rows = await db.execute<{ factor_quality: string | null; count: string }>(
    sql`SELECT config->'entry_quality'->>'factor_quality' AS factor_quality,
               COUNT(*)::text AS count
        FROM strategies
        GROUP BY config->'entry_quality'->>'factor_quality'`
  );

  const histogram: FactorQualityHistogram = { rich: 0, thin: 0, fallback_only: 0, null: 0 };
  for (const row of rows) {
    const fq = row.factor_quality;
    if (fq === "rich") {
      histogram.rich += parseInt(row.count, 10);
    } else if (fq === "thin") {
      histogram.thin += parseInt(row.count, 10);
    } else if (fq === "fallback_only") {
      histogram.fallback_only += parseInt(row.count, 10);
    } else {
      histogram.null += parseInt(row.count, 10);
    }
  }
  return histogram;
}

// ─── Query: Archetype histogram ─────────────────────────────────────────────────

async function queryArchetypeHistogram(): Promise<ArchetypeHistogram> {
  const rows = await db.execute<{ entry_indicator: string | null }>(
    sql`SELECT config->>'entry_indicator' AS entry_indicator FROM strategies`
  );

  const histogram: ArchetypeHistogram = {};

  for (const row of rows) {
    const ei = row.entry_indicator;
    let category: string;

    if (!ei || ei.trim() === "") {
      category = "none";
    } else if (ei.startsWith("archetype:")) {
      // Named archetype — use the full key so histogram shows per-archetype counts
      category = ei;
    } else if (ei.startsWith("uncatalogued:")) {
      category = "uncatalogued";
    } else {
      category = "parametric";
    }

    histogram[category] = (histogram[category] ?? 0) + 1;
  }

  return histogram;
}

// ─── Query: Needs-archetype queue ──────────────────────────────────────────────

async function queryNeedsArchetypeQueue(): Promise<NeedsArchetypeQueueResult> {
  // Total pending count
  const countRows = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count
        FROM needs_archetype_queue
        WHERE status = 'pending'`
  );
  const pendingCount = parseInt(countRows[0]?.count ?? "0", 10);

  // Top 10 pending by extraction_count DESC
  const top10Rows = await db.execute<{
    speaker_term: string;
    extraction_count: string;
  }>(
    sql`SELECT speaker_term, extraction_count::text
        FROM needs_archetype_queue
        WHERE status = 'pending'
        ORDER BY extraction_count DESC
        LIMIT 10`
  );

  const top10: QueueEntry[] = top10Rows.map(
    (r: { speaker_term: string; extraction_count: string }) => ({
      speakerTerm: r.speaker_term,
      extractionCount: parseInt(r.extraction_count, 10),
      ready: parseInt(r.extraction_count, 10) >= 3,
    }),
  );

  return { pendingCount, top10 };
}

// ─── Query: All strategies for ranking ─────────────────────────────────────────

interface RawStrategyRow {
  id: string;
  name: string;
  lifecycleState: string;
  config: Record<string, unknown> | null;
}

async function queryAllStrategies(): Promise<RawStrategyRow[]> {
  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      lifecycleState: strategies.lifecycleState,
      config: strategies.config,
    })
    .from(strategies);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lifecycleState: r.lifecycleState as string,
    config: r.config as Record<string, unknown> | null,
  }));
}

// ─── 4-bit score computation ───────────────────────────────────────────────────

function computeScore(config: Record<string, unknown> | null): {
  score: number;
  bits: StrategyRankBits;
  factorQuality: string | null;
  entryIndicator: string | null;
} {
  const cfg = config ?? {};

  // Bit 3 (value 8): has_backtest — config->'backtest_results' IS NOT NULL
  const backtestResults = cfg["backtest_results"];
  const hasBacktest = backtestResults !== undefined && backtestResults !== null;

  // Bit 2 (value 4): has_passing_frankenstein — config->>'frankenstein_passed' = true
  const frankensteinRaw = cfg["frankenstein_passed"];
  const hasPassingFrankenstein =
    frankensteinRaw === true ||
    frankensteinRaw === "true";

  // Bit 1 (value 2): factor_quality = 'rich'
  const entryQuality = cfg["entry_quality"] as Record<string, unknown> | undefined;
  const factorQuality = (entryQuality?.["factor_quality"] as string | undefined) ?? null;
  const isRich = factorQuality === "rich";

  // Bit 0 (value 1): entry_indicator starts with 'archetype:'
  const entryIndicator = (cfg["entry_indicator"] as string | undefined) ?? null;
  const isArchetype = typeof entryIndicator === "string" && entryIndicator.startsWith("archetype:");

  const score =
    (hasBacktest ? 8 : 0) +
    (hasPassingFrankenstein ? 4 : 0) +
    (isRich ? 2 : 0) +
    (isArchetype ? 1 : 0);

  return {
    score,
    bits: { hasBacktest, hasPassingFrankenstein, isRich, isArchetype },
    factorQuality,
    entryIndicator,
  };
}

function buildRanking(
  rows: RawStrategyRow[],
  topN: number | null
): StrategyRankRow[] {
  // Compute score for each strategy
  const scored = rows.map((row) => {
    const { score, bits, factorQuality, entryIndicator } = computeScore(row.config);
    return {
      name: row.name,
      lifecycleState: row.lifecycleState,
      score,
      bits,
      factorQuality,
      entryIndicator,
    };
  });

  // Sort by score DESC, then name ASC
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  // Apply top-N limit
  const limited = topN !== null ? scored.slice(0, topN) : scored;

  return limited.map((row, idx) => ({
    rank: idx + 1,
    score: row.score,
    name: row.name,
    lifecycleState: row.lifecycleState,
    factorQuality: row.factorQuality,
    entryIndicator: row.entryIndicator,
    bits: row.bits,
  }));
}

// ─── Markdown formatting ───────────────────────────────────────────────────────

function mdTable(headers: string[], rows: string[][]): string {
  const sep = headers.map((h) => "-".repeat(Math.max(3, h.length)));
  const lines: string[] = [];
  lines.push("| " + headers.join(" | ") + " |");
  lines.push("| " + sep.join(" | ") + " |");
  for (const row of rows) {
    lines.push("| " + row.join(" | ") + " |");
  }
  return lines.join("\n");
}

function buildMarkdown(data: StatusJson): string {
  const lines: string[] = [];

  // Section 1: Header
  lines.push(`## Strategy Library Status — ${data.generatedAt}`);
  lines.push("");

  // Section 2: Lifecycle state distribution
  lines.push("### Lifecycle State Distribution");
  lines.push("");
  if (data.lifecycleDistribution.length === 0) {
    lines.push("_(no strategies found)_");
  } else {
    lines.push(
      mdTable(
        ["State", "Count"],
        data.lifecycleDistribution.map((r) => [r.state, String(r.count)])
      )
    );
  }
  lines.push("");

  // Section 3: Factor quality histogram
  lines.push("### Factor Quality Histogram");
  lines.push("");
  const fqEntries: [string, number][] = [
    ["rich", data.factorQualityHistogram.rich],
    ["thin", data.factorQualityHistogram.thin],
    ["fallback_only", data.factorQualityHistogram.fallback_only],
    ["null", data.factorQualityHistogram.null],
  ];
  lines.push(
    mdTable(
      ["Quality", "Count"],
      fqEntries.map(([q, c]) => [q, String(c)])
    )
  );
  lines.push("");

  // Section 4: Archetype distribution
  lines.push("### Archetype Distribution");
  lines.push("");
  const archetypeEntries = Object.entries(data.archetypeHistogram).sort(
    (a, b) => b[1] - a[1]
  );
  if (archetypeEntries.length === 0) {
    lines.push("_(no strategies found)_");
  } else {
    lines.push(
      mdTable(
        ["Category", "Count"],
        archetypeEntries.map(([cat, cnt]) => [cat, String(cnt)])
      )
    );
  }
  lines.push("");

  // Section 5: Needs Archetype Queue
  const q = data.needsArchetypeQueue;
  lines.push(`### Needs Archetype Queue — depth ${q.pendingCount} pending`);
  lines.push("");
  if (q.top10.length === 0) {
    lines.push("_(queue is empty)_");
  } else {
    lines.push(
      mdTable(
        ["Speaker Term", "Extraction Count", "Ready?"],
        q.top10.map((e) => [
          e.speakerTerm,
          String(e.extractionCount),
          e.ready ? "YES (ready)" : "no",
        ])
      )
    );
  }
  lines.push("");

  // Section 6: Per-strategy promotion ranking
  const topLabel = TOP_N !== null ? ` (top ${TOP_N})` : "";
  lines.push(`### Per-Strategy Promotion Ranking${topLabel}`);
  lines.push("");
  lines.push(
    "_Score: 4-bit composite (0-15). Bit 3=has_backtest, Bit 2=frankenstein_passed, Bit 1=factor_quality=rich, Bit 0=archetype:*_"
  );
  lines.push("");

  if (data.strategyRanking.length === 0) {
    lines.push("_(no strategies found)_");
  } else {
    lines.push(
      mdTable(
        ["Rank", "Score", "Name", "State", "Quality", "Archetype", "Notes"],
        data.strategyRanking.map((r) => {
          const bits = r.bits;
          const notes: string[] = [];
          if (bits.hasBacktest) notes.push("backtest");
          if (bits.hasPassingFrankenstein) notes.push("frankenstein");
          if (bits.isRich) notes.push("rich");
          if (bits.isArchetype) notes.push("archetype");
          if (notes.length === 0) notes.push("none");
          return [
            String(r.rank),
            String(r.score),
            r.name,
            r.lifecycleState,
            r.factorQuality ?? "null",
            r.entryIndicator ?? "—",
            notes.join(", "),
          ];
        })
      )
    );
  }
  lines.push("");
  lines.push(
    `_Generated by scripts/strategy-library-status.ts — ${data.generatedAt}_`
  );

  return lines.join("\n");
}

// ─── File output ───────────────────────────────────────────────────────────────

function writeJson(data: StatusJson): string {
  const jsonPath = resolve(process.cwd(), "docs", "strategy-library-status.json");
  try {
    mkdirSync(resolve(process.cwd(), "docs"), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[strategy-library-status] WARNING: could not write JSON file:", err);
  }
  return jsonPath;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  console.error(`[strategy-library-status] starting — ${generatedAt}`);

  let lifecycleDistribution: LifecycleRow[];
  let factorQualityHistogram: FactorQualityHistogram;
  let archetypeHistogram: ArchetypeHistogram;
  let needsArchetypeQueueResult: NeedsArchetypeQueueResult;
  let allStrategies: RawStrategyRow[];

  try {
    [
      lifecycleDistribution,
      factorQualityHistogram,
      archetypeHistogram,
      needsArchetypeQueueResult,
      allStrategies,
    ] = await Promise.all([
      queryLifecycleDistribution(),
      queryFactorQualityHistogram(),
      queryArchetypeHistogram(),
      queryNeedsArchetypeQueue(),
      queryAllStrategies(),
    ]);
  } catch (err) {
    console.error(
      "[strategy-library-status] ERROR: database query failed.\n" +
        "NOTE: This script requires a running database. Set DATABASE_URL in .env\n",
      err
    );
    process.exit(1);
  }

  const strategyRanking = buildRanking(allStrategies, TOP_N);

  const data: StatusJson = {
    generatedAt,
    lifecycleDistribution,
    factorQualityHistogram,
    archetypeHistogram,
    needsArchetypeQueue: needsArchetypeQueueResult,
    strategyRanking,
  };

  // Write JSON file
  const jsonPath = writeJson(data);
  console.error(`[strategy-library-status] JSON written to ${jsonPath}`);

  if (JSON_ONLY) {
    // JSON-only mode: print JSON to stdout
    console.log(JSON.stringify(data, null, 2));
  } else {
    // Default mode: print Markdown to stdout
    const markdown = buildMarkdown(data);
    console.log(markdown);
  }

  console.error(
    `[strategy-library-status] done — ${allStrategies.length} strategies, ` +
      `${needsArchetypeQueueResult.pendingCount} pending queue entries`
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("strategy-library-status: fatal error", err);
  process.exit(1);
});
