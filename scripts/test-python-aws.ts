import "dotenv/config";
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const configPath = join(tmpdir(), "test-py-aws.json");
const config = {
  strategy: {
    name: "test", symbol: "MES", timeframe: "5m",
    indicators: [], entry_long: "close > open", entry_short: "high < low",
    exit: "high < low", stop_loss: { type: "atr", multiplier: 1.5 },
    position_size: { type: "fixed", fixed_contracts: 1 },
  },
  start_date: "2024-01-01", end_date: "2024-01-31",
  commission_per_side: 0.62, max_trades_per_day: 2,
};
writeFileSync(configPath, JSON.stringify(config));

console.log("AWS_ACCESS_KEY_ID from process.env:", process.env.AWS_ACCESS_KEY_ID?.slice(0, 8) ?? "NOT SET");
console.log("Config path:", configPath);

const proc = spawn("python3", ["-m", "src.engine.backtester", "--config", configPath, "--mode", "single"], {
  env: process.env as Record<string, string>,
  cwd: process.cwd(),
});

let stderr = "";
proc.stdout.on("data", (d: Buffer) => process.stdout.write(d.toString()));
proc.stderr.on("data", (d: Buffer) => {
  const msg = d.toString();
  stderr += msg;
  process.stderr.write(msg);
});
proc.on("exit", (code: number | null) => {
  console.log("\nExit code:", code);
  if (stderr.length > 0 && code !== 0) {
    console.log("Full stderr:", stderr.slice(0, 3000));
  }
  process.exit(code ?? 1);
});
proc.on("error", (e: Error) => { console.error("Spawn error:", e); process.exit(1); });
