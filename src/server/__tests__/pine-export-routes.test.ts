import { describe, it, expect } from "vitest";
import { pineCompileRequestSchema } from "../lib/pine-artifact-schema.js";

describe("Pine Export Schemas", () => {
  it("validates correct compile request", () => {
    const result = pineCompileRequestSchema.safeParse({
      strategyId: "123e4567-e89b-12d3-a456-426614174000",
      firmKey: "topstep_50k",
      exportType: "pine_indicator",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID", () => {
    const result = pineCompileRequestSchema.safeParse({
      strategyId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("defaults exportType to pine_indicator", () => {
    const result = pineCompileRequestSchema.safeParse({
      strategyId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exportType).toBe("pine_indicator");
    }
  });

  it("rejects invalid exportType", () => {
    const result = pineCompileRequestSchema.safeParse({
      strategyId: "123e4567-e89b-12d3-a456-426614174000",
      exportType: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional firmKey", () => {
    const result = pineCompileRequestSchema.safeParse({
      strategyId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firmKey).toBeUndefined();
    }
  });
});
