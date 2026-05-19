/**
 * wave23-backfill-strategy-bases.ts — Wave 23 B.4
 *
 * Backfills base_contracts, tier_increment for all CANDIDATE strategies
 * with risk_derived_pyramid position_size config.
 *
 * Target values (operator-locked per Wave 23 spec):
 *   MES: base_contracts=6, tier_increment=3
 *   MNQ: base_contracts=6, tier_increment=3
 *   MCL: base_contracts=18, tier_increment=3
 *
 * Rationale: all bases divisible by 3 → Style C 33/33/33 partials clean.
 * Dollar risk equalization: MES 6×$5×14pt=$420, MNQ 6×$2×40pt=$480, MCL 18×$1×25tick=$450.
 *
 * Idempotent: already-correct rows are a no-op (base_contracts already equals target).
 * Audit log: per-strategy row written after every update.
 *
 * Usage:
 *   npx tsx scripts/wave23-backfill-strategy-bases.ts
 *   npx tsx scripts/wave23-backfill-strategy-bases.ts --dry-run
 */

import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { eq, not, inArray } from "drizzle-orm";

// Per-instrument targets (Wave 23 operator-locked)
const SYMBOL_BASES: Record<string, { base_contracts: number; tier_increment: number }> = {
  MES: { base_contracts: 6,  tier_increment: 3 },
  MNQ: { base_contracts: 6,  tier_increment: 3 },
  MCL: { base_contracts: 18, tier_increment: 3 },
};

// Default for unknown symbols: use MES base (safest assumption)
const DEFAULT_BASE = { base_contracts: 6, tier_increment: 3 };

const isDryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  console.log(`Wave 23 B.4 — Strategy base_contracts backfill ${isDryRun ? "[DRY RUN]" : "[LIVE]"}`);

  // Load all non-graveyard, non-retired strategies
  const allStrategies = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      symbol: strategies.symbol,
      lifecycleState: strategies.lifecycleState,
      config: strategies.config,
    })
    .from(strategies)
    .where(
      not(inArray(strategies.lifecycleState, ["GRAVEYARD", "RETIRED"]))
    );

  console.log(`Found ${allStrategies.length} active strategies`);

  let updated = 0;
  let skipped = 0;
  let noPositionSizeConfig = 0;
  let notPyramid = 0;

  for (const strategy of allStrategies) {
    const config = strategy.config as Record<string, unknown>;
    const positionSize = config?.strategy?.position_size ?? config?.position_size as Record<string, unknown> | undefined;

    if (!positionSize) {
      console.log(`  SKIP ${strategy.name} (${strategy.symbol}): no position_size config`);
      noPositionSizeConfig++;
      continue;
    }

    const psObj = positionSize as Record<string, unknown>;
    if (psObj.type !== "risk_derived_pyramid") {
      console.log(`  SKIP ${strategy.name} (${strategy.symbol}): type=${psObj.type} (not risk_derived_pyramid)`);
      notPyramid++;
      continue;
    }

    const symbol = (strategy.symbol ?? "MES").toUpperCase();
    const target = SYMBOL_BASES[symbol] ?? DEFAULT_BASE;

    const currentBase = psObj.base_contracts as number | undefined;
    const currentIncrement = psObj.tier_increment as number | undefined;

    // Idempotent check: already at target values → skip
    if (currentBase === target.base_contracts && currentIncrement === target.tier_increment) {
      console.log(`  OK   ${strategy.name} (${symbol}): base=${currentBase}, increment=${currentIncrement} — already correct`);
      skipped++;
      continue;
    }

    console.log(
      `  UPD  ${strategy.name} (${symbol}): base ${currentBase ?? "?"} → ${target.base_contracts}, ` +
      `increment ${currentIncrement ?? "?"} → ${target.tier_increment}`,
    );

    if (!isDryRun) {
      // Deep-clone config and update position_size fields
      const updatedConfig = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

      // Handle both config.strategy.position_size and config.position_size layouts
      if ((updatedConfig?.strategy as Record<string, unknown>)?.position_size) {
        const stratCfg = updatedConfig.strategy as Record<string, unknown>;
        const ps = stratCfg.position_size as Record<string, unknown>;
        ps.base_contracts = target.base_contracts;
        ps.tier_increment = target.tier_increment;
      } else if (updatedConfig?.position_size) {
        const ps = updatedConfig.position_size as Record<string, unknown>;
        ps.base_contracts = target.base_contracts;
        ps.tier_increment = target.tier_increment;
      }

      await db
        .update(strategies)
        .set({ config: updatedConfig })
        .where(eq(strategies.id, strategy.id));

      // Audit row per strategy update
      await db.insert(auditLog).values({
        action: "strategy.wave23_base_backfilled",
        entityType: "strategy",
        entityId: strategy.id,
        decisionAuthority: "system",
        input: {
          strategy_id: strategy.id,
          strategy_name: strategy.name,
          symbol,
          old_base_contracts: currentBase,
          old_tier_increment: currentIncrement,
        } as Record<string, unknown>,
        result: {
          new_base_contracts: target.base_contracts,
          new_tier_increment: target.tier_increment,
          wave: 23,
          track: "B.4",
        } as Record<string, unknown>,
        status: "success",
      });
    }

    updated++;
  }

  console.log("\n── Summary ──────────────────────────────────────");
  console.log(`  Updated:              ${updated}`);
  console.log(`  Already correct:      ${skipped}`);
  console.log(`  No position_size:     ${noPositionSizeConfig}`);
  console.log(`  Not risk_derived:     ${notPyramid}`);
  console.log(`  Total strategies:     ${allStrategies.length}`);
  if (isDryRun) {
    console.log("\n  [DRY RUN] — no DB changes made. Remove --dry-run to apply.");
  } else {
    console.log(`\n  ${updated} strategies updated with Wave 23 base_contracts/tier_increment.`);
  }
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
