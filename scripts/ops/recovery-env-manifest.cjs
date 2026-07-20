// scripts/ops/recovery-env-manifest.cjs — the TYPED SOURCE for cold-recovery env requirements.
//
// ★★ WHY THIS SHAPE: leg-2 proved that governing a SCHEMA beats policing prose. Same move here.
// A recovery manifest is not a list of environment variables — a count of undeclared vars is not
// an inventory of recovery risk. What an operator needs, per variable, is: if this is missing on
// the rebuilt box, WHAT BREAKS, and WILL I BE TOLD?
//
// THREE CLASSES (OR-079). The middle one is the whole reason this file exists:
//   REQUIRED           — absence FAILS LOUDLY. Must be in the runbook.
//   OPTIONAL_FALLBACK  — absence is CORRECT; a working default takes over. Listing these in a
//                        runbook is cry-wolf that trains the operator to ignore the list.
//   OPTIONAL_DEGRADING — ★ absence SILENTLY reduces capability. The box boots healthy and is
//                        quietly less able. This is the class that composes into "boots healthy,
//                        S3-blind", and it is the one a runbook exists to surface.
//
// ★ THE DISCRIMINATOR, found in the wild rather than assumed: an EMPTY-STRING fallback
// (`?? ""`, `|| ""`, `.get(X, "")`) is syntactically a fallback and semantically a failure. It
// satisfies every "does it have a default?" check while yielding a broken value. That is what
// makes OPTIONAL_DEGRADING mechanically detectable at all — see `verify-env-manifest.cjs`,
// which re-derives each declared class from the code and FAILS on disagreement, so this file
// cannot quietly drift out of step with reality.
//
// ★ DECLARED SCOPE — this manifest covers the COLD-RECOVERY surface, not the whole app.
// The repo reads ~617 env vars; ~323 are absent from `.env.example`. Enumerating all of them
// would rebuild the cry-wolf list this design exists to avoid. Scope = the variables the
// recovery legs (db · services · tasks · wsl · s3 · secrets) actually depend on. A var outside
// that set is out of scope BY DESIGN, not overlooked.
//
// ★ DECLARED LIMITS of the verifier that checks this file (an undeclared limit is the same
// defect as an overclaiming guard):
//   1. STATIC READS ONLY. `env[someVariable]` is invisible to a source scan. RAILS_ENV_PATH is
//      a live example: it scores ZERO static read sites yet is genuinely read, via
//      `OVERRIDE_VARS` + `env[v]` in scripts/lib/env-resolve.cjs. Entries whose reads are
//      dynamic carry `dynamicRead: true` and are exempt from the derivation cross-check.
//   2. A NON-EMPTY BUT WRONG default still degrades silently and is NOT mechanically
//      detectable. The empty-string shape is the detectable SUBSET, not the whole class.
//      Those entries are classed by human judgement and marked `humanClassified: true`.
//   3. ★ JUSTIFICATION CONTENT IS ASSERTED, NOT VERIFIED. `validate()` checks that a declared
//      class CARRIES its `breaks`/`degrades`/`fallback` string and that it is non-empty — it
//      cannot check the string is TRUE. Not hypothetical: the shipped `DATABASE_URL` justification
//      claimed the verifier "reports FAIL" when `legDb()` actually returns UNKNOWN, and no test
//      caught it because no test could. Same shape as leg-2's receipt-content limit, one field
//      over. Justification prose is HUMAN-reviewed; the CLASS is machine-checked. Stated because
//      an undeclared limit is the same defect as an overclaiming guard — which is exactly what
//      that sentence was.
"use strict";

/** The CLOSED set of classes. A class cannot be introduced by phrasing. */
const CLASSES = Object.freeze({
  REQUIRED: {
    label: "REQUIRED",
    inRunbook: true,
    needs: "breaks", // must say what dies
  },
  OPTIONAL_FALLBACK: {
    label: "OPTIONAL — working default",
    inRunbook: false,
    needs: "fallback", // must name the default that takes over
  },
  OPTIONAL_DEGRADING: {
    label: "★ OPTIONAL — SILENTLY DEGRADES",
    inRunbook: true,
    needs: "degrades", // must say what quietly stops working
  },
});

/**
 * Recovery-critical variables. Each entry's class is cross-checked against the code by
 * verify-env-manifest.cjs; `evidence` cites the read site the classification came from.
 */
const VARS = [
  {
    name: "DATABASE_URL",
    leg: "db",
    classes: ["OPTIONAL_DEGRADING", "REQUIRED"],
    breaks:
      "every DB path. ★ CORRECTED: the recovery verifier's db leg reports **UNKNOWN** " +
      "(`database_url_absent`), NOT FAIL, when this is unset — verified by running `legDb()` " +
      "with it removed. FAIL fires only when the URL is PRESENT but the database is unreachable. " +
      "The earlier text claimed FAIL and was false; UNKNOWN-is-not-FAIL is deliberate (a checker " +
      "that cannot run must not condemn the box), so the runbook must say what actually happens.",
    degrades:
      "★ 5 of its read sites default to `\"\"` instead of failing — notably " +
      "src/server/lib/boot-migration-runner.ts:1020, where the MIGRATION RUNNER proceeds with an " +
      "empty URL. So DATABASE_URL is loud in 107 places and SILENT in 5, and the 5 are the ones " +
      "that matter on a rebuilt box.",
    evidence: "131 non-test read sites: 107 bare, 5 empty-string default, remainder guarded/defaulted.",
  },
  {
    name: "AWS_ACCESS_KEY_ID",
    leg: "s3",
    // Three shapes in three consumers — exactly why classes are a SET:
    // DEGRADING (duckdb-service.ts:83 defaults to "" and SETs it as the DuckDB S3 credential),
    // REQUIRED-shaped (s3-client.ts:77 guards, then uses it 8 lines later), and FALLBACK
    // (synthetic-regime-bank-service.ts:185 returns a `local:<path>` sentinel when
    // isS3Configured() is false — a graceful degrade that is CORRECT, not a failure).
    classes: ["OPTIONAL_DEGRADING", "OPTIONAL_FALLBACK"],
    fallback:
      "`local:<path>` sentinel — synthetic-regime-bank-service.ts:185 skips the S3 upload "
      + "and returns a local path when the credential trio is unset. THAT consumer degrades "
      + "gracefully and on purpose; the duckdb-service consumer does not.",
    degrades:
      "S3 auth. duckdb-service.ts:83 falls back to `\"\"` and SETs it as the DuckDB s3 key — " +
      "the box BOOTS HEALTHY and is silently S3-blind. The lake read fails later, far from the cause.",
    evidence: "src/data/loaders/duckdb-service.ts:83 — `process.env.AWS_ACCESS_KEY_ID ?? \"\"`",
  },
  {
    name: "AWS_SECRET_ACCESS_KEY",
    leg: "s3",
    // Three shapes in three consumers — exactly why classes are a SET:
    // DEGRADING (duckdb-service.ts:84 defaults to "" and SETs it as the DuckDB S3 credential),
    // REQUIRED-shaped (s3-client.ts:77 guards, then uses it 8 lines later), and FALLBACK
    // (synthetic-regime-bank-service.ts:185 returns a `local:<path>` sentinel when
    // isS3Configured() is false — a graceful degrade that is CORRECT, not a failure).
    classes: ["OPTIONAL_DEGRADING", "OPTIONAL_FALLBACK"],
    fallback:
      "`local:<path>` sentinel — synthetic-regime-bank-service.ts:185 skips the S3 upload "
      + "and returns a local path when the credential trio is unset. THAT consumer degrades "
      + "gracefully and on purpose; the duckdb-service consumer does not.",
    degrades:
      "S3 auth, identically to AWS_ACCESS_KEY_ID — duckdb-service.ts:84 defaults to `\"\"`. " +
      "The pair is the canonical 'boots healthy, S3-blind' shape.",
    evidence: "src/data/loaders/duckdb-service.ts:84 — `process.env.AWS_SECRET_ACCESS_KEY ?? \"\"`",
  },
  {
    name: "S3_BUCKET",
    leg: "s3",
    classes: ["OPTIONAL_FALLBACK"],
    fallback: "trading-forge-data",
    evidence:
      "19 non-test read sites. 17 default to \"trading-forge-data\"; the 2 apparent bare reads " +
      "(synthetic-regime-bank-service.ts:170,189) are a PRESENCE GUARD — `env[\"S3_BUCKET\"] && …` " +
      "then a guarded `!` — i.e. an optional feature gated on the var, not a crash path. " +
      "★ Classing those as REQUIRED would have put a non-required var in the runbook: cry-wolf.",
  },
  {
    name: "AWS_REGION",
    leg: "s3",
    classes: ["OPTIONAL_DEGRADING"],
    degrades:
      "★ CORRECTED BY THE VERIFIER, against my own hand-declaration. I classed this " +
      "OPTIONAL_FALLBACK on the strength of `?? \"us-east-1\"` at duckdb-service.ts:82 — but 3 " +
      "sites default to `\"\"` (data_loader.py:52, deepar_forecaster.py:181, and s3_capability_probe.py:67, " +
      "which is OUR OWN leg-5 probe). An empty region silently mis-targets S3 rather than failing.",
    evidence: "8 non-test read sites: 3 empty-string default, 5 working default (us-east-1).",
  },
  {
    name: "S3_PROBE_KEY",
    leg: "s3",
    classes: ["OPTIONAL_FALLBACK"],
    fallback: "futures/ES/consolidated/daily.parquet",
    evidence: "scripts/ops/s3_capability_probe.py:61 — single read site, defaulted.",
  },
  {
    name: "TF_HEALTH_URL",
    leg: "services",
    classes: ["OPTIONAL_FALLBACK"],
    fallback: "http://127.0.0.1:4000/api/health",
    evidence: "4 non-test read sites, all defaulted (verify-recovery.cjs:82, tower-idle-guard.cjs:29, …).",
  },
  {
    name: "RAILS_ENV_PATH",
    leg: "secrets",
    classes: ["OPTIONAL_FALLBACK"],
    fallback: "the resolver's candidate chain (cwd/.env, then the nested canonical checkout)",
    dynamicRead: true,
    evidence:
      "★ ZERO static read sites — read dynamically via OVERRIDE_VARS + env[v] in " +
      "scripts/lib/env-resolve.cjs:44,70. This entry is why limit #1 is declared.",
  },
  {
    name: "SOAK_ENV_PATH",
    leg: "secrets",
    classes: ["OPTIONAL_FALLBACK"],
    fallback: "the resolver's candidate chain (same as RAILS_ENV_PATH)",
    dynamicRead: true,
    evidence:
      "scripts/soak/soak-skip.cjs:8 reads it as the first candidate in a list, then falls " +
      "through to cwd/.env; also dynamic via env-resolve.cjs OVERRIDE_VARS.",
  },
];

/** Throws if the data violates the schema. The schema IS the honesty guard. */
function validate(vars = VARS, classes = CLASSES) {
  const valid = Object.keys(classes);
  const seen = new Set();
  for (const v of vars) {
    if (!v.name || seen.has(v.name)) throw new Error(`duplicate or missing var name: ${v.name}`);
    seen.add(v.name);
    if (!Array.isArray(v.classes) || v.classes.length === 0) {
      throw new Error(`var "${v.name}" must declare a non-empty classes[] set`);
    }
    if (new Set(v.classes).size !== v.classes.length) {
      throw new Error(`var "${v.name}" repeats a class`);
    }
    for (const c of v.classes) {
      if (!valid.includes(c)) {
        throw new Error(`var "${v.name}" has class "${c}", not one of ${valid.join("|")}`);
      }
      // EVERY declared class owes its own justification field. A var that is both REQUIRED and
      // silently-degrading must say BOTH what dies and what quietly stops working — otherwise
      // the dangerous half rides along undeclared, which is the defect this file exists to stop.
      const needs = classes[c].needs;
      if (!v[needs] || !String(v[needs]).trim()) {
        throw new Error(`var "${v.name}" is ${c} but does not state "${needs}"`);
      }
    }
    if (!v.evidence || !String(v.evidence).trim()) {
      throw new Error(`var "${v.name}" carries no evidence citation`);
    }
  }
  return true;
}

/** Vars an operator must see in the runbook: REQUIRED + the silently-degrading middle. */
const runbookVars = (vars = VARS, classes = CLASSES) =>
  vars.filter((v) => v.classes.some((c) => classes[c].inRunbook));

/** Vars deliberately NOT in the runbook — listing them would be cry-wolf. */
const suppressedVars = (vars = VARS, classes = CLASSES) =>
  vars.filter((v) => !v.classes.some((c) => classes[c].inRunbook));

module.exports = { CLASSES, VARS, validate, runbookVars, suppressedVars };
