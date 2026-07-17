/**
 * Fix-wave telemetry-honesty-registry-dashboards (2026-07-17) — HIGH finding:
 * every replay_grade_* entry (+ the adjacent replay_harness_engine entry) in
 * docs/system-subsystem-registry.json declared `audit_actions` / `audit_tables`
 * / `freshness_signals` claiming the scripts write specific audit_log rows —
 * none of those action strings exist anywhere in the actual codebase. The
 * replay-grading harnesses are read-only by governance design ("No production
 * table writes" per every script's own docstring); the registry's Carter
 * introspection consumer (src/server/lib/carter/carter-introspect.ts) reads
 * these fields directly and would answer an operator's "is this subsystem
 * healthy / how would I verify it ran?" query with a queryable audit trail
 * that does not exist — the exact kind of declared-vs-actual disconnect this
 * fix-wave exists to close.
 *
 * A SEPARATE bug fixed in the same registry edit: the real cron
 * `quantum-replay-weekly-analysis` (verified live in src/server/scheduler.ts)
 * was attributed to `replay_harness_engine` — a Python deterministic-replay-
 * reconstruction subsystem (quantum_replay.py + db_loader.py) that this cron
 * never invokes. The cron actually spawns `scripts/replay-grade-quantum.ts`
 * (quantum-replay-weekly-service.ts), which had NO registry entry of its own
 * (all 6 of its replay_grade_* siblings did) — the fix adds a
 * `replay_grade_quantum` entry with the REAL scheduler_jobs + REAL audit
 * actions (the wrapping quantum-replay-weekly-service.ts genuinely writes
 * `quantum_replay.*` audit_log rows, unlike every other tool in the family),
 * and removes the misattribution from replay_harness_engine.
 *
 * This suite is a general-purpose regression guard, not a one-off snapshot:
 * it re-derives "does this audit action string appear in production code"
 * and "does this cron name appear in scheduler.ts" from the actual source
 * tree on every run, so a future re-introduction of a fabricated claim (or a
 * cron rename that silently orphans an attribution) fails loudly here.
 *
 * RED-PROOF: run against `git show HEAD:docs/system-subsystem-registry.json`
 * (this fix-wave's pre-edit base) — every "no fabricated audit_actions"
 * assertion below fails, and the cron-misattribution assertion fails too
 * (see the manual verification transcript in this fix-wave's session log).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "docs", "system-subsystem-registry.json");
const SCHEDULER_PATH = path.join(REPO_ROOT, "src", "server", "scheduler.ts");

interface RegistryEntry {
  id: string;
  audit_actions?: string[];
  audit_tables?: string[];
  scheduler_jobs?: string[];
  writes_to?: string[];
  [k: string]: unknown;
}

function loadRegistry(): RegistryEntry[] {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
}

/** Directories that hold real production/CLI code — never test fixtures or docs. */
const PRODUCTION_SEARCH_ROOTS = [
  path.join(REPO_ROOT, "src", "server"),
  path.join(REPO_ROOT, "src", "engine"),
  path.join(REPO_ROOT, "scripts"),
];

const EXCLUDED_DIR_NAMES = new Set(["node_modules", "__tests__", "__pycache__"]);

function isTestFile(fileName: string): boolean {
  return (
    fileName.endsWith(".test.ts") ||
    fileName.endsWith(".test.py") ||
    fileName.endsWith("_test.py") ||
    fileName.startsWith("test_")
  );
}

function walkFiles(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      walkFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|py)$/.test(entry.name)) continue;
    if (isTestFile(entry.name)) continue;
    out.push(path.join(dir, entry.name));
  }
}

/**
 * Cache the full concatenated production source once — this suite does many
 * substring lookups and re-reading hundreds of files per assertion would be
 * slow. Built lazily so a single bad path doesn't fail collection.
 */
let _productionSourceCache: string | null = null;
function productionSource(): string {
  if (_productionSourceCache !== null) return _productionSourceCache;
  const files: string[] = [];
  for (const root of PRODUCTION_SEARCH_ROOTS) walkFiles(root, files);
  const chunks: string[] = [];
  for (const f of files) {
    try {
      chunks.push(readFileSync(f, "utf-8"));
    } catch {
      // unreadable file — skip, don't fail the whole scan
    }
  }
  _productionSourceCache = chunks.join("\n");
  return _productionSourceCache;
}

function actionExistsInProductionCode(action: string): boolean {
  // Match the literal quoted string as it would appear in a real
  // `action: "..."` (TS) or `"action": "..."` / bare string literal (Python)
  // write site. A plain substring check is intentionally permissive (covers
  // both languages' quoting styles) but still fails loudly for genuinely
  // fabricated names, since those never appear at all.
  return productionSource().includes(`"${action}"`);
}

function realSchedulerJobNames(): Set<string> {
  const src = readFileSync(SCHEDULER_PATH, "utf-8");
  const names = new Set<string>();
  const re = /registerJob\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

const REPLAY_FAMILY_IDS = [
  "replay_harness_engine",
  "replay_grade_quantum",
  "replay_grade_confluence",
  "replay_grade_critique",
  "replay_grade_robustness",
  "replay_grade_survival_twin",
  "replay_grade_pattern_aggregator",
  "replay_grade_consistency",
  "replay_grade_unified_dispatcher",
];

describe("registry replay_grade_* / replay_harness_engine audit-action honesty", () => {
  const registry = loadRegistry();
  const byId = new Map(registry.map((e) => [e.id, e]));

  it("sanity: all 9 expected replay-family entries exist in the registry", () => {
    for (const id of REPLAY_FAMILY_IDS) {
      expect(byId.has(id), `missing registry entry: ${id}`).toBe(true);
    }
  });

  describe.each(REPLAY_FAMILY_IDS)("%s", (id) => {
    it("every declared audit_action is a real, live string somewhere in production code", () => {
      const entry = byId.get(id)!;
      const actions = entry.audit_actions ?? [];
      const fabricated = actions.filter((a) => !actionExistsInProductionCode(a));
      expect(
        fabricated,
        `${id} declares audit_actions that don't exist in src/server, src/engine, or scripts: ${fabricated.join(", ")}`,
      ).toEqual([]);
    });

    it("audit_tables is non-empty only when audit_actions is also non-empty (no orphaned claim)", () => {
      const entry = byId.get(id)!;
      const hasActions = (entry.audit_actions ?? []).length > 0;
      const hasTables = (entry.audit_tables ?? []).length > 0;
      // audit_tables=["audit_log"] with zero real actions is exactly the
      // fabrication shape this fix-wave closed — guard the pairing, not just
      // the action strings, so a future edit can't drop the actions array
      // back to [] while leaving audit_tables=["audit_log"] behind.
      if (hasTables) {
        expect(hasActions, `${id} claims audit_tables but has no audit_actions`).toBe(true);
      }
    });
  });

  it("replay_harness_engine no longer mis-claims the quantum-replay-weekly-analysis cron", () => {
    const entry = byId.get("replay_harness_engine")!;
    expect(entry.scheduler_jobs ?? []).not.toContain("quantum-replay-weekly-analysis");
  });

  it("replay_grade_quantum correctly claims the real quantum-replay-weekly-analysis cron", () => {
    const entry = byId.get("replay_grade_quantum")!;
    expect(entry.scheduler_jobs ?? []).toContain("quantum-replay-weekly-analysis");
  });

  it("quantum-replay-weekly-analysis is a real cron registered in scheduler.ts (fixture sanity)", () => {
    expect(realSchedulerJobNames().has("quantum-replay-weekly-analysis")).toBe(true);
  });

  it("exactly one replay-family entry claims quantum-replay-weekly-analysis (no double-claim, no orphan)", () => {
    const claimants = REPLAY_FAMILY_IDS.filter((id) =>
      (byId.get(id)!.scheduler_jobs ?? []).includes("quantum-replay-weekly-analysis"),
    );
    expect(claimants).toEqual(["replay_grade_quantum"]);
  });

  it("replay_grade_survival_twin's writes_to=[quantum_mc_runs] claim is real (write_replay_row exists)", () => {
    // The one entry in the family that genuinely writes production-adjacent
    // state under --apply (survival_twin_replay.py -> db_loader.py
    // write_replay_row()) — verify that claim independently, since a blanket
    // "audit_actions must be empty" rule elsewhere in this suite must not be
    // mistaken for "this tool writes nothing at all."
    const entry = byId.get("replay_grade_survival_twin")!;
    expect(entry.writes_to ?? []).toContain("quantum_mc_runs");
    expect(productionSource()).toContain("def write_replay_row");
  });
});
