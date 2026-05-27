/**
 * Probes the existing Discord bot to verify it's in the Slumdawg Traders
 * guild and can list members. Read-only — no writes.
 */
import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
dotenvConfig({ path: join(process.cwd(), ".env") });

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APPLICATION_ID;
if (!TOKEN || !APP_ID) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID");
  process.exit(1);
}

const headers = { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" };

async function get(path: string) {
  const res = await fetch(`https://discord.com/api/v10${path}`, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${path}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// 1. Bot identity
const me = await get("/users/@me");
console.log(`\n✓ Bot identity: ${(me as any).username} (id=${(me as any).id})`);

// 2. Application info — shows redirect URIs if our token can read them
try {
  const app = await get(`/applications/@me`);
  const a = app as any;
  console.log(`✓ Application: ${a.name} (id=${a.id})`);
  console.log(`  Description: ${(a.description ?? "").slice(0, 60)}`);
  console.log(`  Redirect URIs configured: ${a.redirect_uris?.length ?? "n/a (bot tokens can't read this — operator must check in dev portal)"}`);
  if (a.redirect_uris?.length) {
    for (const r of a.redirect_uris) console.log(`    - ${r}`);
  }
} catch (e: any) {
  console.log(`  (applications/@me requires bot OR client credentials — ${e.message.slice(0, 100)})`);
}

// 3. Guilds the bot is in
const guilds = (await get("/users/@me/guilds")) as Array<{ id: string; name: string }>;
console.log(`\n✓ Bot is in ${guilds.length} guild(s):`);
for (const g of guilds) console.log(`  - ${g.name} (${g.id})`);

if (guilds.length === 0) {
  console.log("\n⚠ Bot is not in any guild. Invite it via OAuth2 URL with scope=bot.");
  process.exit(0);
}

// 4. For each guild — pick the first as candidate Slumdawg Traders
const guild = guilds[0];
try {
  const members = (await get(`/guilds/${guild.id}/members?limit=100`)) as Array<any>;
  const humans = members.filter((m) => !m.user?.bot);
  console.log(`\n✓ ${guild.name} has ${humans.length} human member(s) (showing first 25):`);
  for (const m of humans.slice(0, 25)) {
    const u = m.user;
    const display = m.nick || u.global_name || u.username;
    console.log(`  ${u.id}  ${display}  (@${u.username})`);
  }
} catch (e: any) {
  console.log(`\n⚠ Could not list members: ${e.message}`);
  console.log(`  Likely needs GUILD_MEMBERS intent enabled in the dev portal under "Privileged Gateway Intents".`);
}

console.log("\n— Discord probe complete —");
