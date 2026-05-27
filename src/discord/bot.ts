import "../server/load-env.js";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  TextChannel,
  AttachmentBuilder,
} from "discord.js";
import { resolve as pathResolve } from "path";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { dirname } from "path";
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

// ─── Pidfile singleton lock (Wave 26 Pass G fix 2026-05-26) ─────────────
// Prevents two bot processes from connecting to the Discord gateway with the
// same token, which causes double-replies to every #slumdawg-feed message.
// NSSM restarts sometimes leave the old node child alive for a few seconds
// while the new one connects; without this lock, both fire on messageCreate.
const BOT_PIDFILE = "C:\\Users\\tonio\\bin\\tf-logs\\discord-bot.pid";
function acquireBotSingletonLock() {
  try { mkdirSync(dirname(BOT_PIDFILE), { recursive: true }); } catch {}

  // Atomic exclusive-create. If two processes race here, exactly ONE wins.
  try {
    writeFileSync(BOT_PIDFILE, String(process.pid), { flag: "wx" });
  } catch {
    // Someone else holds the lock — check if they're alive
    let oldPid: number | null = null;
    try { oldPid = parseInt(readFileSync(BOT_PIDFILE, "utf8").trim(), 10); } catch {}
    if (oldPid && Number.isFinite(oldPid) && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0); // signal 0 = check alive
        log.warn({ oldPid, ourPid: process.pid }, "Discord bot pidfile owned by live process — exiting to avoid double-gateway-session");
        process.exit(0);
      } catch {
        // Old pid is dead — stale pidfile, take over
        try { unlinkSync(BOT_PIDFILE); } catch {}
        writeFileSync(BOT_PIDFILE, String(process.pid), { flag: "wx" });
      }
    }
  }

  // Wmic kill removed 2026-05-26: it terminated the tsx parent wrapper of
  // THIS process (ProcessId!=current excluded self but not parent), causing
  // bot to suicide-loop. Atomic pidfile lock above is sufficient now that
  // PM2 duplicates are deleted (see memory: pm2-vs-nssm-supervisor-conflict).

  const cleanup = () => { try { unlinkSync(BOT_PIDFILE); } catch {} };
  process.on("exit", cleanup);
  process.on("SIGINT",  () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  log.info({ pid: process.pid, pidfile: BOT_PIDFILE }, "Discord bot singleton lock acquired");
}
acquireBotSingletonLock();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Wave 26 Pass G — Slumdawg #slumdawg-feed YouTube URL watcher
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — must be enabled in dev portal
  ],
});

// In-handler dedupe — even if two processes briefly coexist, each msg.id only
// gets one reply per process. Map auto-evicts entries older than 60s.
const recentlyHandledMsgIds = new Map<string, number>();
const DEDUPE_TTL_MS = 60_000;
function alreadyHandled(messageId: string): boolean {
  const now = Date.now();
  for (const [k, t] of recentlyHandledMsgIds) {
    if (t < now - DEDUPE_TTL_MS) recentlyHandledMsgIds.delete(k);
  }
  if (recentlyHandledMsgIds.has(messageId)) return true;
  recentlyHandledMsgIds.set(messageId, now);
  return false;
}

// ─── Slumdawg #slumdawg-feed YouTube URL intake (Wave 26 Pass G) ───────
// Community pastes YouTube link, bot ingests via existing /api/admin/slumdawg/ingest-youtube
const SLUMDAWG_FEED_CHANNEL_ID =
  process.env.DISCORD_CH_SLUMDAWG_FEED || "1482571931222937642";
const YOUTUBE_URL_RE =
  /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s]*v=[A-Za-z0-9_-]{11}|youtu\.be\/[A-Za-z0-9_-]{11})[^\s]*/i;

// Slumdawg voice — keyed responses, never speak raw audit text.
// Goal: street, gritty, calm. Same persona as Anam avatar.
function slumdawgAck(): string {
  const opts = [
    "Yo fam, caught it. About to cook this up in the lab — hit you back when it's done.",
    "Yo fam, got the link. Heading to the lab now — back at you in like two minutes.",
    "Yo fam, taking this to the kitchen. Holler at you when it's done cooking.",
    "Yo fam, locked in. Cooking this one up now — back in two.",
  ];
  return opts[Math.floor(Math.random() * opts.length)];
}

// Plain-English translations for community (matches Anam persona prompt)
function humanizeRegime(r: string | null | undefined): string {
  const map: Record<string, string> = {
    RANGE_BOUND: "bouncing in a box", TRENDING_UP: "climbing", TRENDING_DOWN: "dropping",
    EXPANSION: "making big moves", COMPRESSION: "winding up tight, about to pop",
    HIGH_VOL_MACRO: "wild from news", LOW_LIQ_CHOP: "dead between sessions",
  };
  return r ? (map[r] ?? r.toLowerCase().replace(/_/g, " ")) : "any market mood";
}
function humanizeSymbol(s: string): string {
  return ({ MES: "Mini S&P", MNQ: "Mini Nasdaq", MCL: "Mini Crude" } as Record<string, string>)[s] ?? s;
}
function humanizeFactor(f: string): string {
  const map: Record<string, string> = {
    structural_setup: "the trend pattern lining up",
    volume_confirmation: "volume confirming the move",
    vp_shape: "the volume profile pattern",
    vwap_alignment: "price agreeing with the daily average",
    killzone_active: "in the prime trading hour",
    delta_or_volume_signature: "big money footprint showing up",
    macro_alignment: "not in a news blackout",
    smt_confirmation: "S&P and Nasdaq agreeing",
    regime_match: "market mood matches the playbook",
    liquidity_target_clear: "a clear target on the way",
    market_structure_aligned: "the chart structure lining up",
  };
  return map[f] ?? f.replace(/_/g, " ");
}
function humanizeTrigger(t: string | null | undefined): string {
  const map: Record<string, string> = {
    break_of_structure: "trend breaking out",
    change_of_character: "trend cracking",
    fair_value_gap: "filling a price gap",
    liquidity_sweep: "stops getting hunted",
    order_block: "where big money parked orders",
    sma_crossover: "moving averages crossing",
    ema_crossover: "moving averages crossing",
    opening_range_breakout: "first hour breaking out",
    session_open_breakout: "open price breaking out",
  };
  return t ? (map[t] ?? t.replace(/_/g, " ")) : "—";
}
function humanizeLifecycle(s: string): string {
  return ({
    CANDIDATE: "🆕 just signed",
    TESTING: "🔬 in practice",
    PAPER: "📋 preseason",
    DEPLOY_READY: "✅ coach reviewing tape",
    PILOT: "🏀 bench minutes",
    DEPLOYED: "🔥 starter with real money",
  } as Record<string, string>)[s] ?? s.toLowerCase();
}

type IngestResult = {
  baby_jargon_summary?: string;
  error?: string;
  results?: Array<{ status?: string; title?: string; idea_count?: number; reason?: string; video_id?: string; ideas?: Array<{ idea_name?: string; concept_name?: string; preferred_regime?: string; entry_indicator?: string; confluence_factors?: string[] }> }>;
  ingest_result?: { status?: string; title?: string; idea_count?: number; reason?: string; video_id?: string; ideas?: Array<{ idea_name?: string; concept_name?: string; preferred_regime?: string; entry_indicator?: string; confluence_factors?: string[] }> };
  drain?: { scanned: number; drained: number; failed: number } | null;
  graduated_strategies?: Array<{
    id: string;
    name: string;
    symbols: string[];
    lifecycleState: string;
    useWeightedScoring?: boolean | null;
    exitPlanConfig?: { exit_style?: string } | null;
    preferredRegimes?: string[] | null;
    dailyTf?: string | null; htfTf?: string | null; itfTf?: string | null; triggerTf?: string | null;
    entryQuality?: { confluence_factors?: string[]; min_factors_satisfied?: number } | null;
  }>;
};

// Brand thumbnail (Slumdawg robot stirring the backtesting pot)
const SLUMDAWG_THUMB_PATH = pathResolve(process.cwd(), "assets/discord/slumdawg-backtesting-pot.png");
const SLUMDAWG_THUMB_NAME = "slumdawg-backtesting-pot.png";
const SLUMDAWG_THUMB_AVAILABLE = existsSync(SLUMDAWG_THUMB_PATH);

// Brand palette (Trading Forge emerald-on-near-black)
const SLUMDAWG_COLOR = {
  success: 0x10b981,  // emerald — strategy extracted
  hype:    0xf59e0b,  // amber — hype / no real rules
  swing:   0x6b7280,  // gray — swing/screenshot reject
  error:   0xef4444,  // red — system error
  info:    0x3b82f6,  // blue — processing/info
};

// ET wall-clock formatter — operator + family are intraday traders, ET is the
// only timezone that matters (CME open 09:30, lunch dead zone 11:30-13:30,
// flatten 15:55). Discord's default setTimestamp() renders local browser time
// which is useless for "was this an AM trade or PM trade?" debugging.
function nowEtFooter(): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "numeric", minute: "2-digit", hour12: true,
  });
  const t = fmt.format(new Date()); // "Tue, 9:42 PM"
  return `Slumdawg Kitchen · ${t} ET`;
}

// Compact video header — title only, no quoted/italic block (cleaner stack).
function videoHeaderField(title: string | undefined): { name: string; value: string; inline: false } | null {
  if (!title) return null;
  return { name: "🎬 Video", value: `**${title.slice(0, 200).trim()}**`, inline: false };
}

// Build the rich verdict embed — replaces plain text reply.
// Voice: Slumdawg — slang TONE + PHRASING ("Yo fam", "Slumdawg passed on this one",
// "send me", "no fluff") but PLAIN ENGLISH WORDS. Members are non-technical rookies
// to trading — NEVER use trading jargon (theta, Greeks, carry trade, dividend capture,
// trailing drawdown, intraday, indicator-as-noun, structural setup). When a concept
// must be mentioned (futures, swing, options), explain it in one short clause.
function buildSlumdawgVerdictEmbed(result: IngestResult, sourceUrl: string): EmbedBuilder {
  const e = new EmbedBuilder()
    .setTimestamp()                             // machine-readable; UI also renders our human footer below
    .setFooter({ text: nowEtFooter() });        // human-readable: "Slumdawg Kitchen · Tue, 9:42 PM ET"
  if (SLUMDAWG_THUMB_AVAILABLE) e.setImage(`attachment://${SLUMDAWG_THUMB_NAME}`);

  // ─── Error path ─────────────────────────────────────────
  if (result.error) {
    e.setColor(SLUMDAWG_COLOR.error).setTitle("⚠️ System hiccup");
    if (/invalid_url/i.test(result.error)) {
      e.setDescription("Yo fam, that's not a YouTube link. Send me a `youtube.com` or `youtu.be` link.");
    } else {
      e.setDescription(`Slumdawg hit a snag on the back end — \`${result.error.replace(/_/g, " ")}\`.\nWait a minute and try again, or message the operator if it keeps happening.`);
    }
    return e;
  }

  const r = result.ingest_result ?? result.results?.[0];
  if (!r) {
    return e
      .setColor(SLUMDAWG_COLOR.error)
      .setTitle("⚠️ Empty pipeline")
      .setDescription("Came back with nothing. Try again.");
  }

  // ─── Strategy extracted (the win) ───────────────────────
  if ((r.idea_count ?? 0) > 0 && (r.status === "ingested" || r.status === "graduated" || r.status === "extracted" || r.status === "ok")) {
    const firstIdea = r.ideas?.[0];
    const grads = result.graduated_strategies ?? [];
    const stratCount = grads.length;

    const moodLine = humanizeRegime(firstIdea?.preferred_regime);
    const triggerLine = humanizeTrigger(firstIdea?.entry_indicator);
    const factorBullets = (firstIdea?.confluence_factors ?? []).slice(0, 4).map(f => `  • ${humanizeFactor(f)}`).join("\n") || "  • —";

    // Plain-English labels — no trading jargon.
    const takeLines: string[] = [
      `**The kind of market he wants:** ${moodLine}`,
    ];
    if (firstIdea?.entry_indicator) takeLines.push(`**What he waits for before pulling the trigger:** ${triggerLine}`);
    takeLines.push(`**What needs to line up first:**\n${factorBullets}`);

    e.setColor(SLUMDAWG_COLOR.success)
      .setTitle(stratCount > 0
        ? `🔥 Slumdawg cooked it — ${stratCount} ${stratCount === 1 ? "play" : "plays"} in the kitchen`
        : `🔥 Slumdawg cooked it — play extracted`)
      .setDescription(
        `Yo fam, Slumdawg pulled real rules out of this one.\n` +
        (stratCount > 0
          ? `Got **${stratCount}** ${stratCount === 1 ? "play" : "plays"} in the kitchen right now — each one running on a different market.\nEach one is gonna get stress-tested against the worst trading days in history. We'll know in about a day if they hold up with real money.`
          : `Kitchen picks it up on the next cycle (about 10 minutes).`)
      );

    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    e.addFields({ name: "📊 Slumdawg's Take", value: takeLines.join("\n"), inline: false });

    if (stratCount > 0) {
      const playLines = grads.slice(0, 6).map((s) => {
        const symHuman = (s.symbols ?? []).map(humanizeSymbol).join(" / ") || "—";
        return `• **${symHuman}** — ${humanizeLifecycle(s.lifecycleState)}`;
      }).join("\n");
      e.addFields({ name: `🍳 The Plays`, value: playLines, inline: false });
      e.addFields({
        name: "🏆 What's Next",
        value: "Stress test first — Slumdawg makes sure each play survives the worst trading days in history before it ever sees real money. Then a 30-day backtest. Verdict comes back in about a day.",
        inline: false,
      });
    } else {
      e.addFields({
        name: "🍳 What's Next",
        value: "Kitchen's about to fan this out into 3 plays — one for the **Mini S&P 500**, one for the **Mini Nasdaq 100**, one for **Mini Crude Oil**. Each one runs through the stress test plus a 30-day backtest. Check back in about an hour.",
        inline: false,
      });
    }
    return e;
  }

  // ─── Hype / no real rules ───────────────────────────────
  if (r.reason && /no_strategy_content|no_rules|too_vague|hype/i.test(r.reason)) {
    e.setColor(SLUMDAWG_COLOR.hype)
      .setTitle("🚧 Mostly talk, not enough rules")
      .setDescription(
        "Yo, the speaker hyped it up but never actually told us **how to trade it**.\n\n" +
        "A real strategy needs to say:\n" +
        "• **when to buy or sell**\n" +
        "• **when to close the trade**\n" +
        "• **what chart he's looking at** (5-minute? 15-minute?)\n\n" +
        "Send me a video where the trader walks through it step by step, no fluff."
      );
    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    return e;
  }

  // ─── Swing / multi-day reject ───────────────────────────
  if (r.status === "rejected_swing_or_screenshot" || (r.reason && /swing|multi_day|overnight|screenshot|recap/i.test(r.reason))) {
    e.setColor(SLUMDAWG_COLOR.swing)
      .setTitle("🌙 Swing trade — we close every day")
      .setDescription(
        "Yo fam, that one's a **swing trade** — meaning the speaker holds the trade for days or weeks.\n\n" +
        "We can't do that. Our prop firm rules say every trade has to close **before the market shuts down each day** (by **3:55 PM Eastern**). Holding overnight will get the account shut down.\n\n" +
        "Send me a video where the trader takes the trade and closes it the **same day** — quick in, quick out."
      );
    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    return e;
  }

  // ─── Transcript unavailable / too short ─────────────────
  if (r.reason && /transcript_unavailable|no.*caption|transcript_too_short|too short/i.test(r.reason)) {
    e.setColor(SLUMDAWG_COLOR.swing)
      .setTitle("📭 Can't read that one");
    if (/too short/i.test(r.reason)) {
      e.setDescription("That video's too short to pull real trading rules out of — probably a TikTok-style clip.\nSend me a longer one where the trader actually walks through the strategy.");
    } else {
      e.setDescription("Couldn't pull the captions on that video. Might be private, age-restricted, or just missing a transcript.\nTry a different one.");
    }
    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    return e;
  }

  // ─── Wave 26 Pass J — mechanic-class rejects (rookie-friendly, no jargon) ──
  if (r.reason === "options_derivative") {
    e.setColor(SLUMDAWG_COLOR.swing)
      .setTitle("📊 That's options trading — different game")
      .setDescription(
        "Yo, that one's about **options trading** — a totally different game from what we play.\n\n" +
        "We trade **futures**, which means we're just betting on whether a price will go up or down. Options have a bunch of extra moving parts (time decay, strike prices, all that) that don't apply to us.\n\n" +
        "Send me a video where the trader is just **reading a price chart** and saying \"when this happens, I buy\" — that's the kind I can use."
      );
    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    return e;
  }
  if (r.reason === "forex_specific_mechanics") {
    e.setColor(SLUMDAWG_COLOR.swing)
      .setTitle("💱 That's a currency-trading strategy")
      .setDescription(
        "Yo fam, that strategy is built for **currency trading (forex)** — like betting on the Euro vs the Dollar.\n\n" +
        "The way they're making money in this one only works in currency markets, not the ones we trade.\n\n" +
        "If the same person has another video where they're **just reading a price chart**, send me that one — it'll probably work."
      );
    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    return e;
  }
  if (r.reason === "stock_specific_mechanics") {
    e.setColor(SLUMDAWG_COLOR.swing)
      .setTitle("📈 That's an individual-stock strategy")
      .setDescription(
        "Yo, that one's about trading **individual stocks** like Apple, Tesla, or GameStop.\n\n" +
        "The moves they're trying to catch (earnings announcements, dividend payments, short squeezes) only happen with stocks — they don't exist in the markets we trade.\n\n" +
        "If they have a video where they're **just reading a price chart** with no mention of company news, send me that one."
      );
    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    return e;
  }
  if (r.reason === "crypto_specific_mechanics") {
    e.setColor(SLUMDAWG_COLOR.swing)
      .setTitle("🪙 That's a crypto-only strategy")
      .setDescription(
        "Yo fam, that strategy only works in **crypto markets** (Bitcoin, Ethereum, that whole world).\n\n" +
        "They're using stuff that's specific to crypto — blockchain data, the Bitcoin halving, 24/7 trading. Our markets work different.\n\n" +
        "If the same speaker has a video where they're **just reading a price chart**, send me that one. That one works."
      );
    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    return e;
  }

  // ─── Generic reject ─────────────────────────────────────
  if (r.reason) {
    e.setColor(SLUMDAWG_COLOR.hype)
      .setTitle("🤔 Slumdawg passed on this one")
      .setDescription(`Reason: \`${r.reason.replace(/_/g, " ")}\`.\nSend me a different video.`);
    const vh = videoHeaderField(r.title);
    if (vh) e.addFields(vh);
    return e;
  }

  // ─── Fallback ───────────────────────────────────────────
  return e
    .setColor(SLUMDAWG_COLOR.info)
    .setTitle("📊 Result")
    .setDescription(result.baby_jargon_summary ?? `Got back status \`${r.status ?? "unknown"}\`.\nCheck the dashboard library.`);
}

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

// ─── #slumdawg-feed YouTube URL intake (Wave 26 Pass G) ──────
// Watch the community channel; on YouTube URL, ingest via existing endpoint.
// Voice-first Anam avatar can't accept long URLs, so this is the text path.
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (msg.channelId !== SLUMDAWG_FEED_CHANNEL_ID) return;

    const m = msg.content.match(YOUTUBE_URL_RE);
    if (!m) return;
    if (alreadyHandled(msg.id)) {
      log.warn({ msgId: msg.id }, "slumdawg-feed: duplicate messageCreate event suppressed");
      return;
    }
    const url = m[0];

    // Acknowledge immediately
    try { await msg.react("✅"); } catch {}
    const ack = await msg.reply(slumdawgAck());

    // HMAC sign + POST to local ingest proxy (same box, same secret)
    const secret = process.env.SLUMDAWG_WEBHOOK_SECRET || "";
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ url });
    const sig = secret
      ? createHash("sha256").update(`${ts}.${body}.${secret}`).digest("hex")
      : "";

    const resp = await fetch(`${FORGE_API}/api/admin/slumdawg/ingest-youtube`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sig ? { "X-Slumdawg-Signature": sig, "X-Slumdawg-Timestamp": ts } : {}),
      },
      body,
      signal: AbortSignal.timeout(180_000),
    });

    const result = (await resp.json().catch(() => ({}))) as IngestResult;
    const embed = buildSlumdawgVerdictEmbed(result, url);
    const editPayload: { content: null; embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { content: null, embeds: [embed] };
    if (SLUMDAWG_THUMB_AVAILABLE) {
      editPayload.files = [new AttachmentBuilder(SLUMDAWG_THUMB_PATH, { name: SLUMDAWG_THUMB_NAME })];
    }
    await ack.edit(editPayload).catch(() => {});
  } catch (err) {
    log.error({ err, channel: msg.channelId, msgId: msg.id }, "slumdawg-feed handler failed");
    try { await msg.reply("System tripped on that one — operator gonna look at it."); } catch {}
  }
});

client.on("error", (err) => {
  log.error({ err }, "Discord client connection error");
});

// ─── Start ──────────────────────────────────────────────────
client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
  log.error({ err }, "Failed to login to Discord");
});

export { client, CHANNEL_MAP };
