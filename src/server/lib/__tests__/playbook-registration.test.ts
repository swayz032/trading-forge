import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerStrategiesInPlaybook,
  deriveCategoryFromArchetype,
  PLAYBOOK_CATEGORIES,
} from "../playbook-registration.js";

// Minimal fixture mirroring the real shape of playbook_router.py's 4 list literals
// (src/engine/context/playbook_router.py:65-69) — single-line assignment, double-quoted
// strings, comma-separated.
const FIXTURE_SOURCE = `"""Playbook Router fixture for tests."""

CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion"]
REVERSAL_STRATS = ["breaker", "eqhl_raid"]
MEAN_REV_STRATS = ["ny_lunch_reversal", "midnight_open"]
ORB_STRATS = ["iofed", "ict_scalp"]
ALL_STRATS = CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS
`;

describe("playbook-registration — registerStrategiesInPlaybook", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "playbook-router-test-"));
    filePath = join(dir, "playbook_router_fixture.py");
    writeFileSync(filePath, FIXTURE_SOURCE, "utf-8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds a new strategy name to the target category list", () => {
    const result = registerStrategiesInPlaybook(filePath, ["vwap_reversal_mes_5m"], "CONTINUATION_STRATS");
    expect(result.ok).toBe(true);
    expect(result.added).toEqual(["vwap_reversal_mes_5m"]);

    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain('"vwap_reversal_mes_5m"');
    // Must remain inside CONTINUATION_STRATS specifically.
    const contMatch = updated.match(/CONTINUATION_STRATS\s*=\s*\[([^\]]*)\]/);
    expect(contMatch![1]).toContain("vwap_reversal_mes_5m");
  });

  it("REGISTRATION-VISIBILITY: a registered strategy name is present in ALL_STRATS composition", () => {
    // ALL_STRATS is defined as CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS
    // in the real file. We prove visibility by reconstructing that union from the 4 lists after
    // registration and checking membership — this is the same union apply_eligibility_gate's
    // `from src.engine.context.playbook_router import ALL_STRATS` sees at Python import time.
    registerStrategiesInPlaybook(filePath, ["order_block_mnq_15m"], "REVERSAL_STRATS");
    const updated = readFileSync(filePath, "utf-8");

    const allNames: string[] = [];
    for (const cat of PLAYBOOK_CATEGORIES) {
      const m = updated.match(new RegExp(`${cat}\\s*=\\s*\\[([^\\]]*)\\]`));
      if (m) {
        for (const tok of m[1].split(",")) {
          const cleaned = tok.trim().replace(/^["']|["']$/g, "");
          if (cleaned) allNames.push(cleaned);
        }
      }
    }
    expect(allNames).toContain("order_block_mnq_15m");
  });

  it("is idempotent — re-registering the same name does not duplicate it", () => {
    registerStrategiesInPlaybook(filePath, ["dup_strategy_mes_5m"], "ORB_STRATS");
    const secondResult = registerStrategiesInPlaybook(filePath, ["dup_strategy_mes_5m"], "ORB_STRATS");

    expect(secondResult.ok).toBe(true);
    expect(secondResult.added).toEqual([]);
    expect(secondResult.alreadyPresent).toEqual(["dup_strategy_mes_5m"]);

    const updated = readFileSync(filePath, "utf-8");
    const occurrences = updated.split("dup_strategy_mes_5m").length - 1;
    expect(occurrences).toBe(1);
  });

  it("detects a name already registered under a DIFFERENT category as already-present (no cross-category dupe)", () => {
    registerStrategiesInPlaybook(filePath, ["cross_cat_mes_5m"], "CONTINUATION_STRATS");
    const result = registerStrategiesInPlaybook(filePath, ["cross_cat_mes_5m"], "MEAN_REV_STRATS");
    expect(result.alreadyPresent).toEqual(["cross_cat_mes_5m"]);
    expect(result.added).toEqual([]);
  });

  it("fails cleanly (ok=false, reason set) when the file does not exist — never throws", () => {
    const result = registerStrategiesInPlaybook(join(dir, "nonexistent.py"), ["x"], "ORB_STRATS");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("read_failed");
  });

  it("fails cleanly when the category list pattern is not found in the file", () => {
    writeFileSync(filePath, "# empty file, no lists here\n", "utf-8");
    const result = registerStrategiesInPlaybook(filePath, ["x"], "ORB_STRATS");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("category_list_not_found");
  });

  it("preserves all pre-existing entries untouched (additive-only diff)", () => {
    registerStrategiesInPlaybook(filePath, ["new_one"], "CONTINUATION_STRATS");
    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain('"ote"');
    expect(updated).toContain('"ict_swing"');
    expect(updated).toContain('"propulsion"');
    expect(updated).toContain('"breaker"');
    expect(updated).toContain('"eqhl_raid"');
  });
});

describe("playbook-registration — deriveCategoryFromArchetype", () => {
  it("defaults to CONTINUATION_STRATS when archetype is null (documented default)", () => {
    expect(deriveCategoryFromArchetype(null)).toBe("CONTINUATION_STRATS");
  });

  it("routes breaker/mitigation/distribution/upthrust archetypes to REVERSAL_STRATS", () => {
    expect(deriveCategoryFromArchetype("ict_breaker")).toBe("REVERSAL_STRATS");
    expect(deriveCategoryFromArchetype("ict_mitigation")).toBe("REVERSAL_STRATS");
    expect(deriveCategoryFromArchetype("wyckoff_distribution")).toBe("REVERSAL_STRATS");
    expect(deriveCategoryFromArchetype("wyckoff_upthrust")).toBe("REVERSAL_STRATS");
  });

  it("routes midnight_open/lunch_reversal archetypes to MEAN_REV_STRATS", () => {
    expect(deriveCategoryFromArchetype("ict_midnight_open")).toBe("MEAN_REV_STRATS");
    expect(deriveCategoryFromArchetype("ict_ny_lunch_reversal")).toBe("MEAN_REV_STRATS");
  });

  it("routes iofed/scalp archetypes to ORB_STRATS", () => {
    expect(deriveCategoryFromArchetype("ict_iofed")).toBe("ORB_STRATS");
    expect(deriveCategoryFromArchetype("ict_scalp")).toBe("ORB_STRATS");
  });
});
