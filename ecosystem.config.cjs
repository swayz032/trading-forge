// PM2 Ecosystem Config — Trading Forge Auto-Pilot
// Manages: API server, Discord bot, OpenClaw gateway
// All services auto-restart on crash with exponential backoff.
// Usage: pm2 start ecosystem.config.cjs && pm2 save

const path = require("path");

const PROJECT_DIR = "C:\\Users\\tonio\\Projects\\trading-forge\\trading-forge";

module.exports = {
  apps: [
    // ─── Trading Forge API (port 4000) ──────────────────────
    {
      name: "trading-forge-api",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/server/index.ts",
      cwd: PROJECT_DIR,
      interpreter: "node",
      windowsHide: true,
      env: {
        NODE_ENV: "development",
        PORT: "4000",
      },
      // Restart policy
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 2000,         // 2s base delay
      exp_backoff_restart_delay: 1000, // Exponential backoff starting at 1s
      max_memory_restart: "1G",
      // Logging
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(PROJECT_DIR, "logs/api-error.log"),
      out_file: path.join(PROJECT_DIR, "logs/api-out.log"),
      merge_logs: true,
    },

    // ─── Discord Bot (port 4100) ────────────────────────────
    {
      name: "discord-bot",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/discord/bot.ts",
      cwd: PROJECT_DIR,
      interpreter: "node",
      windowsHide: true,
      env: {
        NODE_ENV: "development",
      },
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 3000,
      exp_backoff_restart_delay: 1500,
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(PROJECT_DIR, "logs/discord-error.log"),
      out_file: path.join(PROJECT_DIR, "logs/discord-out.log"),
      merge_logs: true,
    },

    // ─── OpenClaw Gateway (port 18789) ──────────────────────
    {
      name: "openclaw-gateway",
      script: "C:\\Users\\tonio\\AppData\\Roaming\\npm\\node_modules\\openclaw\\dist\\index.js",
      args: "gateway --port 18789",
      interpreter: "node",
      windowsHide: true,
      env: {
        OPENCLAW_SERVICE: "v2026.3.13",
        OLLAMA_API_KEY: "ollama",
        BRAVE_API_KEY: "BSA-12bUd_kRylS3PUt7rSOahkSoQ-3",
        TAVILY_API_KEY: "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",
        DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || "",
      },
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      max_memory_restart: "1G",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(PROJECT_DIR, "logs/openclaw-error.log"),
      out_file: path.join(PROJECT_DIR, "logs/openclaw-out.log"),
      merge_logs: true,
    },
  ],
};
