import { readdirSync, readFileSync } from "fs";
import { seedTodaySpend, readTodaySpend } from "../src/server/lib/extraction-token-governor";
const ROOT = process.cwd();
const LEDGER = `${ROOT}/docs/replay-results/h1-scripts/frontier-daily-ledger.json`;
const dirs = [
  `${ROOT}/docs/replay-results/h1-scripts/frontier-birth-gate/result-cache`,
  `${ROOT}/docs/replay-results/h1-scripts/frontier-designpool/result-cache`,
];
let gpt54 = 0, mini = 0;
for (const d of dirs) {
  let files: string[] = [];
  try { files = readdirSync(d); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const e = JSON.parse(readFileSync(`${d}/${f}`, "utf8"));
      const t = e.originalTokens ?? 0;
      if (e.model === "gpt-5.4") gpt54 += t;
      else if (e.model === "gpt-5.4-mini") mini += t;
    } catch {}
  }
}
const now = new Date();
seedTodaySpend(LEDGER, "gpt54", now, gpt54);
seedTodaySpend(LEDGER, "mini", now, mini);
console.log(`seeded today: gpt54=${gpt54}  mini=${mini}`);
console.log(`readback gpt54=${readTodaySpend(LEDGER, "gpt54", now)} mini=${readTodaySpend(LEDGER, "mini", now)}`);
console.log(`gpt54 partition=200000 -> ${gpt54 >= 200000 ? "EXHAUSTED (design-pool resumes tomorrow)" : "room: " + (200000 - gpt54)}`);
