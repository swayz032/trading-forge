/**
 * pine-export-gateway-options.test.ts
 *
 * Pass 4 Track B — Gateway options threading through pine-export-service.ts
 *
 * Verifies:
 *   1. deriveGatewayOptions pure-function logic (env-driven default + explicit override)
 *   2. Source-level assertions that gateway_mode/gateway_url are injected into both
 *      compileDualPineExport and compilePineExport config dicts before serialization
 *   3. Fallback audit action name is correct (pine_export.fallback_direct_path)
 *   4. Discord WARN + audit are ONLY fired on implicit fallback (not on explicit opt-in)
 *
 * Strategy: deriveGatewayOptions is a pure exported function — tested directly against
 * env var manipulation. Service-level config injection is verified via source-text
 * assertions (mirrors wave7-http-correlation.test.ts pattern) because the full service
 * requires a live DB + Python subprocess that are not available in unit context.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// Import from the pure lib module — avoids transitive DB import that requires DATABASE_URL
import { deriveGatewayOptions, type GatewayOptions } from "../../lib/pine-gateway-options.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PINE_EXPORT_SERVICE = resolve(__dirname, "../pine-export-service.ts");

function readService(): string {
  return readFileSync(PINE_EXPORT_SERVICE, "utf-8");
}

// ---------------------------------------------------------------------------
// deriveGatewayOptions — pure-function unit tests
// ---------------------------------------------------------------------------

describe("deriveGatewayOptions — env-driven default resolution", () => {
  const originalEnv = process.env["LIVE_ORDER_GATEWAY_URL"];

  beforeEach(() => {
    // Ensure clean slate before each test that manipulates the env
    delete process.env["LIVE_ORDER_GATEWAY_URL"];
  });

  afterEach(() => {
    // Restore original value (may be undefined)
    if (originalEnv !== undefined) {
      process.env["LIVE_ORDER_GATEWAY_URL"] = originalEnv;
    } else {
      delete process.env["LIVE_ORDER_GATEWAY_URL"];
    }
  });

  it("LIVE_ORDER_GATEWAY_URL set → resolves tf_gateway mode without fallback audit", () => {
    process.env["LIVE_ORDER_GATEWAY_URL"] = "https://my-gateway.example.com";
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-123");
    expect(opts.mode).toBe("tf_gateway");
    expect(opts.gatewayUrl).toBe("https://my-gateway.example.com");
    expect(shouldAuditFallback).toBe(false);
  });

  it("LIVE_ORDER_GATEWAY_URL set with whitespace → trims and resolves tf_gateway", () => {
    process.env["LIVE_ORDER_GATEWAY_URL"] = "  https://trimmed-url.example.com  ";
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-123");
    expect(opts.mode).toBe("tf_gateway");
    expect(opts.gatewayUrl).toBe("https://trimmed-url.example.com");
    expect(shouldAuditFallback).toBe(false);
  });

  it("LIVE_ORDER_GATEWAY_URL unset → resolves direct mode with fallback audit flag set", () => {
    // env var already deleted in beforeEach
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-456");
    expect(opts.mode).toBe("direct");
    expect(opts.gatewayUrl).toBeUndefined();
    expect(shouldAuditFallback).toBe(true);
  });

  it("LIVE_ORDER_GATEWAY_URL empty string → treated as unset, resolves direct mode with fallback", () => {
    process.env["LIVE_ORDER_GATEWAY_URL"] = "";
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-789");
    expect(opts.mode).toBe("direct");
    expect(shouldAuditFallback).toBe(true);
  });

  it("LIVE_ORDER_GATEWAY_URL whitespace-only → treated as unset, resolves direct mode with fallback", () => {
    process.env["LIVE_ORDER_GATEWAY_URL"] = "   ";
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-abc");
    expect(opts.mode).toBe("direct");
    expect(shouldAuditFallback).toBe(true);
  });
});

describe("deriveGatewayOptions — explicit gatewayOptions override", () => {
  it("explicit {mode:'direct'} → no fallback audit regardless of env (operator opted in deliberately)", () => {
    process.env["LIVE_ORDER_GATEWAY_URL"] = "https://ignored.example.com";
    const explicit: GatewayOptions = { mode: "direct" };
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-123", explicit);
    expect(opts.mode).toBe("direct");
    expect(shouldAuditFallback).toBe(false);
    delete process.env["LIVE_ORDER_GATEWAY_URL"];
  });

  it("explicit {mode:'direct'} with env unset → still no fallback audit (deliberate opt-in)", () => {
    delete process.env["LIVE_ORDER_GATEWAY_URL"];
    const explicit: GatewayOptions = { mode: "direct" };
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-123", explicit);
    expect(opts.mode).toBe("direct");
    expect(shouldAuditFallback).toBe(false);
  });

  it("explicit {mode:'tf_gateway', gatewayUrl:'https://custom-url'} → uses custom URL, no fallback", () => {
    delete process.env["LIVE_ORDER_GATEWAY_URL"];
    const explicit: GatewayOptions = { mode: "tf_gateway", gatewayUrl: "https://custom-url.example.com" };
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-xyz", explicit);
    expect(opts.mode).toBe("tf_gateway");
    expect(opts.gatewayUrl).toBe("https://custom-url.example.com");
    expect(shouldAuditFallback).toBe(false);
  });

  it("explicit {mode:'tf_gateway'} without gatewayUrl → no gatewayUrl on result", () => {
    const explicit: GatewayOptions = { mode: "tf_gateway" };
    const { opts, shouldAuditFallback } = deriveGatewayOptions("strat-xyz", explicit);
    expect(opts.mode).toBe("tf_gateway");
    expect(opts.gatewayUrl).toBeUndefined();
    expect(shouldAuditFallback).toBe(false);
  });

  it("explicit override takes priority over env even when env is set to tf_gateway URL", () => {
    process.env["LIVE_ORDER_GATEWAY_URL"] = "https://env-url.example.com";
    const explicit: GatewayOptions = { mode: "tf_gateway", gatewayUrl: "https://explicit-url.example.com" };
    const { opts } = deriveGatewayOptions("strat-123", explicit);
    expect(opts.gatewayUrl).toBe("https://explicit-url.example.com");
    delete process.env["LIVE_ORDER_GATEWAY_URL"];
  });
});

// ---------------------------------------------------------------------------
// Source-level assertions — verify gateway_mode/gateway_url injected into config
// dicts before serialization in both compileDualPineExport and compilePineExport.
// This mirrors the wave7-http-correlation.test.ts source-scan pattern.
// ---------------------------------------------------------------------------

describe("pine-export-service.ts source — gateway_mode injection (compileDualPineExport)", () => {
  it("injects gateway_mode into strategy.config sub-dict in compileDualPineExport path", () => {
    const src = readService();
    // Verify the injection block exists in the dual-export section (before pine-dual-config tmpPath)
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    expect(dualTmpIdx).toBeGreaterThan(0);
    const relevantSection = src.slice(0, dualTmpIdx);
    // Track A pine_compiler.py reads strategy["config"]["gateway_mode"] — injected into innerConfig
    expect(relevantSection).toMatch(/innerConfig\["gateway_mode"\]\s*=\s*gwOpts\.mode/);
  });

  it("injects gateway_url into strategy.config sub-dict when gatewayUrl present in compileDualPineExport path", () => {
    const src = readService();
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const relevantSection = src.slice(0, dualTmpIdx);
    expect(relevantSection).toMatch(/innerConfig\["gateway_url"\]\s*=\s*gwOpts\.gatewayUrl/);
  });

  it("uses deriveGatewayOptions before tmpPath write in compileDualPineExport", () => {
    const src = readService();
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const relevantSection = src.slice(0, dualTmpIdx);
    expect(relevantSection).toMatch(/deriveGatewayOptions\(/);
  });

  it("fires pine_export.fallback_direct_path audit action when shouldAuditFallback in compileDualPineExport", () => {
    const src = readService();
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const relevantSection = src.slice(0, dualTmpIdx);
    expect(relevantSection).toMatch(/pine_export\.fallback_direct_path/);
  });

  it("fires notifyWarning with appendFamilyGradePostscript on fallback in compileDualPineExport", () => {
    const src = readService();
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const relevantSection = src.slice(0, dualTmpIdx);
    // Verify the notifyWarning + appendFamilyGradePostscript pair exists in the gateway block
    // (not just in the shadow-guard block)
    const gatewayBlockStart = relevantSection.lastIndexOf("Pass 4 Track B");
    expect(gatewayBlockStart).toBeGreaterThan(0);
    const gatewayBlock = relevantSection.slice(gatewayBlockStart);
    expect(gatewayBlock).toMatch(/notifyWarning/);
    expect(gatewayBlock).toMatch(/appendFamilyGradePostscript/);
  });
});

describe("pine-export-service.ts source — gateway_mode injection (compilePineExport)", () => {
  it("injects gateway_mode into strategy.config sub-dict in compilePineExport path", () => {
    const src = readService();
    // compilePineExport uses a different tmpPath pattern (pine-config- with randomUUID)
    const singleTmpIdx = src.indexOf("pine-config-${randomUUID()}");
    expect(singleTmpIdx).toBeGreaterThan(0);
    // The relevant section is between the dual-config tmpPath and single-config tmpPath
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const relevantSection = src.slice(dualTmpIdx, singleTmpIdx);
    // Track A pine_compiler.py reads strategy["config"]["gateway_mode"] — injected into innerConfig
    expect(relevantSection).toMatch(/innerConfig\["gateway_mode"\]\s*=\s*gwOpts\.mode/);
  });

  it("injects gateway_url into strategy.config sub-dict when gatewayUrl present in compilePineExport path", () => {
    const src = readService();
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const singleTmpIdx = src.indexOf("pine-config-${randomUUID()}");
    const relevantSection = src.slice(dualTmpIdx, singleTmpIdx);
    expect(relevantSection).toMatch(/innerConfig\["gateway_url"\]\s*=\s*gwOpts\.gatewayUrl/);
  });

  it("uses deriveGatewayOptions before tmpPath write in compilePineExport", () => {
    const src = readService();
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const singleTmpIdx = src.indexOf("pine-config-${randomUUID()}");
    const relevantSection = src.slice(dualTmpIdx, singleTmpIdx);
    expect(relevantSection).toMatch(/deriveGatewayOptions\(/);
  });

  it("fires pine_export.fallback_direct_path audit action when shouldAuditFallback in compilePineExport", () => {
    const src = readService();
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const singleTmpIdx = src.indexOf("pine-config-${randomUUID()}");
    const relevantSection = src.slice(dualTmpIdx, singleTmpIdx);
    expect(relevantSection).toMatch(/pine_export\.fallback_direct_path/);
  });

  it("fires notifyWarning with appendFamilyGradePostscript on fallback in compilePineExport", () => {
    const src = readService();
    const dualTmpIdx = src.indexOf("pine-dual-config-");
    const singleTmpIdx = src.indexOf("pine-config-${randomUUID()}");
    const relevantSection = src.slice(dualTmpIdx, singleTmpIdx);
    const gatewayBlockStart = relevantSection.lastIndexOf("Pass 4 Track B");
    expect(gatewayBlockStart).toBeGreaterThan(0);
    const gatewayBlock = relevantSection.slice(gatewayBlockStart);
    expect(gatewayBlock).toMatch(/notifyWarning/);
    expect(gatewayBlock).toMatch(/appendFamilyGradePostscript/);
  });
});

describe("pine-export-service.ts source — function signature contracts", () => {
  it("compileDualPineExport signature includes optional gatewayOptions parameter", () => {
    const src = readService();
    // The signature block starts at the function declaration
    const fnIdx = src.indexOf("export async function compileDualPineExport(");
    expect(fnIdx).toBeGreaterThan(0);
    const signatureBlock = src.slice(fnIdx, src.indexOf(") {", fnIdx) + 3);
    expect(signatureBlock).toMatch(/gatewayOptions\?\s*:\s*GatewayOptions/);
  });

  it("compilePineExport signature includes optional gatewayOptions parameter", () => {
    const src = readService();
    const fnIdx = src.indexOf("export async function compilePineExport(");
    expect(fnIdx).toBeGreaterThan(0);
    const signatureBlock = src.slice(fnIdx, src.indexOf(") {", fnIdx) + 3);
    expect(signatureBlock).toMatch(/gatewayOptions\?\s*:\s*GatewayOptions/);
  });

  it("GatewayOptions interface is exported from pine-gateway-options lib", () => {
    const libSrc = readFileSync(
      resolve(__dirname, "../../lib/pine-gateway-options.ts"),
      "utf-8",
    );
    expect(libSrc).toMatch(/export interface GatewayOptions/);
  });

  it("deriveGatewayOptions is exported from pine-gateway-options lib", () => {
    const libSrc = readFileSync(
      resolve(__dirname, "../../lib/pine-gateway-options.ts"),
      "utf-8",
    );
    expect(libSrc).toMatch(/export function deriveGatewayOptions/);
  });

  it("pine-export-service.ts re-exports GatewayOptions and deriveGatewayOptions from the lib", () => {
    const src = readService();
    expect(src).toMatch(/export type \{ GatewayOptions \}/);
    expect(src).toMatch(/export \{ deriveGatewayOptions \}/);
  });

  it("snake_case key 'gateway_mode' is the key passed to Python (not camelCase)", () => {
    const src = readService();
    // Must be gateway_mode (snake_case matching pine_compiler.py expectation)
    // Injected via innerConfig["gateway_mode"] into the strategy.config sub-dict
    expect(src).toMatch(/innerConfig\["gateway_mode"\]/);
    // Must NOT introduce a camelCase key at runtime
    expect(src).not.toMatch(/innerConfig\["gatewayMode"\]/);
  });

  it("snake_case key 'gateway_url' is the key passed to Python (not camelCase)", () => {
    const src = readService();
    // Injected via innerConfig["gateway_url"] into the strategy.config sub-dict
    expect(src).toMatch(/innerConfig\["gateway_url"\]/);
    expect(src).not.toMatch(/innerConfig\["gatewayUrl"\]/);
  });

  it("gateway_mode is injected into strategy.config sub-dict (Track A reads strategy['config']['gateway_mode'])", () => {
    const src = readService();
    // Must use innerConfig — a sub-dict of config["strategy"] — not a top-level config key.
    // pine_compiler.py reads: strategy.get("config", {}).get("gateway_mode")
    // where strategy == input_json["strategy"] == config["strategy"].
    expect(src).toMatch(/const innerConfig = /);
    expect(src).toMatch(/strategyObj\["config"\]\s*=\s*innerConfig/);
  });
});

describe("pine-export-service.ts source — recipient-service call graph", () => {
  it("pine-export-recipient-service imports compileDualPineExport (not its own Python call)", () => {
    const recipientService = readFileSync(
      resolve(__dirname, "../pine-export-recipient-service.ts"),
      "utf-8",
    );
    expect(recipientService).toMatch(/import.*compileDualPineExport.*from.*pine-export-service/);
  });

  it("pine-export-recipient-service does NOT have its own runDualPineCompiler call (inherits via compileDualPineExport)", () => {
    const recipientService = readFileSync(
      resolve(__dirname, "../pine-export-recipient-service.ts"),
      "utf-8",
    );
    expect(recipientService).not.toMatch(/runDualPineCompiler|runPineCompiler/);
  });
});
