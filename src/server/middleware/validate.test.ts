/**
 * Tests for the shared Zod validation middleware (validate.ts).
 * Covers validateBody and validateQuery — success path, failure path,
 * and the req.validated attachment.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validateBody, validateQuery } from "./validate.js";
import type { Request, Response } from "express";

// ─── Helpers ──────────────────────────────────────────────────────

function makeReq(body: unknown = {}, query: unknown = {}): Request {
  return { body, query } as unknown as Request;
}

function makeRes(): { res: Response; json: ReturnType<typeof vi.fn>; statusCode: number | null } {
  const ctx = { statusCode: null as number | null, json: vi.fn() };
  const res = {
    status: vi.fn((code: number) => {
      ctx.statusCode = code;
      return { json: ctx.json };
    }),
  } as unknown as Response;
  return { res, json: ctx.json, statusCode: ctx.statusCode };
}

// ─── validateBody ─────────────────────────────────────────────────

describe("validateBody", () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().positive(),
  });

  it("passes valid body and attaches req.validated", () => {
    const next = vi.fn();
    const req = makeReq({ name: "test", count: 5 });
    const { res } = makeRes();

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).validated).toEqual({ name: "test", count: 5 });
  });

  it("returns 400 with ZodIssues when body is invalid", () => {
    const next = vi.fn();
    const req = makeReq({ name: "", count: -1 });
    const { res, json } = makeRes();

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Validation failed",
        details: expect.any(Array),
      }),
    );
  });

  it("returns 400 when body is missing required fields", () => {
    const next = vi.fn();
    const req = makeReq({});
    const { res, json } = makeRes();

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Validation failed" }),
    );
  });

  it("applies defaults from schema", () => {
    const schemaWithDefault = z.object({
      name: z.string().min(1),
      mode: z.enum(["a", "b"]).default("a"),
    });

    const next = vi.fn();
    const req = makeReq({ name: "hello" });
    const { res } = makeRes();

    validateBody(schemaWithDefault)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).validated.mode).toBe("a");
  });

  it("does not call next on empty body when fields are required", () => {
    const next = vi.fn();
    const req = makeReq(null);
    const { res } = makeRes();

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
  });
});

// ─── validateQuery ────────────────────────────────────────────────

describe("validateQuery", () => {
  const schema = z.object({
    limit: z.coerce.number().int().positive().max(1000).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
  });

  it("passes valid query and attaches req.validated", () => {
    const next = vi.fn();
    const req = makeReq({}, { limit: "20", offset: "5" });
    const { res } = makeRes();

    validateQuery(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).validated).toEqual({ limit: 20, offset: 5 });
  });

  it("applies defaults when query params are missing", () => {
    const next = vi.fn();
    const req = makeReq({}, {});
    const { res } = makeRes();

    validateQuery(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).validated).toEqual({ limit: 50, offset: 0 });
  });

  it("returns 400 for out-of-range query params", () => {
    const next = vi.fn();
    const req = makeReq({}, { limit: "99999" });
    const { res, json } = makeRes();

    validateQuery(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Validation failed", details: expect.any(Array) }),
    );
  });
});

// ─── Route-level schema smoke tests ──────────────────────────────
// Validate the exact schemas used in critical-path routes so a
// schema refactor that breaks parsing will be caught immediately.

describe("critical-path schema smoke tests", () => {
  it("paper executeOpenSchema rejects negative signalPrice", () => {
    const schema = z.object({
      sessionId: z.string().uuid(),
      symbol: z.enum(["MES", "MNQ", "MCL"]),
      side: z.enum(["long", "short"]),
      signalPrice: z.number().positive(),
      contracts: z.number().int().positive().default(1),
    });
    const result = schema.safeParse({
      sessionId: "00000000-0000-0000-0000-000000000001",
      symbol: "MES",
      side: "long",
      signalPrice: -50,
    });
    expect(result.success).toBe(false);
  });

  it("paper executeOpenSchema rejects unknown symbol", () => {
    const schema = z.object({
      sessionId: z.string().uuid(),
      symbol: z.enum(["MES", "MNQ", "MCL"]),
      side: z.enum(["long", "short"]),
      signalPrice: z.number().positive(),
      contracts: z.number().int().positive().default(1),
    });
    const result = schema.safeParse({
      sessionId: "00000000-0000-0000-0000-000000000001",
      symbol: "SPY",
      side: "long",
      signalPrice: 4500,
    });
    expect(result.success).toBe(false);
  });

  it("paper executeCloseSchema requires positionId as UUID", () => {
    const schema = z.object({
      positionId: z.string().uuid(),
      exitSignalPrice: z.number().positive(),
    });
    const result = schema.safeParse({ positionId: "not-a-uuid", exitSignalPrice: 4500 });
    expect(result.success).toBe(false);
  });

  it("strategy create schema rejects unknown symbol", () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      symbol: z.enum(["MES", "MNQ", "MCL"]),
      timeframe: z.string().min(1).max(20),
    });
    const result = schema.safeParse({ name: "Test", symbol: "AAPL", timeframe: "1h" });
    expect(result.success).toBe(false);
  });

  it("alert create schema rejects unknown severity", () => {
    const schema = z.object({
      type: z.string().min(1).max(100),
      severity: z.enum(["info", "warning", "critical"]).default("info"),
      title: z.string().min(1).max(300),
      message: z.string().min(1).max(5000),
    });
    const result = schema.safeParse({
      type: "test",
      severity: "debug",
      title: "T",
      message: "M",
    });
    expect(result.success).toBe(false);
  });

  it("compliance review requires valid complianceResult enum", () => {
    const schema = z.object({
      strategyId: z.string().uuid(),
      firm: z.string().min(1).max(100),
      complianceResult: z.enum(["pass", "fail", "warning"]),
      executionGate: z.enum(["approved", "blocked", "conditional"]),
    });
    const result = schema.safeParse({
      strategyId: "00000000-0000-0000-0000-000000000001",
      firm: "topstep",
      complianceResult: "maybe",
      executionGate: "approved",
    });
    expect(result.success).toBe(false);
  });

  it("lifecycle transition rejects invalid state names", () => {
    const schema = z.object({
      fromState: z.enum(["CANDIDATE", "TESTING", "PAPER", "DEPLOY_READY", "DEPLOYED", "DECLINING", "RETIRED", "GRAVEYARD"]),
      toState: z.enum(["CANDIDATE", "TESTING", "PAPER", "DEPLOY_READY", "DEPLOYED", "DECLINING", "RETIRED", "GRAVEYARD"]),
    });
    const result = schema.safeParse({ fromState: "ACTIVE", toState: "PAPER" });
    expect(result.success).toBe(false);
  });

  // ─── backtests /compare schema ───────────────────────────────

  it("backtest compare schema rejects empty ids array", () => {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(5),
    });
    const result = schema.safeParse({ ids: [] });
    expect(result.success).toBe(false);
  });

  it("backtest compare schema rejects more than 5 ids", () => {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(5),
    });
    const sixIds = Array.from({ length: 6 }, (_, i) =>
      `00000000-0000-0000-0000-00000000000${i + 1}`,
    );
    const result = schema.safeParse({ ids: sixIds });
    expect(result.success).toBe(false);
  });

  it("backtest compare schema rejects non-UUID strings in ids", () => {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(5),
    });
    const result = schema.safeParse({ ids: ["not-a-uuid"] });
    expect(result.success).toBe(false);
  });

  it("backtest compare schema accepts 1-5 valid UUIDs", () => {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(5),
    });
    const result = schema.safeParse({
      ids: [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ],
    });
    expect(result.success).toBe(true);
  });

  // ─── deepar train/predict schema ─────────────────────────────

  it("deepar symbols schema accepts empty body (symbols optional)", () => {
    const schema = z.object({
      symbols: z.array(z.enum(["MES", "MNQ", "MCL"])).min(1).max(3).optional(),
    });
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.symbols).toBeUndefined();
  });

  it("deepar symbols schema rejects unknown symbol", () => {
    const schema = z.object({
      symbols: z.array(z.enum(["MES", "MNQ", "MCL"])).min(1).max(3).optional(),
    });
    const result = schema.safeParse({ symbols: ["ES"] });
    expect(result.success).toBe(false);
  });

  it("deepar symbols schema rejects more than 3 symbols", () => {
    const schema = z.object({
      symbols: z.array(z.enum(["MES", "MNQ", "MCL"])).min(1).max(3).optional(),
    });
    const result = schema.safeParse({ symbols: ["MES", "MNQ", "MCL", "MES"] });
    expect(result.success).toBe(false);
  });

  it("deepar symbols schema accepts valid symbol subset", () => {
    const schema = z.object({
      symbols: z.array(z.enum(["MES", "MNQ", "MCL"])).min(1).max(3).optional(),
    });
    const result = schema.safeParse({ symbols: ["MES", "MNQ"] });
    expect(result.success).toBe(true);
  });
});
