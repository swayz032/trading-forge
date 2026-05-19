import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { strategies, strategyGraveyard, auditLog } from "../src/server/db/schema.js";
import { eq, desc, inArray, not } from "drizzle-orm";

async function main() {
  // Check all strategies
  const all = await db.select({ id: strategies.id, name: strategies.name, lifecycleState: strategies.lifecycleState }).from(strategies);
  console.log("\nAll strategies:");
  for (const s of all) {
    console.log(`  [${s.lifecycleState}] ${s.name} (${s.id})`);
  }

  // Check graveyard
  const gyard = await db.select({ id: strategyGraveyard.id, name: strategyGraveyard.name, deathReason: strategyGraveyard.deathReason, deathDate: strategyGraveyard.deathDate })
    .from(strategyGraveyard).orderBy(desc(strategyGraveyard.deathDate)).limit(5);
  console.log("\nRecent graveyard entries:");
  for (const g of gyard) {
    console.log(`  ${g.name}: ${g.deathReason?.slice(0, 100)} (${g.deathDate?.toISOString?.()})`);
  }

  // Check recent audit log
  const audits = await db.select({ action: auditLog.action, entityId: auditLog.entityId, status: auditLog.status, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(inArray(auditLog.action, ["strategy.graveyarded_by_wave23_sweep", "strategy.wave23_sweep_survived"]))
    .orderBy(desc(auditLog.createdAt)).limit(10);
  console.log("\nWave23 sweep audit log:");
  for (const a of audits) {
    console.log(`  ${a.action} ${a.entityId} ${a.status} ${a.createdAt?.toISOString?.()}`);
  }
}
main().catch(console.error).finally(() => process.exit(0));
