import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ChannelType,
} from "discord.js";
import { fetchForge, errorEmbed, statusColor, truncate, infoEmbed } from "./utils.js";

// ─── Type for a registered command ──────────────────────────
interface Command {
  data: SlashCommandBuilder;
}

// ─── Helper: wrap every handler in try/catch ────────────────
async function safeReply(
  interaction: ChatInputCommandInteraction,
  handler: () => Promise<EmbedBuilder | EmbedBuilder[]>,
) {
  await interaction.deferReply();
  try {
    const result = await handler();
    const embeds = Array.isArray(result) ? result : [result];
    await interaction.editReply({ embeds });
  } catch (err: any) {
    const msg =
      err?.cause?.code === "ECONNREFUSED" || err?.message?.includes("fetch failed")
        ? "Trading Forge API unreachable. Is the server running on port 4000?"
        : err.message || "Unknown error";
    await interaction.editReply({ embeds: [errorEmbed(msg)] });
  }
}

// ─── /forge ─────────────────────────────────────────────────
const forgeCommand = new SlashCommandBuilder()
  .setName("forge")
  .setDescription("Trading Forge system commands")
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Overall system health"),
  )
  .addSubcommand((sub) =>
    sub.setName("strategies").setDescription("List active strategies"),
  ) as SlashCommandBuilder;

// ─── /skip ──────────────────────────────────────────────────
const skipCommand = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip-day engine")
  .addSubcommand((sub) =>
    sub.setName("today").setDescription("Today's skip decisions"),
  ) as SlashCommandBuilder;

// ─── /compliance ────────────────────────────────────────────
const complianceCommand = new SlashCommandBuilder()
  .setName("compliance")
  .setDescription("Prop-firm compliance")
  .addSubcommand((sub) =>
    sub.setName("check").setDescription("Compliance freshness per firm"),
  )
  .addSubcommand((sub) =>
    sub.setName("gate").setDescription("Today's gate decisions"),
  ) as SlashCommandBuilder;

// ─── /survival ──────────────────────────────────────────────
const survivalCommand = new SlashCommandBuilder()
  .setName("survival")
  .setDescription("Survival leaderboard")
  .addSubcommand((sub) =>
    sub
      .setName("score")
      .setDescription("Survival score for a firm")
      .addStringOption((opt) =>
        opt.setName("firm").setDescription("Firm name").setRequired(true),
      ),
  ) as SlashCommandBuilder;

// ─── /macro ─────────────────────────────────────────────────
const macroCommand = new SlashCommandBuilder()
  .setName("macro")
  .setDescription("Macro regime & calendar")
  .addSubcommand((sub) =>
    sub.setName("regime").setDescription("Current macro regime"),
  )
  .addSubcommand((sub) =>
    sub.setName("calendar").setDescription("Upcoming economic events"),
  ) as SlashCommandBuilder;

// ─── /governor ──────────────────────────────────────────────
const governorCommand = new SlashCommandBuilder()
  .setName("governor")
  .setDescription("Governor state")
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Governor status for a strategy")
      .addStringOption((opt) =>
        opt
          .setName("strategy")
          .setDescription("Strategy ID or name")
          .setRequired(true),
      ),
  ) as SlashCommandBuilder;

// ─── /tournament ────────────────────────────────────────────
const tournamentCommand = new SlashCommandBuilder()
  .setName("tournament")
  .setDescription("Tournament results")
  .addSubcommand((sub) =>
    sub.setName("latest").setDescription("Latest tournament result"),
  ) as SlashCommandBuilder;

// ─── /decay ─────────────────────────────────────────────────
const decayCommand = new SlashCommandBuilder()
  .setName("decay")
  .setDescription("Alpha decay monitoring")
  .addSubcommand((sub) =>
    sub.setName("dashboard").setDescription("All strategies' decay status"),
  ) as SlashCommandBuilder;

// ─── /setup ─────────────────────────────────────────────────
const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Bot configuration")
  .addSubcommand((sub) =>
    sub
      .setName("channel")
      .setDescription("Map a Discord channel to an alert type")
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Alert type")
          .setRequired(true)
          .addChoices(
            { name: "compliance", value: "compliance" },
            { name: "skip", value: "skip" },
            { name: "macro", value: "macro" },
            { name: "tournament", value: "tournament" },
            { name: "alerts", value: "alerts" },
            { name: "governor", value: "governor" },
          ),
      )
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Target Discord channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  ) as SlashCommandBuilder;

// ─── Export command list ────────────────────────────────────
export const commands: Command[] = [
  { data: forgeCommand },
  { data: skipCommand },
  { data: complianceCommand },
  { data: survivalCommand },
  { data: macroCommand },
  { data: governorCommand },
  { data: tournamentCommand },
  { data: decayCommand },
  { data: setupCommand },
];

// ─── Command handler router ────────────────────────────────
export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  apiBase: string,
  channelMap: Record<string, string>,
) {
  const cmd = interaction.commandName;
  const sub = interaction.options.getSubcommand();

  // /forge
  if (cmd === "forge" && sub === "status") {
    return safeReply(interaction, async () => {
      const data = await fetchForge(apiBase, "/api/compliance/status");
      const color = data.healthy ? 0x00ff00 : 0xff0000;
      return new EmbedBuilder()
        .setTitle("Forge System Health")
        .setColor(color)
        .addFields(
          { name: "Status", value: data.healthy ? "Healthy" : "Unhealthy", inline: true },
          { name: "Healthy Firms", value: String(data.healthyFirms ?? "N/A"), inline: true },
          { name: "Unhealthy Firms", value: String(data.unhealthyFirms ?? "N/A"), inline: true },
          { name: "Unresolved Drifts", value: String(data.unresolvedDrifts ?? 0), inline: true },
        )
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
    });
  }

  if (cmd === "forge" && sub === "strategies") {
    return safeReply(interaction, async () => {
      const data = await fetchForge<any[]>(apiBase, "/api/strategies");
      if (!data.length) return infoEmbed("Strategies", "No active strategies found.");
      const embed = new EmbedBuilder()
        .setTitle("Active Strategies")
        .setColor(0x00bfff)
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
      for (const s of data.slice(0, 25)) {
        embed.addFields({
          name: s.name || s.id,
          value: [
            s.tier ? `Tier: **${s.tier}**` : null,
            s.lifecycle ? `Lifecycle: ${s.lifecycle}` : null,
            s.forgeScore != null ? `Forge Score: ${s.forgeScore}` : null,
          ]
            .filter(Boolean)
            .join(" | ") || "No details",
          inline: false,
        });
      }
      return embed;
    });
  }

  // /skip today
  if (cmd === "skip" && sub === "today") {
    return safeReply(interaction, async () => {
      const data = await fetchForge<any[]>(apiBase, "/api/skip/today");
      if (!data.length) return infoEmbed("Skip Decisions", "No skip decisions for today.");
      const embed = new EmbedBuilder()
        .setTitle("Today's Skip Decisions")
        .setColor(0x00bfff)
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
      for (const d of data.slice(0, 25)) {
        const decision = d.decision || d.action || "UNKNOWN";
        const _color = decision === "TRADE" ? "green" : decision === "SKIP" ? "red" : "orange";
        embed.addFields({
          name: `${d.strategy || d.strategyId || "?"} — ${decision}`,
          value: truncate(d.reasons?.join(", ") || d.reason || "No reason provided"),
          inline: false,
        });
      }
      return embed;
    });
  }

  // /compliance check
  if (cmd === "compliance" && sub === "check") {
    return safeReply(interaction, async () => {
      const data = await fetchForge<any[]>(apiBase, "/api/compliance/rulesets/freshness");
      if (!data.length) return infoEmbed("Compliance Freshness", "No rulesets found.");
      const embed = new EmbedBuilder()
        .setTitle("Compliance Freshness")
        .setColor(0x00bfff)
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
      for (const f of data.slice(0, 25)) {
        const status = f.fresh ? "Fresh" : "STALE";
        embed.addFields({
          name: `${f.firm || f.firmId || "?"} — ${status}`,
          value: [
            f.ageHours != null ? `Age: ${f.ageHours}h` : null,
            f.drift ? `Drift: ${f.drift}` : null,
            f.driftDetected ? "Drift detected" : null,
          ]
            .filter(Boolean)
            .join(" | ") || "OK",
          inline: true,
        });
      }
      return embed;
    });
  }

  // /compliance gate
  if (cmd === "compliance" && sub === "gate") {
    return safeReply(interaction, async () => {
      const data = await fetchForge<any[]>(apiBase, "/api/compliance/gate/today");
      if (!data.length) return infoEmbed("Compliance Gate", "No gate decisions for today.");
      const embed = new EmbedBuilder()
        .setTitle("Today's Gate Decisions")
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
      let hasBlocked = false;
      for (const g of data.slice(0, 25)) {
        const verdict = g.verdict || g.decision || "UNKNOWN";
        if (verdict === "BLOCKED") hasBlocked = true;
        embed.addFields({
          name: `${g.strategy || g.strategyId || "?"} — ${verdict}`,
          value: truncate(g.reasons?.join(", ") || g.reason || "No details"),
          inline: false,
        });
      }
      embed.setColor(hasBlocked ? 0xff0000 : 0x00ff00);
      return embed;
    });
  }

  // /survival score <firm>
  if (cmd === "survival" && sub === "score") {
    const firm = interaction.options.getString("firm", true);
    return safeReply(interaction, async () => {
      const data = await fetchForge(apiBase, `/api/survival/firm-profiles?firm=${encodeURIComponent(firm)}`);
      const profile = Array.isArray(data) ? data[0] : data;
      if (!profile) return infoEmbed("Survival Score", `No profile found for firm: ${firm}`);
      return new EmbedBuilder()
        .setTitle(`Survival — ${firm}`)
        .setColor(0x00bfff)
        .addFields(
          { name: "Max Drawdown", value: String(profile.maxDrawdown ?? "N/A"), inline: true },
          { name: "Consistency Rule", value: String(profile.consistencyRule ?? "None"), inline: true },
          { name: "Payout Split", value: String(profile.payoutSplit ?? "N/A"), inline: true },
        )
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
    });
  }

  // /macro regime
  if (cmd === "macro" && sub === "regime") {
    return safeReply(interaction, async () => {
      const data = await fetchForge(apiBase, "/api/macro/current");
      return new EmbedBuilder()
        .setTitle("Current Macro Regime")
        .setColor(statusColor(data.regime || "info"))
        .addFields(
          { name: "Regime", value: String(data.regime ?? "Unknown"), inline: true },
          { name: "Confidence", value: data.confidence != null ? `${(data.confidence * 100).toFixed(0)}%` : "N/A", inline: true },
          { name: "VIX", value: String(data.vix ?? "N/A"), inline: true },
          { name: "Rates", value: String(data.rates ?? "N/A"), inline: true },
          { name: "Calendar Events", value: truncate(data.calendarEvents?.join(", ") || "None"), inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
    });
  }

  // /macro calendar
  if (cmd === "macro" && sub === "calendar") {
    return safeReply(interaction, async () => {
      const data = await fetchForge<any[]>(apiBase, "/api/macro/calendar");
      if (!data.length) return infoEmbed("Macro Calendar", "No upcoming events.");
      const embed = new EmbedBuilder()
        .setTitle("Upcoming Economic Events")
        .setColor(0x00bfff)
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
      for (const ev of data.slice(0, 15)) {
        embed.addFields({
          name: ev.event || ev.name || "Event",
          value: [
            ev.date ? `Date: ${ev.date}` : null,
            ev.proximity ? `Proximity: ${ev.proximity}` : null,
            ev.impact ? `Impact: ${ev.impact}` : null,
          ]
            .filter(Boolean)
            .join(" | ") || "No details",
          inline: false,
        });
      }
      return embed;
    });
  }

  // /governor status <strategy>
  if (cmd === "governor" && sub === "status") {
    const strategyId = interaction.options.getString("strategy", true);
    return safeReply(interaction, async () => {
      const data = await fetchForge(apiBase, `/api/governor/status/${encodeURIComponent(strategyId)}`);
      const canTrade = data.canTrade ?? data.can_trade;
      return new EmbedBuilder()
        .setTitle(`Governor — ${strategyId}`)
        .setColor(canTrade ? 0x00ff00 : 0xff0000)
        .addFields(
          { name: "State", value: String(data.state ?? "Unknown"), inline: true },
          { name: "Size Multiplier", value: String(data.sizeMultiplier ?? data.size_multiplier ?? "N/A"), inline: true },
          { name: "Consecutive Losses", value: String(data.consecutiveLosses ?? data.consecutive_losses ?? 0), inline: true },
          { name: "Can Trade", value: canTrade ? "Yes" : "No", inline: true },
        )
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
    });
  }

  // /tournament latest
  if (cmd === "tournament" && sub === "latest") {
    return safeReply(interaction, async () => {
      const data = await fetchForge(apiBase, "/api/tournament/latest");
      if (!data) return infoEmbed("Tournament", "No tournament results found.");
      const verdict = data.verdict || "UNKNOWN";
      return new EmbedBuilder()
        .setTitle("Latest Tournament Result")
        .setColor(statusColor(verdict))
        .addFields(
          { name: "Candidate", value: String(data.candidate ?? data.strategyName ?? "N/A"), inline: true },
          { name: "Verdict", value: `**${verdict}**`, inline: true },
          { name: "Role Outputs", value: truncate(
            typeof data.roleOutputs === "object"
              ? Object.entries(data.roleOutputs).map(([k, v]) => `**${k}:** ${v}`).join("\n")
              : String(data.roleOutputs ?? "N/A"),
            1024,
          ), inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
    });
  }

  // /decay dashboard
  if (cmd === "decay" && sub === "dashboard") {
    return safeReply(interaction, async () => {
      const data = await fetchForge<any[]>(apiBase, "/api/decay/dashboard");
      if (!data.length) return infoEmbed("Decay Dashboard", "No decay data available.");
      const embed = new EmbedBuilder()
        .setTitle("Alpha Decay Dashboard")
        .setColor(0x00bfff)
        .setTimestamp()
        .setFooter({ text: "Trading Forge" });
      for (const s of data.slice(0, 25)) {
        embed.addFields({
          name: s.strategy || s.strategyId || s.name || "?",
          value: [
            s.quarantineLevel != null ? `Quarantine: ${s.quarantineLevel}` : null,
            s.decayScore != null ? `Decay Score: ${s.decayScore}` : null,
            s.halfLife != null ? `Half-life: ${s.halfLife}` : null,
          ]
            .filter(Boolean)
            .join(" | ") || "No data",
          inline: false,
        });
      }
      return embed;
    });
  }

  // /setup channel
  if (cmd === "setup" && sub === "channel") {
    const type = interaction.options.getString("type", true);
    const channel = interaction.options.getChannel("channel", true);

    if (!(type in channelMap)) {
      await interaction.reply({
        embeds: [errorEmbed(`Unknown alert type: ${type}`)],
        ephemeral: true,
      });
      return;
    }

    channelMap[type] = channel.id;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Channel Mapped")
          .setDescription(`Alert type **${type}** will now post to <#${channel.id}>`)
          .setColor(0x00ff00)
          .setTimestamp()
          .setFooter({ text: "Trading Forge" }),
      ],
      ephemeral: true,
    });
  }
}
