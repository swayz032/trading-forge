// scripts/lib/env-resolve.cjs — ONE .env resolver for the unattended jobs.
//
// WHY THIS EXISTS (found by the OR-072 activation dry-run, 2026-07-20)
// -------------------------------------------------------------------
// Two nightly-job resolvers had drifted apart in two ways, and both bite exactly when a
// human is not watching:
//
//   1. DIFFERENT OVERRIDE NAMES. `rail-runtime.loadEnvironment` read `RAILS_ENV_PATH`;
//      `soak-watcher` read `SOAK_ENV_PATH`. I set the documented one and it was ignored,
//      and the job died at boot. A recovery runbook documenting either name silently
//      fails for the other half of the rails — which is the whole point of leg 3.
//
//   2. THE SIBLING-CHECKOUT CANDIDATE WAS ONE LEVEL TOO SHALLOW. Both resolved
//      `<parent>/trading-forge/.env`, but the canonical checkout is NESTED:
//      `Projects/trading-forge/trading-forge/.env`. So the documented "runs from an
//      isolated worktree" affordance HAS NEVER WORKED. It is invisible in production only
//      because the scheduled tasks set WorkingDirectory to the main checkout, so the
//      `cwd/.env` candidate hits first and nothing downstream ever notices.
//
// Same nesting that produced the deployment gap: the repo lives at
// `Projects/trading-forge/trading-forge`, and code that assumes one level is wrong.
//
// Fixed as a CLASS, not as the two instances I happened to hit: one resolver, both
// override names honoured (no caller breaks), the nested layout covered, and the chosen
// path RETURNED so a recovery check can assert which file was used instead of guessing.
//
// Pure + dependency-injected. Never logs or returns a VALUE from the file — only paths.
"use strict";
const path = require("node:path");
const fs = require("node:fs");

/** Override env-var names, in precedence order. Both are honoured, forever. */
const OVERRIDE_VARS = ["RAILS_ENV_PATH", "SOAK_ENV_PATH"];

/**
 * Ordered .env candidates for an unattended job.
 * `cwd` is the process working directory; `moduleDir` is the calling file's __dirname.
 */
function envCandidates({ cwd, moduleDir, env = process.env }) {
  const up = (p, n) => path.resolve(p, ...Array(n).fill(".."));
  const out = [];
  for (const v of OVERRIDE_VARS) if (env[v]) out.push(env[v]);
  out.push(path.join(cwd, ".env"));
  if (moduleDir) out.push(path.join(up(moduleDir, 2), ".env")); // repo root from scripts/<area>/
  // Sibling checkout, FLAT layout: <parent>/trading-forge/.env
  out.push(path.join(up(cwd, 1), "trading-forge", ".env"));
  // Sibling checkout, NESTED layout: <parent>/trading-forge/trading-forge/.env
  // This is the real one on this machine and the candidate that was missing.
  out.push(path.join(up(cwd, 1), "trading-forge", "trading-forge", ".env"));
  // Running from INSIDE the outer wrapper dir: <cwd>/trading-forge/.env
  out.push(path.join(cwd, "trading-forge", ".env"));
  // Dedupe by RESOLVED path, first occurrence wins so precedence is preserved. When cwd is
  // the repo root — the normal case, since the scheduled tasks set WorkingDirectory there —
  // the repo-root candidate and cwd/.env are the same file. Harmless to probe twice, but a
  // resolver whose candidate list does not mean what it says is one a recovery runbook
  // cannot be written against.
  const seen = new Set();
  return out.filter(Boolean).filter((c) => {
    const k = path.resolve(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * First existing candidate, or null. Returns the PATH only — never file contents.
 * Callers should report the path (a name, not a secret) so recovery can verify it.
 */
function resolveEnvPath({ cwd, moduleDir, env = process.env, existsFn = fs.existsSync }) {
  for (const c of envCandidates({ cwd, moduleDir, env })) {
    try { if (existsFn(c)) return c; } catch { /* unreadable candidate — keep looking */ }
  }
  return null;
}

/**
 * Load the resolved .env. Returns {path, loaded, reason} — never throws, never logs values.
 * `loaded:false` with a reason is deliberately distinguishable from "loaded and empty":
 * a job that cannot find its config must be able to SAY so rather than boot half-configured.
 */
function loadEnvFile({ cwd, moduleDir, env = process.env, existsFn = fs.existsSync, requireFn = require }) {
  let dotenv;
  try { dotenv = requireFn("dotenv"); }
  catch { return { path: null, loaded: false, reason: "dotenv_unavailable" }; }

  const p = resolveEnvPath({ cwd, moduleDir, env, existsFn });
  if (!p) return { path: null, loaded: false, reason: "no_env_candidate_exists" };
  try {
    dotenv.config({ path: p, override: false });
    return { path: p, loaded: true, reason: null };
  } catch (e) {
    return { path: p, loaded: false, reason: `dotenv_config_failed:${e && e.code ? e.code : "unknown"}` };
  }
}

module.exports = { OVERRIDE_VARS, envCandidates, resolveEnvPath, loadEnvFile };
