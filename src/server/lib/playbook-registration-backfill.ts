/**
 * playbook-registration-backfill.ts — Band B2 follow-up (2026-07-02)
 *
 * Converts the "flagged, not fixed" registration-bypass finding (docs/
 * spec-onboarding-runbook.md — apply_eligibility_gate silently bypasses the
 * confluence overlay for any strategy whose exact DB `name` isn't in
 * playbook_router.py's ALL_STRATS) into an INSTRUMENT the operator can run
 * against the ~100 pre-existing graduated strategies: dry-run report first,
 * `--apply` explicit and never automatic.
 *
 * This module is pure (no DB, no fs) — the CLI (scripts/backfill-playbook-
 * registration.ts) fetches rows and calls classifyStrategyForBackfill() per
 * row, so the classification logic is unit-testable without a live DB.
 */
import { deriveCategoryFromArchetype, type PlaybookCategory } from "./playbook-registration.js";

/**
 * Mirrors apply_eligibility_gate()'s exact normalization in
 * src/engine/backtester.py:
 *   strat_normalized = strategy_name.lower().replace("strategy", "").strip().replace("_", "")
 * Python's str.replace() replaces ALL occurrences (not just the first) — the
 * TS equivalent is split().join() (or replaceAll, kept as split/join here for
 * broad target compatibility).
 */
export function normalizeStrategyNamePy(name: string): string {
  return name.toLowerCase().split("strategy").join("").trim().split("_").join("");
}

/**
 * Mirrors apply_eligibility_gate()'s registry-side normalization:
 *   all_normalized = [s.lower().replace("_", "") for s in ALL_STRATS]
 * (No "strategy" substring stripping on the registry side — only on the
 * incoming strategy_name side. This asymmetry is in the real gate; preserved
 * here verbatim, not "fixed", since this instrument reports against the
 * REAL gate behavior, not an idealized one.)
 */
export function normalizeRegistryEntry(name: string): string {
  return name.toLowerCase().split("_").join("");
}

export type BackfillStatus = "registered" | "unregistered" | "unresolvable";

export interface StrategyRowForBackfill {
  id: string;
  name: string | null | undefined;
  symbol: string | null | undefined;
  source: string | null | undefined;
  lifecycleState: string | null | undefined;
  /** strategies.config JSONB — used to derive an archetype key, if present. */
  config: unknown;
}

export interface BackfillClassification {
  id: string;
  name: string;
  symbol: string | null;
  source: string | null;
  lifecycleState: string | null;
  status: BackfillStatus;
  /** archetype key derived from config.strategy.entry_indicator, if any ("archetype:X" -> "X"). */
  archetypeKey: string | null;
  /** The category this strategy WOULD register into if --apply is run (unresolvable rows have none). */
  proposedCategory: PlaybookCategory | null;
  reason?: string;
}

/** Same extraction path graduated-strategy-auditor.ts uses: indicators[0].type, then entry_indicator. */
function extractEntryIndicator(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const c = config as Record<string, unknown>;
  const strat = (c.strategy as Record<string, unknown> | undefined) ?? undefined;
  if (!strat) return null;
  const indicators = strat.indicators as Array<Record<string, unknown>> | undefined;
  const fromIndicators = Array.isArray(indicators) && indicators.length > 0 ? indicators[0]?.type : undefined;
  const direct = strat.entry_indicator;
  const raw = fromIndicators ?? direct;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function archetypeKeyFromIndicator(entryIndicator: string | null): string | null {
  if (!entryIndicator) return null;
  if (entryIndicator.startsWith("archetype:")) return entryIndicator.slice("archetype:".length).trim() || null;
  return null;
}

/**
 * Classifies one strategies row for the registration-bypass backfill report.
 * Never throws — a row that can't be meaningfully classified is
 * "unresolvable" with a reason, never silently skipped or silently
 * force-registered.
 */
export function classifyStrategyForBackfill(
  row: StrategyRowForBackfill,
  registeredNames: ReadonlySet<string>,
): BackfillClassification {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const symbol = typeof row.symbol === "string" ? row.symbol : null;
  const source = typeof row.source === "string" ? row.source : null;
  const lifecycleState = typeof row.lifecycleState === "string" ? row.lifecycleState : null;

  if (name.length === 0) {
    return {
      id: row.id,
      name: "",
      symbol,
      source,
      lifecycleState,
      status: "unresolvable",
      archetypeKey: null,
      proposedCategory: null,
      reason: "empty_or_missing_name",
    };
  }

  // Retired strategies (GRAVEYARD) must NEVER enter the research roster. The old
  // library was deliberately retired (Band B); registering it would pull thin/
  // wrong-mechanism extractions back into overlay research runs and pollute the
  // corpus. Surface it (honest, not silently skipped) but never register it —
  // registration is only for strategies that can legitimately be researched.
  if (lifecycleState === "GRAVEYARD") {
    return {
      id: row.id,
      name,
      symbol,
      source,
      lifecycleState,
      status: "unresolvable",
      archetypeKey: null,
      proposedCategory: null,
      reason: "retired_graveyard_excluded_from_registration",
    };
  }

  const entryIndicator = extractEntryIndicator(row.config);
  const archetypeKey = archetypeKeyFromIndicator(entryIndicator);

  const normalizedName = normalizeStrategyNamePy(name);
  const isRegistered = Array.from(registeredNames).some(
    (registered) => normalizeRegistryEntry(registered) === normalizedName,
  );

  if (isRegistered) {
    return {
      id: row.id,
      name,
      symbol,
      source,
      lifecycleState,
      status: "registered",
      archetypeKey,
      proposedCategory: null,
    };
  }

  const proposedCategory = deriveCategoryFromArchetype(archetypeKey);
  return {
    id: row.id,
    name,
    symbol,
    source,
    lifecycleState,
    status: "unregistered",
    archetypeKey,
    proposedCategory,
  };
}
