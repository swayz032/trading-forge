/**
 * pine-export.ts — Pine Export Routes
 *
 * F-1 (security): The artifact download handler verifies artifact ownership
 * (artifact.exportId must match :id URL param) before serving content.
 * Every download is written to audit_log with principal context.
 * Mismatch returns 403 — no content is served.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual, randomBytes } from "crypto";
import { compilePineExport, compileDualPineExport, getExport, getExportArtifacts, getArtifact } from "../services/pine-export-service.js";
import { pineCompileRequestSchema } from "../lib/pine-artifact-schema.js";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { assertNotShadow, PineExportShadowError } from "../lib/pine-export-shadow-guard.js";
import { emitPineShadowRefused } from "../lib/pine-shadow-observability.js";
import { notifyWarning } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

export const pineExportRoutes = Router();

// ─── A3 (Pass 3 Track A): Same-origin proxy middleware ───────────────────────
//
// Browser-originated GETs to the artifact-download endpoint cannot carry an
// Authorization header (browsers strip it on cross-origin requests, and the
// OPERATOR_API_KEY is a server-side secret the browser never has).
//
// For requests whose Origin header matches FRONTEND_ORIGIN (or
// TRADING_FORGE_PUBLIC_URL), we inject the OPERATOR_API_KEY server-side into
// the Authorization header so that requireOperatorApiKey below can validate it
// normally.  Requests from any other origin are left untouched — if they lack a
// valid Authorization header they will receive 401 from requireOperatorApiKey.
//
// SECURITY NOTE: only inject for the download sub-route to minimise surface area.
// The injection is done on a cloned request header object — it does NOT mutate
// the original req.headers for logging purposes.
function injectApiKeyForSameOriginBrowser(req: Request, _res: Response, next: NextFunction): void {
  const frontendOrigin =
    process.env.FRONTEND_ORIGIN ?? process.env.TRADING_FORGE_PUBLIC_URL ?? "";
  // req.headers["origin"] is string | string[] | undefined; normalize to string.
  const rawOrigin = req.headers["origin"];
  const requestOrigin = Array.isArray(rawOrigin) ? rawOrigin[0] ?? "" : rawOrigin ?? "";

  // Only inject when Origin matches AND no Authorization header is already set.
  if (
    frontendOrigin &&
    requestOrigin &&
    requestOrigin === frontendOrigin &&
    !req.headers["authorization"]
  ) {
    const apiKey = process.env.OPERATOR_API_KEY;
    if (apiKey && apiKey.length >= 16) {
      // Mutate the incoming header map so requireOperatorApiKey sees a valid bearer.
      // Safe: Express parses headers once; we modify before the next middleware runs.
      (req.headers as Record<string, string>)["authorization"] = `Bearer ${apiKey}`;
    } else {
      // API key not configured on server — 403, not 401, because the Origin is
      // correct but server is misconfigured.
      logger.error(
        { requestOrigin },
        "pine-export: same-origin proxy: OPERATOR_API_KEY not set, rejecting browser download",
      );
      _res.status(403).json({ error: "operator_api_key_not_configured_for_proxy" });
      return;
    }
  }

  next();
}

// F-2 (Pass 6 / Track A 2026-05-20): operator API-key gate.
// Previous code derived `principal` from `req.headers.authorization ? "operator" : "unauthenticated"`
// which accepted ANY non-empty Authorization header — effectively unauthenticated.
// We now validate the bearer token against process.env.OPERATOR_API_KEY using a
// constant-time comparison. Missing or wrong → 401. Fail-CLOSED in production.
//
// The Pine artifacts contain per-recipient HMAC secret references and routing
// metadata — leaking them to an anonymous caller compromises the marker collector.
// F-1 (Pass 6 / Track A 2026-05-21): dev-mode auto-generated key.
//
// Previously, when OPERATOR_API_KEY was unset in dev, EVERY pine-export route
// returned 401 unless PINE_EXPORT_ALLOW_UNAUTH=true was also set — a footgun
// for local smoke tests where the operator just wants to curl an artifact.
//
// We now auto-generate a per-process dev key on first import IF:
//   - NODE_ENV !== "production"
//   - OPERATOR_API_KEY is unset OR shorter than 16 chars
// The generated key is printed ONCE to stdout/logger.warn so the operator can
// paste it into a curl command. Production behaviour is unchanged: missing key
// → HTTP 503, never auto-generated. The dev key lives only in memory and dies
// with the process; pm2 reload regenerates a new one (acceptable in dev).
const DEV_AUTO_KEY: string | null = (() => {
  if (process.env.NODE_ENV === "production") return null;
  const existing = process.env.OPERATOR_API_KEY;
  if (existing && existing.length >= 16) return null;
  const key = `dev_${randomBytes(24).toString("hex")}`;
  // Single stdout line so it's easy to grep from a long log file.
  // eslint-disable-next-line no-console
  console.warn(
    `\n[pine-export] DEV MODE — OPERATOR_API_KEY not set. Auto-generated per-process key:\n  ${key}\n` +
      `Use it as: Authorization: Bearer ${key}\n` +
      `In production, set OPERATOR_API_KEY explicitly; auto-generation is disabled when NODE_ENV=production.\n`,
  );
  logger.warn(
    { devKeyLength: key.length },
    "pine-export: auto-generated dev OPERATOR_API_KEY (in-memory, per-process); see stdout for the value",
  );
  return key;
})();

function requireOperatorApiKey(req: Request, res: Response, next: NextFunction): void {
  // Effective expected key: prefer explicit env var, fall back to per-process
  // dev key (only populated when NODE_ENV !== "production").
  const expected = process.env.OPERATOR_API_KEY || DEV_AUTO_KEY || "";
  if (!expected || expected.length < 16) {
    // Refuse to serve when the gate itself is not configured. In production
    // this prevents accidental "open by default" deployments.
    if (process.env.NODE_ENV === "production") {
      logger.error("pine-export: OPERATOR_API_KEY not set in production — refusing requests");
      res.status(503).json({ error: "operator_api_key_not_configured" });
      return;
    }
    // Dev/test: only path that can land here is if randomBytes is unavailable
    // (extremely rare). Keep the explicit opt-out for parity with prior behaviour.
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

// CRIT/HIGH (security-auth-hardening 2026-07-17): requireOperatorApiKey was
// PREVIOUSLY mounted as a blanket router-level `.use(requireOperatorApiKey)`
// registered BEFORE any route on this router was defined. Express executes
// middleware/handlers in registration order regardless of `.use()` vs
// per-route registration — so requireOperatorApiKey ALWAYS ran first for
// every request on this router, including the download route below, which
// lists `injectApiKeyForSameOriginBrowser` as route-specific middleware with
// an inline comment claiming it "injects OPERATOR_API_KEY for
// browser-originated requests before requireOperatorApiKey validates" (A3,
// Pass 3 Track A). That claim was FALSE by construction: by the time
// injectApiKeyForSameOriginBrowser ran, requireOperatorApiKey had already
// rejected the request 401 for lacking an Authorization header — the entire
// A3 same-origin proxy feature was dead code, and legitimate same-origin
// browser downloads were (and, until this fix, remained) broken.
//
// Fix: apply requireOperatorApiKey per-route instead of as a blanket
// router-level `.use()`, so the download route can list
// injectApiKeyForSameOriginBrowser BEFORE it — restoring the intended
// injection-then-validate order documented at that middleware's definition
// above. Every route retains the identical requireOperatorApiKey gate;
// only the download route's middleware ORDER changes. See
// src/server/__tests__/pine-export-same-origin-auth-order.test.ts.

// POST /api/pine-export/compile — Compile strategy to Pine artifacts
pineExportRoutes.post("/compile", requireOperatorApiKey, async (req, res) => {
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
//
// Cast to string: adding requireOperatorApiKey as a second (untyped-params)
// middleware widens Express 5's inferred req.params type to
// ParamsDictionary's `string | string[]` union (same quirk documented on the
// download handler below). URL params are always single strings.
pineExportRoutes.get("/:id", requireOperatorApiKey, async (req, res) => {
  const exportRow = await getExport(req.params.id as string);
  if (!exportRow) {
    res.status(404).json({ error: "Export not found" });
    return;
  }
  res.json(exportRow);
});

// GET /api/pine-export/:id/artifacts — Fetch artifact list
pineExportRoutes.get("/:id/artifacts", requireOperatorApiKey, async (req, res) => {
  const artifacts = await getExportArtifacts(req.params.id as string);
  res.json(artifacts);
});

// GET /api/pine-export/:id/artifacts/:artifactId/download — Download .pine file
//
// F-1: Ownership check — artifact.exportId must match :id URL param.
// Without this check, any authenticated caller could download any artifact by
// guessing/enumerating artifact UUIDs, bypassing the export-level access boundary.
// Mismatch → 403 (not 404 — avoids leaking whether the artifact exists at all).
// Every download (success AND rejection) is written to audit_log.
//
// A3 (Pass 3 Track A) + CRIT/HIGH auth-ordering fix (security-auth-hardening
// 2026-07-17): injectApiKeyForSameOriginBrowser now runs BEFORE
// requireOperatorApiKey (previously requireOperatorApiKey was mounted via a
// blanket router.use() ahead of every route, so it always ran first and this
// injection middleware was dead code — see the fix note above the router's
// first route registration).
//
// C2 (Pass 3 Track C): SHADOW guard runs BEFORE ownership + content checks.
pineExportRoutes.get(
  "/:id/artifacts/:artifactId/download",
  injectApiKeyForSameOriginBrowser,
  requireOperatorApiKey,
  async (req, res) => {
  // Cast to string: @types/express-serve-static-core ParamsDictionary indexes to
  // string | string[] (Express 5 type). URL params are always single strings —
  // only query-string and header values can be string[].
  const exportId = req.params.id as string;
  const artifactId = req.params.artifactId as string;
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

  // 3b. C2 (Pass 3 Track C): SHADOW guard — block artifact download for SHADOW strategies.
  // Runs after ownership + parent-export checks so we have the strategyId from parentExport.
  // Returns 403 with pine_export.refused_shadow_strategy audit row on violation.
  try {
    await assertNotShadow(parentExport.strategyId, db);
  } catch (err) {
    if (err instanceof PineExportShadowError) {
      try {
        await db.insert(auditLog).values({
          action: "pine_export.refused_shadow_strategy",
          entityType: "strategy_export_artifact",
          entityId: artifactId,
          decisionAuthority: "system",
          input: { exportId, artifactId, principal, strategyId: parentExport.strategyId, blockedAt: "GET artifact-download" } as Record<string, unknown>,
          result: {
            strategy_id: parentExport.strategyId,
            lifecycle_state: err.lifecycleState,
            shadow_mode_enabled: err.shadowModeEnabled,
            blocked_at: "GET artifact-download",
          } as Record<string, unknown>,
          status: "warn",
          correlationId: null,
        });
      } catch (auditErr) {
        logger.error({ auditErr, artifactId, exportId }, "pine-export: shadow-guard audit write failed");
      }
      notifyWarning(
        `Pine artifact download blocked: SHADOW strategy ${parentExport.strategyId}`,
        appendFamilyGradePostscript(
          `Artifact download blocked for strategy ${parentExport.strategyId} (${err.message})`,
          "The system blocked a Pine file download for a strategy still in Shadow testing mode.",
          "No action needed — the strategy is not ready for TradingView deployment yet.",
        ),
        { strategyId: parentExport.strategyId, exportId, artifactId, lifecycleState: err.lifecycleState },
      );
      emitPineShadowRefused({
        strategy_id: parentExport.strategyId,
        lifecycle_state: err.lifecycleState ?? "unknown",
        shadow_mode_enabled: err.shadowModeEnabled,
        blocked_at: "artifact_download",
        correlation_id: null,
      });
      res.status(403).json({ error: "forbidden", reason: "shadow_strategy_pine_blocked" });
      return;
    }
    // Non-PineExportShadowError: DB failure — fail-CLOSED (return 403, don't leak artifact).
    logger.error({ err, artifactId, exportId }, "pine-export: shadow-guard unexpected error, blocking as fail-CLOSED");
    res.status(403).json({ error: "forbidden", reason: "shadow_guard_error" });
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
