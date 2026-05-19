// pm2 process definition for the tower-side relay WebSocket client.
// Run: pm2 start ecosystem-relay-client.cjs
//      pm2 save        (persist across pm2 restart)
//
// Replaces the Windows Scheduled Task `TradingForge-RelayClient`, which had
// process-lifetime issues (cmd.exe wrapper died with its launching shell).
// pm2 owns the process supervisor role for everything else on this tower
// (trading-forge-api, openclaw-gateway, discord-bot) so adding the relay
// client here keeps process management unified.
const fs = require("node:fs");
const path = require("node:path");

const tokenPath = path.join("C:\\", "Users", "tonio", "bin", "relay-token.txt");
const RELAY_TOKEN = fs.readFileSync(tokenPath, "utf8").trim();

module.exports = {
  apps: [
    {
      name: "tower-relay-client",
      script: "scripts/tower-relay-client.cjs",
      cwd: "C:\\Users\\tonio\\Projects\\trading-forge\\trading-forge",
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 9999,
      env: {
        RELAY_SERVER: "wss://tf-relay-production.up.railway.app/__relay",
        RELAY_TOKEN,
        RELAY_BACKEND: "http://localhost:4000",
      },
      out_file: "C:\\Users\\tonio\\bin\\tower-relay-client.log",
      error_file: "C:\\Users\\tonio\\bin\\tower-relay-client.err.log",
      merge_logs: true,
      time: false,
    },
  ],
};
