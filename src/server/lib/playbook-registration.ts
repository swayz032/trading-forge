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

/**
 * Band C category heuristic for condition-compiled specs (no named archetype).
 * Mirrors `deriveCategoryFromArchetype`'s keyword philosophy: unambiguous
 * ICT/SMC/mean-reversion vocabulary in the spec's spine + trigger condition
 * `object` text routes to the matching category; anything else falls back to
 * the same documented CONTINUATION_STRATS default `deriveCategoryFromArchetype`
 * uses for an unmapped/null archetype. This is NOT a new category system — it
 * feeds the SAME 4 `PLAYBOOK_CATEGORIES` list literals in playbook_router.py
 * via the same `registerStrategiesInPlaybook` mechanism.
 */
export interface ConditionSpecForCategory {
  entry_conditions?: Array<{ object?: string | null; role?: string | null }> | null;
}

const REVERSAL_KEYWORDS = [
  "reversal", "reclaim", "fade", "sweep", "spring", "upthrust", "rejection", "reject",
];
const MEAN_REV_KEYWORDS = [
  "mean reversion", "lunch reversal", "midnight open", "vwap reversion", "revert to mean",
];
const ORB_KEYWORDS = [
  "scalp", "opening range", "orb", "breakout", "break out",
];

export function deriveCategoryFromConditionSpec(spec: ConditionSpecForCategory): PlaybookCategory {
  const conditions = (spec.entry_conditions ?? []).filter(
    (c) => c.role === "spine" || c.role === "trigger",
  );
  const haystack = conditions
    .map((c) => (typeof c.object === "string" ? c.object.toLowerCase() : ""))
    .join(" | ");

  if (haystack.trim().length === 0) return "CONTINUATION_STRATS";

  if (MEAN_REV_KEYWORDS.some((kw) => haystack.includes(kw))) return "MEAN_REV_STRATS";
  if (REVERSAL_KEYWORDS.some((kw) => haystack.includes(kw))) return "REVERSAL_STRATS";
  if (ORB_KEYWORDS.some((kw) => haystack.includes(kw))) return "ORB_STRATS";
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
function categoryPattern(cat: PlaybookCategory): RegExp {
  return new RegExp(`^${cat}\\s*=\\s*\\[([^\\]]*)\\]`, "m");
}

/** A token is a name only if it is a fully-quoted, quote-free string literal. */
const STRING_LITERAL = /^(["'])([^"']*)\1$/;

export type RegistryReadCode = "registry_read_incomplete" | "registry_read_truncated" | "registry_read_malformed";

export interface RegistryRead {
  byCategory: Map<PlaybookCategory, Set<string>>;
  /** Header regex did not match at all — the category contributes ZERO names. */
  missing: PlaybookCategory[];
  /** Body contains "[", so `[^\]]*` stopped at a NESTED bracket: a SHORT read. */
  truncated: PlaybookCategory[];
  /** Body contains a token that is not a bare quoted literal (comment, splat, annotation). */
  malformed: PlaybookCategory[];
}

/**
 * Thrown by `readAllRegisteredNames` when the parse is not EXACT. Carries the
 * per-category diagnostics so a caller can say which category failed and how,
 * rather than only that something did.
 */
export class PlaybookRegistryReadError extends Error {
  readonly code: RegistryReadCode;
  readonly read: RegistryRead;
  constructor(code: RegistryReadCode, read: RegistryRead) {
    super(
      `${code}: missing=[${read.missing.join(",")}] truncated=[${read.truncated.join(",")}] ` +
        `malformed=[${read.malformed.join(",")}]`,
    );
    this.name = "PlaybookRegistryReadError";
    this.code = code;
    this.read = read;
  }
}

/**
 * Raw, non-throwing parse of the 4 category list literals. Returns names PLUS
 * the three ways this file's shape can defeat the regex. Callers that need a
 * trustworthy answer must run `assertExactRead` (or use
 * `readAllRegisteredNames`, which does).
 */
export function parseRegistry(source: string): RegistryRead {
  const byCategory = new Map<PlaybookCategory, Set<string>>();
  const missing: PlaybookCategory[] = [];
  const truncated: PlaybookCategory[] = [];
  const malformed: PlaybookCategory[] = [];

  for (const cat of PLAYBOOK_CATEGORIES) {
    const names = new Set<string>();
    byCategory.set(cat, names);
    const m = source.match(categoryPattern(cat));
    if (!m) {
      missing.push(cat);
      continue;
    }
    const body = m[1];
    if (body.includes("[")) truncated.push(cat);
    let bad = false;
    for (const tok of body.split(",")) {
      const trimmed = tok.trim();
      if (!trimmed) continue; // trailing comma / empty list
      const lit = STRING_LITERAL.exec(trimmed);
      if (!lit) {
        bad = true;
        continue;
      }
      if (lit[2]) names.add(lit[2]);
    }
    if (bad) malformed.push(cat);
  }
  return { byCategory, missing, truncated, malformed };
}

/**
 * FAIL CLOSED (R-313 §5a, widened). The ordered fix was "throw when
 * `matched < PLAYBOOK_CATEGORIES.length`" — necessary but NOT sufficient:
 * a nested bracket still MATCHES all four headers and merely truncates the
 * body, so a count-only check reports 4/4 on a short read. Exactness, not
 * mere presence, is the property that makes the union trustworthy:
 *
 *   missing   — header regex did not match  (the ordered count check)
 *   truncated — body held "[", so `[^\]]*` stopped at a nested bracket
 *   malformed — a token was not a bare quoted literal (inline comment, splat)
 *
 * All three are SILENT and all three SHORTEN the union, and a short union is
 * exactly what lets `registerStrategiesInPlaybook` re-insert an
 * already-registered name into a second category.
 */
export function assertExactRead(read: RegistryRead): void {
  if (read.missing.length > 0) throw new PlaybookRegistryReadError("registry_read_incomplete", read);
  if (read.truncated.length > 0) throw new PlaybookRegistryReadError("registry_read_truncated", read);
  if (read.malformed.length > 0) throw new PlaybookRegistryReadError("registry_read_malformed", read);
}

/**
 * Parses all 4 category list literals out of `filePath` and returns the union
 * of every name currently registered (across all categories). Read-only —
 * safe to call from a reporting/scan tool (e.g. the registration-bypass
 * backfill instrument) without any risk of mutating the file. Shared by
 * `registerStrategiesInPlaybook` below so there is exactly one parser for
 * this file's shape, not a second copy per caller.
 *
 * THROWS `PlaybookRegistryReadError` when the parse is not exact. A short read
 * here is not a degraded answer, it is a WRONG one, and the caller cannot tell
 * the difference from a correct short list — so it must not be handed one.
 */
export function readAllRegisteredNames(filePath: string): Set<string> {
  const read = parseRegistry(readFileSync(filePath, "utf-8"));
  assertExactRead(read);
  const allNamesPresent = new Set<string>();
  for (const names of read.byCategory.values()) {
    for (const n of names) allNamesPresent.add(n);
  }
  return allNamesPresent;
}

/**
 * Verifies a candidate source: the parse is exact AND each just-inserted name
 * appears in EXACTLY ONE category, which must be the target. Returns a reason
 * string on violation, or null when clean.
 */
function verifyInsertion(
  candidate: string,
  names: string[],
  category: PlaybookCategory,
  stage: "precommit" | "postwrite",
): string | null {
  const read = parseRegistry(candidate);
  try {
    assertExactRead(read);
  } catch (err) {
    return `${stage}_verify_failed: ${String(err instanceof Error ? err.message : err)}`;
  }
  for (const name of names) {
    const inCats = PLAYBOOK_CATEGORIES.filter((c) => read.byCategory.get(c)?.has(name));
    if (inCats.length !== 1 || inCats[0] !== category) {
      return (
        `${stage}_verify_failed: ${JSON.stringify(name)} must appear in exactly one category ` +
        `(${category}); found in [${inCats.join(",")}]`
      );
    }
  }
  return null;
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

  const targetMatch = source.match(categoryPattern(category));
  if (!targetMatch) {
    return {
      ok: false,
      category,
      added: [],
      alreadyPresent: [],
      reason: `category_list_not_found: ${category} pattern did not match in ${filePath}`,
    };
  }

  // (a) FAIL CLOSED. A short read of the OTHER categories is what produces a
  // cross-category duplicate: a name already registered elsewhere goes unseen
  // and is re-inserted here. Refuse to write on anything less than an exact
  // read rather than write on a guess.
  let allNamesPresent: Set<string>;
  try {
    allNamesPresent = readAllRegisteredNames(filePath);
  } catch (err) {
    const code = err instanceof PlaybookRegistryReadError ? err.code : "registry_read_failed";
    return {
      ok: false,
      category,
      added: [],
      alreadyPresent: [],
      reason: `${code}: ${String(err instanceof Error ? err.message : err)}`,
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

  // A FUNCTION replacement, not a string: a string replacement interprets `$&`
  // / `$1` / `$'` inside a strategy name as capture-group syntax and splices the
  // matched text into the file.
  const newSource = source.replace(categoryPattern(category), () => newListLiteral);

  // (b-i) PRE-COMMIT VERIFY — check what we are about to write BEFORE writing
  // it. Prevention beats detection: a bad state that never reaches disk needs
  // no rollback.
  const precommitReason = verifyInsertion(newSource, toInsert, category, "precommit");
  if (precommitReason) {
    return { ok: false, category, added: [], alreadyPresent, reason: precommitReason };
  }

  try {
    writeFileSync(filePath, newSource, "utf-8");
  } catch (err) {
    return { ok: false, category, added: [], alreadyPresent, reason: `write_failed: ${String(err)}` };
  }

  // (b-ii) POST-WRITE RE-READ (R-313 §5b) — re-read from DISK and assert each
  // added name appears in EXACTLY ONE category. This is the half that closes
  // effect 3 (a name spliced into a nested sub-list creates NO duplicate, so
  // the exhaustive CI duplicate-guard is structurally blind to it) and it is
  // the only check that sees what actually landed rather than what we computed.
  // On violation the original source is RESTORED: returning ok:false while
  // leaving the defect on disk would still hand every downstream consumer a
  // widened allow-list.
  let postwriteReason: string | null;
  try {
    postwriteReason = verifyInsertion(readFileSync(filePath, "utf-8"), toInsert, category, "postwrite");
  } catch (err) {
    postwriteReason = `postwrite_verify_failed: reread_failed: ${String(err)}`;
  }
  if (postwriteReason) {
    let rollback = "rolled_back";
    try {
      writeFileSync(filePath, source, "utf-8");
    } catch (err) {
      rollback = `ROLLBACK_FAILED: ${String(err)}`;
    }
    return { ok: false, category, added: [], alreadyPresent, reason: `${postwriteReason} [${rollback}]` };
  }

  return { ok: true, category, added, alreadyPresent };
}
