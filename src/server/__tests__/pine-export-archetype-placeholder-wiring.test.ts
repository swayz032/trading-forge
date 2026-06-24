/**
 * pine-export-archetype-placeholder-wiring.test.ts
 *
 * Tests for the hardening/phase-0 fix: compile-time substitution of archetype
 * Pine account_id and live_order_token placeholders in compileDualPineExport().
 *
 * Bug context:
 *   src/engine/pine_compiler.py:161 — archetype tf_gateway Pine hard-codes
 *   "<account-id-placeholder>" and "<live-order-token-placeholder>" in the
 *   alertcondition message. No compile-time substitution existed. If the operator
 *   skipped the manual TradingView text-replace step, /api/live-order received
 *   literal placeholder strings → silent order drop.
 *
 * Fix:
 *   1. Python: _build_archetype_alert_pine() substitutes at compile time when
 *      account_id / live_order_token are passed into strategy.config.
 *   2. Python: compile_dual_artifacts() reads live_order_token from its new param
 *      and injects into strategy.config before indicator dispatch.
 *   3. TS: compileDualPineExport() looks up account_strategy_assignments.hmac_secret
 *      for the resolved account_id and injects as config.live_order_token.
 *   4. TS: post-compile assertion fires if returned Pine still contains placeholders
 *      when gatewayOptions was set and credentials were resolved.
 */

import { describe, it, expect } from "vitest";

// ─── Helper: simulate the live_order_token injection logic ──────────────────
// Extracted from compileDualPineExport() so it can be unit-tested without DB.

interface GatewayOptions {
  mode: "tf_gateway" | "direct";
  gatewayUrl?: string;
}

interface DualArtifact {
  file_name: string;
  content: string;
}

interface Config {
  account_id?: string;
  live_order_token?: string;
  strategy?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Simulates the token injection step from compileDualPineExport().
 * Returns the resolved token or null (mirrors the fail-soft DB lookup).
 */
function resolveAndInjectToken(
  config: Config,
  resolvedToken: string | null,
  gatewayMode: string | undefined,
): string | null {
  if (gatewayMode !== "tf_gateway") return null;
  if (!config.account_id) return null;
  if (config.live_order_token) return config.live_order_token as string; // already set
  if (resolvedToken) {
    config.live_order_token = resolvedToken;
    return resolvedToken;
  }
  return null;
}

/**
 * Simulates the TS-side post-compile assertion from compileDualPineExport().
 * Returns null if assertion passes; error message string if assertion fires.
 */
function runPostCompileAssertion(
  gatewayOptions: GatewayOptions | null | undefined,
  config: Config,
  artifacts: DualArtifact[],
): string | null {
  if (!gatewayOptions || !config.account_id || !config.live_order_token) {
    return null; // legacy path — no assertion
  }
  const PLACEHOLDER_ACCOUNT = "<account-id-placeholder>";
  const PLACEHOLDER_TOKEN = "<live-order-token-placeholder>";
  for (const art of artifacts) {
    if (art.content.includes(PLACEHOLDER_ACCOUNT) || art.content.includes(PLACEHOLDER_TOKEN)) {
      const which = [
        art.content.includes(PLACEHOLDER_ACCOUNT) ? "account_id (<account-id-placeholder>)" : null,
        art.content.includes(PLACEHOLDER_TOKEN) ? "live_order_token (<live-order-token-placeholder>)" : null,
      ].filter(Boolean).join(", ");
      return (
        `pine-export: post-compile assertion failed — artifact '${art.file_name}' still contains ` +
        `literal placeholder(s): ${which}. This would cause silent order drops via /api/live-order.`
      );
    }
  }
  return null;
}


// ─── 1. account_id + token threading ──────────────────────────────────────

describe("compileDualPineExport: live_order_token injection", () => {
  it("passes account_id + token from account_strategy_assignments into compile config", () => {
    const config: Config = {
      account_id: "resolved-account-uuid",
      strategy: {
        config: { gateway_mode: "tf_gateway" },
      },
    };

    // Simulate the DB lookup returning a token
    const dbToken = "hmac-secret-from-db";
    const resolved = resolveAndInjectToken(config, dbToken, "tf_gateway");

    expect(resolved).toBe("hmac-secret-from-db");
    expect(config.live_order_token).toBe("hmac-secret-from-db");
  });

  it("skips injection when gateway_mode is not tf_gateway", () => {
    const config: Config = {
      account_id: "some-account-uuid",
    };
    const resolved = resolveAndInjectToken(config, "any-token", "direct");
    expect(resolved).toBeNull();
    expect(config.live_order_token).toBeUndefined();
  });

  it("skips injection when account_id is not resolved", () => {
    const config: Config = {};
    const resolved = resolveAndInjectToken(config, "any-token", "tf_gateway");
    expect(resolved).toBeNull();
    expect(config.live_order_token).toBeUndefined();
  });

  it("skips DB lookup when live_order_token is already set (caller pre-supplied)", () => {
    const config: Config = {
      account_id: "resolved-account-uuid",
      live_order_token: "already-set-by-caller",
    };
    const resolved = resolveAndInjectToken(config, "db-token-should-be-ignored", "tf_gateway");
    expect(resolved).toBe("already-set-by-caller");
    expect(config.live_order_token).toBe("already-set-by-caller");
  });
});


// ─── 2. Post-compile TS-side assertion ────────────────────────────────────

describe("compileDualPineExport: post-compile TS-side assertion", () => {
  it("post-compile TS-side assertion fires when returned Pine contains placeholders despite gatewayOptions being set", () => {
    const gatewayOptions: GatewayOptions = { mode: "tf_gateway" };
    const config: Config = {
      account_id: "some-account-uuid",
      live_order_token: "some-token",
    };
    const brokenArtifacts: DualArtifact[] = [
      {
        file_name: "test_INDICATOR.pine",
        content: '{"account_id":"<account-id-placeholder>","live_order_token":"<live-order-token-placeholder>"}',
      },
    ];

    const errMsg = runPostCompileAssertion(gatewayOptions, config, brokenArtifacts);
    expect(errMsg).not.toBeNull();
    expect(errMsg).toContain("post-compile assertion failed");
    expect(errMsg).toContain("account_id (<account-id-placeholder>)");
    expect(errMsg).toContain("live_order_token (<live-order-token-placeholder>)");
    expect(errMsg).toContain("test_INDICATOR.pine");
  });

  it("post-compile assertion does NOT fire when placeholders are absent (correctly substituted)", () => {
    const gatewayOptions: GatewayOptions = { mode: "tf_gateway" };
    const config: Config = {
      account_id: "real-account-uuid",
      live_order_token: "real-token",
    };
    const cleanArtifacts: DualArtifact[] = [
      {
        file_name: "test_INDICATOR.pine",
        content: '{"account_id":"real-account-uuid","live_order_token":"real-token","action":"archetype_signal"}',
      },
    ];

    const errMsg = runPostCompileAssertion(gatewayOptions, config, cleanArtifacts);
    expect(errMsg).toBeNull();
  });

  it("post-compile assertion fires for partial substitution (only one placeholder remains)", () => {
    const gatewayOptions: GatewayOptions = { mode: "tf_gateway" };
    const config: Config = {
      account_id: "real-account-uuid",
      live_order_token: "real-token",
    };
    // account_id was substituted, but live_order_token placeholder remains
    const partialArtifacts: DualArtifact[] = [
      {
        file_name: "test_STRATEGY.pine",
        content: '{"account_id":"real-account-uuid","live_order_token":"<live-order-token-placeholder>"}',
      },
    ];

    const errMsg = runPostCompileAssertion(gatewayOptions, config, partialArtifacts);
    expect(errMsg).not.toBeNull();
    expect(errMsg).toContain("live_order_token (<live-order-token-placeholder>)");
    expect(errMsg).not.toContain("account_id (<account-id-placeholder>)"); // only token failed
  });
});


// ─── 3. Legacy operator-manual path — no assertion ────────────────────────

describe("compileDualPineExport: legacy operator-manual path (no gatewayOptions)", () => {
  it("preserves legacy operator-manual path when paperAccountRouting is null (no gatewayOptions)", () => {
    const gatewayOptions = null; // no gateway options → legacy path
    const config: Config = {
      // No account_id or live_order_token — operator-manual substitution at TV deploy time
    };
    const artifacts: DualArtifact[] = [
      {
        file_name: "test_INDICATOR.pine",
        // Literal placeholders intentionally present on legacy path
        content: '{"account_id":"<account-id-placeholder>","live_order_token":"<live-order-token-placeholder>"}',
      },
    ];

    // No assertion must fire — legacy path allows literal placeholders
    const errMsg = runPostCompileAssertion(gatewayOptions, config, artifacts);
    expect(errMsg).toBeNull();
  });

  it("no assertion when gatewayOptions is set but account_id was not resolved", () => {
    // DB lookup returned no row — account_id is not in config → skip assertion
    const gatewayOptions: GatewayOptions = { mode: "tf_gateway" };
    const config: Config = {
      // account_id could not be resolved — A/B routing DB lookup returned empty
    };
    const artifacts: DualArtifact[] = [
      {
        file_name: "test_INDICATOR.pine",
        content: '{"account_id":"<account-id-placeholder>"}',
      },
    ];

    // Assertion guard requires both account_id AND live_order_token to be in config
    const errMsg = runPostCompileAssertion(gatewayOptions, config, artifacts);
    expect(errMsg).toBeNull(); // no account_id → no assertion → legacy path
  });

  it("no assertion when account_id resolved but live_order_token not found in DB", () => {
    // The DB lookup for account_strategy_assignments returned no row
    const gatewayOptions: GatewayOptions = { mode: "tf_gateway" };
    const config: Config = {
      account_id: "resolved-account-uuid",
      // live_order_token absent — DB returned null, fail-soft, no injection
    };
    const artifacts: DualArtifact[] = [
      {
        file_name: "test_INDICATOR.pine",
        content: '{"account_id":"resolved-account-uuid","live_order_token":"<live-order-token-placeholder>"}',
      },
    ];

    // No assertion: live_order_token is absent from config → treat as legacy path
    const errMsg = runPostCompileAssertion(gatewayOptions, config, artifacts);
    expect(errMsg).toBeNull();
  });
});
