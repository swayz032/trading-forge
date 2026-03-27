import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import express from "express";
import pino from "pino";
import { commands, handleCommand } from "./commands.js";

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty" }
      : undefined,
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const FORGE_API = `http://localhost:${process.env.PORT || 4000}`;

// ─── Alert webhook server (receives from n8n) ──────────────
const alertApp = express();
alertApp.use(express.json());
const ALERT_PORT = Number(process.env.DISCORD_ALERT_PORT) || 4100;

// Channel name mapping — n8n posts to /alert/:channel
const CHANNEL_MAP: Record<string, string> = {
  compliance: process.env.DISCORD_CH_COMPLIANCE || "1482525024484069397",
  skip: process.env.DISCORD_CH_SKIP || "1482525027416150057",
  macro: process.env.DISCORD_CH_MACRO || "1482525030280855713",
  tournament: process.env.DISCORD_CH_TOURNAMENT || "1482525032973336636",
  alerts: process.env.DISCORD_CH_ALERTS || "1482525035921936537",
  governor: process.env.DISCORD_CH_GOVERNOR || "1482525038417674322",
};

// POST /alert/:channel — receives alerts from n8n workflows
alertApp.post("/alert/:channel", async (req, res) => {
  // Verify shared secret to prevent unauthorized Discord messages
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${apiKey}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const { channel } = req.params;
  const channelId = CHANNEL_MAP[channel];

  if (!channelId) {
    res.status(404).json({
      error: `Unknown channel: ${channel}. Available: ${Object.keys(CHANNEL_MAP).join(", ")}`,
    });
    return;
  }

  try {
    const discordChannel = (await client.channels.fetch(
      channelId,
    )) as TextChannel;
    if (!discordChannel) {
      res
        .status(404)
        .json({ error: `Discord channel not found: ${channelId}` });
      return;
    }

    const { title, message, severity, data } = req.body;

    const colorMap: Record<string, number> = {
      critical: 0xff0000, // Red
      warning: 0xffa500, // Orange
      info: 0x00bfff, // Blue
      success: 0x00ff00, // Green
    };

    const embed = new EmbedBuilder()
      .setTitle(title || "Trading Forge Alert")
      .setDescription(
        message ||
          JSON.stringify(data, null, 2).slice(0, 4000),
      )
      .setColor(colorMap[severity] || colorMap.info)
      .setTimestamp()
      .setFooter({ text: `Trading Forge | ${channel}` });

    if (data) {
      // Add key data fields as embed fields (max 25)
      const entries = Object.entries(data).slice(0, 10);
      for (const [key, value] of entries) {
        const strValue =
          typeof value === "object"
            ? JSON.stringify(value).slice(0, 1024)
            : String(value).slice(0, 1024);
        embed.addFields({ name: key, value: strValue, inline: true });
      }
    }

    await discordChannel.send({ embeds: [embed] });
    res.json({ sent: true, channel });
  } catch (err: any) {
    log.error({ err, channel }, "Failed to send Discord alert");
    res.status(500).json({ error: err.message });
  }
});

// Health check
alertApp.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "trading-forge-discord",
    connected: client.isReady(),
  });
});

// ─── Register slash commands ────────────────────────────────
async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN!);
  const commandData = commands.map((c) => c.data.toJSON());

  log.info(`Registering ${commandData.length} slash commands...`);
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID!),
    { body: commandData },
  );
  log.info("Slash commands registered.");
}

// ─── Event handlers ─────────────────────────────────────────
client.once("ready", async () => {
  log.info(`Discord bot ready as ${client.user?.tag}`);
  await registerCommands();

  alertApp.listen(ALERT_PORT, () => {
    log.info(
      `Discord alert webhook listening on http://localhost:${ALERT_PORT}`,
    );
  });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction, FORGE_API, CHANNEL_MAP);
});

client.on("error", (err) => {
  log.error({ err }, "Discord client connection error");
});

// ─── Start ──────────────────────────────────────────────────
client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
  log.error({ err }, "Failed to login to Discord");
});

export { client, CHANNEL_MAP };
