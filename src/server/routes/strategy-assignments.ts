/**
 * Strategy Assignment Routes — Track 5 (Pass 2)
 *
 * REST endpoints for the StrategyAssignmentMatrix UI and family publish gate.
 *
 * GET  /api/strategy-assignments         — operator view: all active assignments
 * POST /api/strategy-assignments         — assign a DEPLOYED strategy to an account
 * DELETE /api/strategy-assignments/:id   — unassign (soft-archives)
 * POST /api/strategy-assignments/:id/release  — toggle released_to_family
 *
 * Pipeline-pause guard on POST and DELETE (writes). GET is always available.
 * Rate-limited via standard rate limit (mounted at /api globally).
 *
 * HTTP status conventions:
 *   201 — created (new assignment)
 *   200 — success (GET, release toggle)
 *   409 — UNIQUE collision (same account+strategy already assigned)
 *   423 — pipeline paused (write blocked)
 *   400 — validation error
 *   404 — assignment/account/strategy not found
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  assignStrategyToAccount,
  unassignStrategy,
  releaseStrategyToFamily,
  getAllAssignments,
  getFamilyPublishedStrategies,
  PipelinePausedError,
} from "../services/strategy-assignment-service.js";
import { logger } from "../lib/logger.js";

export const strategyAssignmentRoutes = Router();

// ─── GET /api/strategy-assignments ───────────────────────────────────────────
// Operator full view — all active assignments across all accounts.

strategyAssignmentRoutes.get("/", async (_req: Request, res: Response) => {
  try {
    const assignments = await getAllAssignments();
    res.json({ success: true, data: assignments });
  } catch (err) {
    logger.error({ err }, "strategy-assignments: GET / unhandled error");
    res.status(500).json({ success: false, error: "Failed to fetch assignments" });
  }
});

// ─── GET /api/strategy-assignments/family ────────────────────────────────────
// Strategies currently released to family (released_to_family=true).
// Used by FamilyPublishedStrategiesPanel.

strategyAssignmentRoutes.get("/family", async (_req: Request, res: Response) => {
  try {
    const assignments = await getFamilyPublishedStrategies();
    res.json({ success: true, data: assignments });
  } catch (err) {
    logger.error({ err }, "strategy-assignments: GET /family unhandled error");
    res.status(500).json({ success: false, error: "Failed to fetch family assignments" });
  }
});

// ─── POST /api/strategy-assignments ──────────────────────────────────────────
// Assign a DEPLOYED strategy to a broker account.

const postAssignmentSchema = z.object({
  accountId: z.string().uuid({ message: "accountId must be a valid UUID" }),
  strategyId: z.string().uuid({ message: "strategyId must be a valid UUID" }),
  assignedBy: z.string().min(1).max(200).default("operator"),
  familyMemberLabel: z.string().min(1).max(100).nullable().optional(),
});

strategyAssignmentRoutes.post("/", async (req: Request, res: Response) => {
  const parsed = postAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { accountId, strategyId, assignedBy, familyMemberLabel } = parsed.data;

  try {
    const assignment = await assignStrategyToAccount(accountId, strategyId, {
      assignedBy,
      familyMemberLabel,
    });

    // Check if this was a collision (returned existing) vs truly new
    // We can detect this by checking if the assignedBy matches what we sent
    // (a cleaner approach would be returning a flag from the service — but the
    // existing record has a different assignedBy in the collision case)
    const isNew = assignment.assignedBy === assignedBy;
    const status = isNew ? 201 : 409;

    if (status === 409) {
      res.status(409).json({
        success: false,
        error: "Assignment already exists for this account + strategy combination",
        existingAssignment: assignment,
      });
      return;
    }

    res.status(201).json({ success: true, data: assignment });
  } catch (err) {
    if (err instanceof PipelinePausedError) {
      res.status(423).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof Error) {
      if (err.message.includes("not found") || err.message.includes("not supported")) {
        res.status(404).json({ success: false, error: err.message });
        return;
      }
      if (err.message.includes("only DEPLOYED")) {
        res.status(400).json({ success: false, error: err.message });
        return;
      }
    }
    logger.error({ err, accountId, strategyId }, "strategy-assignments: POST / unhandled error");
    res.status(500).json({ success: false, error: "Failed to create assignment" });
  }
});

// ─── DELETE /api/strategy-assignments/:id ────────────────────────────────────
// Unassign (soft-archive) an assignment.

strategyAssignmentRoutes.delete("/:id", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: "id must be an integer" });
    return;
  }

  try {
    await unassignStrategy(id);
    res.json({ success: true, data: { id, status: "archived" } });
  } catch (err) {
    if (err instanceof PipelinePausedError) {
      res.status(423).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes("not found")) {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    logger.error({ err, id }, "strategy-assignments: DELETE /:id unhandled error");
    res.status(500).json({ success: false, error: "Failed to unassign strategy" });
  }
});

// ─── POST /api/strategy-assignments/:id/release ──────────────────────────────
// Toggle released_to_family flag. Body: { released: boolean, familyMemberLabel?: string }

const releaseSchema = z.object({
  released: z.boolean(),
  familyMemberLabel: z.string().min(1).max(100).optional(),
});

strategyAssignmentRoutes.post("/:id/release", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: "id must be an integer" });
    return;
  }

  const parsed = releaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { released, familyMemberLabel } = parsed.data;

  try {
    const updated = await releaseStrategyToFamily(id, released, familyMemberLabel);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof PipelinePausedError) {
      res.status(423).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes("not found")) {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    logger.error({ err, id }, "strategy-assignments: POST /:id/release unhandled error");
    res.status(500).json({ success: false, error: "Failed to update release status" });
  }
});
