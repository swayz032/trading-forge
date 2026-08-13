/**
 * SPINE-B guards — AR-1121 §4.B / AR-1123 §6.B: TypeScript TRANSPORTS the source-owned
 * timeframe roles and never authors them.
 *
 * WHY THIS IS NEEDED AT ALL (AR-1119 §2.4, re-measured):
 * `parseSpecArtifact` rebuilds `spec` from a FIXED key literal. A field absent from that
 * literal is SILENTLY DROPPED before persistence — so adding `source_timeframe_roles` to
 * the Python output alone would have produced a correct artifact whose carrier died at
 * the TS boundary, with nothing raising.
 *
 *   `A TRANSPORT LAYER THAT REBUILDS ITS PAYLOAD FROM A FIXED KEY SET IS A FILTER
 *    WEARING A PARSER'S NAME.`
 *
 * NOT a §9.2 claim: this proves one hop. The role values below are SYNTHETIC and stand
 * for "a well-shaped envelope", never for sVkm's taught semantics.
 */

import { describe, expect, it, vi } from "vitest";

// Established pattern in this suite (see spec-onboarding-service.test.ts): the module
// under test transitively pulls the real `db` and the full app entrypoint at module
// scope. These are pure-function tests, so both are mocked away rather than booting the
// app. Mocks are hoisted by vitest above the import below.
vi.mock("../../db/index.js", () => ({
  get db() {
    return null;
  },
}));
vi.mock("../../index.js", () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

import {
  SOURCE_TIMEFRAME_ROLES_SCHEMA,
  parseSourceTimeframeRoles,
  parseSpecArtifact,
} from "../spec-onboarding-service.js";

const SYNTHETIC_QUOTE = "SYNTHETIC TRANSPORT PROBE — no source video";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schema: SOURCE_TIMEFRAME_ROLES_SCHEMA,
    bindings: [
      { role: "OPENING_RANGE_WINDOW", timeframe: "5m", evidence_grade: "EXPLICIT", source_quote: SYNTHETIC_QUOTE, condition_id: "c0" },
      { role: "BREAKOUT_CONFIRMATION", timeframe: "1m", evidence_grade: "EXPLICIT", source_quote: SYNTHETIC_QUOTE, condition_id: "c1" },
      { role: "FVG_DETECTION", timeframe: "1m", evidence_grade: "SOURCE_RESOLVED_BY_CONTINUITY", source_quote: SYNTHETIC_QUOTE, condition_id: "c2" },
      { role: "ENTRY_COMPLETION", timeframe: "1m", evidence_grade: "SOURCE_RESOLVED_BY_CONTINUITY", source_quote: SYNTHETIC_QUOTE, condition_id: "c3" },
    ],
    ...overrides,
  };
}

function artifact(specExtra: Record<string, unknown> = {}) {
  return {
    video: "sVkmZklJDHI__s0",
    spec_hash: "a".repeat(64),
    graph_canonical_hash: "b".repeat(64),
    ledger_d: "D0",
    transcript_chars: 25071,
    spec: {
      direction: "long",
      entry_conditions: [{ id: "c0", type: "OPENING_RANGE_DEFINITION", role: "context", object: "opening range" }],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "c0",
      ...specExtra,
    },
  };
}

describe("SPINE-B — source_timeframe_roles survives parseSpecArtifact", () => {
  it("transports the envelope through the parser unchanged", () => {
    const parsed = parseSpecArtifact(artifact({ source_timeframe_roles: envelope() }));
    expect(parsed.ok).toBe(true);

    const carried = parsed.artifact!.spec.source_timeframe_roles;
    // POSITIVE WITNESS that the payload is real, so a passing deep-equal is not vacuous.
    expect(carried).toBeDefined();
    expect(carried!.bindings).toHaveLength(4);
    expect(carried).toEqual(envelope());
  });

  it("preserves each binding's timeframe, grade and quote verbatim", () => {
    const parsed = parseSpecArtifact(artifact({ source_timeframe_roles: envelope() }));
    const byRole = Object.fromEntries(
      parsed.artifact!.spec.source_timeframe_roles!.bindings.map((b) => [b.role, b]),
    );
    expect(byRole.OPENING_RANGE_WINDOW.timeframe).toBe("5m");
    expect(byRole.BREAKOUT_CONFIRMATION.timeframe).toBe("1m");
    expect(byRole.FVG_DETECTION.evidence_grade).toBe("SOURCE_RESOLVED_BY_CONTINUITY");
    expect(byRole.ENTRY_COMPLETION.source_quote).toBe(SYNTHETIC_QUOTE);
  });

  it("leaves the field undefined when the artifact carries none (legacy unchanged)", () => {
    const parsed = parseSpecArtifact(artifact());
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact!.spec.source_timeframe_roles).toBeUndefined();
  });

  it("does not disturb the rest of the spec body", () => {
    const withRoles = parseSpecArtifact(artifact({ source_timeframe_roles: envelope() })).artifact!;
    const without = parseSpecArtifact(artifact()).artifact!;
    expect({ ...withRoles.spec, source_timeframe_roles: undefined }).toEqual({
      ...without.spec,
      source_timeframe_roles: undefined,
    });
  });
});

describe("SPINE-B — the firebreak REFUSES rather than repairs", () => {
  it("rejects a wrong schema string", () => {
    expect(parseSourceTimeframeRoles(envelope({ schema: "SOURCE_TIMEFRAME_ROLES/2" }))).toBeUndefined();
    expect(parseSourceTimeframeRoles(envelope({ schema: "" }))).toBeUndefined();
  });

  it("rejects a non-object envelope, including an array", () => {
    expect(parseSourceTimeframeRoles("SOURCE_TIMEFRAME_ROLES/1")).toBeUndefined();
    expect(parseSourceTimeframeRoles([])).toBeUndefined();
    expect(parseSourceTimeframeRoles(42)).toBeUndefined();
  });

  it("rejects bindings that are not an array", () => {
    expect(parseSourceTimeframeRoles(envelope({ bindings: {} }))).toBeUndefined();
  });

  it("rejects a role outside the closed set", () => {
    const bad = envelope();
    bad.bindings[0].role = "TRAILING_STOP_FRAME";
    expect(parseSourceTimeframeRoles(bad)).toBeUndefined();
  });

  it("rejects an empty timeframe — a dropped source fact looks exactly like this", () => {
    const bad = envelope();
    bad.bindings[0].timeframe = "";
    expect(parseSourceTimeframeRoles(bad)).toBeUndefined();
  });

  it("rejects a missing source quote — a graded claim with no evidence", () => {
    const bad = envelope();
    // @ts-expect-error deliberately malformed
    delete bad.bindings[2].source_quote;
    expect(parseSourceTimeframeRoles(bad)).toBeUndefined();
  });

  it("returns undefined, NOT a patched envelope, for a malformed input", () => {
    const bad = envelope();
    bad.bindings[1].timeframe = "";
    const out = parseSourceTimeframeRoles(bad);
    // The distinction that matters: TS must not hand downstream a repaired carrier,
    // which would be indistinguishable from a taught one.
    expect(out).toBeUndefined();
  });
});

describe("B-FAILCLOSED-1 (AR-1130 §4) — present-but-malformed is NOT absent", () => {
  // Returning ok:true with the carrier quietly missing converts "the source supplied a
  // malformed load-bearing contract" into "the source supplied no contract". Those are
  // different facts, and only one is legal: absent = legacy strategy, malformed = a
  // corrupted source claim that must never be silently downgraded into legacy.
  const MALFORMED: Array<[string, unknown]> = [
    ["wrong schema", envelope({ schema: "SOURCE_TIMEFRAME_ROLES/2" })],
    ["bindings not an array", envelope({ bindings: {} })],
    ["null", null],
    ["a bare string", "SOURCE_TIMEFRAME_ROLES/1"],
    ["an array envelope", []],
  ];

  it.each(MALFORMED)("REFUSES the whole artifact when the carrier is %s", (_label, bad) => {
    const parsed = parseSpecArtifact(artifact({ source_timeframe_roles: bad }));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("invalid_source_timeframe_roles");
    expect(parsed.artifact).toBeUndefined();
  });

  it("REFUSES when a single binding is malformed inside an otherwise valid envelope", () => {
    const bad = envelope();
    bad.bindings[2].timeframe = "";
    const parsed = parseSpecArtifact(artifact({ source_timeframe_roles: bad }));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("invalid_source_timeframe_roles");
  });

  it("legacy absent carrier still parses — absence is NOT malformation", () => {
    const parsed = parseSpecArtifact(artifact());
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact!.spec.source_timeframe_roles).toBeUndefined();
  });

  it("a valid carrier still parses and transports", () => {
    const parsed = parseSpecArtifact(artifact({ source_timeframe_roles: envelope() }));
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact!.spec.source_timeframe_roles).toEqual(envelope());
  });
});

describe("B-RISK-1 (AR-1130 §5) — source_risk survives, so the TAUGHT stop survives", () => {
  // THE DEFECT: source_risk was declared on SpecArtifactBody (AR-1059 §4) and omitted
  // from the parser's fixed key literal, so every artifact lost it here. GPT traced the
  // consumer: the same parsed `spec` reaches resolveSpecStopLoss(), which returns the
  // taught structural stop for SOURCE_FAITHFUL and otherwise falls back to framework ATR
  // 1.5. The drop therefore SILENTLY CONVERTED A TEACHER-TAUGHT STOP INTO A FRAMEWORK
  // STOP and took the fixed-R target with it.
  const sourceRisk = {
    mode: "SOURCE_FAITHFUL" as const,
    stop: { anchor: "sweep_wick_below_entry" as const, include_wick: true, span: { start: 100, end: 240 } },
    target: { type: "FIXED_R" as const, r_multiple: 2, span: { start: 300, end: 420 } },
  };

  it("survives parse UNCHANGED", () => {
    const parsed = parseSpecArtifact(artifact({ source_risk: sourceRisk }));
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact!.spec.source_risk).toEqual(sourceRisk);
  });

  it("the parsed spec yields the TAUGHT structural stop, not ATR", async () => {
    const { resolveSpecStopLoss } = await import("../source-risk-contract.js");
    const parsed = parseSpecArtifact(artifact({ source_risk: sourceRisk }));

    const stop = resolveSpecStopLoss(parsed.artifact!.spec);

    // This is the assertion the dropped field was silently defeating.
    expect(stop.type).toBe("source_structural");
    expect(stop.ownership).toBe("source");
    expect(stop.anchor).toBe("sweep_wick_below_entry");
    expect(stop.include_wick).toBe(true);
    expect(stop).not.toHaveProperty("multiplier"); // i.e. NOT the ATR shape
  });

  it("the fixed-R target payload survives alongside the stop", () => {
    const parsed = parseSpecArtifact(artifact({ source_risk: sourceRisk }));
    const target = parsed.artifact!.spec.source_risk!.target!;
    expect(target.type).toBe("FIXED_R");
    expect(target.r_multiple).toBe(2);
    expect(target.span).toEqual({ start: 300, end: 420 });
  });

  it("legacy artifact with no source_risk keeps the framework ATR default", async () => {
    const { resolveSpecStopLoss } = await import("../source-risk-contract.js");
    const parsed = parseSpecArtifact(artifact());

    expect(parsed.artifact!.spec.source_risk).toBeUndefined();
    expect(resolveSpecStopLoss(parsed.artifact!.spec)).toEqual({ type: "atr", multiplier: 1.5 });
  });

  it("transports verbatim — TS does not reinterpret the contract", () => {
    // A TS-side re-validation would be a second semantic authority (AR-1130 §5 forbids
    // it). Proof that none exists: an UNKNOWN mode passes through untouched, and the
    // canonical resolver — not this parser — is what decides what it means.
    const odd = { mode: "TF_OVERLAY_VARIANT" as const, stop: sourceRisk.stop };
    const parsed = parseSpecArtifact(artifact({ source_risk: odd }));
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact!.spec.source_risk).toEqual(odd);
  });
});

describe("SPINE-B — TypeScript never AUTHORS a role", () => {
  it("does not synthesise roles from a scalar timeframe or a recovery heuristic", () => {
    const parsed = parseSpecArtifact(
      artifact({
        // The legacy scalar and the confidence-0.4 recovery metadata are both present,
        // and neither may rescue a missing carrier (AR-1119 §3.5 negative controls).
        timeframe: "1m",
        metadata: { timeframe_recovery: { confidence: 0.4, evidence: "exec = lowest execution-grade TF across roles" } },
      }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact!.spec.source_timeframe_roles).toBeUndefined();
  });
});
