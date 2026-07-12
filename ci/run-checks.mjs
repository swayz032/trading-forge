import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEPARATE_HARD_GATES = new Set([
  "check:production-isolation",
  "check:2026-compliance",
]);

export function selectChecks({ scripts, checksSkipped }) {
  if (!scripts || typeof scripts !== "object" || !Array.isArray(checksSkipped)) {
    throw new Error("check_manifest_malformed");
  }

  const discovered = Object.keys(scripts)
    .filter((name) => name.startsWith("check:") && !SEPARATE_HARD_GATES.has(name))
    .sort();
  const discoveredSet = new Set(discovered);
  const skipMap = new Map();

  for (const entry of checksSkipped) {
    const name = entry?.name;
    const reason = entry?.reason;
    if (typeof name !== "string" || !discoveredSet.has(name)) {
      throw new Error(`check_quarantine_unknown:${String(name)}`);
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error(`check_quarantine_reason_missing:${name}`);
    }
    if (skipMap.has(name)) {
      throw new Error(`check_quarantine_duplicate:${name}`);
    }
    skipMap.set(name, reason.trim());
  }

  return {
    run: discovered.filter((name) => !skipMap.has(name)),
    skip: discovered
      .filter((name) => skipMap.has(name))
      .map((name) => ({ name, reason: skipMap.get(name) })),
  };
}

export function npmInvocation(platform, scriptName, comspec = process.env.ComSpec) {
  if (platform === "win32") {
    return {
      command: comspec || "cmd.exe",
      args: ["/d", "/s", "/c", `npm run ${scriptName}`],
    };
  }
  return { command: "npm", args: ["run", scriptName] };
}

function runCli() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(readFileSync("ci/baseline-failures.json", "utf8"));
  const selected = selectChecks({
    scripts: packageJson.scripts,
    checksSkipped: manifest.checksSkipped ?? [],
  });

  for (const entry of selected.skip) {
    console.log(`CHECK_SKIPPED ${entry.name}: ${entry.reason}`);
  }

  const failures = [];
  for (const name of selected.run) {
    console.log(`CHECK_START ${name}`);
    const invocation = npmInvocation(process.platform, name);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      failures.push({
        name,
        exitCode: result.status,
        error: result.error?.message ?? null,
      });
    }
  }

  if (failures.length > 0) {
    console.error(`CHECKS_RED ${JSON.stringify(failures)}`);
    process.exitCode = 1;
  } else {
    console.log(`CHECKS_GREEN ran=${selected.run.length} skipped=${selected.skip.length}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(`CHECKS_RED ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
