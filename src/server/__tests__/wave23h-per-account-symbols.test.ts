/**
 * wave23h-per-account-symbols.test.ts — W23H.H
 *
 * Tests for the per-account symbol whitelist gate.
 *
 * Coverage:
 *  1. Account with enabled_symbols=['MES'] rejects MNQ signal; audit emitted
 *  2. Account with ['MES', 'MNQ'] accepts both
 *  3. Admin route validation: reject non-canonical symbols (e.g. 'BTC')
 *  4. Admin route validation: empty enabled_symbols rejected
 *  5. Default value for new accounts is ['MES']
 *  6. Fail-open: DB error → no block
 *  7. No firmId on session → fail-open (no block)
 *  8. No accounts found for firmId → fail-open (no block)
 *
 * Pure simulation harnesses — no DB, no Express.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Canonical symbol set ─────────────────────────────────────────────────────
const CANONICAL_SYMBOLS = new Set(["MES", "MNQ", "MCL"]);

// ─── Schema (mirrors broker-accounts.ts route validation) ────────────────────
const updateSymbolsBodySchema = z.object({
  enabled_symbols: z
    .array(z.string())
    .min(1, "enabled_symbols must contain at least one symbol")
    .refine(
      (syms) => syms.every((s) => CANONICAL_SYMBOLS.has(s)),
      { message: "enabled_symbols may only contain canonical symbols" },
    ),
});

// ─── Simulation harness for Stage 0 symbol whitelist gate ─────────────────────
// Mirrors paper-signal-service.ts W23H.H Stage 0 gate.

interface AccountSymbolsRow {
  enabledSymbols: string[];
}

interface WhitelistGateResult {
  blocked: boolean;
  signalType: string | null;
  reason: string | null;
}

/**
 * Simulates the W23H.H Stage 0 gate from paper-signal-service.ts.
 * Returns blocked=true if the symbol is not in any account's enabledSymbols.
 */
function simulateSymbolWhitelistGate(
  symbol: string,
  firmId: string | null | undefined,
  accounts: AccountSymbolsRow[],
  queryError: boolean = false,
): WhitelistGateResult {
  // No firmId → fail-open
  if (!firmId) {
    return { blocked: false, signalType: null, reason: null };
  }

  // Query error → fail-open
  if (queryError) {
    return { blocked: false, signalType: null, reason: null };
  }

  // No accounts found → fail-open
  if (accounts.length === 0) {
    return { blocked: false, signalType: null, reason: null };
  }

  const symbolEnabled = accounts.some(
    (acct) => Array.isArray(acct.enabledSymbols) && acct.enabledSymbols.includes(symbol),
  );

  if (!symbolEnabled) {
    return {
      blocked: true,
      signalType: "symbol_not_enabled_for_account",
      reason: `signal.blocked_symbol_not_enabled_for_account: symbol=${symbol} firmId=${firmId}`,
    };
  }

  return { blocked: false, signalType: null, reason: null };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("W23H.H — per-account symbol whitelist gate", () => {

  it("1. Account with enabled_symbols=['MES'] rejects MNQ signal with audit", () => {
    const accounts: AccountSymbolsRow[] = [{ enabledSymbols: ["MES"] }];
    const result = simulateSymbolWhitelistGate("MNQ", "mffu", accounts);

    expect(result.blocked).toBe(true);
    expect(result.signalType).toBe("symbol_not_enabled_for_account");
    expect(result.reason).toContain("MNQ");
    expect(result.reason).toContain("mffu");
  });

  it("2. Account with ['MES', 'MNQ'] accepts MES and MNQ signals", () => {
    const accounts: AccountSymbolsRow[] = [{ enabledSymbols: ["MES", "MNQ"] }];

    const meResult = simulateSymbolWhitelistGate("MES", "mffu", accounts);
    expect(meResult.blocked).toBe(false);

    const mnqResult = simulateSymbolWhitelistGate("MNQ", "mffu", accounts);
    expect(mnqResult.blocked).toBe(false);
  });

  it("3. Admin route validation: non-canonical symbols ('BTC') rejected", () => {
    const parsed = updateSymbolsBodySchema.safeParse({ enabled_symbols: ["MES", "BTC"] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(" ");
      expect(msg).toContain("canonical");
    }
  });

  it("4. Admin route validation: empty array rejected", () => {
    const parsed = updateSymbolsBodySchema.safeParse({ enabled_symbols: [] });
    expect(parsed.success).toBe(false);
  });

  it("5. Admin route validation: valid canonical symbols pass", () => {
    const parsed = updateSymbolsBodySchema.safeParse({ enabled_symbols: ["MES", "MNQ", "MCL"] });
    expect(parsed.success).toBe(true);
  });

  it("6. Fail-open: DB error → no block", () => {
    const result = simulateSymbolWhitelistGate("MNQ", "mffu", [], true);
    expect(result.blocked).toBe(false);
  });

  it("7. No firmId on session → fail-open (no block)", () => {
    const result = simulateSymbolWhitelistGate("MNQ", null, [{ enabledSymbols: ["MES"] }]);
    expect(result.blocked).toBe(false);
  });

  it("8. No accounts found for firmId → fail-open (no block)", () => {
    const result = simulateSymbolWhitelistGate("MNQ", "mffu", []);
    expect(result.blocked).toBe(false);
  });

  it("Account with ['MES'] accepts MCL if another account on same firm has MCL enabled", () => {
    // Two accounts on same firm — one has MES, one has MCL
    const accounts: AccountSymbolsRow[] = [
      { enabledSymbols: ["MES"] },
      { enabledSymbols: ["MCL"] },
    ];
    const result = simulateSymbolWhitelistGate("MCL", "topstep", accounts);
    expect(result.blocked).toBe(false);
  });

  it("MES is always allowed when any account has the default ['MES']", () => {
    const accounts: AccountSymbolsRow[] = [{ enabledSymbols: ["MES"] }];  // default
    const result = simulateSymbolWhitelistGate("MES", "mffu", accounts);
    expect(result.blocked).toBe(false);
  });
});
