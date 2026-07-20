// Tests for the cold-recovery env manifest (leg 3) and its code cross-check.
//
// ★ The mutation block is the load-bearing part. A verifier that is green because it cannot go
// red is worthless — a CONTROL MUST DISCRIMINATE. Each mutant below is the shape of a REAL
// defect (undeclared silent degradation, an overclaimed limit, a hidden dangerous minority),
// not the shape nearest to hand, and the positive control asserts the unmutated manifest passes
// so a suite that fails everything cannot masquerade as rigour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLASSES, VARS, validate, runbookVars, suppressedVars } from "../recovery-env-manifest.cjs";
import { siteShape, deriveClasses, check, TEST_RE } from "../verify-env-manifest.cjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const clone = () => JSON.parse(JSON.stringify(VARS));

test("the shipped manifest satisfies its own schema", () => {
  assert.equal(validate(), true);
});

test("every declared class owes its justification field", () => {
  for (const v of VARS) {
    for (const c of v.classes) {
      const needs = CLASSES[c].needs;
      assert.ok(v[needs] && String(v[needs]).trim(),
        `${v.name} is ${c} but does not state "${needs}"`);
    }
    assert.ok(v.evidence && v.evidence.trim(), `${v.name} carries no evidence`);
  }
});

test("a var can hold BOTH classes — the model that a single label would have hidden", () => {
  const db = VARS.find((v) => v.name === "DATABASE_URL");
  assert.deepEqual([...db.classes].sort(), ["OPTIONAL_DEGRADING", "REQUIRED"]);
  // The point of the set model: the dangerous minority survives alongside the dominant shape.
  assert.match(db.degrades, /boot-migration-runner/);
});

test("runbook shows REQUIRED + DEGRADING, suppresses safe-default vars (anti-cry-wolf)", () => {
  const shown = runbookVars().map((v) => v.name);
  const hidden = suppressedVars().map((v) => v.name);
  assert.ok(shown.includes("DATABASE_URL"));
  assert.ok(shown.includes("AWS_ACCESS_KEY_ID"));
  assert.ok(shown.includes("AWS_REGION"));
  // S3_BUCKET has a working default everywhere; listing it would train the operator to ignore
  // the list. Its two apparent bare reads are a presence guard, not a crash path.
  assert.ok(hidden.includes("S3_BUCKET"), "S3_BUCKET must NOT be in the runbook");
  assert.ok(hidden.includes("TF_HEALTH_URL"));
  assert.equal(shown.length + hidden.length, VARS.length);
});

test("siteShape: the empty-string default is the discriminator", () => {
  assert.equal(siteShape('const b = process.env.AWS_ACCESS_KEY_ID ?? "";'), "empty_default");
  assert.equal(siteShape('region = os.environ.get("AWS_REGION", "")'), "empty_default");
  assert.equal(siteShape('const b = process.env.S3_BUCKET ?? "trading-forge-data";'), "working_default");
  assert.equal(siteShape('bucket = os.environ.get("S3_BUCKET", "trading-forge-data")'), "working_default");
  assert.equal(siteShape('if (!process.env.AWS_ACCESS_KEY_ID) return null;'), "guard");
  assert.equal(siteShape('db_url = os.environ.get("DATABASE_URL")'), "bare");
});

test("deriveClasses reports UNKNOWN (null) for no sites — a checker that cannot run must not condemn", () => {
  assert.equal(deriveClasses([]), null);
});

test("the test-file filter covers Python's test_*.py convention", () => {
  // Omitting this inflated DATABASE_URL from 115 read sites to 171 during the build.
  assert.ok(TEST_RE.test("src/data/scripts/test_data_sync_tracking.py"));
  assert.ok(TEST_RE.test("src/server/__tests__/foo.test.ts"));
  assert.ok(TEST_RE.test("src/engine/tests/test_x.py"));
  assert.ok(!TEST_RE.test("src/engine/data_loader.py"));
});

test("dynamic-read entries are SKIPPED and the skip is REPORTED, never silently passed", () => {
  const rows = check();
  const rails = rows.find((r) => r.name === "RAILS_ENV_PATH");
  assert.equal(rails.verdict, "SKIP");
  assert.equal(rails.reason, "dynamic_read_declared");
});

test("the declared limits are stated IN the artifact, not merely implied", () => {
  // An undeclared limit is the same defect as an overclaiming guard.
  const src = readSource("verify-env-manifest.cjs");
  assert.match(src, /DOES NOT ADJUDICATE|NOT VERIFIED/,
    "the tool must declare that REQUIRED vs OPTIONAL_FALLBACK is not derived");
  assert.match(src, /STATIC ONLY/, "the dynamic-read blind spot must be declared");
  assert.match(src, /UNKNOWN IS NOT FAIL/);
});

function readSource(name) {
  return readFileSync(join(import.meta.dirname, "..", name), "utf-8");
}

// ─── MUTATIONS: each must be CAUGHT ────────────────────────────────────────────
const mutants = [
  {
    name: "undeclared silent degradation (AWS_ACCESS_KEY_ID)",
    mutate: (v) => { const e = v.find((x) => x.name === "AWS_ACCESS_KEY_ID");
                     e.classes = ["REQUIRED"]; e.breaks = "x"; },
    expectFailOn: "AWS_ACCESS_KEY_ID",
  },
  {
    name: "undeclared silent degradation (AWS_REGION — the one the verifier corrected me on)",
    mutate: (v) => { const e = v.find((x) => x.name === "AWS_REGION");
                     e.classes = ["OPTIONAL_FALLBACK"]; e.fallback = "us-east-1"; },
    expectFailOn: "AWS_REGION",
  },
  {
    name: "overclaimed degradation (TF_HEALTH_URL)",
    mutate: (v) => { const e = v.find((x) => x.name === "TF_HEALTH_URL");
                     e.classes = ["OPTIONAL_DEGRADING"]; e.degrades = "made up"; },
    expectFailOn: "TF_HEALTH_URL",
  },
  {
    name: "hide the dangerous minority (DATABASE_URL -> REQUIRED only)",
    mutate: (v) => { v.find((x) => x.name === "DATABASE_URL").classes = ["REQUIRED"]; },
    expectFailOn: "DATABASE_URL",
  },
];

for (const m of mutants) {
  test(`MUTANT CAUGHT — ${m.name}`, () => {
    const v = clone();
    m.mutate(v);
    const rows = check(v);
    const row = rows.find((r) => r.name === m.expectFailOn);
    assert.equal(row.verdict, "FAIL", `${m.name} SURVIVED — the check does not discriminate`);
  });
}

test("MUTANT CAUGHT — a class asserted without its justification throws", () => {
  const v = clone();
  delete v.find((x) => x.name === "AWS_REGION").degrades;
  assert.throws(() => validate(v), /does not state/);
});

test("MUTANT CAUGHT — an invented class is rejected", () => {
  const v = clone();
  v[0].classes = ["DEFINITELY_FINE"];
  assert.throws(() => validate(v), /not one of/);
});

test("MUTANT CAUGHT — an empty classes[] set is rejected", () => {
  const v = clone();
  v[0].classes = [];
  assert.throws(() => validate(v), /non-empty/);
});

test("POSITIVE CONTROL — the real, unmutated manifest is GREEN", () => {
  // Without this, a suite that fails everything would look like rigour.
  const rows = check();
  assert.equal(rows.filter((r) => r.verdict === "FAIL").length, 0);
  assert.ok(rows.some((r) => r.verdict === "PASS"), "at least one real PASS");
});
