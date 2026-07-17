/**
 * paper-authority-states.test.ts — M3-core: PAPER Authority Flip (2026-07-17)
 *
 * Unit tests for the shared broker-authoritative-states module, plus a
 * drift-guard suite proving the single-authority extraction actually holds:
 * every one of the 3 formerly-independent call sites (routes/paper.ts,
 * paper-signal-service.ts, scheduler.ts) now imports from this module instead
 * of declaring its own literal — so the value can never diverge between them.
 *
 * Per the packet's verification (e): "RED-proof the shared-constant
 * extraction itself (temporarily let one site diverge, confirm SOME test
 * catches the drift)". Since all 3 sites import the SAME live object (proven
 * by the import-presence checks below), there is no way for one site to hold
 * a different value than another without either (a) re-adding a local literal
 * at that site — which the "no local re-declaration" tests below catch — or
 * (b) that site's own test suite (paper-start-refuses-paper-state.test.ts /
 * paper-signal-b1-routeorder-lifecycle-guard.test.ts / scheduler tests)
 * asserting a value from a *different* module than the one imported here,
 * which the cross-file "same object identity" style checks below rule out.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BROKER_AUTHORITATIVE_STATES,
  isBrokerAuthoritativeState,
} from "../paper-authority-states.js";

// Grader F-1 (2026-07-17, M3 independent grade): server-mediated-executor.ts
// only needs `db/index.js` stubbed to load cleanly (probed directly — every
// other transitive import is side-effect-free at module-load time); this lets
// the strict-subset test below import and assert against the REAL
// `LIVE_EXECUTION_STATES` object instead of a hand-maintained copy that could
// silently drift from the file it claims to describe.
vi.mock("../../db/index.js", () => ({ db: {} }));

const ROUTES_PAPER_PATH = resolve(process.cwd(), "src/server/routes/paper.ts");
const PAPER_SIGNAL_SERVICE_PATH = resolve(process.cwd(), "src/server/services/paper-signal-service.ts");
const SCHEDULER_PATH = resolve(process.cwd(), "src/server/scheduler.ts");
const SERVER_MEDIATED_EXECUTOR_PATH = resolve(process.cwd(), "src/server/services/server-mediated-executor.ts");

describe("BROKER_AUTHORITATIVE_STATES — value", () => {
  it("contains exactly DEPLOY_READY, PILOT, DEPLOYED (3 entries)", () => {
    expect([...BROKER_AUTHORITATIVE_STATES].sort()).toEqual(["DEPLOYED", "DEPLOY_READY", "PILOT"].sort());
    expect(BROKER_AUTHORITATIVE_STATES).toHaveLength(3);
  });

  it("does NOT contain PAPER (the M3 flip)", () => {
    expect(BROKER_AUTHORITATIVE_STATES).not.toContain("PAPER");
  });

  it("does NOT contain any pre-PAPER state (CANDIDATE/TESTING/SHADOW)", () => {
    expect(BROKER_AUTHORITATIVE_STATES).not.toContain("CANDIDATE");
    expect(BROKER_AUTHORITATIVE_STATES).not.toContain("TESTING");
    expect(BROKER_AUTHORITATIVE_STATES).not.toContain("SHADOW");
  });
});

describe("isBrokerAuthoritativeState()", () => {
  it("true for DEPLOY_READY / PILOT / DEPLOYED", () => {
    expect(isBrokerAuthoritativeState("DEPLOY_READY")).toBe(true);
    expect(isBrokerAuthoritativeState("PILOT")).toBe(true);
    expect(isBrokerAuthoritativeState("DEPLOYED")).toBe(true);
  });

  it("false for PAPER (the M3 flip — PAPER is now internal-engine-only)", () => {
    expect(isBrokerAuthoritativeState("PAPER")).toBe(false);
  });

  it("false for pre-PAPER states", () => {
    expect(isBrokerAuthoritativeState("CANDIDATE")).toBe(false);
    expect(isBrokerAuthoritativeState("TESTING")).toBe(false);
    expect(isBrokerAuthoritativeState("SHADOW")).toBe(false);
  });

  it("false for terminal/rework states (DECLINING/NEEDS_REVISION/RETIRED/GRAVEYARD) — out of this wave's scope", () => {
    expect(isBrokerAuthoritativeState("DECLINING")).toBe(false);
    expect(isBrokerAuthoritativeState("NEEDS_REVISION")).toBe(false);
    expect(isBrokerAuthoritativeState("RETIRED")).toBe(false);
    expect(isBrokerAuthoritativeState("GRAVEYARD")).toBe(false);
  });

  it("false for null/undefined/empty-string (fail-open toward internal engine, matches B5's documented fail-open-on-missing-FK)", () => {
    expect(isBrokerAuthoritativeState(null)).toBe(false);
    expect(isBrokerAuthoritativeState(undefined)).toBe(false);
    expect(isBrokerAuthoritativeState("")).toBe(false);
  });

  it("false for an unknown/garbage string (never throws)", () => {
    expect(() => isBrokerAuthoritativeState("NOT_A_REAL_STATE")).not.toThrow();
    expect(isBrokerAuthoritativeState("NOT_A_REAL_STATE")).toBe(false);
  });
});

describe("drift-guard — all 3 formerly-independent call sites import the shared module", () => {
  it("routes/paper.ts imports BROKER_AUTHORITATIVE_STATES from paper-authority-states.js", () => {
    const src = readFileSync(ROUTES_PAPER_PATH, "utf8");
    expect(src).toContain('import { BROKER_AUTHORITATIVE_STATES } from "../lib/paper-authority-states.js"');
  });

  it("paper-signal-service.ts imports BROKER_AUTHORITATIVE_STATES from paper-authority-states.js", () => {
    const src = readFileSync(PAPER_SIGNAL_SERVICE_PATH, "utf8");
    expect(src).toContain('import { BROKER_AUTHORITATIVE_STATES } from "../lib/paper-authority-states.js"');
  });

  it("scheduler.ts imports isBrokerAuthoritativeState from ./lib/paper-authority-states.js", () => {
    const src = readFileSync(SCHEDULER_PATH, "utf8");
    expect(src).toContain('import { isBrokerAuthoritativeState } from "./lib/paper-authority-states.js"');
  });

  it("none of the 3 sites re-declares a local PAPER_PLUS_STATES-shaped literal (the pre-M3 duplicated-constant shape)", () => {
    for (const path of [ROUTES_PAPER_PATH, PAPER_SIGNAL_SERVICE_PATH, SCHEDULER_PATH]) {
      const src = readFileSync(path, "utf8");
      expect(src).not.toContain('["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"]');
      expect(src).not.toContain('new Set(["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"])');
    }
  });

  it("scheduler.ts's B5 guard actually calls isBrokerAuthoritativeState (not a hand-rolled equivalent)", () => {
    const src = readFileSync(SCHEDULER_PATH, "utf8");
    const idx = src.indexOf("B5: PAPER-ENGINE AUTHORITY GUARD");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1500);
    expect(block).toContain("isBrokerAuthoritativeState(lifecycleState)");
  });

  it("paper-signal-service.ts's RL A/B routing guard actually calls BROKER_AUTHORITATIVE_STATES.includes", () => {
    const src = readFileSync(PAPER_SIGNAL_SERVICE_PATH, "utf8");
    const idx = src.indexOf("lcStateForRouting = sessionConfig.lifecycleState");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 300);
    expect(block).toContain("BROKER_AUTHORITATIVE_STATES.includes(lcStateForRouting");
  });
});

describe("LIVE_EXECUTION_STATES — strict-subset drift-guard (server-mediated-executor.ts)", () => {
  it("is documented as an intentionally independent literal, not derived (fail-open-avoidance decision)", () => {
    const src = readFileSync(SERVER_MEDIATED_EXECUTOR_PATH, "utf8");
    expect(src).toContain("BROKER_AUTHORITATIVE_STATES");
    expect(src).toContain("strict subset");
  });

  // Grader F-1 fix (2026-07-17): the previous version of both tests below
  // asserted against a HAND-MAINTAINED COPY (`new Set(["DEPLOYED", "PILOT"])`)
  // instead of the real, live `LIVE_EXECUTION_STATES` object — so a future
  // accidental widening of the real constant (e.g. adding "DEPLOY_READY") would
  // NOT have been caught by either test, despite their names claiming to guard
  // exactly that. RED-proofed directly: widening the real constant in
  // server-mediated-executor.ts left all tests referencing the copy green.
  // Fixed by dynamically importing the REAL module (only `db/index.js` needs a
  // stub — probed directly, every other transitive import is side-effect-free
  // at module-load time) and asserting against the REAL object.
  it("every LIVE_EXECUTION_STATES member is a member of BROKER_AUTHORITATIVE_STATES (never wider)", async () => {
    const { LIVE_EXECUTION_STATES } = await import("../../services/server-mediated-executor.js");
    expect(LIVE_EXECUTION_STATES.size).toBeGreaterThan(0);
    for (const state of LIVE_EXECUTION_STATES) {
      expect(BROKER_AUTHORITATIVE_STATES).toContain(state);
    }
  });

  it("LIVE_EXECUTION_STATES excludes DEPLOY_READY (broker-authoritative for paper-journal purposes, but not yet live-execution-eligible)", async () => {
    const { LIVE_EXECUTION_STATES } = await import("../../services/server-mediated-executor.js");
    expect(LIVE_EXECUTION_STATES.has("DEPLOY_READY")).toBe(false);
  });

  it("RED-proof self-check: LIVE_EXECUTION_STATES is genuinely {DEPLOYED, PILOT} today (pins the real value so the two tests above are proven non-vacuous)", async () => {
    const { LIVE_EXECUTION_STATES } = await import("../../services/server-mediated-executor.js");
    expect([...LIVE_EXECUTION_STATES].sort()).toEqual(["DEPLOYED", "PILOT"]);
  });
});
