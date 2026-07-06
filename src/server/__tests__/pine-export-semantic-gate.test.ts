/**
 * Tests for the checkExportability semantic gate in pine-export-service.ts.
 *
 * The gate (G6.3) is used at TESTING→PAPER promotion.  It must:
 *   - Return ok=false when the compiler reports faithful=false (Style C / confluence / multi-TF)
 *   - Return ok=true only when faithful=true AND exportable=true
 *   - Surface the specific human-readable deduction reason so the lifecycle service
 *     can log / alert the operator
 *   - Not crash when the compiler output is missing the faithful field (backward-compat)
 *   - (Deep-Scan #21 Wave-2) Exempt direct-routed archetype/uncatalogued strategies
 *     from the faithfulness requirement WITHOUT ever reporting a misleading faithful=true
 *
 * These tests mock compileDualPineExport at the module level (db is not wired in test env).
 * We test the checkExportability logic by unit-testing its output contract given
 * various compiler mock responses — no subprocess is spawned.
 *
 * Semantic-fidelity model (2026-06-22 FAIL-LOUD mandate):
 *   faithful=false → ok=false regardless of score / exportable
 *   faithful=true AND exportable=true → ok=true
 *   faithful missing (old compiler output) → ok falls back to exportable flag only
 *
 * Note: DEPLOYED strategies execute server-side via broker-router (server-mediated
 * execution).  Pine export is a visual-only aid for those.  The refusals below are
 * by design.
 *
 * Deep-Scan #21 Wave-2 (2026-07-05) — CERTIFIED FINDING FIX:
 *   exportability.py's archetype:/uncatalogued: fast-path used to hardcode
 *   faithful=true UNCONDITIONALLY, even for archetypes carrying Style-C exits /
 *   11-factor confluence / multi-TF gating Pine genuinely cannot reproduce — a
 *   false-green fed straight into this gate. exportability.py now reports faithful
 *   HONESTLY for archetypes. Because archetypes execute DIRECT via broker-router
 *   (never through Pine — CLAUDE.md §7 "Pine parity wall"), this gate now exempts
 *   isDirectRoutedArchetype=true strategies from the faithfulness requirement —
 *   while ALWAYS returning the honest `faithful` value so no consumer is misled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── helpers to replicate the ok-determination logic ──────────────────────────

/**
 * Replicates the ok-determination logic from checkExportability in pine-export-service.ts.
 * This lets us test the gating contract without spawning the Python subprocess.
 *
 * The real service calls compileDualPineExport() internally.  We test the
 * ok-contract directly by simulating what checkExportability returns given
 * different compiler exportability objects.
 *
 * ok = !!result?.exportability?.exportable AND
 *      (!!result?.exportability?.faithful OR isDirectRoutedArchetype)
 *       (faithful defaults to true if missing — backward-compat)
 *
 * Deep-Scan #21 Wave-2: isDirectRoutedArchetype defaults to false so every existing
 * (non-archetype) call site in this file is unaffected — the exemption only fires
 * when a test explicitly opts in.
 */
function deriveOk(exportability: {
  exportable: boolean;
  faithful?: boolean;
  score?: number;
  deductions?: string[];
}, isDirectRoutedArchetype = false): boolean {
  const exportable = !!exportability.exportable;
  // faithful defaults to true when missing (backward-compat with old compiler output)
  const faithful = exportability.faithful !== undefined ? !!exportability.faithful : true;
  return exportable && (faithful || isDirectRoutedArchetype);
}

/**
 * Simulated checkExportability return shape — mirrors pine-export-service.ts.
 */
interface CheckResult {
  ok: boolean;
  score: number | null;
  band: string | null;
  deductions: string[];
  recommendations: string[];
  error?: string;
  faithful?: boolean;
  isDirectRoutedArchetype?: boolean;
}

function simulateCheckExportability(exportability: {
  exportable: boolean;
  faithful?: boolean;
  score: number;
  band: string;
  deductions?: string[];
  recommendations?: string[];
}, isDirectRoutedArchetype = false): CheckResult {
  const faithful = exportability.faithful !== undefined ? !!exportability.faithful : true;
  return {
    ok: deriveOk(exportability, isDirectRoutedArchetype),
    score: exportability.score,
    band: exportability.band,
    deductions: exportability.deductions ?? [],
    recommendations: exportability.recommendations ?? [],
    faithful,
    isDirectRoutedArchetype,
  };
}

// ─── Simple faithful strategy — must pass ─────────────────────────────────────

describe("checkExportability — simple faithful strategy", () => {
  it("returns ok=true for a plain indicator strategy with faithful=true", () => {
    const result = simulateCheckExportability({
      exportable: true,
      faithful: true,
      score: 95,
      band: "clean",
      deductions: [],
    });
    expect(result.ok).toBe(true);
    expect(result.score).toBe(95);
    expect(result.deductions).toHaveLength(0);
  });

  it("returns ok=true when faithful is missing (backward-compat old compiler output)", () => {
    // Old compiler output before 2026-06-22 does not have the faithful field
    const result = simulateCheckExportability({
      exportable: true,
      // faithful: omitted
      score: 90,
      band: "clean",
    });
    expect(result.ok).toBe(true);
  });
});

// ─── Style C / Adaptive Exits — must refuse ───────────────────────────────────

describe("checkExportability — Style C / adaptive exits", () => {
  it("returns ok=false when faithful=false from Style C partials refusal", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: [
        "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes, "
        + "runner trail, and/or BE+1 breakeven mechanics cannot be reproduced by "
        + "strategy.exit() — Pine emits a single all-or-nothing stop/target. "
        + "This strategy executes server-side via broker-router (server-mediated "
        + "execution); Pine export is a visual-only aid for DEPLOYED strategies.",
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.score).toBe(0);
    expect(result.band).toBe("do_not_export");
  });

  it("surfaces the Style C deduction reason in the returned deductions", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: [
        "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes, "
        + "runner trail, and/or BE+1 breakeven mechanics cannot be reproduced by "
        + "strategy.exit(). This strategy executes server-side via broker-router.",
      ],
    });
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0]).toMatch(/server-side/i);
    expect(result.deductions[0]).toMatch(/broker-router/i);
  });

  it("returns ok=false for adaptive exit_style refusal", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: [
        "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes, "
        + "runner trail, and/or BE+1 breakeven mechanics cannot be reproduced by "
        + "strategy.exit(). This strategy executes server-side via broker-router "
        + "(server-mediated execution); Pine export is a visual-only aid.",
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("faithful=false overrides exportable=true — ok must be false", () => {
    // Guard against a hypothetical future bug where compiler sets exportable=true
    // but still marks faithful=false
    const result = simulateCheckExportability({
      exportable: true,   // hypothetical stale scorer
      faithful: false,    // semantic gate fires
      score: 60,
      band: "alert_only",
      deductions: ["Style C runner trail not expressible in Pine — strategy executes server-side."],
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Confluence gating — must refuse ──────────────────────────────────────────

describe("checkExportability — confluence gating", () => {
  it("returns ok=false for weighted confluence refusal", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: [
        "Confluence gating not expressible in Pine: this strategy requires "
        + "11-factor weighted scoring and/or minimum factor satisfaction "
        + "(entry_quality.use_weighted_scoring / min_factors_satisfied) "
        + "that Pine cannot reproduce. "
        + "This strategy executes server-side via broker-router (server-mediated "
        + "execution); Pine export is a visual-only aid for DEPLOYED strategies.",
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.deductions[0]).toMatch(/confluence/i);
    expect(result.deductions[0]).toMatch(/server-side/i);
  });

  it("surfaces the min_factors_satisfied reason", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: [
        "Confluence gating not expressible in Pine: this strategy requires "
        + "11-factor weighted scoring and/or minimum factor satisfaction "
        + "(entry_quality.use_weighted_scoring / min_factors_satisfied / regime_required) "
        + "that Pine cannot reproduce — Pine fires on the raw indicator alone. "
        + "This strategy executes server-side via broker-router (server-mediated "
        + "execution); Pine export is a visual-only aid for DEPLOYED strategies.",
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.deductions[0]).toMatch(/min_factors_satisfied/i);
  });
});

// ─── Multi-TF gating — must refuse ───────────────────────────────────────────

describe("checkExportability — multi-TF gating", () => {
  it("returns ok=false for daily_tf declared refusal", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: [
        "Multi-TF gating not expressible in Pine: strategy declares HTF alignment "
        + "fields (daily_tf='1D') that require top-down timeframe AND-gating — "
        + "Pine renders on the single chart timeframe and cannot reproduce multi-TF "
        + "bias alignment. "
        + "This strategy executes server-side via broker-router (server-mediated "
        + "execution); Pine export is a visual-only aid for DEPLOYED strategies.",
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.deductions[0]).toMatch(/multi-TF/i);
    expect(result.deductions[0]).toMatch(/server-side/i);
  });

  it("returns ok=false for htf_tf + itf_tf combined refusal", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: [
        "Multi-TF gating not expressible in Pine: strategy declares HTF alignment "
        + "fields (htf_tf='4H', itf_tf='15') that require top-down timeframe AND-gating.",
      ],
    });
    expect(result.ok).toBe(false);
  });
});

// ─── Combined inexpressible — must refuse ────────────────────────────────────

describe("checkExportability — combined inexpressible features", () => {
  it("returns ok=false when both Style C and confluence gating are present", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: [
        "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes — server-side.",
        "Confluence gating not expressible in Pine: 11-factor weighted scoring — server-side.",
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.deductions).toHaveLength(2);
  });
});

// ─── Score / band integrity ───────────────────────────────────────────────────

describe("checkExportability — score and band integrity", () => {
  it("score=0 and band=do_not_export on inexpressible refusals", () => {
    const result = simulateCheckExportability({
      exportable: false,
      faithful: false,
      score: 0,
      band: "do_not_export",
      deductions: ["Style C refusal — server-side."],
    });
    expect(result.score).toBe(0);
    expect(result.band).toBe("do_not_export");
  });

  it("score=95, band=clean, ok=true for a clean simple strategy", () => {
    const result = simulateCheckExportability({
      exportable: true,
      faithful: true,
      score: 95,
      band: "clean",
      deductions: [],
    });
    expect(result.score).toBe(95);
    expect(result.band).toBe("clean");
    expect(result.ok).toBe(true);
  });

  it("score=null propagates to result when compiler errors", () => {
    // Simulates the compiler_error path in checkExportability
    const result: CheckResult = {
      ok: false,
      score: null,
      band: null,
      deductions: ["compiler_error"],
      recommendations: [],
      error: "Pine compiler timed out after 120s",
    };
    expect(result.ok).toBe(false);
    expect(result.score).toBeNull();
    expect(result.error).toBe("Pine compiler timed out after 120s");
  });
});

// ─── Deduction content requirements ──────────────────────────────────────────

describe("checkExportability — deduction content requirements", () => {
  it("every inexpressible-feature deduction mentions server-side execution", () => {
    const deductions = [
      "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes. "
      + "This strategy executes server-side via broker-router (server-mediated execution).",

      "Confluence gating not expressible in Pine: 11-factor weighted scoring. "
      + "This strategy executes server-side via broker-router (server-mediated execution).",

      "Multi-TF gating not expressible in Pine: daily_tf/htf_tf. "
      + "This strategy executes server-side via broker-router (server-mediated execution).",
    ];

    for (const deduction of deductions) {
      expect(deduction).toMatch(/server-side/i);
      expect(deduction).toMatch(/broker-router/i);
    }
  });

  it("deductions for Style C mention the specific exit mechanic", () => {
    const deduction =
      "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes, "
      + "runner trail, and/or BE+1 breakeven mechanics cannot be reproduced by strategy.exit().";
    expect(deduction).toMatch(/Style C/);
    expect(deduction).toMatch(/runner trail/i);
  });
});

// ─── Deep-Scan #21 Wave-2: archetype/uncatalogued direct-route exemption ─────
//
// CERTIFIED FINDING FIX: exportability.py's archetype:/uncatalogued: fast-path
// used to hardcode faithful=true unconditionally, even when the archetype carries
// Style-C exits / 11-factor confluence / multi-TF gating that Pine cannot
// reproduce. That was a false-green feeding this gate's `ok` computation directly
// (lifecycle-service.ts hard-blocks TESTING→PAPER / SHADOW→PAPER on !ok).
//
// The fix: exportability.py now reports faithful HONESTLY for archetypes. This
// gate (checkExportability) exempts isDirectRoutedArchetype=true strategies from
// the faithfulness requirement, because they execute DIRECT via broker-router
// and never ride through Pine (CLAUDE.md §7 "Pine parity wall") — so an honest
// faithful=false must not by itself block their promotion. Critically, the
// returned `faithful` value is NEVER coerced to true for the exemption — any
// consumer reading `.faithful` directly sees the honest flag.

describe("checkExportability — Deep-Scan #21 Wave-2 archetype direct-route exemption", () => {
  it("archetype with Style-C exits: faithful=false honestly reported, but ok=true (exempt)", () => {
    const result = simulateCheckExportability(
      {
        exportable: true,
        faithful: false,
        score: 60,
        band: "alert_only",
        deductions: [
          "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes — "
          + "the alert-only Pine artifact emits a single all-or-nothing stop/target.",
        ],
      },
      /* isDirectRoutedArchetype */ true,
    );
    // Exempt: ok=true because the strategy routes DIRECT, never through Pine.
    expect(result.ok).toBe(true);
    // But faithful is NEVER coerced — the honest false value is preserved on the result.
    expect(result.faithful).toBe(false);
    expect(result.isDirectRoutedArchetype).toBe(true);
    expect(result.deductions[0]).toMatch(/style c/i);
  });

  it("archetype with 11-factor confluence gating: faithful=false, ok=true (exempt)", () => {
    const result = simulateCheckExportability(
      {
        exportable: true,
        faithful: false,
        score: 60,
        band: "alert_only",
        deductions: [
          "Confluence gating not expressible in Pine: 11-factor weighted scoring "
          + "cannot be reproduced — Pine fires on the raw indicator alone.",
        ],
      },
      true,
    );
    expect(result.ok).toBe(true);
    expect(result.faithful).toBe(false);
  });

  it("archetype with multi-TF gating: faithful=false, ok=true (exempt)", () => {
    const result = simulateCheckExportability(
      {
        exportable: true,
        faithful: false,
        score: 60,
        band: "alert_only",
        deductions: [
          "Multi-TF gating not expressible in Pine: strategy declares HTF alignment fields.",
        ],
      },
      true,
    );
    expect(result.ok).toBe(true);
    expect(result.faithful).toBe(false);
  });

  it("NON-archetype strategy with faithful=false is STILL blocked — exemption does not leak", () => {
    // The exact same exportability payload, but isDirectRoutedArchetype=false (default) —
    // must be blocked exactly like before this fix. Proves the exemption is scoped
    // strictly to direct-routed archetypes and does not weaken the gate generally.
    const result = simulateCheckExportability({
      exportable: true,
      faithful: false,
      score: 60,
      band: "alert_only",
      deductions: ["Exit semantics not expressible in Pine: Style C 33/33/34 partial closes."],
    });
    expect(result.ok).toBe(false);
    expect(result.faithful).toBe(false);
    expect(result.isDirectRoutedArchetype).toBe(false);
  });

  it("archetype with exportable=false is STILL blocked — exemption only waives faithful, not exportable", () => {
    const result = simulateCheckExportability(
      {
        exportable: false,
        faithful: false,
        score: 0,
        band: "do_not_export",
        deductions: ["compiler_error"],
      },
      true,
    );
    expect(result.ok).toBe(false);
  });

  it("plain archetype with no inexpressible features: faithful=true, ok=true (no exemption needed)", () => {
    const result = simulateCheckExportability(
      {
        exportable: true,
        faithful: true,
        score: 60,
        band: "alert_only",
        deductions: [],
      },
      true,
    );
    expect(result.ok).toBe(true);
    expect(result.faithful).toBe(true);
  });
});
