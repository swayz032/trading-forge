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
  data pipeline   Run full data pipeline (download, adjust, upload)
  data cost       Check download cost (dry-run)

Options for data commands:
  --symbol <SYM>    Symbol (ES, NQ, CL)
  --start <DATE>    Start date (YYYY-MM-DD)
  --end <DATE>      End date (YYYY-MM-DD)
  --max-cost <USD>  Max cost per symbol (default: 50)
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
  } else {
    console.error(`Unknown domain: ${domain}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
