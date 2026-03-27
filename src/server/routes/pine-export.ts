import { Router } from "express";
import { compilePineExport, getExport, getExportArtifacts, getArtifact } from "../services/pine-export-service.js";
import { pineCompileRequestSchema } from "../lib/pine-artifact-schema.js";
import { logger } from "../index.js";

export const pineExportRoutes = Router();

// POST /api/pine-export/compile — Compile strategy to Pine artifacts
pineExportRoutes.post("/compile", async (req, res) => {
  const parsed = pineCompileRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await compilePineExport(
      parsed.data.strategyId,
      parsed.data.firmKey,
      parsed.data.exportType,
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Pine export compile failed");
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
pineExportRoutes.get("/:id/artifacts/:artifactId/download", async (req, res) => {
  const artifact = await getArtifact(req.params.artifactId);
  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }

  const contentType = artifact.fileName.endsWith(".json")
    ? "application/json"
    : "text/plain";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
  res.send(artifact.content);
});
