// scripts/lib/__tests__/env-resolve.test.mjs
//
// Locks the shared .env resolver for unattended jobs. Fully DI'd — no filesystem, no clock.
//
// Both defects under test were found by the OR-072 activation dry-run, which crashed at
// boot because the documented override name was ignored. Both bite only when nobody is
// watching, which is precisely the cold-recovery leg-3 failure mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { OVERRIDE_VARS, envCandidates, resolveEnvPath, loadEnvFile } from "../env-resolve.cjs";

const WORKTREE = "C:/Users/t/Projects/wt-ops-experience-20260719";
const MODDIR = path.join(WORKTREE, "scripts", "soak");
const CANONICAL_NESTED = path.resolve("C:/Users/t/Projects/trading-forge/trading-forge/.env");

/** A dotenv stub that SUCCEEDS. Named so the failing variants below are obviously distinct. */
const okDotenv = () => ({ config: () => ({ parsed: {} }) });
/** A dotenv stub that fails the way the real one does: RETURNS {error}, never throws. */
const erroringDotenv = (code) => () => ({ config: () => ({ error: Object.assign(new Error("x"), { code }) }) });

const existsOnly = (...paths) => {
  const set = new Set(paths.map((p) => path.resolve(p)));
  return (p) => set.has(path.resolve(p));
};

test("★ BOTH override names are honoured — neither half of the rails is orphaned", () => {
  // The dry-run crash: rail-runtime read RAILS_ENV_PATH, soak-watcher read SOAK_ENV_PATH.
  // A runbook documenting either one silently failed for the other half.
  assert.deepEqual(OVERRIDE_VARS, ["RAILS_ENV_PATH", "SOAK_ENV_PATH"]);
  for (const v of OVERRIDE_VARS) {
    const got = resolveEnvPath({
      cwd: WORKTREE, moduleDir: MODDIR,
      env: { [v]: "D:/override/.env" },
      existsFn: existsOnly("D:/override/.env"),
    });
    assert.equal(path.resolve(got), path.resolve("D:/override/.env"), `${v} was ignored`);
  }
});

test("★ the NESTED canonical checkout is reachable from a worktree (it never was)", () => {
  // The shipped comment promised "runs from an isolated worktree (finds the sibling main
  // checkout's .env)". The candidate was <parent>/trading-forge/.env — one level too
  // shallow, because the repo is at Projects/trading-forge/trading-forge. That file does
  // not exist, so the affordance had never worked.
  const got = resolveEnvPath({
    cwd: WORKTREE, moduleDir: MODDIR, env: {},
    existsFn: existsOnly(CANONICAL_NESTED),
  });
  assert.equal(path.resolve(got), CANONICAL_NESTED);
});

test("the FLAT sibling layout still resolves — the fix must not break the other shape", () => {
  const flat = "C:/Users/t/Projects/trading-forge/.env";
  const got = resolveEnvPath({ cwd: WORKTREE, moduleDir: MODDIR, env: {}, existsFn: existsOnly(flat) });
  assert.equal(path.resolve(got), path.resolve(flat));
});

test("cwd/.env wins over every sibling candidate (production: WorkingDir = main checkout)", () => {
  // This is why the shallow-sibling bug stayed invisible: the scheduled tasks set
  // WorkingDirectory to the main checkout, so this candidate always hit first.
  const cwdEnv = path.join(WORKTREE, ".env");
  const got = resolveEnvPath({
    cwd: WORKTREE, moduleDir: MODDIR, env: {},
    existsFn: existsOnly(cwdEnv, CANONICAL_NESTED),
  });
  assert.equal(path.resolve(got), path.resolve(cwdEnv));
});

test("an explicit override beats cwd/.env — an operator's instruction is not a suggestion", () => {
  const got = resolveEnvPath({
    cwd: WORKTREE, moduleDir: MODDIR,
    env: { RAILS_ENV_PATH: "D:/pin/.env" },
    existsFn: existsOnly("D:/pin/.env", path.join(WORKTREE, ".env")),
  });
  assert.equal(path.resolve(got), path.resolve("D:/pin/.env"));
});

test("a set-but-MISSING override falls through instead of dying", () => {
  // A stale override in a service definition must degrade to the normal search, not
  // strand an unattended job with a path that no longer exists.
  const got = resolveEnvPath({
    cwd: WORKTREE, moduleDir: MODDIR,
    env: { SOAK_ENV_PATH: "D:/gone/.env" },
    existsFn: existsOnly(CANONICAL_NESTED),
  });
  assert.equal(path.resolve(got), CANONICAL_NESTED);
});

test("nothing found -> null, and loadEnvFile says WHY (never a half-configured boot)", () => {
  assert.equal(resolveEnvPath({ cwd: WORKTREE, moduleDir: MODDIR, env: {}, existsFn: () => false }), null);
  const r = loadEnvFile({ cwd: WORKTREE, moduleDir: MODDIR, env: {}, existsFn: () => false, requireFn: okDotenv });
  assert.equal(r.loaded, false);
  assert.equal(r.reason, "no_env_candidate_exists");
});

test("a missing dotenv is reported, not swallowed (the 2026-07-18 silent-death class)", () => {
  const r = loadEnvFile({
    cwd: WORKTREE, moduleDir: MODDIR, env: {}, existsFn: () => true,
    requireFn: () => { throw new Error("MODULE_NOT_FOUND"); },
  });
  assert.equal(r.loaded, false);
  assert.equal(r.reason, "dotenv_unavailable");
});

test("an unreadable candidate is skipped, not fatal", () => {
  const got = resolveEnvPath({
    cwd: WORKTREE, moduleDir: MODDIR, env: {},
    existsFn: (p) => {
      if (p.endsWith(path.join(WORKTREE, ".env"))) throw new Error("EPERM");
      return path.resolve(p) === CANONICAL_NESTED;
    },
  });
  assert.equal(path.resolve(got), CANONICAL_NESTED);
});

test("★ loadEnvFile RETURNS the chosen path — recovery must verify, not guess", () => {
  // A recovery check that cannot say WHICH file was loaded can only assert that the
  // process started, which is the "it booted" test this whole leg exists to replace.
  const r = loadEnvFile({
    cwd: WORKTREE, moduleDir: MODDIR, env: {},
    existsFn: existsOnly(CANONICAL_NESTED),
    requireFn: okDotenv,
  });
  assert.equal(r.loaded, true);
  assert.equal(path.resolve(r.path), CANONICAL_NESTED);
  assert.equal(r.reason, null);
});

test("candidate order is deterministic and contains no duplicates", () => {
  const c = envCandidates({ cwd: WORKTREE, moduleDir: MODDIR, env: { RAILS_ENV_PATH: "D:/a/.env" } });
  assert.equal(c[0], "D:/a/.env", "an override must be searched first");
  assert.equal(new Set(c.map((x) => path.resolve(x))).size, c.length, "duplicate candidates");
});

// ── ★ Grader MAJOR-1/MAJOR-3: dotenv RETURNS {error}; it does not throw ──
test("★ an unreadable .env reports loaded:FALSE — a returned error is not a success", () => {
  // The first version wrapped config() in try/catch and reported {loaded:true,reason:null}
  // unconditionally, so the failure branch was UNREACHABLE. Identical to the crash
  // handler's postDiscord defect (returns {ok:false}, never throws) — the same
  // return-value-vs-throw conflation, against a different library.
  const r = loadEnvFile({
    cwd: WORKTREE, moduleDir: MODDIR, env: {},
    existsFn: existsOnly(CANONICAL_NESTED),
    requireFn: erroringDotenv("EISDIR"),
  });
  assert.equal(r.loaded, false, "a dotenv error was reported as success");
  assert.match(r.reason, /no_candidate_satisfied/);
  assert.ok(r.tried.some((t) => t.reason === "dotenv_error:EISDIR"), "the error code must be recorded");
});

test("a candidate that ERRORS is skipped and a later good one still wins", () => {
  const bad = "D:/bad/.env";
  let first = true;
  const requireFn = () => ({
    config: () => {
      if (first) { first = false; return { error: Object.assign(new Error("x"), { code: "EACCES" }) }; }
      return { parsed: {} };
    },
  });
  const r = loadEnvFile({
    cwd: WORKTREE, moduleDir: MODDIR, env: { RAILS_ENV_PATH: bad },
    existsFn: existsOnly(bad, CANONICAL_NESTED), requireFn,
  });
  assert.equal(r.loaded, true);
  assert.equal(path.resolve(r.path), CANONICAL_NESTED);
});

// ── ★ Grader MAJOR-2: content-aware fall-through (a partial .env must not shadow) ──
test("★ a parsed-but-INCOMPLETE .env falls through to one that satisfies requireVars", () => {
  // soak-watcher's old loop kept going until DATABASE_URL was set. Stopping at the first
  // EXISTING file silently regressed exactly the worktree case this resolver enables.
  const partial = path.join(WORKTREE, ".env");
  const env = {};
  const requireFn = () => ({
    config: ({ path: p }) => {
      if (path.resolve(p) === CANONICAL_NESTED) env.DATABASE_URL = "set";  // only the real one supplies it
      return { parsed: {} };
    },
  });
  const r = loadEnvFile({
    cwd: WORKTREE, moduleDir: MODDIR, env,
    existsFn: existsOnly(partial, CANONICAL_NESTED), requireFn,
    requireVars: ["DATABASE_URL"],
  });
  assert.equal(path.resolve(r.path), CANONICAL_NESTED, "a partial .env shadowed the complete one");
  assert.equal(r.loaded, true);
  assert.ok(r.tried.some((t) => t.reason === "missing_required:DATABASE_URL"));
});

test("if NO candidate supplies the required var, loaded:false says so", () => {
  const r = loadEnvFile({
    cwd: WORKTREE, moduleDir: MODDIR, env: {},
    existsFn: existsOnly(CANONICAL_NESTED), requireFn: okDotenv,
    requireVars: ["DATABASE_URL"],
  });
  assert.equal(r.loaded, false);
  assert.equal(r.reason, "no_candidate_satisfied_requirements");
});

// ── ★ Grader MINOR-1: the job's OWN override must not be silently outranked ──
test("★ preferVar puts the calling job's override first", () => {
  const env = { RAILS_ENV_PATH: "D:/rails/.env", SOAK_ENV_PATH: "D:/soak/.env" };
  const existsFn = existsOnly("D:/rails/.env", "D:/soak/.env");
  assert.equal(path.resolve(resolveEnvPath({ cwd: WORKTREE, moduleDir: MODDIR, env, existsFn, preferVar: "SOAK_ENV_PATH" })),
               path.resolve("D:/soak/.env"), "an operator's SOAK pin was outranked by an ambient RAILS var");
  assert.equal(path.resolve(resolveEnvPath({ cwd: WORKTREE, moduleDir: MODDIR, env, existsFn, preferVar: "RAILS_ENV_PATH" })),
               path.resolve("D:/rails/.env"));
});

// ── ★ Grader MINOR-3: cold recovery is when "cwd is the repo root" stops being true ──
test("★ siblings are derived from the MODULE's location too, not only cwd", () => {
  // With cwd deep inside the worktree, the cwd-derived siblings miss entirely. The
  // module-derived ones must still reach the canonical checkout.
  const deepCwd = path.join(WORKTREE, "scripts", "soak");
  const got = resolveEnvPath({ cwd: deepCwd, moduleDir: MODDIR, env: {}, existsFn: existsOnly(CANONICAL_NESTED) });
  assert.equal(path.resolve(got), CANONICAL_NESTED, "resolution died when cwd was not the repo root");
});
