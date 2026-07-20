// scripts/lib/__tests__/false-success-lint.test.mjs
//
// ★ POSITIVE CONTROL IS THE POINT (OR-081 §4 / OR-086). A guard against a class this
// campaign has shipped three times must itself be proven non-vacuous: it MUST flag a
// known-bad fixture, and it MUST stay silent on the correct idioms that live next door.
// A lint that flags nothing is indistinguishable from a lint that runs nothing — the
// exact shape of the vacuous test found one commit earlier.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lintSource, formatFindings, STATUS_RETURNING } from "../false-success-lint.cjs";

// ── KNOWN-BAD: every line here is a real shape from this project's history ──
const KNOWN_BAD = `
async function boot() {
  void postDiscord("crash");                       // R1 — the {ok:false} is thrown away
  try {
    await fetch(url, { method: "POST", body: b }); // R2 — 4xx/5xx never throws
  } catch { /* best effort */ }
}
`;

// ── KNOWN-GOOD: the correct idioms, all of which must stay SILENT ──
const KNOWN_GOOD = `
async function ok() {
  const res = await postDiscord(msg);
  if (res && res.ok === false) return { ok: false, reason: res.reason };

  const r = await fetch(url, { method: "POST" });
  if (!r.ok) return { ok: false, reason: "http_" + r.status };

  void insertAuditRowSafe(row);        // best-effort audit idiom — NOT status-returning
  await db.insert(table).values(row);  // Drizzle THROWS; discarding is correct
  return { ok: true };
}
`;

test("★ POSITIVE CONTROL — the lint FLAGS the known-bad fixture", () => {
  const f = lintSource(KNOWN_BAD, "known-bad.cjs");
  const rules = f.map((x) => x.rule);
  assert.ok(rules.includes("void_discards_status"), "R1 missed: void postDiscord(...)");
  assert.ok(rules.includes("fetch_status_unread"), "R2 missed: fetch with no .ok read");
  assert.equal(f.length, 2, `expected exactly 2 findings, got ${JSON.stringify(f)}`);
});

test("★ NEGATIVE CONTROL — the correct idioms next door produce ZERO findings", () => {
  // This is what makes the lint usable. Flagging these would train the operator to ignore
  // it, which is worse than not having it: the cry-wolf failure, one layer over.
  assert.deepEqual(lintSource(KNOWN_GOOD, "known-good.cjs"), []);
});

test("R1 is ALLOWLISTED — `void` alone is not a defect", () => {
  assert.deepEqual(lintSource("void somethingUnrelated(x);", "f.cjs"), []);
  assert.equal(lintSource("void postDiscord(x);", "f.cjs").length, 1);
  assert.ok(STATUS_RETURNING.includes("postDiscord"));
});

test("comments and prose never trigger a finding", () => {
  const src = `// this file explains void postDiscord( and fetch( without calling either\n/* void callSink( */\nconst x = 1;`;
  assert.deepEqual(lintSource(src, "doc.cjs"), []);
});

test("LINT-OK suppression works and must carry a reason", () => {
  const src = `// LINT-OK(R1): secondary alert behind a durable ledger row; claims nothing\nvoid postDiscord("x");`;
  assert.deepEqual(lintSource(src, "f.cjs"), []);
  // ...and an unannotated identical line is still flagged, so suppression is deliberate.
  assert.equal(lintSource('void postDiscord("x");', "f.cjs").length, 1);
});

test("formatFindings names the failure channel, not just the line", () => {
  const out = formatFindings(lintSource(KNOWN_BAD, "known-bad.cjs"));
  assert.match(out, /only failure channel/);
  assert.equal(formatFindings([]), "false-success lint: clean");
});

// ── The real ops surface. Non-blocking today: this asserts the lint RUNS over every
// ── ops file and reports, not that the surface is already clean.
test("the lint executes over the real ops surface and returns a definite result", () => {
  const roots = ["scripts/lib", "scripts/rails", "scripts/soak"];
  const files = [];
  for (const r of roots) {
    const dir = path.resolve(process.cwd(), r);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".cjs")) files.push(path.join(dir, f));
  }
  assert.ok(files.length >= 8, `expected the ops .cjs surface, found ${files.length}`);
  const all = files.flatMap((f) => lintSource(fs.readFileSync(f, "utf8"), f));
  // Deliberately NOT asserting zero — the lint enters CI non-blocking, and asserting a
  // clean surface here would make this test fail for reasons unrelated to the lint's
  // own correctness. Its non-vacuity is proven by the fixtures above.
  assert.ok(Array.isArray(all));
  if (all.length) console.log(formatFindings(all));
});
