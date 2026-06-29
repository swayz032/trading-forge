import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  runParityCheck,
  computeMissingGateKeys,
  isGateFamilyKey,
  extractPythonGateKeys,
  extractTsContractKeys,
  extractPythonDictKeys,
  DISPLAY_ONLY_ALLOWLIST,
  REQUIRED_TS_KEYS,
  PYTHON_WF_PATH,
  TS_CONTRACT_PATH,
} from "../../../scripts/check-ts-python-wf-metadata-parity.js";

/**
 * H-3 / F-3 / F-8 — proves the Python→TS WF-metadata parity tripwire:
 *   1. EXITS 0 against current code (Python and TS in sync today).
 *   2. Actually TRIPS when a known gate key would be missing from the TS type.
 */
describe("wf-metadata-parity gate", () => {
  it("PASSES against the current live source (Python ↔ TS in sync today)", () => {
    const result = runParityCheck();
    // If this fails, print the offending keys so the failure is self-explanatory.
    expect(result.missingFromTs, `Python gate keys absent from TS contract: ${result.missingFromTs.join(", ")}`).toEqual([]);
    expect(result.missingRequired, `REQUIRED TS keys deleted: ${result.missingRequired.join(", ")}`).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.pythonGateKeyCount).toBeGreaterThan(0);
    expect(result.tsKeyCount).toBeGreaterThan(0);
  });

  it("the actual Python source still emits every REQUIRED gate key", () => {
    // Guards the test's own assumptions: a REQUIRED key must really be a Python-written
    // gate key, otherwise the parity contract is vacuous.
    const pyKeys = extractPythonGateKeys(readFileSync(PYTHON_WF_PATH, "utf8"));
    for (const k of ["wfe_overall", "pbo_overall", "pbo_overall_p_value", "dsr_pass", "bif", "k_eff", "bif_reliable", "pbo_degenerate_reason"]) {
      expect(pyKeys.has(k), `Python should still write gate key "${k}"`).toBe(true);
    }
  });

  it("the live TS contract declares every REQUIRED key", () => {
    const tsKeys = extractTsContractKeys(readFileSync(TS_CONTRACT_PATH, "utf8"));
    for (const k of REQUIRED_TS_KEYS) {
      expect(tsKeys.has(k), `TS contract should declare "${k}"`).toBe(true);
    }
  });

  describe("computeMissingGateKeys — the core diff function TRIPS on drift", () => {
    it("TRIPS when a known gate key (pbo_overall) is missing from the TS type", () => {
      // Simulate a Python rename: Python still writes pbo_overall, but the TS type lost it.
      const pythonGateKeys = new Set(["wfe_overall", "pbo_overall", "dsr_pass", "bif"]);
      const tsKeysMissingPbo = new Set(["wfe_overall", "dsr_pass", "bif"]); // pbo_overall removed
      const missing = computeMissingGateKeys(pythonGateKeys, tsKeysMissingPbo, DISPLAY_ONLY_ALLOWLIST);
      expect(missing).toContain("pbo_overall");
      expect(missing.length).toBeGreaterThan(0);
    });

    it("TRIPS when Python adds a brand-new untracked gate key", () => {
      // Python introduces wfe_score (a rename of wfe_overall) that the TS type doesn't know.
      const pythonGateKeys = new Set(["wfe_overall", "wfe_score", "pbo_overall"]);
      const tsKeys = new Set(["wfe_overall", "pbo_overall"]);
      const missing = computeMissingGateKeys(pythonGateKeys, tsKeys, DISPLAY_ONLY_ALLOWLIST);
      expect(missing).toEqual(["wfe_score"]);
    });

    it("does NOT trip for keys on the documented display-only allowlist", () => {
      const pythonGateKeys = new Set(["pbo_detail", "wfe_hard_floor", "bif_detail"]);
      const tsKeys = new Set<string>(); // none tracked
      const missing = computeMissingGateKeys(pythonGateKeys, tsKeys, DISPLAY_ONLY_ALLOWLIST);
      expect(missing).toEqual([]);
    });

    it("does NOT trip when every Python gate key is tracked", () => {
      const pythonGateKeys = new Set(["wfe_overall", "pbo_overall", "dsr_pass"]);
      const tsKeys = new Set(["wfe_overall", "pbo_overall", "dsr_pass", "wfe_status"]);
      const missing = computeMissingGateKeys(pythonGateKeys, tsKeys, DISPLAY_ONLY_ALLOWLIST);
      expect(missing).toEqual([]);
    });
  });

  describe("isGateFamilyKey classification", () => {
    it("classifies the 6 grandfather-pass families", () => {
      for (const k of ["wfe_overall", "pbo_overall", "pbo", "dsr", "dsr_pass", "bif", "bif_reliable", "k_eff"]) {
        expect(isGateFamilyKey(k), `${k} should be a gate-family key`).toBe(true);
      }
    });

    it("does not classify unrelated result keys", () => {
      for (const k of ["mode", "n_paths", "confidence", "windows", "wf_metadata", "param_stability"]) {
        expect(isGateFamilyKey(k), `${k} should NOT be a gate-family key`).toBe(false);
      }
    });
  });

  describe("extractor helpers", () => {
    it("extractPythonDictKeys finds `\"key\":` literals", () => {
      const keys = extractPythonDictKeys('{ "pbo_overall": 0.1, "wfe_overall": None }');
      expect(keys.has("pbo_overall")).toBe(true);
      expect(keys.has("wfe_overall")).toBe(true);
    });

    it("extractTsContractKeys parses interface property names, skipping index signatures", () => {
      const src = `
export interface WfMetadataShape {
  dsr_pass?: boolean | null;
  [key: string]: unknown;
}
export interface WfResultsBlob {
  pbo_overall?: number | null;
}
export interface ParamStabilityShape {
  drift_classification?: string | null;
  [key: string]: unknown;
}
`;
      const keys = extractTsContractKeys(src);
      expect(keys.has("dsr_pass")).toBe(true);
      expect(keys.has("pbo_overall")).toBe(true);
      expect(keys.has("drift_classification")).toBe(true);
      expect(keys.has("key")).toBe(false); // index signature skipped
    });
  });
});
