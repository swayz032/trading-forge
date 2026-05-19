import { describe, it, expect } from "vitest";
import { quantumRunRequestSchema, hybridCompareRequestSchema } from "../lib/quantum-run-schema.js";

describe("Quantum MC Schemas", () => {
  it("validates correct quantum run request", () => {
    const result = quantumRunRequestSchema.safeParse({
      backtestId: "123e4567-e89b-12d3-a456-426614174000",
      eventType: "breach",
      firmKey: "topstep_50k",
    });
    expect(result.success).toBe(true);
  });

  it("defaults eventType to breach", () => {
    const result = quantumRunRequestSchema.safeParse({
      backtestId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventType).toBe("breach");
    }
  });

  it("rejects invalid eventType", () => {
    const result = quantumRunRequestSchema.safeParse({
      backtestId: "123e4567-e89b-12d3-a456-426614174000",
      eventType: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid event types", () => {
    for (const eventType of ["breach", "ruin", "target_hit", "tail_loss"]) {
      const result = quantumRunRequestSchema.safeParse({
        backtestId: "123e4567-e89b-12d3-a456-426614174000",
        eventType,
      });
      expect(result.success).toBe(true);
    }
  });

  it("validates hybrid compare request", () => {
    const result = hybridCompareRequestSchema.safeParse({
      backtestId: "123e4567-e89b-12d3-a456-426614174000",
      eventType: "breach",
    });
    expect(result.success).toBe(true);
  });

  it("defaults epsilon and alpha", () => {
    const result = quantumRunRequestSchema.safeParse({
      backtestId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.epsilon).toBe(0.01);
      expect(result.data.alpha).toBe(0.05);
    }
  });

  it("rejects alpha > 0.5", () => {
    const result = quantumRunRequestSchema.safeParse({
      backtestId: "123e4567-e89b-12d3-a456-426614174000",
      alpha: 0.6,
    });
    expect(result.success).toBe(false);
  });
});
