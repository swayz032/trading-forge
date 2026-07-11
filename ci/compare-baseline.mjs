import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

function stableStrings(values) {
  return [...new Set(values.map((value) => String(value)))].sort();
}

export function validateManifest(manifest) {
  if (!manifest || manifest.frozen !== true) {
    throw new Error("baseline_manifest_unfrozen");
  }
  if (manifest.thresholdVersion !== "rails_thresholds_v1") {
    throw new Error("baseline_manifest_version_invalid");
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

  const known = new Set(stableStrings(baseline.knownFailures));
  const actual = new Set(stableStrings(results.failures));
  const newFailures = [...actual].filter((failure) => !known.has(failure)).sort();
  const fixedFailures = [...known].filter((failure) => !actual.has(failure)).sort();
  const floorBreached = results.collected < baseline.collectionFloor;

  return {
    verdict: newFailures.length > 0 || floorBreached ? "RED" : "GREEN",
    newFailures,
    fixedFailures,
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

  const failures = [];
  let collected = 0;
  for (const file of report.testResults) {
    if (!Array.isArray(file?.assertionResults)) {
      throw new Error("vitest_report_malformed: assertionResults array missing");
    }
    const fileName = basename(String(file.name ?? file.testFilePath ?? "unknown-test-file"));
    for (const assertion of file.assertionResults) {
      collected += 1;
      if (assertion?.status === "failed") {
        const fullName = assertion.fullName
          ?? [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean).join(" > ")
          ?? "unknown test";
        failures.push(`${fileName} > ${fullName}`);
      }
    }
  }

  return { failures: stableStrings(failures), collected };
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
  for (const record of records) {
    if (/<(?:failure|error)\b/.test(record)) {
      failures.push(`${xmlAttribute(record, "classname")}::${xmlAttribute(record, "name")}`);
    }
  }
  return { failures: stableStrings(failures), collected: records.length };
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
