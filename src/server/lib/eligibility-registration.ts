import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { logger } from "./logger.js";

/**
 * Registration classification for the eligibility overlay (deep-scan A/C-1 follow-up).
 *
 * `src/engine/context/eligibility_gate.py` bypasses the 7-layer eligibility OVERLAY for any
 * strategy whose name is not in `playbook_router.ALL_STRATS` (framework/risk gates + Stage-2
 * confluence still apply). This module mirrors that classification in TS — as the reproducible,
 * testable methodology behind the "how many strategies are unregistered / would bypass" audit,
 * so the exposure figure is a re-runnable artifact rather than a one-off claim.
 *
 * The normalization is byte-for-byte the same as eligibility_gate.py:97-98:
 *   input name:      name.lower().replace("strategy","").strip().replace("_","")
 *   ALL_STRATS entry: s.lower().replace("_","")           # NOTE: does NOT strip "strategy"
 */

export function normalizeStrategyName(name: string): string {
  return name.toLowerCase().replaceAll("strategy", "").trim().replaceAll("_", "");
}

export function normalizeAllStratsEntry(entry: string): string {
  return entry.toLowerCase().replaceAll("_", "");
}

/** Mirrors eligibility_gate.py:99 — empty-normalized names are NOT treated as unregistered
 *  (they fall through to Check #2, which fail-closes). */
export function isStrategyRegistered(name: string, allStratsNormalized: ReadonlySet<string>): boolean {
  const n = normalizeStrategyName(name);
  if (n.length === 0) return true; // empty → not bypassed (handled downstream, fail-closed)
  return allStratsNormalized.has(n);
}

const ALL_STRATS_LISTS = ["CONTINUATION_STRATS", "REVERSAL_STRATS", "MEAN_REV_STRATS", "ORB_STRATS"] as const;

/** Parse ALL_STRATS out of playbook_router.py and return the normalized membership set.
 *  Single source of truth = the Python file, so TS and Python can never silently diverge. */
export function loadAllStratsNormalized(playbookRouterPath?: string): ReadonlySet<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = playbookRouterPath ?? resolve(here, "../../engine/context/playbook_router.py");
  const src = readFileSync(path, "utf-8");
  const out = new Set<string>();
  for (const listName of ALL_STRATS_LISTS) {
    const m = src.match(new RegExp(`${listName}\\s*=\\s*\\[([^\\]]*)\\]`));
    if (!m) {
      logger.warn({ listName, path }, "eligibility-registration: ALL_STRATS list not found in playbook_router.py");
      continue;
    }
    for (const q of m[1].matchAll(/"([^"]+)"/g)) out.add(normalizeAllStratsEntry(q[1]));
  }
  return out;
}

export interface RegistrationExposure {
  total: number;
  unregistered: number;
  liveUnregistered: number; // unregistered AND in a PAPER+ lifecycle state (real live exposure)
  byState: Record<string, { total: number; unregistered: number }>;
  liveUnregisteredNames: string[];
}

const LIVE_STATES = new Set(["PAPER", "SHADOW", "DEPLOY_READY", "PILOT", "DEPLOYED", "DECLINING"]);

/** Pure classifier over (name, lifecycleState) rows — no DB, fully unit-testable. The audit
 *  script feeds it live rows; tests feed it fixtures. This is the methodology the exposure
 *  figure rests on, so it is verified independently of any live-DB read. */
export function classifyRegistrationExposure(
  rows: ReadonlyArray<{ name: string; lifecycleState: string | null }>,
  allStratsNormalized: ReadonlySet<string>,
): RegistrationExposure {
  const byState: RegistrationExposure["byState"] = {};
  const liveUnregisteredNames: string[] = [];
  let unregistered = 0;
  for (const r of rows) {
    const st = r.lifecycleState ?? "NULL";
    byState[st] ??= { total: 0, unregistered: 0 };
    byState[st].total++;
    if (!isStrategyRegistered(r.name, allStratsNormalized)) {
      unregistered++;
      byState[st].unregistered++;
      if (LIVE_STATES.has(st)) liveUnregisteredNames.push(`${r.name} [${st}]`);
    }
  }
  return {
    total: rows.length,
    unregistered,
    liveUnregistered: liveUnregisteredNames.length,
    byState,
    liveUnregisteredNames,
  };
}
