import { grantBurstTicket, readTodaySpend, type BurstTicket } from "../src/server/lib/extraction-token-governor";
const ROOT=process.cwd(); const LEDGER=`${ROOT}/docs/replay-results/h1-scripts/frontier-daily-ledger.json`;
const now=new Date(); const dk=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}-${String(now.getUTCDate()).padStart(2,"0")}`;
const gp=readTodaySpend(LEDGER,"gpt54",now); const RATE=2.80*1.5;
const t:BurstTicket={pool:"gpt54",limitUsd:2.00,overageUsdPerMTok:RATE,limitTokens:Math.floor(2.00/RATE*1e6),freePoolLine:250000,grantedAtSpent:gp,signedBy:"operator (Tonio): config-pass, $2 cap, 'I SIGN OFF ON THE BALANCE'",grantedUtcDate:dk};
grantBurstTicket(LEDGER,now,t);
console.log(`config-pass burst: grantPoint ${gp}, $2 cap @ $${RATE}/1M = ${t.limitTokens} tok`);
