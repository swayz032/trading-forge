/**
 * G7 — API contract versioning scaffold.
 *
 * Goal: prevent silent breakage when request/response shapes change.
 *
 * Convention:
 *   - All public POST/PATCH endpoints accept an optional `apiVersion: "v0" | "v1"`
 *     field at the top level of the request body (or via X-API-Version header).
 *   - Default = "v0" (legacy). New shape lands as "v1".
 *   - During the one-release transition window, BOTH versions validate. After
 *     the window, "v0" responses include a deprecation warning header
 *     (Sunset / Deprecation / Link rel=successor-version).
 *   - All Zod schemas live here so callers (routes, services, n8n workflows,
 *     external integrators) can import a single source of truth.
 *
 * Discriminated-union pattern:
 *
 *   const BacktestRequest = z.discriminatedUnion("apiVersion", [
 *     z.object({ apiVersion: z.literal("v0").optional(), ...legacyShape }),
 *     z.object({ apiVersion: z.literal("v1"), ...newShape }),
 *   ]);
 *
 * Why z.strict():
 *   z.strict() rejects unknown keys. We adopt this on v1 only — v0 keeps the
 *   permissive parser so existing integrators don't break overnight. After the
 *   sunset, all v0 wrappers route to v1 internally and unknown keys 400.
 *
 * What's NOT in this file:
 *   - The full library of versioned schemas. Migration is incremental: each
 *     route adopts versioning when it next changes shape. Document the per-
 *     route version contract in the route file's header comment.
 *
 * What goes in this file as it grows:
 *   - Shared discriminator constants (API_VERSIONS).
 *   - Cross-route shared shapes (FirmKey, StrategyId, BacktestId).
 *   - Deprecation header helpers.
 */

import { z } from "zod";

export const API_VERSIONS = ["v0", "v1"] as const;
export type ApiVersion = (typeof API_VERSIONS)[number];

/** Header consumers should send: X-API-Version: v1 */
export const API_VERSION_HEADER = "x-api-version" as const;

/** Reusable cross-route shape components. */
export const Shapes = {
  StrategyId: z.string().uuid(),
  BacktestId: z.string().uuid(),
  FirmKey: z.enum([
    "topstep_50k", "mffu_50k", "tpt_50k", "apex_50k",
    "ffn_50k", "alpha_50k", "tradeify_50k", "earn2trade_50k",
  ]),
  Symbol: z.enum(["MES", "MNQ", "MCL", "ES", "NQ", "CL"]),
  ApiVersion: z.enum(API_VERSIONS),
};

/**
 * Helper: build a versioned discriminated-union schema.
 *
 * Usage:
 *   const Req = versioned({
 *     v0: z.object({ legacy_field: z.number() }),
 *     v1: z.object({ legacyField: z.number(), newField: z.string() }).strict(),
 *   });
 *   const parsed = Req.safeParse(req.body);
 */
export function versioned<
  V0 extends z.ZodRawShape,
  V1 extends z.ZodRawShape,
>(shapes: { v0: z.ZodObject<V0>; v1: z.ZodObject<V1> }) {
  return z.discriminatedUnion("apiVersion", [
    shapes.v0.extend({ apiVersion: z.literal("v0").optional() }),
    shapes.v1.extend({ apiVersion: z.literal("v1") }),
  ]);
}

/**
 * Add deprecation headers to a v0 response. Call from a route after detecting
 * the legacy shape.
 */
export function setDeprecationHeaders(
  res: { setHeader: (name: string, value: string) => void },
  successor: string,
  sunsetDate: string,
): void {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", sunsetDate);
  res.setHeader("Link", `<${successor}>; rel="successor-version"`);
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * G7.1 — Per-route response contracts.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Adoption pattern (incremental, no rip-and-replace):
 *
 *   1. Each mutating route defines & EXPORTS an interface named
 *      `<RouteName>Response` colocated with the route handler.
 *   2. The route handler is typed against that interface so any handler-side
 *      drift is caught at compile time.
 *   3. The frontend imports from those interfaces (not from hand-rolled DB
 *      shapes) so request/response stays in sync without a shared module.
 *   4. When a shape changes incompatibly, bump the route to use `versioned()`
 *      with a v0/v1 discriminated union and add Deprecation headers.
 *
 * Routes that have adopted this pattern (keep this list in sync):
 *   - POST   /api/strategies/:id/deploy           → DeployStrategyResponse
 *   - POST   /api/backtests                       → BacktestSubmitResponse
 *   - POST   /api/paper/start                     → PaperStartResponse
 *   - PATCH  /api/compliance/rulesets/:id/verify  → ComplianceVerifyResponse
 *   - POST   /api/compliance/review               → ComplianceReviewSubmitResponse
 *
 * NOTE: there is no POST /api/compliance/approve in the live router; the
 * human-in-the-loop approval surface is `PATCH /rulesets/:id/verify`. If a
 * dedicated /approve endpoint is added later, it MUST also export a
 * `<RouteName>Response` interface and be appended to the list above.
 *
 * Anti-pattern (do not do this):
 *   - Returning `res.json({ ...adHocShape })` without a typed interface.
 *   - Re-declaring response field types in the frontend.
 *   - Silent shape changes without a v0→v1 bump.
 */
