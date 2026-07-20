// scripts/lib/__tests__/skip-streak.test.mjs
// Skip-streak / crash-suspect visibility (OR-008 §3, pulled forward; built per OR-012 §3a).
//
// WHY: on 2026-07-19 rail 2 was verdicted HEALTHY AND FULLY BLOCKED — the idle guard correctly
// skipping every night (battery busy, then services paused) while the soak had NEVER measured a
// single night (nightIndex 0). From outside, "correctly skipping forever" and "dormant" look
// identical. Separately, the 07-18 dependency erosion made three jobs write NOTHING for 36h.
// Both states must announce themselves. Skip-by-design is healthy; skip-forever-in-silence is
// dormancy wearing a green coat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { THRESHOLDS_V1, evaluateRailLiveness, formatLivenessLine } from "../skip-streak.cjs";

// entries are keyed by the scheduled fire date; absence = the job fired and wrote nothing.
const ran = (date) => [date, { outcome: "ran", reason: null }];
const skip = (date, reason) => [date, { outcome: "skip", reason }];
const crash = (date) => [date, { outcome: "crash", reason: "crashed" }];

const dates = (...d) => d;

test("thresholds are versioned and frozen (anti-goalpost)", () => {
  assert.equal(THRESHOLDS_V1.version, "rails_thresholds_v1");
  assert.equal(THRESHOLDS_V1.skipStreakN, 3);
  assert.equal(THRESHOLDS_V1.silentFiresN, 2);
});

test("a healthy run streak alerts on nothing", () => {
  const r = evaluateRailLiveness({
    rail: "cert",
    expectedDates: dates("2026-07-16", "2026-07-17", "2026-07-18"),
    entriesByDate: Object.fromEntries([ran("2026-07-16"), ran("2026-07-17"), ran("2026-07-18")]),
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(r.alert, false);
  assert.equal(r.kind, null);
});

test("skips BELOW the threshold do not alert (skip-by-design is healthy)", () => {
  const r = evaluateRailLiveness({
    rail: "cert",
    expectedDates: dates("2026-07-16", "2026-07-17", "2026-07-18"),
    entriesByDate: Object.fromEntries([ran("2026-07-16"), skip("2026-07-17", "python_workers_active"), skip("2026-07-18", "python_workers_active")]),
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(r.alert, false, "2 skips must not alert at N=3");
  assert.equal(r.streak, 2);
});

test("N consecutive skips alert, with a reasons breakdown", () => {
  const r = evaluateRailLiveness({
    rail: "cert",
    expectedDates: dates("2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"),
    entriesByDate: Object.fromEntries([
      ran("2026-07-15"),
      skip("2026-07-16", "python_workers_active"),
      skip("2026-07-17", "backend_unreachable"),
      skip("2026-07-18", "backend_unreachable"),
    ]),
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(r.alert, true);
  assert.equal(r.kind, "skip_streak");
  assert.equal(r.streak, 3);
  assert.deepEqual(r.reasons, { backend_unreachable: 2, python_workers_active: 1 });
});

test("the streak counts back from the MOST RECENT fire and stops at a real run", () => {
  const r = evaluateRailLiveness({
    rail: "soak",
    expectedDates: dates("2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"),
    entriesByDate: Object.fromEntries([
      skip("2026-07-14", "python_workers_active"),
      skip("2026-07-15", "python_workers_active"),
      ran("2026-07-16"),                                  // <- breaks the streak
      skip("2026-07-17", "python_workers_active"),
      skip("2026-07-18", "python_workers_active"),
    ]),
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(r.streak, 2, "only the trailing skips count");
  assert.equal(r.alert, false);
});

// ── The crash-suspect complement (belt to the new crash handlers). ──
test("consecutive fires that wrote NOTHING are crash-suspect", () => {
  const r = evaluateRailLiveness({
    rail: "cert",
    expectedDates: dates("2026-07-17", "2026-07-18", "2026-07-19"),
    entriesByDate: Object.fromEntries([ran("2026-07-17")]), // 07-18 and 07-19 wrote nothing
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(r.alert, true);
  assert.equal(r.kind, "crash_suspect");
  assert.equal(r.silentFires, 2);
});

test("crash_suspect OUTRANKS skip_streak — silence is worse than an honest skip", () => {
  const r = evaluateRailLiveness({
    rail: "cert",
    expectedDates: dates("2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"),
    entriesByDate: Object.fromEntries([
      skip("2026-07-15", "python_workers_active"),
      skip("2026-07-16", "python_workers_active"),
      skip("2026-07-17", "python_workers_active"),
    ]), // then two silent fires
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(r.kind, "crash_suspect");
});

test("an explicit crash row is NOT silence — it reports as crash, not crash_suspect", () => {
  const r = evaluateRailLiveness({
    rail: "soak",
    expectedDates: dates("2026-07-18", "2026-07-19"),
    entriesByDate: Object.fromEntries([crash("2026-07-18"), crash("2026-07-19")]),
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(r.alert, true);
  assert.equal(r.kind, "crashed", "a written crash row is the handler WORKING — distinct from silence");
  assert.equal(r.silentFires, 0);
});

test("one silent fire below threshold does not alert", () => {
  const r = evaluateRailLiveness({
    rail: "cert",
    expectedDates: dates("2026-07-18", "2026-07-19"),
    entriesByDate: Object.fromEntries([ran("2026-07-18")]),
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(r.alert, false);
  assert.equal(r.silentFires, 1);
});

test("no expected fires yet → never alerts (a rail that has not been scheduled is not dormant)", () => {
  const r = evaluateRailLiveness({ rail: "cert", expectedDates: [], entriesByDate: {}, thresholds: THRESHOLDS_V1 });
  assert.equal(r.alert, false);
  assert.equal(r.kind, null);
});

test("evaluateRailLiveness is PURE — same inputs, same output, no clock", () => {
  const args = {
    rail: "cert",
    expectedDates: dates("2026-07-17", "2026-07-18", "2026-07-19"),
    entriesByDate: Object.fromEntries([skip("2026-07-17", "x"), skip("2026-07-18", "x"), skip("2026-07-19", "x")]),
    thresholds: THRESHOLDS_V1,
  };
  assert.deepEqual(evaluateRailLiveness(args), evaluateRailLiveness(args));
});

// ── Plain-English output: the operator is non-technical for stats. ──
test("the skip-streak line is plain English and names the streak + reasons", () => {
  const r = evaluateRailLiveness({
    rail: "cert",
    expectedDates: dates("2026-07-16", "2026-07-17", "2026-07-18"),
    entriesByDate: Object.fromEntries([
      skip("2026-07-16", "python_workers_active"),
      skip("2026-07-17", "backend_unreachable"),
      skip("2026-07-18", "backend_unreachable"),
    ]),
    thresholds: THRESHOLDS_V1,
  });
  const line = formatLivenessLine(r);
  assert.match(line, /cert/i);
  assert.match(line, /3 night/i, "must state the streak length");
  assert.match(line, /tower busy|backend|paused/i, "must translate the reason codes");
  assert.ok(!/python_workers_active/.test(line), "raw reason codes must be translated, not dumped");
});

test("the crash-suspect line says something is WRONG, not merely blocked", () => {
  const r = evaluateRailLiveness({
    rail: "soak",
    expectedDates: dates("2026-07-18", "2026-07-19"),
    entriesByDate: {},
    thresholds: THRESHOLDS_V1,
  });
  const line = formatLivenessLine(r);
  assert.match(line, /nothing|no record|silent/i);
  assert.match(line, /soak/i);
});

test("formatLivenessLine returns null when there is nothing to say", () => {
  const r = evaluateRailLiveness({
    rail: "cert",
    expectedDates: dates("2026-07-18"),
    entriesByDate: Object.fromEntries([ran("2026-07-18")]),
    thresholds: THRESHOLDS_V1,
  });
  assert.equal(formatLivenessLine(r), null);
});
