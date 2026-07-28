/**
 * wave-b-architect-registry-no-deprecated-jobs.test.ts
 *
 * Architect Wave B invariant — REVERSE direction of Wave A:
 *   Every registry `scheduler_jobs[]` entry MUST correspond to an active
 *   `withRetry("<job>", ...)` call in `src/server/scheduler.ts`.
 *
 * Wave A only enforced one direction (every code job has a registry owner).
 * Wave B closes the gap: a job listed in the registry that NO LONGER exists
 * in scheduler.ts is a deprecated/stale registry entry. Such entries hide
 * subsystem disconnects — an operator reading the system map believes a cron
 * is still active when in fact it was removed from code. The 14 deprecated
 * jobs cleared in this commit were the original instance of that drift.
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
  // Capture every `withRetry("job-name", ...)` invocation. Mirrors Wave A.
  const re = /withRetry\(\s*"([a-z][a-z0-9_-]+)"/g;
  const jobs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(schedulerSrc)) !== null) {
    jobs.add(m[1]);
  }
  return jobs;
}

interface OwnedJob {
  job: string;
  subsystem: string;
}

function extractRegistryJobsWithOwners(): OwnedJob[] {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  const registry: RegistryEntry[] = JSON.parse(raw);
  const out: OwnedJob[] = [];
  for (const entry of registry) {
    for (const job of entry.scheduler_jobs ?? []) {
      out.push({ job, subsystem: entry.id });
    }
  }
  return out;
}

describe("Wave B architect: registry ↔ scheduler completeness (reverse direction)", () => {
  const schedulerSrc = readFileSync(SCHEDULER_PATH, "utf8");
  const schedulerJobs = extractSchedulerJobs(schedulerSrc);
  const registryOwnedJobs = extractRegistryJobsWithOwners();

  it("scheduler.ts declares the same job set as the registry (no floor, no slack)", () => {
    // WAS `expect(schedulerJobs.size).toBeGreaterThanOrEqual(50)` — a floor
    // carrying 58 jobs of slack against a true count of 108, so more than half
    // the scheduler could vanish silently and this still passed. Replaced with
    // an exhaustive comparison whose expected value is DERIVED BY COMPUTATION
    // from the other artifact, never a hand-copied count. Same defect and same
    // correction as the sibling wave-a-architect-registry-completeness.test.ts.
    const registryJobNames = [...new Set(registryOwnedJobs.map((o) => o.job))].sort();
    expect([...schedulerJobs].sort()).toEqual(registryJobNames);
  });

  it("every registry scheduler_job exists in scheduler.ts (no deprecated entries)", () => {
    const deprecated: OwnedJob[] = [];
    for (const entry of registryOwnedJobs) {
      if (!schedulerJobs.has(entry.job)) {
        deprecated.push(entry);
      }
    }
    if (deprecated.length > 0) {
      // Failure message — these are registry entries with no live code.
      // Wave B architect mandate: registry must not advertise crons that
      // no longer exist in scheduler.ts. Remove the entry from the owning
      // subsystem's scheduler_jobs array.
      const summary = deprecated
        .sort((a, b) => a.job.localeCompare(b.job))
        .map((e) => `  - ${e.job} (owner: ${e.subsystem})`)
        .join("\n");
      throw new Error(
        `Found ${deprecated.length} deprecated scheduler jobs (in registry but NOT in scheduler.ts):\n${summary}\n\nFix by removing each from the owning subsystem's scheduler_jobs array in docs/system-subsystem-registry.json. If the cron should still be running, restore the withRetry("...") call in src/server/scheduler.ts instead.`,
      );
    }
    expect(deprecated).toEqual([]);
  });
});
