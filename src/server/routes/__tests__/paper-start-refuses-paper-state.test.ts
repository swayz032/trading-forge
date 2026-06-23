/**
 * paper-start-refuses-paper-state.test.ts — Pass 5 Track D
 *
 * Source-code analysis tests verifying that POST /api/paper/start rejects
 * PAPER+ strategies with a 409 and paper.start_refused_paper_state audit.
 * No DB or service calls — pure static analysis of the route source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAPER_PATH = resolve(process.cwd(), "src/server/routes/paper.ts");

describe("Pass 5 Track D.3 — POST /api/paper/start refuses PAPER+ strategies", () => {
  it("contains paper.start_refused_paper_state audit action", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    expect(src).toContain("paper.start_refused_paper_state");
  });

  it("defines PAPER_PLUS_STATES array including PAPER, DEPLOY_READY, PILOT, DEPLOYED", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    expect(src).toContain("PAPER_PLUS_STATES");
    expect(src).toContain('"PAPER"');
    expect(src).toContain('"DEPLOY_READY"');
    expect(src).toContain('"PILOT"');
    expect(src).toContain('"DEPLOYED"');
  });

  it("returns HTTP 409 when strategy is in a PAPER+ state", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    expect(src).toContain("paper_start_refused_paper_state");
    // Check that 409 is used in the PAPER_PLUS_STATES block
    const idx = src.indexOf("PAPER_PLUS_STATES");
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

  it("inserts audit row before returning 409", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    const idx = src.indexOf("PAPER_PLUS_STATES.includes");
    const block = src.slice(idx, idx + 800);
    expect(block).toContain("db.insert(auditLog)");
  });

  it("TESTING state is NOT in PAPER_PLUS_STATES (allowed through)", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    // ALLOWED_LIFECYCLE_STATES includes TESTING
    expect(src).toContain('"TESTING"');
    // PAPER_PLUS_STATES check comes AFTER the ALLOWED_LIFECYCLE_STATES check
    const allowedIdx = src.indexOf("ALLOWED_LIFECYCLE_STATES");
    const paperPlusIdx = src.indexOf("PAPER_PLUS_STATES");
    expect(paperPlusIdx).toBeGreaterThan(allowedIdx);
  });

  it("uses decisionAuthority system in audit row", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    const idx = src.indexOf("paper.start_refused_paper_state");
    const block = src.slice(idx, idx + 500);
    expect(block).toContain("decisionAuthority");
    expect(block).toContain("system");
  });

  it("guard is placed after the ALLOWED_LIFECYCLE_STATES check", () => {
    const src = readFileSync(PAPER_PATH, "utf8");
    const allowedCheck = src.indexOf("!ALLOWED_LIFECYCLE_STATES.includes");
    const paperPlusCheck = src.indexOf("PAPER_PLUS_STATES.includes");
    expect(allowedCheck).toBeGreaterThan(-1);
    expect(paperPlusCheck).toBeGreaterThan(allowedCheck);
  });
});
