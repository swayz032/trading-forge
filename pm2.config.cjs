/**
 * PM2 Process Manager — Auto-restart for 24/7 operation.
 *
 * Usage:
 *   npx pm2 start pm2.config.cjs
 *   npx pm2 logs trading-forge
 *   npx pm2 status
 *   npx pm2 restart trading-forge
 *   npx pm2 stop trading-forge
 *
 * Install PM2 globally for startup persistence:
 *   npm install -g pm2
 *   pm2 start pm2.config.cjs
 *   pm2 save
 *   pm2 startup          # generates OS-level auto-start command
 */
module.exports = {
  apps: [
    {
      name: "trading-forge",
      script: "npm",
      args: "run dev",
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production",
      },
      // Structured log output — PM2 captures stdout/stderr
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
    },
  ],
};
