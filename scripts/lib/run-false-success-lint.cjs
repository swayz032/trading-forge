#!/usr/bin/env node
// scripts/lib/run-false-success-lint.cjs — CI entrypoint for the false-success lint.
//
// NON-BLOCKING by default (OR-086): it reports and exits 0 unless --strict is passed.
// Promote to --strict in CI only once the whole ops surface has run clean for a while.
// Exiting non-zero on day one would make the fence's first act be blocking the lane it
// was built to protect, and a guard that lands as an obstacle gets disabled, not fixed.
"use strict";
const fs = require("fs");
const path = require("path");
const { lintSource, formatFindings } = require("./false-success-lint.cjs");

const ROOTS = ["scripts/lib", "scripts/rails", "scripts/soak", "scripts/watchdog"];
const strict = process.argv.includes("--strict");

const files = [];
for (const r of ROOTS) {
  const dir = path.resolve(process.cwd(), r);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".cjs") || f.endsWith(".mjs")) files.push(path.join(r, f));
}

const findings = files.flatMap((f) => lintSource(fs.readFileSync(path.resolve(process.cwd(), f), "utf8"), f));
console.log(`false-success lint: ${files.length} ops files scanned`);
console.log(formatFindings(findings));

// The surface count is printed so a lint that silently scans NOTHING is distinguishable
// from a lint that scans everything and finds nothing — the vacuity failure this whole
// campaign keeps meeting.
if (files.length === 0) {
  console.error("false-success lint: scanned ZERO files — the surface is wrong, not clean");
  process.exitCode = 1;
} else if (strict && findings.length > 0) {
  process.exitCode = 1;
}
