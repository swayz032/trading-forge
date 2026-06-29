/**
 * carter-tools.ts — Carter voice-agent read-tool Express router.
 *
 * Routes:
 *   POST /api/carter/:tool
 *     → Authenticates via static Bearer header (CARTER_TOOLS_HMAC_SECRET).
 *     → Looks up the tool in CARTER_TOOLS registry.
 *     → Dispatches to CARTER_READ_HANDLERS.
 *     → Writes a `carter.tool_invoked` (success) or `carter.tool_failed`
 *       (error) audit row.
 *     → Returns JSON.
 *
 * Mount ordering (index.ts):
 *   AFTER  /api/carter/webhook  (must not catch webhook path — exact prefix wins)
 *   AFTER  express.json()       (tools-plane uses JSON body parsing)
 *   BEFORE /api authMiddleware  (tools-plane has its own Bearer auth)
 *
 * Security: constant-time Bearer header comparison via `verifyCarterToolAuth`.
 *   Missing or wrong token → 401.
 *   Unknown tool name → 404.
 *   Handler error → 500 + audit.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { verifyCarterToolAuth } from "../lib/carter/carter-auth.js";
import { getCarterTool } from "../lib/carter/tool-registry.js";
import { CARTER_READ_HANDLERS } from "../lib/carter/carter-reads.js";
import { CARTER_ACTION_HANDLERS, CARTER_CONFIRM_HANDLERS } from "../lib/carter/carter-actions.js";
import { listOpenIssues } from "../lib/carter/carter-issues-store.js";

export const carterToolsRouter = Router();

// ─── GET /api/carter/issue-badge — non-sensitive summary for the Office card ──
//
// Returns open-issue count and max severity for the Office dashboard badge.
// No auth required: only a count + severity label is exposed (no strategy names,
// system internals, or sensitive data).
// MUST be mounted BEFORE the /:tool handler so "issue-badge" is not parsed as
// a tool name.
carterToolsRouter.get("/issue-badge", (_req: Request, res: Response): void => {
  const open = listOpenIssues();
  const maxSeverity =
    open.some((i) => i.severity === "critical")
      ? "critical"
      : open.some((i) => i.severity === "warning")
        ? "warning"
        : open.length > 0
          ? "info"
          : null;

  res.json({ count: open.length, maxSeverity });
});

// ─── POST /api/carter/:tool ───────────────────────────────────────────────────

carterToolsRouter.post("/:tool", async (req: Request, res: Response): Promise<void> => {
  const toolName = req.params["tool"] as string;
  const startMs = Date.now();
  const correlationId = (req as { id?: string }).id ?? null;

  // 1. Auth — constant-time Bearer compare
  const authResult = verifyCarterToolAuth(req);
  if (!authResult.ok) {
    logger.warn({ toolName, reason: authResult.reason }, "carter-tools: auth rejected");
    res.status(401).json({ error: "unauthorized", reason: authResult.reason });
    return;
  }

  // 2. Registry lookup
  const tool = getCarterTool(toolName);
  if (!tool) {
    logger.warn({ toolName }, "carter-tools: unknown tool");
    res.status(404).json({ error: "tool_not_found", tool: toolName });
    return;
  }

  // 3. Tier check — RED tools have NO tool path (the governance guarantee).
  //    GREEN (read/action) + YELLOW (propose/confirm) dispatch.
  if (tool.tier === "red") {
    logger.warn({ toolName }, "carter-tools: red action refused — no tool path");
    res.status(403).json({ error: "red_action_no_tool_path", tool: toolName, tier: "red" });
    return;
  }

  // 4. Handler lookup — read, then action, then confirm (no key collisions; the
  //    contract test enforces single-map ownership of each handler key).
  const handlerKey = tool.handler!;
  const handler: ((params: unknown, token?: string) => Promise<unknown>) | undefined =
    CARTER_READ_HANDLERS[handlerKey] ?? CARTER_ACTION_HANDLERS[handlerKey] ?? CARTER_CONFIRM_HANDLERS[handlerKey];
  if (!handler) {
    // Should not happen if registry↔handler map are in sync (contract test catches this)
    logger.error({ toolName, handlerKey }, "carter-tools: handler missing for dispatchable tool — registry/handler parity violation");
    res.status(500).json({ error: "handler_not_found", tool: toolName });
    return;
  }

  // 5. Dispatch. For YELLOW confirm_* tools the confirmation token rides in the
  //    body; extract it and pass as the second arg (read/action handlers ignore it).
  const params = req.body ?? {};
  const token =
    params && typeof params === "object" && typeof (params as Record<string, unknown>)["token"] === "string"
      ? ((params as Record<string, unknown>)["token"] as string)
      : undefined;
  try {
    const result = await handler(params, token);
    const durationMs = Date.now() - startMs;

    await insertAuditRowSafe({
      action: "carter.tool_invoked",
      entityType: "voice_agent_tool",
      status: "success",
      decisionAuthority: "voice_agent",
      correlationId,
      input: { tool: toolName, params },
      result: { durationMs },
    });

    logger.info({ toolName, durationMs }, "carter-tools: tool dispatched");
    res.json({ tool: toolName, result, durationMs });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error({ toolName, err, durationMs }, "carter-tools: handler threw");

    await insertAuditRowSafe({
      action: "carter.tool_failed",
      entityType: "voice_agent_tool",
      status: "failure",
      decisionAuthority: "voice_agent",
      correlationId,
      errorMessage,
      input: { tool: toolName, params },
      result: { durationMs },
    });

    res.status(500).json({ error: "tool_execution_failed", tool: toolName, message: errorMessage });
  }
});
