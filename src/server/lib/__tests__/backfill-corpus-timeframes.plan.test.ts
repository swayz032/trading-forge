/**
 * backfill-corpus-timeframes.plan.test.ts — Timeframe Integrity Fix (2026-07-03)
 *
 * Unit tests for the PURE backfill planner (planRowTimeframe). Covers:
 *   - skip-non-5m (never overwrite a prior correction)
 *   - backfill (5m → recovered exec, name suffix fixed)
 *   - quarantine (unrecoverable spec → NOT defaulted to 5m)
 *   - idempotency (already-backfilled row is a no-op on re-run)
 *   - unresolved (no matching spec artifact)
 *
 * db/index.js is mocked so the script's static `db` import does not require a
 * live DATABASE_URL; the guarded main() does not run on import.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../db/index.js", () => ({ db: {} }));

import {
  planRowTimeframe,
  videoFromSourceUrl,
  type BackfillRow,
  type SpecArtifactLite,
} from "../../../../scripts/backfill-corpus-timeframes.js";

// A spec whose trigger names 5m and context names 4h → exec 5m, higher 4h.
const specHiLo: SpecArtifactLite = {
  video: "vidHiLo",
  spec_hash: "hash_hilo",
  spec: {
    entry_conditions: [
      { id: "T1", object: "15 minute support level", role: "trigger", type: "ENABLE_ENTRY" },
      { id: "C1", object: "4 hour time frame", role: "confluence", type: "WAIT_SESSION" },
    ],
    entry_trigger_id: "T1",
  },
};

// A VWAP-anchor-only spec → unrecoverable (quarantine).
const specAmbig: SpecArtifactLite = {
  video: "vidAmbig",
  spec_hash: "hash_ambig",
  spec: {
    entry_conditions: [
      { id: "T1", object: "mean reversion", role: "trigger", type: "ENABLE_ENTRY" },
      { id: "C1", object: "daily vwap", role: "confluence", type: "WAIT_STRUCTURE" },
    ],
    entry_trigger_id: "T1",
  },
};

function maps(...arts: SpecArtifactLite[]) {
  const byHash = new Map<string, SpecArtifactLite>();
  const byVideo = new Map<string, SpecArtifactLite>();
  for (const a of arts) {
    byHash.set(a.spec_hash, a);
    byVideo.set(a.video, a);
  }
  return { byHash, byVideo };
}

function row(over: Partial<BackfillRow> = {}): BackfillRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "concept_mes_5m",
    timeframe: "5m",
    triggerTf: null,
    htfTf: null,
    config: { metadata: { spec_hash: "hash_hilo", source_url: "https://www.youtube.com/watch?v=vidHiLo" } },
    ...over,
  };
}

describe("videoFromSourceUrl", () => {
  it("extracts the v= id", () => {
    expect(videoFromSourceUrl("https://www.youtube.com/watch?v=abc_123-XY")).toBe("abc_123-XY");
    expect(videoFromSourceUrl("nope")).toBeNull();
    expect(videoFromSourceUrl(null)).toBeNull();
  });
});

describe("planRowTimeframe", () => {
  const { byHash, byVideo } = maps(specHiLo, specAmbig);

  it("backfills a 5m row to the recovered exec + fixes the _5m name suffix", () => {
    const p = planRowTimeframe(row(), byHash, byVideo);
    expect(p.status).toBe("backfilled");
    expect(p.newTimeframe).toBe("15m");
    expect(p.higherTimeframe).toBe("4h");
    expect(p.newName).toBe("concept_mes_15m");
  });

  it("QUARANTINES an unrecoverable spec — never defaults to 5m", () => {
    const p = planRowTimeframe(
      row({ config: { metadata: { spec_hash: "hash_ambig", source_url: "https://www.youtube.com/watch?v=vidAmbig" } } }),
      byHash,
      byVideo,
    );
    expect(p.status).toBe("quarantined");
    expect(p.newTimeframe).toBeUndefined();
  });

  it("skips a row whose timeframe is already non-5m (never overwrites a prior correction)", () => {
    const p = planRowTimeframe(row({ timeframe: "4h" }), byHash, byVideo);
    expect(p.status).toBe("skip_non_5m");
    expect(p.newTimeframe).toBeUndefined();
  });

  it("is idempotent: a row already carrying the recovered exec on trigger_tf is a no-op", () => {
    // After a prior apply this row would read timeframe=15m — which the non-5m
    // guard already short-circuits. Simulate a confirmed-5m idempotent case: a
    // row recovered to exec that stayed 5m with matching trigger_tf.
    const spec5m: SpecArtifactLite = {
      video: "vid5m",
      spec_hash: "hash_5m",
      spec: {
        entry_conditions: [{ id: "T1", object: "5m entry", role: "trigger", type: "ENABLE_ENTRY" }],
        entry_trigger_id: "T1",
      },
    };
    const m = maps(spec5m);
    const done = planRowTimeframe(
      row({
        timeframe: "5m",
        triggerTf: "5m",
        htfTf: null,
        config: { metadata: { spec_hash: "hash_5m", source_url: "https://www.youtube.com/watch?v=vid5m" } },
      }),
      m.byHash,
      m.byVideo,
    );
    expect(done.status).toBe("already_backfilled");
  });

  it("reports unresolved when no matching spec artifact exists in the corpus", () => {
    const p = planRowTimeframe(
      row({ config: { metadata: { spec_hash: "hash_missing", source_url: "https://www.youtube.com/watch?v=missing" } } }),
      byHash,
      byVideo,
    );
    expect(p.status).toBe("unresolved_no_spec");
  });
});
