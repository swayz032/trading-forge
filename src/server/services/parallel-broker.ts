/**
 * Parallel.ai Broker — Pass 20 Layer 1 Web Discovery
 *
 * Wraps Parallel.ai task submission + polling into a single async call.
 * Uses the proven 5-property schema (name, concept, entry_rule, exit_rule,
 * source_url, timeframe) — empirically validated to return 3 real strategies
 * per query from tradingsim.com, tradethatswing.com, bullishbears.com.
 *
 * Design:
 *   - Fail-OPEN at this discovery layer. Never throws — returns [] on any error.
 *     Discovery is opportunistic; a Parallel.ai outage must not block the pipeline.
 *   - Polls every 10 seconds, up to 6 minutes (36 polls).
 *   - Auth via PARALLEL_API_KEY env (already in .env).
 *   - Returns raw strategy objects as-is; callers filter/transform.
 *
 * Per production mandate: does NOT pass slippage/fees to vectorbt — not
 * applicable here (this service does web discovery, not backtesting).
 */

import { logger } from "../index.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParallelDiscoveredStrategy {
  name: string;
  concept: string;
  entry_rule: string;
  exit_rule: string;
  source_url: string;
  timeframe: string;
}

interface ParallelTaskRunResponse {
  /** Parallel.ai uses run_id, not id */
  run_id?: string;
  id?: string; // legacy alias — accept both
  status: "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: {
    output?: {
      content?: {
        strategies?: unknown[];
      };
      strategies?: unknown[]; // some API versions surface at output level
    };
    strategies?: unknown[]; // defensive: accept at result level too
  };
  /** Parallel.ai may put the output directly at top level */
  strategies?: unknown[];
  output?: {
    strategies?: unknown[];
    content?: { strategies?: unknown[] };
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** 5-property schema — proven to work empirically (Pass 20 operator validation). */
const PARALLEL_SCHEMA = {
  type: "object",
  properties: {
    strategies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:        { type: "string", description: "Strategy name (e.g. Opening Range Breakout)" },
          concept:     { type: "string", description: "One-sentence concept description" },
          entry_rule:  { type: "string", description: "Entry rule summary" },
          exit_rule:   { type: "string", description: "Exit rule summary" },
          source_url:  { type: "string", description: "Article or page URL where this strategy was found" },
          timeframe:   { type: "string", description: "Trading timeframe (e.g. 5m, 15m, 1h)" },
        },
        required: ["name", "concept", "source_url"],
      },
    },
  },
  required: ["strategies"],
};

const PARALLEL_API_BASE  = "https://api.parallel.ai/v1";
const POLL_INTERVAL_MS   = 10_000; // 10 seconds
const MAX_POLLS          = 36;     // 6 minutes total
const SUBMIT_TIMEOUT_MS  = 15_000;
const POLL_TIMEOUT_MS    = 10_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getParallelApiKey(): string | null {
  return process.env.PARALLEL_API_KEY ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submit a discovery task to Parallel.ai.
 * Returns the task run ID or null on failure.
 */
async function submitParallelTask(query: string, apiKey: string): Promise<string | null> {
  // Parallel.ai API requires `input` (string), not `messages` array.
  // The output_schema drives structured JSON extraction from web search results.
  const input = `Search the web for named futures trading strategies related to: ${query}

For each NAMED trading strategy you find in web articles and pages, extract:
1. The strategy's exact name (preserve capitalization)
2. A 1-sentence concept description of what the strategy does
3. The entry rule (brief — what triggers entry)
4. The exit rule (brief — what triggers exit)
5. The source URL where you found this strategy
6. The trading timeframe if mentioned (e.g. 5m, 15m, 1h)

Focus on strategies for futures markets (MES, ES, NQ, MNQ, MCL, CL).
Do NOT invent indicator periods or thresholds not mentioned in the source.
Return all named strategies you find.`;

  try {
    const res = await fetch(`${PARALLEL_API_BASE}/tasks/runs`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        processor:     "base",
        input,
        output_schema: PARALLEL_SCHEMA,
      }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "<read failed>");
      logger.warn({ status: res.status, errText }, "parallel-broker: task submission failed");
      return null;
    }

    const data = await res.json() as { run_id?: string; id?: string };
    // Parallel.ai uses run_id; accept id as legacy alias
    const taskId = data.run_id ?? data.id;
    if (!taskId) {
      logger.warn({ data }, "parallel-broker: submission response missing run_id/id");
      return null;
    }

    logger.info({ taskId, query }, "parallel-broker: task submitted");
    return taskId;
  } catch (err) {
    logger.warn({ err, query }, "parallel-broker: submission threw");
    return null;
  }
}

/**
 * Poll a Parallel.ai task run until completed, failed, or timeout.
 * Returns the full result response (from /tasks/runs/:id/result) or null.
 *
 * Actual Parallel.ai API shape (empirically discovered 2026-05-11):
 *   - Status endpoint: GET /tasks/runs/:run_id → { run_id, status, ... }
 *   - Result endpoint: GET /tasks/runs/:run_id/result → { run, output: { content: { output: "<JSON string>" } } }
 * The actual strategy data lives in output.content.output (a JSON string).
 */
async function pollParallelTask(
  taskId: string,
  apiKey: string,
): Promise<ParallelTaskRunResponse | null> {
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (poll > 0) {
      await sleep(POLL_INTERVAL_MS);
    }

    try {
      // Poll the status endpoint first
      const statusRes = await fetch(`${PARALLEL_API_BASE}/tasks/runs/${taskId}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });

      if (!statusRes.ok) {
        logger.warn({ taskId, status: statusRes.status, poll }, "parallel-broker: status poll failed");
        continue;
      }

      const statusData = await statusRes.json() as ParallelTaskRunResponse;
      logger.debug({ taskId, status: statusData.status, poll }, "parallel-broker: poll tick");

      if (statusData.status === "failed" || statusData.status === "cancelled") {
        logger.warn({ taskId, status: statusData.status, poll }, "parallel-broker: task terminated without success");
        return null;
      }

      if (statusData.status === "completed") {
        logger.info({ taskId, poll }, "parallel-broker: task completed — fetching result");
        // Fetch the actual result from the /result endpoint
        const resultRes = await fetch(`${PARALLEL_API_BASE}/tasks/runs/${taskId}/result`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });

        if (!resultRes.ok) {
          logger.warn({ taskId, status: resultRes.status }, "parallel-broker: result fetch failed");
          return null;
        }

        const resultData = await resultRes.json() as any;
        return resultData; // caller's extractStrategiesFromResult handles the shape
      }

      // status is queued | pending | running — continue polling
    } catch (err) {
      logger.warn({ err, taskId, poll }, "parallel-broker: poll threw (non-fatal, continuing)");
    }
  }

  logger.warn({ taskId }, "parallel-broker: poll timeout — exceeded 6 minutes");
  return null;
}

/**
 * Extract validated strategies from a completed Parallel.ai result.
 *
 * Actual API response shape (empirically discovered 2026-05-11):
 *   { run: {...}, output: { content: { output: "<JSON string>" }, basis: [...] } }
 *
 * The strategies are inside `output.content.output` as a JSON string:
 *   '{"strategies": [{name, concept, entry_rule, exit_rule, source_url, timeframe}]}'
 *
 * Tolerates missing or malformed fields — returns only well-shaped items.
 * Never throws.
 */
function extractStrategiesFromResult(
  result: any,
): ParallelDiscoveredStrategy[] {
  try {
    // Path 1: output.content.output is a JSON string (actual Parallel.ai format)
    const contentOutput = result?.output?.content?.output;
    if (typeof contentOutput === "string" && contentOutput.trim()) {
      try {
        const parsed = JSON.parse(contentOutput);
        const arr = parsed?.strategies;
        if (Array.isArray(arr)) {
          return normalizeStrategyArray(arr);
        }
        // Maybe the output IS the strategies array directly
        if (Array.isArray(parsed)) {
          return normalizeStrategyArray(parsed);
        }
      } catch {
        logger.debug({ contentOutput: contentOutput.slice(0, 200) }, "parallel-broker: output JSON parse failed");
      }
    }

    // Path 2: output.content.strategies is a direct array
    const contentStrategies = result?.output?.content?.strategies;
    if (Array.isArray(contentStrategies)) {
      return normalizeStrategyArray(contentStrategies);
    }

    // Path 3: result.result.output.content.strategies (older shape)
    const legacyStrategies = result?.result?.output?.content?.strategies;
    if (Array.isArray(legacyStrategies)) {
      return normalizeStrategyArray(legacyStrategies);
    }

    // Path 4: strategies at any top-level or nested location
    const topLevelStrategies = result?.strategies ?? result?.output?.strategies;
    if (Array.isArray(topLevelStrategies)) {
      return normalizeStrategyArray(topLevelStrategies);
    }

    logger.debug(
      { resultTopKeys: Object.keys(result ?? {}) },
      "parallel-broker: no strategies found in any known path",
    );
    return [];
  } catch (err) {
    logger.warn({ err }, "parallel-broker: extractStrategiesFromResult threw");
    return [];
  }
}

function normalizeStrategyArray(raw: unknown[]): ParallelDiscoveredStrategy[] {
  const out: ParallelDiscoveredStrategy[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;

    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name) continue;

    out.push({
      name,
      concept:    typeof s.concept     === "string" ? s.concept.trim()    : "",
      entry_rule: typeof s.entry_rule  === "string" ? s.entry_rule.trim() : "",
      exit_rule:  typeof s.exit_rule   === "string" ? s.exit_rule.trim()  : "",
      source_url: typeof s.source_url  === "string" ? s.source_url.trim() : "",
      timeframe:  typeof s.timeframe   === "string" ? s.timeframe.trim()  : "",
    });
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run a Parallel.ai web discovery task for a given trading strategy query.
 *
 * Returns an array of discovered strategy objects. Returns [] on any failure
 * (network error, API error, timeout, empty/malformed result) — NEVER throws.
 * Fail-OPEN: discovery is opportunistic; a Parallel.ai outage must not block
 * the rest of the pipeline.
 *
 * @param query  Human-readable query (e.g. "opening range breakout futures trading strategy")
 */
export async function runParallelDiscovery(
  query: string,
): Promise<ParallelDiscoveredStrategy[]> {
  const apiKey = getParallelApiKey();
  if (!apiKey) {
    logger.warn("parallel-broker: PARALLEL_API_KEY not set — skipping discovery");
    return [];
  }

  try {
    const taskId = await submitParallelTask(query, apiKey);
    if (!taskId) return [];

    const result = await pollParallelTask(taskId, apiKey);
    if (!result) return [];

    const strategies = extractStrategiesFromResult(result);
    logger.info({ query, count: strategies.length }, "parallel-broker: discovery complete");
    return strategies;
  } catch (err) {
    // Belt-and-suspenders: top-level catch ensures we never propagate.
    logger.error({ err, query }, "parallel-broker: runParallelDiscovery threw (returning [])");
    return [];
  }
}
