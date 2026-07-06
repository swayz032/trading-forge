/**
 * reconciliation-proxy-tautology-honesty.test.ts
 *
 * Deep-scan A honesty guard.
 *
 * The daily reconciliation "3-way count check" compared production_trades /
 * traderspost_log / tradovate_fills — but the latter two legs are 1:1 PROXIES of the
 * production_trades count (fetchTraderspostLogCount / fetchTradovateFillsCount both
 * return the shared count), so checks 1 & 2 were self-comparisons that can NEVER surface
 * a mismatch. Recording them as "0 mismatches (pass)" overstated assurance.
 *
 * A genuine independent count leg needs Option B — a TradersPost webhook-confirm consumer
 * writing traderspost_confirmed_at, or live tradovate_fill_id under server-mediated
 * execution — both out of the current hardening scope. Until then, checks 1 & 2 must be
 * SKIPPED (gated on PROXY_COUNT_LEGS_INDEPENDENT), not fake-passing.
 *
 * Source-structural assertions (the comparison is inline in runDailyReconciliation, which
 * has heavy DB/alert dependencies — same convention as paper-signal-service-deepscan-findings).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// NOTE: do NOT import reconciliation-service.js at runtime — it transitively boots the db
// module ("DATABASE_URL required") at collection time. Assert against source text instead.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../production/reconciliation-service.ts"),
  "utf-8",
);

describe("deep-scan A — proxy count legs must not fake-pass a 3-way reconciliation", () => {
  it("PROXY_COUNT_LEGS_INDEPENDENT is declared false while the legs are proxies", () => {
    // Flip to true only in the SAME change that wires distinct-column independent queries.
    expect(SRC).toMatch(/export const PROXY_COUNT_LEGS_INDEPENDENT\s*=\s*false;/);
  });

  it("count checks 1 & 2 are gated on PROXY_COUNT_LEGS_INDEPENDENT (not unconditional)", () => {
    // The self-comparison must sit inside `if (PROXY_COUNT_LEGS_INDEPENDENT) { ... }`.
    const gateIdx = SRC.indexOf("if (PROXY_COUNT_LEGS_INDEPENDENT) {");
    expect(gateIdx).toBeGreaterThan(-1);
    const check1Idx = SRC.indexOf('source: "production_trades_vs_traderspost"');
    const check2Idx = SRC.indexOf('source: "traderspost_vs_tradovate_fills"');
    expect(check1Idx).toBeGreaterThan(gateIdx);
    expect(check2Idx).toBeGreaterThan(gateIdx);
    // and the gate must close (else-branch logs the skip) before the independent Check 3
    const elseIdx = SRC.indexOf("count cross-checks (1,2) SKIPPED", gateIdx);
    const check3Idx = SRC.indexOf('source: "pnl_mffu_vs_expected"');
    expect(elseIdx).toBeGreaterThan(gateIdx);
    expect(check3Idx).toBeGreaterThan(elseIdx);
  });
});
