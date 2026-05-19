/**
 * Component tests for the Evidence tab (Pass 19 Track B).
 *
 * Backend is mocked at the fetch layer so the UI is verifiable independently
 * of Track A's backend cleanup work.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EvidenceTab } from "../evidence/EvidenceTab";
import type { StrategyEvidenceResponse } from "@/types/strategy-evidence";

const sampleEvidence: StrategyEvidenceResponse = {
  cross_validated: true,
  bucket: {
    id: "bucket-1",
    fingerprint_hash: "abc12345def67890",
    market: "MES",
    entry_archetype: "opening_range_breakout",
    exit_type: "atr_multiple",
    source_count: 3,
    distinct_providers: 3,
    status: "graduated",
    first_seen_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    graduated_at: new Date().toISOString(),
  },
  mentions: [
    {
      id: "m1",
      source_provider: "youtube",
      source_url: "https://youtube.com/watch?v=abc",
      is_cross_validation_result: false,
      cross_validator_confidence: null,
      created_at: new Date().toISOString(),
    },
    {
      id: "m2",
      source_provider: "tavily",
      source_url: "https://example.com/article",
      is_cross_validation_result: true,
      cross_validator_confidence: 0.92,
      created_at: new Date().toISOString(),
    },
    {
      id: "m3",
      source_provider: "reddit",
      source_url: "https://reddit.com/r/futures/abc",
      is_cross_validation_result: true,
      cross_validator_confidence: 0.85,
      created_at: new Date().toISOString(),
    },
  ],
};

const fallbackEvidence: StrategyEvidenceResponse = {
  cross_validated: false,
  bucket: null,
  mentions: [],
  fallback_source_note:
    "This strategy pre-dates the cross-validation layer (Pass 18). Recorded source: manual_injection.",
};

function makeFetchMock(payload: StrategyEvidenceResponse, opts: { status?: number } = {}) {
  return vi.fn(async () => {
    return new Response(JSON.stringify(payload), {
      status: opts.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("EvidenceTab", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("renders mentions and summary correctly for cross-validated strategy", async () => {
    global.fetch = makeFetchMock(sampleEvidence) as unknown as typeof fetch;

    renderWithClient(<EvidenceTab strategyId="strategy-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("evidence-content")).toBeInTheDocument();
    });

    // Source count displayed (multiple '3' values exist — count + distinct providers)
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    // The "/ 3" denominator appears beside the big count
    expect(screen.getByText("/ 3")).toBeInTheDocument();
    // Status pill
    expect(screen.getByText(/Cross-validated/)).toBeInTheDocument();
    // Fingerprint short hash (first 8 chars)
    expect(screen.getByText("abc12345")).toBeInTheDocument();
    // Each mention rendered
    expect(screen.getByTestId("evidence-mention-m1")).toBeInTheDocument();
    expect(screen.getByTestId("evidence-mention-m2")).toBeInTheDocument();
    expect(screen.getByTestId("evidence-mention-m3")).toBeInTheDocument();
    // Confidence chip on m2 (92%)
    expect(screen.getByText("92%")).toBeInTheDocument();
    // Provider breakdown row
    expect(screen.getByTestId("evidence-provider-breakdown")).toBeInTheDocument();
  });

  it("renders fallback explanation when cross_validated is false", async () => {
    global.fetch = makeFetchMock(fallbackEvidence) as unknown as typeof fetch;

    renderWithClient(
      <EvidenceTab
        strategyId="strategy-pre-pass-18"
        strategySource="manual_injection"
        strategyTags={["audit", "verification"]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("evidence-fallback")).toBeInTheDocument();
    });

    expect(screen.getByText(/Pre-cross-validation strategy/)).toBeInTheDocument();
    // 'pre-dates the cross-validation layer' appears in both the static
    // explanation paragraph and the fallback_source_note — confirm at least
    // one match is rendered.
    expect(
      screen.getAllByText(/pre-dates the cross-validation layer/).length,
    ).toBeGreaterThan(0);
    // Strategy source + tags surfaced
    expect(screen.getByText("manual_injection")).toBeInTheDocument();
    expect(screen.getByText("audit, verification")).toBeInTheDocument();
  });

  it("renders source URLs with target=_blank and rel=noopener noreferrer", async () => {
    global.fetch = makeFetchMock(sampleEvidence) as unknown as typeof fetch;

    renderWithClient(<EvidenceTab strategyId="strategy-1" />);

    const link = await screen.findByTestId("evidence-mention-link-m1");
    expect(link.getAttribute("href")).toBe("https://youtube.com/watch?v=abc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});
