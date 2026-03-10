/**
 * Trading Forge CLI
 *
 * Usage:
 *   npm run forge -- data pipeline --symbol ES --start 2020-01-01 --end 2025-01-01
 *   npm run forge -- data cost --symbol ES --start 2020-01-01 --end 2025-01-01
 */

import "dotenv/config";
import { spawn } from "child_process";
import { resolve } from "path";

const SCRIPTS_DIR = resolve(import.meta.dirname ?? ".", "../src/data/scripts");
const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..");

function findPython(): string {
  return process.platform === "win32" ? "python" : "python3";
}

function runPython(script: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const python = findPython();
    const scriptPath = `${SCRIPTS_DIR}/${script}`;

    const proc = spawn(python, [scriptPath, ...args], {
      stdio: "inherit",
      env: process.env,
    });

    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (err) => {
      if (python === "python") {
        // Retry with python3
        const proc2 = spawn("python3", [scriptPath, ...args], {
          stdio: "inherit",
          env: process.env,
        });
        proc2.on("close", (code) => resolve(code ?? 1));
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Trading Forge CLI

Commands:
  data pipeline     Run full data pipeline (download, adjust, upload)
  data cost         Check download cost (dry-run)
  backtest run      Run a single backtest
  backtest wf       Run walk-forward validation
  backtest list     List recent backtests (requires running server)

Options for data commands:
  --symbol <SYM>    Symbol (ES, NQ, CL)
  --start <DATE>    Start date (YYYY-MM-DD)
  --end <DATE>      End date (YYYY-MM-DD)
  --max-cost <USD>  Max cost per symbol (default: 50)

Options for backtest commands:
  --config <JSON>   Strategy config JSON string
  --start <DATE>    Start date (YYYY-MM-DD)
  --end <DATE>      End date (YYYY-MM-DD)
  --splits <N>      Walk-forward splits (default: 5)
`);
    return;
  }

  const [domain, command, ...rest] = args;

  if (domain === "data") {
    if (command === "pipeline") {
      const code = await runPython("run_pipeline.py", rest);
      process.exit(code);
    } else if (command === "cost") {
      const code = await runPython("run_pipeline.py", [...rest, "--cost-only"]);
      process.exit(code);
    } else {
      console.error(`Unknown data command: ${command}`);
      process.exit(1);
    }
  } else if (domain === "backtest") {
    if (command === "run" || command === "wf") {
      const configIdx = rest.indexOf("--config");
      const startIdx = rest.indexOf("--start");
      const endIdx = rest.indexOf("--end");
      const splitsIdx = rest.indexOf("--splits");

      if (configIdx === -1) {
        console.error("Missing --config <JSON>");
        process.exit(1);
      }

      const strategyConfig = rest[configIdx + 1];
      const startDate = startIdx !== -1 ? rest[startIdx + 1] : "2023-01-01";
      const endDate = endIdx !== -1 ? rest[endIdx + 1] : "2023-12-31";
      const splits = splitsIdx !== -1 ? rest[splitsIdx + 1] : "5";

      const mode = command === "wf" ? "walkforward" : "single";
      const backtestRequest = JSON.stringify({
        strategy: JSON.parse(strategyConfig),
        start_date: startDate,
        end_date: endDate,
        mode,
        walk_forward_splits: Number(splits),
      });

      const python = findPython();
      const code = await new Promise<number>((res, rej) => {
        const proc = spawn(
          python,
          ["-m", "src.engine.backtester", "--config", backtestRequest, "--mode", mode],
          { stdio: "inherit", env: process.env, cwd: PROJECT_ROOT }
        );
        proc.on("close", (c) => res(c ?? 1));
        proc.on("error", (err) => {
          if (python === "python") {
            const proc2 = spawn(
              "python3",
              ["-m", "src.engine.backtester", "--config", backtestRequest, "--mode", mode],
              { stdio: "inherit", env: process.env, cwd: PROJECT_ROOT }
            );
            proc2.on("close", (c) => res(c ?? 1));
            proc2.on("error", () => rej(err));
          } else {
            rej(err);
          }
        });
      });
      process.exit(code);
    } else if (command === "list") {
      console.log("Use: curl http://localhost:4000/api/backtests");
      process.exit(0);
    } else {
      console.error(`Unknown backtest command: ${command}`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown domain: ${domain}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
