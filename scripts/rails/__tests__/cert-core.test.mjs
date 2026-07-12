// scripts/rails/__tests__/cert-core.test.mjs — cert schema + diff pure logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCertificate, validateCertificate, INVARIANT_CHECKS, CERT_SCHEMA_VERSION } from "../cert-schema.cjs";
import { diffCertificates } from "../cert-diff.cjs";
import { assembleNightly } from "../cert-rig.cjs";

const allPass = () => Object.fromEntries(INVARIANT_CHECKS.map((n) => [n, "pass"]));

test("buildCertificate: all pass → allPass true, every check recorded", () => {
  const c = buildCertificate({ reportDate: "2026-07-12", buildSha: "abc", checkResults: allPass() });
  assert.equal(c.schemaVersion, CERT_SCHEMA_VERSION);
  assert.equal(c.allPass, true);
  assert.equal(Object.keys(c.checks).length, INVARIANT_CHECKS.length);
});

test("buildCertificate: missing check → fail-closed (recorded as fail, allPass false)", () => {
  const r = allPass(); delete r["check:pglite-ddl-parity"];
  const c = buildCertificate({ reportDate: "2026-07-12", buildSha: "abc", checkResults: r });
  assert.equal(c.checks["check:pglite-ddl-parity"], "fail");
  assert.equal(c.allPass, false);
});

test("validateCertificate: well-formed passes, malformed fails", () => {
  const c = buildCertificate({ reportDate: "2026-07-12", buildSha: "abc", checkResults: allPass() });
  assert.equal(validateCertificate(c), true);
  assert.equal(validateCertificate({ ...c, schemaVersion: "wrong" }), false);
  assert.equal(validateCertificate({ ...c, reportDate: "" }), false);
  assert.equal(validateCertificate(null), false);
});

test("diff: first night all pass → green, no changes", () => {
  const curr = buildCertificate({ reportDate: "2026-07-12", buildSha: "a", checkResults: allPass() });
  const d = diffCertificates(null, curr);
  assert.equal(d.verdict, "green");
  assert.deepEqual(d.changes, []);
});

test("diff: first night with a failing invariant → drift (no prev to change from)", () => {
  const r = allPass(); r["check:ts-python-exit-parity"] = "fail";
  const curr = buildCertificate({ reportDate: "2026-07-12", buildSha: "a", checkResults: r });
  const d = diffCertificates(null, curr);
  assert.equal(d.verdict, "drift");
  assert.equal(d.anyFail, true);
  assert.deepEqual(d.changes, []);
});

test("diff: a check flips pass→fail vs last night → drift + change recorded", () => {
  const prev = buildCertificate({ reportDate: "2026-07-11", buildSha: "a", checkResults: allPass() });
  const r = allPass(); delete r["system-map:check"]; // missing → recorded as fail
  const curr = buildCertificate({ reportDate: "2026-07-12", buildSha: "b", checkResults: r });
  const d = diffCertificates(prev, curr);
  assert.equal(d.verdict, "drift");
  assert.deepEqual(d.changes, [{ check: "system-map:check", from: "pass", to: "fail" }]);
});

test("diff: recovery fail→pass, all now pass → green but change surfaced", () => {
  const pr = allPass(); pr["check:gate-contract-keys"] = "fail";
  const prev = buildCertificate({ reportDate: "2026-07-11", buildSha: "a", checkResults: pr });
  const curr = buildCertificate({ reportDate: "2026-07-12", buildSha: "b", checkResults: allPass() });
  const d = diffCertificates(prev, curr);
  assert.equal(d.verdict, "green");
  assert.deepEqual(d.changes, [{ check: "check:gate-contract-keys", from: "fail", to: "pass" }]);
});

test("diff: identical all-pass night → green, no changes", () => {
  const prev = buildCertificate({ reportDate: "2026-07-11", buildSha: "a", checkResults: allPass() });
  const curr = buildCertificate({ reportDate: "2026-07-12", buildSha: "b", checkResults: allPass() });
  const d = diffCertificates(prev, curr);
  assert.equal(d.verdict, "green");
  assert.deepEqual(d.changes, []);
});

test("assembleNightly: produces the exact DB row shape (report_date/build_sha/verdict/certificate)", () => {
  const { cert, diff, row } = assembleNightly({ prev: null, reportDate: "2026-07-12", buildSha: "sha1", checkResults: allPass() });
  assert.equal(row.report_date, "2026-07-12");
  assert.equal(row.build_sha, "sha1");
  assert.equal(row.verdict, "green");
  assert.equal(row.certificate, cert);
  assert.equal(diff.verdict, "green");
});

test("assembleNightly: a flip from last night → row.verdict drift + change surfaced", () => {
  const prev = buildCertificate({ reportDate: "2026-07-11", buildSha: "a", checkResults: allPass() });
  const r = allPass(); delete r["check:pglite-ddl-parity"];
  const { row, diff } = assembleNightly({ prev, reportDate: "2026-07-12", buildSha: "b", checkResults: r });
  assert.equal(row.verdict, "drift");
  assert.deepEqual(diff.changes, [{ check: "check:pglite-ddl-parity", from: "pass", to: "fail" }]);
});
