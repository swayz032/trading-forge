// PM2 Ecosystem Config — Trading Forge Auto-Pilot
// API/Discord/Relay are NSSM services — do not add to PM2 (decision locked 2026-06-22 per audit wf_06574188-392).
// PM2 manages ONLY: openclaw-gateway
// Usage: pm2 start ecosystem.config.cjs --only openclaw-gateway && pm2 save

const path = require("path");

const PROJECT_DIR = "C:\\Users\\tonio\\Projects\\trading-forge\\trading-forge";

module.exports = {
  apps: [
    // ─── OpenClaw Gateway (port 18789) ──────────────────────
    {
      name: "openclaw-gateway",
      script: "C:\\Users\\tonio\\AppData\\Roaming\\npm\\node_modules\\openclaw\\dist\\index.js",
      args: "gateway --port 18789",
      interpreter: "node",
      windowsHide: true,
      env: {
        OPENCLAW_SERVICE: "v2026.3.13",
        OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || "ollama",
        BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
        TAVILY_API_KEY: process.env.TAVILY_API_KEY || "",
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
