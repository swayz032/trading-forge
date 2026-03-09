import type { Request, Response, NextFunction } from "express";

/**
 * Simple API key auth. Single user — no need for Supabase/JWT.
 * Pass via header: Authorization: Bearer <API_KEY>
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Skip auth in dev if no API_KEY configured
  if (process.env.NODE_ENV === "development" && !process.env.API_KEY) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== process.env.API_KEY) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  next();
}
