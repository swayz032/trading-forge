// scripts/ops/__tests__/s3-capability-probe.test.mjs
//
// ★ OR-082's REQUIREMENT: UNKNOWN≠FAIL must be TESTED, not merely declared. An UNKNOWN
// branch with no test is exactly where a real setup error silently collapses into FAIL and
// pages the operator about a lake that is fine — a true alarm pointed at the wrong thing.
//
// The probe is a real subprocess, so these drive it with a controlled environment rather
// than mocking it: the thing under test is the VERDICT MAPPING, and mocking the boundary
// would test my model of python instead of the probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PASS, FAIL, UNKNOWN, CRASHED, PROBE } from "../verify-s3-capability.cjs";

const PY = process.platform === "win32" ? "python" : "python3";
const pythonWorks = spawnSync(PY, ["-c", "print(1)"], { encoding: "utf-8" }).status === 0;

/** Run the probe with an EXACT environment (never inheriting real credentials). */
function runProbe(env) {
  return spawnSync(PY, [PROBE], {
    encoding: "utf-8", timeout: 60_000, windowsHide: true,
    // ★ MAJOR-4 (grader): HOME/USERPROFILE must be EXPLICIT. Windows' spawnSync injects
    // USERPROFILE even with an explicit env object; POSIX does not inject HOME. Without it
    // `INSTALL httpfs` fails ("Can't find the home directory"), the probe returns UNKNOWN,
    // and a leak assertion that accepts UNKNOWN passes green having tested NOTHING.
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      HOME: process.env.HOME || process.env.USERPROFILE,
      USERPROFILE: process.env.USERPROFILE || process.env.HOME,
      TEMP: process.env.TEMP, TMP: process.env.TMP,
      ...env,
    },
  });
}

/** Executable Python only: drop the module docstring AND #-comments, so prose describing a
 *  banned pattern is never mistaken for the pattern itself (the campaign's comment trap). */
function stripPy(src) {
  const noDoc = src.replace(/^\s*"""[\s\S]*?"""/m, "");
  return noDoc
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

const parse = (out) => JSON.parse(String(out).trim().split("\n").filter(Boolean).pop());

test("verdict codes are distinct and UNKNOWN is not FAIL", () => {
  assert.equal(PASS, 0); assert.equal(UNKNOWN, 2); assert.equal(FAIL, 3);
  assert.notEqual(UNKNOWN, FAIL, "collapsing UNKNOWN into FAIL blames the lake for our own tooling");
});

test("the probe file exists and is the one the driver points at", () => {
  assert.ok(fs.existsSync(PROBE), `probe missing at ${PROBE}`);
  assert.equal(path.basename(PROBE), "s3_capability_probe.py");
});

test("★ UNKNOWN (not FAIL) when credentials are absent — EXECUTED, not declared", (t) => {
  if (!pythonWorks) return t.skip("python unavailable on this host — verdict NOT exercised");
  const r = runProbe({});                       // no AWS_* at all
  assert.equal(r.status, UNKNOWN, `expected UNKNOWN(2), got ${r.status}: ${r.stdout}${r.stderr}`);
  const v = parse(r.stdout);
  assert.equal(v.verdict, "UNKNOWN");
  // It must name WHICH vars are missing — by NAME, so recovery is actionable.
  assert.ok(["credentials_absent", "duckdb_unavailable"].includes(v.reason), `unexpected reason ${v.reason}`);
  if (v.reason === "credentials_absent") {
    assert.deepEqual(v.missing, ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
  }
});

test("★ a partial credential set is still UNKNOWN, and names only the MISSING one", (t) => {
  if (!pythonWorks) return t.skip("python unavailable on this host — verdict NOT exercised");
  const r = runProbe({ AWS_ACCESS_KEY_ID: "AKIA_NOT_A_REAL_KEY" });
  assert.equal(r.status, UNKNOWN);
  const v = parse(r.stdout);
  if (v.reason === "credentials_absent") {
    assert.deepEqual(v.missing, ["AWS_SECRET_ACCESS_KEY"], "must name the missing var, not all of them");
  }
});

test("★ NO SECRET in any output path — a planted value never appears", (t) => {
  if (!pythonWorks) return t.skip("python unavailable on this host — leak check NOT exercised");
  const SECRET = "s3cr3t-CANARY-must-never-be-printed";
  const r = runProbe({ AWS_ACCESS_KEY_ID: "AKIA_CANARY_ID", AWS_SECRET_ACCESS_KEY: SECRET, AWS_REGION: "us-east-1", S3_BUCKET: "definitely-not-a-real-bucket-xyz" });
  const all = `${r.stdout}${r.stderr}`;
  assert.ok(!all.includes(SECRET), "the secret VALUE reached an output stream");
  assert.ok(!all.includes("AKIA_CANARY_ID"), "the access key VALUE reached an output stream");
  // ★ MAJOR-4: the assertion must REQUIRE that a read was attempted. Accepting UNKNOWN
  // let this pass on a host where the probe never reached the network — a leak test that
  // tests nothing is worse than no leak test, because it reports safety.
  const v = parse(r.stdout);
  assert.equal(v.reason, "read_failed", `no read was attempted (reason=${v.reason}) — leak channel NOT exercised`);
  assert.equal(r.status, FAIL, "a reachable-but-bad target is the lake's problem, not UNKNOWN");
});

test("★ the probe never SETs credentials into SQL — the engine's own anti-injection stance", () => {
  // src/engine/data_loader.py: "DuckDB auto-reads AWS_ACCESS_KEY_ID and
  // AWS_SECRET_ACCESS_KEY from environment variables when httpfs is loaded. No manual SET
  // needed, which avoids SQL injection risk from credentials with special chars."
  // A probe that interpolated them would diverge from production AND put a secret in a
  // string that error paths can echo.
  const src = fs.readFileSync(PROBE, "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("#") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!/SET\s+s3_access_key_id/i.test(code), "probe SETs the access key into SQL");
  assert.ok(!/SET\s+s3_secret_access_key/i.test(code), "probe SETs the secret into SQL");
  assert.match(code, /LOAD httpfs/, "probe must use the engine's httpfs path");
  assert.match(code, /read_parquet/, "probe must exercise the production read mechanism");
  // the region IS SET, and must be quote-stripped exactly as the engine does
  assert.match(code, /replace\("'", ""\)/, "AWS_REGION must be sanitized before SET");
});

test("★ ONE read, not a survey — a gate asks 'reachable at all', not 'complete'", () => {
  const code = fs.readFileSync(PROBE, "utf8");
  assert.match(code, /LIMIT 1/, "the probe must do one tiny read");
  assert.ok(!/for symbol in/.test(code), "this is a gate, not the 21-combination diagnostic");
});

test("★ the probe EXITS with its verdict — the diagnostic it replaces always exited 0", () => {
  const code = fs.readFileSync(PROBE, "utf8");
  assert.match(code, /sys\.exit\(main\(\)\)/, "verdict must reach the exit code");
  assert.match(code, /return FAIL/, "a FAIL path must exist and be reachable");
});

test("★ exit 1 (an uncaught traceback) maps to UNKNOWN, not FAIL", () => {
  // ★ MAJOR-1 (grader): FAIL used to BE 1, so any bug in the probe reported "the lake is
  // unreachable" — the exact inversion the three-state design exists to prevent.
  assert.equal(CRASHED, 1);
  assert.notEqual(FAIL, CRASHED, "FAIL must not collide with Python's traceback exit code");
  assert.equal(FAIL, 3);
  assert.equal(UNKNOWN, 2);
});

test("★ the probe's verdict constants match the driver's allowlist", () => {
  // A silent drift here would make the driver map a real verdict to UNKNOWN, or worse pass
  // an unmapped code through as if it were one.
  const code = fs.readFileSync(PROBE, "utf8");
  assert.match(code, /PASS,\s*UNKNOWN,\s*FAIL,\s*CRASHED\s*=\s*0,\s*2,\s*3,\s*1/,
    "probe verdict codes drifted from the driver's");
});

test("★ the read must DECODE data, not just the footer (grader MAJOR-3)", () => {
  const code = stripPy(fs.readFileSync(PROBE, "utf8"));
  // `SELECT 1` projects zero columns -> DuckDB answers from row-group metadata and PASSes
  // on an object whose data region is destroyed. Proven by execution, not argued.
  assert.ok(!/SELECT\s+1\s+FROM\s+read_parquet/i.test(code), "zero-column projection reads only the footer");
  assert.ok(!/COUNT\(\*\)\s*FROM\s*\(/i.test(code), "the COUNT wrapper is pruned identically");
  assert.match(code, /SELECT \* FROM read_parquet\(\?\) LIMIT 1/, "must force a column decode");
});
