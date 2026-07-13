import { seedTodaySpend, readTodaySpend, grantBurstTicket, readBurstTicket, type BurstTicket } from "../src/server/lib/extraction-token-governor";
const ROOT = process.cwd();
const LEDGER = `${ROOT}/docs/replay-results/h1-scripts/frontier-daily-ledger.json`;
const now = new Date();
const dk = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}-${String(now.getUTCDate()).padStart(2,"0")}`;

// ORDER 2 — RECONCILE: dashboard shows gpt-5.4 = 262K (the true free-cap metric).
// Our full-weight ledger read 251,436. Delta ~10.6K = input-vs-total accounting +
// a few pre-ledger calls. The dashboard is ground truth for the free line, and it
// is MORE conservative, so set the ledger to it (never optimistic on a paid lane).
const DASHBOARD_GPT54 = 262_000;
const before = readTodaySpend(LEDGER, "gpt54", now);
seedTodaySpend(LEDGER, "gpt54", now, DASHBOARD_GPT54);
console.log(`RECONCILE gpt54: ledger ${before} -> dashboard-truth ${DASHBOARD_GPT54} (delta ${DASHBOARD_GPT54-before})`);

// ORDER 1 — GRANT the operator-signed $2 burst (250K tokens OR $2, whichever first).
const ticket: BurstTicket = {
  pool: "gpt54",
  limitTokens: 250_000,      // hard token cap
  limitUsd: 2.0,             // hard dollar cap (whichever binds first)
  overageUsdPerMTok: 6.67,   // empirical: $0.08 / 12K over = ~$6.67/1M
  freePoolLine: 250_000,     // free daily ceiling; spend above bills paid
  signedBy: "operator (Tonio, explicit: '$2 not $4')",
  grantedUtcDate: dk,
};
grantBurstTicket(LEDGER, now, ticket);
const rb = readBurstTicket(LEDGER, "gpt54", now);
console.log(`BURST granted: ${JSON.stringify(rb)}`);
// paid already: 262K - 250K = 12K = $0.08 (the leaked overage before the wall shipped)
const paidNow = Math.max(0, DASHBOARD_GPT54 - ticket.freePoolLine);
console.log(`paid-so-far: ${paidNow} tok = $${(paidNow/1e6*ticket.overageUsdPerMTok).toFixed(2)} | burst headroom: ${ticket.limitTokens-paidNow} tok before revert-to-free`);
