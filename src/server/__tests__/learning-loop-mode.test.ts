/**
 * learning-loop-mode.test.ts
 *
 * Unit coverage for the 3-MODE autonomous-loop control helper
 * (src/server/lib/learning-loop-mode.ts).
 *
 * Two surfaces:
 *   - parseLearningLoopMode(): pure clamp/validate (0|1|2, fail-closed)
 *   - readLearningLoopMode(): DB read → {mode, advisoryOn, autonomousOn}, fail-closed
 *
 * SAFETY CRUX verified here: OBSERVE (mode 1) → advisoryOn=true but
 * autonomousOn=FALSE. Only AUTOPILOT (mode 2) sets autonomousOn=true.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({
  systemParameters: {
    currentValue: "currentValue",
    paramName: "paramName",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "__eq__"),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────
import { db } from "../db/index.js";
import {
  parseLearningLoopMode,
  readLearningLoopMode,
  learningLoopModeLabel,
  MODE_OFF,
  MODE_OBSERVE,
  MODE_AUTOPILOT,
  LEARNING_LOOP_MODE_PARAM,
} from "../lib/learning-loop-mode.js";

/** Build a select chain whose .limit() resolves to `rows` (or throws). */
function mockSelect(rows: unknown[] | (() => never)): void {
  (db as any).select = vi.fn().mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () =>
          typeof rows === "function" ? rows() : Promise.resolve(rows),
      }),
    }),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("constants + label", () => {
  it("mode constants are 0/1/2", () => {
    expect(MODE_OFF).toBe(0);
    expect(MODE_OBSERVE).toBe(1);
    expect(MODE_AUTOPILOT).toBe(2);
  });

  it("param key is the well-known DB key", () => {
    expect(LEARNING_LOOP_MODE_PARAM).toBe("auto_patch_loop_enabled");
  });

  it("learningLoopModeLabel maps 0/1/2 → OFF/OBSERVE/AUTOPILOT", () => {
    expect(learningLoopModeLabel(0)).toBe("OFF");
    expect(learningLoopModeLabel(1)).toBe("OBSERVE");
    expect(learningLoopModeLabel(2)).toBe("AUTOPILOT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("parseLearningLoopMode — pure clamp/validate (fail-closed)", () => {
  it("null / undefined → OFF", () => {
    expect(parseLearningLoopMode(null)).toBe(0);
    expect(parseLearningLoopMode(undefined)).toBe(0);
  });

  it("canonical numerics: 0/1/2 (string + number) map directly", () => {
    expect(parseLearningLoopMode("0")).toBe(0);
    expect(parseLearningLoopMode(0)).toBe(0);
    expect(parseLearningLoopMode("1")).toBe(1);
    expect(parseLearningLoopMode(1)).toBe(1);
    expect(parseLearningLoopMode("2")).toBe(2);
    expect(parseLearningLoopMode(2)).toBe(2);
  });

  it("values >= 2 clamp to AUTOPILOT (no silent over-range)", () => {
    expect(parseLearningLoopMode("3")).toBe(2);
    expect(parseLearningLoopMode(5)).toBe(2);
    expect(parseLearningLoopMode(100)).toBe(2);
  });

  it("fractional values floor to the LOWER mode (never escalate)", () => {
    expect(parseLearningLoopMode(1.9)).toBe(1); // OBSERVE, not AUTOPILOT
    expect(parseLearningLoopMode("1.9")).toBe(1);
    expect(parseLearningLoopMode(0.9)).toBe(0); // OFF, not OBSERVE
    expect(parseLearningLoopMode(2.9)).toBe(2);
  });

  it("negatives → OFF", () => {
    expect(parseLearningLoopMode(-1)).toBe(0);
    expect(parseLearningLoopMode("-5")).toBe(0);
  });

  it("non-numeric strings → OFF (fail-closed)", () => {
    for (const v of ["true", "false", "yes", "enabled", "TRUE", "", "  ", "abc"]) {
      expect(parseLearningLoopMode(v)).toBe(0);
    }
  });

  it("NaN → OFF", () => {
    expect(parseLearningLoopMode(NaN)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("readLearningLoopMode — DB read + derived flags (fail-closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("value '2' → AUTOPILOT: advisoryOn=true, autonomousOn=true", async () => {
    mockSelect([{ currentValue: "2" }]);
    const r = await readLearningLoopMode();
    expect(r.mode).toBe(2);
    expect(r.advisoryOn).toBe(true);
    expect(r.autonomousOn).toBe(true);
  });

  it("SAFETY CRUX — value '1' → OBSERVE: advisoryOn=true but autonomousOn=FALSE", async () => {
    mockSelect([{ currentValue: "1" }]);
    const r = await readLearningLoopMode();
    expect(r.mode).toBe(1);
    expect(r.advisoryOn).toBe(true);
    expect(r.autonomousOn).toBe(false);
  });

  it("value '0' → OFF: both flags false", async () => {
    mockSelect([{ currentValue: "0" }]);
    const r = await readLearningLoopMode();
    expect(r.mode).toBe(0);
    expect(r.advisoryOn).toBe(false);
    expect(r.autonomousOn).toBe(false);
  });

  it("absent row → OFF (fail-closed)", async () => {
    mockSelect([]);
    const r = await readLearningLoopMode();
    expect(r).toEqual({ mode: 0, advisoryOn: false, autonomousOn: false });
  });

  it("DB error → OFF (fail-closed, never throws)", async () => {
    mockSelect(() => {
      throw new Error("db_down");
    });
    const r = await readLearningLoopMode();
    expect(r).toEqual({ mode: 0, advisoryOn: false, autonomousOn: false });
  });

  it("non-numeric stored value ('true') → OFF (fail-closed)", async () => {
    mockSelect([{ currentValue: "true" }]);
    const r = await readLearningLoopMode();
    expect(r.mode).toBe(0);
    expect(r.autonomousOn).toBe(false);
  });
});
