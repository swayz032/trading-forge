/**
 * W23H.8 — Head-start populate script.
 *
 * Fires 2–3 autonomous scout cycles through the live Trading Forge API to
 * graduate an initial library of ~20 strategies under FULL Wave 23H shape.
 * Intended to be run by the operator AFTER the wipe script (W23H.7) confirms
 * the bucket is empty.
 *
 * Usage:
 *   npx tsx scripts/headstart-populate-bucket.ts
 *
 * Prerequisites:
 *   - DATABASE_URL set and pointing at the correct DB instance
 *   - TRADING_FORGE_API_URL set (or defaults to http://localhost:4000)
 *   - API server running (wipe already confirmed; bucket empty)
 *   - Wave 23H tracks shipped (soft check via marker audit_log rows)
 *
 * The script fires at most MAX_CYCLES = 3 cycles, waiting DRAIN_WAIT_MS
 * (default 180 s) after each for the graduator to drain. It stops early
 * when totalGraduated >= EARLY_STOP_THRESHOLD (default 20).
 *
 * Pre-check 1 (hard): bucket must be empty (strategies count = 0).
 * Pre-check 2 (soft): Wave 23H marker audit_log rows — logged but non-blocking.
 *
 * API path: POST /api/admin/scout/run-autonomous-cycle
 * (adminRoutes mount: /api/admin, handler: /scout/run-autonomous-cycle)
 *
 * Token budget guardrail: cap at MAX_CYCLES = 3 to stay within the 1M
 * GPT-5-mini token daily Trading Forge cap (reference_openai_token_budget).
 */

import "dotenv/config";
import postgres from "postgres";

// ─── Configuration (exported for tests) ──────────────────────────────────────

export const MAX_CYCLES = 3;
export const EARLY_STOP_THRESHOLD = 20;
export const DRAIN_WAIT_MS = 180_000; // 180 s — graduator drain window

/** Wave 23H marker audit events. Missing ones are logged (soft — no hard refuse). */
export const WAVE23H_MARKER_ACTIONS = [
  "backtest.mtf_join_completed",           // W23H.1
  "playbook_router.routed",                // W23H.A
  "strategy.preferred_regimes_set",        // W23H.B
  "bias_engine.strategy_selected",         // W23H.C
  "signal.a_plus_factor_evaluated",        // W23H.D
  "sizing.confluence_multiplier_applied",  // W23H.4
  "pre_market_routine.completed",          // W23H.2
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FinalStats {
  total: number;
  withConfluence: number;   // confirming_indicators.length >= 2
  withMtf: number;          // bias_timeframe non-null
  bidirectional: number;    // direction = 'both'
  rangeBoundCapable: number; // 'RANGE_BOUND' in preferred_regimes
}

export interface CycleSummary {
  cycle: number;
  graduatedThisCycle: number;
  totalGraduated: number;
  apiStatusCode: number;
}

/** Dependency injection surface for tests */
export interface HeadstartDeps {
  /** Return count of current strategies in DB */
  countStrategies(): Promise<number>;
  /** Check whether a Wave 23H marker action exists in audit_log */
  checkMarkerAction(action: string): Promise<boolean>;
  /** Count before a cycle (strategies) */
  countStrategiesBefore(): Promise<number>;
  /** Fire a scout cycle, returning HTTP status code */
  fireScoutCycle(cycle: number): Promise<number>;
  /** Wait for the graduator to drain */
  waitForDrain(ms: number): Promise<void>;
  /** Count after a cycle */
  countStrategiesAfter(): Promise<number>;
  /** Collect final stats */
  getFinalStats(): Promise<FinalStats>;
  /** Emit an audit_log row */
  emitAudit(action: string, result: Record<string, unknown>): Promise<void>;
}

// ─── DB + Fetch based production deps ────────────────────────────────────────

export function makeProductionDeps(
  sql: postgres.Sql,
  apiUrl: string,
): HeadstartDeps {
  return {
    async countStrategies() {
      const rows = await sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM strategies`;
      return rows[0].n;
    },

    async checkMarkerAction(action: string) {
      const rows = await sql<[{ n: number }]>`
        SELECT COUNT(*)::int AS n FROM audit_log WHERE action = ${action} LIMIT 1
      `;
      return rows[0].n > 0;
    },

    async countStrategiesBefore() {
      const rows = await sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM strategies`;
      return rows[0].n;
    },

    async fireScoutCycle(cycle: number) {
      const resp = await fetch(`${apiUrl}/api/admin/scout/run-autonomous-cycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "headstart_populate", cycle }),
      });
      return resp.status;
    },

    async waitForDrain(ms: number) {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
    },

    async countStrategiesAfter() {
      const rows = await sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM strategies`;
      return rows[0].n;
    },

    async getFinalStats() {
      const rows = await sql<[{
        total: number;
        with_confluence: number;
        with_mtf: number;
        bidirectional: number;
        range_bound_capable: number;
      }]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE config->'entry_quality'->'confirming_indicators' IS NOT NULL
              AND jsonb_array_length(config->'entry_quality'->'confirming_indicators') >= 2
          )::int AS with_confluence,
          COUNT(*) FILTER (WHERE config->>'bias_timeframe' IS NOT NULL)::int AS with_mtf,
          COUNT(*) FILTER (WHERE config->>'direction' = 'both')::int AS bidirectional,
          COUNT(*) FILTER (
            WHERE preferred_regimes @> ARRAY['RANGE_BOUND']::text[]
          )::int AS range_bound_capable
        FROM strategies
      `;
      const r = rows[0];
      return {
        total: r.total,
        withConfluence: r.with_confluence,
        withMtf: r.with_mtf,
        bidirectional: r.bidirectional,
        rangeBoundCapable: r.range_bound_capable,
      };
    },

    async emitAudit(action: string, result: Record<string, unknown>) {
      await sql`
        INSERT INTO audit_log (action, entity_type, entity_id, result, status, decision_authority)
        VALUES (
          ${action},
          'system',
          NULL,
          ${sql.json(result as unknown as import("postgres").JSONValue)},
          'success',
          'system'
        )
      `;
    },
  };
}

// ─── Core logic (exported for tests) ─────────────────────────────────────────

/**
 * Run the head-start populate sequence against injected deps.
 * Returns the cycle summaries and final stats for assertions.
 */
export async function runHeadstart(deps: HeadstartDeps): Promise<{
  cyclesFired: number;
  cycleSummaries: CycleSummary[];
  finalStats: FinalStats;
}> {
  // ── Pre-check 1 (HARD): bucket must be empty ───────────────────────────────
  const existingCount = await deps.countStrategies();
  if (existingCount > 0) {
    const msg =
      `REFUSING: bucket has ${existingCount} strateg${existingCount === 1 ? "y" : "ies"}. ` +
      "Run wipe first:\n" +
      "  npx tsx scripts/wipe-strategy-bucket-fresh-start.ts --apply";
    console.error(msg);
    throw new Error(msg);
  }

  // ── Pre-check 2 (SOFT): Wave 23H marker events ─────────────────────────────
  console.log("Wave 23H marker audit events present (soft check):");
  for (const action of WAVE23H_MARKER_ACTIONS) {
    const present = await deps.checkMarkerAction(action);
    console.log(`  ${action}: ${present ? "present" : "not yet observed (Wave 23H may not have fired a cycle yet)"}`);
  }
  console.log("");

  // ── Cycle loop ─────────────────────────────────────────────────────────────
  let totalGraduated = 0;
  let cyclesFired = 0;
  const cycleSummaries: CycleSummary[] = [];

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    const before = await deps.countStrategiesBefore();

    console.log(`\n=== Cycle ${cycle}/${MAX_CYCLES} ===`);

    await deps.emitAudit("headstart_cycle.started", {
      cycle,
      strategies_before: before,
      timestamp: new Date().toISOString(),
    });

    const statusCode = await deps.fireScoutCycle(cycle);

    if (statusCode < 200 || statusCode >= 300) {
      console.error(
        `  Cycle ${cycle} returned HTTP ${statusCode}. Skipping drain wait — continuing to next cycle if any.`,
      );
      // Do not count this cycle toward graduation; still emit a completed audit
      const summary: CycleSummary = {
        cycle,
        graduatedThisCycle: 0,
        totalGraduated,
        apiStatusCode: statusCode,
      };
      cycleSummaries.push(summary);
      await deps.emitAudit("headstart_cycle.completed", {
        cycle,
        graduated_this_cycle: 0,
        total_graduated: totalGraduated,
        api_status_code: statusCode,
        timestamp: new Date().toISOString(),
      });
      cyclesFired++;
      continue;
    }

    console.log(`  Scout cycle started (HTTP ${statusCode}). Waiting ${DRAIN_WAIT_MS / 1000}s for graduator drain...`);
    await deps.waitForDrain(DRAIN_WAIT_MS);

    const after = await deps.countStrategiesAfter();
    const cycleGraduated = Math.max(0, after - before);
    totalGraduated = after;
    cyclesFired++;

    console.log(
      `  Cycle ${cycle}: +${cycleGraduated} new strategies (total: ${totalGraduated})`,
    );

    const summary: CycleSummary = {
      cycle,
      graduatedThisCycle: cycleGraduated,
      totalGraduated,
      apiStatusCode: statusCode,
    };
    cycleSummaries.push(summary);

    await deps.emitAudit("headstart_cycle.completed", {
      cycle,
      graduated_this_cycle: cycleGraduated,
      total_graduated: totalGraduated,
      api_status_code: statusCode,
      timestamp: new Date().toISOString(),
    });

    if (totalGraduated >= EARLY_STOP_THRESHOLD) {
      console.log(
        `  Reached target of ${EARLY_STOP_THRESHOLD} strategies — stopping early after cycle ${cycle}.`,
      );
      break;
    }
  }

  // ── Final report ───────────────────────────────────────────────────────────
  const finalStats = await deps.getFinalStats();

  console.log("\n=== Head-start summary ===");
  console.log(`  Cycles fired:               ${cyclesFired}/${MAX_CYCLES}`);
  console.log(`  Total strategies graduated: ${finalStats.total}`);
  console.log(`  With confluence (>=2 factors):  ${finalStats.withConfluence}`);
  console.log(`  With MTF (bias_timeframe set):  ${finalStats.withMtf}`);
  console.log(`  Bidirectional (direction=both): ${finalStats.bidirectional}`);
  console.log(`  Range-bound capable:            ${finalStats.rangeBoundCapable}`);

  await deps.emitAudit("bulk_headstart_populate.completed", {
    cycles_fired: cyclesFired,
    strategies_graduated: finalStats.total,
    with_confluence: finalStats.withConfluence,
    with_mtf: finalStats.withMtf,
    bidirectional: finalStats.bidirectional,
    range_bound_capable: finalStats.rangeBoundCapable,
    timestamp: new Date().toISOString(),
  });

  return { cyclesFired, cycleSummaries, finalStats };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const apiUrl = process.env.TRADING_FORGE_API_URL ?? "http://localhost:4000";
  console.log(`API URL: ${apiUrl}`);
  console.log(`DB URL: ${dbUrl.replace(/:[^:@]+@/, ":***@")}\n`);

  const sql = postgres(dbUrl);
  try {
    const deps = makeProductionDeps(sql, apiUrl);
    await runHeadstart(deps);
  } finally {
    await sql.end();
  }
}

// Only run main() when invoked directly (not imported by tests).
const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith("headstart-populate-bucket.ts") ||
    process.argv[1].endsWith("headstart-populate-bucket.js"));

if (isMain) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
