/**
 * deepscan17-wave2 (2026-07-05) — H2 primary.
 *
 * The DrawdownCard previously hardcoded "trailing DD" text, mislabeling an MFFU
 * daily-DLL account (dllModel="daily_dll_pct") as trailing-DD. dllModelLabel maps
 * the wire field the backend already emits (production-status route) to the
 * correct plain-English copy. These tests lock the mapping.
 */
import { describe, it, expect } from "vitest";
import { dllModelLabel } from "../ProductionStatusPanel";

describe("deepscan17-wave2 — dllModelLabel", () => {
  it("Topstep trailing-DD model renders 'trailing DD'", () => {
    expect(dllModelLabel("trailing_dd_hwm")).toBe("trailing DD");
  });

  it("MFFU daily-DLL model renders 'daily loss limit' (was mislabeled trailing DD)", () => {
    expect(dllModelLabel("daily_dll_pct")).toBe("daily loss limit");
  });

  it("unknown-firm estimate renders 'est. loss limit'", () => {
    expect(dllModelLabel("estimate_5pct")).toBe("est. loss limit");
  });

  it("null model falls back to a neutral 'loss limit' (never assumes trailing)", () => {
    expect(dllModelLabel(null)).toBe("loss limit");
  });
});
