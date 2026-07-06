/**
 * lifecycle-sse-correlation.test.ts — deep-scan Observability re-verify F-3 (HIGH).
 *
 * EVERY lifecycle SSE broadcast (not just PROMOTED) must carry correlationId so the operator's live
 * SSE stream can be joined back to the audit_log / lifecycle_transitions row
 * (CLAUDE.md §2: bar→handler→DB→SSE→audit_log). Source-structural guard: catches a NEW
 * broadcastSSE(LIFECYCLE_GATE_EVENTS.*, {...}) added without correlationId.
 *
 * F-3c (re-verify #2): the original guard only matched LIFECYCLE_GATE_EVENTS.PROMOTED (6 of 33 sites),
 * so it could NOT catch the two still-broken sites the re-verify found (PAPER_TO_DEPLOY_READY_BLOCKED
 * line 1111 + BIF_EVALUATED line 6256). This version matches ALL LIFECYCLE_GATE_EVENTS.* broadcasts and
 * asserts each body carries correlationId or tickCorrelationId — domain-wide, not PROMOTED-only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/server/services/lifecycle-service.ts", "utf8");

describe("lifecycle SSE events carry correlationId (F-3, all gate events)", () => {
  it("every broadcastSSE(LIFECYCLE_GATE_EVENTS.*, {...}) payload includes correlationId/tickCorrelationId", () => {
    // Match each lifecycle-gate broadcast's object-literal body up to its first closing brace.
    const re = /broadcastSSE\(LIFECYCLE_GATE_EVENTS\.(\w+),\s*\{([\s\S]*?)\}\)/g;
    const matches = [...SRC.matchAll(re)];
    // There are 33 lifecycle-gate broadcast sites today; guard against the regex silently matching none.
    expect(matches.length).toBeGreaterThanOrEqual(30);

    const offenders: string[] = [];
    for (const m of matches) {
      const evt = m[1];
      const body = m[2];
      if (!/\b(correlationId|tickCorrelationId)\b/.test(body)) {
        // capture the event name + a snippet so a failure names the exact broken site
        offenders.push(`${evt}: ${body.replace(/\s+/g, " ").trim().slice(0, 80)}`);
      }
    }
    expect(offenders, `lifecycle SSE broadcasts missing correlationId:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("still covers the known live-capital gate surfaces explicitly", () => {
    // Belt-and-suspenders: name the surfaces the re-verify caught, so a future rename can't silently
    // drop them from the generic match above.
    for (const evt of ["PROMOTED", "PAPER_TO_DEPLOY_READY_BLOCKED", "BIF_EVALUATED", "B14_EVALUATED", "WFE_EVALUATED"]) {
      const re = new RegExp(`broadcastSSE\\(LIFECYCLE_GATE_EVENTS\\.${evt},\\s*\\{([\\s\\S]*?)\\}\\)`, "g");
      const bodies = [...SRC.matchAll(re)].map((mm) => mm[1]);
      expect(bodies.length, `expected at least one ${evt} broadcast`).toBeGreaterThanOrEqual(1);
      for (const body of bodies) {
        expect(body, `${evt} broadcast missing correlationId`).toMatch(/\b(correlationId|tickCorrelationId)\b/);
      }
    }
  });
});
