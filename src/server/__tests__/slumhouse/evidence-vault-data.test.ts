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
        symbols: ["MES"],
        timeframe: "5m",
        config: { entry_indicator: "session_open_breakout" },
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
      status: "successor-certification",
      job: "Extracts structured trading logic.",
      lane: "extraction",
    }]);

    const result = await assembleEvidenceVault({ includeOperator: true });

    expect(result.capabilities).toEqual({ operatorViews: true });
    expect(result.stats).toEqual({ today: 2, available: 4, total: 7, strategies: 1, workers: 1 });
    expect(result.strategies[0]).toMatchObject({
      name: expect.stringMatching(/^Opening Heist /),
      sourceVideoId: "dQw4w9WgXcQ",
      sourceIsToday: true,
      transcriptStatus: "available",
    });
    expect(result.strategies[0]?.name).not.toContain("Pressure Point");
    expect(result.workers[0]).toMatchObject({ model: "gemma4:e4b-it-qat" });
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

  it("does not auto-select archive evidence when the room opens", async () => {
    const video = {
      id: "22222222-2222-4222-8222-222222222222",
      video_id: "dQw4w9WgXcQ",
      youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Real source",
      channel: "Trader",
      transcript_status: "available",
      transcript_chars: 1200,
      source_provider: "n8n",
      source_query: "orb",
      discovered_at: new Date("2026-07-28T14:00:00Z"),
      last_seen_at: new Date("2026-07-28T14:00:00Z"),
      is_today: true,
    };
    mocks.execute
      .mockResolvedValueOnce([video])
      .mockResolvedValueOnce([{ today: 1, available: 1, total: 1 }])
      .mockResolvedValueOnce([]);
    mocks.workers.mockReturnValue([]);

    const result = await assembleEvidenceVault({ includeOperator: true });

    expect(result.videos).toHaveLength(1);
    expect(result.selected).toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });

  it("uses Slumhouse names for a video's linked strategy receipts too", async () => {
    const video = {
      id: "22222222-2222-4222-8222-222222222222",
      video_id: "dQw4w9WgXcQ",
      youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "ORB lesson",
      channel: "Trader",
      transcript_status: "available",
      transcript_chars: 1200,
      transcript_sha256: "a".repeat(64),
      transcript_text: "Transcript",
      source_provider: "n8n",
      source_query: "orb",
      discovered_at: new Date("2026-07-28T14:00:00Z"),
      last_seen_at: new Date("2026-07-28T14:00:00Z"),
      is_today: true,
    };
    mocks.execute
      .mockResolvedValueOnce([video])
      .mockResolvedValueOnce([{ today: 1, available: 1, total: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([video])
      .mockResolvedValueOnce([{
        id: "33333333-3333-4333-8333-333333333333",
        name: "orb_15m_mes",
        symbol: "MES",
        symbols: ["MES"],
        timeframe: "15m",
        config: { entry_indicator: "session_open_breakout" },
        lifecycle_state: "CANDIDATE",
      }]);
    mocks.workers.mockReturnValue([]);

    const result = await assembleEvidenceVault({ includeOperator: true, videoId: video.video_id });

    expect(result.selected?.strategies[0]?.name).toMatch(/^Opening Heist /);
    expect(result.selected?.strategies[0]?.name).not.toContain("orb_15m_mes");
  });
});
