/**
 * lifecycle-sse-correlation.test.ts — deep-scan Observability re-verify F-3 (HIGH).
 *
 * Every lifecycle PROMOTED SSE broadcast (CANDIDATE→TESTING … PILOT→DEPLOYED — live-capital
 * promotions) must carry correlationId so the operator's live SSE stream can be joined back to the
 * audit_log / lifecycle_transitions row (CLAUDE.md §2: bar→handler→DB→SSE→audit_log). Source-
 * structural guard: catches a NEW PROMOTED broadcast added without correlationId (the exact regression
 * class that dropped it on 6 sites).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/server/services/lifecycle-service.ts", "utf8");

describe("lifecycle PROMOTED SSE events carry correlationId (F-3)", () => {
  it("every broadcastSSE(LIFECYCLE_GATE_EVENTS.PROMOTED, {...}) payload includes correlationId", () => {
    // Match each PROMOTED broadcast's object-literal body up to its first closing brace.
    const re = /broadcastSSE\(LIFECYCLE_GATE_EVENTS\.PROMOTED,\s*\{([\s\S]*?)\}\)/g;
    const bodies = [...SRC.matchAll(re)].map((m) => m[1]);
    expect(bodies.length).toBeGreaterThanOrEqual(6); // the 6 known promotion sites
    for (const body of bodies) {
      expect(body).toMatch(/\bcorrelationId\b/);
    }
  });
});
