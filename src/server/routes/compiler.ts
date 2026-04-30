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
import { randomUUID } from "crypto";
import { runPythonModule } from "../lib/python-runner.js";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";

export const compilerRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? process.cwd(), "../../..");

async function persistCompilerAuditOrThrow(values: typeof auditLog.$inferInsert) {
  await db.insert(auditLog).values(values);
}

// ─── POST /api/compiler/validate — Validate a strategy DSL ─────────

// M9 helpers — standardize the response envelope so every consumer can
// treat compiler endpoints as { valid: bool, errors: string[], data?: ... }
function normalizeErrors(errs: unknown): string[] {
  if (!errs) return [];
  if (Array.isArray(errs)) {
    return errs.map((e) => (typeof e === "string" ? e : JSON.stringify(e)));
  }
  if (typeof errs === "string") return [errs];
  if (typeof errs === "object") return [JSON.stringify(errs)];
  return [String(errs)];
}

compilerRoutes.post("/validate", async (req, res) => {
  try {
    const result = await runPythonModule({
      module: "src.engine.compiler.compiler",
      args: ["--action", "validate"],
      config: req.body,
      componentName: "compiler-validate",
    }) as Record<string, unknown>;

    // Persist validation result to audit_log
    await persistCompilerAuditOrThrow({
      id: randomUUID(),
      action: "compiler.validate",
      entityType: "strategy",
      entityId: req.body.strategy_id || null,
      input: { dsl: req.body },
      result,
      status: "success",
      decisionAuthority: "human",
      correlationId: req.id ?? null,
      createdAt: new Date(),
    });

    // M9: standard envelope { valid, errors, data }
    const valid = result.valid !== false && !result.errors;
    res.json({
      valid,
      errors: normalizeErrors(result.errors),
      data: result,
    });
  } catch (err: any) {
    if (err.errors) {
      try {
        await persistCompilerAuditOrThrow({
          id: randomUUID(),
          action: "compiler.validate",
          entityType: "strategy",
          entityId: req.body.strategy_id || null,
          input: { dsl: req.body },
          result: { valid: false, errors: normalizeErrors(err.errors) },
          status: "failure",
          decisionAuthority: "human",
          errorMessage: err instanceof Error ? err.message : String(err),
          createdAt: new Date(),
        });
      } catch (auditErr) {
        req.log.error({ err: auditErr }, "Compiler validate audit persistence failed");
        res.status(500).json({ valid: false, errors: ["Compiler audit persistence failed: " + String(auditErr)] });
        return;
      }

      res.status(400).json({ valid: false, errors: normalizeErrors(err.errors) });
      return;
    }
    req.log.error({ err }, "Compiler validate error");
    res.status(500).json({ valid: false, errors: ["Compiler error: " + (err.message ?? String(err))] });
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
    }) as Record<string, unknown>;

    // Persist compile result to audit_log
    await persistCompilerAuditOrThrow({
      id: randomUUID(),
      action: "compiler.compile",
      entityType: "strategy",
      entityId: req.body.strategy_id || null,
      input: { dsl: req.body },
      result,
      status: "success",
      decisionAuthority: "human",
      correlationId: req.id ?? null,
      createdAt: new Date(),
    });

    // M9: standard envelope — same shape as /validate
    const valid = result.valid !== false && !result.errors;
    res.json({
      valid,
      errors: normalizeErrors(result.errors),
      data: result,
    });
  } catch (err: any) {
    if (err.errors) {
      try {
        await persistCompilerAuditOrThrow({
          id: randomUUID(),
          action: "compiler.compile",
          entityType: "strategy",
          entityId: req.body.strategy_id || null,
          input: { dsl: req.body },
          result: { valid: false, errors: normalizeErrors(err.errors) },
          status: "failure",
          decisionAuthority: "human",
          errorMessage: err instanceof Error ? err.message : String(err),
          createdAt: new Date(),
        });
      } catch (auditErr) {
        req.log.error({ err: auditErr }, "Compiler compile audit persistence failed");
        res.status(500).json({ valid: false, errors: ["Compiler audit persistence failed: " + String(auditErr)] });
        return;
      }
      res.status(400).json({ valid: false, errors: normalizeErrors(err.errors) });
      return;
    }
    req.log.error({ err }, "Compiler compile error");
    res.status(500).json({ valid: false, errors: ["Compiler error: " + (err.message ?? String(err))] });
  }
});

// ─── GET /api/compiler/schema — Return current DSL JSON schema ──────

compilerRoutes.get("/schema", (req, res) => {
  try {
    const version = (req.query.version as string) ?? "v1";
    if (!/^[a-zA-Z0-9]+$/.test(version)) {
      res.status(400).json({ error: "Invalid version: must be alphanumeric" });
      return;
    }
    const schemaPath = pathResolve(
      PROJECT_ROOT,
      `src/engine/compiler/schema_versions/${version}.json`
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    res.json(schema);
  } catch (err: any) {
    req.log.error({ err }, "Failed to read schema");
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
    req.log.error({ err }, "Compiler diff error");
    res.status(500).json({ error: "Compiler error", details: err.message });
  }
});
