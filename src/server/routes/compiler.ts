/**
 * Compiler Routes — Strategy DSL validation, compilation, and diffing.
 *
 * Follows the backtest-service.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { readFileSync } from "fs";
import { resolve as pathResolve } from "path";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";

export const compilerRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// ─── POST /api/compiler/validate — Validate a strategy DSL ─────────

compilerRoutes.post("/validate", async (req, res) => {
  try {
    const result = await runPythonModule({
      module: "src.engine.compiler.compiler",
      args: ["--action", "validate"],
      config: req.body,
      componentName: "compiler-validate",
    });
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
    const result = await runPythonModule({
      module: "src.engine.compiler.compiler",
      args: ["--action", "compile"],
      config: req.body,
      componentName: "compiler-compile",
    });
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
    const result = await runPythonModule({
      module: "src.engine.compiler.compiler",
      args: ["--action", "diff"],
      config: { a, b },
      componentName: "compiler-diff",
    });
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Compiler diff error");
    res.status(500).json({ error: "Compiler error", details: err.message });
  }
});
