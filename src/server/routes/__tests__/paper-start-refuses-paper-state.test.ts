/**
 * paper-start-refuses-paper-state.test.ts — Pass 5 Track D (2026-06-23),
 * INVERTED for M3 PAPER Authority Flip (2026-07-17).
 *
 * OLD doctrine (pre-M3): POST /api/paper/start rejected PAPER+ strategies
 * (PAPER, DEPLOY_READY, PILOT, DEPLOYED) with a 409 and
 * paper.start_refused_paper_state audit — TradersPost was canonical for PAPER
 * and beyond.
 *
 * NEW doctrine (M3): PAPER is internal-engine-only. This route now ALLOWS a
 * PAPER-state strategy to start an internal paper session. Only DEPLOY_READY /
 * PILOT / DEPLOYED remain rejected (those stay TradersPost-authoritative,
 * untouched by this wave). The 409 + audit action name are preserved for the
 * narrowed set.
 *
 * Source-code analysis tests — no DB or service calls, consistent with the
 * original file's convention.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BROKER_AUTHORITATIVE_STATES, isBrokerAuthoritativeState } from "../../lib/paper-authority-states.js";

const PAPER_PATH = resolve(process.cwd(), "src/server/routes/paper.ts");
const AUTHORITY_STATES_PATH = resolve(process.cwd(), "src/server/lib/paper-authority-states.ts");

describe("M3 — POST /api/paper/start refuses only broker-authoritative (DEPLOY_READY/PILOT/DEPLOYED) strategies", () => {
  it("imports BROKER_AUTHORITATIVE_STATES from the shared paper-authority-states module (not a local literal)", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    expect(src).toContain('from "../lib/paper-authority-states.js"');
    expect(src).toContain("BROKER_AUTHORITATIVE_STATES");
  });

  it("does NOT re-declare a local PAPER_PLUS_STATES-shaped literal array (drift-guard)", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    // The old local declaration shape — if this reappears, someone reintroduced
    // an independent literal instead of using the shared module.
    expect(src).not.toContain('const PAPER_PLUS_STATES = ["PAPER"');
    expect(src).not.toContain('["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"]');
  });

  it("the shared module's BROKER_AUTHORITATIVE_STATES value does NOT include PAPER", () => {
    const src = readFileSync(AUTHORITY_STATES_PATH, "utf8");
    const idx = src.indexOf("export const BROKER_AUTHORITATIVE_STATES");
    expect(idx).toBeGreaterThan(-1);
    const decl = src.slice(idx, idx + 120);
    expect(decl).not.toContain('"PAPER"');
    expect(decl).toContain("DEPLOY_READY");
    expect(decl).toContain("PILOT");
    expect(decl).toContain("DEPLOYED");
  });

  it("still returns HTTP 409 for the (narrowed) broker-authoritative set", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    expect(src).toContain("paper_start_refused_paper_state");
    const idx = src.indexOf("BROKER_AUTHORITATIVE_STATES.includes");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1000);
    expect(block).toContain("status(409)");
  });

  it("includes lifecycleState and blocked_at in the 409 response", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    const idx = src.indexOf("paper_start_refused_paper_state");
    const block = src.slice(idx, idx + 800);
    expect(block).toContain("lifecycleState");
    expect(block).toContain("blocked_at");
  });

  it("still emits paper.start_refused_paper_state audit row before returning 409", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    const idx = src.indexOf("BROKER_AUTHORITATIVE_STATES.includes");
    const block = src.slice(idx, idx + 800);
    expect(block).toContain("db.insert(auditLog)");
    expect(block).toContain('action: "paper.start_refused_paper_state"');
  });

  it("TESTING state is NOT broker-authoritative (allowed through, regression)", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    expect(src).toContain('"TESTING"');
    const allowedIdx = src.indexOf("ALLOWED_LIFECYCLE_STATES");
    const guardIdx = src.indexOf("BROKER_AUTHORITATIVE_STATES.includes");
    expect(guardIdx).toBeGreaterThan(allowedIdx);
  });

  it("PAPER state is NO LONGER rejected (M3 inversion — the doctrine-pinning RED-proof)", () => {
    // Behavioral proof against the REAL, live-imported constant the route itself
    // uses (confirmed by the import + drift-guard tests above to be the SAME
    // object `routes/paper.ts` checks at its `.includes()` call site) — not a
    // re-implemented mirror. Reverting BROKER_AUTHORITATIVE_STATES to the old
    // 4-state value (re-adding "PAPER") flips this RED.
    expect(isBrokerAuthoritativeState("PAPER")).toBe(false);
    expect(BROKER_AUTHORITATIVE_STATES).not.toContain("PAPER");
  });

  it("DEPLOY_READY / PILOT / DEPLOYED remain rejected (regression — untouched by this wave)", () => {
    expect(isBrokerAuthoritativeState("DEPLOY_READY")).toBe(true);
    expect(isBrokerAuthoritativeState("PILOT")).toBe(true);
    expect(isBrokerAuthoritativeState("DEPLOYED")).toBe(true);
  });

  it("uses decisionAuthority system in the refusal audit row", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    const idx = src.indexOf("paper.start_refused_paper_state");
    const block = src.slice(idx, idx + 500);
    expect(block).toContain("decisionAuthority");
    expect(block).toContain("system");
  });

  it("guard is placed after the ALLOWED_LIFECYCLE_STATES check", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    const allowedCheck = src.indexOf("!ALLOWED_LIFECYCLE_STATES.includes");
    const guardCheck = src.indexOf("BROKER_AUTHORITATIVE_STATES.includes");
    expect(allowedCheck).toBeGreaterThan(-1);
    expect(guardCheck).toBeGreaterThan(allowedCheck);
  });
});
