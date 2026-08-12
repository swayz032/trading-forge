/**
 * SOURCE-RISK-HANDOFF-1 / UNIT E (overlay half)
 *
 * Authority: AR-1059 (gpt-rulings 8e9ea5bc) §4 UNIT E, §5 RED->GREEN 4.
 *
 * THE DEFECT
 * ----------
 * `framework-overlay.ts:327-331` replaced ANY `stop_loss.type !== "atr"` with
 * `atr 1.5x`. So the `source_structural` stop that UNIT A preserves at the onboarding
 * boundary (AR-1061) would be destroyed by the very next stage — the overlay runs
 * immediately after onboarding builds the config.
 *
 * AR-1059 §3: framework defaults apply ONLY to genuinely untaught risk fields; Trading
 * Forge's institutional risk stays available as a separately labelled TF_OVERLAY_VARIANT,
 * "not as a silent replacement inside SOURCE_FAITHFUL."
 *
 * ⚠️ AND THE WARNING TEXT WAS INVERTED. It read "is non-structural; CLAUDE.md §13
 * forbids fixed-point stops" — but `CLAUDE.md:255` is titled "Stop Loss — structural,
 * NEVER fixed-point" and `:704` forbids FIXED-POINT stops while REQUIRING structural ones.
 * The message cited a clause that says the opposite of what the message claimed. No test
 * pinned that string, so it is corrected here (reported in AR-1058 §2).
 *
 * WHAT MUST NOT CHANGE: every legacy path. The overlay is operator-canonical.
 */
import { describe, expect, it } from "vitest";

import { applyFrameworkOverlay } from "../framework-overlay";

function configWithStop(stop_loss: Record<string, unknown>) {
  return {
    direction: "long",
    entry_type: "market",
    strategy: {
      entry_long: "close > open",
      entry_short: "close < open",
      stop_loss,
      position_size: { type: "risk_derived_pyramid" },
    },
    metadata: { source: "spec_onboarding" },
  };
}

const SOURCE_STOP = {
  type: "source_structural",
  anchor: "fvg_low",
  required_anchor: "fvg",
  include_wick: true,
  source_exact: true,
  ownership: "source",
  span: { start: 13860, end: 15745 },
};

describe("UNIT E — the overlay must not silently replace a source-owned stop", () => {
  it("preserves a SOURCE_FAITHFUL structural stop byte-for-byte", () => {
    const result = applyFrameworkOverlay({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compiled: configWithStop({ ...SOURCE_STOP }) as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.strategy?.stop_loss).toEqual(SOURCE_STOP);
  });

  it("does not emit an ATR override for a source-owned stop", () => {
    const result = applyFrameworkOverlay({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compiled: configWithStop({ ...SOURCE_STOP }) as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    const sl = result.config.strategy?.stop_loss as Record<string, unknown>;
    expect(sl.type).not.toBe("atr");
    expect(sl.multiplier).toBeUndefined();
    expect(sl.source_exact).toBe(true);
    expect(sl.ownership).toBe("source");
  });

  it("keeps the taught anchor and wick flag intact through the overlay", () => {
    const result = applyFrameworkOverlay({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compiled: configWithStop({ ...SOURCE_STOP }) as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    const sl = result.config.strategy?.stop_loss as Record<string, unknown>;
    expect(sl.anchor).toBe("fvg_low");
    expect(sl.required_anchor).toBe("fvg");
    expect(sl.include_wick).toBe(true);
    expect(sl.span).toEqual({ start: 13860, end: 15745 });
  });
});

describe("UNIT E — legacy overlay behaviour is UNCHANGED", () => {
  it("still replaces a genuinely unsupported non-atr stop type", () => {
    const result = applyFrameworkOverlay({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compiled: configWithStop({ type: "fixed_point", multiplier: 10 }) as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.strategy?.stop_loss).toEqual({ type: "atr", multiplier: 1.5 });
  });

  it("still raises an ATR multiplier below the framework floor", () => {
    const result = applyFrameworkOverlay({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compiled: configWithStop({ type: "atr", multiplier: 0.5 }) as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    const sl = result.config.strategy?.stop_loss as Record<string, unknown>;
    expect(sl.type).toBe("atr");
    expect(sl.multiplier).toBe(1.5);
  });

  it("still leaves a compliant ATR stop alone", () => {
    const result = applyFrameworkOverlay({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compiled: configWithStop({ type: "atr", multiplier: 2.0 }) as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    const sl = result.config.strategy?.stop_loss as Record<string, unknown>;
    expect(sl.multiplier).toBe(2.0);
  });

  it("a structural-looking stop NOT stamped ownership=source is still replaced", () => {
    // Guard against the exemption being claimable by shape alone. Ownership is the key.
    const result = applyFrameworkOverlay({
      compiled: configWithStop({
        type: "source_structural",
        anchor: "fvg_low",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.strategy?.stop_loss).toEqual({ type: "atr", multiplier: 1.5 });
  });
});
