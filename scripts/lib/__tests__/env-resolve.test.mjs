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
  const r = loadEnvFile({ cwd: WORKTREE, moduleDir: MODDIR, env: {}, existsFn: () => false, requireFn: () => ({ config() {} }) });
  assert.deepEqual(r, { path: null, loaded: false, reason: "no_env_candidate_exists" });
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
    requireFn: () => ({ config() {} }),
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
