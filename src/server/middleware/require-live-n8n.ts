/**
 * require-live-n8n — middleware that enforces the AGENTS.md rule:
 *
 *   Any agent with n8n MCP/API access MUST query live workflows BEFORE
 *   reporting workflow counts or health. Stale docs, archived records,
 *   and total-API counts cannot be passed off as "active".
 *
 * Enforcement model:
 *   - Caller must include header `X-N8N-Workflow-Hash: <sha256-hex-24>`
 *     where the hash is taken over the result of a fresh
 *     `n8n_list_workflows({active: true, archived: false})` call.
 *   - The middleware re-derives the same hash from a server-side query
 *     to n8n and rejects with 428 Precondition Required if the caller's
 *     hash is missing or stale (server hash recomputed at most every 60s).
 *
 * Wired only on agent routes (e.g. /api/agent/scout-ideas/strict) so legacy
 * paths remain unaffected.
 */

import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { logger } from "../index.js";

interface CachedHash {
  hash: string;
  computedAt: number;
}

let cached: CachedHash | null = null;
const CACHE_TTL_MS = 60_000;

export async function computeLiveActiveWorkflowHash(): Promise<string | null> {
  const baseUrl = process.env.N8N_BASE_URL ?? "http://localhost:5678";
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${baseUrl}/api/v1/workflows?active=true&limit=100`, {
      headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "require-live-n8n: n8n API returned non-2xx");
      return null;
    }
    const json: any = await res.json();
    const ids = (json?.data ?? [])
      .filter((w: any) => w.active === true && w.isArchived !== true)
      .map((w: any) => String(w.id))
      .sort();
    return createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 24);
  } catch (err) {
    logger.warn({ err }, "require-live-n8n: failed to compute live hash");
    return null;
  }
}

async function getCachedHash(): Promise<string | null> {
  const now = Date.now();
  if (cached && now - cached.computedAt < CACHE_TTL_MS) return cached.hash;
  const fresh = await computeLiveActiveWorkflowHash();
  if (fresh) cached = { hash: fresh, computedAt: now };
  return fresh;
}

export function requireLiveN8n(options: { soft?: boolean } = {}): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const soft = options.soft ?? false;
  return async (req, res, next) => {
    const provided = req.header("X-N8N-Workflow-Hash");
    const expected = await getCachedHash();

    // If we cannot reach n8n, do not block — log and continue.
    if (!expected) {
      logger.warn("require-live-n8n: skipped (n8n unreachable / not configured)");
      return next();
    }

    if (!provided) {
      if (soft) {
        logger.warn({ path: req.path }, "require-live-n8n: missing header (soft mode, allowed)");
        return next();
      }
      res.status(428).json({
        error: "Precondition Required",
        message: "Missing X-N8N-Workflow-Hash header. Agents must query live n8n active workflows before invoking this endpoint.",
        expectedHash: expected,
      });
      return;
    }

    if (provided !== expected) {
      if (soft) {
        logger.warn({ path: req.path, provided, expected }, "require-live-n8n: stale hash (soft mode, allowed)");
        return next();
      }
      res.status(428).json({
        error: "Precondition Required",
        message: "Stale X-N8N-Workflow-Hash. Re-query live n8n active workflows and retry.",
        expectedHash: expected,
      });
      return;
    }

    next();
  };
}
