/**
 * pine-export.ts — Pine Export Routes
 *
 * F-1 (security): The artifact download handler verifies artifact ownership
 * (artifact.exportId must match :id URL param) before serving content.
 * Every download is written to audit_log with principal context.
 * Mismatch returns 403 — no content is served.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { compilePineExport, compileDualPineExport, getExport, getExportArtifacts, getArtifact } from "../services/pine-export-service.js";
import { pineCompileRequestSchema } from "../lib/pine-artifact-schema.js";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";

export const pineExportRoutes = Router();

// F-2 (Pass 6 / Track A 2026-05-20): operator API-key gate.
// Previous code derived `principal` from `req.headers.authorization ? "operator" : "unauthenticated"`
// which accepted ANY non-empty Authorization header — effectively unauthenticated.
// We now validate the bearer token against process.env.OPERATOR_API_KEY using a
// constant-time comparison. Missing or wrong → 401. Fail-CLOSED in production.
//
// The Pine artifacts contain per-recipient HMAC secret references and routing
// metadata — leaking them to an anonymous caller compromises the marker collector.
function requireOperatorApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.OPERATOR_API_KEY;
  if (!expected || expected.length < 16) {
    // Refuse to serve when the gate itself is not configured. In production
    // this prevents accidental "open by default" deployments.
    if (process.env.NODE_ENV === "production") {
      logger.error("pine-export: OPERATOR_API_KEY not set in production — refusing requests");
      res.status(503).json({ error: "operator_api_key_not_configured" });
      return;
    }
    // Dev/test: allow only when explicit opt-out flag is set, otherwise still fail.
    if (process.env.PINE_EXPORT_ALLOW_UNAUTH !== "true") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
    return;
  }

  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const provided = header.slice("bearer ".length).trim();
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

pineExportRoutes.use(requireOperatorApiKey);

// POST /api/pine-export/compile — Compile strategy to Pine artifacts
pineExportRoutes.post("/compile", async (req, res) => {
  const parsed = pineCompileRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Use req.log (child logger with requestId) so errors link back to the HTTP request
  try {
    let result;
    if (parsed.data.exportType === "pine_dual") {
      result = await compileDualPineExport(parsed.data.strategyId, parsed.data.firmKey);
    } else {
      result = await compilePineExport(
        parsed.data.strategyId,
        parsed.data.firmKey,
        parsed.data.exportType,
      );
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err, strategyId: parsed.data.strategyId, correlationId: req.id }, "Pine export compile failed");
    res.status(500).json({ error: "Compilation failed" });
  }
});

// GET /api/pine-export/:id — Fetch export metadata
pineExportRoutes.get("/:id", async (req, res) => {
  const exportRow = await getExport(req.params.id);
  if (!exportRow) {
    res.status(404).json({ error: "Export not found" });
    return;
  }
  res.json(exportRow);
});

// GET /api/pine-export/:id/artifacts — Fetch artifact list
pineExportRoutes.get("/:id/artifacts", async (req, res) => {
  const artifacts = await getExportArtifacts(req.params.id);
  res.json(artifacts);
});

// GET /api/pine-export/:id/artifacts/:artifactId/download — Download .pine file
//
// F-1: Ownership check — artifact.exportId must match :id URL param.
// Without this check, any authenticated caller could download any artifact by
// guessing/enumerating artifact UUIDs, bypassing the export-level access boundary.
// Mismatch → 403 (not 404 — avoids leaking whether the artifact exists at all).
// Every download (success AND rejection) is written to audit_log.
pineExportRoutes.get("/:id/artifacts/:artifactId/download", async (req, res) => {
  const exportId = req.params.id;
  const artifactId = req.params.artifactId;
  // F-2: principal is "operator" — requireOperatorApiKey middleware already
  // validated the bearer token in constant time, so any request reaching here
  // is authenticated.
  const principal = "operator";

  // 1. Fetch the artifact
  const artifact = await getArtifact(artifactId);
  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }

  // 2. F-1: Ownership check — artifact must belong to the requested export.
  if (artifact.exportId !== exportId) {
    logger.warn(
      { artifactId, exportId, actualExportId: artifact.exportId, principal },
      "pine-export: artifact ownership mismatch — access denied",
    );
    // Audit log the rejection — operator can investigate misuse patterns.
    try {
      await db.insert(auditLog).values({
        action: "pine_export.artifact_download_rejected",
        entityType: "strategy_export_artifact",
        entityId: artifactId,
        decisionAuthority: "system",
        input: { exportId, artifactId, principal } as Record<string, unknown>,
        result: {
          reason: "ownership_mismatch",
          actualExportId: artifact.exportId,
          requestedExportId: exportId,
        } as Record<string, unknown>,
        status: "failure",
        correlationId: null,
      });
    } catch (auditErr) {
      logger.error({ auditErr }, "pine-export: audit_log write failed for ownership rejection");
    }
    // Return 403, not 404 — do not reveal whether artifact exists under other export IDs.
    res.status(403).json({ error: "forbidden" });
    return;
  }

  // 3. Fetch parent export to verify it exists (defense-in-depth).
  const parentExport = await getExport(exportId);
  if (!parentExport) {
    // Artifact exists but parent export is orphaned — data integrity issue.
    logger.warn(
      { artifactId, exportId, principal },
      "pine-export: parent export not found for artifact — possible orphan",
    );
    res.status(404).json({ error: "Export not found" });
    return;
  }

  // 4. Audit log successful download.
  try {
    await db.insert(auditLog).values({
      action: "pine_export.artifact_downloaded",
      entityType: "strategy_export_artifact",
      entityId: artifactId,
      decisionAuthority: "human",
      input: { exportId, artifactId, principal } as Record<string, unknown>,
      result: {
        fileName: artifact.fileName,
        artifactType: artifact.artifactType,
        strategyId: parentExport.strategyId,
      } as Record<string, unknown>,
      status: "success",
      correlationId: null,
    });
  } catch (auditErr) {
    // Non-blocking — serve the file even if audit write fails.
    logger.error({ auditErr, artifactId, exportId }, "pine-export: audit_log write failed for download (non-blocking)");
  }

  const contentType = artifact.fileName.endsWith(".json")
    ? "application/json"
    : "text/plain";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
  res.send(artifact.content);
});
