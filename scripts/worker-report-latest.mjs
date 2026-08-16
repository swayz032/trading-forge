#!/usr/bin/env node
/**
 * WORKER REPORT DISCOVERY — AR-1274 §6 / §9D.
 *
 * WHY THIS EXISTS
 *   Worker reports were expected on the GPT branch under `advisor-reports/`, but the bound
 *   Worker-1 edit scope does not permit that path or that branch. So AR-1272 landed under
 *   `docs/replay-results/` on the worker branch, and the operator was left as the relay.
 *   AR-1274 §6 forbids that: "Do not solve this by asking Tonio to copy/paste or relay reports."
 *
 *   This establishes the canonical landing location INSIDE the governed write scope and makes
 *   the newest report discoverable mechanically, so no human carries a file between branches.
 *
 * WHAT IT IS NOT
 *   Not a publisher, not a branch-crossing tool, and not a second authority on where reports
 *   live. It only ANSWERS "which worker report is newest, and where is it". The GPT branch
 *   remains the home of GPT rulings; the worker does not need write access there to report.
 *
 * ⚠ SORTING IS NUMERIC, DELIBERATELY.
 *   Lexical sort ranks `AR-999` ABOVE `AR-1275` because '9' > '1'. That is not a hypothetical:
 *   this campaign is past AR-1200, so every future comparison against a 3-digit AR would pick
 *   the wrong file while looking perfectly sorted. The AR number is parsed as an integer and
 *   compared as one. A test fixture asserts exactly this case.
 *
 * Usage:
 *   node scripts/worker-report-latest.mjs            # newest report path (exit 0), or refuse (exit 1)
 *   node scripts/worker-report-latest.mjs --json     # machine-readable receipt
 *   node scripts/worker-report-latest.mjs --list     # every discovered report, newest first
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Canonical landing directory, relative to the repo root. Single source of truth. */
export const WORKER_REPORT_DIR = 'docs/replay-results/worker-advisor-reports';

/** `AR-<number>-<slug>.md`. README.md and anything not AR-shaped are ignored by construction. */
const AR_FILE = /^AR-(\d+)[-.].*\.md$/i;

/**
 * Parse a directory listing into reports, newest first.
 * Pure: takes names, returns rows. Kept separate from I/O so it can be tested without a tree.
 */
export function rankReports(names) {
  return names
    .map((name) => {
      const m = AR_FILE.exec(name);
      return m ? { name, ar: Number.parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    // Numeric descending. Tie-break by name so the order is total and therefore reproducible.
    .sort((a, b) => (b.ar - a.ar) || a.name.localeCompare(b.name));
}

function repoRoot() {
  // Resolve from this file's own location (scripts/ -> repo root) rather than cwd. A tool that
  // depends on the caller's cwd reports a different answer depending on where it was invoked,
  // which is how a discovery contract quietly stops being a contract.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function discover(root = repoRoot()) {
  const dir = path.join(root, WORKER_REPORT_DIR);
  if (!fs.existsSync(dir)) {
    return { ok: false, reason: `canonical worker-report directory absent: ${WORKER_REPORT_DIR}`, dir, reports: [] };
  }
  const reports = rankReports(fs.readdirSync(dir));
  if (reports.length === 0) {
    return { ok: false, reason: `no AR-shaped worker reports in ${WORKER_REPORT_DIR}`, dir, reports: [] };
  }
  return {
    ok: true,
    dir,
    latest: path.posix.join(WORKER_REPORT_DIR, reports[0].name),
    latest_ar: reports[0].ar,
    reports: reports.map((r) => path.posix.join(WORKER_REPORT_DIR, r.name)),
  };
}

// Only run as a CLI when invoked directly, so importing this module in a test is side-effect free.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = discover();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.ok) {
    // Refuse loudly. An empty stdout with exit 0 would read as "no reports and that's fine",
    // which is the false-green shape this campaign keeps convicting.
    console.error(`WORKER REPORT DISCOVERY REFUSED: ${result.reason}`);
  } else if (process.argv.includes('--list')) {
    for (const r of result.reports) console.log(r);
  } else {
    console.log(result.latest);
  }
  process.exit(result.ok ? 0 : 1);
}
