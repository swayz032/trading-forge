import { grantBurstTicket, readBurstTicket, readTodaySpend, type BurstTicket } from "../src/server/lib/extraction-token-governor";
const ROOT = process.cwd();
const LEDGER = `${ROOT}/docs/replay-results/h1-scripts/frontier-daily-ledger.json`;
const now = new Date();
const dk = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}-${String(now.getUTCDate()).padStart(2,"0")}`;
const grantPoint = readTodaySpend(LEDGER, "gpt54", now);
const BLEND = 2.80, SAFETY = 1.5, RATE = BLEND * SAFETY; // $4.20/1M dollar-truth
const ticket: BurstTicket = {
  pool: "gpt54",
  limitUsd: 3.00,                                  // hard $ cap
  overageUsdPerMTok: RATE,                          // measured blend x1.5
  limitTokens: Math.floor(3.00 / RATE * 1_000_000), // token-equiv of the $ cap
  freePoolLine: 250_000,
  grantedAtSpent: grantPoint,                       // paid = new spend since NOW
  signedBy: "operator (Tonio): completion ticket, $3 cap, finish the pool tonight",
  grantedUtcDate: dk,
};
grantBurstTicket(LEDGER, now, ticket);
console.log("COMPLETION TICKET granted:");
console.log(`  grant point (spend now): ${grantPoint}`);
console.log(`  rate: $${RATE}/1M (blend $${BLEND} x${SAFETY} safety) | $3 cap = ${ticket.limitTokens} tok headroom`);
console.log(`  actual projected for ~650K remaining @ true $${BLEND}/1M: ~$${(650000/1e6*BLEND).toFixed(2)}`);
console.log(JSON.stringify(readBurstTicket(LEDGER, "gpt54", now)));
