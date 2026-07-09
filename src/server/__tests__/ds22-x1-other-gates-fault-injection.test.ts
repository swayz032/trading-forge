/**
 * deep-scan #22 Track X1 (Task 3) — failure-injection for the 3 CI gates that previously had NO
 * fault-injection coverage: check:production-isolation, check:2026-compliance, system-map:check.
 *
 * Strategy per gate:
 *   • production-isolation — the gate scans <scriptdir>/../src/server/production. We copy the real
 *     .mjs into a temp fixture tree and drop a production file that imports a research module
 *     (agent-service). Clean tree → exit 0; violating file → exit 1.
 *   • 2026-compliance — the gate compares firm_config.py against the canonical 2026 docs relative to
 *     <scriptdir>/... We copy the real .mjs + the 2 canonical docs + firm_config.py + firm-config.ts
 *     into a temp fixture (faithful copy → exit 0), then drift one firm value (topstep profit_target
 *     3000 → 9999) → exit 1.
 *   • system-map:check — driven by the exported pure fn evaluateRegistryCoverage(snapshot, registry).
 *     We load the REAL registry and feed a snapshot whose schedulerJobs contains a phantom cron not
 *     in any registry entry → it appears in missingSchedulerJobs (the drift the CLI turns into a
 *     non-"ok" status + exit 1). Removing the phantom → no drift.
 *
 * The .mjs gates import only node builtins, so the copied scripts run standalone (no node_modules in
 * the fixture tree). See also the CLI RED proofs pasted in the deep-scan #22 X1 session log.
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRegistryCoverage } from "../lib/system-topology.js";
import type { SystemSubsystemRegistryEntry } from "../lib/system-topology.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cleanups: string[] = [];
afterAll(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});
function tempTree(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(d);
  return d;
}
/** Run a copied gate .mjs from a fixture root; return its exit code (0 = clean, non-0 = violation). */
function runGate(fixtureRoot: string, scriptRel: string): number {
  try {
    execFileSync("node", [path.join(fixtureRoot, scriptRel)], { cwd: fixtureRoot, stdio: "pipe" });
    return 0;
  } catch (err) {
    return typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : 1;
  }
}

describe("check:production-isolation — production file importing a research module", () => {
  it("GREEN clean, RED when a production file imports agent-service", () => {
    const root = tempTree("ds22-x1-pi-");
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    mkdirSync(path.join(root, "src", "server", "production"), { recursive: true });
    copyFileSync(
      path.join(REPO_ROOT, "scripts", "check-production-isolation.mjs"),
      path.join(root, "scripts", "check-production-isolation.mjs"),
    );
    writeFileSync(
      path.join(root, "src", "server", "production", "clean.ts"),
      `import { logger } from "../lib/logger.js";\nexport const x = logger;\n`,
    );
    expect(runGate(root, "scripts/check-production-isolation.mjs")).toBe(0);

    // inject the violation
    writeFileSync(
      path.join(root, "src", "server", "production", "bad.ts"),
      `import { runResearchLoop } from "../services/agent-service.js";\nexport const y = runResearchLoop;\n`,
    );
    expect(runGate(root, "scripts/check-production-isolation.mjs")).toBe(1);
  });
});

describe("check:2026-compliance — firm-rule drift", () => {
  it("GREEN on faithful copy, RED when firm_config.py drifts from the canonical doc", () => {
    const root = tempTree("ds22-x1-cf-");
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "src", "engine"), { recursive: true });
    mkdirSync(path.join(root, "src", "shared"), { recursive: true });
    const copies: [string, string][] = [
      ["scripts/verify-2026-rules-compliance.mjs", "scripts/verify-2026-rules-compliance.mjs"],
      ["docs/prop-firm-rules-2026-mffu.md", "docs/prop-firm-rules-2026-mffu.md"],
      ["docs/prop-firm-rules-2026-topstep.md", "docs/prop-firm-rules-2026-topstep.md"],
      ["src/engine/firm_config.py", "src/engine/firm_config.py"],
      ["src/shared/firm-config.ts", "src/shared/firm-config.ts"],
    ];
    for (const [src, dst] of copies) copyFileSync(path.join(REPO_ROOT, src), path.join(root, dst));
    expect(runGate(root, "scripts/verify-2026-rules-compliance.mjs")).toBe(0);

    // inject firm-rule drift: topstep profit_target 3000 -> 9999 (first occurrence)
    const pyPath = path.join(root, "src", "engine", "firm_config.py");
    const py = readFileSync(pyPath, "utf8");
    const drifted = py.replace(`"profit_target": 3000`, `"profit_target": 9999`);
    expect(drifted).not.toBe(py); // guard: the anchor really matched
    writeFileSync(pyPath, drifted);
    expect(runGate(root, "scripts/verify-2026-rules-compliance.mjs")).toBe(1);
  });
});

describe("system-map:check — unregistered scheduler cron drift", () => {
  it("flags a phantom cron absent from the registry; clean set has no scheduler drift", () => {
    const registry = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "docs", "system-subsystem-registry.json"), "utf8"),
    ) as SystemSubsystemRegistryEntry[];
    // Baseline scheduler set = every cron the registry already knows about (fully covered).
    const registeredJobs = Array.from(new Set(registry.flatMap((e) => e.scheduler_jobs ?? [])));
    const registeredRoutes = Array.from(new Set(registry.flatMap((e) => e.routes ?? [])));
    const registeredEngine = Array.from(new Set(registry.flatMap((e) => e.engine_subsystems ?? [])));
    const registeredTables = Array.from(new Set(registry.flatMap((e) => e.database_tables ?? [])));

    // GREEN: snapshot == what the registry covers → no scheduler-job drift.
    const clean = evaluateRegistryCoverage(
      { routes: registeredRoutes, schedulerJobs: registeredJobs, engineSubsystems: registeredEngine, databaseTables: registeredTables },
      registry,
    );
    expect(clean.missingSchedulerJobs).not.toContain("ds22-x1-phantom-unregistered-cron");

    // RED: add a phantom cron the scheduler would register but the registry has never heard of.
    const drifted = evaluateRegistryCoverage(
      {
        routes: registeredRoutes,
        schedulerJobs: [...registeredJobs, "ds22-x1-phantom-unregistered-cron"],
        engineSubsystems: registeredEngine,
        databaseTables: registeredTables,
      },
      registry,
    );
    expect(drifted.missingSchedulerJobs).toContain("ds22-x1-phantom-unregistered-cron");
  });
});
