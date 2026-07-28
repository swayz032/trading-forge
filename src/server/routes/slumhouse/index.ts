/**
 * Slumhouse router — aggregates auth + 3 API routes + static page serving.
 *
 * Mount order matters: API routes register at the root level (their paths
 * already start with /slumhouse/api/...). Static handler mounts under
 * /slumhouse with index=crib.html so the bare /slumhouse URL lands friends
 * on The Crib.
 *
 * The admin mapping router is exported separately so the app can mount it at
 * /api/admin/... alongside other operator-only endpoints.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import express from "express";
import path from "node:path";
import { authRouter, handleLaunch } from "./auth.js";
import { adminMappingRouter } from "./admin-mapping.js";
import { adminOfficeRouter } from "./admin.js";
import { deployApprovalsRouter } from "./deploy-approvals.js";
import { cribApiRouter } from "./api/crib.js";
import { kitchenApiRouter } from "./api/kitchen.js";
import { menuApiRouter } from "./api/menu.js";
import { recipeApiRouter } from "./api/recipe.js";
import { reportsApiRouter } from "./api/reports.js";
import { evidenceVaultApiRouter } from "./api/evidence-vault.js";
import { nightDeskApiRouter } from "./api/night-desk.js";
import { anamSessionRouter } from "./api/anam-session.js";
import { anamGreetingRouter } from "./api/anam-greeting.js";
import { carterSessionRouter } from "./api/carter-session.js";
import { carterInboxRouter } from "./api/carter-inbox.js";
import { memberOfficeRouter } from "./api/member-office.js";
import { sseRoutes } from "../sse.js";
import { requireSlumhouseUserOrAdmin } from "../../lib/slumhouse/require-session.js";
import { adminSessionFromCookie } from "../../lib/slumhouse/admin-session.js";
import { verifySession } from "../../lib/slumhouse/session.js";
import { readSlumhouseCookie } from "../../lib/slumhouse/cookie.js";
import { db } from "../../db/index.js";
import { slumhouseUsers } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export const slumhouseRouter = Router();

export function handleSlumhouseFallback(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET") {
    next();
    return;
  }
  const accept = String(req.headers.accept ?? "");
  if (!accept.includes("text/html")) {
    next();
    return;
  }
  const rawUrl = String((req.originalUrl ?? req.url ?? req.path) ?? "");
  const pathName = rawUrl.split("?", 1)[0];
  if (!(pathName === "/slumhouse" || pathName.startsWith("/slumhouse/"))) {
    next();
    return;
  }
  if (pathName.startsWith("/slumhouse/api/")) {
    next();
    return;
  }
  if (pathName === "/slumhouse/login.html" || pathName === "/slumhouse/launch" || pathName === "/slumhouse/crib.html" || pathName === "/slumhouse/kitchen.html" || pathName === "/slumhouse/recipe.html" || pathName === "/slumhouse/evidence-vault.html" || pathName === "/slumhouse/night-desk.html" || pathName === "/slumhouse/" || pathName === "/slumhouse/office.html" || pathName === "/slumhouse/member-office.html") {
    // office.html is the operator-only Office — gated by its OWN passcode
    // (slumhouse_admin_sid), NOT the friend Discord session. Allow the HTML to
    // load so its passcode lock screen can render; sensitive admin endpoints
    // remain behind the admin cookie.
    next();
    return;
  }

  const token = readSlumhouseCookie(req.headers.cookie, "slumhouse_sid");
  if (!token) {
    res.redirect(302, "/slumhouse/login.html");
    return;
  }
  try {
    const verified = verifySession(token);
    if (verified?.ok && verified.discordUserId) {
      res.redirect(302, "/slumhouse/crib.html");
      return;
    }
  } catch {
    /* fall through to login */
  }
  res.redirect(302, "/slumhouse/login.html");
}

// PWA launch redirect — must register BEFORE the static handler so /slumhouse/launch
// hits our smart cookie check instead of falling through to crib.html.
slumhouseRouter.get("/slumhouse/launch", handleLaunch);

// Auth namespace
slumhouseRouter.use("/slumhouse/auth", authRouter);

export function gateEvidenceVaultHtml(req: Request, res: Response, next: NextFunction): void {
  // This shared room opens from member receipts and inside the passcode-gated
  // operator Office. Its HTML gate must match the API's dual-session contract.
  if (adminSessionFromCookie(req.headers.cookie)) {
    next();
    return;
  }
  const token = readSlumhouseCookie(req.headers.cookie, "slumhouse_sid");
  if (!token) {
    res.redirect(302, "/slumhouse/login.html");
    return;
  }
  try {
    const verified = verifySession(token);
    if (verified?.ok && verified.discordUserId) {
      next();
      return;
    }
  } catch {
    // Fall through to the same fail-closed login redirect.
  }
  res.redirect(302, "/slumhouse/login.html");
}

slumhouseRouter.get("/slumhouse/evidence-vault.html", gateEvidenceVaultHtml);
slumhouseRouter.get("/slumhouse/night-desk.html", (req, res, next) => {
  if (adminSessionFromCookie(req.headers.cookie)) { next(); return; }
  res.redirect(302, "/slumhouse/office.html");
});

// Pre-static auth gate — protect the authenticated HTML shells from rendering
// unauthenticated. Without this, iOS PWA tapping /slumhouse/crib.html (the
// pre-fix cached start_url) shows the shell briefly before the API 401 flips
// to login. With this, the HTML never lands without a valid session cookie.
slumhouseRouter.get([
  "/slumhouse/crib.html",
  "/slumhouse/kitchen.html",
  "/slumhouse/recipe.html",
  "/slumhouse/member-office.html",
  "/slumhouse/",
], (req, res, next) => {
  const token = readSlumhouseCookie(req.headers.cookie, "slumhouse_sid");
  if (!token) {
    res.redirect(302, "/slumhouse/login.html");
    return;
  }
  try {
    const verified = verifySession(token);
    if (!verified?.ok || !verified.discordUserId) {
      res.redirect(302, "/slumhouse/login.html");
      return;
    }
  } catch {
    res.redirect(302, "/slumhouse/login.html");
    return;
  }
  next();
});

export async function redirectMemberFromOperatorOffice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readSlumhouseCookie(req.headers.cookie, "slumhouse_sid");
  if (!token) { next(); return; }
  try {
    const verified = verifySession(token);
    if (!verified?.ok || !verified.discordUserId) { next(); return; }
    const rows = await db.select({
      jerseyNumber: slumhouseUsers.jerseyNumber,
      sessionEpoch: slumhouseUsers.sessionEpoch,
    }).from(slumhouseUsers).where(eq(slumhouseUsers.discordUserId, verified.discordUserId)).limit(1);
    const user = rows[0];
    if (user && (user.sessionEpoch ?? 0) === (verified.epoch ?? 0) && user.jerseyNumber !== 0) {
      res.redirect(302, "/slumhouse/member-office.html");
      return;
    }
  } catch {
    // The operator passcode shell remains available during a database outage.
  }
  next();
}

// Shared navigation historically points to office.html. A valid non-operator session is
// resolved server-side before static files so members never receive the admin Office shell.
slumhouseRouter.get("/slumhouse/office.html", redirectMemberFromOperatorOffice);

// API namespaces (full /slumhouse/api/... paths already declared in each module)
slumhouseRouter.use(cribApiRouter);
slumhouseRouter.use(kitchenApiRouter);
slumhouseRouter.use(menuApiRouter);
slumhouseRouter.use(recipeApiRouter);
slumhouseRouter.use(reportsApiRouter);
slumhouseRouter.use(evidenceVaultApiRouter);
slumhouseRouter.use(nightDeskApiRouter);
// Browser EventSource cannot attach the bearer token required by /api/sse/events.
// Expose the same read-only stream through the authenticated Slumhouse session so
// Office clients can reconnect with their existing Discord/admin HttpOnly cookie.
slumhouseRouter.use("/slumhouse/api/sse", requireSlumhouseUserOrAdmin, sseRoutes);
slumhouseRouter.use(anamSessionRouter);
slumhouseRouter.use(anamGreetingRouter);
slumhouseRouter.use(carterSessionRouter);
slumhouseRouter.use(carterInboxRouter);
// Tier-2 item 6 — per-member Office API (PIN establish/verify, scope, TEST-MODE connect).
//
// ★ WIRING FIX 2026-07-21 (OA-140): this router shipped with item 6 and was never mounted here,
// so all four routes were unreachable in production. `member-office.html` fetches
// `/slumhouse/api/member/scope`; unmounted it fell through to express.static and 404'd, and the
// page's `if (r.ok)` guard turned that into an empty scope — so every member saw a permanently
// "Locked" room with no error anywhere. Silent, not loud.
//
// The e2e test could not catch it: it builds its own express app and calls
// `app.use(memberOfficeRouter)` itself, which proves the routes work WHEN MOUNTED and never that
// they ARE mounted. `slumhouse-routers-mounted.test.ts` is the guard for the whole class.
slumhouseRouter.use(memberOfficeRouter);

// The Office — operator-only passcode-gated admin endpoints (auth/status/logout).
slumhouseRouter.use(adminOfficeRouter);
// Layer-4 Office P0 (2026-07-02): DEPLOY_READY → DEPLOYED approval card
// (requireAdminSession + audit + fail-closed evidence check per route).
slumhouseRouter.use(deployApprovalsRouter);

// Static SPA assets (CSS, JS, HTML, images) — served last so /slumhouse/api/*
// matches the API routes above first.
const STATIC_DIR = path.resolve(process.cwd(), "public/slumhouse");
slumhouseRouter.use("/slumhouse", express.static(STATIC_DIR, {
  index: "crib.html",
  extensions: ["html"],
  fallthrough: true,
}));

slumhouseRouter.use(handleSlumhouseFallback);

// Re-export the admin mapping router for the app to mount at /api/admin
export { adminMappingRouter };
