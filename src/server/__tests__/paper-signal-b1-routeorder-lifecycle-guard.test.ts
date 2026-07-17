/**
 * paper-signal-b1-routeorder-lifecycle-guard.test.ts — B1 (2026-06-23),
 * INVERTED for M3 PAPER Authority Flip (2026-07-17), item 3.
 *
 * Capital-safety guard: the A/B rl-challenger routeOrder() call in
 * paper-signal-service.ts places an EXTERNAL broker order (TradersPost). Per
 * §8 paper-engine authority, ONLY broker-authoritative lifecycle states may
 * reach the broker.
 *
 * OLD doctrine (pre-M3): broker-eligible = {PAPER, DEPLOY_READY, PILOT,
 * DEPLOYED} via a local `PAPER_PLUS_STATES` literal declared at this call
 * site — one of 3 independent copies of the same value across the codebase.
 *
 * NEW doctrine (M3): broker-eligible = {DEPLOY_READY, PILOT, DEPLOYED} —
 * PAPER moved OUT. This call site now imports the shared
 * `BROKER_AUTHORITATIVE_STATES` constant (paper-authority-states.ts) instead
 * of declaring its own literal, closing the duplicated-constant class the
 * packet's item 3 flags.
 *
 * Source-code analysis tests (readFileSync + string match) — no DB / service
 * calls, consistent with paper-start-refuses-paper-state.test.ts, PLUS
 * behavioral assertions against the REAL, live-imported shared constant (not
 * a re-implemented mirror).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { BROKER_AUTHORITATIVE_STATES, isBrokerAuthoritativeState } from "../lib/paper-authority-states.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

describe("B1 — routeOrder() lifecycle guard (capital safety), M3-inverted", () => {
  it("imports BROKER_AUTHORITATIVE_STATES from the shared paper-authority-states module (not a local literal)", () => {
    expect(SRC).toContain('import { BROKER_AUTHORITATIVE_STATES } from "../lib/paper-authority-states.js"');
  });

  it("does NOT re-declare a local PAPER_PLUS_STATES literal at this call site (drift-guard)", () => {
    expect(SRC).not.toContain('const PAPER_PLUS_STATES = ["PAPER"');
    expect(SRC).not.toContain('["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"]');
  });

  it("guards the rl-challenger routeOrder() call behind BROKER_AUTHORITATIVE_STATES.includes", () => {
    // The routeOrder import + call must sit INSIDE the BROKER_AUTHORITATIVE_STATES.includes branch.
    const guardIdx = SRC.indexOf("BROKER_AUTHORITATIVE_STATES.includes(lcStateForRouting");
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

  it("logs a skip warning (not a throw) for non-broker-authoritative lifecycle states", () => {
    expect(SRC).toContain("B1: routeOrder skipped — non-broker-authoritative lifecycle state");
    // Must be a warn (skip + continue), not a throw that would break the bar-eval loop.
    const skipIdx = SRC.indexOf("B1: routeOrder skipped");
    const window = SRC.slice(Math.max(0, skipIdx - 600), skipIdx + 80);
    expect(window).toContain("logger.warn");
    expect(window).not.toContain("throw ");
  });

  it("PAPER is no longer broker-eligible at this call site (M3 doctrine-pinning RED-proof)", () => {
    // Behavioral proof against the REAL constant this call site imports (proven
    // by the import-presence test above to be the SAME object) — not a mirror.
    // Reverting BROKER_AUTHORITATIVE_STATES to the old 4-state value (re-adding
    // "PAPER") flips this RED.
    expect(isBrokerAuthoritativeState("PAPER")).toBe(false);
    expect(BROKER_AUTHORITATIVE_STATES).not.toContain("PAPER");
  });

  it("DEPLOY_READY / PILOT / DEPLOYED remain broker-eligible (regression — untouched by this wave)", () => {
    expect(isBrokerAuthoritativeState("DEPLOY_READY")).toBe(true);
    expect(isBrokerAuthoritativeState("PILOT")).toBe(true);
    expect(isBrokerAuthoritativeState("DEPLOYED")).toBe(true);
  });

  it("a PAPER-state strategy routed to rl-challenger cannot reach routeOrder() here (structural, item 3+4 combined proof)", () => {
    // This is the exact mechanism that structurally closes item 4's shadow-
    // override branch: even when that branch falls through to this normal
    // path, `!BROKER_AUTHORITATIVE_STATES.includes("PAPER")` is true, so the
    // `else` branch containing the routeOrder() call is unreachable for PAPER.
    const lcStateForRouting = "PAPER";
    const wouldSkipRouteOrder = !BROKER_AUTHORITATIVE_STATES.includes(
      lcStateForRouting as (typeof BROKER_AUTHORITATIVE_STATES)[number],
    );
    expect(wouldSkipRouteOrder).toBe(true);
  });
});
