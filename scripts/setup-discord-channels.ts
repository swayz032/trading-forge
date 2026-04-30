/**
 * Discord Channel Setup — creates the 4 dedicated channels OpenClaw uses
 * for structured reporting, then prints the channel IDs as an env block
 * the user can paste into .env.
 *
 * Channels created (if missing):
 *   - n8n-daily-report
 *   - strategy-finds
 *   - workflow-errors
 *   - critical-alerts
 *
 * Required permissions: bot must have ManageChannels in the target guild.
 *
 * Env required:
 *   DISCORD_BOT_TOKEN   — same token bot.ts uses
 *   DISCORD_GUILD_ID    — optional; if omitted, uses the first guild the bot is in
 *
 * Usage: npx tsx scripts/setup-discord-channels.ts
 */

import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from "discord.js";

const REQUIRED_CHANNELS = [
  { name: "n8n-daily-report", envKey: "DISCORD_CH_N8N_DAILY_REPORT" },
  { name: "strategy-finds", envKey: "DISCORD_CH_STRATEGY_FINDS" },
  { name: "workflow-errors", envKey: "DISCORD_CH_WORKFLOW_ERRORS" },
  { name: "critical-alerts", envKey: "DISCORD_CH_CRITICAL_ALERTS" },
] as const;

async function main(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("DISCORD_BOT_TOKEN is not set in .env");
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await new Promise<void>((resolve, reject) => {
    client.once("ready", () => resolve());
    client.once("error", reject);
    client.login(token).catch(reject);
  });

  console.error(`Logged in as ${client.user?.tag}`);

  const guildId = process.env.DISCORD_GUILD_ID;
  const guild = guildId
    ? await client.guilds.fetch(guildId).catch(() => null)
    : (await client.guilds.fetch()).first()
      ? await client.guilds.fetch((await client.guilds.fetch()).first()!.id)
      : null;

  if (!guild) {
    console.error("No guild available. Either set DISCORD_GUILD_ID or invite the bot to a server first.");
    await client.destroy();
    process.exit(1);
  }

  console.error(`Targeting guild: ${guild.name} (${guild.id})`);

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    console.error(
      `Bot is missing ManageChannels permission in ${guild.name}. ` +
        "Grant it via the Discord Developer Portal (Bot OAuth scopes + permissions) " +
        "and re-invite the bot, then re-run this script.",
    );
    await client.destroy();
    process.exit(2);
  }

  const allChannels = await guild.channels.fetch();
  const results: Record<string, string> = {};

  for (const def of REQUIRED_CHANNELS) {
    const existing = allChannels.find(
      (c) => c?.type === ChannelType.GuildText && c?.name === def.name,
    );
    if (existing) {
      console.error(`Channel #${def.name} exists (${existing.id})`);
      results[def.envKey] = existing.id;
      continue;
    }
    const created = await guild.channels.create({
      name: def.name,
      type: ChannelType.GuildText,
      reason: "Trading Forge — OpenClaw structured reporting channel",
    });
    console.error(`Channel #${def.name} created (${created.id})`);
    results[def.envKey] = created.id;
  }

  console.log("\n# Append to .env:");
  for (const [key, value] of Object.entries(results)) {
    console.log(`${key}=${value}`);
  }

  await client.destroy();
}

main().catch((err) => {
  console.error("setup-discord-channels failed:", err);
  process.exit(1);
});
