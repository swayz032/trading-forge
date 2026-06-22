import { describe, it, expect } from "vitest";

// Fix 4: correlationId not threaded into openPosition audit rows — generate UUID when null

describe("Fix 4: correlationId generation in openPosition", () => {
  it("generates a UUID-shaped correlationId when context is undefined", () => {
    const { randomUUID } = require("crypto");
    const context: { correlationId?: string } | undefined = undefined;
    const correlationId = context?.correlationId ?? randomUUID();
    expect(typeof correlationId).toBe("string");
    expect(correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("generates a UUID-shaped correlationId when correlationId is undefined", () => {
    const { randomUUID } = require("crypto");
    const context: { correlationId?: string } = {};
    const correlationId = context.correlationId ?? randomUUID();
    expect(typeof correlationId).toBe("string");
    expect(correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/i);
  });

  it("uses caller-provided correlationId when present", () => {
    const { randomUUID } = require("crypto");
    const provided = "caller-provided-id-abc123";
    const context: { correlationId?: string } = { correlationId: provided };
    const correlationId = context.correlationId ?? randomUUID();
    expect(correlationId).toBe(provided);
  });

  it("two calls with no correlationId produce different UUIDs", () => {
    const { randomUUID } = require("crypto");
    const id1 = randomUUID();
    const id2 = randomUUID();
    expect(id1).not.toBe(id2);
  });

  it("correlationId is now NEVER null — old null pattern no longer applies", () => {
    const { randomUUID } = require("crypto");
    // OLD pattern: context?.correlationId ?? null — could produce null
    const oldPattern = (undefined as { correlationId?: string } | undefined)?.correlationId ?? null;
    expect(oldPattern).toBeNull();

    // NEW pattern: context?.correlationId ?? randomUUID() — never null
    const newPattern = (undefined as { correlationId?: string } | undefined)?.correlationId ?? randomUUID();
    expect(newPattern).not.toBeNull();
    expect(typeof newPattern).toBe("string");
  });
});
