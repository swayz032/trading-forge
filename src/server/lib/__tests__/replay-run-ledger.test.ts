/**
 * Replay run ledger + corpus freeze — attributability governance (no silent reruns, frozen corpus).
 */
import { describe, it, expect } from "vitest";
import { captureCorpusManifest, corpusUnchanged, appendRun, runsComparable, type ReplayRunRecord } from "../replay-run-ledger.js";

const vids = [
  { video_id: "a", transcript: "alpha transcript", market: "futures", instrument: "MES", timeframe: "15m", educator_family: "opening_range_breakout" },
  { video_id: "b", transcript: "beta transcript", market: "forex", instrument: "EURUSD", timeframe: "50m", educator_family: "ict_confluence" },
  { video_id: "c", transcript: "gamma transcript", market: "forex", instrument: "EURUSD", timeframe: "1h", educator_family: "indicator_crossover" },
];

describe("captureCorpusManifest", () => {
  it("hashes each transcript + the whole set; computes diversity", () => {
    const m = captureCorpusManifest("1.0-seed", vids);
    expect(m.videos[0].transcript_sha).toHaveLength(64);
    expect(m.diversity.families).toBe(3);
    expect(m.diversity.instruments).toBe(2);
  });
  it("★ a 3-video forex-light seed does NOT meet the minimum (needs ≥18 + ≥2 instruments + ≥3 families)", () => {
    expect(captureCorpusManifest("1.0-seed", vids).meets_minimum).toBe(false);
  });
  it("★ corpus hash changes if a transcript changes (the dataset lock)", () => {
    const a = captureCorpusManifest("1.0-seed", vids);
    const b = captureCorpusManifest("1.0-seed", [...vids.slice(1), { ...vids[0], transcript: "EDITED" }]);
    expect(corpusUnchanged(a, b)).toBe(false);
  });
  it("same videos (any order) → same hash → unchanged", () => {
    const a = captureCorpusManifest("1.0-seed", vids);
    const b = captureCorpusManifest("1.0-seed", [vids[2], vids[0], vids[1]]);
    expect(corpusUnchanged(a, b)).toBe(true);
  });
});

describe("appendRun — no silent reruns", () => {
  const rec = (id: string, result: ReplayRunRecord["result"]): ReplayRunRecord => ({
    manifest: { run_id: id, compiler_commit: "c1", extraction_commit: "e1", replay_engine_commit: "r1", dataset_hash: "d1", ir_version: "1.0" },
    result,
  });
  it("appends distinct run_ids", () => {
    const ledger = appendRun(appendRun([], rec("R-2026-001", "FAIL")), rec("R-2026-002", "PASS"));
    expect(ledger.map((r) => r.manifest.run_id)).toEqual(["R-2026-001", "R-2026-002"]);
  });
  it("★ FAILED then fixed → BOTH stay in history (append-only audit trail)", () => {
    const ledger = appendRun(appendRun([], rec("R-2026-001", "FAIL")), rec("R-2026-002", "PASS"));
    expect(ledger).toHaveLength(2);
    expect(ledger[0].result).toBe("FAIL");
    expect(ledger[1].result).toBe("PASS");
  });
  it("★ reusing a run_id THROWS (no overwrite — reruns get a new id)", () => {
    expect(() => appendRun(appendRun([], rec("R-2026-001", "FAIL")), rec("R-2026-001", "PASS"))).toThrow(/already exists/);
  });
  it("★ runs on different corpora are NOT comparable (coverage delta would be confounded)", () => {
    const a = rec("R-1", "PASS");
    const b: ReplayRunRecord = { ...rec("R-2", "PASS"), manifest: { ...rec("R-2", "PASS").manifest, dataset_hash: "d2" } };
    expect(runsComparable(a, b)).toBe(false);
  });
});
