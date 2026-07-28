/**
 * wave-a-architect-registry-completeness.test.ts
 *
 * Architect Wave A invariant: scheduler.ts's withRetry(<job>) set and the
 * scheduler_jobs union in docs/system-subsystem-registry.json must be EQUAL.
 *
 * WAS ONE-WAY, NOW BIDIRECTIONAL (R-311 §4 sweep, 2026-07-28). The original
 * header justified the one-way gate: "the registry may list 14 historical /
 * deprecated jobs that have since been removed from scheduler.ts." MEASURED
 * TODAY: that number is ZERO — scheduler 108, registry 108, both diffs empty.
 * The justification had expired while the weakness it excused remained, so the
 * reverse direction now costs nothing to enforce and is enforced.
 *
 * WHY THE REVERSE DIRECTION IS THE ONE THAT MATTERS: an orphan (in code, not in
 * registry) is a bookkeeping gap. A VANISHED job (in registry, not in code) is a
 * RAIL THAT STOPPED FIRING — the scheduler silently does less than the system
 * believes it does, which is the failure mode that does not announce itself.
 *
 * The old `>= 50` floor is gone. With a true count of 108 it carried 58 jobs of
 * slack: more than half the scheduler could vanish and it still passed. Both
 * assertions below are exhaustive set comparisons DERIVED BY COMPUTATION from
 * the two artifacts — never a hand-copied count, which would only trade a
 * non-biting threshold for an embalmed constant.
 *
 * The identical `>= 50` floor in the sibling
 * wave-b-architect-registry-no-deprecated-jobs.test.ts is corrected in the same
 * change — one defect class, both instances, same wave.
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

  it("scheduler.ts and the registry declare the SAME job set (no floor, no slack)", () => {
    // Exhaustive both ways. Derived by computation from the two artifacts — the
    // expected value is the other artifact, never a number typed in here.
    expect([...schedulerJobs].sort()).toEqual([...registryJobs].sort());
  });

  it("REVERSE DIRECTION: no registry-declared job has vanished from scheduler.ts", () => {
    // A vanished job is a rail that stopped firing.
    // CORRECTION TO AN EARLIER DRAFT OF THIS COMMENT: this direction was NOT
    // previously unguarded — wave-b-architect-registry-no-deprecated-jobs.test.ts
    // already asserts it. I claimed the absence without searching for a sibling
    // guard. What WAS unguarded is shrinkage below the floor: both files carried
    // the same `>= 50` sanity assertion against a true count of 108.
    const vanished = [...registryJobs].filter((j) => !schedulerJobs.has(j)).sort();
    expect(vanished).toEqual([]);
  });

  // RED-PROOF of both assertions' logic on synthetic sets, so the guards are
  // shown to BITE without mutating the canonical files this suite reads.
  it("RED-PROOF: the comparison fires on a vanished job and on an orphan", () => {
    const code = new Set(["a", "b"]);
    const reg = new Set(["a", "b"]);
    expect([...code].sort()).toEqual([...reg].sort()); // control: agreement passes

    const codeMissing = new Set(["a"]); // "b" deleted from scheduler.ts
    expect([...reg].filter((j) => !codeMissing.has(j))).toEqual(["b"]);
    expect(() => expect([...codeMissing].sort()).toEqual([...reg].sort())).toThrow();

    const codeExtra = new Set(["a", "b", "c"]); // "c" added without a registry owner
    expect([...codeExtra].filter((j) => !reg.has(j))).toEqual(["c"]);
    expect(() => expect([...codeExtra].sort()).toEqual([...reg].sort())).toThrow();
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
