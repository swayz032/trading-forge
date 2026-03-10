/**
 * Databento Data Fetcher
 *
 * Role: Historical bulk data downloads for backtesting
 * - Institutional-grade tick data for futures (CME, NASDAQ)
 * - Download once → save as Parquet to S3 → backtest forever
 * - Budget: $125 credits — prioritize ES, NQ, CL
 *
 * API Docs: https://docs.databento.com
 * Supported: ES, NQ, YM, RTY, CL, GC, SI, ZB, ZN, 6E, 6J
 */

import { spawn } from "child_process";
import { resolve } from "path";

const SCRIPT_PATH = resolve(
  import.meta.dirname ?? ".",
  "../scripts/databento_download.py"
);

interface DownloadResult {
  status: string;
  path?: string;
  rows?: number;
  columns?: string[];
  cost_usd?: number;
  mode?: string;
  message?: string;
}

function runPythonScript(args: string[]): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    // Try python first (Windows), fall back to python3
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, [SCRIPT_PATH, ...args], {
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));
    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse output: ${stdout}`));
        }
      } else {
        reject(new Error(`Databento script failed (exit ${code}): ${stderr}`));
      }
    });
    proc.on("error", (err) => {
      if (pythonCmd === "python") {
        // Retry with python3
        const proc2 = spawn("python3", [SCRIPT_PATH, ...args], {
          env: { ...process.env },
        });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (data) => (stdout2 += data.toString()));
        proc2.stderr.on("data", (data) => (stderr2 += data.toString()));
        proc2.on("close", (code) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(stdout2.trim()));
            } catch {
              reject(new Error(`Failed to parse output: ${stdout2}`));
            }
          } else {
            reject(new Error(`Databento script failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

export function createDatabentoFetcher(config: { outputDir: string }) {
  const { outputDir } = config;

  async function fetchHistorical(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<DownloadResult> {
    return runPythonScript([
      "--symbol", symbol,
      "--start", startDate,
      "--end", endDate,
      "--output-dir", outputDir,
    ]);
  }

  async function getCost(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const result = await runPythonScript([
      "--symbol", symbol,
      "--start", startDate,
      "--end", endDate,
      "--output-dir", outputDir,
      "--dry-run",
    ]);
    if (result.status === "error") {
      throw new Error(result.message ?? "Cost check failed");
    }
    return result.cost_usd ?? 0;
  }

  return { fetchHistorical, getCost };
}
