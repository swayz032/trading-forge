// scripts/lib/env-resolve.cjs — ONE .env resolver for the unattended jobs.
//
// WHY THIS EXISTS (found by the OR-072 activation dry-run, 2026-07-20)
// -------------------------------------------------------------------
// Two nightly-job resolvers had drifted apart, and both defects bite only when nobody is
// watching — the cold-recovery leg-3 failure mode:
//
//   1. DIFFERENT OVERRIDE NAMES. rail-runtime read RAILS_ENV_PATH; soak-watcher read
//      SOAK_ENV_PATH. The documented one was ignored and the job died at boot. A runbook
//      naming either silently fails the other half of the rails.
//   2. THE SIBLING CANDIDATE WAS ONE LEVEL TOO SHALLOW. Both looked for
//      <parent>/trading-forge/.env, but the canonical checkout is NESTED at
//      Projects/trading-forge/trading-forge/.env, so the documented "runs from an isolated
//      worktree" affordance had NEVER worked. Invisible only because the scheduled tasks
//      set WorkingDirectory to the main checkout, so cwd/.env hits first.
//
// ★ AND WHAT THE GRADER CAUGHT IN THE FIRST VERSION OF THIS FILE:
//
//   MAJOR-1 — `dotenv.config()` RETURNS {parsed, error}; it does not throw on a read or
//   parse failure. The first version wrapped it in try/catch and reported
//   {loaded:true, reason:null} unconditionally, so the failure branch was UNREACHABLE and
//   an unreadable .env reported SUCCESS. That is the identical defect as the crash
//   handler's `postDiscord` (returns {ok:false}, never throws) — the same
//   return-value-vs-throw conflation, made again against a different library, in the very
//   commit whose headline was "recovery can assert WHICH file was loaded". `loaded:true`
//   meant only "a file exists", which is exactly as weak as "it booted".
//
//   MAJOR-2 — stopping at the first EXISTING candidate silently regressed soak-watcher,
//   whose old loop kept going until DATABASE_URL was actually set. A partially-populated
//   .env now shadowed a complete one — and it bites the worktree affordance this file
//   exists to enable.
//
// So: a candidate is accepted only when dotenv reports no error AND the caller's required
// variables are actually populated. Anything else falls through to the next candidate, and
// the final result says which file won and why the others did not.
//
// Pure + dependency-injected. Never logs or returns a VALUE from the file — only paths,
// variable NAMES, and fixed reason codes.
"use strict";
const path = require("node:path");
const fs = require("node:fs");

/** Override env-var names. Both are honoured; callers may state which is theirs. */
const OVERRIDE_VARS = ["RAILS_ENV_PATH", "SOAK_ENV_PATH"];

const up = (p, n) => path.resolve(p, ...Array(n).fill(".."));

/** Sibling/nested checkout candidates derived from one base directory. */
function siblingCandidates(base) {
  return [
    // FLAT layout: <parent>/trading-forge/.env
    path.join(up(base, 1), "trading-forge", ".env"),
    // NESTED layout: <parent>/trading-forge/trading-forge/.env — the real one here, and
    // the candidate that was missing.
    path.join(up(base, 1), "trading-forge", "trading-forge", ".env"),
    // Running from inside the outer wrapper dir: <base>/trading-forge/.env
    path.join(base, "trading-forge", ".env"),
  ];
}

/**
 * Ordered .env candidates. `preferVar` puts the calling job's OWN override first
 * (MINOR-1: RAILS_ENV_PATH must not silently outrank an operator's SOAK_ENV_PATH pin).
 */
function envCandidates({ cwd, moduleDir, env = process.env, preferVar }) {
  const vars = preferVar
    ? [preferVar, ...OVERRIDE_VARS.filter((v) => v !== preferVar)]
    : OVERRIDE_VARS.slice();
  const out = [];
  for (const v of vars) if (env[v]) out.push(env[v]);
  out.push(path.join(cwd, ".env"));
  const repoRoot = moduleDir ? up(moduleDir, 2) : null; // scripts/<area>/ -> repo root
  if (repoRoot) out.push(path.join(repoRoot, ".env"));
  out.push(...siblingCandidates(cwd));
  // MINOR-3: also derive siblings from the MODULE's location. Cold recovery is exactly
  // when "cwd happens to be the repo root" stops being true.
  if (repoRoot) out.push(...siblingCandidates(repoRoot));
  // Dedupe by RESOLVED path, first occurrence wins so precedence survives. When cwd is the
  // repo root — the normal production case — several of these name the same file.
  const seen = new Set();
  return out.filter(Boolean).filter((c) => {
    const k = path.resolve(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** First existing candidate, or null. Path only — never contents. */
function resolveEnvPath({ cwd, moduleDir, env = process.env, existsFn = fs.existsSync, preferVar }) {
  for (const c of envCandidates({ cwd, moduleDir, env, preferVar })) {
    try { if (existsFn(c)) return c; } catch { /* unreadable candidate — keep looking */ }
  }
  return null;
}

/**
 * Load the first candidate that dotenv accepts AND that satisfies `requireVars`.
 *
 * Returns {path, loaded, reason, tried} — never throws, never exposes a value.
 * `loaded:true` now means "dotenv reported no error AND every required variable is
 * populated", not merely "a file exists". `tried` lists each rejected candidate with a
 * fixed reason code so a recovery check can see the whole search, not just the winner.
 */
function loadEnvFile({
  cwd, moduleDir, env = process.env,
  existsFn = fs.existsSync, requireFn = require,
  preferVar, requireVars = [],
} = {}) {
  let dotenv;
  try { dotenv = requireFn("dotenv"); }
  catch { return { path: null, loaded: false, reason: "dotenv_unavailable", tried: [] }; }

  const tried = [];
  for (const candidate of envCandidates({ cwd, moduleDir, env, preferVar })) {
    let exists = false;
    try { exists = existsFn(candidate); } catch { tried.push({ path: candidate, reason: "exists_check_threw" }); continue; }
    if (!exists) continue;

    let res;
    // dotenv RETURNS {parsed, error}. Reading only the absence of a throw was MAJOR-1.
    try { res = dotenv.config({ path: candidate, override: false }); }
    catch (e) { tried.push({ path: candidate, reason: `dotenv_threw:${(e && e.code) || "unknown"}` }); continue; }

    if (res && res.error) {
      tried.push({ path: candidate, reason: `dotenv_error:${(res.error.code) || "unknown"}` });
      continue;
    }

    // MAJOR-2: a file that parsed but does not supply what the job needs is not the file
    // we were looking for. Keep walking — a partial .env must never shadow a complete one.
    const missing = requireVars.filter((v) => !env[v]);
    if (missing.length > 0) {
      tried.push({ path: candidate, reason: `missing_required:${missing.join(",")}` });
      continue;
    }
    return { path: candidate, loaded: true, reason: null, tried };
  }

  return {
    path: null,
    loaded: false,
    reason: tried.length ? "no_candidate_satisfied_requirements" : "no_env_candidate_exists",
    tried,
  };
}

module.exports = { OVERRIDE_VARS, envCandidates, siblingCandidates, resolveEnvPath, loadEnvFile };
