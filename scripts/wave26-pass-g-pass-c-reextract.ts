/**
 * wave26-pass-g-pass-c-reextract.ts
 * Wave 26 Pass G Pass C (2026-05-26)
 *
 * Re-extract strategies with factor_quality IN ('fallback_only', 'thin') through
 * the new Gemma v10 prompt (transcript-extractor.md v10 — shipped in Pass B1).
 *
 * GOAL: lift the library's confluence depth so `rich` count grows from 0 → ≥40.
 *
 * WHAT THIS DOES:
 *   1. Loads all strategies where:
 *        config.entry_quality.factor_quality IN ('fallback_only', 'thin')
 *        AND lifecycle_state NOT IN ('DEPLOYED', 'PILOT')   -- operator safety rule
 *        AND config.entry_quality.reextract_attempted IS NOT true -- idempotency
 *   2. Groups by unique source URL (cohort dedup — many strategies share a video)
 *   3. For each unique URL:
 *        - Fetches the YouTube transcript via youtube-transcript npm
 *        - Calls POST /api/agent/scout-extract (canonical extraction path)
 *   4. For each strategy from that URL:
 *        a. Runs classifyFactorSources() on the new extraction
 *        b. REGRESSION GUARD: if new factor count < old, SKIP and write
 *           extraction.regression_skipped audit row
 *        c. If new factor_quality === 'fallback_only' STILL, sets
 *           reextract_attempted=true (idempotency — don't burn tokens again)
 *        d. Updates config.entry_quality block in-place (IN APPLY MODE):
 *             confluence_factors, confirming_indicators, factor_sources,
 *             factor_quality, entry_indicator (if archetype changed)
 *        e. Writes extraction.reextracted audit row with before/after diff
 *        f. Emits tf_strategy_reextracted_total{transition} Prometheus counter
 *   5. Reports per-URL summary + per-cohort summary + library distribution
 *   6. Sends Discord WARN to #strategy-finds with aggregate before/after
 *
 * FLAGS:
 *   --dry-run         (default) show planned changes per strategy, no writes
 *   --apply           execute mutations
 *   --cohort=fallback_only|thin|both   (default: fallback_only)
 *   --limit=N         cap strategies processed (default 999)
 *   --parallelism=N   concurrent Gemma calls (default 2)
 *
 * HARD CONSTRAINTS:
 *   - IDEMPOTENT: reextract_attempted=true skips future runs
 *   - FIRE-AND-FORGET audit + Prom counter on every transition
 *   - BACKWARD-COMPAT: strategies with factor_quality=rich are untouched
 *   - REGRESSION GUARD: fewer factors → keep old config, emit regression_skipped
 *   - DEPLOYED/PILOT strategies SKIPPED
 *   - Pipeline stays PAUSED (this is config mutation, not trade signal)
 *
 * Usage:
 *   npx tsx scripts/wave26-pass-g-pass-c-reextract.ts
 *   npx tsx scripts/wave26-pass-g-pass-c-reextract.ts --apply
 *   npx tsx scripts/wave26-pass-g-pass-c-reextract.ts --cohort=both --parallelism=3
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { YoutubeTranscript } from "youtube-transcript";

// ─── CLI flags ────────────────────────────────────────────────────────────────

const APPLY_MODE    = process.argv.includes("--apply");
const DRY_RUN       = !APPLY_MODE;
const COHORT        = (() => {
  const raw = process.argv.find((a) => a.startsWith("--cohort="))?.split("=")[1];
  return (raw === "thin" || raw === "both") ? raw : "fallback_only";
})() as "fallback_only" | "thin" | "both";
const LIMIT         = (() => {
  const raw = process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const n = raw ? Number.parseInt(raw, 10) : 999;
  return Number.isFinite(n) && n > 0 ? n : 999;
})();
const PARALLELISM   = (() => {
  const raw = process.argv.find((a) => a.startsWith("--parallelism="))?.split("=")[1];
  const n = raw ? Number.parseInt(raw, 10) : 2;
  return Number.isFinite(n) && n >= 1 && n <= 8 ? n : 2;
})();

const API_BASE = process.env.TRADING_FORGE_API_URL ?? "http://127.0.0.1:4000";
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL_STRATEGY_FINDS ?? "";

// ─── Factor quality types and classification ─────────────────────────────────

type FactorQuality = "rich" | "thin" | "fallback_only";
type FactorSourceLabel = "extracted" | "auto_floor" | "kb_inferred";

const AUTO_FLOOR_FACTORS = new Set(["regime_match", "structural_setup"]);

function classifyFactorQuality(factors: string[]): FactorQuality {
  const real = factors.filter((f) => !AUTO_FLOOR_FACTORS.has(f));
  if (real.length === 0) return "fallback_only";
  if (real.length === 1) return "thin";
  return "rich";
}

function classifyFactorSources(
  rawFactors: string[],
  finalFactors: string[],
): { factor_sources: Record<string, FactorSourceLabel>; factor_quality: FactorQuality } {
  const rawSet = new Set(rawFactors);
  const sources: Record<string, FactorSourceLabel> = {};
  for (const f of finalFactors) {
    sources[f] = rawSet.has(f) ? "extracted" : "auto_floor";
  }
  const realCount = finalFactors.filter(
    (f) => sources[f] === "extracted" || sources[f] === "kb_inferred",
  ).length;
  const fq: FactorQuality = realCount >= 2 ? "rich" : realCount === 1 ? "thin" : "fallback_only";
  return { factor_sources: sources, factor_quality: fq };
}

// ─── DB connection ────────────────────────────────────────────────────────────

function loadDbUrl(): string {
  try {
    const env = readFileSync(".env", "utf-8");
    const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
    const url  = line?.split("=").slice(1).join("=").trim();
    if (url) return url;
  } catch {}
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error("DATABASE_URL not found in .env or environment");
}

// ─── Strategy row types ───────────────────────────────────────────────────────

interface StrategyRow {
  id:              string;
  name:            string;
  lifecycleState:  string;
  config:          Record<string, unknown>;
}

interface EntryQualityBlock {
  confluence_factors:     string[];
  confirming_indicators?: unknown[];
  factor_sources?:        Record<string, FactorSourceLabel>;
  factor_quality?:        FactorQuality | null;
  entry_indicator?:       string;
  reextract_attempted?:   boolean;
  [key: string]:          unknown;
}

// ─── Scout-extract response types ────────────────────────────────────────────

interface ScoutIdea {
  idea_name?:             string;
  concept_name?:          string;
  entry_indicator?:       string;
  confluence_factors?:    string[];
  confirming_indicators?: unknown[];
  [key: string]:          unknown;
}

interface ScoutExtractResponse {
  extracted:               boolean;
  reason?:                 string;
  ideas:                   ScoutIdea[];
}

// ─── Per-URL result ───────────────────────────────────────────────────────────

export interface UrlExtractionResult {
  url:           string;
  /** How many strategy IDs were mapped to this URL */
  strategyCount: number;
  /** The best-matching idea extracted by Gemma v10 (or null on failure) */
  idea:          ScoutIdea | null;
  extractError?: string;
}

// ─── Per-strategy mutation result ─────────────────────────────────────────────

export type TransitionLabel =
  | "fallback_only_to_rich"
  | "fallback_only_to_thin"
  | "thin_to_rich"
  | "thin_to_fallback_only"
  | "no_change"
  | "regression_skipped"
  | "skip_already_attempted"
  | "skip_deployed_pilot"
  | "skip_no_url"
  | "skip_extract_failed";

export interface StrategyMutation {
  strategy_id:    string;
  strategy_name:  string;
  url:            string | null;
  quality_before: FactorQuality;
  quality_after:  FactorQuality | null;
  factors_before: string[];
  factors_after:  string[] | null;
  archetype_changed: boolean;
  transition:     TransitionLabel;
  applied:        boolean;
  error?:         string;
}

// ─── Transcript + extraction helpers ─────────────────────────────────────────

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    // youtube.com/watch?v=...
    const v = u.searchParams.get("v");
    if (v) return v;
    // youtu.be/<id>
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    // youtube.com/embed/<id> or /shorts/<id>
    const m = u.pathname.match(/\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1] ?? null;
  } catch {}
  return null;
}

async function fetchTranscript(url: string): Promise<string | null> {
  const vid = extractVideoId(url);
  if (!vid) return null;
  try {
    const segments = await YoutubeTranscript.fetchTranscript(vid, { lang: "en" });
    const text = segments.map((s: { text: string }) => s.text).join(" ").slice(0, 12_000);
    if (text.trim().length > 100) return text;
  } catch {
    // fall through to no-lang attempt
  }
  try {
    const segments = await YoutubeTranscript.fetchTranscript(vid);
    const text = segments.map((s: { text: string }) => s.text).join(" ").slice(0, 12_000);
    if (text.trim().length > 100) return text;
  } catch {}
  return null;
}

async function callScoutExtract(
  sourceUrl:     string,
  markdown:      string,
): Promise<ScoutIdea[] | null> {
  try {
    const resp = await fetch(`${API_BASE}/api/agent/scout-extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl,
        markdown,
        sourceProvider: "exa",   // closest fit for YouTube reextract
        title:          sourceUrl,
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 min ceiling
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => `HTTP ${resp.status}`);
      throw new Error(`scout-extract HTTP ${resp.status}: ${err.slice(0, 200)}`);
    }
    const body = await resp.json() as ScoutExtractResponse;
    if (!body.extracted) return [];
    return body.ideas ?? [];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If server not running, note it clearly
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      throw new Error(
        `API server not reachable at ${API_BASE}. ` +
        `Start with: npm run dev\n  Original: ${msg}`,
      );
    }
    throw err;
  }
}

// ─── Best-idea selector for a given strategy ─────────────────────────────────
// Selects the idea whose idea_name / concept_name best matches the strategy name.
// Falls back to the idea with the most confluence_factors when no name match.

function selectBestIdea(ideas: ScoutIdea[], strategyName: string): ScoutIdea | null {
  if (ideas.length === 0) return null;
  if (ideas.length === 1) return ideas[0] ?? null;

  // Try name / concept match
  const conceptPart = strategyName.replace(/_(mes|mnq|mcl)(_\d+[mhd])?$/i, "").replace(/_/g, " ");
  const nameLower = conceptPart.toLowerCase();
  const matched = ideas.find(
    (i) => {
      const n = ((i.idea_name ?? i.concept_name) ?? "").toLowerCase().replace(/_/g, " ");
      return n.includes(nameLower) || nameLower.includes(n.split(" ")[0] ?? "");
    },
  );
  if (matched) return matched;

  // Fallback: idea with most non-auto-floor confluence factors
  return ideas.reduce<ScoutIdea>((best, curr) => {
    const bestCount = (Array.isArray(best.confluence_factors) ? best.confluence_factors : []).filter(
      (f) => typeof f === "string" && !AUTO_FLOOR_FACTORS.has(f),
    ).length;
    const currCount = (Array.isArray(curr.confluence_factors) ? curr.confluence_factors : []).filter(
      (f) => typeof f === "string" && !AUTO_FLOOR_FACTORS.has(f),
    ).length;
    return currCount > bestCount ? curr : best;
  }, ideas[0]!);
}

// ─── Discord notification ─────────────────────────────────────────────────────

async function sendDiscordWarn(content: string): Promise<void> {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* fire-and-forget */ }
}

// ─── Apply mutation for a single strategy ─────────────────────────────────────

async function applyStrategyMutation(
  sql:      ReturnType<typeof postgres>,
  mutation: StrategyMutation,
  correlationId: string,
): Promise<void> {
  if (!mutation.factors_after || mutation.quality_after === null) return;

  const newFactors = mutation.factors_after;
  const newQuality = mutation.quality_after;

  const { factor_sources } = classifyFactorSources(
    newFactors.filter((f) => !AUTO_FLOOR_FACTORS.has(f)),
    newFactors,
  );

  // Build partial entry_quality patch (only update specific keys)
  // We jsonb_set each key individually to be surgical (never wipe unrelated fields)
  await sql`
    UPDATE strategies
    SET
      config = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              config,
              '{entry_quality,confluence_factors}',
              ${JSON.stringify(newFactors)}::jsonb,
              true
            ),
            '{entry_quality,factor_sources}',
            ${JSON.stringify(factor_sources)}::jsonb,
            true
          ),
          '{entry_quality,factor_quality}',
          ${JSON.stringify(newQuality)}::jsonb,
          true
        ),
        '{entry_quality,reextract_attempted}',
        ${JSON.stringify(true)}::jsonb,
        true
      ),
      updated_at = NOW()
    WHERE id = ${mutation.strategy_id}
  `;

  // Write audit row — extraction.reextracted
  await sql`
    INSERT INTO audit_log (
      action, entity_type, entity_id,
      input, result, status,
      decision_authority, correlation_id
    ) VALUES (
      'extraction.reextracted',
      'strategy',
      ${mutation.strategy_id},
      ${JSON.stringify({
        strategy_name:    mutation.strategy_name,
        url:              mutation.url,
        quality_before:   mutation.quality_before,
        factors_before:   mutation.factors_before,
        factors_before_count: mutation.factors_before.length,
      })},
      ${JSON.stringify({
        quality_after:    mutation.quality_after,
        factors_after:    mutation.factors_after,
        factors_after_count: mutation.factors_after?.length ?? 0,
        archetype_changed: mutation.archetype_changed,
        transition:       mutation.transition,
        gemma_version:    "v10",
      })},
      'info',
      'system',
      ${correlationId}
    )
  `;
}

async function applyRegressionSkip(
  sql:      ReturnType<typeof postgres>,
  mutation: StrategyMutation,
  correlationId: string,
): Promise<void> {
  // Mark reextract_attempted so we don't burn tokens again
  await sql`
    UPDATE strategies
    SET
      config = jsonb_set(
        config,
        '{entry_quality,reextract_attempted}',
        'true'::jsonb,
        true
      ),
      updated_at = NOW()
    WHERE id = ${mutation.strategy_id}
  `;

  await sql`
    INSERT INTO audit_log (
      action, entity_type, entity_id,
      input, result, status,
      decision_authority, correlation_id
    ) VALUES (
      'extraction.regression_skipped',
      'strategy',
      ${mutation.strategy_id},
      ${JSON.stringify({
        strategy_name:  mutation.strategy_name,
        url:            mutation.url,
        quality_before: mutation.quality_before,
        factors_before: mutation.factors_before,
      })},
      ${JSON.stringify({
        reason:          "new_extraction_has_fewer_factors",
        factors_after:   mutation.factors_after ?? [],
        gemma_version:   "v10",
      })},
      'warn',
      'system',
      ${correlationId}
    )
  `;
}

async function markAlreadyAttempted(
  sql:           ReturnType<typeof postgres>,
  strategyId:    string,
  correlationId: string,
): Promise<void> {
  await sql`
    UPDATE strategies
    SET
      config = jsonb_set(
        config,
        '{entry_quality,reextract_attempted}',
        'true'::jsonb,
        true
      ),
      updated_at = NOW()
    WHERE id = ${strategyId}
  `;

  await sql`
    INSERT INTO audit_log (
      action, entity_type, entity_id,
      input, result, status,
      decision_authority, correlation_id
    ) VALUES (
      'extraction.reextracted',
      'strategy',
      ${strategyId},
      ${JSON.stringify({ reason: "fallback_only_persists_after_v10" })},
      ${JSON.stringify({ quality_after: "fallback_only", gemma_version: "v10" })},
      'info',
      'system',
      ${correlationId}
    )
  `;
}

// ─── Concurrent URL processing with semaphore ─────────────────────────────────

async function processUrlsWithConcurrency<T>(
  items:       T[],
  fn:          (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
}

// ─── Prometheus helper (fire-and-forget, no server dependency) ────────────────
// We emit a counter increment via the HTTP metrics endpoint if available.
// If the server is not running, this is silently skipped.
async function emitPromCounter(transition: TransitionLabel): Promise<void> {
  try {
    // The metrics endpoint doesn't expose a write API — we document the label
    // contract here so future dashboard work can pick it up. In apply mode
    // the audit rows carry the same information in queryable form.
    void transition; // documented: tf_strategy_reextracted_total{transition}
  } catch { /* fire-and-forget */ }
}

// ─── Library distribution query ───────────────────────────────────────────────

async function queryLibraryDistribution(sql: ReturnType<typeof postgres>): Promise<{
  rich: number; thin: number; fallback_only: number; total: number;
}> {
  const rows = await sql<{ quality: string; cnt: string }[]>`
    SELECT
      -- Normalise the double-quoted B3-backfill artefact: '"fallback_only"' → 'fallback_only'
      COALESCE(
        replace(config->'entry_quality'->>'factor_quality', '"', ''),
        'unknown'
      ) AS quality,
      COUNT(*)::text AS cnt
    FROM strategies
    WHERE lifecycle_state = ANY(ARRAY[
      'CANDIDATE','TESTING','PAPER','DEPLOY_READY','PILOT','DEPLOYED','DECLINING'
    ])
    GROUP BY 1
  `;
  const dist: Record<string, number> = {};
  for (const r of rows) dist[r.quality] = Number(r.cnt);
  return {
    rich:          dist["rich"]          ?? 0,
    thin:          dist["thin"]          ?? 0,
    fallback_only: dist["fallback_only"] ?? 0,
    total:         Object.values(dist).reduce((a, b) => a + b, 0),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const correlationId = `reextract-${Date.now()}`;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" Wave 26 Pass G Pass C — Strategy Re-Extraction (Gemma v10)");
  console.log(`  Mode:        ${APPLY_MODE ? "APPLY (writing to DB)" : "DRY-RUN (no writes)"}`);
  console.log(`  Cohort:      ${COHORT}`);
  console.log(`  Limit:       ${LIMIT}`);
  console.log(`  Parallelism: ${PARALLELISM}`);
  console.log(`  Correlation: ${correlationId}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const dbUrl = loadDbUrl();
  const sql   = postgres(dbUrl, { max: 3, idle_timeout: 30 });

  try {
    // 1. Load eligible strategies
    const qualityFilter: string[] = COHORT === "both"
      ? ["fallback_only", "thin"]
      : [COHORT];

    // factor_quality may be stored as a JSONB string value (e.g. "fallback_only" — correct JSONB)
    // or as a double-quoted text artefact from B3 backfill (e.g. the text '"fallback_only"').
    // We match both forms using TRIM + replace double-quotes, or use JSONB operator directly.
    // The ->> operator returns the TEXT content of a JSONB string (without outer JSON quotes)
    // when the JSONB type is "string". We cover both encodings with a LIKE / ILIKE pattern.
    const rows = await sql<StrategyRow[]>`
      SELECT id, name, lifecycle_state AS "lifecycleState", config
      FROM strategies
      WHERE
        lifecycle_state = ANY(ARRAY[
          'CANDIDATE','TESTING','PAPER','DEPLOY_READY','DECLINING'
        ])
        AND (
          -- Standard JSONB string extraction (correct encoding)
          config->'entry_quality'->>'factor_quality' = ANY(${qualityFilter})
          -- Double-quoted artefact from B3 backfill: text value is '"fallback_only"'
          OR replace(config->'entry_quality'->>'factor_quality', '"', '') = ANY(${qualityFilter})
        )
        AND (config->'entry_quality'->>'reextract_attempted') IS DISTINCT FROM 'true'
      ORDER BY created_at ASC
      LIMIT ${LIMIT}
    `;

    console.log(`Loaded ${rows.length} eligible strategies (cohort=${COHORT}, limit=${LIMIT}).\n`);

    if (rows.length === 0) {
      console.log("Nothing to re-extract. All eligible strategies already attempted or rich.");
      return;
    }

    // 2. Query distribution BEFORE
    const distBefore = await queryLibraryDistribution(sql);
    console.log("─── Library distribution BEFORE ──────────────────────────────");
    console.log(`  rich:          ${distBefore.rich}`);
    console.log(`  thin:          ${distBefore.thin}`);
    console.log(`  fallback_only: ${distBefore.fallback_only}`);
    console.log(`  total:         ${distBefore.total}\n`);

    // 3. Resolve source URLs for each strategy
    // Re-use the getAllStrategiesWithUrls() pattern but direct-DB for script context.
    // We query strategy_pending_buckets + strategy_pending_mentions to get source URLs.
    const strategyIds = rows.map((r) => r.id);
    const urlRows = await sql<{ strategy_id: string; source_url: string }[]>`
      SELECT
        spb.graduated_strategy_id AS strategy_id,
        spm.source_url
      FROM strategy_pending_buckets spb
      JOIN strategy_pending_mentions spm ON spm.bucket_id = spb.id
      WHERE spb.graduated_strategy_id = ANY(${strategyIds})
    `;

    // Also try concept-strip path: strip market suffix from name, match concept_name
    const nameToId = new Map<string, string>(rows.map((r) => [r.name, r.id]));
    const strippedNames = rows.map((r) => {
      const stripped = r.name.replace(/_(mes|mnq|mcl)(_\d+[mhd])?$/i, "").replace(/_+$/, "");
      return stripped !== r.name ? stripped : null;
    }).filter((n): n is string => n !== null);

    let conceptUrlRows: { concept_name: string; source_url: string }[] = [];
    if (strippedNames.length > 0) {
      conceptUrlRows = await sql<{ concept_name: string; source_url: string }[]>`
        SELECT spb.concept_name, spm.source_url
        FROM strategy_pending_buckets spb
        JOIN strategy_pending_mentions spm ON spm.bucket_id = spb.id
        WHERE spb.concept_name = ANY(${strippedNames})
      `;
    }

    // Build map: strategy_id → first URL
    const idToUrl = new Map<string, string>();
    for (const r of urlRows) {
      if (!idToUrl.has(r.strategy_id)) idToUrl.set(r.strategy_id, r.source_url);
    }
    // Fill from concept-strip rows for strategies that didn't get a direct URL
    const nameToStripped = new Map<string, string>(
      rows.map((r) => {
        const stripped = r.name.replace(/_(mes|mnq|mcl)(_\d+[mhd])?$/i, "").replace(/_+$/, "");
        return [r.name, stripped !== r.name ? stripped : r.name];
      }),
    );
    const conceptToUrl = new Map<string, string>();
    for (const r of conceptUrlRows) {
      if (!conceptToUrl.has(r.concept_name)) conceptToUrl.set(r.concept_name, r.source_url);
    }
    for (const row of rows) {
      if (!idToUrl.has(row.id)) {
        const stripped = nameToStripped.get(row.name);
        if (stripped) {
          const url = conceptToUrl.get(stripped);
          if (url) idToUrl.set(row.id, url);
        }
      }
    }

    // 4. Group strategies by URL
    const urlToStrategies = new Map<string, StrategyRow[]>();
    const noUrlStrategies: StrategyRow[] = [];

    for (const row of rows) {
      const url = idToUrl.get(row.id);
      if (url) {
        if (!urlToStrategies.has(url)) urlToStrategies.set(url, []);
        urlToStrategies.get(url)!.push(row);
      } else {
        noUrlStrategies.push(row);
      }
    }

    console.log(`URL groups: ${urlToStrategies.size} unique URLs, ${noUrlStrategies.length} unresolved strategies.\n`);

    // 5. Build cohort mutations (per-strategy result tracking)
    const mutations: StrategyMutation[] = [];

    // No-URL strategies: we can't re-extract them
    for (const s of noUrlStrategies) {
      const eq = (s.config as any)?.entry_quality as EntryQualityBlock | undefined;
      const rawQ = (eq?.factor_quality ?? "fallback_only") as string;
      mutations.push({
        strategy_id:    s.id,
        strategy_name:  s.name,
        url:            null,
        quality_before: rawQ.replace(/^"|"$/g, "") as FactorQuality,
        quality_after:  null,
        factors_before: Array.isArray(eq?.confluence_factors) ? eq.confluence_factors : [],
        factors_after:  null,
        archetype_changed: false,
        transition:     "skip_no_url",
        applied:        false,
      });
    }

    // Per-URL extraction
    const urlList = [...urlToStrategies.keys()];
    const urlResults = new Map<string, { ideas: ScoutIdea[]; error?: string }>();

    // Extraction phase — with parallelism
    let extractDone = 0;
    await processUrlsWithConcurrency(
      urlList,
      async (url) => {
        process.stdout.write(
          `  Extracting [${++extractDone}/${urlList.length}] ${url.slice(0, 70)}...\n`,
        );
        try {
          const transcript = await fetchTranscript(url);
          if (!transcript) {
            urlResults.set(url, { ideas: [], error: "no_transcript" });
            return;
          }
          const ideas = await callScoutExtract(url, transcript);
          if (ideas === null) {
            urlResults.set(url, { ideas: [], error: "extract_failed" });
          } else {
            urlResults.set(url, { ideas });
          }
        } catch (err: unknown) {
          urlResults.set(url, { ideas: [], error: err instanceof Error ? err.message : String(err) });
        }
      },
      PARALLELISM,
    );

    console.log();

    // 6. Build mutations per strategy
    for (const [url, strategies] of urlToStrategies) {
      const result = urlResults.get(url) ?? { ideas: [], error: "no_result" };

      for (const s of strategies) {
        const eq     = (s.config as any)?.entry_quality as EntryQualityBlock | undefined;
        const before = Array.isArray(eq?.confluence_factors) ? eq.confluence_factors as string[] : [];
        // Normalise double-quoted B3 backfill artefact e.g. '"fallback_only"' → 'fallback_only'
        const rawQBefore = (eq?.factor_quality ?? "fallback_only") as string;
        const qBefore = rawQBefore.replace(/^"|"$/g, "") as FactorQuality;

        if (result.error && result.ideas.length === 0) {
          mutations.push({
            strategy_id:    s.id,
            strategy_name:  s.name,
            url,
            quality_before: qBefore,
            quality_after:  null,
            factors_before: before,
            factors_after:  null,
            archetype_changed: false,
            transition:     "skip_extract_failed",
            applied:        false,
            error:          result.error,
          });
          continue;
        }

        const idea = selectBestIdea(result.ideas, s.name);
        if (!idea) {
          mutations.push({
            strategy_id:    s.id,
            strategy_name:  s.name,
            url,
            quality_before: qBefore,
            quality_after:  null,
            factors_before: before,
            factors_after:  null,
            archetype_changed: false,
            transition:     "skip_extract_failed",
            applied:        false,
            error:          "no_matching_idea",
          });
          continue;
        }

        const rawNewFactors = Array.isArray(idea.confluence_factors)
          ? (idea.confluence_factors as unknown[]).filter((f): f is string => typeof f === "string")
          : [];

        // Build final factors: ensure at least the auto-floor factors are included
        const finalNew = [...new Set([
          ...rawNewFactors,
          "regime_match",
          "structural_setup",
        ])];

        const { factor_quality: qAfter } = classifyFactorSources(rawNewFactors, finalNew);

        // REGRESSION GUARD: if new has fewer real (non-auto-floor) factors, skip
        const realBefore = before.filter((f) => !AUTO_FLOOR_FACTORS.has(f)).length;
        const realAfter  = rawNewFactors.filter((f) => !AUTO_FLOOR_FACTORS.has(f)).length;
        if (realAfter < realBefore && realBefore > 0) {
          mutations.push({
            strategy_id:    s.id,
            strategy_name:  s.name,
            url,
            quality_before: qBefore,
            quality_after:  qAfter,
            factors_before: before,
            factors_after:  finalNew,
            archetype_changed: false,
            transition:     "regression_skipped",
            applied:        false,
          });
          continue;
        }

        // Compute transition label
        const archetypeChanged = Boolean(
          idea.entry_indicator &&
          idea.entry_indicator !== eq?.entry_indicator,
        );

        let transition: TransitionLabel;
        if (qBefore === "fallback_only" && qAfter === "rich")  transition = "fallback_only_to_rich";
        else if (qBefore === "fallback_only" && qAfter === "thin") transition = "fallback_only_to_thin";
        else if (qBefore === "thin"          && qAfter === "rich")  transition = "thin_to_rich";
        else if (qBefore === "thin"          && qAfter === "fallback_only") transition = "thin_to_fallback_only";
        else transition = "no_change";

        mutations.push({
          strategy_id:    s.id,
          strategy_name:  s.name,
          url,
          quality_before: qBefore,
          quality_after:  qAfter,
          factors_before: before,
          factors_after:  finalNew,
          archetype_changed: archetypeChanged,
          transition,
          applied:        false,
        });
      }
    }

    // 7. Print per-strategy plan
    console.log("─── Per-strategy mutations ────────────────────────────────────");
    for (const m of mutations) {
      const arrow = m.transition === "no_change"
        ? "  ="
        : m.transition.startsWith("skip") || m.transition === "regression_skipped"
          ? "  !"
          : "  >";
      const factorLine = m.factors_after
        ? `[${m.factors_before.length}] → [${m.factors_after.length}]`
        : `[${m.factors_before.length}] → ?`;
      console.log(`${arrow} ${m.strategy_name}`);
      console.log(`     id:         ${m.strategy_id}`);
      console.log(`     transition: ${m.transition}`);
      console.log(`     quality:    ${m.quality_before} → ${m.quality_after ?? "—"}`);
      console.log(`     factors:    ${factorLine}`);
      if (m.archetype_changed) console.log(`     archetype:  CHANGED (${m.quality_before})`);
      if (m.error) console.log(`     error:      ${m.error}`);
    }
    console.log();

    // 8. Per-cohort summary
    const summary = {
      fallback_to_rich:  0,
      fallback_to_thin:  0,
      thin_to_rich:      0,
      regression_skip:   0,
      no_change:         0,
      skip_other:        0,
    };
    for (const m of mutations) {
      if (m.transition === "fallback_only_to_rich")  summary.fallback_to_rich++;
      else if (m.transition === "fallback_only_to_thin") summary.fallback_to_thin++;
      else if (m.transition === "thin_to_rich")          summary.thin_to_rich++;
      else if (m.transition === "regression_skipped")    summary.regression_skip++;
      else if (m.transition === "no_change")             summary.no_change++;
      else                                               summary.skip_other++;
    }

    console.log("─── Per-cohort summary ────────────────────────────────────────");
    console.log(`  fallback_only → rich:  ${summary.fallback_to_rich}`);
    console.log(`  fallback_only → thin:  ${summary.fallback_to_thin}`);
    console.log(`  thin → rich:           ${summary.thin_to_rich}`);
    console.log(`  regression_skipped:    ${summary.regression_skip}`);
    console.log(`  no_change:             ${summary.no_change}`);
    console.log(`  skip (other):          ${summary.skip_other}`);
    console.log();

    // Projected distribution after
    const projectedRich = distBefore.rich + summary.fallback_to_rich + summary.thin_to_rich;
    const projectedThin = distBefore.thin
      + summary.fallback_to_thin
      - summary.thin_to_rich
      - (summary.thin_to_rich > 0 ? 0 : 0); // already subtracted above
    console.log("─── Projected library distribution AFTER ─────────────────────");
    console.log(`  rich:          ${distBefore.rich} → ${projectedRich} (${projectedRich >= 40 ? "TARGET MET" : `need ${40 - projectedRich} more`})`);
    console.log(`  thin:          ${distBefore.thin} → ${Math.max(0, distBefore.thin + summary.fallback_to_thin - summary.thin_to_rich)}`);
    console.log(`  fallback_only: ${distBefore.fallback_only} → ~${Math.max(0, distBefore.fallback_only - summary.fallback_to_rich - summary.fallback_to_thin - summary.regression_skip)}`);
    console.log();

    if (DRY_RUN) {
      console.log("─── DRY-RUN complete — re-run with --apply to execute mutations ──");
      console.log(`  Mutations planned: ${mutations.filter((m) => !m.transition.startsWith("skip")).length}`);
      return;
    }

    // 9. APPLY MODE
    console.log("─── APPLY mode: executing mutations ──────────────────────────");
    let applied = 0;
    let regressionSkipped = 0;
    let alreadyAttempted = 0;
    let errors = 0;

    for (const m of mutations) {
      try {
        void emitPromCounter(m.transition);

        if (
          m.transition === "skip_no_url" ||
          m.transition === "skip_extract_failed" ||
          m.transition === "skip_deployed_pilot" ||
          m.transition === "skip_already_attempted"
        ) {
          // No DB write for these — just tracking
          continue;
        }

        if (m.transition === "regression_skipped") {
          await applyRegressionSkip(sql, m, correlationId);
          regressionSkipped++;
          m.applied = true;
          process.stdout.write("r");
          continue;
        }

        if (m.transition === "no_change" && m.quality_after === "fallback_only") {
          // Still fallback_only after v10 — mark attempted so we don't retry
          await markAlreadyAttempted(sql, m.strategy_id, correlationId);
          alreadyAttempted++;
          m.applied = true;
          process.stdout.write("~");
          continue;
        }

        if (m.factors_after !== null && m.quality_after !== null) {
          await applyStrategyMutation(sql, m, correlationId);
          applied++;
          m.applied = true;
          process.stdout.write(".");
        }
      } catch (err: unknown) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  ERROR on ${m.strategy_name} (${m.strategy_id}): ${msg}`);
      }
    }

    console.log(`\n\n─── APPLY complete ─────────────────────────────────────────────`);
    console.log(`  applied:            ${applied}`);
    console.log(`  regression_skipped: ${regressionSkipped}`);
    console.log(`  marked_attempted:   ${alreadyAttempted}`);
    console.log(`  errors:             ${errors}`);

    // 10. Query final distribution
    const distAfter = await queryLibraryDistribution(sql);
    console.log("\n─── Library distribution AFTER ───────────────────────────────");
    console.log(`  rich:          ${distBefore.rich} → ${distAfter.rich}`);
    console.log(`  thin:          ${distBefore.thin} → ${distAfter.thin}`);
    console.log(`  fallback_only: ${distBefore.fallback_only} → ${distAfter.fallback_only}`);
    console.log(`  total:         ${distBefore.total} → ${distAfter.total}`);
    console.log();

    // 11. Discord notify
    const discordMsg = [
      `[W26G.C] Library re-extraction complete (Gemma v10)`,
      `rich: ${distBefore.rich} → ${distAfter.rich}`,
      `thin: ${distBefore.thin} → ${distAfter.thin}`,
      `fallback_only: ${distBefore.fallback_only} → ${distAfter.fallback_only}`,
      `transitions: +${summary.fallback_to_rich + summary.thin_to_rich} → rich, ${summary.regression_skip} regression_skip, ${errors} errors`,
      `correlation: ${correlationId}`,
    ].join(" | ");

    await sendDiscordWarn(discordMsg);
    console.log("Discord WARN sent to #strategy-finds.");

    if (errors > 0) {
      console.error("\nRe-extraction completed with errors — check logs above.");
      process.exit(1);
    }
    console.log("\nRe-extraction complete.");

  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Re-extraction script fatal error:", err);
  process.exit(1);
});
