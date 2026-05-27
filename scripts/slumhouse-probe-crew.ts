import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
dotenvConfig({ path: join(process.cwd(), ".env") });

const TOKEN = process.env.DISCORD_BOT_TOKEN!;
const SLUMDAWG_GUILD = "1482571930396524666";
const headers = { Authorization: `Bot ${TOKEN}` };

const res = await fetch(`https://discord.com/api/v10/guilds/${SLUMDAWG_GUILD}/members?limit=100`, { headers });
if (!res.ok) { console.error(`HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
const members = await res.json() as any[];
const humans = members.filter(m => !m.user?.bot);

console.log(`\n✓ Slumdawg Traders🦅🤖 has ${humans.length} human member(s):\n`);
console.log("discord_user_id          display_name          username");
console.log("─".repeat(72));
for (const m of humans) {
  const u = m.user;
  const display = m.nick || u.global_name || u.username;
  console.log(`${u.id.padEnd(22)} ${(display || "").padEnd(20)} @${u.username}`);
}
