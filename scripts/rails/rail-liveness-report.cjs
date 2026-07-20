// scripts/rails/rail-liveness-report.cjs — THE WIRING for scripts/lib/skip-streak.cjs.
//
// skip-streak.cjs has been correct, tested and CALLED BY NOTHING since it was built
// (F-2, disclosed in its own header). An unwired dormancy detector is the joke it
// exists to prevent. This is its production caller.
//
// It reads the rails' own JSONL ledgers — never the scheduler's LastResult, which
// cannot tell a run from a skip because both exit 0 — turns them into the
// {outcome, reason} shape skip-streak expects, and posts one line per alerting rail.
//
// Read-only over the ledgers. Zero instrument code. Writes one JSONL row of its own so
// that IT is not the next thing that runs silently forever.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadEnvironment, postDiscord } = require("./rail-runtime.cjs");
const { guardRailMain } = require("../lib/rail-crash-handler.cjs");
const { evaluateRailLiveness, formatLivenessLine, THRESHOLDS_V1 } = require("../lib/skip-streak.cjs");

const DEFAULT_WINDOW_DAYS = 10;

// ── Ledger shapes differ per rail; each says "ran"/"skip" its own way. ────────
// Deliberately NOT unified upstream: rewriting historical rows to a common shape
// would edit the evidence this report exists to read.
const RAILS = [
  {
    rail: "soak",
    dir: (root) => path.join(root, "data", "soak"),
    file: (d) => `soak-${d.replace(/-/g, "")}.jsonl`,
    classify: (row) => (row.type === "skip" ? { outcome: "skip", reason: row.reason } : { outcome: "ran" }),
  },
  {
    rail: "cert-rig",
    dir: (root) => path.join(root, "data", "rails"),
    file: (d) => `cert-${d}.jsonl`,
    classify: (row) => (row.skipped ? { outcome: "skip", reason: row.reason } : { outcome: "ran" }),
  },
  {
    rail: "full-lane",
    dir: (root) => path.join(root, "data", "rails"),
    file: (d) => `full-lane-${d}.jsonl`,
    classify: (row) =>
      row.verdict === "skipped" || row.skipped
        ? { outcome: "skip", reason: row.reason }
        : row.crashed
          ? { outcome: "crash", reason: row.reason }
          : { outcome: "ran" },
  },
];

/** Last `days` dates ending at `endDate` (YYYY-MM-DD), ASCENDING. */
function windowDates(endDate, days) {
  const out = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The window of COMPLETED scheduled cycles, ending YESTERDAY.
 *
 * ★ Caught on this reporter's first witnessed live run. Including TODAY made every
 * rail whose fire is still ahead of it (full-lane at 22:00) look silent, so the very
 * first real invocation raised a 🔴 "the last 2 runs left NO record" on a rail whose
 * only genuine miss was one night. With silentFiresN=2, one real miss plus today's
 * not-yet-fired slot alerts EVERY DAY — and an alert that cries wolf daily is worse
 * than no alert, because it trains the operator to ignore the one that matters.
 *
 * Ending at yesterday costs up to ~24h of detection latency and buys zero false
 * positives, without this report needing to know each rail's schedule. For a nightly
 * liveness digest that is the right trade, and it is stated rather than assumed.
 */
function completedWindow(todayIso, days) {
  const yesterday = new Date(`${todayIso}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return windowDates(yesterday.toISOString().slice(0, 10), days);
}

/**
 * Read one rail's ledgers into {date: {outcome, reason}}.
 * A date with NO FILE is left ABSENT, not defaulted — absence is the "fired and wrote
 * nothing" signal skip-streak treats as the worst case, and defaulting it to anything
 * would erase exactly the evidence the 07-18 incident was made of.
 */
function readRail(spec, root, dates, readFileFn = fs.readFileSync, existsFn = fs.existsSync) {
  const entries = {};
  for (const date of dates) {
    const p = path.join(spec.dir(root), spec.file(date));
    if (!existsFn(p)) continue;
    let text;
    try { text = readFileFn(p, "utf-8"); } catch { continue; }
    const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    // Last row wins: a rail may write a skip and later a real run on the same date.
    let last = null;
    for (const line of lines) { try { last = JSON.parse(line); } catch { /* keep prior */ } }
    if (last) entries[date] = spec.classify(last);
  }
  return entries;
}

/** Pure core: ledgers -> per-rail verdicts + the operator-facing lines. */
function buildLivenessReport({ rails, root, dates, readFileFn, existsFn, thresholds = THRESHOLDS_V1 }) {
  const results = rails.map((spec) =>
    evaluateRailLiveness({
      rail: spec.rail,
      expectedDates: dates,
      entriesByDate: readRail(spec, root, dates, readFileFn, existsFn),
      thresholds,
    }),
  );
  const lines = results.map(formatLivenessLine).filter(Boolean);
  return { results, lines, alerting: results.filter((r) => r.alert).map((r) => r.rail) };
}

function writeJsonl(payload, root) {
  const dir = path.join(root, "data", "rails");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, `liveness-${new Date().toISOString().slice(0, 10)}.jsonl`),
    JSON.stringify(payload) + "\n",
  );
}

async function main() {
  loadEnvironment(process.cwd());
  const root = process.cwd();
  const dryRun = process.argv.includes("--dry-run");
  const days = Number(process.env.RAILS_LIVENESS_WINDOW_DAYS || DEFAULT_WINDOW_DAYS);
  const dates = completedWindow(new Date().toISOString().slice(0, 10), days);

  const report = buildLivenessReport({ rails: RAILS, root, dates });
  const payload = {
    tMs: Date.now(),
    windowDays: days,
    thresholds: THRESHOLDS_V1.version,
    alerting: report.alerting,
    results: report.results,
  };
  writeJsonl(payload, root);

  for (const line of report.lines) console.log(line);
  if (report.lines.length === 0) console.log("all rails measuring (or within threshold) — nothing to say");

  if (!dryRun && report.lines.length > 0) {
    const header = "**Rail liveness** — a rail that keeps standing aside is not a rail that works.";
    const res = await postDiscord([header, ...report.lines].join("\n"));
    // postDiscord RETURNS {ok:false}; it does not throw. Reading only the absence of an
    // exception here was the exact crash-handler defect (F-1) — do not repeat it.
    if (res && res.ok === false) {
      console.error("liveness alert NOT delivered:", res.reason || "unknown");
      process.exitCode = 1;
      return;
    }
  }
  // Exit 0 whether or not rails are alerting: this job's own success is "I looked and
  // I reported". A non-zero here would make the reporter's health indistinguishable
  // from the rails' health — the conflation this whole unit exists to remove.
  process.exitCode = 0;
}

if (require.main === module) {
  main().catch(guardRailMain({ rail: "liveness", writeLedgerFn: (p) => writeJsonl(p, process.cwd()), notifyFn: postDiscord }));
}
module.exports = { buildLivenessReport, readRail, windowDates, completedWindow, RAILS, DEFAULT_WINDOW_DAYS };
