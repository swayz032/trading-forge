// Seeds firm_adversarial_priors from
// src/server/db/seeds/firm_adversarial_priors_seed.json (idempotent).
// Run once after migration 0089 to populate the priors table.

import { config } from "dotenv";
config();

const { loadSeedPriorsIfEmpty, listAllPriors } = await import(
  "../src/server/services/firm-adversarial-event-service.ts"
);

const result = await loadSeedPriorsIfEmpty();
console.log("[B14 seed]", result);

const all = await listAllPriors();
console.log(`[B14 seed] Total rows in firm_adversarial_priors: ${all.length}`);

const byFirm = all.reduce((acc, r) => {
  acc[r.firmId] = (acc[r.firmId] ?? 0) + 1;
  return acc;
}, {});
console.log("[B14 seed] Rows per firm:", byFirm);

process.exit(0);
