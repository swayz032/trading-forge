/**
 * Regime Service — Python subprocess bridge for regime detection.
 * Same pattern as backtest-service.ts.
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { logger } from "../index.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

export interface RegimeResult {
  regime: string;
  adx: number;
  atr_percentile: number;
  ma_slope: number;
  confidence: number;
  symbol?: string;
  timeframe?: string;
  error?: string;
}

function runPythonRegime(configJson: string): Promise<RegimeResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.regime", "--config", configJson];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "regime-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse regime output: ${stdout}`));
        }
      } else {
        reject(new Error(`Regime detection failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      if (pythonCmd === "python") {
        const proc2 = spawn("python3", args, {
          env: { ...process.env },
          cwd: PROJECT_ROOT,
        });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (data) => (stdout2 += data.toString()));
        proc2.stderr.on("data", (data) => (stderr2 += data.toString()));
        proc2.on("close", (code) => {
          if (code === 0) {
            try { resolve(JSON.parse(stdout2.trim())); }
            catch { reject(new Error(`Failed to parse: ${stdout2}`)); }
          } else {
            reject(new Error(`Regime detection failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

export async function analyzeMarket(
  symbol: string,
  timeframe: string = "1h",
  adxPeriod: number = 14,
): Promise<RegimeResult> {
  const config = JSON.stringify({ symbol, timeframe, adx_period: adxPeriod });
  return runPythonRegime(config);
}
