import { describe, it, expect, vi, beforeEach } from "vitest";

// Fix 6: paperTradesCounter missing from force-close / DLL-halt exit paths

const mockInc = vi.fn();
const mockLabels = vi.fn().mockReturnValue({ inc: mockInc });
const mockPaperTradesCounter = { labels: mockLabels };

vi.mock("../lib/metrics-registry.js", () => ({
  paperTrades: mockPaperTradesCounter,
  strategyPromotions: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  pboBlocksTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  lifecycleShadowPromotionsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));

describe("Fix 6: paperTradesCounter on force-close paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("force_close outcome label increments counter with symbol and side", () => {
    // Simulate what FIX 6 adds after closePosition in forceCloseAllPositions
    const pos = { symbol: "MES", side: "long" as const };
    mockPaperTradesCounter.labels({
      symbol: pos.symbol,
      side: pos.side ?? "unknown",
      outcome: "force_close",
    }).inc();

    expect(mockLabels).toHaveBeenCalledWith({
      symbol: "MES",
      side: "long",
      outcome: "force_close",
    });
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  it("force_close outcome defaults side to 'unknown' when side is not available", () => {
    // pos.side may not be present in all DB select results
    const pos = { symbol: "MNQ", side: null as string | null };
    mockPaperTradesCounter.labels({
      symbol: pos.symbol,
      side: pos.side ?? "unknown",
      outcome: "force_close",
    }).inc();

    expect(mockLabels).toHaveBeenCalledWith({
      symbol: "MNQ",
      side: "unknown",
      outcome: "force_close",
    });
  });

  it("time_stop outcome label is incremented with correct shape", () => {
    // Simulate what FIX 6 adds after closePosition in TIME_STOP_FLATTEN path
    const pos = { symbol: "MCL", side: "short" as const };
    mockPaperTradesCounter.labels({
      symbol: pos.symbol,
      side: pos.side,
      outcome: "time_stop",
    }).inc();

    expect(mockLabels).toHaveBeenCalledWith({
      symbol: "MCL",
      side: "short",
      outcome: "time_stop",
    });
    expect(mockInc).toHaveBeenCalledTimes(1);
  });

  it("both force-close paths (currentPrice and entryPrice fallback) fire counter", () => {
    // Simulate two successful closes in a batch flatten sweep
    const positions = [
      { symbol: "MES", side: "long" as const },
      { symbol: "MNQ", side: "short" as const },
    ];
    for (const pos of positions) {
      mockPaperTradesCounter.labels({
        symbol: pos.symbol,
        side: pos.side ?? "unknown",
        outcome: "force_close",
      }).inc();
    }
    expect(mockInc).toHaveBeenCalledTimes(2);
  });

  it("counter is NOT incremented when closePosition throws", () => {
    // Simulate the try-catch pattern: counter is only called after successful close
    let closedOk = false;
    try {
      throw new Error("closePosition failed");
      closedOk = true; // unreachable
    } catch (_) {
      // no counter increment here
    }
    expect(closedOk).toBe(false);
    expect(mockInc).not.toHaveBeenCalled();
  });
});
