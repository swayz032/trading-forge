/**
 * mode-ab-guard.test.ts — roadmap Band E, items E1 + E4 (2026-07-02)
 *
 * Pure unit tests for src/server/lib/mode-ab-guard.ts. No DB, no HTTP, no engine calls —
 * this module is DB-free by design (see file header), so these tests run in complete
 * isolation and exercise every branch of the E4 threshold constant plus the mode_ab
 * governance-label build/validate contract that mirrors
 * scripts/full-battery-mode-ab.py::build_mode_ab_labels / validate_mode_ab_labels.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  getOverlayAplusRetentionFloor,
  OVERLAY_APLUS_RETENTION_FLOOR_DEFAULT,
  OVERLAY_CONFIG_HASH_OMITS_MODE_TOGGLE,
  buildModeAbLabels,
  validateModeAbLabels,
  assertModeAbLabels,
  ModeAbValidationError,
} from "../lib/mode-ab-guard.js";

describe("mode-ab-guard: E4 A+ retention floor", () => {
  afterEach(() => {
    delete process.env["OVERLAY_APLUS_RETENTION_FLOOR"];
  });

  it("defaults to 0.80 when env var is unset", () => {
    expect(getOverlayAplusRetentionFloor()).toBe(0.8);
    expect(OVERLAY_APLUS_RETENTION_FLOOR_DEFAULT).toBe(0.8);
  });

  it("defaults to 0.80 when env var is empty string", () => {
    process.env["OVERLAY_APLUS_RETENTION_FLOOR"] = "";
    expect(getOverlayAplusRetentionFloor()).toBe(0.8);
  });

  it("reads a valid override from env", () => {
    process.env["OVERLAY_APLUS_RETENTION_FLOOR"] = "0.9";
    expect(getOverlayAplusRetentionFloor()).toBe(0.9);
  });

  it("falls back to default on a non-numeric env value", () => {
    process.env["OVERLAY_APLUS_RETENTION_FLOOR"] = "not-a-number";
    expect(getOverlayAplusRetentionFloor()).toBe(0.8);
  });

  it("falls back to default when env value is out of [0,1] range", () => {
    process.env["OVERLAY_APLUS_RETENTION_FLOOR"] = "1.5";
    expect(getOverlayAplusRetentionFloor()).toBe(0.8);

    process.env["OVERLAY_APLUS_RETENTION_FLOOR"] = "-0.1";
    expect(getOverlayAplusRetentionFloor()).toBe(0.8);
  });

  it("accepts exact boundary values 0 and 1", () => {
    process.env["OVERLAY_APLUS_RETENTION_FLOOR"] = "0";
    expect(getOverlayAplusRetentionFloor()).toBe(0);

    process.env["OVERLAY_APLUS_RETENTION_FLOOR"] = "1";
    expect(getOverlayAplusRetentionFloor()).toBe(1);
  });
});

describe("mode-ab-guard: coordination finding marker", () => {
  it("documents that overlay_config_hash omits the mode toggle (true today, 2026-07-02)", () => {
    // This constant is intentionally a static true — it exists so future code can grep for it
    // and so this test fails loudly the day someone flips it without updating provenance-stamp.ts.
    expect(OVERLAY_CONFIG_HASH_OMITS_MODE_TOGGLE).toBe(true);
  });
});

describe("mode-ab-guard: buildModeAbLabels", () => {
  it("builds well-formed Mode A labels", () => {
    const labels = buildModeAbLabels("spec-123", "A", true);
    expect(labels.mode_ab_battery).toBe(true);
    expect(labels.governance_advisory).toBe(true);
    expect(labels.persist_to_production).toBe(false);
    expect(labels.mode).toBe("A");
    expect(labels.overlay_disabled).toBe(true);
    expect(labels.tf_confluence_overlay_disabled_env).toBe("true");
    expect(labels.spec_id).toBe("spec-123");
    expect(labels.authority).toContain("research_only");
    expect(labels.authority).toContain("overlay-unfreeze-protocol");
  });

  it("builds well-formed Mode B labels", () => {
    const labels = buildModeAbLabels("spec-456", "B", false);
    expect(labels.mode).toBe("B");
    expect(labels.overlay_disabled).toBe(false);
    expect(labels.tf_confluence_overlay_disabled_env).toBe("false");
  });
});

describe("mode-ab-guard: validateModeAbLabels", () => {
  it("passes for a well-formed labels object", () => {
    const labels = buildModeAbLabels("spec-1", "A", true);
    const result = validateModeAbLabels(labels);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects null", () => {
    const result = validateModeAbLabels(null);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a non-object", () => {
    const result = validateModeAbLabels("not an object");
    expect(result.ok).toBe(false);
  });

  it("rejects a missing mode_ab_battery marker", () => {
    const labels = { ...buildModeAbLabels("spec-1", "A", true), mode_ab_battery: undefined };
    const result = validateModeAbLabels(labels);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("mode_ab_battery"))).toBe(true);
  });

  it("rejects an invalid mode value", () => {
    const labels = { ...buildModeAbLabels("spec-1", "A", true), mode: "C" };
    const result = validateModeAbLabels(labels);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("mode"))).toBe(true);
  });

  it("rejects a non-boolean overlay_disabled", () => {
    const labels = { ...buildModeAbLabels("spec-1", "A", true), overlay_disabled: "true" };
    const result = validateModeAbLabels(labels);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("overlay_disabled"))).toBe(true);
  });

  it("rejects persist_to_production=true — mode-A/B results are never production verdicts", () => {
    const labels = { ...buildModeAbLabels("spec-1", "A", true), persist_to_production: true };
    const result = validateModeAbLabels(labels);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("persist_to_production"))).toBe(true);
  });

  it("rejects an empty spec_id", () => {
    const labels = { ...buildModeAbLabels("spec-1", "A", true), spec_id: "" };
    const result = validateModeAbLabels(labels);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("spec_id"))).toBe(true);
  });

  it("accumulates multiple errors at once", () => {
    const result = validateModeAbLabels({ mode: "Z", overlay_disabled: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3); // marker + mode + overlay_disabled (+ more)
  });
});

describe("mode-ab-guard: assertModeAbLabels (throwing variant)", () => {
  it("does not throw for well-formed labels", () => {
    const labels = buildModeAbLabels("spec-1", "B", false);
    expect(() => assertModeAbLabels(labels)).not.toThrow();
  });

  it("throws ModeAbValidationError for malformed labels", () => {
    expect(() => assertModeAbLabels({ mode: "nope" })).toThrow(ModeAbValidationError);
  });

  it("error message includes the underlying validation reasons", () => {
    try {
      assertModeAbLabels({ mode: "nope" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ModeAbValidationError);
      expect((err as ModeAbValidationError).errors.length).toBeGreaterThan(0);
      expect((err as Error).message).toContain("mode_ab_guard");
    }
  });
});
