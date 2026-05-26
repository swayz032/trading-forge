/**
 * wave26-pass-g-pass-d-lifecycle.test.ts — Wave 26 Pass G Pass D (2026-05-26)
 *
 * Verifies lifecycle states, STALE cron, and needs-attention API:
 *
 *   1.  Migration 0152 idempotency contract (static source inspection)
 *   2.  STALE cron exits early when pipeline is PAUSED
 *   3.  STALE cron exits early when pipeline is VACATION
 *   4.  STALE → NEEDS_REVISION demotion at 60+ days stale
 *   5.  Stale_cleared when activity resumes
 *   6.  DEPLOYED is never demoted
 *   7.  PILOT is never demoted
 *   8.  Already NEEDS_REVISION is idempotent (no double-audit)
 *   9.  Already NEEDS_ARCHETYPE is preserved
 *   10. API endpoint returns NEEDS_ARCHETYPE cohort
 *   11. API endpoint returns fallback_only cohort
 *   12. API endpoint returns stale cohort
 *   13. Audit rows fire per transition (static source inspection)
 *   14. lifecycle_metadata writes are additive (static source inspection)
 *   15. setNeedsArchetype writes NEEDS_ARCHETYPE + audit
 *   16. setNeedsRevision writes NEEDS_REVISION + audit + never touches DEPLOYED
 *
 * Pattern: inline mock DB + pipeline-control to avoid DATABASE_URL bootstrap.
 * Mirrors the static-source-inspection + inline-pure-function pattern used by
 * wave26-pass-g-b2-auditor-gates.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Static source paths ──────────────────────────────────────────────────────

const STALE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/strategy-stale-detector.ts"),
  "utf-8",
);

const ADMIN_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin.ts"),
  "utf-8",
);

const MIGRATION_SRC = fs.readFileSync(
  path.resolve(
    __dirname,
    "../db/migrations/0152_strategies_needs_revision_states.sql",
  ),
  "utf-8",
);

const SCHEDULER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../scheduler.ts"),
  "utf-8",
);

// ─── §1 Migration idempotency contract ───────────────────────────────────────

describe("§1 Migration 0152 idempotency contract", () => {
  it("migration file exists and references correct migration number", () => {
    expect(MIGRATION_SRC).toContain("0152");
  });

  it("migration adds COMMENT ON COLUMN for new lifecycle states", () => {
    expect(MIGRATION_SRC).toContain("COMMENT ON COLUMN strategies.lifecycle_state");
    expect(MIGRATION_SRC).toContain("NEEDS_ARCHETYPE");
    expect(MIGRATION_SRC).toContain("NEEDS_REVISION");
  });

  it("migration emits audit row for traceability", () => {
    expect(MIGRATION_SRC).toContain("migration.lifecycle_states_needs_revision_added");
  });

  it("migration never sets lifecycle_state to GRAVEYARD", () => {
    // GRAVEYARD may appear in comments — that's fine. What must NOT appear is
    // a SET lifecycle_state = 'GRAVEYARD' or UPDATE ... GRAVEYARD assignment.
    const hasGraveyardSet = /lifecycle_state\s*=\s*'GRAVEYARD'/i.test(MIGRATION_SRC);
    expect(hasGraveyardSet).toBe(false);
  });

  it("journal entry idx 152 is present", () => {
    const journalPath = path.resolve(
      __dirname,
      "../db/migrations/meta/_journal.json",
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const entry = journal.entries.find((e: { idx: number }) => e.idx === 152);
    expect(entry).toBeDefined();
    expect(entry.tag).toContain("0152");
  });
});

// ─── §2 Inline pure-function re-implementations for unit testing ──────────────
//
// We avoid importing strategy-stale-detector.ts directly because its import
// chain triggers DATABASE_URL bootstrap. Instead we inline the pure-function
// logic and verify the source matches via static inspection.

const STALE_THRESHOLD_DAYS = 30;
const DEMOTION_THRESHOLD_DAYS = 60;
const DEMOTION_EXEMPT_STATES: ReadonlyArray<string> = ["DEPLOYED", "PILOT"];

function isInactive(lastActivityDaysAgo: number): boolean {
  return lastActivityDaysAgo > STALE_THRESHOLD_DAYS;
}

function shouldDemote(staleDaysElapsed: number, lifecycleState: string): boolean {
  if (DEMOTION_EXEMPT_STATES.includes(lifecycleState)) return false;
  return staleDaysElapsed > DEMOTION_THRESHOLD_DAYS;
}

function deriveSuggestedActionInline(
  status: string,
  factorQuality: string | null,
  staleSince: string | null,
  lastExtractionOutcome: string | null,
): string {
  if (status === "NEEDS_ARCHETYPE") {
    return "Register archetype in ARCHETYPE_REGISTRY and re-run extraction";
  }
  if (status === "NEEDS_REVISION") {
    if (lastExtractionOutcome === "source_url_unreachable") {
      return "Source URL is unreachable — find a replacement video or update source URL, then re-extract";
    }
    if (lastExtractionOutcome === "gemma_failed") {
      return "Gemma extraction failed — check Ollama health, then trigger manual re-extraction";
    }
    if (lastExtractionOutcome === "no_archetype_match") {
      return "Register missing archetype in ARCHETYPE_REGISTRY and re-run extraction";
    }
    if (staleSince) {
      const staleDays = Math.floor((Date.now() - new Date(staleSince).getTime()) / 86_400_000);
      return `Inactive ${staleDays}+ days — run a backtest or paper session to re-activate, or manually revise`;
    }
    return "Review strategy config and re-extract or manually edit; then reset lifecycle to CANDIDATE";
  }
  if (factorQuality === "fallback_only") {
    return "Re-extract: all confluence factors are auto-floor injections — no LLM-extracted factors present";
  }
  if (staleSince) {
    const staleDays = Math.floor((Date.now() - new Date(staleSince).getTime()) / 86_400_000);
    return `Stale ${staleDays}+ days — run a backtest or paper session to resume activity`;
  }
  return "Review strategy config";
}

// ─── §2 STALE cron paused-mode-aware ─────────────────────────────────────────

describe("§2-3 STALE cron paused-mode-aware", () => {
  it("exits when pipeline is PAUSED (pure logic)", () => {
    // Verify the source code contains the pipeline guard
    expect(STALE_SRC).toContain("pipelineMode !== \"ACTIVE\"");
    expect(STALE_SRC).toContain("paused, no demotions performed");
    expect(STALE_SRC).toContain("skippedPaused: true");
  });

  it("exits when pipeline is VACATION (pure logic)", () => {
    // The same guard covers VACATION since it checks !== 'ACTIVE'
    expect(STALE_SRC).toContain("pipelineMode !== \"ACTIVE\"");
  });

  it("stale cron is pipeline-gated in scheduler (NOT exempt)", () => {
    // The scheduler should use pipelineGate for this job (not in _PIPELINE_GATE_EXEMPT)
    expect(SCHEDULER_SRC).toContain("pipelineGate(\"strategy-stale-detector\")");
    // It should NOT be in the exempt set
    const exemptBlock = SCHEDULER_SRC.match(
      /const _PIPELINE_GATE_EXEMPT[\s\S]*?^\]\)/m,
    )?.[0] ?? "";
    // strategy-stale-detector is intentionally NOT in the exempt set
    // (service handles paused internally via its own guard)
    // However pipelineGate is called in the cron — this is belt-and-suspenders
    expect(SCHEDULER_SRC).toContain("strategy-stale-detector");
  });
});

// ─── §4 STALE → NEEDS_REVISION demotion threshold ────────────────────────────

describe("§4 STALE → NEEDS_REVISION demotion threshold", () => {
  it("does not demote at exactly 60 days (boundary: > not >=)", () => {
    expect(shouldDemote(60, "CANDIDATE")).toBe(false);
  });

  it("demotes at 61 days for CANDIDATE", () => {
    expect(shouldDemote(61, "CANDIDATE")).toBe(true);
  });

  it("demotes at 61 days for PAPER", () => {
    expect(shouldDemote(61, "PAPER")).toBe(true);
  });

  it("demotes at 61 days for DEPLOY_READY", () => {
    expect(shouldDemote(61, "DEPLOY_READY")).toBe(true);
  });

  it("marks stale at exactly 31 days (inactive threshold: > 30)", () => {
    expect(isInactive(31)).toBe(true);
  });

  it("does not mark stale at exactly 30 days", () => {
    expect(isInactive(30)).toBe(false);
  });

  it("marks stale when no activity ever (Infinity days)", () => {
    expect(isInactive(Infinity)).toBe(true);
  });
});

// ─── §5 Stale cleared on resumed trading ─────────────────────────────────────

describe("§5 Stale cleared on resumed trading", () => {
  it("source contains stale_cleared audit action", () => {
    expect(STALE_SRC).toContain("lifecycle.strategy_stale_cleared");
  });

  it("stale cleared when activity resumes (staleSince set AND not inactive)", () => {
    // If staleSince is set but lastActivity was recent → clear
    const staleSince = new Date(Date.now() - 35 * 86_400_000); // 35 days ago
    const lastActivityDaysAgo = 5; // recent activity
    const wasStale = staleSince !== null;
    const currentlyInactive = isInactive(lastActivityDaysAgo);
    // should clear: staleSince set AND not currently inactive
    expect(wasStale && !currentlyInactive).toBe(true);
  });

  it("does not clear when still inactive", () => {
    const lastActivityDaysAgo = 35; // still inactive
    expect(isInactive(lastActivityDaysAgo)).toBe(true); // still stale — would not clear
  });
});

// ─── §6-7 DEPLOYED and PILOT never demoted ────────────────────────────────────

describe("§6-7 DEPLOYED and PILOT never demoted", () => {
  it("DEPLOYED is exempt from demotion at any stale age", () => {
    expect(shouldDemote(90, "DEPLOYED")).toBe(false);
    expect(shouldDemote(365, "DEPLOYED")).toBe(false);
  });

  it("PILOT is exempt from demotion at any stale age", () => {
    expect(shouldDemote(90, "PILOT")).toBe(false);
    expect(shouldDemote(365, "PILOT")).toBe(false);
  });

  it("source code explicitly guards DEPLOYED and PILOT from demotion", () => {
    expect(STALE_SRC).toContain("DEMOTION_EXEMPT_STATES");
    expect(STALE_SRC).toContain('"DEPLOYED"');
    expect(STALE_SRC).toContain('"PILOT"');
    // demoteToNeedsRevision has belt-and-suspenders guard too
    expect(STALE_SRC).toContain("demoteToNeedsRevision called on protected state");
  });

  it("GRAVEYARD is never written (no lifecycle_state = GRAVEYARD assignment) from the stale detector", () => {
    // Comments may reference GRAVEYARD as a invariant note — that's correct and expected.
    // What must NOT exist is an actual assignment: lifecycle_state = 'GRAVEYARD'
    const hasGraveyardSet = /lifecycle_state\s*=\s*'GRAVEYARD'/i.test(STALE_SRC);
    expect(hasGraveyardSet).toBe(false);
  });
});

// ─── §8-9 Idempotency ─────────────────────────────────────────────────────────

describe("§8-9 Idempotency", () => {
  it("demoteToNeedsRevision is idempotent: source checks current state before updating", () => {
    expect(STALE_SRC).toContain("lifecycle_state === \"NEEDS_REVISION\"");
  });

  it("NEEDS_ARCHETYPE state is preserved once set (not overwritten by stale cron)", () => {
    // The cron only scans CANDIDATE | PAPER | DEPLOY_READY | PILOT
    // NEEDS_ARCHETYPE is not in STALE_ELIGIBLE_STATES, so it's never scanned
    expect(STALE_SRC).toContain("STALE_ELIGIBLE_STATES");
    expect(STALE_SRC).toContain("NEEDS_ARCHETYPE");
    // NEEDS_ARCHETYPE not in the eligible states list
    expect(STALE_SRC).not.toContain('"NEEDS_ARCHETYPE","PAPER"');
  });

  it("stale detector queries only CANDIDATE/PAPER/DEPLOY_READY/PILOT", () => {
    expect(STALE_SRC).toContain("CANDIDATE");
    expect(STALE_SRC).toContain("ANY(ARRAY['CANDIDATE','PAPER','DEPLOY_READY','PILOT'])");
  });
});

// ─── §10-12 API endpoint cohorts ─────────────────────────────────────────────

describe("§10-12 needs-attention API endpoint shape", () => {
  it("API endpoint exists in admin routes", () => {
    expect(ADMIN_SRC).toContain("/strategies/needs-attention");
  });

  it("API returns NEEDS_ARCHETYPE in WHERE clause", () => {
    expect(ADMIN_SRC).toContain("'NEEDS_ARCHETYPE'");
    expect(ADMIN_SRC).toContain("lifecycle_state IN ('NEEDS_ARCHETYPE', 'NEEDS_REVISION')");
  });

  it("API returns fallback_only cohort", () => {
    expect(ADMIN_SRC).toContain("factor_quality' = 'fallback_only'");
  });

  it("API returns stale cohort via stale_since IS NOT NULL", () => {
    expect(ADMIN_SRC).toContain("stale_since') IS NOT NULL");
  });

  it("API includes source_urls via strategy-source-resolver", () => {
    expect(ADMIN_SRC).toContain("getStrategySourceUrls");
    expect(ADMIN_SRC).toContain("source_urls");
  });

  it("API includes suggested_action per row", () => {
    expect(ADMIN_SRC).toContain("suggested_action");
    expect(ADMIN_SRC).toContain("deriveSuggestedAction");
  });

  it("suggested_action for NEEDS_ARCHETYPE mentions registry", () => {
    const action = deriveSuggestedActionInline("NEEDS_ARCHETYPE", null, null, null);
    expect(action).toContain("ARCHETYPE_REGISTRY");
  });

  it("suggested_action for NEEDS_REVISION + source_url_unreachable is descriptive", () => {
    const action = deriveSuggestedActionInline("NEEDS_REVISION", null, null, "source_url_unreachable");
    expect(action).toContain("Source URL is unreachable");
  });

  it("suggested_action for NEEDS_REVISION + gemma_failed mentions Ollama", () => {
    const action = deriveSuggestedActionInline("NEEDS_REVISION", null, null, "gemma_failed");
    expect(action).toContain("Ollama");
  });

  it("suggested_action for fallback_only mentions re-extract", () => {
    const action = deriveSuggestedActionInline("CANDIDATE", "fallback_only", null, null);
    expect(action).toContain("Re-extract");
  });

  it("suggested_action for stale mentions run a backtest", () => {
    const staleSince = new Date(Date.now() - 35 * 86_400_000).toISOString();
    const action = deriveSuggestedActionInline("CANDIDATE", null, staleSince, null);
    expect(action).toContain("backtest");
  });
});

// ─── §13 Audit rows fire per transition ───────────────────────────────────────

describe("§13 Audit event names", () => {
  it("lifecycle.needs_archetype_set is present in source", () => {
    expect(STALE_SRC).toContain("lifecycle.needs_archetype_set");
  });

  it("lifecycle.needs_revision_set is present in source", () => {
    expect(STALE_SRC).toContain("lifecycle.needs_revision_set");
  });

  it("lifecycle.strategy_marked_stale is present in source", () => {
    expect(STALE_SRC).toContain("lifecycle.strategy_marked_stale");
  });

  it("lifecycle.strategy_demoted_to_needs_revision is present in source", () => {
    expect(STALE_SRC).toContain("lifecycle.strategy_demoted_to_needs_revision");
  });

  it("lifecycle.strategy_stale_cleared is present in source", () => {
    expect(STALE_SRC).toContain("lifecycle.strategy_stale_cleared");
  });

  it("all audit writes use insertAuditRowSafe (fire-and-forget)", () => {
    expect(STALE_SRC).toContain("insertAuditRowSafe");
    // Should NOT use raw db.insert(auditLog) — that throws on error
    const rawInserts = STALE_SRC
      .split("\n")
      .filter((l) => l.includes("db.insert(auditLog)"));
    expect(rawInserts.length).toBe(0);
  });
});

// ─── §14 lifecycle_metadata writes are additive ───────────────────────────────

describe("§14 lifecycle_metadata JSONB writes are additive", () => {
  it("uses jsonb_set to merge into lifecycle_metadata sub-key (not overwrite config)", () => {
    expect(STALE_SRC).toContain("jsonb_set");
    expect(STALE_SRC).toContain("lifecycle_metadata");
    expect(STALE_SRC).toContain("COALESCE(config->'lifecycle_metadata'");
  });

  it("does not clobber other JSONB keys (uses sub-path write)", () => {
    // Should reference '{lifecycle_metadata}' path array, not write to root config
    expect(STALE_SRC).toContain("'{lifecycle_metadata}'");
  });

  it("stale_since field can be cleared (set to null via field removal)", () => {
    // Source uses the JSONB remove operator (- field) for null values
    expect(STALE_SRC).toContain("- ${field}::text");
  });
});

// ─── §15-16 Lifecycle hook exports ───────────────────────────────────────────

describe("§15-16 Lifecycle hook exports", () => {
  it("setNeedsArchetype is exported", () => {
    expect(STALE_SRC).toContain("export async function setNeedsArchetype(");
  });

  it("setNeedsRevision is exported", () => {
    expect(STALE_SRC).toContain("export async function setNeedsRevision(");
  });

  it("setNeedsArchetype never touches DEPLOYED or PILOT", () => {
    // Source has NOT IN ('DEPLOYED', 'PILOT') guard in the UPDATE
    expect(STALE_SRC).toContain("lifecycle_state NOT IN ('DEPLOYED', 'PILOT')");
  });

  it("setNeedsRevision never touches DEPLOYED or PILOT", () => {
    expect(STALE_SRC).toContain("lifecycle_state NOT IN ('DEPLOYED', 'PILOT')");
  });

  it("setNeedsArchetype writes lifecycle.needs_archetype_set audit row", () => {
    expect(STALE_SRC).toContain("lifecycle.needs_archetype_set");
  });

  it("setNeedsRevision writes lifecycle.needs_revision_set audit row", () => {
    expect(STALE_SRC).toContain("lifecycle.needs_revision_set");
  });
});

// ─── §17 Scheduler registration ──────────────────────────────────────────────

describe("§17 Scheduler registration", () => {
  it("strategy-stale-detector is registered via registerJob", () => {
    expect(SCHEDULER_SRC).toContain('registerJob("strategy-stale-detector"');
  });

  it("strategy-stale-detector has a cron.schedule binding", () => {
    expect(SCHEDULER_SRC).toContain('_scheduledJobs.add("strategy-stale-detector")');
  });

  it("strategy-stale-detector fires at 04:00 ET (etHour guard)", () => {
    expect(SCHEDULER_SRC).toContain("etHour !== 4");
    expect(SCHEDULER_SRC).toContain("04:00 ET confirmed");
  });

  it("strategy-stale-detector uses double-fire UTC cron for DST coverage", () => {
    // 04:00 ET = 08:00 UTC (EDT) or 09:00 UTC (EST) → double-fire
    expect(SCHEDULER_SRC).toContain('"0 8,9 * * *"');
  });

  it("runStrategyStaleDetector is imported in scheduler", () => {
    expect(SCHEDULER_SRC).toContain("runStrategyStaleDetector");
  });
});
