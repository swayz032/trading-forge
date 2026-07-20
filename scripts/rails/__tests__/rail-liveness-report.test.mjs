// scripts/rails/__tests__/rail-liveness-report.test.mjs
//
// Locks the WIRING that finally gives skip-streak.cjs a production caller.
// The core is pure + DI'd (readFileFn/existsFn injected), so these run against
// synthetic ledgers with no filesystem and no clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLivenessReport, readRail, windowDates, completedWindow, RAILS } from "../rail-liveness-report.cjs";

const soakSpec = RAILS.find((r) => r.rail === "soak");
const fullSpec = RAILS.find((r) => r.rail === "full-lane");

/** Fake FS from {filename: contents}. */
const fakeFs = (files) => ({
  existsFn: (p) => Object.keys(files).some((f) => p.endsWith(f)),
  readFileFn: (p) => {
    const k = Object.keys(files).find((f) => p.endsWith(f));
    if (k === undefined) throw new Error("ENOENT");
    return files[k];
  },
});

const skipRow = (reason) => JSON.stringify({ type: "skip", reason });
const ranRow = () => JSON.stringify({ type: "sample", nightIndex: 3 });

test("windowDates returns ascending dates ending at the given day", () => {
  assert.deepEqual(windowDates("2026-07-20", 3), ["2026-07-18", "2026-07-19", "2026-07-20"]);
});

test("★ the real-world case: 8 consecutive skips alerts as a skip streak", () => {
  // This is the shape actually found on disk 2026-07-20 — the soak had never run.
  const dates = windowDates("2026-07-20", 8);
  const files = Object.fromEntries(
    dates.map((d) => [`soak-${d.replace(/-/g, "")}.jsonl`, skipRow("python_workers_active")]),
  );
  const { readFileFn, existsFn } = fakeFs(files);
  const { results, lines, alerting } = buildLivenessReport({
    rails: [soakSpec], root: "/r", dates, readFileFn, existsFn,
  });
  assert.equal(results[0].alert, true);
  assert.equal(results[0].kind, "skip_streak");
  assert.equal(results[0].streak, 8);
  assert.deepEqual(alerting, ["soak"]);
  assert.match(lines[0], /hasn't actually measured anything in 8 nights/);
});

test("a real run BREAKS the streak — skipping is only a problem when it never ends", () => {
  const dates = windowDates("2026-07-20", 5);
  const files = Object.fromEntries(dates.map((d) => [`soak-${d.replace(/-/g, "")}.jsonl`, skipRow("gpu_busy")]));
  // most recent night actually ran
  files[`soak-${dates[dates.length - 1].replace(/-/g, "")}.jsonl`] = ranRow();
  const { readFileFn, existsFn } = fakeFs(files);
  const { results, lines } = buildLivenessReport({ rails: [soakSpec], root: "/r", dates, readFileFn, existsFn });
  assert.equal(results[0].streak, 0);
  assert.equal(results[0].alert, false);
  assert.deepEqual(lines, []);
});

test("skips below the threshold stay quiet — no cry-wolf on a normal busy stretch", () => {
  const dates = windowDates("2026-07-20", 4);
  const files = {};
  // only 2 trailing skips; threshold is 3
  files[`soak-${dates[2].replace(/-/g, "")}.jsonl`] = skipRow("gpu_busy");
  files[`soak-${dates[3].replace(/-/g, "")}.jsonl`] = skipRow("gpu_busy");
  files[`soak-${dates[0].replace(/-/g, "")}.jsonl`] = ranRow();
  files[`soak-${dates[1].replace(/-/g, "")}.jsonl`] = ranRow();
  const { readFileFn, existsFn } = fakeFs(files);
  assert.equal(buildLivenessReport({ rails: [soakSpec], root: "/r", dates, readFileFn, existsFn }).lines.length, 0);
});

test("★ MISSING ledgers are absent, not defaulted — silence outranks a skip streak", () => {
  // The 07-18 incident: the job fired and wrote NOTHING. That must not be readable as
  // "no skip", and must outrank a skip streak in priority.
  const dates = windowDates("2026-07-20", 6);
  const files = {};
  for (const d of dates.slice(0, 4)) files[`soak-${d.replace(/-/g, "")}.jsonl`] = skipRow("gpu_busy");
  // last two dates: no file at all
  const { readFileFn, existsFn } = fakeFs(files);
  const { results, lines } = buildLivenessReport({ rails: [soakSpec], root: "/r", dates, readFileFn, existsFn });
  assert.equal(results[0].silentFires, 2);
  assert.equal(results[0].kind, "crash_suspect");
  assert.match(lines[0], /left NO record at all/);
});

test("an empty ledger file is treated as absent, not as a run", () => {
  const dates = windowDates("2026-07-20", 3);
  const files = Object.fromEntries(dates.map((d) => [`soak-${d.replace(/-/g, "")}.jsonl`, "   \n\n"]));
  const { readFileFn, existsFn } = fakeFs(files);
  const r = buildLivenessReport({ rails: [soakSpec], root: "/r", dates, readFileFn, existsFn });
  assert.equal(r.results[0].silentFires, 3);
});

test("the LAST row of a day wins — a skip followed by a real run counts as ran", () => {
  const dates = windowDates("2026-07-20", 1);
  const d = dates[0].replace(/-/g, "");
  const { readFileFn, existsFn } = fakeFs({ [`soak-${d}.jsonl`]: `${skipRow("gpu_busy")}\n${ranRow()}` });
  const entries = readRail(soakSpec, "/r", dates, readFileFn, existsFn);
  assert.equal(entries[dates[0]].outcome, "ran");
});

test("a corrupt JSON line does not discard the day's valid rows", () => {
  const dates = windowDates("2026-07-20", 1);
  const d = dates[0].replace(/-/g, "");
  const { readFileFn, existsFn } = fakeFs({ [`soak-${d}.jsonl`]: `${skipRow("gpu_busy")}\n{not json` });
  const entries = readRail(soakSpec, "/r", dates, readFileFn, existsFn);
  assert.equal(entries[dates[0]].outcome, "skip");
});

test("full-lane's own ledger shape (verdict:skipped) is classified as a skip", () => {
  const dates = windowDates("2026-07-20", 3);
  const files = Object.fromEntries(
    dates.map((d) => [`full-lane-${d}.jsonl`, JSON.stringify({ verdict: "skipped", reason: "backtest_workers_active" })]),
  );
  const { readFileFn, existsFn } = fakeFs(files);
  const { results, lines } = buildLivenessReport({ rails: [fullSpec], root: "/r", dates, readFileFn, existsFn });
  assert.equal(results[0].kind, "skip_streak");
  assert.match(lines[0], /backtest workers running/);
});

test("a green run reports NOTHING — the alert must not become background noise", () => {
  const dates = windowDates("2026-07-20", 5);
  const files = Object.fromEntries(dates.map((d) => [`soak-${d.replace(/-/g, "")}.jsonl`, ranRow()]));
  const { readFileFn, existsFn } = fakeFs(files);
  const r = buildLivenessReport({ rails: [soakSpec], root: "/r", dates, readFileFn, existsFn });
  assert.deepEqual(r.lines, []);
  assert.deepEqual(r.alerting, []);
});

test("★ the window ENDS YESTERDAY — today's not-yet-fired slot must not read as silence", () => {
  // Caught on the first witnessed live run. full-lane fires at 22:00; a report run at
  // midday counted TODAY as a missing record, so one genuine miss plus today crossed
  // silentFiresN=2 and raised a red alert EVERY DAY. A daily false alarm trains the
  // operator to ignore the real one.
  const w = completedWindow("2026-07-20", 3);
  assert.deepEqual(w, ["2026-07-17", "2026-07-18", "2026-07-19"]);
  assert.ok(!w.includes("2026-07-20"), "today must never be an expected fire");
  assert.equal(w[w.length - 1], "2026-07-19", "yesterday IS the last completed cycle");
});

test("★ one genuinely missing night does NOT alert; two consecutive do", () => {
  // The real full-lane shape on 2026-07-20: 07-19 fired and wrote nothing, 07-18 has a
  // ledger. One miss is not yet a pattern; the threshold exists to say so.
  const dates = windowDates("2026-07-19", 4);
  const files = {};
  for (const d of dates.slice(0, 3)) files[`full-lane-${d}.jsonl`] = JSON.stringify({ verdict: "green" });
  const { readFileFn, existsFn } = fakeFs(files);
  const one = buildLivenessReport({ rails: [fullSpec], root: "/r", dates, readFileFn, existsFn });
  assert.equal(one.results[0].silentFires, 1);
  assert.deepEqual(one.lines, [], "a single missed night must stay quiet");

  const files2 = {};
  for (const d of dates.slice(0, 2)) files2[`full-lane-${d}.jsonl`] = JSON.stringify({ verdict: "green" });
  const fs2 = fakeFs(files2);
  const two = buildLivenessReport({ rails: [fullSpec], root: "/r", dates, readFileFn: fs2.readFileFn, existsFn: fs2.existsFn });
  assert.equal(two.results[0].silentFires, 2);
  assert.match(two.lines[0], /left NO record at all/);
});

const certSpec = RAILS.find((r) => r.rail === "cert-rig");

test("★ CRASH rows classify as crash, not ran — for EVERY rail (grader F-3)", () => {
  // soak-watcher writes {type:"crash"}; cert/full write {crashed:true} via guardRailMain.
  // Reading a crash as "ran" RESETS the streak, so a rail crash-looping nightly would
  // never alert — worse than absence, which at least escalates.
  const dates = windowDates("2026-07-19", 1);
  const d = dates[0];
  const cases = [
    [soakSpec, `soak-${d.replace(/-/g, "")}.jsonl`, JSON.stringify({ type: "crash", reason: "MODULE_NOT_FOUND" })],
    [certSpec, `cert-${d}.jsonl`, JSON.stringify({ crashed: true, reason: "MODULE_NOT_FOUND" })],
    [fullSpec, `full-lane-${d}.jsonl`, JSON.stringify({ crashed: true, reason: "MODULE_NOT_FOUND" })],
  ];
  for (const [spec, file, body] of cases) {
    const { readFileFn, existsFn } = fakeFs({ [file]: body });
    const entries = readRail(spec, "/r", dates, readFileFn, existsFn);
    assert.equal(entries[d].outcome, "crash", `${spec.rail} misread a crash row as a run`);
  }
});

test("a nightly crash-loop ALERTS instead of resetting the streak", () => {
  const dates = windowDates("2026-07-19", 4);
  const files = Object.fromEntries(
    dates.map((d) => [`cert-${d}.jsonl`, JSON.stringify({ crashed: true, reason: "MODULE_NOT_FOUND" })]),
  );
  const { readFileFn, existsFn } = fakeFs(files);
  const r = buildLivenessReport({ rails: [certSpec], root: "/r", dates, readFileFn, existsFn });
  assert.equal(r.results[0].kind, "crashed");
  assert.match(r.lines[0], /crashed on its last run/);
});

test("★ the reporter WATCHES ITSELF — a written row nobody reads detects nothing (F-4)", () => {
  const liveness = RAILS.find((r) => r.rail === "liveness");
  assert.ok(liveness, "the liveness rail must be in RAILS or its own silence is invisible");
  const dates = windowDates("2026-07-19", 4);
  // It ran, then stopped. That is the case its self-watch exists for — and it needs at
  // least one observation to distinguish "died" from "never activated" (never_seen, below).
  const files = { [`liveness-${dates[0]}.jsonl`]: JSON.stringify({ alerting: [], results: [] }) };
  const { readFileFn, existsFn } = fakeFs(files);
  const r = buildLivenessReport({ rails: [liveness], root: "/r", dates, readFileFn, existsFn });
  assert.equal(r.results[0].kind, "crash_suspect");
  assert.equal(r.results[0].alert, true);
});

test("★ a trailing falsy JSON line must NOT erase a real row into absence (F-7)", () => {
  const dates = windowDates("2026-07-19", 1);
  const d = dates[0].replace(/-/g, "");
  for (const trailer of ["null", "false", "0", '""', "[1,2]"]) {
    const { readFileFn, existsFn } = fakeFs({ [`soak-${d}.jsonl`]: `${skipRow("gpu_busy")}
${trailer}` });
    const entries = readRail(soakSpec, "/r", dates, readFileFn, existsFn);
    assert.equal(entries[dates[0]] && entries[dates[0]].outcome, "skip", `trailer ${trailer} blanked the row`);
  }
});

test("★ NEVER-SEEN is not CRASHED — a not-yet-activated rail must not alert red", () => {
  // The reporter's own second witnessed run flagged ITSELF crash_suspect because it has
  // never been scheduled. Every newly-added rail would alert from day one, teaching the
  // operator that red means "ignore me".
  const dates = windowDates("2026-07-19", 10);
  const { readFileFn, existsFn } = fakeFs({});
  const r = buildLivenessReport({ rails: [soakSpec], root: "/r", dates, readFileFn, existsFn });
  assert.equal(r.results[0].kind, "never_seen");
  assert.equal(r.results[0].alert, false);
  assert.deepEqual(r.lines, []);
  assert.deepEqual(r.neverSeen, ["soak"]);
});

test("but a rail that HAS written and then went silent still alerts red", () => {
  // The discriminator: one observation anywhere in the window is enough to make later
  // silence meaningful. Without this the never_seen rule would swallow real deaths.
  const dates = windowDates("2026-07-19", 6);
  const files = { [`soak-${dates[0].replace(/-/g, "")}.jsonl`]: ranRow() };
  const { readFileFn, existsFn } = fakeFs(files);
  const r = buildLivenessReport({ rails: [soakSpec], root: "/r", dates, readFileFn, existsFn });
  assert.equal(r.results[0].kind, "crash_suspect");
  assert.equal(r.results[0].alert, true);
  assert.deepEqual(r.neverSeen, []);
});
