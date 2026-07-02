/**
 * playbook-registration.ts — Band B2 (spec-onboarding-bridge, 2026-07-02)
 *
 * VERIFIED FINDING THIS SESSION (see docs/spec-onboarding-runbook.md):
 * `src/engine/context/playbook_router.py` defines `ALL_STRATS` as a FLAT,
 * HAND-TYPED list built from 4 sub-lists (CONTINUATION_STRATS / REVERSAL_STRATS
 * / MEAN_REV_STRATS / ORB_STRATS). `apply_eligibility_gate()` in
 * `src/engine/backtester.py` silently BYPASSES the 7-layer institutional
 * confluence overlay for any strategy whose exact DB `name` does not
 * normalized-match one of those ~15 hand-typed strings. There is NO db-driven
 * registry, NO CI gate, and (before this band) no test catching an onboarded
 * strategy that never gets added to this list.
 *
 * This module is the safe, idempotent, testable mechanism a spec-onboarding
 * CLI uses to register a newly-created strategy's EXACT row name (e.g.
 * "vwap_reversal_mes_5m", not just the bare concept) into one of the 4
 * category lists, so `apply_eligibility_gate()` stops silently bypassing it.
 *
 * SCOPE NOTE (explicitly NOT attempted here): this does not retrofit the
 * ~100 pre-existing graduated strategies whose names also fail to match
 * (that population-wide fix is a separate, larger finding — see the
 * "contract ambiguities" section of the final onboarding report). This
 * module only wires NEW spec-onboarded rows so Band B does not reproduce
 * the same silent-bypass bug for its own output.
 */
import { readFileSync, writeFileSync } from "node:fs";

export type PlaybookCategory =
  | "CONTINUATION_STRATS"
  | "REVERSAL_STRATS"
  | "MEAN_REV_STRATS"
  | "ORB_STRATS";

export const PLAYBOOK_CATEGORIES: readonly PlaybookCategory[] = [
  "CONTINUATION_STRATS",
  "REVERSAL_STRATS",
  "MEAN_REV_STRATS",
  "ORB_STRATS",
] as const;

/**
 * Best-effort category heuristic. Mirrors the archetype-family groupings
 * already present in playbook_router.py (ICT continuation-style archetypes →
 * CONTINUATION; breaker/mitigation/wyckoff-distribution-style reversal
 * concepts → REVERSAL; midnight-open/lunch-reversal mean-reversion concepts →
 * MEAN_REV; scalp/iofed → ORB). Defaults to CONTINUATION_STRATS when the
 * archetype key is unmapped or the strategy has no archetype at all — a
 * documented, honest default (most spec-corpus concepts, e.g. VWAP mean
 * reversion, are directional continuation-adjacent setups without a firm
 * regime label at onboarding time; the operator can re-bucket later via the
 * same idempotent mechanism).
 */
export function deriveCategoryFromArchetype(archetypeKey: string | null): PlaybookCategory {
  if (!archetypeKey) return "CONTINUATION_STRATS";
  const k = archetypeKey.toLowerCase();
  if (k.includes("breaker") || k.includes("mitigation") || k.includes("distribution") || k.includes("upthrust")) {
    return "REVERSAL_STRATS";
  }
  if (k.includes("midnight_open") || k.includes("lunch_reversal")) {
    return "MEAN_REV_STRATS";
  }
  if (k.includes("iofed") || k.includes("scalp")) {
    return "ORB_STRATS";
  }
  return "CONTINUATION_STRATS";
}

export interface RegisterResult {
  ok: boolean;
  category: PlaybookCategory;
  added: string[];
  alreadyPresent: string[];
  reason?: string;
}

/**
 * Idempotent, safe insert of `strategyNames` into the named category's list
 * literal inside `filePath` (playbook_router.py in production; a temp copy
 * in tests). Preserves existing formatting; skips names already present in
 * ANY of the 4 lists (a name should only ever live in one category).
 *
 * Failure modes are returned, never thrown — callers (the onboarding
 * transaction) decide whether a failed registration should roll back the
 * DB insert.
 */
/**
 * Parses all 4 category list literals out of `filePath` and returns the union
 * of every name currently registered (across all categories). Read-only —
 * safe to call from a reporting/scan tool (e.g. the registration-bypass
 * backfill instrument) without any risk of mutating the file. Shared by
 * `registerStrategiesInPlaybook` below so there is exactly one parser for
 * this file's shape, not a second copy per caller.
 */
export function readAllRegisteredNames(filePath: string): Set<string> {
  const source = readFileSync(filePath, "utf-8");
  const allNamesPresent = new Set<string>();
  for (const cat of PLAYBOOK_CATEGORIES) {
    const re = new RegExp(`^${cat}\\s*=\\s*\\[([^\\]]*)\\]`, "m");
    const m = source.match(re);
    if (m) {
      for (const tok of m[1].split(",")) {
        const cleaned = tok.trim().replace(/^["']|["']$/g, "");
        if (cleaned) allNamesPresent.add(cleaned);
      }
    }
  }
  return allNamesPresent;
}

export function registerStrategiesInPlaybook(
  filePath: string,
  strategyNames: string[],
  category: PlaybookCategory,
): RegisterResult {
  if (strategyNames.length === 0) {
    return { ok: true, category, added: [], alreadyPresent: [] };
  }

  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (err) {
    return { ok: false, category, added: [], alreadyPresent: [], reason: `read_failed: ${String(err)}` };
  }

  const allNamesPresent = readAllRegisteredNames(filePath);

  const targetMatch = source.match(new RegExp(`^${category}\\s*=\\s*\\[([^\\]]*)\\]`, "m"));
  if (!targetMatch) {
    return {
      ok: false,
      category,
      added: [],
      alreadyPresent: [],
      reason: `category_list_not_found: ${category} pattern did not match in ${filePath}`,
    };
  }

  const added: string[] = [];
  const alreadyPresent: string[] = [];
  const toInsert: string[] = [];
  for (const name of strategyNames) {
    if (allNamesPresent.has(name)) {
      alreadyPresent.push(name);
    } else {
      toInsert.push(name);
      added.push(name);
    }
  }

  if (toInsert.length === 0) {
    return { ok: true, category, added: [], alreadyPresent };
  }

  const existingListBody = targetMatch[1];
  const newEntries = toInsert.map((n) => `"${n}"`).join(", ");
  const trimmedBody = existingListBody.trim();
  const newBody = trimmedBody.length > 0 ? `${trimmedBody}, ${newEntries}` : newEntries;
  const newListLiteral = `${category} = [${newBody}]`;

  const newSource = source.replace(new RegExp(`^${category}\\s*=\\s*\\[([^\\]]*)\\]`, "m"), newListLiteral);

  try {
    writeFileSync(filePath, newSource, "utf-8");
  } catch (err) {
    return { ok: false, category, added: [], alreadyPresent, reason: `write_failed: ${String(err)}` };
  }

  return { ok: true, category, added, alreadyPresent };
}
