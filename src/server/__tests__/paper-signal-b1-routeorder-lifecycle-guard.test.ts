/**
 * paper-signal-b1-routeorder-lifecycle-guard.test.ts — B1 (2026-06-23)
 *
 * Capital-safety guard: the A/B rl-challenger routeOrder() call in
 * paper-signal-service.ts places an EXTERNAL broker order (TradersPost). Per §8
 * paper-engine authority, ONLY PAPER+ lifecycle states (PAPER/DEPLOY_READY/PILOT/
 * DEPLOYED) may reach the broker — CANDIDATE/TESTING use the internal simulator.
 * Before B1 the branch fired routeOrder() for pre-PAPER states.
 *
 * Source-code analysis tests (readFileSync + string match) — no DB / service calls,
 * consistent with paper-start-refuses-paper-state.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

describe("B1 — routeOrder() lifecycle guard (capital safety)", () => {
  it("defines PAPER_PLUS_STATES with the 4 broker-eligible states", () => {
    expect(SRC).toContain("PAPER_PLUS_STATES");
    const idx = SRC.indexOf('const PAPER_PLUS_STATES = ["PAPER"');
    expect(idx).toBeGreaterThan(-1);
    const decl = SRC.slice(idx, idx + 120);
    expect(decl).toContain("PAPER");
    expect(decl).toContain("DEPLOY_READY");
    expect(decl).toContain("PILOT");
    expect(decl).toContain("DEPLOYED");
  });

  it("guards the rl-challenger routeOrder() call behind the PAPER_PLUS_STATES check", () => {
    // The routeOrder import + call must sit INSIDE the PAPER_PLUS_STATES.includes branch.
    const guardIdx = SRC.indexOf("PAPER_PLUS_STATES.includes(lcStateForRouting)");
    expect(guardIdx).toBeGreaterThan(-1);
    const routeImportIdx = SRC.indexOf('const { routeOrder } = await import("./broker-router.js")');
    expect(routeImportIdx).toBeGreaterThan(-1);
    // routeOrder import must come AFTER the guard check (i.e. it's nested under the else).
    expect(routeImportIdx).toBeGreaterThan(guardIdx);
  });

  it("does NOT contain the old 'For CANDIDATE/TESTING ... we call routeOrder() directly' comment", () => {
    // The pre-B1 comment explicitly authorized broker calls for pre-PAPER states — must be gone.
    expect(SRC).not.toContain("For CANDIDATE/TESTING in the internal bar-evaluation loop, we call");
  });

  it("logs a skip warning (not a throw) for non-PAPER+ lifecycle states", () => {
    expect(SRC).toContain("B1: routeOrder skipped — non-PAPER+ lifecycle state");
    // Must be a warn (skip + continue), not a throw that would break the bar-eval loop.
    // Window is generous (600 chars) because the logger.warn's structured-object arg
    // spans several lines before the message string.
    const skipIdx = SRC.indexOf("B1: routeOrder skipped");
    const window = SRC.slice(Math.max(0, skipIdx - 600), skipIdx + 80);
    expect(window).toContain("logger.warn");
    expect(window).not.toContain("throw ");
  });
});
