import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

function stableStrings(values) {
  return [...new Set(values.map((value) => String(value)))].sort();
}

function knownFailureIds(entries) {
  return entries.map((entry) => typeof entry === "string" ? entry : entry?.id);
}

export function validateManifest(manifest) {
  if (!manifest || manifest.frozen !== true) {
    throw new Error("baseline_manifest_unfrozen");
  }
  if (manifest.thresholdVersion !== "rails_thresholds_v1") {
    throw new Error("baseline_manifest_version_invalid");
  }
  for (const suite of ["vitest", "pytest"]) {
    const section = manifest[suite];
    if (!section
      || !Number.isInteger(section.collectionFloor)
      || section.collectionFloor < 1) {
      throw new Error(`baseline_collection_floor_invalid:${suite}`);
    }
    if (!Array.isArray(section.knownFailures)) {
      throw new Error(`baseline_known_failures_invalid:${suite}`);
    }
    const ids = new Set();
    for (const failure of section.knownFailures) {
      if (!failure
        || typeof failure.id !== "string"
        || failure.id.trim().length === 0
        || typeof failure.reason !== "string"
        || failure.reason.trim().length === 0) {
        throw new Error(`baseline_failure_reason_missing:${suite}`);
      }
      if (ids.has(failure.id)) {
        throw new Error(`baseline_failure_duplicate:${suite}:${failure.id}`);
      }
      ids.add(failure.id);
    }
  }
}

export function compareBaseline({ results, baseline }) {
  const resultsMalformed = !results
    || !Array.isArray(results.failures)
    || !Number.isFinite(results.collected)
    || results.collected < 0;
  const baselineMalformed = !baseline
    || !Array.isArray(baseline.knownFailures)
    || !Number.isFinite(baseline.collectionFloor)
    || baseline.collectionFloor < 0;

  if (resultsMalformed || baselineMalformed) {
    return {
      verdict: "RED",
      newFailures: [],
      fixedFailures: [],
      collected: Number.isFinite(results?.collected) ? results.collected : null,
      floorBreached: false,
      resultsMalformed,
      baselineMalformed,
    };
  }

  const known = new Set(stableStrings(knownFailureIds(baseline.knownFailures)));
  const actual = new Set(stableStrings(results.failures));
  const newFailures = [...actual].filter((failure) => !known.has(failure)).sort();

  // ★★★ "DID NOT FAIL" IS NOT "PASSED" (R-444).
  // A test that never ran also did not fail. The previous implementation
  // classified every known entry outside `actual` as `fixedFailures`, so a
  // silently-skipped or entirely-absent test presented as "fixed" and was a
  // candidate for deletion from the baseline — which would have removed its
  // safety net on the strength of it never having executed. Measured: of 156
  // such entries, 24 had NOT run (23 absent from the report, 1 skipped).
  //
  // So a baselined entry is only FIXED when it is positively observed to have
  // PASSED. Everything else that is not currently failing is UNRESOLVED, and
  // unresolved entries are reported but never proposed for removal.
  //
  // ★ FAIL-CLOSED: if the parser could not supply a passed-set (`results.passed`
  //   absent — an older report shape), nothing can be proven to have run, so
  //   NOTHING is called fixed and everything not-failing is unresolved.
  const passed = Array.isArray(results.passed)
    ? new Set(stableStrings(results.passed))
    : null;
  const notFailing = [...known].filter((id) => !actual.has(id));
  const fixedFailures = passed === null
    ? []
    : notFailing.filter((id) => passed.has(id)).sort();
  const unresolvedEntries = passed === null
    ? notFailing.sort()
    : notFailing.filter((id) => !passed.has(id)).sort();

  const floorBreached = results.collected < baseline.collectionFloor;
  // `staleBaseline` is the self-cleaning signal: entries that provably no longer
  // fail. It deliberately EXCLUDES unresolved ones, so the guard can be blocking
  // without going red over tests whose status we cannot establish.
  const staleBaseline = fixedFailures.length > 0;

  return {
    verdict: newFailures.length > 0 || floorBreached ? "RED" : "GREEN",
    newFailures,
    fixedFailures,
    unresolvedEntries,
    staleBaseline,
    collected: results.collected,
    floorBreached,
    resultsMalformed: false,
    baselineMalformed: false,
  };
}

export function parseVitestJson(report) {
  if (!report || !Array.isArray(report.testResults)) {
    throw new Error("vitest_report_malformed: testResults array missing");
  }

  // ★★★ THE STATUS VOCABULARY THIS PARSER UNDERSTANDS (R-446).
  //     Every assertionResult carries exactly one status, so recognized statuses
  //     MUST account for every collected test. If vitest renames or adds a
  //     status value, the shortfall is exact and detectable — see the assertion
  //     at the end of this function.
  const KNOWN_STATUSES = new Set(["passed", "failed", "skipped", "todo", "pending"]);
  const failures = [];
  const passed = [];
  const unknownStatuses = new Map();
  let recognized = 0;
  let collected = 0;
  for (const file of report.testResults) {
    if (!Array.isArray(file?.assertionResults)) {
      throw new Error("vitest_report_malformed: assertionResults array missing");
    }
    const fileName = basename(String(file.name ?? file.testFilePath ?? "unknown-test-file"));
    for (const assertion of file.assertionResults) {
      collected += 1;
      const fullName = assertion?.fullName
        ?? [...(assertion?.ancestorTitles ?? []), assertion?.title].filter(Boolean).join(" > ")
        ?? "unknown test";
      const id = `${fileName} > ${fullName}`;
      const st = assertion?.status;
      if (KNOWN_STATUSES.has(st)) {
        recognized += 1;
      } else {
        unknownStatuses.set(String(st), (unknownStatuses.get(String(st)) ?? 0) + 1);
      }
      if (st === "failed") {
        failures.push(id);
      } else if (st === "passed") {
        // ★ ONLY an explicit "passed" counts as having run successfully.
        //   "skipped"/"todo"/"pending" are deliberately excluded — see the
        //   fixed-vs-unresolved split in compareBaseline().
        passed.push(id);
      }
    }
  }

  // ★★★★★ SANITY ASSERTION (R-446). THROW LOUDLY, NEVER RETURN A QUIET EMPTY SET.
  //
  // THE FAILURE THIS EXISTS TO CATCH: if a future vitest renames the `status`
  // enum, `passed` comes back EMPTY-BUT-PRESENT. That is indistinguishable from
  // "absent" downstream, so `--fail-on-stale` goes SILENTLY INERT — the guard
  // stops guarding and CI stays green. The trigger is live, not hypothetical:
  // `package.json` pins vitest `^3.1.0` (a floating range) and the lockfile
  // already resolves 3.2.7, while every shape test here uses a hand-built
  // synthetic report rather than a real vitest artifact.
  //
  // ★★★ WHY EXACT ACCOUNTING RATHER THAN A RATIO THRESHOLD:
  // every assertion has exactly one status, so `recognized === collected` is an
  // INVARIANT, not a tolerance. A ratio ("passed+failed must exceed N% of
  // collected") would need an arbitrary constant that is wrong in both
  // directions — it false-fires on a legitimately mostly-skipped run, and it
  // still passes if a rename leaves a large-enough minority recognized. Exact
  // accounting has no constant to tune and names the offending value.
  //
  // ★ DELIBERATE TRADE-OFF: a NEW but legitimate vitest status would also throw.
  //   That is the intended direction — a loud false red is recoverable in one
  //   commit, whereas a silently inert guard is not detectable at all.
  if (unknownStatuses.size > 0) {
    const detail = [...unknownStatuses.entries()]
      .map(([status, n]) => `${status}=${n}`)
      .sort()
      .join(", ");
    throw new Error(
      "vitest_report_malformed: unrecognized assertion status "
      + `(${detail}) across ${collected} collected test(s). `
      + `Recognized statuses are: ${[...KNOWN_STATUSES].join(", ")}. `
      + "The reporter's status vocabulary has changed, so passed/failed sets "
      + "cannot be trusted and --fail-on-stale would go silently inert. "
      + "Update KNOWN_STATUSES in ci/compare-baseline.mjs after checking which "
      + "of the new values mean ran-and-passed.",
    );
  }
  if (collected > 0 && recognized !== collected) {
    throw new Error(
      `vitest_report_malformed: only ${recognized} of ${collected} collected `
      + "tests carried a recognized status.",
    );
  }

  return { failures: stableStrings(failures), passed: stableStrings(passed), collected };
}

function xmlAttribute(record, name) {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(record);
  return match?.[1]
    ?.replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&") ?? "";
}

export function parsePytestJunit(xml) {
  if (typeof xml !== "string") {
    throw new Error("pytest_report_malformed: report is not text");
  }
  const records = xml.match(/<testcase\b[^>]*\/>|<testcase\b[^>]*>[\s\S]*?<\/testcase>/g) ?? [];
  if (records.length === 0) {
    throw new Error("pytest_report_malformed: no testcase records");
  }

  const failures = [];
  const passed = [];
  for (const record of records) {
    const id = `${xmlAttribute(record, "classname")}::${xmlAttribute(record, "name")}`;
    if (/<(?:failure|error)\b/.test(record)) {
      failures.push(id);
    } else if (!/<skipped\b/.test(record)) {
      // ★ A JUnit <testcase> with neither failure/error NOR <skipped> ran and
      //   passed. Skipped ones are excluded for the same reason as vitest's:
      //   they did not fail because they did not run.
      passed.push(id);
    }
  }
  return { failures: stableStrings(failures), passed: stableStrings(passed), collected: records.length };
}

function cliArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function runCli() {
  const suite = cliArg("suite");
  const resultsPath = cliArg("results");
  const baselinePath = cliArg("baseline", "ci/baseline-failures.json");
  if (!suite || !resultsPath) {
    throw new Error("usage: --suite vitest|pytest --results <file> [--baseline <file>]");
  }

  const manifest = JSON.parse(readFileSync(baselinePath, "utf8"));
  validateManifest(manifest);
  const baseline = manifest[suite];
  if (!baseline) {
    throw new Error(`no baseline section for suite ${suite}`);
  }

  const raw = readFileSync(resultsPath, "utf8");
  const results = suite === "pytest"
    ? parsePytestJunit(raw)
    : parseVitestJson(JSON.parse(raw));
  const verdict = compareBaseline({ results, baseline });
  console.log(JSON.stringify(verdict, null, 2));
  if (verdict.fixedFailures.length > 0) {
    console.log(`BASELINE_SHRINK_NEEDED=${verdict.fixedFailures.length}`);
  }
  if (verdict.unresolvedEntries.length > 0) {
    // Reported, never blocking: these did not run, so their status is unknown
    // rather than good. Removing them would be deletion-on-absence.
    console.log(`BASELINE_UNRESOLVED=${verdict.unresolvedEntries.length}`);
  }

  // ★★★ SELF-CLEANING GUARD (R-444), opt-in via --fail-on-stale.
  //   A baseline that can only GROW turns every future regression in its
  //   entries into a silent pass. This makes a provably-stale entry fail CI, so
  //   the allow-list shrinks by force instead of by someone remembering.
  //   Opt-in rather than default so it lands AFTER a shrink and cannot fire red
  //   on arrival, and so existing callers keep their current contract.
  const failOnStale = process.argv.includes("--fail-on-stale");
  if (failOnStale && verdict.staleBaseline) {
    const n = verdict.fixedFailures.length;
    console.error(
      `BASELINE_STALE_RED: ${n} baseline ${n === 1 ? "entry" : "entries"} `
      + `${n === 1 ? "now passes" : "now pass"} and must be removed from `
      + "ci/baseline-failures.json. Each listed test RAN and PASSED on this run "
      + "(entries that merely did not run are reported as BASELINE_UNRESOLVED and "
      + "do NOT fail this gate):",
    );
    for (const id of verdict.fixedFailures) console.error(`  - ${id}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = verdict.verdict === "GREEN" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(`BASELINE_COMPARATOR_RED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
