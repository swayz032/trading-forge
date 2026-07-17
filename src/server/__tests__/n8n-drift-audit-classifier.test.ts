/**
 * n8n-drift-audit-classifier.test.ts — fixwave2-scheduler-health-monitoring
 * (2026-07-17), finding MED-2.
 *
 * RED-PROOF: pre-fix, `_runN8nDriftAudit` in scheduler.ts treated ANY
 * non-zero, non-timeout exit code from `npm run audit:n8n` as "genuine drift
 * found" and fired the same "n8n workflow drift detected...missing safety
 * configurations" CRITICAL alert — whether the script found real drift
 * (exit 1) OR could not even reach the n8n API (missing env / network
 * failure / stale key, exit 2 post-fix). This suite proves
 * classifyN8nDriftAuditExit() tells the two apart.
 */
import { describe, it, expect } from "vitest";
import {
  classifyN8nDriftAuditExit,
  N8N_AUDIT_EXIT_API_UNREACHABLE,
} from "../lib/n8n-drift-audit-classifier.js";

describe("classifyN8nDriftAuditExit", () => {
  it("exit 0 -> 'clean'", () => {
    expect(classifyN8nDriftAuditExit(0, false)).toBe("clean");
  });

  it("exit 1 -> 'drift' (genuine violation found — unchanged from pre-fix behavior)", () => {
    expect(classifyN8nDriftAuditExit(1, false)).toBe("drift");
  });

  it("RED-PROOF: exit 2 (N8N_AUDIT_EXIT_API_UNREACHABLE) -> 'unreachable', NOT 'drift'", () => {
    expect(N8N_AUDIT_EXIT_API_UNREACHABLE).toBe(2);
    const outcome = classifyN8nDriftAuditExit(N8N_AUDIT_EXIT_API_UNREACHABLE, false);
    expect(outcome).toBe("unreachable");
    expect(outcome).not.toBe("drift");
  });

  it("timedOut=true always wins, regardless of exit code", () => {
    expect(classifyN8nDriftAuditExit(1, true)).toBe("timeout");
    expect(classifyN8nDriftAuditExit(0, true)).toBe("timeout");
    expect(classifyN8nDriftAuditExit(2, true)).toBe("timeout");
  });

  it("an unrecognized exit code classifies as 'unknown_error' (conservative — not silently 'clean')", () => {
    expect(classifyN8nDriftAuditExit(127, false)).toBe("unknown_error");
    expect(classifyN8nDriftAuditExit(-1, false)).toBe("unknown_error");
  });
});
