// scripts/rails/cert-schema.cjs — the nightly certificate shape + the FROZEN invariant battery.
// v1 battery = deterministic system-invariant checks that MUST stay byte-stable night-over-night;
// a check flipping pass→fail is a real regression/drift signal. Fingerprint-of-output enrichment
// (catch a "still-passes-but-value-moved" change) is a documented v2 follow-up.
"use strict";

const CERT_SCHEMA_VERSION = "rails_cert_v1";

// npm scripts, each exits 0 (pass) / nonzero (fail). Ordering is frozen so certificates diff cleanly.
const INVARIANT_CHECKS = [
  "check:ts-python-firm-rules-version",
  "check:ts-python-exit-parity",
  "check:ts-python-tier1-parity",
  "check:ts-python-pm-factor-parity",
  "check:gate-contract-keys",
  "check:pglite-ddl-parity",
  "check:2026-compliance",
  "system-map:check",
];

// checkResults: { [checkName]: "pass" | "fail" }. Missing → "fail" (fail-closed: an uncollected
// invariant is treated as failed, never silently passed).
function buildCertificate({ reportDate, buildSha, checkResults }) {
  const checks = {};
  for (const name of INVARIANT_CHECKS) {
    checks[name] = checkResults[name] === "pass" ? "pass" : "fail";
  }
  const allPass = Object.values(checks).every((v) => v === "pass");
  return { schemaVersion: CERT_SCHEMA_VERSION, reportDate, buildSha: buildSha || null, checks, allPass };
}

function validateCertificate(cert) {
  if (!cert || cert.schemaVersion !== CERT_SCHEMA_VERSION) return false;
  if (typeof cert.reportDate !== "string" || !cert.reportDate) return false;
  if (!cert.checks || typeof cert.checks !== "object") return false;
  return INVARIANT_CHECKS.every((n) => cert.checks[n] === "pass" || cert.checks[n] === "fail");
}

module.exports = { CERT_SCHEMA_VERSION, INVARIANT_CHECKS, buildCertificate, validateCertificate };
