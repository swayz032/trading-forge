/**
 * Supadata Route — POST /api/supadata/transcript
 *
 * Wraps the Supadata service for n8n callers. Used by 5N (Brave Video Discoverer)
 * → 5O (Supadata Transcript Pipeline) to convert quant YouTube videos into
 * strategy DSLs.
 *
 * GET  /usage     — current daily counter vs cap
 * POST /transcript — { url } → { url, videoId, text, ... }
 */

import { Router } from "express";
import { z } from "zod";
import { fetchYouTubeTranscript, getSupadataUsage } from "../services/supadata-service.js";

export const supadataRoutes = Router();

const TranscriptRequest = z.object({
  url: z.string().url(),
});

supadataRoutes.post("/transcript", async (req, res) => {
  const parsed = TranscriptRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await fetchYouTubeTranscript(parsed.data.url);
    res.json(result);
  } catch (err: any) {
    if (err.code === "SUPADATA_DAILY_CAP") {
      res.status(429).json({
        error: err.message,
        type: "daily_cap_exceeded",
        usage: getSupadataUsage(),
      });
      return;
    }
    req.log.error({ err: err?.message, url: parsed.data.url }, "supadata route failed");
    res.status(502).json({ error: err?.message ?? "supadata fetch failed" });
  }
});

supadataRoutes.get("/usage", (_req, res) => {
  res.json(getSupadataUsage());
});

supadataRoutes.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "supadata",
    configured: !!process.env.SUPADATA_API_KEY,
    usage: getSupadataUsage(),
  });
});
