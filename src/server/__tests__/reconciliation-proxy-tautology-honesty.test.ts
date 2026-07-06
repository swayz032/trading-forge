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

  it("check 1 is gated on the Option-B confirm flag OR proxy-independence; check 2 on proxy-independence", () => {
    // check 1 (production_trades vs traderspost): REAL when Option B is wired
    // (isTraderspostConfirmIndependent()), else proxy-gated — never an unconditional self-compare.
    const gate1Idx = SRC.indexOf("if (traderspostConfirmIndependent || PROXY_COUNT_LEGS_INDEPENDENT) {");
    expect(gate1Idx).toBeGreaterThan(-1);
    const check1Idx = SRC.indexOf('source: traderspostConfirmIndependent');
    expect(check1Idx).toBeGreaterThan(gate1Idx);

    // check 2 (traderspost vs tradovate) stays proxy-gated (tradovate needs SME/live fills)
    const gate2Idx = SRC.indexOf("if (PROXY_COUNT_LEGS_INDEPENDENT) {", gate1Idx);
    const check2Idx = SRC.indexOf('source: "traderspost_vs_tradovate_fills"');
    expect(gate2Idx).toBeGreaterThan(gate1Idx);
    expect(check2Idx).toBeGreaterThan(gate2Idx);

    // proxy-mode still logs the skip (with the Option-B activation hint) — no silent fake-pass
    const skipLogIdx = SRC.indexOf("count check 1 SKIPPED");
    expect(skipLogIdx).toBeGreaterThan(-1);
    expect(SRC).toContain("RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true");
  });
});
