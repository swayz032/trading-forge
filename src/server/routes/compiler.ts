/**
 * Compiler Routes — Strategy DSL validation, compilation, and diffing.
 *
 * Follows the backtest-service.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { readFileSync } from "fs";
import { logger } from "../index.js";

export const compilerRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

// ─── Helper: run Python compiler subprocess ─────────────────────────

function runCompilerAction(action: string, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const inputJson = JSON.stringify(input);
    const args = [
      "-m", "src.engine.compiler.compiler",
      "--action", action,
      "--input", inputJson,
    ];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (stderr) {
        logger.warn({ action, stderr: stderr.trim() }, "Compiler stderr");
      }
      if (code !== 0) {
        try {
          const errResult = JSON.parse(stdout);
          reject(errResult);
        } catch {
          reject(new Error(`Compiler exited with code ${code}: ${stderr || stdout}`));
        }
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Invalid JSON from compiler: ${stdout.slice(0, 500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn compiler: ${err.message}`));
    });
  });
}

// ─── POST /api/compiler/validate — Validate a strategy DSL ─────────

compilerRoutes.post("/validate", async (req, res) => {
  try {
    const result = await runCompilerAction("validate", req.body);
    res.json(result);
  } catch (err: any) {
    if (err.errors) {
      res.status(400).json({ valid: false, errors: err.errors });
      return;
    }
    logger.error({ err }, "Compiler validate error");
    res.status(500).json({ error: "Compiler error", details: err.message });
  }
});

// ─── POST /api/compiler/compile — Compile DSL to backtest config ────

compilerRoutes.post("/compile", async (req, res) => {
  try {
    const result = await runCompilerAction("compile", req.body);
    res.json(result);
  } catch (err: any) {
    if (err.errors) {
      res.status(400).json({ error: "Validation failed", errors: err.errors });
      return;
    }
    logger.error({ err }, "Compiler compile error");
    res.status(500).json({ error: "Compiler error", details: err.message });
  }
});

// ─── GET /api/compiler/schema — Return current DSL JSON schema ──────

compilerRoutes.get("/schema", (_req, res) => {
  try {
    const schemaPath = pathResolve(
      PROJECT_ROOT,
      "src/engine/compiler/schema_versions/v1.json"
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    res.json(schema);
  } catch (err: any) {
    logger.error({ err }, "Failed to read schema");
    res.status(500).json({ error: "Failed to read schema", details: err.message });
  }
});

// ─── POST /api/compiler/diff — Diff two strategy DSLs ──────────────

compilerRoutes.post("/diff", async (req, res) => {
  const { a, b } = req.body;
  if (!a || !b) {
    res.status(400).json({ error: "Request body must contain 'a' and 'b' strategy DSLs" });
    return;
  }
  try {
    const result = await runCompilerAction("diff", { a, b });
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Compiler diff error");
    res.status(500).json({ error: "Compiler error", details: err.message });
  }
});
