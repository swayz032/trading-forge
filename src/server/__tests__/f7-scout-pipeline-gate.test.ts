/**
 * F-7 Scout Pipeline Gate Test (2026-05-20)
 *
 * Verifies that runAutonomousScoutCycle() returns a skipped result when the
 * pipeline is paused. This is the service-internal defense-in-depth gate;
 * the scheduler-level gate is Track C's responsibility.
 *
 * Mocks:
 *   - pipeline-control-service.isActive → false (pipeline paused)
 *   - DB, network, BRAVE_API_KEY — not needed; function returns before any of those
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock pipeline-control-service BEFORE importing the scout runner
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(false),
  getMode: vi.fn().mockResolvedValue("PAUSED"),
}));

// Mock DB and other heavy imports to prevent DATABASE_URL errors
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: {},
  strategyPendingBuckets: {},
  auditLog: {},
  transcriptFetchOutcomes: {},
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../services/transcript-fetch-queue.js", () => ({
  fetchTranscriptWithRetry: vi.fn(),
}));

vi.mock("../services/reddit-cross-extract.js", () => ({
  fetchRedditEnrichment: vi.fn(),
}));

describe("F-7: Scout runner respects pipeline pause (service-internal gate)", () => {
  it("runAutonomousScoutCycle returns skipped=true when pipeline is paused", async () => {
    // Dynamic import AFTER mocks are set up
    const { runAutonomousScoutCycle } = await import("../services/autonomous-scout-runner.js");
    const result = await runAutonomousScoutCycle();

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("pipeline_paused");
    expect(result.queriesRun).toBe(0);
    expect(result.webMentions).toBe(0);
    expect(result.youtubeMentions).toBe(0);
    expect(result.redditMentions).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("runAutonomousScoutCycle does NOT check BRAVE_API_KEY when pipeline is paused", async () => {
    // The pipeline gate fires BEFORE the BRAVE_API_KEY check.
    // If BRAVE_API_KEY were checked first, the error array would contain the key-missing error.
    const { runAutonomousScoutCycle } = await import("../services/autonomous-scout-runner.js");
    const result = await runAutonomousScoutCycle();

    // Should NOT contain the api-key-missing error
    expect(result.errors.some((e) => e.includes("BRAVE_SEARCH_API_KEY"))).toBe(false);
    expect(result.skipped).toBe(true);
  });
});
