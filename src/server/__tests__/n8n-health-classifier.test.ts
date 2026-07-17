/**
 * n8n-health-classifier.test.ts — fixwave2-scheduler-health-monitoring
 * (2026-07-17), finding HIGH-1.
 *
 * RED-PROOF: pre-fix, scheduler.ts's n8n-health-check job did
 * `const failing = stats.filter(s => s.failures > 0); if (failing.length > 0)
 * {...} else { logger.debug("all workflows healthy") }`. An EMPTY stats
 * array (the scraper feeding n8n_execution_log silently failing — n8n
 * outage, stale API key) took the exact same "all workflows healthy" branch
 * as a genuine all-clear. This suite proves classifyN8nHealthCheck()
 * distinguishes the two: an empty result with a stale/erroring scraper must
 * classify as "indeterminate", NEVER "healthy".
 */
import { describe, it, expect } from "vitest";
import {
  classifyN8nHealthCheck,
  SCRAPE_STALE_AFTER_MS,
  type N8nScrapeState,
  type N8nHealthCheckStats,
} from "../lib/n8n-health-classifier.js";

const NOW = 1_753_000_000_000; // fixed reference instant

function scrapeState(overrides: Partial<N8nScrapeState> = {}): N8nScrapeState {
  return {
    lastAttemptAt: NOW - 60_000, // 1 min ago — fresh
    lastSuccessAt: NOW - 60_000,
    lastError: null,
    disabled: false,
    ...overrides,
  };
}

describe("classifyN8nHealthCheck — failing branch (unchanged behavior)", () => {
  it("classifies 'failing' when any workflow has failures>0, regardless of scraper state", () => {
    const stats: N8nHealthCheckStats[] = [
      { workflowName: "wf-a", total: 5, failures: 2 },
      { workflowName: "wf-b", total: 3, failures: 0 },
    ];
    const result = classifyN8nHealthCheck(stats, scrapeState(), NOW);
    expect(result.status).toBe("failing");
    expect(result.failing).toEqual([{ workflowName: "wf-a", total: 5, failures: 2 }]);
  });
});

describe("classifyN8nHealthCheck — healthy branch (unchanged behavior)", () => {
  it("classifies 'healthy' when stats has data and zero failures", () => {
    const stats: N8nHealthCheckStats[] = [{ workflowName: "wf-a", total: 10, failures: 0 }];
    const result = classifyN8nHealthCheck(stats, scrapeState(), NOW);
    expect(result.status).toBe("healthy");
    expect(result.failing).toEqual([]);
  });
});

describe("classifyN8nHealthCheck — THE FIX: empty stats is never silently 'healthy'", () => {
  it("RED-PROOF: empty stats + scraper never attempted -> 'indeterminate', NOT 'healthy'", () => {
    const result = classifyN8nHealthCheck([], scrapeState({ lastAttemptAt: null, lastSuccessAt: null }), NOW);
    expect(result.status).toBe("indeterminate");
    expect(result.status).not.toBe("healthy");
  });

  it("RED-PROOF: empty stats + scraper's last attempt errored -> 'indeterminate'", () => {
    const result = classifyN8nHealthCheck(
      [],
      scrapeState({ lastError: "n8n API error: 401 Unauthorized" }),
      NOW,
    );
    expect(result.status).toBe("indeterminate");
    expect(result.reason).toMatch(/401 Unauthorized/);
  });

  it("RED-PROOF: empty stats + scraper stale (no attempt in >20 min) -> 'indeterminate'", () => {
    const result = classifyN8nHealthCheck(
      [],
      scrapeState({ lastAttemptAt: NOW - (SCRAPE_STALE_AFTER_MS + 1), lastSuccessAt: NOW - (SCRAPE_STALE_AFTER_MS + 1) }),
      NOW,
    );
    expect(result.status).toBe("indeterminate");
    expect(result.reason).toMatch(/has not run recently/);
  });

  it("boundary: an attempt exactly at the staleness threshold is still fresh (not stale)", () => {
    const result = classifyN8nHealthCheck(
      [],
      scrapeState({ lastAttemptAt: NOW - SCRAPE_STALE_AFTER_MS, lastError: null }),
      NOW,
    );
    expect(result.status).toBe("quiet");
  });

  it("empty stats + scraper healthy and recent -> 'quiet' (genuine no-activity), still NOT 'healthy'", () => {
    const result = classifyN8nHealthCheck([], scrapeState(), NOW);
    expect(result.status).toBe("quiet");
    expect(result.status).not.toBe("healthy");
  });

  it("empty stats + scraper disabled (no env configured) -> 'disabled', not an alert-worthy state", () => {
    const result = classifyN8nHealthCheck([], scrapeState({ disabled: true, lastAttemptAt: NOW }), NOW);
    expect(result.status).toBe("disabled");
  });

  it("disabled takes priority over staleness (disabled is expected, not an outage)", () => {
    const result = classifyN8nHealthCheck(
      [],
      scrapeState({ disabled: true, lastAttemptAt: null, lastError: null }),
      NOW,
    );
    expect(result.status).toBe("disabled");
  });
});
