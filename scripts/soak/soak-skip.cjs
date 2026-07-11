// scripts/soak/soak-skip.cjs — operator switch CLI (v1; the Office card replaces this in v2).
// system_parameters.current_value is NUMERIC, domain is NOT NULL. soak_mode: 1=armed / 0=off.
"use strict";
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
(function loadEnv() {
  const c = [process.env.SOAK_ENV_PATH, path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", "..", ".env"), path.join(__dirname, "..", "..", "..", "trading-forge", ".env")].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) { dotenv.config({ path: p }); if (process.env.DATABASE_URL) return; } } catch { /* */ } }
})();
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function upsert(name, value) {
  await sql`INSERT INTO system_parameters (param_name, current_value, domain, description)
            VALUES (${name}, ${value}, 'scheduler', 'Tower soak harness control')
            ON CONFLICT (param_name) DO UPDATE SET current_value = EXCLUDED.current_value, updated_at = now()`;
}
function next9amMs() {
  const now = new Date(), n = new Date(now);
  n.setHours(9, 0, 0, 0);
  if (n <= now) n.setDate(n.getDate() + 1);
  return n.getTime();
}
(async () => {
  const arg = process.argv[2];
  try {
    if (arg === "--status") {
      const rows = await sql`SELECT param_name, current_value FROM system_parameters WHERE param_name LIKE 'soak_%' ORDER BY param_name`;
      const map = Object.fromEntries(rows.map(r => [r.param_name, r.current_value]));
      const mode = map.soak_mode === undefined ? "armed (default, no row)" : (Number(map.soak_mode) === 0 ? "OFF" : "armed");
      const skip = map.soak_skip_until && Number(map.soak_skip_until) > Date.now() ? new Date(Number(map.soak_skip_until)).toLocaleString() : "none";
      console.log(`soak_mode: ${mode}\nskip_until: ${skip}`);
    } else if (arg === "--tonight") { await upsert("soak_skip_until", String(next9amMs())); console.log("Soak SKIPPED until 09:00 (auto-rearms)."); }
    else if (arg === "--off") { await upsert("soak_mode", "0"); console.log("Soak OFF (two-tap intent — instrument dormant)."); }
    else if (arg === "--arm") { await upsert("soak_mode", "1"); await upsert("soak_skip_until", "0"); console.log("Soak ARMED — next 3:00AM run active."); }
    else console.log("usage: node scripts/soak/soak-skip.cjs --status | --tonight | --off | --arm");
  } finally { await sql.end(); }
})();
