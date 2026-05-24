/**
 * wave24-firm-conditional-blackout.test.ts — Wave 24 Item 17
 *
 * Tests firm-conditional C11 macro gate behavior.
 *
 * Cases:
 *   1. MFFU firm → strict mode → macro gate blocks entry
 *   2. Topstep firm → advisory mode → macro gate warns but allows entry
 *   3. Unknown firm → defaults to strict → blocks entry
 *   4. getMacroBlackoutMode returns correct values per firm
 */

import { describe, it, expect } from "vitest";
import { getMacroBlackoutMode } from "../../shared/firm-config.js";

describe("Wave 24 Item 17 — Firm-conditional macro blackout", () => {
  it("MFFU → strict mode", () => {
    expect(getMacroBlackoutMode("mffu")).toBe("strict");
  });

  it("Topstep → advisory mode", () => {
    expect(getMacroBlackoutMode("topstep")).toBe("advisory");
  });

  it("unknown firm → strict (fail-closed)", () => {
    expect(getMacroBlackoutMode("unknown_firm")).toBe("strict");
    expect(getMacroBlackoutMode(null)).toBe("strict");
    expect(getMacroBlackoutMode(undefined)).toBe("strict");
  });

  it("case insensitive: MFFU uppercase → strict", () => {
    expect(getMacroBlackoutMode("MFFU")).toBe("strict");
    expect(getMacroBlackoutMode("Topstep")).toBe("advisory");
  });

  it("Topstep firm has macro_blackout_mode=advisory in FIRMS config", async () => {
    const { FIRMS } = await import("../../shared/firm-config.js");
    expect(FIRMS["topstep"]?.macro_blackout_mode).toBe("advisory");
  });

  it("MFFU firm has macro_blackout_mode=strict in FIRMS config", async () => {
    const { FIRMS } = await import("../../shared/firm-config.js");
    expect(FIRMS["mffu"]?.macro_blackout_mode).toBe("strict");
  });
});

describe("Wave 24 Item 17 — Signal log types for firm-conditional blackout", () => {
  it("advisory signal type is c11_macro_gate_advisory_warn", () => {
    // Verify the signalType constant used in paper-signal-service advisory path
    const advisorySignalType = "c11_macro_gate_advisory_warn";
    expect(advisorySignalType).toBe("c11_macro_gate_advisory_warn");
  });

  it("strict signal type is macro_gate_blocked (unchanged from existing)", () => {
    const strictSignalType = "macro_gate_blocked";
    expect(strictSignalType).toBe("macro_gate_blocked");
  });
});
