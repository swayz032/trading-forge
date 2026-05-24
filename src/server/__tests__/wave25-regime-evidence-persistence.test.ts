/**
 * wave25-regime-evidence-persistence.test.ts — Wave 25 Pass 6 P6.A3+A4
 *
 * Coverage (carry-forward close from P6.A1):
 *   1. bias-state-service captures regime_evidence + institutional_regime from
 *      the Python emit shape and exposes them for SQL INSERT into the new
 *      bias_state.regime_evidence JSONB column (migration 0142 idx 144).
 *   2. bias_engine.regime_classified audit event is emitted with full evidence
 *      payload + correlation_id when institutional_regime is non-null
 *      (§10b reconstruction mandate).
 *   3. Pre-Wave-25.10 emit shape (no institutional_regime/regime_evidence keys)
 *      maps to null + null and skips the regime_classified audit row
 *      (backward-compat fail-open).
 *
 * Strategy: instead of spinning up the real Python runner + DB, we verify the
 * contract by extracting + asserting on the runtime shape that bias-state-
 * service expects from the inline Python script (the `runPythonModule<{...}>`
 * generic type). This is a contract test — the source-of-truth pairing is
 * (a) the Python `emit()` function signature and (b) the TS runPythonModule
 * generic.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const BIAS_STATE_SERVICE_PATH = path.resolve(
  __dirname,
  "../services/bias-state-service.ts",
);
const BIAS_ENGINE_PY_PATH = path.resolve(
  __dirname,
  "../../engine/context/bias_engine.py",
);

const biasStateSource = fs.readFileSync(BIAS_STATE_SERVICE_PATH, "utf8");
const biasEnginePySource = fs.readFileSync(BIAS_ENGINE_PY_PATH, "utf8");

describe("Wave 25 Pass 6 P6.A3+A4 — regime_evidence persistence + audit emit", () => {
  it("declares institutional_regime + regime_evidence in the runPythonModule generic", () => {
    // The Python script emits these two keys per P6.A3+A4. The TS generic
    // must declare them so the typed read in bias-state-service captures them.
    expect(biasStateSource).toMatch(
      /institutional_regime:\s*string\s*\|\s*null/,
    );
    expect(biasStateSource).toMatch(
      /regime_evidence:\s*Record<string,\s*unknown>\s*\|\s*null/,
    );
  });

  it("captures regime_evidence + institutional_regime from biasResult into locals", () => {
    expect(biasStateSource).toContain(
      "regimeEvidenceJson = biasResult.regime_evidence",
    );
    expect(biasStateSource).toContain(
      "institutionalRegimeLabel = biasResult.institutional_regime",
    );
  });

  it("includes regime_evidence column in the INSERT statement (carry-forward close)", () => {
    // The SQL INSERT into bias_state must reference the new column added by
    // migration 0142. We assert on the column name presence in the column list
    // and on the parameterized JSON.stringify value bound to it.
    expect(biasStateSource).toMatch(
      /INSERT INTO bias_state[\s\S]*regime_evidence[\s\S]*VALUES/,
    );
    expect(biasStateSource).toContain(
      "regimeEvidenceJson != null ? JSON.stringify(regimeEvidenceJson) : null",
    );
  });

  it("emits bias_engine.regime_classified audit event with full evidence payload", () => {
    expect(biasStateSource).toContain('action: "bias_engine.regime_classified"');
    // Required §10b fields surface on the audit result block:
    expect(biasStateSource).toMatch(
      /institutional_regime:\s*institutionalRegimeLabel/,
    );
    expect(biasStateSource).toMatch(/atr_percentile_vs_30d/);
    expect(biasStateSource).toMatch(/primary_driver/);
    expect(biasStateSource).toMatch(/session_health/);
    expect(biasStateSource).toMatch(/correlationId,/);
  });

  it("guards the regime_classified audit on non-null institutional_regime + evidence", () => {
    // Fail-open: pre-Wave-25.10 callers or engine-exception paths produce
    // null/null and must skip the audit row entirely (no garbage audits).
    expect(biasStateSource).toMatch(
      /if\s*\(institutionalRegimeLabel\s*!=\s*null\s*&&\s*regimeEvidenceJson\s*!=\s*null\)\s*\{/,
    );
  });

  it("Python emit() function exposes institutional_regime + regime_evidence parameters", () => {
    // The inline Python script in bias-state-service.ts is the producer side
    // of the contract. The emit() signature must accept the new fields.
    expect(biasStateSource).toMatch(
      /def emit\([^)]*institutional_regime=None[^)]*regime_evidence=None\)/,
    );
  });

  it("RegimeEvidence dataclass in bias_engine.py uses primitives only (JSONB round-trip safety)", () => {
    // §10b: evidence persisted to JSONB must round-trip cleanly. Confirm the
    // 6 documented fields exist on the dataclass.
    expect(biasEnginePySource).toMatch(/class RegimeEvidence/);
    expect(biasEnginePySource).toMatch(/atr_percentile_vs_30d:\s*float/);
    expect(biasEnginePySource).toMatch(/volume_ratio_vs_session_avg:\s*float/);
    expect(biasEnginePySource).toMatch(/range_size_vs_atr:\s*float/);
    expect(biasEnginePySource).toMatch(/is_macro_event_day:\s*bool/);
    expect(biasEnginePySource).toMatch(/session_health:\s*str/);
    expect(biasEnginePySource).toMatch(/primary_driver:\s*str/);
  });
});
