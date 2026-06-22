/**
 * wave-a-architect-registry-completeness.test.ts
 *
 * Architect Wave A invariant: every scheduler.ts withRetry(<job>) call MUST
 * be registered in at least one subsystem's scheduler_jobs array in
 * docs/system-subsystem-registry.json. The opposite direction (registered
 * jobs that don't exist in scheduler.ts) is informational only — the
 * registry may list 14 historical / deprecated jobs that have since been
 * removed from scheduler.ts. The CI gate is one-way: NO scheduler job may
 * exist in code without a registry owner.
 *
 * This test is mock-free, read-only, and runs against the canonical files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCHEDULER_PATH = path.join(REPO_ROOT, "src", "server", "scheduler.ts");
const REGISTRY_PATH = path.join(REPO_ROOT, "docs", "system-subsystem-registry.json");

interface RegistryEntry {
  id: string;
  scheduler_jobs?: string[];
}

function extractSchedulerJobs(schedulerSrc: string): Set<string> {
  // Capture every `withRetry("job-name", ...)` invocation.
  const re = /withRetry\(\s*"([a-z][a-z0-9_-]+)"/g;
  const jobs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(schedulerSrc)) !== null) {
    jobs.add(m[1]);
  }
  return jobs;
}

function extractRegistryJobs(): Set<string> {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  const registry: RegistryEntry[] = JSON.parse(raw);
  const jobs = new Set<string>();
  for (const entry of registry) {
    for (const job of entry.scheduler_jobs ?? []) {
      jobs.add(job);
    }
  }
  return jobs;
}

describe("Wave A architect: scheduler ↔ registry completeness", () => {
  const schedulerSrc = readFileSync(SCHEDULER_PATH, "utf8");
  const schedulerJobs = extractSchedulerJobs(schedulerSrc);
  const registryJobs = extractRegistryJobs();

  it("scheduler.ts has at least 50 active withRetry jobs (sanity)", () => {
    expect(schedulerJobs.size).toBeGreaterThanOrEqual(50);
  });

  it("every active scheduler job is mapped to at least one subsystem", () => {
    const orphans: string[] = [];
    for (const job of schedulerJobs) {
      if (!registryJobs.has(job)) {
        orphans.push(job);
      }
    }
    if (orphans.length > 0) {
      // Helpful failure message — these are scheduler jobs with no registry owner.
      // Wave A architect mandate: every job must be assignable to a subsystem.
      throw new Error(
        `Found ${orphans.length} orphan scheduler jobs (in scheduler.ts but NOT in any subsystem's scheduler_jobs):\n  - ${orphans.sort().join("\n  - ")}\n\nFix by adding each to the owning subsystem's scheduler_jobs array in docs/system-subsystem-registry.json. If unowned, add a new subsystem 'legacy_unowned_crons'.`,
      );
    }
    expect(orphans).toEqual([]);
  });
});
