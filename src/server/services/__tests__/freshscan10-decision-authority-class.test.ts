/**
 * freshscan10 grade-followup (2026-07-12) — decision_authority pattern-class RED-proof.
 *
 * The independent grader found that the freshscan10 MED#2 fix (admin.ts self-restart)
 * closed ONE instance of a bug CLASS: an audit row that hardcodes
 * `decisionAuthority: "human"` while being reachable from an AUTONOMOUS path.
 * `getLastOperatorActivityAt()` (dead-mans-heartbeat-service.ts, filters
 * decision_authority='human') treats any such row as operator activity and resets the
 * vacation operator-absence silence clock, so `operator_absent_since` never latches and
 * Tier-1 vacation autopilot never engages — silently defeating CLAUDE.md §3's
 * "14-day vacations are safe by design".
 *
 * The grader found two more producers still broken: compilePineExport +
 * compileDualPineExport (pine-export-service.ts), called autonomously from the
 * deployed-pine-artifact-check cron (scheduler.ts), MC/quantum auto-fire, and the
 * PILOT→DEPLOYED / DEPLOY_READY auto-promotion paths (lifecycle-service.ts).
 *
 * This test locks the CLASS fix by source inspection (no mocks): the two pine-export
 * functions must thread an `authority` param into their audit rows (not hardcode
 * 'human'), and every autonomous caller must pass 'system'. Reverting any single site
 * RED-proofs here.
 *
 * NOTE ON SCOPE: route handlers (src/server/routes/*.ts) are human-triggered by
 * definition and correctly write 'human' — they are intentionally NOT covered here.
 * Only service-layer functions reachable from crons / lifecycle auto-promotion / the
 * heartbeat are in-class.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("freshscan10 — decision_authority pattern-class (autonomous paths must not fake operator activity)", () => {
  it("pine-export-service.ts: both compile functions accept an authority param and NEVER hardcode 'human'", () => {
    const src = readSrc("../pine-export-service.ts");
    // No audit row may hardcode 'human' — all must thread the authority param.
    expect(src).not.toMatch(/decisionAuthority: "human"/);
    // Both functions must declare the authority union param.
    const authParamCount = (src.match(/authority: "human" \| "system" = "human"/g) ?? []).length;
    expect(authParamCount).toBe(2); // compilePineExport + compileDualPineExport
    // Every audit site now threads it (4 sites: 2 per function × success/failure).
    const threaded = (src.match(/decisionAuthority: authority/g) ?? []).length;
    expect(threaded).toBeGreaterThanOrEqual(4);
  });

  it("scheduler.ts deployed-pine-artifact-check cron passes 'system' to compilePineExport", () => {
    const src = readSrc("../../scheduler.ts");
    const idx = src.indexOf("compilePineExport(strat.strategyId");
    expect(idx).toBeGreaterThan(-1);
    const call = src.slice(idx, idx + 160);
    expect(call).toContain('"system"');
  });

  it("lifecycle-service.ts autonomous promotion Pine compiles pass 'system'", () => {
    const src = readSrc("../lifecycle-service.ts");
    // DEPLOY_READY auto-promote (triggerPineCompile) and PILOT→DEPLOYED auto-promote.
    // Both persist=true audit-writing calls must end with the 'system' authority arg.
    for (const anchor of ["compileDualPineExport(strategyId, firmKey, riskIntelligence, true", "compileDualPineExport(s.id, undefined, undefined, true"]) {
      const idx = src.indexOf(anchor);
      expect(idx, `missing autonomous call: ${anchor}`).toBeGreaterThan(-1);
      const call = src.slice(idx, idx + 220);
      expect(call, `autonomous call must pass 'system': ${anchor}`).toContain('"system"');
    }
  });

  it("monte-carlo + quantum-mc auto-fire Pine compiles pass 'system'", () => {
    for (const rel of ["../monte-carlo-service.ts", "../quantum-mc-service.ts"]) {
      const src = readSrc(rel);
      const idx = src.indexOf("compilePineExport(bt.strategyId");
      expect(idx, `missing compilePineExport in ${rel}`).toBeGreaterThan(-1);
      const call = src.slice(idx, idx + 200);
      expect(call, `auto-fire compile must pass 'system' in ${rel}`).toContain('"system"');
    }
  });

  it("admin.ts self-restart (the original MED#2 instance) uses parentId-conditional authority", () => {
    const src = readSrc("../../routes/admin.ts");
    const idx = src.indexOf('action: "system.self_restart_requested"');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 400);
    expect(block).toContain('decisionAuthority: parentId ? "system" : "human"');
  });
});
