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
import { Router } from "express";
import express from "express";
import path from "node:path";
import { authRouter } from "./auth.js";
import { adminMappingRouter } from "./admin-mapping.js";
import { cribApiRouter } from "./api/crib.js";
import { kitchenApiRouter } from "./api/kitchen.js";
import { recipeApiRouter } from "./api/recipe.js";

export const slumhouseRouter = Router();

// Auth namespace
slumhouseRouter.use("/slumhouse/auth", authRouter);

// API namespaces (full /slumhouse/api/... paths already declared in each module)
slumhouseRouter.use(cribApiRouter);
slumhouseRouter.use(kitchenApiRouter);
slumhouseRouter.use(recipeApiRouter);

// Static SPA assets (CSS, JS, HTML, images) — served last so /slumhouse/api/*
// matches the API routes above first.
const STATIC_DIR = path.resolve(process.cwd(), "public/slumhouse");
slumhouseRouter.use("/slumhouse", express.static(STATIC_DIR, {
  index: "crib.html",
  extensions: ["html"],
  fallthrough: true,
}));

// Re-export the admin mapping router for the app to mount at /api/admin
export { adminMappingRouter };
