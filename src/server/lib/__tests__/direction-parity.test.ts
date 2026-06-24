/**
 * Directional parity classifier tests (2026-06-24 Layer 3B).
 * Locks the evidence-accumulation logic, the 5-class output, the confidence model, and the
 * CRITICAL symmetric-indicator guard (symmetric ≠ bidirectional).
 */
import { describe, it, expect } from "vitest";
import {
  extractDirectionEvidence,
  classifyDirection,
  classifyDirectionFromTranscript,
} from "../direction-parity.js";

describe("extractDirectionEvidence", () => {
  it("detects explicit long + short rule blocks", () => {
    const ev = extractDirectionEvidence(
      "We go long when price breaks above the level with a bullish entry. " +
        "We go short when price breaks below with a bearish entry.",
    );
    expect(ev.long_rules_present).toBe(true);
    expect(ev.short_rules_present).toBe(true);
  });

  it("detects mirror language + strength", () => {
    const ev = extractDirectionEvidence("Go long on the bullish setup. For shorts it's the opposite for shorts.");
    expect(ev.mirror_language).toBe(true);
    expect(ev.mirror_strength).toBeGreaterThanOrEqual(0.8);
  });

  it("does NOT treat 'long term' / 'as long as' as a long marker", () => {
    const ev = extractDirectionEvidence("In the long term, as long as price holds, the trend continues.");
    expect(ev.long_rules_present).toBe(false);
  });
});

describe("classifyDirection — operator's exact logic", () => {
  const base = {
    long_rule_count: 0, short_rule_count: 0, mirror_strength: 0,
    long_markers: [] as string[], short_markers: [] as string[], mirror_markers: [] as string[],
  };

  it("long + short → BIDIRECTIONAL_EXPLICIT", () => {
    const r = classifyDirection({ ...base, long_rules_present: true, long_rule_count: 3, short_rules_present: true, short_rule_count: 3, mirror_language: false });
    expect(r.class).toBe("BIDIRECTIONAL_EXPLICIT");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("long + mirror (no explicit short) → LONG_WITH_IMPLIED_MIRROR", () => {
    const r = classifyDirection({ ...base, long_rules_present: true, long_rule_count: 2, short_rules_present: false, mirror_language: true, mirror_strength: 0.6 });
    expect(r.class).toBe("LONG_WITH_IMPLIED_MIRROR");
    expect(r.confidence).toBeLessThan(0.95); // weaker than explicit-both
  });

  it("short + mirror → SHORT_WITH_IMPLIED_MIRROR", () => {
    const r = classifyDirection({ ...base, short_rules_present: true, short_rule_count: 2, long_rules_present: false, mirror_language: true, mirror_strength: 0.8 });
    expect(r.class).toBe("SHORT_WITH_IMPLIED_MIRROR");
  });

  it("long only → LONG_ONLY", () => {
    const r = classifyDirection({ ...base, long_rules_present: true, long_rule_count: 2, short_rules_present: false, mirror_language: false });
    expect(r.class).toBe("LONG_ONLY");
  });

  it("short only → SHORT_ONLY", () => {
    const r = classifyDirection({ ...base, short_rules_present: true, short_rule_count: 1, long_rules_present: false, mirror_language: false });
    expect(r.class).toBe("SHORT_ONLY");
  });

  it("no evidence → NO_DIRECTION_EVIDENCE", () => {
    const r = classifyDirection({ ...base, long_rules_present: false, short_rules_present: false, mirror_language: false });
    expect(r.class).toBe("NO_DIRECTION_EVIDENCE");
  });
});

describe("CRITICAL guard — symmetric indicator ≠ bidirectional", () => {
  it("'RSI crosses 70 → watch for reversal' yields NO_DIRECTION_EVIDENCE (not bidirectional)", () => {
    const r = classifyDirectionFromTranscript(
      "When the Relative Strength Index crosses 70, watch for a reversal. The setup uses the 14-period RSI.",
    );
    // No explicit long/short directional language → must not be inferred bidirectional.
    expect(r.class).toBe("NO_DIRECTION_EVIDENCE");
  });
});

describe("W7nln regression — explicit short must NOT collapse to implied mirror", () => {
  it("a transcript teaching both bullish and bearish entries classifies BIDIRECTIONAL_EXPLICIT", () => {
    const t =
      "Break above the overnight high, retest, look for a bullish entry to go long. " +
      "If price breaks below with weakness, retest as resistance, bearish entry, we go short. " +
      "Stop on the opposite side of the breakout.";
    const r = classifyDirectionFromTranscript(t);
    expect(r.class).toBe("BIDIRECTIONAL_EXPLICIT");
  });
});
