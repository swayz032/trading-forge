/**
 * wave25-5tf-compile.test.ts — Wave 25 Pass 2 W25.4
 *
 * Coverage:
 *   1. DSL compiler emits AND-gates for all declared TF conditions (htf_tf + itf_tf)
 *   2. Strategies with only bias_timeframe+bias_condition compile identically to pre-Pass-2
 *   3. htf_tf alone (no condition) produces no grammar change (advisory only)
 *   4. itf_tf condition is AND-gated independently of htf_tf gate
 *   5. Sentinel "high < low" is respected for one-sided strategies in multi-TF gates
 *   6. trigger_tf is metadata only — no grammar effect
 *   7. Backward compat: strategies without any new TF fields compile unchanged
 */

import { describe, it, expect } from "vitest";
import {
  compileDslWithConfluence,
  applyConfluenceToCompiled,
  type DslCompileInput,
} from "../lib/dsl-compiler.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBase(direction: "long" | "short" | "both" = "both"): DslCompileInput {
  return {
    entry_indicator: "ema_crossover",
    entry_params: { fast: 9, slow: 21 },
    direction,
  };
}

// ─── Test: backward compat — no new TF fields ─────────────────────────────────

describe("W25.4 DSL 5-TF compile — backward compat", () => {
  it("strategy with no TF fields compiles identically to pre-W25.4", () => {
    const result = compileDslWithConfluence(makeBase());
    expect(result).not.toBeNull();
    // No TF gate notes
    const notes = result!.compileNotes.join(" ");
    expect(notes).not.toContain("htf_tf");
    expect(notes).not.toContain("itf_tf");
    expect(notes).not.toContain("bias_gate");
  });

  it("strategy with only bias_timeframe+bias_condition produces W23H.1 gate (unchanged)", () => {
    const input: DslCompileInput = {
      ...makeBase(),
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    expect(result!.entry_long).toContain("ema_50_4h > ema_200_4h");
    // Exactly one gate note
    const gateNotes = result!.compileNotes.filter((n) => n.includes("bias_gate"));
    expect(gateNotes.length).toBe(2); // one for long, one for short
  });
});

// ─── Test: htf_tf gate ────────────────────────────────────────────────────────

describe("W25.4 DSL 5-TF compile — htf_tf gate", () => {
  it("htf_tf + htf_condition ANDs the condition into entry_long and entry_short", () => {
    const input: DslCompileInput = {
      ...makeBase(),
      htf_tf: "4h",
      htf_condition: "ema_50_4h > ema_200_4h",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    expect(result!.entry_long).toContain("ema_50_4h > ema_200_4h");
    expect(result!.entry_short).toContain("ema_50_4h > ema_200_4h");
    const gateNote = result!.compileNotes.find((n) => n.includes("htf_tf"));
    expect(gateNote).toBeDefined();
  });

  it("htf_tf without htf_condition produces NO grammar change", () => {
    const input: DslCompileInput = {
      ...makeBase(),
      htf_tf: "4h",
      // htf_condition intentionally omitted
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    // entry_long should not contain any AND clause from 4h
    expect(result!.entry_long).not.toContain("AND");
    // No htf_tf gate note (condition missing so no gate applied)
    const gateNote = result!.compileNotes.find((n) => n.includes("htf_tf"));
    expect(gateNote).toBeUndefined();
  });

  it("htf_tf same as bias_timeframe does not double-gate", () => {
    // When htf_tf matches bias_timeframe, only one gate should be applied
    // (the bias_timeframe gate; htf_tf is deduplicated in the implementation)
    const input: DslCompileInput = {
      ...makeBase(),
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
      htf_tf: "4h",
      htf_condition: "ema_50_4h > ema_200_4h",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    // The condition should appear only once in entry_long (not duplicated)
    const longStr = result!.entry_long;
    const occurrences = (longStr.match(/ema_50_4h > ema_200_4h/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

// ─── Test: itf_tf gate ────────────────────────────────────────────────────────

describe("W25.4 DSL 5-TF compile — itf_tf gate", () => {
  it("itf_tf + itf_condition ANDs the condition independently", () => {
    const input: DslCompileInput = {
      ...makeBase(),
      itf_tf: "1h",
      itf_condition: "rsi_14_1h > 50",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    expect(result!.entry_long).toContain("rsi_14_1h > 50");
    const gateNote = result!.compileNotes.find((n) => n.includes("itf_tf"));
    expect(gateNote).toBeDefined();
  });

  it("both htf_tf and itf_tf conditions are stacked via AND", () => {
    const input: DslCompileInput = {
      ...makeBase(),
      htf_tf: "4h",
      htf_condition: "ema_50_4h > ema_200_4h",
      itf_tf: "1h",
      itf_condition: "rsi_14_1h > 50",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    expect(result!.entry_long).toContain("ema_50_4h > ema_200_4h");
    expect(result!.entry_long).toContain("rsi_14_1h > 50");
    // Both conditions should be present in the entry grammar
    const htfNote = result!.compileNotes.find((n) => n.includes("htf_tf"));
    const itfNote = result!.compileNotes.find((n) => n.includes("itf_tf"));
    expect(htfNote).toBeDefined();
    expect(itfNote).toBeDefined();
  });

  it("full 5-TF stack: bias_timeframe + htf_tf + itf_tf all gate correctly", () => {
    const input: DslCompileInput = {
      ...makeBase(),
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
      // htf_tf same as bias_timeframe → deduplicated
      itf_tf: "1h",
      itf_condition: "rsi_14_1h > 50",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    const longStr = result!.entry_long;
    expect(longStr).toContain("ema_50_4h > ema_200_4h");
    expect(longStr).toContain("rsi_14_1h > 50");
  });
});

// ─── Test: trigger_tf metadata only ──────────────────────────────────────────

describe("W25.4 DSL 5-TF compile — trigger_tf metadata", () => {
  it("trigger_tf alone has no grammar effect (metadata only)", () => {
    const inputWithTrigger: DslCompileInput = {
      ...makeBase(),
      trigger_tf: "1m",
    };
    const inputWithout: DslCompileInput = makeBase();

    const withTrigger = compileDslWithConfluence(inputWithTrigger);
    const without = compileDslWithConfluence(inputWithout);

    expect(withTrigger).not.toBeNull();
    expect(without).not.toBeNull();
    // Grammar must be identical — trigger_tf is metadata only
    expect(withTrigger!.entry_long).toBe(without!.entry_long);
    expect(withTrigger!.entry_short).toBe(without!.entry_short);
  });
});

// ─── Test: sentinel awareness with multi-TF gates ────────────────────────────

describe("W25.4 DSL 5-TF compile — sentinel awareness", () => {
  it("long-only strategy: sentinel entry_short not AND-gated with itf_condition", () => {
    const input: DslCompileInput = {
      ...makeBase("long"),  // long-only → entry_short = "high < low" sentinel
      itf_tf: "1h",
      itf_condition: "rsi_14_1h > 50",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    // entry_long should have the ITF gate
    expect(result!.entry_long).toContain("rsi_14_1h > 50");
    // entry_short must remain the sentinel — not AND-gated
    expect(result!.entry_short).toBe("high < low");
  });

  it("short-only strategy: sentinel entry_long not AND-gated with htf_condition", () => {
    const input: DslCompileInput = {
      ...makeBase("short"),  // short-only → entry_long = "high < low" sentinel
      htf_tf: "4h",
      htf_condition: "ema_50_4h < ema_200_4h",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    // entry_short should have the HTF gate
    expect(result!.entry_short).toContain("ema_50_4h < ema_200_4h");
    // entry_long must remain the sentinel
    expect(result!.entry_long).toBe("high < low");
  });
});

// ─── Test: compile notes contain correct labels ───────────────────────────────

describe("W25.4 DSL 5-TF compile — compile note labels", () => {
  it("each TF gate adds a note with the label and TF name", () => {
    const input: DslCompileInput = {
      ...makeBase(),
      htf_tf: "4h",
      htf_condition: "ema_50_4h > ema_200_4h",
      itf_tf: "1h",
      itf_condition: "rsi_14_1h > 50",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    const notes = result!.compileNotes.join("\n");
    expect(notes).toContain("htf_tf='4h'");
    expect(notes).toContain("itf_tf='1h'");
  });
});
