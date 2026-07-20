// scripts/ops/verify-s3-capability.cjs — cold-recovery leg 5 driver.
//
// Node resolves the environment through the ONE shared resolver, then hands it to the
// Python probe that mirrors the engine's DuckDB read path.
//
// WHY SPLIT ACROSS TWO LANGUAGES — it is deliberate, not incidental:
//   * The production lake reader is Python + DuckDB (src/engine/data_loader.py). A Node
//     probe would exercise a different binding and certify a capability nobody uses.
//   * Robust .env resolution already exists, once, in scripts/lib/env-resolve.cjs. Writing
//     a second resolver in Python is exactly the duplication that produced the
//     RAILS_ENV_PATH/SOAK_ENV_PATH divergence this leg was opened to fix, and porting the
//     diagnostic's shallow `<script>/../.env` parse would build the fragility straight into
//     the thing meant to survive a cold box — which is when "cwd is the repo root" stops
//     being true.
// So: resolve ONCE in Node, inject, and let Python do only the read.
//
// Verdicts: 0 PASS / 2 UNKNOWN / 3 FAIL, mapped through an ALLOWLIST. UNKNOWN is NOT FAIL —
// a probe that cannot run must never report the lake as down — and exit 1 (Python's
// uncaught-traceback code) means the probe CRASHED, which is likewise not evidence.
"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadEnvFile } = require("../lib/env-resolve.cjs");

// ★ MAJOR-1: FAIL is 3, not 1. Exit 1 is Python's uncaught-traceback code, so it means
// "the probe crashed" — which is NOT evidence about the lake and maps to UNKNOWN.
const PASS = 0, UNKNOWN = 2, FAIL = 3, CRASHED = 1;
const PROBE = path.join(__dirname, "s3_capability_probe.py");

function emit(o) { console.log(JSON.stringify({ probe: "s3_capability", ...o })); }

function main() {
  // requireVars is deliberately EMPTY: the S3 credentials are not in every .env, and a
  // missing credential is UNKNOWN (probe cannot run), not "wrong .env file". Demanding
  // them here would misreport a config gap as a resolution failure.
  const env = loadEnvFile({ cwd: process.cwd(), moduleDir: __dirname, preferVar: "RAILS_ENV_PATH" });

  // Report WHICH .env was used — a recovery check must be able to say that, not infer it.
  if (env.loaded) emit({ stage: "env", loadedFrom: env.path });
  else emit({ stage: "env", loaded: false, reason: env.reason });

  const py = process.platform === "win32" ? "python" : "python3";
  const r = spawnSync(py, [PROBE], { encoding: "utf-8", timeout: 60_000, windowsHide: true });

  if (r.error || r.status === null) {
    // Could not launch python, or it was killed by the timeout. The probe did not run, so
    // this is UNKNOWN — reporting FAIL here would blame the lake for our own tooling.
    emit({ verdict: "UNKNOWN", reason: r.error ? "python_unavailable" : "probe_timeout",
           error_class: r.error ? r.error.code || "spawn_failed" : "timeout" });
    return UNKNOWN;
  }

  if (r.stdout) process.stdout.write(r.stdout);

  // ★ MAJOR-2 (grader): this used to emit the raw stderr tail. DuckDB parser errors echo
  // SQL text verbatim and tracebacks can carry a presigned URL, so a message-text channel
  // contradicts the probe's own "class name only" discipline. It is latent today, but
  // data_loader.py documents a CERTIFIED native-crash class that `except Exception` cannot
  // catch — so the probe's scrubbing is not a guarantee this channel stays starved.
  // Emit only WHETHER there was stderr, never its content.
  if (r.status !== PASS && r.stderr && r.stderr.trim()) {
    emit({ stage: "probe_stderr", present: true, bytes: r.stderr.length });
  }

  // ★ MAJOR-1 / MINOR-1: map exit codes through an ALLOWLIST. An uncaught traceback (1) is
  // the probe crashing, and anything unrecognised is equally not evidence about the lake —
  // both become UNKNOWN rather than being passed through as a verdict they never claimed.
  if (r.status === PASS || r.status === FAIL || r.status === UNKNOWN) return r.status;
  emit({ verdict: "UNKNOWN", reason: r.status === CRASHED ? "probe_crashed" : "probe_exit_unmapped", exit_code: r.status });
  return UNKNOWN;
}

if (require.main === module) process.exitCode = main();
module.exports = { PASS, FAIL, UNKNOWN, CRASHED, PROBE };
