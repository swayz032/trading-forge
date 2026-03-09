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

interface DatabentoConfig {
  apiKey: string;
  outputDir: string;
}

interface FetchRequest {
  dataset: string; // e.g., "GLBX.MDP3" (CME Globex)
  symbols: string[]; // e.g., ["ES.FUT", "NQ.FUT"]
  schema: "trades" | "ohlcv-1m" | "ohlcv-1h" | "ohlcv-1d";
  startDate: string; // ISO date
  endDate: string;
  outputFormat: "parquet" | "csv";
}

export function createDatabentoFetcher(config: DatabentoConfig) {
  const { apiKey, outputDir } = config;

  async function fetchHistorical(request: FetchRequest): Promise<string> {
    // Databento Python SDK is the primary interface
    // Node spawns Python subprocess for downloads
    const script = `
import databento as db
client = db.Historical("${apiKey}")
data = client.timeseries.get_range(
    dataset="${request.dataset}",
    symbols=${JSON.stringify(request.symbols)},
    schema="${request.schema}",
    start="${request.startDate}",
    end="${request.endDate}",
)
output_path = "${outputDir}/${request.symbols[0]}_${request.schema}_${request.startDate}_${request.endDate}.parquet"
data.to_parquet(output_path)
print(output_path)
`;

    return new Promise((resolve, reject) => {
      const proc = spawn("python3", ["-c", script]);
      let output = "";
      let error = "";

      proc.stdout.on("data", (data) => (output += data.toString()));
      proc.stderr.on("data", (data) => (error += data.toString()));
      proc.on("close", (code) => {
        if (code === 0) resolve(output.trim());
        else reject(new Error(`Databento fetch failed: ${error}`));
      });
    });
  }

  async function getCost(request: FetchRequest): Promise<number> {
    // Check cost before downloading to preserve credits
    const script = `
import databento as db
client = db.Historical("${apiKey}")
cost = client.metadata.get_cost(
    dataset="${request.dataset}",
    symbols=${JSON.stringify(request.symbols)},
    schema="${request.schema}",
    start="${request.startDate}",
    end="${request.endDate}",
)
print(cost)
`;

    return new Promise((resolve, reject) => {
      const proc = spawn("python3", ["-c", script]);
      let output = "";
      proc.stdout.on("data", (data) => (output += data.toString()));
      proc.on("close", (code) => {
        if (code === 0) resolve(parseFloat(output.trim()));
        else reject(new Error("Cost check failed"));
      });
    });
  }

  return { fetchHistorical, getCost };
}
