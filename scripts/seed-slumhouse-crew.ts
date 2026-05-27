import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
dotenvConfig({ path: join(process.cwd(), ".env") });
const { db } = await import("../src/server/db/index.js");
const { sql } = await import("drizzle-orm");

const crew = [
  { discord_user_id: "1376634013443424450", display_name: "Slumdawg Mazi", jersey: 25, broker_account_id: "2f4ca594-bdbe-480a-8e07-f447925abf07" },
  { discord_user_id: "1063953397734191106", display_name: "SlumDawG Dinero", jersey: 7,  broker_account_id: null },
  { discord_user_id: "1508517794860503070", display_name: "Slumdog",         jersey: 4,  broker_account_id: null },
];

for (const m of crew) {
  await db.execute(sql`
    INSERT INTO slumhouse_users (discord_user_id, display_name, jersey_number, broker_account_id)
    VALUES (${m.discord_user_id}, ${m.display_name}, ${m.jersey}, ${m.broker_account_id})
    ON CONFLICT (discord_user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      jersey_number = EXCLUDED.jersey_number,
      broker_account_id = EXCLUDED.broker_account_id
  `);
  console.log(`✓ ${m.display_name} (#${m.jersey})  →  ${m.broker_account_id ?? "(no broker yet)"}`);
}

const all: any = await db.execute(sql`SELECT discord_user_id, display_name, jersey_number, broker_account_id FROM slumhouse_users ORDER BY jersey_number`);
const rows = Array.isArray(all) ? all : all.rows;
console.log(`\nslumhouse_users table — ${rows.length} row(s) total`);
process.exit(0);
