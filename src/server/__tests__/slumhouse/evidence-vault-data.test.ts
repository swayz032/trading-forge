import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  workers: vi.fn(),
}));

vi.mock("../../db/index.js", () => ({ db: { execute: mocks.execute } }));
vi.mock("../../lib/slumhouse/worker-directory.js", () => ({ getEvidenceVaultWorkers: mocks.workers }));

import { assembleEvidenceVault } from "../../lib/slumhouse/evidence-vault-data.js";

describe("evidence vault read model", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.workers.mockReset();
  });

  it("returns the full strategy directory and canonical worker roster beside evidence", async () => {
    mocks.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ today: 2, available: 4, total: 7 }])
      .mockResolvedValueOnce([{
        id: "11111111-1111-4111-8111-111111111111",
        name: "Pressure Point",
        symbol: "MES",
        timeframe: "5m",
        lifecycle_state: "CANDIDATE",
        source_video_id: "dQw4w9WgXcQ",
        source_title: "Opening Range Model",
        source_discovered_at: new Date("2026-07-28T14:00:00Z"),
        source_is_today: true,
        transcript_status: "available",
      }]);
    mocks.workers.mockReturnValue([{
      id: "transcript_extractor",
      name: "Transcript Extractor",
      provider: "ollama",
      model: "gemma4:e4b-it-qat",
      fallbackProvider: "openai",
      fallbackModel: "gpt-5-mini",
      job: "Extracts structured trading logic.",
      lane: "extraction",
    }]);

    const result = await assembleEvidenceVault({ includeOperator: true });

    expect(result.capabilities).toEqual({ operatorViews: true });
    expect(result.stats).toEqual({ today: 2, available: 4, total: 7, strategies: 1, workers: 1 });
    expect(result.strategies[0]).toMatchObject({
      name: "Pressure Point",
      sourceVideoId: "dQw4w9WgXcQ",
      sourceIsToday: true,
      transcriptStatus: "available",
    });
    expect(result.workers[0]).toMatchObject({ provider: "ollama", model: "gemma4:e4b-it-qat" });
    expect(result.selected).toBeNull();
  });

  it("does not expose operator library or worker topology to a member session", async () => {
    mocks.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ today: 0, available: 0, total: 0 }]);
    const result = await assembleEvidenceVault({ includeOperator: false });
    expect(result.capabilities).toEqual({ operatorViews: false });
    expect(result.strategies).toEqual([]);
    expect(result.workers).toEqual([]);
    expect(mocks.workers).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
