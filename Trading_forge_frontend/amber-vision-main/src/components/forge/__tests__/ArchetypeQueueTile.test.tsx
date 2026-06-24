/**
 * ArchetypeQueueTile.test.tsx — Pass 7 Track D
 *
 * Tests the ArchetypeQueueTile component exported from ProductionStatusPanel.tsx.
 *
 * Tests:
 *  1. Renders loading state on initial mount
 *  2. Shows top 10 speaker terms after successful fetch
 *  3. Items with extractionCount >= 3 are marked data-ready="true"
 *  4. Items with extractionCount < 3 are marked data-ready="false"
 *  5. "ready" badge shows when readyCount > 0
 *  6. "No items pending" placeholder shows when queue is empty
 *  7. Error state shows when fetch fails
 *  8. data-testid="archetype-queue-tile" is present
 *  9. data-total attribute reflects total count
 * 10. data-ready-count attribute reflects readyCount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArchetypeQueueTile } from "../ProductionStatusPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderTile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ArchetypeQueueTile />
    </QueryClientProvider>,
  );
}

const FULL_QUEUE_RESPONSE = {
  ok: true,
  total: 12,
  readyCount: 3,
  top: [
    { term: "squeeze_play", extractionCount: 7 },
    { term: "fair_value_gap_flip", extractionCount: 5 },
    { term: "order_block_retest", extractionCount: 3 },
    { term: "market_maker_trap", extractionCount: 2 },
    { term: "liquidity_sweep", extractionCount: 1 },
  ],
};

const EMPTY_QUEUE_RESPONSE = {
  ok: true,
  total: 0,
  readyCount: 0,
  top: [],
};

beforeEach(() => {
  vi.spyOn(global, "fetch").mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(FULL_QUEUE_RESPONSE),
    } as Response),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ArchetypeQueueTile", () => {
  it("renders with data-testid archetype-queue-tile", async () => {
    renderTile();
    // The tile is always present (may be loading state initially)
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="archetype-queue-tile"]'),
      ).not.toBeNull();
    });
  });

  it("shows loading state initially then resolves", async () => {
    // Stall the fetch so we can catch the loading state
    let resolveFetch!: (value: unknown) => void;
    vi.spyOn(global, "fetch").mockImplementation(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }) as Promise<Response>,
    );

    renderTile();

    // Loading state should appear initially
    await waitFor(() => {
      const tile = document.querySelector('[data-testid="archetype-queue-tile"]');
      expect(tile).not.toBeNull();
    });

    // Resolve the fetch
    resolveFetch({
      ok: true,
      json: () => Promise.resolve(FULL_QUEUE_RESPONSE),
    });

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="archetype-queue-list"]'),
      ).not.toBeNull();
    });
  });

  it("shows top speaker terms after successful fetch", async () => {
    renderTile();

    await waitFor(() => {
      expect(screen.getByText("squeeze_play")).toBeInTheDocument();
      expect(screen.getByText("fair_value_gap_flip")).toBeInTheDocument();
      expect(screen.getByText("order_block_retest")).toBeInTheDocument();
    });
  });

  it("marks items with extractionCount >= 3 as data-ready=true", async () => {
    renderTile();

    await waitFor(() => {
      const readyItems = document.querySelectorAll(
        '[data-testid="archetype-queue-item"][data-ready="true"]',
      );
      // squeeze_play(7), fair_value_gap_flip(5), order_block_retest(3)
      expect(readyItems.length).toBe(3);
    });
  });

  it("marks items with extractionCount < 3 as data-ready=false", async () => {
    renderTile();

    await waitFor(() => {
      const notReadyItems = document.querySelectorAll(
        '[data-testid="archetype-queue-item"][data-ready="false"]',
      );
      // market_maker_trap(2), liquidity_sweep(1)
      expect(notReadyItems.length).toBe(2);
    });
  });

  it("shows ready badge when readyCount > 0", async () => {
    renderTile();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="archetype-queue-ready-badge"]'),
      ).not.toBeNull();
      expect(screen.getByText(/3 ready/)).toBeInTheDocument();
    });
  });

  it("shows No items pending placeholder when queue is empty", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(EMPTY_QUEUE_RESPONSE),
      } as Response),
    );

    renderTile();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="archetype-queue-empty"]'),
      ).not.toBeNull();
      expect(screen.getByText("No items pending")).toBeInTheDocument();
    });
  });

  it("does not show list when queue is empty", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(EMPTY_QUEUE_RESPONSE),
      } as Response),
    );

    renderTile();

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="archetype-queue-list"]'),
      ).toBeNull();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.reject(new Error("Network error")),
    );

    renderTile();

    await waitFor(() => {
      const tile = document.querySelector(
        '[data-testid="archetype-queue-tile"][data-state="error"]',
      );
      expect(tile).not.toBeNull();
    });
  });

  it("data-total attribute reflects total count", async () => {
    renderTile();

    await waitFor(() => {
      const tile = document.querySelector('[data-testid="archetype-queue-tile"]');
      expect(tile?.getAttribute("data-total")).toBe("12");
    });
  });

  it("data-ready-count attribute reflects readyCount", async () => {
    renderTile();

    await waitFor(() => {
      const tile = document.querySelector('[data-testid="archetype-queue-tile"]');
      expect(tile?.getAttribute("data-ready-count")).toBe("3");
    });
  });

  it("does not show ready badge when readyCount is 0", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...FULL_QUEUE_RESPONSE, readyCount: 0 }),
      } as Response),
    );

    renderTile();

    await waitFor(() => {
      // No ready badge when readyCount=0
      const tile = document.querySelector('[data-testid="archetype-queue-tile"]');
      expect(tile).not.toBeNull();
      expect(
        document.querySelector('[data-testid="archetype-queue-ready-badge"]'),
      ).toBeNull();
    });
  });
});
