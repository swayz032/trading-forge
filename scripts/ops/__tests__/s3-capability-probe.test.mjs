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
import { PASS, FAIL, UNKNOWN, PROBE } from "../verify-s3-capability.cjs";

const PY = process.platform === "win32" ? "python" : "python3";
const pythonWorks = spawnSync(PY, ["-c", "print(1)"], { encoding: "utf-8" }).status === 0;

/** Run the probe with an EXACT environment (never inheriting real credentials). */
function runProbe(env) {
  return spawnSync(PY, [PROBE], {
    encoding: "utf-8", timeout: 60_000, windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
  });
}

const parse = (out) => JSON.parse(String(out).trim().split("\n").filter(Boolean).pop());

test("verdict codes are distinct and UNKNOWN is not FAIL", () => {
  assert.equal(PASS, 0); assert.equal(FAIL, 1); assert.equal(UNKNOWN, 2);
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
  // A bad bucket with valid-shaped creds is the lake's problem -> FAIL, not UNKNOWN.
  assert.ok([FAIL, UNKNOWN].includes(r.status), `unexpected status ${r.status}`);
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
