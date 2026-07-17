/**
 * w3a-paper-signal-service-fallback-audit-wiring.test.ts — ratify-packet W3A
 * (Execution Hardening, 2026-07-17), Item 3.
 *
 * evaluateSignals() has too large a gateway-dependency surface for an
 * isolated behavioral test (DB, bar buffer, indicators, broker calls, SSE,
 * audit_log — dozens of mocks with no incremental signal over a
 * source-structure assertion) — see paper-signal-service-deepscan-findings.test.ts
 * and goalscan-crit-dll-blackout-force-close.test.ts's documented convention.
 * So: the REAL detection logic is behaviorally tested directly against the
 * leaf module in lib/__tests__/position-size-fallback.test.ts; THIS file
 * pins the call-site WIRING (source-structure) so a future edit can't
 * silently detach the detector from the audit row, or reintroduce a
 * per-field fallback without threading it through detectPositionSizeFallbacks.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "../services/paper-signal-service.ts"), "utf-8");
const LEAF_SRC = readFileSync(resolve(__dirname, "../lib/position-size-fallback.ts"), "utf-8");

describe("W3A item 3: paper-signal-service.ts wiring — position-size-fallback detector", () => {
  it("imports detectPositionSizeFallbacks + POSITION_SIZE_FALLBACK_DEFAULTS from the new leaf module", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*detectPositionSizeFallbacks[^}]*\}\s*from\s*"\.\.\/lib\/position-size-fallback\.js"/);
    expect(SRC).toMatch(/import\s*\{[^}]*POSITION_SIZE_FALLBACK_DEFAULTS[^}]*\}\s*from\s*"\.\.\/lib\/position-size-fallback\.js"/);
  });

  it("calls detectPositionSizeFallbacks(rawPositionSize, symbol) inside the risk_derived_pyramid branch, BEFORE constructing positionSizeConfig", () => {
    const branchIdx = SRC.indexOf('if (rawPositionSize?.type === "risk_derived_pyramid")');
    const detectIdx = SRC.indexOf("const positionSizeFallbacks = detectPositionSizeFallbacks(rawPositionSize, symbol);", branchIdx);
    const configIdx = SRC.indexOf("const positionSizeConfig: RiskSizingInputs[\"positionSizeConfig\"] = {", branchIdx);

    expect(branchIdx).toBeGreaterThan(-1);
    expect(detectIdx).toBeGreaterThan(branchIdx);
    expect(configIdx).toBeGreaterThan(detectIdx);
  });

  it("all 6 fallback ternaries reference POSITION_SIZE_FALLBACK_DEFAULTS (not bare literals) so detection and construction cannot drift", () => {
    const configIdx = SRC.indexOf("const positionSizeConfig: RiskSizingInputs[\"positionSizeConfig\"] = {");
    expect(configIdx).toBeGreaterThan(-1);
    const configBlock = SRC.slice(configIdx, configIdx + 1600);

    expect(configBlock).toContain("POSITION_SIZE_FALLBACK_DEFAULTS.base_contracts");
    expect(configBlock).toContain("POSITION_SIZE_FALLBACK_DEFAULTS.tier_increment");
    expect(configBlock).toContain("POSITION_SIZE_FALLBACK_DEFAULTS.tier_threshold_dollars");
    expect(configBlock).toContain("POSITION_SIZE_FALLBACK_DEFAULTS.personal_dll_pct");
    expect(configBlock).toContain("POSITION_SIZE_FALLBACK_DEFAULTS.max_risk_pct_per_trade");
    // liquidity_comfort_cap keeps its own per-symbol LIQUIDITY_COMFORT_CAPS lookup
    // (not a POSITION_SIZE_FALLBACK_DEFAULTS constant — the detector handles this
    // one specially too, see position-size-fallback.ts).
    expect(configBlock).toContain("LIQUIDITY_COMFORT_CAPS[symbol.toUpperCase()] ?? LIQUIDITY_COMFORT_CAP_DEFAULT");
  });

  it("fires sizing.position_size_fallback_applied guarded by positionSizeFallbacks.length > 0 (no false positives on the overlaid path)", () => {
    const actionIdx = SRC.indexOf('"sizing.position_size_fallback_applied"');
    expect(actionIdx).toBeGreaterThan(-1);
    const before = SRC.slice(Math.max(0, actionIdx - 400), actionIdx);
    expect(before).toContain("if (positionSizeFallbacks.length > 0)");
  });

  it("the audit row payload lists which fields fell back and their fallback values (not just a boolean)", () => {
    const actionIdx = SRC.indexOf('"sizing.position_size_fallback_applied"');
    const nextChunk = SRC.slice(actionIdx, actionIdx + 500);
    expect(nextChunk).toContain("fallbackFields: positionSizeFallbacks.map((f) => f.field)");
    expect(nextChunk).toContain("fallbacks: positionSizeFallbacks");
  });

  it("does NOT change any of the 6 fallback VALUES (base_contracts stays 6, not re-baselined to 9)", () => {
    // Documented in position-size-fallback.ts: the base_contracts=6 fallback no
    // longer matches the current canonical pyramid base (9) — this is a KNOWN,
    // DELIBERATE mismatch (visibility-only fix, not a re-baseline). Pin it so a
    // future "helpful" edit doesn't silently change the fallback value under
    // the guise of an unrelated refactor. The literal now lives ONLY in the leaf
    // module (paper-signal-service.ts references the constant, not a literal).
    expect(LEAF_SRC).toContain("base_contracts: 6");
    expect(SRC).not.toMatch(/base_contracts:\s*rawPositionSize\.base_contracts\s*:\s*9/);
  });

  it("insertAuditRow is used (already imported at the top of the file — no new import needed for the writer itself)", () => {
    expect(SRC).toMatch(/import\s*\{\s*insertAuditRow\s*\}\s*from\s*"\.\.\/lib\/audit-log-helper\.js"/);
  });
});
