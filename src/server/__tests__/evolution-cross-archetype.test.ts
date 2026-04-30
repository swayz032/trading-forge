/**
 * Phase 4.4 — Cross-archetype mutation learning tests.
 *
 * Verifies that:
 * 1. The evolution service issues two separate cross-archetype queries (successes + failures)
 *    scoped by parentArchetype and excluding the current lineage.
 * 2. Cross-archetype results are capped at 20 each and merged into a distinct
 *    `cross_archetype_history` field in evolverConfig (not conflated with mutation_history).
 * 3. The Python evolver's build_mutation_prompt accepts cross_archetype_history as a separate
 *    parameter and renders it with a distinct header.
 * 4. The Python evolve() function reads cross_archetype_history from config and logs it.
 * 5. Lineage-only history section header is unchanged.
 * 6. No schema changes were required (join is on existing parentArchetype column).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const EVOLUTION_SERVICE_PATH = resolve(
  import.meta.dirname ?? ".",
  "../../server/services/evolution-service.ts",
);

const PARAMETER_EVOLVER_PATH = resolve(
  import.meta.dirname ?? ".",
  "../../engine/parameter_evolver.py",
);

const evolutionSrc = readFileSync(EVOLUTION_SERVICE_PATH, "utf8");
const evolverSrc = readFileSync(PARAMETER_EVOLVER_PATH, "utf8");

describe("Phase 4.4 — cross-archetype mutation learning", () => {
  // ── Evolution service: new drizzle-orm imports ─────────────────────────
  it("imports ne and isNotNull from drizzle-orm for cross-archetype filter", () => {
    expect(evolutionSrc).toMatch(/import\s*\{[^}]*\bne\b[^}]*\}\s*from\s*["']drizzle-orm["']/);
    expect(evolutionSrc).toMatch(/import\s*\{[^}]*\bisNotNull\b[^}]*\}\s*from\s*["']drizzle-orm["']/);
  });

  // ── Evolution service: archetype derivation ────────────────────────────
  it("derives currentArchetype from the first non-evolved tag on the strategy", () => {
    expect(evolutionSrc).toMatch(/currentArchetype/);
    expect(evolutionSrc).toMatch(/find\s*\(\s*\(t\)\s*=>\s*t\s*!==\s*["']evolved["']\s*\)/);
  });

  // ── Evolution service: two separate cross-archetype queries ───────────
  it("issues a success=true cross-archetype query capped at 20", () => {
    expect(evolutionSrc).toMatch(/crossArchetypeSuccesses/);
    // Must filter on success = true
    expect(evolutionSrc).toMatch(/eq\s*\(\s*mutationOutcomes\.success\s*,\s*true\s*\)/);
    // Must cap at 20
    const successBlock = evolutionSrc.match(/crossArchetypeSuccesses[\s\S]*?\.limit\((\d+)\)/);
    expect(successBlock).not.toBeNull();
    expect(successBlock![1]).toBe("20");
  });

  it("issues a success=false cross-archetype query capped at 20", () => {
    expect(evolutionSrc).toMatch(/crossArchetypeFailures/);
    expect(evolutionSrc).toMatch(/eq\s*\(\s*mutationOutcomes\.success\s*,\s*false\s*\)/);
    const failureBlock = evolutionSrc.match(/crossArchetypeFailures[\s\S]*?\.limit\((\d+)\)/);
    expect(failureBlock).not.toBeNull();
    expect(failureBlock![1]).toBe("20");
  });

  // ── Evolution service: cross-archetype filter correctness ─────────────
  it("filters cross-archetype queries by parentArchetype matching currentArchetype", () => {
    expect(evolutionSrc).toMatch(
      /eq\s*\(\s*mutationOutcomes\.parentArchetype\s*,\s*currentArchetype\s*\)/,
    );
  });

  it("excludes the current lineage from cross-archetype queries with ne()", () => {
    expect(evolutionSrc).toMatch(
      /ne\s*\(\s*mutationOutcomes\.strategyId\s*,\s*lineageRootId\s*\)/,
    );
  });

  it("guards cross-archetype queries so they only run when currentArchetype is non-null", () => {
    // Queries are wrapped in `currentArchetype ? await db... : []`
    expect(evolutionSrc).toMatch(/currentArchetype\s*\?\s*await\s*db/);
  });

  // ── Evolution service: evolverConfig separation ────────────────────────
  it("passes cross_archetype_history as a separate field in evolverConfig", () => {
    expect(evolutionSrc).toMatch(/cross_archetype_history\s*:/);
  });

  it("does not merge cross-archetype outcomes into mutation_history", () => {
    // crossArchetypeOutcomes must not appear in the mutation_history block
    const mutHistBlock = evolutionSrc.match(/mutation_history\s*:[\s\S]*?(?=cross_archetype_history)/);
    expect(mutHistBlock).not.toBeNull();
    expect(mutHistBlock![0]).not.toContain("crossArchetypeOutcomes");
  });

  it("sends null for cross_archetype_history when no cross-archetype outcomes exist", () => {
    expect(evolutionSrc).toMatch(/crossArchetypeOutcomes\.length\s*>\s*0/);
    expect(evolutionSrc).toMatch(/\?\s*crossArchetypeOutcomes\.map/);
    // Falls back to null
    expect(evolutionSrc).toMatch(/crossArchetypeOutcomes\.length\s*>\s*0[\s\S]*?:\s*null/);
  });

  // ── Python evolver: helper and prompt function ────────────────────────
  it("defines _summarise_mutation_outcomes as a shared helper", () => {
    expect(evolverSrc).toMatch(/def _summarise_mutation_outcomes\s*\(/);
  });

  it("build_mutation_prompt accepts cross_archetype_history parameter", () => {
    expect(evolverSrc).toMatch(/def build_mutation_prompt\s*\(/);
    expect(evolverSrc).toMatch(/cross_archetype_history\s*:/);
  });

  it("renders lineage history under 'Your lineage history' header", () => {
    expect(evolverSrc).toMatch(/Your lineage history/);
  });

  it("renders cross-archetype history under 'Cross-archetype insights' header", () => {
    expect(evolverSrc).toMatch(/Cross-archetype insights/);
  });

  it("cross-archetype section notes it is advisory and from different lineages", () => {
    expect(evolverSrc).toMatch(/advisory/i);
    expect(evolverSrc).toMatch(/sibling/i);
  });

  it("lineage and cross-archetype sections are distinct variables in the prompt", () => {
    expect(evolverSrc).toMatch(/lineage_section\s*=/);
    expect(evolverSrc).toMatch(/cross_archetype_section\s*=/);
  });

  // ── Python evolve(): reads and logs cross_archetype_history ──────────
  it("evolve() reads cross_archetype_history from the config JSON", () => {
    expect(evolverSrc).toMatch(/cross_archetype_history.*=.*config\.get\s*\(\s*["']cross_archetype_history["']\s*\)/);
  });

  it("evolve() logs the cross-archetype history count to stderr", () => {
    expect(evolverSrc).toMatch(/Cross-archetype history/);
    expect(evolverSrc).toMatch(/sibling lineages/);
  });

  it("evolve() passes cross_archetype_history to build_mutation_prompt", () => {
    expect(evolverSrc).toMatch(/cross_archetype_history\s*=\s*cross_archetype_history/);
  });

  // ── Schema: no new table needed ───────────────────────────────────────
  it("join uses existing mutationOutcomes.parentArchetype column — no new schema", () => {
    // The parentArchetype column already exists; the join is a WHERE filter only.
    // Verify the evolution service references mutationOutcomes.parentArchetype directly.
    expect(evolutionSrc).toMatch(/mutationOutcomes\.parentArchetype/);
  });
});
