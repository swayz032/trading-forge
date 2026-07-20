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
//
// ★ CONSTRAINT (MINOR-3, third pass): "has this rail EVER written" is backed entirely by
// files under data/rails + data/soak, which are GITIGNORED and unbacked. A clean re-clone,
// a disk restore, or any future retention/rotation job resets every dead rail to
// `never_seen` -> permanently silent, reinstating the exact hole NEW-1 closed. No such job
// exists today (verified: nothing under scripts/ or src/ prunes those directories).
// Treat data/rails and data/soak as APPEND-ONLY, and if retention is ever added it must
// persist a first-seen watermark instead of deleting the evidence of a rail's existence.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadEnvironment, postDiscord, reportEnvLoad } = require("./rail-runtime.cjs");
const { guardRailMain } = require("../lib/rail-crash-handler.cjs");
const { evaluateRailLiveness, formatLivenessLine, THRESHOLDS_V1 } = require("../lib/skip-streak.cjs");

const DEFAULT_WINDOW_DAYS = 10;

// ── Ledger shapes differ per rail; each says "ran"/"skip" its own way. ────────
// Deliberately NOT unified upstream: rewriting historical rows to a common shape
// would edit the evidence this report exists to read.
const RAILS = [
  {
    rail: "soak",
    prefix: "soak-",
    dir: (root) => path.join(root, "data", "soak"),
    file: (d) => `soak-${d.replace(/-/g, "")}.jsonl`,
    // soak-watcher writes {type:"crash"}; cert/full write {crashed:true} via guardRailMain.
    // Classifying a crash as "ran" RESETS the streak — a rail crash-looping nightly would
    // never alert, which is worse than absence (absence at least escalates). Grader F-3.
    classify: (row) =>
      row.type === "crash" || row.crashed
        ? { outcome: "crash", reason: row.reason }
        : row.type === "skip"
          ? { outcome: "skip", reason: row.reason }
          : { outcome: "ran" },
  },
  {
    rail: "cert-rig",
    prefix: "cert-",
    dir: (root) => path.join(root, "data", "rails"),
    file: (d) => `cert-${d}.jsonl`,
    classify: (row) =>
      row.crashed
        ? { outcome: "crash", reason: row.reason }
        : row.skipped
          ? { outcome: "skip", reason: row.reason }
          : { outcome: "ran" },
  },
  {
    rail: "full-lane",
    prefix: "full-lane-",
    dir: (root) => path.join(root, "data", "rails"),
    file: (d) => `full-lane-${d}.jsonl`,
    classify: (row) =>
      row.verdict === "skipped" || row.skipped
        ? { outcome: "skip", reason: row.reason }
        : row.crashed
          ? { outcome: "crash", reason: row.reason }
          : { outcome: "ran" },
  },
  {
    // ★ Grader F-4. The reporter wrote its own ledger row and claimed that meant it
    // "cannot become the next thing that runs silently forever" — but NOTHING READ IT.
    // Writing a row no one reads detects nothing; the claim was the same shape as the
    // decorative-green this campaign keeps finding. It now watches itself.
    rail: "liveness",
    prefix: "liveness-",
    dir: (root) => path.join(root, "data", "rails"),
    file: (d) => `liveness-${d}.jsonl`,
    classify: (row) => (row.crashed ? { outcome: "crash", reason: row.reason } : { outcome: "ran" }),
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
    // Only a parsed OBJECT may replace the running value. A trailing `null`/`false`/`0`
    // line would otherwise blank a real row, turning a present ledger into ABSENCE —
    // which skip-streak escalates to crash_suspect. Grader F-7.
    let last = null;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) last = parsed;
      } catch { /* keep prior */ }
    }
    if (last) entries[date] = spec.classify(last);
  }
  return entries;
}

/**
 * Has this rail EVER written a ledger, at any time — not just inside the rolling window?
 *
 * ★ NEW-1 (re-grader, 2026-07-20). `never_seen` was decided by "no entries in the window",
 * which meant a genuinely DEAD rail alerted red for exactly `windowDays` and then went
 * PERMANENTLY SILENT the moment its last ledger file aged out — silent at precisely the
 * point it had been dead longest. I had asserted the opposite in a comment ("one
 * observation anywhere in the window is enough ... cannot swallow a real death"); the
 * re-grader disproved it by walking the clock forward, and my own test had placed its
 * single observation on the OLDEST day in the window — one day from proving the reverse.
 *
 * The charter is 30+ days unattended. A rail dying on day 1 of a vacation was silent by
 * day 11 and stayed silent: the reporter built to stop things running silently forever,
 * acquiring that exact property.
 *
 * "Ever written" is window-INDEPENDENT, so a rail that has lived cannot return to
 * never-seen. Cheap: one directory listing per rail.
 */
function ledgerDates(spec, root, listDirFn = fs.readdirSync) {
  try {
    return listDirFn(spec.dir(root))
      .filter((f) => f.startsWith(spec.prefix) && f.endsWith(".jsonl"))
      // soak files are YYYYMMDD, the rest YYYY-MM-DD — normalise to a comparable key.
      .map((f) => f.slice(spec.prefix.length, -".jsonl".length).replace(/-/g, ""))
      .filter((d) => /^\d{8}$/.test(d));
  } catch {
    // ★ MINOR-1 (third pass): this used to return [] — indistinguishable from "no files".
    // With an empty window that produced never_seen/alert:false, i.e. a genuinely dead rail
    // could go QUIET because we could not read its directory. The old comment claimed this
    // was "yielding to ignorance, not to silence"; at the output they were the same thing.
    // null now means UNREADABLE and gets its own alerting state.
    return null;
  }
}

/**
 * Has this rail written a ledger ON OR BEFORE the window's end?
 *
 * ★ Caught on the witnessed run of the NEW-1 fix itself — my THIRD false positive from
 * this alarm. Making `everWrote` window-independent fixed the "dead rail goes quiet after
 * 10 days" hole and immediately opened its mirror image: the liveness rail had written
 * exactly one ledger, TODAY, and the completed window ends YESTERDAY. So it had "ever
 * written" but nothing in-window, and reported 🔴 dead — while actively running.
 *
 * A file dated AFTER the window is evidence of LIFE, not death; the window simply has not
 * caught up. Only a ledger at or before the window end can make in-window silence mean
 * something. Three distinct states, and each needs its own answer:
 *   wrote before/inside the window, silent inside  -> genuinely dead   -> ALERT
 *   wrote only after the window (i.e. today)       -> newly active     -> quiet
 *   never wrote at all                             -> never activated  -> quiet
 */
function everWrote(spec, root, listDirFn = fs.readdirSync, windowEnd) {
  const end = String(windowEnd || "").replace(/-/g, "");
  const dates = ledgerDates(spec, root, listDirFn);
  if (dates === null) return null;            // unreadable — caller must not read this as "no"
  if (!end) return dates.length > 0;
  return dates.some((d) => d <= end);
}

/** Pure core: ledgers -> per-rail verdicts + the operator-facing lines. */
function buildLivenessReport({ rails, root, dates, readFileFn, existsFn, listDirFn, thresholds = THRESHOLDS_V1 }) {
  const results = rails.map((spec) => {
    const entriesByDate = readRail(spec, root, dates, readFileFn, existsFn);

    // ★ NEVER-SEEN is not CRASHED. Caught on the second witnessed live run: the moment the
    // reporter began watching ITSELF (F-4), it reported itself 🔴 "the last 10 scheduled runs
    // left NO record at all" — because it has never been scheduled at all. True, and useless.
    //
    // crash_suspect means "it used to write and then stopped", which requires having seen it
    // write at least once. A rail with zero entries across the whole window has never been
    // observed, and every newly-added rail would otherwise alert red from the day it is added
    // — teaching the operator that this report's red means "ignore me".
    //
    // It is still REPORTED in the payload, just not alerted on, so a rail that is never
    // activated cannot hide behind silence either.
    const ever = everWrote(spec, root, listDirFn, dates[dates.length - 1]);
    if (Object.keys(entriesByDate).length === 0 && ever === null) {
      // We cannot tell whether this rail ever lived. That is not evidence of youth.
      return {
        rail: spec.rail, alert: true, kind: "ledger_unreadable", streak: 0,
        silentFires: dates.length, reasons: {}, thresholds: thresholds.version,
      };
    }
    if (Object.keys(entriesByDate).length === 0 && ever === false) {
      return {
        rail: spec.rail, alert: false, kind: "never_seen", streak: 0,
        silentFires: dates.length, reasons: {}, thresholds: thresholds.version,
      };
    }

    return evaluateRailLiveness({ rail: spec.rail, expectedDates: dates, entriesByDate, thresholds });
  });
  const lines = results
    .map((r) =>
      r.kind === "ledger_unreadable"
        ? `🔴 ${r.rail}: its ledger folder could not be read, so we cannot tell whether it is running. Treat as unverified, not as fine.`
        : formatLivenessLine(r),
    )
    .filter(Boolean);
  return {
    results,
    lines,
    alerting: results.filter((r) => r.alert).map((r) => r.rail),
    neverSeen: results.filter((r) => r.kind === "never_seen").map((r) => r.rail),
  };
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
  // Report WHICH .env this rail loaded — the affordance the resolver returns it for.
  reportEnvLoad(loadEnvironment(process.cwd()), "liveness");
  const root = process.cwd();
  const dryRun = process.argv.includes("--dry-run");
  // ★ MINOR-2 (third pass): days ∈ {0, 1, NaN} makes crash_suspect STRUCTURALLY unreachable
  // (silentFiresN is 2), so a typo'd env value would leave the reporter running, exiting 0,
  // printing "all rails measuring", and detecting nothing. A config typo must not be able
  // to silently disable the alarm — clamp to a floor that keeps every threshold reachable.
  const rawDays = Number(process.env.RAILS_LIVENESS_WINDOW_DAYS || DEFAULT_WINDOW_DAYS);
  const days = Number.isFinite(rawDays) && rawDays >= 3 ? Math.floor(rawDays) : DEFAULT_WINDOW_DAYS;
  if (days !== rawDays) {
    console.error(`RAILS_LIVENESS_WINDOW_DAYS=${process.env.RAILS_LIVENESS_WINDOW_DAYS} unusable (min 3) — using ${days}`);
  }
  const dates = completedWindow(new Date().toISOString().slice(0, 10), days);

  const report = buildLivenessReport({ rails: RAILS, root, dates });
  const payload = {
    tMs: Date.now(),
    windowDays: days,
    thresholds: THRESHOLDS_V1.version,
    alerting: report.alerting,
    neverSeen: report.neverSeen,
    results: report.results,
  };
  writeJsonl(payload, root);

  for (const line of report.lines) console.log(line);
  if (report.lines.length === 0) console.log("all rails measuring (or within threshold) — nothing to say");
  // Surfaced on stdout + in the row, but never as an alert (see never_seen above).
  if (report.neverSeen.length > 0) {
    console.log(`not yet activated (no ledger history, not alerting): ${report.neverSeen.join(", ")}`);
  }

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
module.exports = { buildLivenessReport, readRail, everWrote, ledgerDates, windowDates, completedWindow, RAILS, DEFAULT_WINDOW_DAYS };
