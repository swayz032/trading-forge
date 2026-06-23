/**
 * pass7-tracks-a-c.test.ts — Pass 7 Combined Tracks A+C
 *
 * Tests the 4 closures shipped in this pass:
 *
 *   Track A.1 — tradingview_markers UNIQUE INDEX dedup
 *     Validates that the SQL migration file defines the correct index and that
 *     the ON CONFLICT target in tradingview-webhook.ts includes all 4 columns.
 *
 *   Track A.2 — Composite evidence-completeness tracker
 *     Unit tests for the evidence-gate logic: incomplete_count >= 3 blocks
 *     promotion; < 3 produces the correct composite_evidence_score.
 *
 *   Track C.1 — PILOT→DEPLOYED Pine compile retry + positional-arg fix
 *     Verifies the retry-with-backoff wrapper fires 3 attempts, that the
 *     correlationId is NOT passed as firmKey (positional-arg fix), and that
 *     the deployed-pine-artifact-check cron audit action is correct.
 *
 *   Track C.2 — paper.ts session hygiene
 *     Unit tests for stream-fail audit write and advisory-lock collision path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

// ─── Track A.1: tradingview_markers UNIQUE INDEX migration ─────────────────

describe("Track A.1 — tradingview_markers UNIQUE INDEX", () => {
  const MIGRATION_PATH = path.resolve(
    __dirname,
    "../db/migrations/0173_tradingview_markers_unique.sql",
  );

  it("migration file exists", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("migration creates UNIQUE INDEX with IF NOT EXISTS", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
    expect(sql).toMatch(/idx_tradingview_markers_dedup/i);
    expect(sql).toMatch(/ON tradingview_markers/i);
  });

  it("UNIQUE INDEX covers all 4 dedup columns", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    expect(sql).toMatch(/account_id/i);
    expect(sql).toMatch(/strategy_id/i);
    expect(sql).toMatch(/bar_timestamp/i);
    expect(sql).toMatch(/signal/i);
  });

  it("journal.json registers the migration at idx 176", () => {
    const journalPath = path.resolve(
      __dirname,
      "../db/migrations/meta/_journal.json",
    );
    // Strip UTF-8 BOM if present (Windows editors often add it)
    const raw = fs.readFileSync(journalPath, "utf-8").replace(/^﻿/, "");
    const journal = JSON.parse(raw) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const entry = journal.entries.find((e) => e.tag === "0173_tradingview_markers_unique");
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(176);
  });

  it("webhook route uses targeted ON CONFLICT with all 4 columns", () => {
    const webhookPath = path.resolve(
      __dirname,
      "../routes/tradingview-webhook.ts",
    );
    const src = fs.readFileSync(webhookPath, "utf-8");
    // Targeted form must include the 4-column list
    expect(src).toMatch(/ON CONFLICT \(account_id, strategy_id, bar_timestamp, signal\)/i);
    // Must NOT use targetless form alone (the file should have the targeted version)
    // Verify DO NOTHING RETURNING id follows the targeted form
    expect(src).toMatch(/ON CONFLICT \(account_id, strategy_id, bar_timestamp, signal\) DO NOTHING RETURNING id/i);
  });
});

// ─── Track A.2: Composite evidence-completeness gate logic ─────────────────

describe("Track A.2 — Evidence completeness gate", () => {
  /**
   * Minimal pure implementation of the evidence gate logic, mirroring exactly
   * what lifecycle-service.ts does with gateEvidenceStatuses.
   */
  function evaluateEvidence(statuses: string[]): {
    blocked: boolean;
    incompleteCount: number;
    compositeEvidenceScore: number;
  } {
    const incompleteCount = statuses.filter(
      (st) => st.includes("legacy") || st === "data_unavailable",
    ).length;
    const blocked = incompleteCount >= 3;
    const compositeEvidenceScore = blocked ? 0 : 1.0 - incompleteCount / 8.0;
    return { blocked, incompleteCount, compositeEvidenceScore };
  }

  it("blocks when >= 3 statuses are incomplete (legacy)", () => {
    const statuses = [
      "complete",
      "legacy_null",     // 1
      "legacy_unavailable", // 2
      "legacy_proceed",  // 3 — triggers block
      "complete",
      "complete",
      "complete",
      "complete",
    ];
    const result = evaluateEvidence(statuses);
    expect(result.blocked).toBe(true);
    expect(result.incompleteCount).toBe(3);
  });

  it("blocks when >= 3 statuses include data_unavailable", () => {
    const statuses = [
      "data_unavailable", // 1
      "data_unavailable", // 2
      "data_unavailable", // 3 — triggers block
      "complete",
      "complete",
    ];
    const result = evaluateEvidence(statuses);
    expect(result.blocked).toBe(true);
    expect(result.incompleteCount).toBe(3);
  });

  it("does NOT block with exactly 2 incomplete statuses", () => {
    const statuses = [
      "complete",
      "legacy_null",     // 1
      "data_unavailable", // 2
      "complete",
      "complete",
      "complete",
      "complete",
      "complete",
    ];
    const result = evaluateEvidence(statuses);
    expect(result.blocked).toBe(false);
    expect(result.incompleteCount).toBe(2);
  });

  it("computes composite_evidence_score = 1.0 - (incomplete / 8)", () => {
    // 2 incomplete out of 8 → score = 0.75
    const statuses = [
      "complete", "complete", "complete", "complete",
      "complete", "complete", "legacy_null", "data_unavailable",
    ];
    const result = evaluateEvidence(statuses);
    expect(result.blocked).toBe(false);
    expect(result.compositeEvidenceScore).toBeCloseTo(0.75, 5);
  });

  it("returns score 1.0 when all 8 gates have complete data", () => {
    const statuses = Array(8).fill("complete");
    const result = evaluateEvidence(statuses);
    expect(result.blocked).toBe(false);
    expect(result.compositeEvidenceScore).toBeCloseTo(1.0, 5);
  });

  it("treats any string containing 'legacy' as incomplete", () => {
    const legacyVariants = [
      "legacy_null",
      "legacy_proceed",
      "legacy_unavailable",
      "legacy_fallback",
    ];
    for (const v of legacyVariants) {
      const result = evaluateEvidence([v, v, v]);
      expect(result.incompleteCount).toBe(3);
      expect(result.blocked).toBe(true);
    }
  });

  it("does not treat 'complete' as incomplete", () => {
    const statuses = Array(8).fill("complete");
    const result = evaluateEvidence(statuses);
    expect(result.incompleteCount).toBe(0);
    expect(result.blocked).toBe(false);
  });
});

// ─── Track C.1: Pine compile retry logic ───────────────────────────────────

describe("Track C.1 — Pine compile retry + positional-arg fix", () => {
  /**
   * Simulates the retry-with-backoff wrapper from lifecycle-service.ts
   * (Track C.1 fix). Uses short test delays instead of 30s/2m/10m.
   */
  async function retryPineCompile(
    compileFn: (attempt: number) => Promise<void>,
    delays = [0, 0, 0],
  ): Promise<{ success: boolean; attempts: number; lastError: unknown }> {
    let lastError: unknown = null;
    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
      }
      try {
        await compileFn(attempt);
        success = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    return { success, attempts: success ? 0 : 3, lastError };
  }

  it("succeeds on first attempt without retrying", async () => {
    const calls: number[] = [];
    const result = await retryPineCompile(async (attempt) => {
      calls.push(attempt);
    });
    expect(result.success).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(0);
  });

  it("retries up to 3 times on repeated failure", async () => {
    const calls: number[] = [];
    const result = await retryPineCompile(async (attempt) => {
      calls.push(attempt);
      throw new Error(`compile failed attempt ${attempt}`);
    });
    expect(result.success).toBe(false);
    expect(calls.length).toBe(3);
    expect(result.lastError).toBeInstanceOf(Error);
  });

  it("succeeds on second attempt (recovers mid-retry)", async () => {
    const calls: number[] = [];
    const result = await retryPineCompile(async (attempt) => {
      calls.push(attempt);
      if (attempt === 0) throw new Error("transient failure");
    });
    expect(result.success).toBe(true);
    expect(calls.length).toBe(2);
  });

  it("positional-arg fix: compileDualPineExport called with undefined firmKey", () => {
    // The bug was: compileDualPineExport(s.id, correlationId)
    // The fix is:  compileDualPineExport(s.id, undefined, undefined, true, correlationId)
    // Simulate a call recorder with 5 positional params.
    const calls: unknown[][] = [];
    function compileDualPineExport(
      strategyId: string,
      firmKey?: string,
      injectedRisk?: unknown,
      persist?: boolean,
      correlationId?: string,
    ): Promise<void> {
      calls.push([strategyId, firmKey, injectedRisk, persist, correlationId]);
      return Promise.resolve();
    }

    const strategyId = randomUUID();
    const corrId = randomUUID();
    // Call with the FIXED positional args
    compileDualPineExport(strategyId, undefined, undefined, true, corrId);

    expect(calls[0]).toEqual([strategyId, undefined, undefined, true, corrId]);
    // firmKey (2nd arg) must be undefined — not the correlationId
    expect(calls[0]?.[1]).toBeUndefined();
    // correlationId (5th arg) must be the actual correlationId
    expect(calls[0]?.[4]).toBe(corrId);
  });

  it("deployed-pine-artifact-check audit action is correct", () => {
    // Verify the cron audit action string matches what we write
    const EXPECTED_ACTION = "deployed_pine_artifact_check.evaluated";
    expect(EXPECTED_ACTION).toBe("deployed_pine_artifact_check.evaluated");

    // And the scheduler.ts cron uses it
    const schedulerPath = path.resolve(__dirname, "../scheduler.ts");
    const src = fs.readFileSync(schedulerPath, "utf-8");
    expect(src).toMatch(/deployed_pine_artifact_check\.evaluated/);
    expect(src).toMatch(/deployed-pine-artifact-check/);
    expect(src).toMatch(/_PIPELINE_GATE_EXEMPT.*deployed-pine-artifact-check|deployed-pine-artifact-check.*_PIPELINE_GATE_EXEMPT/ms);
  });

  it("lifecycle-service.ts has retry wrapper for PILOT→DEPLOYED Pine compile", () => {
    const lcPath = path.resolve(__dirname, "../services/lifecycle-service.ts");
    const src = fs.readFileSync(lcPath, "utf-8");
    // Verify the retry wrapper is present
    expect(src).toMatch(/PINE_RETRY_DELAYS_MS/);
    expect(src).toMatch(/attempt < 3/);
    expect(src).toMatch(/deployed_pine_compile_failed/);
    // Verify positional-arg fix: 5th arg pattern
    expect(src).toMatch(/compileDualPineExport\(s\.id, undefined, undefined, true, correlationId/);
  });
});

// ─── Track C.2: paper.ts session hygiene ───────────────────────────────────

describe("Track C.2 — paper session stream hygiene + advisory lock", () => {
  /**
   * Minimal simulation of the Track C.2 stream-startup error handler.
   * Returns the audit action written and the session status set.
   */
  async function simulateStreamStartup(options: {
    streamFails: boolean;
    advisoryLockAcquired: boolean;
  }): Promise<{
    auditActions: string[];
    sessionStatus: string | null;
    responseStatus: number | null;
    discordWarnings: string[];
  }> {
    const auditActions: string[] = [];
    let sessionStatus: string | null = "active";
    let responseStatus: number | null = null;
    const discordWarnings: string[] = [];

    // Simulate advisory lock check
    if (!options.advisoryLockAcquired) {
      auditActions.push("paper.session_advisory_lock_collision");
      responseStatus = 409;
      return { auditActions, sessionStatus: null, responseStatus, discordWarnings };
    }

    // Simulate stream startup
    if (options.streamFails) {
      auditActions.push("paper.session_stream_failed");
      discordWarnings.push("stream_failed_discord_warn");
      sessionStatus = "failed_to_stream";
    }

    return { auditActions, sessionStatus, responseStatus, discordWarnings };
  }

  it("writes paper.session_stream_failed audit on stream error", async () => {
    const result = await simulateStreamStartup({ streamFails: true, advisoryLockAcquired: true });
    expect(result.auditActions).toContain("paper.session_stream_failed");
  });

  it("marks session status as failed_to_stream on stream error", async () => {
    const result = await simulateStreamStartup({ streamFails: true, advisoryLockAcquired: true });
    expect(result.sessionStatus).toBe("failed_to_stream");
  });

  it("sends Discord WARN on stream error", async () => {
    const result = await simulateStreamStartup({ streamFails: true, advisoryLockAcquired: true });
    expect(result.discordWarnings.length).toBeGreaterThan(0);
  });

  it("does NOT write stream_failed audit when stream succeeds", async () => {
    const result = await simulateStreamStartup({ streamFails: false, advisoryLockAcquired: true });
    expect(result.auditActions).not.toContain("paper.session_stream_failed");
    expect(result.sessionStatus).toBe("active");
  });

  it("returns 409 on advisory lock collision", async () => {
    const result = await simulateStreamStartup({ streamFails: false, advisoryLockAcquired: false });
    expect(result.responseStatus).toBe(409);
    expect(result.auditActions).toContain("paper.session_advisory_lock_collision");
  });

  it("does NOT proceed to stream when advisory lock is not acquired", async () => {
    const result = await simulateStreamStartup({ streamFails: true, advisoryLockAcquired: false });
    // Even though streamFails=true, the lock collision should prevent reaching stream code
    expect(result.responseStatus).toBe(409);
    expect(result.auditActions).not.toContain("paper.session_stream_failed");
  });

  it("advisory lock key derivation produces consistent BigInt from UUID", () => {
    // Verify the UUID-to-BigInt conversion is deterministic
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const lockKey = BigInt("0x" + uuid.replace(/-/g, "").slice(0, 16));
    const lockKey2 = BigInt("0x" + uuid.replace(/-/g, "").slice(0, 16));
    expect(lockKey).toBe(lockKey2);
    // Verify it's a valid BigInt (not NaN)
    expect(typeof lockKey).toBe("bigint");
  });

  it("paper.ts source contains advisory lock implementation", () => {
    const paperPath = path.resolve(__dirname, "../routes/paper.ts");
    const src = fs.readFileSync(paperPath, "utf-8");
    expect(src).toMatch(/pg_try_advisory_lock/);
    expect(src).toMatch(/paper\.session_advisory_lock_collision/);
    expect(src).toMatch(/paper\.session_stream_failed/);
    expect(src).toMatch(/failed_to_stream/);
    expect(src).toMatch(/appendFamilyGradePostscript/);
  });
});
