/**
 * firm-broker-topology.test.ts — deep-scan #15 FIX M3
 *
 * Unit coverage for the firm↔broker_type topology invariant helper (single source
 * of truth for the runtime dispatch guard, the write-time guard, and — mirrored —
 * the migration 0190 DB CHECK constraint).
 */

import { describe, it, expect } from "vitest";
import {
  normalizeFirmKey,
  expectedBrokerTypeForFirm,
  validateFirmBrokerTopology,
  assertFirmBrokerTopology,
  FirmBrokerTopologyError,
} from "../firm-broker-topology.js";

describe("normalizeFirmKey / expectedBrokerTypeForFirm", () => {
  it("strips account-tier suffix and lowercases", () => {
    expect(normalizeFirmKey("topstep_50k")).toBe("topstep");
    expect(normalizeFirmKey("MFFU_100K")).toBe("mffu");
    expect(normalizeFirmKey("Topstep")).toBe("topstep");
  });

  it("topstep ⇒ topstepx; everything else ⇒ traderspost", () => {
    expect(expectedBrokerTypeForFirm("topstep")).toBe("topstepx");
    expect(expectedBrokerTypeForFirm("topstep_50k")).toBe("topstepx");
    expect(expectedBrokerTypeForFirm("mffu")).toBe("traderspost");
    expect(expectedBrokerTypeForFirm("mffu_50k")).toBe("traderspost");
  });
});

describe("validateFirmBrokerTopology", () => {
  it("topstep + topstepx is VALID", () => {
    const r = validateFirmBrokerTopology("topstep", "topstepx");
    expect(r.valid).toBe(true);
    expect(r.expectedBrokerType).toBe("topstepx");
    expect(r.reason).toBeNull();
  });

  it("topstep + traderspost is INVALID (the M3 core violation — never traderspost)", () => {
    const r = validateFirmBrokerTopology("topstep", "traderspost");
    expect(r.valid).toBe(false);
    expect(r.expectedBrokerType).toBe("topstepx");
    expect(r.reason).toMatch(/requires broker_type 'topstepx'/);
  });

  it("topstep_50k + traderspost is INVALID (suffix normalized)", () => {
    expect(validateFirmBrokerTopology("topstep_50k", "traderspost").valid).toBe(false);
  });

  it("mffu + traderspost is VALID", () => {
    expect(validateFirmBrokerTopology("mffu", "traderspost").valid).toBe(true);
  });

  it("mffu + topstepx is INVALID", () => {
    const r = validateFirmBrokerTopology("mffu", "topstepx");
    expect(r.valid).toBe(false);
    expect(r.expectedBrokerType).toBe("traderspost");
  });

  it("null/empty firm or broker is INVALID (fail-closed)", () => {
    expect(validateFirmBrokerTopology(null, "traderspost").valid).toBe(false);
    expect(validateFirmBrokerTopology("mffu", "").valid).toBe(false);
    expect(validateFirmBrokerTopology("", null).valid).toBe(false);
  });
});

describe("assertFirmBrokerTopology (write-time guard)", () => {
  it("does not throw on a valid pairing", () => {
    expect(() => assertFirmBrokerTopology("topstep", "topstepx")).not.toThrow();
    expect(() => assertFirmBrokerTopology("mffu", "traderspost")).not.toThrow();
  });

  it("throws FirmBrokerTopologyError on topstep + traderspost", () => {
    expect(() => assertFirmBrokerTopology("topstep", "traderspost")).toThrow(FirmBrokerTopologyError);
    try {
      assertFirmBrokerTopology("topstep", "traderspost");
    } catch (e) {
      expect(e).toBeInstanceOf(FirmBrokerTopologyError);
      expect((e as FirmBrokerTopologyError).expectedBrokerType).toBe("topstepx");
    }
  });
});
