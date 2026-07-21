// scripts/ops/verify-env-manifest.cjs — cross-check the manifest's DECLARED classes against
// what the CODE actually does, and FAIL on disagreement.
//
// ★★ WHY THIS EXISTS — it is the answer to leg-2's declared limit. There, receipt content was
// "asserted, not verified": the schema enforced that a drilled leg CARRIED a receipt but never
// opened it. That limit was honest but real. Here the equivalent claim — "this var has a
// working default" / "this var silently degrades" — IS mechanically checkable, so it is CHECKED.
// A manifest that cannot go stale without going red is worth more than one that is merely
// well-written today.
//
// ★ WHAT IT ADJUDICATES — exactly ONE property, in BOTH directions:
//   the OPTIONAL_DEGRADING signal, detected as an EMPTY-STRING default (`?? ""`, `.get(X,"")`).
//   That shape is syntactically a fallback and semantically a failure: it satisfies every naive
//   "does it have a default?" check while yielding a broken value. It is how AWS creds produce a
//   box that boots healthy and is silently S3-blind.
//     (a) declared OPTIONAL_DEGRADING  -> an empty-default site must exist, else FAIL
//     (b) ★ an empty-default site exists -> OPTIONAL_DEGRADING must be declared, else FAIL
//   Direction (b) is the one that protects the operator: it catches silent degradation that
//   nobody declared.
//
// ★ WHAT IT DOES NOT ADJUDICATE — REQUIRED vs OPTIONAL_FALLBACK. See the long note above
//   `deriveClasses`: cross-line guards make "bare read" undecidable line-locally. Those classes
//   are HUMAN-declared and the tool reports site counts as INFORMATIONAL context only.
//   This narrowing was made AFTER the broader version produced false FAILs on the AWS pair —
//   the claim was narrowed to what is sound, and the standard was not lowered: direction (b)
//   did not exist before and is strictly stronger.
//
// ★ DECLARED LIMITS (an undeclared limit is the same defect as an overclaiming guard):
//   1. STATIC ONLY — `env[v]` is invisible here. Entries marked `dynamicRead` are SKIPPED, and
//      the skip is REPORTED, never silently passed. RAILS_ENV_PATH is the live example.
//   2. A non-empty but WRONG default degrades silently and is NOT detectable. The empty-string
//      shape is the detectable SUBSET of silent degradation, not the whole class.
//   2b. ★ AND THE SIGNAL CUTS BOTH WAYS: an empty-string default is a CANDIDATE for silent
//      degradation, not proof of it. `process.env.PYTHONPATH ?? ""` (python-runner.ts:377) is
//      perfectly correct — an empty PYTHONPATH is a legitimate value, not a broken one. So the
//      detector has false positives as well as blind spots, which is exactly why the manifest is
//      HUMAN-declared and this tool only CROSS-CHECKS it. The tool never classifies unilaterally.
//   3. UNKNOWN IS NOT FAIL. A var this scan cannot find at all reports UNKNOWN — a checker that
//      cannot run must never condemn the box.
"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { VARS, CLASSES, validate } = require("./recovery-env-manifest.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["src", "scripts"];

// Exclusions. NOTE the Python convention `test_*.py` — omitting it silently inflated
// DATABASE_URL from 115 read sites to 171 during this build. A test-file filter is
// language-dependent, and getting it wrong contaminates the measurement.
const TEST_RE = /__tests__|\.test\.|\.spec\.|[\\/]test_|[\\/]tests?[\\/]|conftest/i;

// ★ F-2 — THE TOOL MUST NOT SCAN ITSELF. Its own comments quote read sites verbatim
// (`process.env.AWS_ACCESS_KEY_ID ?? ""`), and the manifest's `evidence:` strings quote them too.
// Measured before fixing: 2 PHANTOM sites per AWS var were ALREADY being counted — this was not
// merely latent. It failed to flip a verdict only because the real empty-default sites already
// dominated: inert by luck, which is not a safety property. A future comment edit could inject or
// remove a site and move a verdict with ZERO change to production code.
// An instrument must not be part of what it measures.
const SELF_RE = /verify-env-manifest\.cjs|recovery-env-manifest\.cjs/i;

function readSites(name, { runner = execFileSync, root = ROOT } = {}) {
  const pattern =
    `process\\.env\\.${name}\\b|process\\.env\\[["']${name}["']\\]|` +
    `os\\.environ\\.get\\(["']${name}["']|os\\.environ\\[["']${name}["']\\]`;
  let out = "";
  try {
    out = runner(
      "grep",
      ["-rnE", pattern, "--include=*.ts", "--include=*.js", "--include=*.cjs",
       "--include=*.mjs", "--include=*.py", "--exclude-dir=node_modules",
       "--exclude-dir=.venv", "--exclude-dir=.git", "--exclude-dir=dist", ...SCAN_DIRS],
      { cwd: root, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }
    );
  } catch (e) {
    // grep exits 1 on "no matches" — that is data, not an error. Any other code is a real
    // failure and must not be read as "zero sites" (the false-success class: a failure
    // arriving on a channel we would otherwise not read).
    if (e && e.status === 1) return [];
    throw new Error(`grep failed for ${name}: status=${e && e.status}`);
  }
  return out
    .split("\n")
    .filter((l) => l.trim())
    .filter((l) => !TEST_RE.test(l.split(":")[0]))
    .filter((l) => !SELF_RE.test(l.split(":")[0]));
}

// ★★ THE MODEL, and why the obvious one is WRONG.
//
// The first cut of this file returned ONE class per variable. Run live, it disagreed with the
// manifest on 3 of 9 vars — and inspecting the disagreements showed the MODEL was wrong, not
// merely the labels:
//   * DATABASE_URL has 107 bare sites AND 5 empty-string-default sites (incl.
//     boot-migration-runner.ts:1020, where the migration runner proceeds with an empty URL).
//     It is genuinely REQUIRED *and* genuinely silently-degrading. One label cannot say that.
//   * S3_BUCKET's two "bare" sites are a PRESENCE GUARD
//     (`process.env["S3_BUCKET"] && …` then `process.env["S3_BUCKET"]!`) — a feature gated on
//     the var being set. A bare read inside a guard is not a crash path, and calling it
//     REQUIRED would put a non-required var in the runbook: cry-wolf, the exact failure the
//     three-class design exists to prevent.
//
// So classification is PER-SITE, and a variable's operational meaning is the SET of site
// shapes it exhibits. Collapsing that to one label discards the dangerous minority — which is
// precisely the class (silent degradation) the manifest exists to surface. Relabelling the
// manifest to satisfy a single-label tool would have HIDDEN the 5 DATABASE_URL sites.
// When the model does not fit the data, change the model; do not edit the data to fit.

const SITE_SHAPES = Object.freeze({
  EMPTY_DEFAULT: /(\?\?|\|\|)\s*(""|'')|\.get\([^,]+,\s*(""|'')\s*\)/,
  GUARD: /if\s*\(\s*!?\s*(process\.env|os\.environ)|!\s*(process\.env|os\.environ)|(process\.env\[?["']?[A-Z_]+["']?\]?\s*&&)|\]!/,
  JS_DEFAULT: /(\?\?|\|\|)\s*[^\s;)]/,
  PY_DEFAULT: /\.get\([^,]+,\s*[^)]+\)/,
});

/** Shape of ONE read site. Order matters: guard before default, empty before working. */
function siteShape(line) {
  if (SITE_SHAPES.EMPTY_DEFAULT.test(line)) return "empty_default";
  if (SITE_SHAPES.GUARD.test(line)) return "guard";
  if (SITE_SHAPES.JS_DEFAULT.test(line) || SITE_SHAPES.PY_DEFAULT.test(line)) return "working_default";
  return "bare";
}

// ★★★ WHAT THIS TOOL WILL AND WILL NOT CLAIM — the narrowing that makes it SOUND.
//
// The class-set version above still FAILed the AWS credential pair, and the disagreement was
// the TOOL's fault this time, not the manifest's. `s3-client.ts:77` guards with
// `if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) { … }` and the
// bare use sits at line 85 — a guard protecting a read EIGHT LINES AWAY. Shape analysis is
// line-local, so it sees "bare" and infers REQUIRED. No regex fixes this: deciding whether a
// bare read crashes on absence needs dataflow, not pattern-matching.
//
// So this tool NARROWS ITS CLAIM to the thing it can actually decide:
//   ★ SCOPE OF THE DEGRADING CLAIM, narrowed 2026-07-20 after an independent grade:
//   this tool detects the INLINE-EMPTY-DEFAULT form of silent degradation (`?? ""`, `|| ""`).
//   It does NOT detect the BARE-READ + SEPARATE-LINE-SILENT-GUARD form
//   (`const u = process.env.X;` / `if (!u) return;`) — that is dataflow, not line-local shape.
//   DISCORD_WEBHOOK_URL, the system-wide notify() chokepoint, is exactly that form and the
//   independent grader found it where this tool structurally could not. Such entries are
//   `humanClassified: true`, adjudicated by a person and REPORTED as HUMAN, never silently passed.
//   The claim is therefore "governs the inline-empty-default class", not "governs silent
//   degradation" — the earlier, broader wording overreached.
//
//   ✔ VERIFIED — the OPTIONAL_DEGRADING signal. An empty-string default is a LINE-LOCAL,
//     unambiguous fact: that line proceeds with a broken value, no context required. Checked in
//     BOTH directions, and the second is the one that protects the operator:
//       (a) a var declared OPTIONAL_DEGRADING must actually have an empty-default site, and
//       (b) ★ any var WITH an empty-default site must be declared OPTIONAL_DEGRADING —
//           this is what catches silent degradation someone forgot to declare.
//   ✘ NOT VERIFIED — REQUIRED vs OPTIONAL_FALLBACK. Distinguishing them needs cross-line guard
//     analysis this tool does not do. Those classes are HUMAN-declared; bare/guard/default
//     counts are reported as INFORMATIONAL context for that human, never as a verdict.
//
// A guard may have finite reach; it may not CLAIM more reach than it has. A tool that verifies
// one property soundly beats one that adjudicates three and is wrong about two.

/**
 * Site distribution + the one class this tool is entitled to decide.
 * Returns null for UNKNOWN (no sites) — a checker that cannot run must not condemn.
 */
function deriveClasses(sites) {
  if (!sites.length) return null;
  const dist = { bare: 0, empty_default: 0, working_default: 0, guard: 0 };
  for (const s of sites) dist[siteShape(s)] += 1;
  // The ONLY derived assertion: does this var exhibit the silent-degradation signature?
  return { degrading: dist.empty_default > 0, dist };
}

// ★★ CLASS COVERAGE — the difference between governing 4 INSTANCES and governing the CLASS.
//
// Listing DISCORD_CH_* entries in the manifest checks those four variables. It does NOT stop a
// FIFTH alert channel being added tomorrow with `|| ""` and no manifest entry — which is the
// exact defect (empty-default + undeclared) that produced the finding in the first place. A
// manifest that only knows what it was told is an inventory, not a guard.
//
// So: scan the alert-routing surface for EVERY empty-string default and require each to be
// declared. Bounded on purpose — one named file, not the whole repo, because the repo-wide set
// includes legitimate empty defaults (`PYTHONPATH ?? ""`) and flagging those is the cry-wolf
// this design exists to prevent. Widening the surface is a deliberate edit here, not a drift.
const GOVERNED_SURFACES = [
  // NOTE the scope is the FILE, not just CHANNEL_MAP. An earlier version of this line said
  // "CHANNEL_MAP" while the scan read the whole file — a description that overstated its own
  // precision, which is the caption-is-a-claim defect in the tool's own metadata. It also
  // MATTERED: the whole-file scan is what surfaced SLUMDAWG_WEBHOOK_SECRET, an empty-default
  // outside CHANNEL_MAP that a CHANNEL_MAP-only scan would have missed.
  { file: "src/discord/bot.ts", why: "Discord bot — alert channel routing and webhook signing" },
];

function surfaceCoverage(vars = VARS, { runner = execFileSync, root = ROOT } = {}) {
  const declared = new Set(vars.map((v) => v.name));
  const gaps = [];
  for (const s of GOVERNED_SURFACES) {
    let out = "";
    try {
      out = runner("grep", ["-oE", 'process\\.env\\.[A-Z][A-Z0-9_]+ *(\\|\\||\\?\\?) *""', s.file],
        { cwd: root, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 });
    } catch (e) {
      if (e && e.status === 1) continue; // no empty-defaults in this file — fine
      throw new Error(`surface scan failed for ${s.file}: status=${e && e.status}`);
    }
    for (const line of out.split("\n")) {
      const m = line.match(/process\.env\.([A-Z][A-Z0-9_]+)/);
      if (m && !declared.has(m[1])) gaps.push({ name: m[1], file: s.file, why: s.why });
    }
  }
  return gaps;
}

function check(vars = VARS, opts = {}) {
  validate(vars);
  const rows = [];

  // Class-coverage gaps are reported as FAIL rows so they cannot be read past.
  for (const g of surfaceCoverage(vars, opts)) {
    rows.push({
      name: g.name, declared: [], verdict: "FAIL",
      reason: `UNDECLARED empty-string default on a governed surface (${g.file} — ${g.why}). ` +
              `Add it to recovery-env-manifest.cjs or give it a real fallback.`,
      sites: 1,
    });
  }
  for (const v of vars) {
    if (v.dynamicRead) {
      rows.push({ name: v.name, declared: v.class, derived: null,
                  verdict: "SKIP", reason: "dynamic_read_declared" });
      continue;
    }
    // ★ HUMAN-CLASSIFIED entries: the scan CANNOT decide these, so it must not pretend to.
    // The bare-read + separate-line-silent-guard shape (`const u = process.env.X;` then
    // `if (!u) return;`) is dataflow-gated — the same cross-line blind spot as s3-client.ts:77→85,
    // except that one THROWS (loud, safe) and this one RETURNS (quiet, dangerous). Extending the
    // regex to chase it would be over-engineering a line-local tool into a job it cannot do
    // soundly; the honest move is to declare the class human-owned and REPORT the skip, never
    // silently pass it. (This flag was named in the manifest header long before it existed here —
    // implementing it is what made that sentence true.)
    if (v.humanClassified) {
      const sites = readSites(v.name, opts);
      const d = deriveClasses(sites);
      // ★★ THE EXEMPTION IS EARNED PER-ENTRY, NOT GRANTED BY DECLARING IT.
      // You cannot human-classify what the machine CAN check. If this var has even one
      // machine-detectable empty-default site, the scan is competent here and the exemption
      // would be downgrading a verified entry to an unverified one — which is exactly how the
      // escape hatch gets abused. An earlier guard checked a population RATIO and an evidence
      // STRING LENGTH; an independent grader defeated it in one move by human-classifying
      // DISCORD_CH_CRITICAL_ALERTS (which HAS a detectable site) with padded evidence. Both
      // proxies passed while the only question that matters went unasked.
      if (d && d.dist.empty_default > 0) {
        rows.push({
          name: v.name, declared: [...v.classes].sort(), verdict: "FAIL",
          reason:
            `humanClassified is NOT PERMITTED here — the scan detects ${d.dist.empty_default} ` +
            `empty-default site(s) for this var, so it is machine-checkable. Remove the flag ` +
            `(the exemption is for shapes the scan cannot see, not for silencing it).`,
          sites: sites.length, dist: d.dist,
        });
        continue;
      }
      rows.push({
        name: v.name, declared: [...v.classes].sort(), verdict: "HUMAN",
        reason: "human_classified_shape_not_scan_detectable",
        sites: sites.length,
        dist: d ? d.dist : null,
        note: "EARNED exemption: the scan finds zero detectable sites for this var, so a human " +
          "owns it. Reported, never silently skipped, and never counted as PASS.",
      });
      continue;
    }

    const sites = readSites(v.name, opts);
    const d = deriveClasses(sites);
    const declared = [...v.classes].sort();
    if (d === null) {
      rows.push({ name: v.name, declared, verdict: "UNKNOWN",
                  reason: "no_static_read_sites_found", sites: 0 });
      continue;
    }
    // Only the degrading property is adjudicated. Both directions.
    const declaredDegrading = v.classes.includes("OPTIONAL_DEGRADING");
    let verdict, reason;
    if (d.degrading && !declaredDegrading) {
      verdict = "FAIL";
      reason = `${d.dist.empty_default} empty-string-default site(s) found but OPTIONAL_DEGRADING not declared — silent degradation is UNDECLARED`;
    } else if (declaredDegrading && !d.degrading) {
      verdict = "FAIL";
      reason = "declared OPTIONAL_DEGRADING but no empty-string-default site found";
    } else {
      verdict = "PASS";
      reason = d.degrading
        ? `degrading signature confirmed at ${d.dist.empty_default} site(s)`
        : "no degrading signature, none declared";
    }
    rows.push({ name: v.name, declared, verdict, reason, sites: sites.length,
                dist: d.dist,
                note: "bare/guard counts are INFORMATIONAL — REQUIRED vs OPTIONAL_FALLBACK is human-declared, not derived" });
  }
  return rows;
}

function main() {
  let rows;
  try {
    rows = check();
  } catch (e) {
    console.error(JSON.stringify({ check: "env-manifest", stage: "error", message: e.message }));
    return 1;
  }
  for (const r of rows) console.log(JSON.stringify({ check: "env-manifest", ...r }));
  const fail = rows.filter((r) => r.verdict === "FAIL").length;
  const unknown = rows.filter((r) => r.verdict === "UNKNOWN").length;
  const skip = rows.filter((r) => r.verdict === "SKIP").length;
  const human = rows.filter((r) => r.verdict === "HUMAN").length;
  console.log(JSON.stringify({
    check: "env-manifest", stage: "summary",
    pass: rows.filter((r) => r.verdict === "PASS").length, fail, unknown, skip, human,
    note: "SKIP = dynamic read, exempt by design; HUMAN = shape the scan cannot adjudicate, " +
      "a person owns it; UNKNOWN is not FAIL. Neither SKIP nor HUMAN is counted as a PASS — " +
      "folding them in would let the tool claim coverage it does not have.",
  }));
  if (fail) return 3;
  if (unknown) return 2;
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { readSites, siteShape, deriveClasses, check, main, TEST_RE, SITE_SHAPES, surfaceCoverage, GOVERNED_SURFACES };
