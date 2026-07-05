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
import { anamSessionRouter } from "./api/anam-session.js";
import { carterSessionRouter } from "./api/carter-session.js";
import { carterInboxRouter } from "./api/carter-inbox.js";
import { verifySession } from "../../lib/slumhouse/session.js";

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
  if (pathName === "/slumhouse/login.html" || pathName === "/slumhouse/launch" || pathName === "/slumhouse/crib.html" || pathName === "/slumhouse/kitchen.html" || pathName === "/slumhouse/recipe.html" || pathName === "/slumhouse/" || pathName === "/slumhouse/office.html") {
    // office.html is the operator-only Office — gated by its OWN passcode
    // (slumhouse_admin_sid), NOT the friend Discord session. Allow the HTML to
    // load so its passcode lock screen can render; sensitive admin endpoints
    // remain behind the admin cookie.
    next();
    return;
  }

  const raw = req.headers.cookie ?? "";
  const match = raw.match(/(?:^|;\s*)slumhouse_sid=([^;]+)/);
  if (!match) {
    res.redirect(302, "/slumhouse/login.html");
    return;
  }
  try {
    const verified = verifySession(decodeURIComponent(match[1]));
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

// Pre-static auth gate — protect the authenticated HTML shells from rendering
// unauthenticated. Without this, iOS PWA tapping /slumhouse/crib.html (the
// pre-fix cached start_url) shows the shell briefly before the API 401 flips
// to login. With this, the HTML never lands without a valid session cookie.
slumhouseRouter.get([
  "/slumhouse/crib.html",
  "/slumhouse/kitchen.html",
  "/slumhouse/recipe.html",
  "/slumhouse/",
], (req, res, next) => {
  const raw = req.headers.cookie ?? "";
  const match = raw.match(/(?:^|;\s*)slumhouse_sid=([^;]+)/);
  if (!match) {
    res.redirect(302, "/slumhouse/login.html");
    return;
  }
  try {
    const verified = verifySession(decodeURIComponent(match[1]));
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

// API namespaces (full /slumhouse/api/... paths already declared in each module)
slumhouseRouter.use(cribApiRouter);
slumhouseRouter.use(kitchenApiRouter);
slumhouseRouter.use(menuApiRouter);
slumhouseRouter.use(recipeApiRouter);
slumhouseRouter.use(reportsApiRouter);
slumhouseRouter.use(anamSessionRouter);
slumhouseRouter.use(carterSessionRouter);
slumhouseRouter.use(carterInboxRouter);

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
