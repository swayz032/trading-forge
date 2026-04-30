import "../server/load-env.js";
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
import { z } from "zod";
import { createHash } from "crypto";
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
// Run scripts/setup-discord-channels.ts to provision the *-report/finds/errors/alerts channels.
const CHANNEL_MAP: Record<string, string> = {
  compliance: process.env.DISCORD_CH_COMPLIANCE || "1482525024484069397",
  skip: process.env.DISCORD_CH_SKIP || "1482525027416150057",
  macro: process.env.DISCORD_CH_MACRO || "1482525030280855713",
  tournament: process.env.DISCORD_CH_TOURNAMENT || "1482525032973336636",
  alerts: process.env.DISCORD_CH_ALERTS || "1482525035921936537",
  governor: process.env.DISCORD_CH_GOVERNOR || "1482525038417674322",
  "n8n-daily-report": process.env.DISCORD_CH_N8N_DAILY_REPORT || "",
  "strategy-finds": process.env.DISCORD_CH_STRATEGY_FINDS || "",
  "workflow-errors": process.env.DISCORD_CH_WORKFLOW_ERRORS || "",
  "critical-alerts": process.env.DISCORD_CH_CRITICAL_ALERTS || "",
};

// ─── Typed payload contracts (OpenClaw structured reporting) ───
// These four channels reject any payload that does not match the schema.
// Free-form messages would put OpenClaw back into "off-topic chatter" mode.

const ExecutionRefSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  executionId: z.string(),
  errorMessage: z.string().optional(),
});

const StrategyCandidateRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  market: z.string(),
  timeframe: z.string(),
  source: z.string().optional(),
});

const DailyN8nReportSchema = z.object({
  reportDate: z.string(),
  activeWorkflowCount: z.number().int().nonnegative(),
  newOrChanged: z.array(z.string()).default([]),
  failed24h: z.array(ExecutionRefSchema).default([]),
  staleWorkflows: z.array(z.string()).default([]),
  strategyFinds: z.array(StrategyCandidateRefSchema).default([]),
  healthIssues: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
});

const StrategyFindSchema = z.object({
  thesis: z.string().min(1),
  market: z.string().min(1),
  timeframe: z.string().min(1),
  entryRules: z.string().min(1),
  exitRules: z.string().min(1),
  riskRules: z.string().min(1),
  sourceUrl: z.string().url(),
  regime: z.string().min(1),
  crossValStatus: z.enum(["passed", "pending", "rejected"]),
});

const WorkflowErrorSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  executionId: z.string(),
  nodeName: z.string(),
  errorMessage: z.string(),
  firstSeenAt: z.string(),
  occurrenceCount: z.number().int().positive(),
});

const CriticalAlertSchema = z.object({
  source: z.string(),
  summary: z.string().min(1),
  impact: z.string(),
  remediation: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

// Per-channel schema; channels not listed here keep the legacy free-form behavior.
const TYPED_CHANNEL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "n8n-daily-report": DailyN8nReportSchema,
  "strategy-finds": StrategyFindSchema,
  "workflow-errors": WorkflowErrorSchema,
  "critical-alerts": CriticalAlertSchema,
};

// Cross-channel dedupe — same hash within window suppressed regardless of target channel.
const DEDUPE_WINDOW_MS = 10 * 60_000;
const recentDedupeHashes = new Map<string, number>();
function isDuplicate(hash: string): boolean {
  const now = Date.now();
  for (const [k, t] of recentDedupeHashes) {
    if (t < now - DEDUPE_WINDOW_MS) recentDedupeHashes.delete(k);
  }
  if (recentDedupeHashes.has(hash)) return true;
  recentDedupeHashes.set(hash, now);
  return false;
}
function payloadDedupeHash(channel: string, body: unknown): string {
  return createHash("sha256")
    .update(channel + "::" + JSON.stringify(body))
    .digest("hex")
    .slice(0, 24);
}

function renderTypedEmbed(channel: string, payload: any): EmbedBuilder {
  const colorMap: Record<string, number> = {
    "n8n-daily-report": 0x00bfff,
    "strategy-finds": 0x00ff00,
    "workflow-errors": 0xffa500,
    "critical-alerts": 0xff0000,
  };
  const color = colorMap[channel] ?? 0x00bfff;

  const embed = new EmbedBuilder().setColor(color).setTimestamp().setFooter({ text: `Trading Forge | ${channel}` });

  if (channel === "n8n-daily-report") {
    embed
      .setTitle(`n8n Daily Report — ${payload.reportDate}`)
      .setDescription(
        `Active workflows: **${payload.activeWorkflowCount}**\n` +
          `Failed (24h): **${payload.failed24h.length}**\n` +
          `Stale: **${payload.staleWorkflows.length}**\n` +
          `New strategy finds: **${payload.strategyFinds.length}**`,
      )
      .addFields(
        { name: "Health issues", value: (payload.healthIssues.join("\n") || "none").slice(0, 1024), inline: false },
        { name: "Next actions", value: (payload.nextActions.join("\n") || "none").slice(0, 1024), inline: false },
      );
  } else if (channel === "strategy-finds") {
    embed
      .setTitle(`Strategy candidate — ${payload.market} ${payload.timeframe}`)
      .setDescription(payload.thesis.slice(0, 4000))
      .addFields(
        { name: "Entry", value: payload.entryRules.slice(0, 1024), inline: false },
        { name: "Exit", value: payload.exitRules.slice(0, 1024), inline: false },
        { name: "Risk", value: payload.riskRules.slice(0, 1024), inline: false },
        { name: "Regime", value: payload.regime, inline: true },
        { name: "Cross-val", value: payload.crossValStatus, inline: true },
        { name: "Source", value: payload.sourceUrl.slice(0, 1024), inline: false },
      );
  } else if (channel === "workflow-errors") {
    embed
      .setTitle(`Workflow error — ${payload.workflowName}`)
      .setDescription(payload.errorMessage.slice(0, 4000))
      .addFields(
        { name: "Node", value: payload.nodeName, inline: true },
        { name: "Execution", value: payload.executionId, inline: true },
        { name: "First seen", value: payload.firstSeenAt, inline: true },
        { name: "Occurrences", value: String(payload.occurrenceCount), inline: true },
      );
  } else if (channel === "critical-alerts") {
    embed
      .setTitle(`CRITICAL — ${payload.source}`)
      .setDescription(payload.summary.slice(0, 4000))
      .addFields(
        { name: "Impact", value: payload.impact.slice(0, 1024), inline: false },
        { name: "Remediation", value: payload.remediation.slice(0, 1024), inline: false },
      );
  }

  return embed;
}

export {
  TYPED_CHANNEL_SCHEMAS,
  DailyN8nReportSchema,
  StrategyFindSchema,
  WorkflowErrorSchema,
  CriticalAlertSchema,
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

  // Typed channels reject anything that doesn't match their schema.
  // Free-form posts here are how OpenClaw's "off-topic chatter" leaked into Discord.
  const schema = TYPED_CHANNEL_SCHEMAS[channel];
  let typedPayload: any = null;
  if (schema) {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Payload does not match channel schema",
        channel,
        issues: parsed.error.issues,
      });
      return;
    }
    typedPayload = parsed.data;

    // Cross-channel dedupe — drop the same payload-shape if it lands within window
    const dedupeKey = payloadDedupeHash(channel, typedPayload);
    if (isDuplicate(dedupeKey)) {
      res.status(202).json({ sent: false, deduped: true, channel });
      return;
    }
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

    let embed: EmbedBuilder;

    if (typedPayload) {
      embed = renderTypedEmbed(channel, typedPayload);
    } else {
      const { title, message, severity, data } = req.body;
      const colorMap: Record<string, number> = {
        critical: 0xff0000,
        warning: 0xffa500,
        info: 0x00bfff,
        success: 0x00ff00,
      };
      embed = new EmbedBuilder()
        .setTitle(title || "Trading Forge Alert")
        .setDescription(
          message || JSON.stringify(data, null, 2).slice(0, 4000),
        )
        .setColor(colorMap[severity] || colorMap.info)
        .setTimestamp()
        .setFooter({ text: `Trading Forge | ${channel}` });

      if (data) {
        const entries = Object.entries(data).slice(0, 10);
        for (const [key, value] of entries) {
          const strValue =
            typeof value === "object"
              ? JSON.stringify(value).slice(0, 1024)
              : String(value).slice(0, 1024);
          embed.addFields({ name: key, value: strValue, inline: true });
        }
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
