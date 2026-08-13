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
