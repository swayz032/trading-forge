/**
 * wave10-backfill-risk-derived-sizing.ts — Wave 10 one-off backfill
 *
 * Transforms existing active strategies from `profit_tier_pyramid` →
 * `risk_derived_pyramid` position_size config, removing the static
 * `max_contracts` field that was causing sizing to be capped at the
 * graduation-time value (typically 6 from an LLM transcript literal).
 *
 * OPERATOR INSTRUCTIONS:
 *   DO NOT run this script until migration 0109 is applied.
 *   Run with:
 *     npx tsx scripts/wave10-backfill-risk-derived-sizing.ts
 *   Or via Railway:
 *     railway run npx tsx scripts/wave10-backfill-risk-derived-sizing.ts
 *
 * Idempotent: strategies already at type=risk_derived_pyramid are skipped.
 * Safe to re-run: each strategy gets one audit_log row per run (idempotency
 * is at the config level, not the audit_log level).
 *
 * Verification after run:
 *   SELECT id, name, config->'strategy'->'position_size' FROM strategies
 *   WHERE archived_at IS NULL;
 *   -- All rows should have type=risk_derived_pyramid and NO max_contracts field.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { isNull, eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL or DATABASE_PUBLIC_URL env var required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql);

// Framework defaults from CLAUDE.md §4 / framework-overlay.ts
const FRAMEWORK_DEFAULTS = {
  base_contracts_by_symbol: { MES: 4, MNQ: 1, MCL: 1 } as Record<string, number>,
  tier_increment: 2,
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 100,
};

interface PositionSizeConfig {
  type?: string;
  base_contracts?: number;
  tier_increment?: number;
  tier_threshold_dollars?: number;
  personal_dll_pct?: number;
  max_contracts?: number;
  target_risk_dollars?: number;
  [key: string]: unknown;
}

function transformPositionSize(
  ps: PositionSizeConfig,
  symbol: string,
): { transformed: PositionSizeConfig; diff: { removed: string[]; changed: Record<string, unknown> } } {
  const removed: string[] = [];
  const changed: Record<string, unknown> = {};

  const out: PositionSizeConfig = { ...ps };

  // Remove banned fields
  if ("max_contracts" in out) {
    removed.push(`max_contracts (was ${out.max_contracts})`);
    delete out.max_contracts;
  }
  if ("target_risk_dollars" in out) {
    removed.push(`target_risk_dollars (was ${out.target_risk_dollars})`);
    delete out.target_risk_dollars;
  }

  // Set type
  if (out.type !== "risk_derived_pyramid") {
    changed.type = { from: out.type, to: "risk_derived_pyramid" };
    out.type = "risk_derived_pyramid";
  }

  // Fill missing fields with framework defaults
  const defaultBase = FRAMEWORK_DEFAULTS.base_contracts_by_symbol[symbol?.toUpperCase()] ?? 1;
  if (out.base_contracts === undefined) {
    out.base_contracts = defaultBase;
    changed.base_contracts = { from: undefined, to: defaultBase };
  }
  if (out.tier_increment === undefined) {
    out.tier_increment = FRAMEWORK_DEFAULTS.tier_increment;
    changed.tier_increment = { from: undefined, to: FRAMEWORK_DEFAULTS.tier_increment };
  }
  if (out.tier_threshold_dollars === undefined) {
    out.tier_threshold_dollars = FRAMEWORK_DEFAULTS.tier_threshold_dollars;
    changed.tier_threshold_dollars = { from: undefined, to: FRAMEWORK_DEFAULTS.tier_threshold_dollars };
  }
  if (out.personal_dll_pct === undefined) {
    out.personal_dll_pct = FRAMEWORK_DEFAULTS.personal_dll_pct;
    changed.personal_dll_pct = { from: undefined, to: FRAMEWORK_DEFAULTS.personal_dll_pct };
  }
  if (out.max_risk_pct_per_trade === undefined) {
    (out as Record<string, unknown>).max_risk_pct_per_trade = FRAMEWORK_DEFAULTS.max_risk_pct_per_trade;
    changed.max_risk_pct_per_trade = { from: undefined, to: FRAMEWORK_DEFAULTS.max_risk_pct_per_trade };
  }
  if (out.liquidity_comfort_cap === undefined) {
    (out as Record<string, unknown>).liquidity_comfort_cap = FRAMEWORK_DEFAULTS.liquidity_comfort_cap;
    changed.liquidity_comfort_cap = { from: undefined, to: FRAMEWORK_DEFAULTS.liquidity_comfort_cap };
  }
  if (!("topstep_account_cap_override" in out)) {
    (out as Record<string, unknown>).topstep_account_cap_override = null;
  }
  if ((out as Record<string, unknown>).computed_at_signal_time === undefined) {
    (out as Record<string, unknown>).computed_at_signal_time = true;
  }

  return { transformed: out, diff: { removed, changed } };
}

async function main() {
  console.log("=== Wave 10 backfill: risk_derived_pyramid sizing ===\n");

  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      config: strategies.config,
    })
    .from(strategies)
    .where(isNull(strategies.archivedAt));

  console.log(`Found ${rows.length} active strategies.\n`);

  let skipped = 0;
  let migrated = 0;
  let errors = 0;

  for (const row of rows) {
    const cfg = row.config as Record<string, unknown> | null;
    const strategy = (cfg?.strategy ?? {}) as Record<string, unknown>;
    const ps = (strategy.position_size ?? {}) as PositionSizeConfig;
    const symbol = (cfg?.symbol ?? strategy.symbol ?? "MES") as string;

    if (ps.type === "risk_derived_pyramid" && !("max_contracts" in ps)) {
      console.log(`[SKIP] ${row.name} (${row.id}) — already risk_derived_pyramid, no max_contracts`);
      skipped++;
      continue;
    }

    const { transformed, diff } = transformPositionSize(ps, symbol);

    const newCfg = {
      ...cfg,
      strategy: {
        ...strategy,
        position_size: transformed,
      },
    };

    try {
      await db.update(strategies).set({ config: newCfg }).where(eq(strategies.id, row.id));

      await db.insert(auditLog).values({
        action: "strategies.position_size_migrated_wave10",
        entityType: "strategy",
        entityId: row.id,
        decisionAuthority: "system",
        input: { position_size_before: ps } as Record<string, unknown>,
        result: {
          position_size_after: transformed,
          removed_fields: diff.removed,
          changed_fields: diff.changed,
        } as Record<string, unknown>,
        status: "success",
        correlationId: null,
      });

      console.log(`[MIGRATED] ${row.name} (${row.id})`);
      if (diff.removed.length > 0) {
        console.log(`   Removed: ${diff.removed.join(", ")}`);
      }
      if (Object.keys(diff.changed).length > 0) {
        for (const [k, v] of Object.entries(diff.changed)) {
          const c = v as { from: unknown; to: unknown };
          console.log(`   Changed: ${k}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
        }
      }
      console.log(`   position_size after: ${JSON.stringify(transformed, null, 2)}`);
      migrated++;
    } catch (err) {
      console.error(`[ERROR] ${row.name} (${row.id}): ${err}`);
      errors++;
    }

    console.log("");
  }

  console.log("=== Summary ===");
  console.log(`  Skipped (already migrated): ${skipped}`);
  console.log(`  Migrated:                   ${migrated}`);
  console.log(`  Errors:                     ${errors}`);

  await sql.end();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
