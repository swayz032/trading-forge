/**
 * paper-evidence-labels.test.ts — M2 determinism + durability (2026-07-17), Item 3
 *
 * Verifies the claim-scoping evidence-labels stamp: the fixed certified /
 * not-certified vocabulary matches the ratify packet's text exactly, the
 * feed-mode + nominal-delay resolvers respect env overrides and never
 * fabricate a value when unconfigured, and the wiring into paper.ts's
 * POST /start route is present (structural check — the route itself is
 * covered by existing paper-route integration coverage elsewhere).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  buildPaperEvidenceLabels,
  resolveFeedMode,
  resolveNominalDelaySeconds,
  PAPER_EVIDENCE_CERTIFIED_CLAIMS,
  PAPER_EVIDENCE_NOT_CERTIFIED_CLAIMS,
} from "../lib/paper-evidence-labels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  delete process.env.PAPER_FEED_MODE;
  delete process.env.PAPER_FEED_NOMINAL_DELAY_SECONDS;
});

describe("paper-evidence-labels — claim-scoping vocabulary (fixed, matches ratify packet)", () => {
  it("certified claims are exactly logic/timeframes/risk_wiring/state_recovery", () => {
    expect([...PAPER_EVIDENCE_CERTIFIED_CLAIMS].sort()).toEqual(
      ["logic", "timeframes", "risk_wiring", "state_recovery"].sort(),
    );
  });

  it("NOT certified claims are exactly realtime_latency/bid_ask/queue/liquidity/broker_execution", () => {
    expect([...PAPER_EVIDENCE_NOT_CERTIFIED_CLAIMS].sort()).toEqual(
      ["realtime_latency", "bid_ask", "queue", "liquidity", "broker_execution"].sort(),
    );
  });

  it("certified and not-certified sets are disjoint", () => {
    const overlap = PAPER_EVIDENCE_CERTIFIED_CLAIMS.filter((c) =>
      (PAPER_EVIDENCE_NOT_CERTIFIED_CLAIMS as readonly string[]).includes(c),
    );
    expect(overlap).toEqual([]);
  });
});

describe("resolveFeedMode", () => {
  it("defaults to 'delayed' (paper engine runs against the Massive delayed feed)", () => {
    expect(resolveFeedMode()).toBe("delayed");
  });

  it("respects PAPER_FEED_MODE override to 'realtime'", () => {
    process.env.PAPER_FEED_MODE = "realtime";
    expect(resolveFeedMode()).toBe("realtime");
  });

  it("respects PAPER_FEED_MODE override to 'unknown'", () => {
    process.env.PAPER_FEED_MODE = "unknown";
    expect(resolveFeedMode()).toBe("unknown");
  });

  it("falls back to 'delayed' on a garbage env value (fail-safe, never throws)", () => {
    process.env.PAPER_FEED_MODE = "not-a-real-mode";
    expect(resolveFeedMode()).toBe("delayed");
  });
});

describe("resolveNominalDelaySeconds — never fabricates a value", () => {
  it("returns null when unconfigured (honest absence, not a guessed default)", () => {
    expect(resolveNominalDelaySeconds()).toBeNull();
  });

  it("returns the configured number when set", () => {
    process.env.PAPER_FEED_NOMINAL_DELAY_SECONDS = "900";
    expect(resolveNominalDelaySeconds()).toBe(900);
  });

  it("returns null for a negative or non-numeric override (fail-safe)", () => {
    process.env.PAPER_FEED_NOMINAL_DELAY_SECONDS = "-5";
    expect(resolveNominalDelaySeconds()).toBeNull();
    process.env.PAPER_FEED_NOMINAL_DELAY_SECONDS = "not-a-number";
    expect(resolveNominalDelaySeconds()).toBeNull();
  });

  it("accepts zero as a valid configured delay", () => {
    process.env.PAPER_FEED_NOMINAL_DELAY_SECONDS = "0";
    expect(resolveNominalDelaySeconds()).toBe(0);
  });
});

describe("buildPaperEvidenceLabels — full stamp shape", () => {
  it("returns feed_mode + nominal_delay_seconds + claims in the documented shape", () => {
    const labels = buildPaperEvidenceLabels();
    expect(labels).toEqual({
      feed_mode: "delayed",
      nominal_delay_seconds: null,
      claims: {
        certified: [...PAPER_EVIDENCE_CERTIFIED_CLAIMS],
        not_certified: [...PAPER_EVIDENCE_NOT_CERTIFIED_CLAIMS],
      },
    });
  });

  it("is pure — two calls with the same env produce deep-equal (not reference-equal) results", () => {
    const a = buildPaperEvidenceLabels();
    const b = buildPaperEvidenceLabels();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("wiring — additive metadata only, never gates (structural check)", () => {
  const PAPER_ROUTE_SRC = readFileSync(resolve(__dirname, "../routes/paper.ts"), "utf8");

  it("POST /start stamps evidence_labels onto the session config at insert time", () => {
    expect(PAPER_ROUTE_SRC).toContain("buildPaperEvidenceLabels()");
    expect(PAPER_ROUTE_SRC).toContain("evidence_labels: buildPaperEvidenceLabels()");
  });

  it("writes a paper.evidence_labels_stamped audit row (additive observability)", () => {
    expect(PAPER_ROUTE_SRC).toContain("paper.evidence_labels_stamped");
  });

  it("the evidence-label stamp does not appear anywhere near a gating/blocking return (no accidental gate)", () => {
    const idx = PAPER_ROUTE_SRC.indexOf("evidence_labels: buildPaperEvidenceLabels()");
    expect(idx).toBeGreaterThan(-1);
    const nearby = PAPER_ROUTE_SRC.slice(Math.max(0, idx - 300), idx + 300);
    expect(nearby).not.toMatch(/res\.status\(4\d\d\)/);
  });
});
