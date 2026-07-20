// scripts/watchdog/__tests__/api-liveness-watchdog.test.mjs
// External API-liveness watchdog (Grade-B rider; OR-020 §2 parameters).
//
// The watchdog must have ZERO repo dependencies — it exists to report that the tree is broken,
// so it cannot need the tree. That rules out a JS classifier. Instead the PRODUCTION PowerShell
// exposes its pure functions and a -SelfTest mode drives them with fixtures; this harness runs
// that and asserts the results. There is no parallel JS copy to drift out of sync — the path
// under test is the path that ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const script = path.resolve(import.meta.dirname, "..", "api-liveness-watchdog.ps1");

function selfTest() {
  const out = execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-SelfTest"],
    { encoding: "utf-8", timeout: 120_000 },
  );
  const rows = out.trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  return {
    verdicts: Object.fromEntries(rows.filter((r) => r.verdict).map((r) => [r.case, r])),
    actions: Object.fromEntries(rows.filter((r) => r.action).map((r) => [r.case, r.action])),
  };
}

const R = selfTest();

test("a live API is healthy", () => {
  assert.equal(R.verdicts.http200.verdict, "UP");
  assert.equal(R.verdicts.http200.healthy, true);
});

// The false positive that would train the operator to ignore the watchdog.
test("503 auth_not_configured is HEALTHY, not an outage", () => {
  assert.equal(R.verdicts.auth_gated_503.verdict, "AUTH_GATED_UP");
  assert.equal(R.verdicts.auth_gated_503.healthy, true, "the documented secure state must never page");
});

test("any HTTP response counts as serving — even a 500", () => {
  assert.equal(R.verdicts.other_503.healthy, true);
  assert.equal(R.verdicts.http500.healthy, true);
});

// The actual 07-18 signature: nothing listening at all.
test("connection refused is DOWN — the incident signature", () => {
  assert.equal(R.verdicts.refused.verdict, "DOWN");
  assert.equal(R.verdicts.refused.healthy, false);
});

test("timeouts and probe faults are AMBIGUOUS and count as unhealthy, never silently ignored", () => {
  for (const c of ["timeout", "probe_error", "unknown"]) {
    assert.equal(R.verdicts[c].verdict, "AMBIGUOUS", c);
    assert.equal(R.verdicts[c].healthy, false, `${c} must not pass quietly`);
  }
});

test("alerting: quiet when healthy, fires at the threshold, not before", () => {
  assert.equal(R.actions.healthy_quiet, "NONE");
  assert.equal(R.actions.below_threshold, "NONE", "2 of 3 misses must not page");
  assert.equal(R.actions.threshold, "ALERT");
});

test("alerting is rate-limited, and recovery says so exactly once", () => {
  assert.equal(R.actions.rate_limited, "NONE", "must not re-page every 5 minutes while down");
  assert.equal(R.actions.realert, "REALERT");
  assert.equal(R.actions.healthy_recover, "RECOVERY");
});

// ── The constraints that make this watchdog different from the ones that failed ──
// Scan EXECUTABLE lines only. The first version of these tests scanned the whole file and
// failed on the script's own header comment, which documents the node_modules incident —
// the assertion was crude enough to forbid describing the very problem the script exists for.
// The intent is "must not DEPEND on the repo tree", not "must not mention it".
function codeLines(src) {
  return src
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, ""))   // strip PowerShell comments
    .filter((l) => l.trim().length > 0)
    .join("\n");
}

test("ZERO repo dependencies — it must survive the broken tree it reports on", () => {
  const code = codeLines(fs.readFileSync(script, "utf-8"));
  assert.ok(!/\bnode\b\s+\S+\.(c|m)?js/.test(code), "must not invoke node");
  assert.ok(!/npm\s+(run|ci|install)/.test(code), "must not invoke npm");
  assert.ok(!/node_modules/.test(code), "must not reference node_modules in executable code");
});

test("it NEVER restarts anything — one restarter per system", () => {
  const src = codeLines(fs.readFileSync(script, "utf-8"));
  // Guard against a future edit adding a restart path. The API's in-process heartbeat is the
  // only restarter; a second one would race it (OR-013 §3's 4 AM crash-loop).
  assert.ok(!/Restart-Service|Start-Service|Stop-Service|sc\.exe|nssm/i.test(src),
    "the watchdog must observe and report, never act on services");
  assert.ok(!/self-restart/i.test(src), "must not call the HMAC self-restart endpoint");
});

test("safety rails present: kill-file, mutex, dry-run", () => {
  const src = fs.readFileSync(script, "utf-8");
  assert.match(src, /KillFile/, "kill-file switch");
  assert.match(src, /Mutex/, "overlap guard");
  assert.match(src, /\$DryRun/, "dry-run");
  assert.match(src, /watchdog_thresholds_v1/, "versioned thresholds");
});
