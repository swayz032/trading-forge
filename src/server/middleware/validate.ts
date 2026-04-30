/**
 * Zod request body / query validation middleware helper.
 *
 * Usage:
 *   import { validateBody, validateQuery } from "../middleware/validate.js";
 *
 *   router.post("/", validateBody(mySchema), async (req, res) => {
 *     const data = req.validated;  // typed, parsed result
 *   });
 *
 * On failure: 400 JSON with { error: "Validation failed", details: ZodIssue[] }
 * On success: `req.validated` holds the parsed output, handler is called.
 *
 * validateBody  — validates req.body against a ZodSchema
 * validateQuery — validates req.query against a ZodSchema
 *
 * Both use safeParse (never throws) and return structured errors.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ZodTypeAny, z } from "zod";

// Augment Express Request with the validated payload slot.
declare module "express-serve-static-core" {
  interface Request {
    validated?: any;
  }
}

/**
 * Returns an Express middleware that validates `req.body` against `schema`.
 * Attaches `req.validated` (the parsed, typed output) on success.
 */
export function validateBody<T extends ZodTypeAny>(
  schema: T,
): RequestHandler<any, any, any, any> {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.issues,
      });
      return;
    }
    req.validated = result.data as z.infer<T>;
    next();
  };
}

/**
 * Returns an Express middleware that validates `req.query` against `schema`.
 * Attaches `req.validated` (the parsed, typed output) on success.
 */
export function validateQuery<T extends ZodTypeAny>(
  schema: T,
): RequestHandler<any, any, any, any> {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.issues,
      });
      return;
    }
    req.validated = result.data as z.infer<T>;
    next();
  };
}
