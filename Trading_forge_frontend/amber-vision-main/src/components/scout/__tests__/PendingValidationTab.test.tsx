/**
 * Component tests for the Pending Validation Watchlist (Pass 18).
 *
 * The backend endpoints (`/api/agent/pending-buckets...`) are mocked via
 * `vi.spyOn(global, "fetch")` so the UI can be developed and verified
 * independently of the parallel backend agent's slice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PendingValidationTab } from "../PendingValidationTab";
import { PendingBucketRow } from "../PendingBucketRow";
import type { PendingBucket } from "@/types/pending-buckets";

// `useSSE` opens an EventSource against the real backend — stub the singleton
// to a no-op so the test environment doesn't try to hold network state open.
vi.mock("@/hooks/useSSE", () => ({
  useSSE: () => {},
}));

const sampleBuckets: PendingBucket[] = [
  {
    id: "bucket-1",
    fingerprintHash: "abc123",
    market: "MES",
    entryArchetype: "opening_range_breakout",
    exitType: "atr_multiple",
    sourceCount: 2,
    distinctProviders: 2,
    status: "pending",
    firstSeenAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    graduatedAt: null,
    graduatedStrategyId: null,
    providers: ["youtube", "reddit"],
  },
  {
    id: "bucket-2",
    fingerprintHash: "def456",
    market: "MNQ",
    entryArchetype: "mean_reversion",
    exitType: "trailing_stop",
    sourceCount: 1,
    distinctProviders: 1,
    status: "pending",
    firstSeenAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    graduatedAt: null,
    graduatedStrategyId: null,
    providers: ["tavily"],
  },
];

function makeFetchMock(opts: {
  buckets?: PendingBucket[];
  graduateOk?: boolean;
  killOk?: boolean;
}) {
  // Simulate a tiny backend store so post-mutation refetches see the side
  // effects (the kill/graduate routes flip status server-side; the list
  // endpoint then no longer returns those rows when status=pending).
  const store = new Map<string, PendingBucket>(
    (opts.buckets ?? []).map((b) => [b.id, { ...b }]),
  );

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (
      method === "GET" &&
      url.includes("/api/agent/pending-buckets") &&
      !url.includes("/mentions")
    ) {
      const statusMatch = url.match(/status=([^&]+)/);
      const wantStatus = statusMatch ? decodeURIComponent(statusMatch[1]) : null;
      const list = Array.from(store.values()).filter(
        (b) => !wantStatus || b.status === wantStatus,
      );
      return new Response(
        JSON.stringify({ data: list, total: list.length }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const idMatch = url.match(/pending-buckets\/([^/]+)\/(graduate|kill|mentions)/);
    if (method === "POST" && idMatch) {
      const [, id, action] = idMatch;
      const bucket = store.get(id);
      if (action === "graduate") {
        if (opts.graduateOk === false) {
          return new Response(JSON.stringify({ error: "failed" }), { status: 500 });
        }
        if (bucket) bucket.status = "graduated";
        return new Response(JSON.stringify({ ok: true, status: "graduated" }), { status: 200 });
      }
      if (action === "kill") {
        if (opts.killOk === false) {
          return new Response(JSON.stringify({ error: "failed" }), { status: 500 });
        }
        if (bucket) bucket.status = "killed";
        return new Response(JSON.stringify({ ok: true, status: "killed" }), { status: 200 });
      }
    }

    if (method === "GET" && url.includes("/mentions")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
  });
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

describe("PendingValidationTab", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("renders pending buckets returned by the API with progress and chips", async () => {
    global.fetch = makeFetchMock({ buckets: sampleBuckets }) as unknown as typeof fetch;

    renderWithClient(<PendingValidationTab />);

    await waitFor(() => {
      expect(screen.getByText("opening_range_breakout")).toBeInTheDocument();
      expect(screen.getByText("mean_reversion")).toBeInTheDocument();
    });

    // Progress label for bucket-1 = 2/3
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();

    // Provider chips visible
    expect(screen.getByText("youtube")).toBeInTheDocument();
    expect(screen.getByText("reddit")).toBeInTheDocument();
    expect(screen.getByText("tavily")).toBeInTheDocument();
  });

  it("renders the empty state when no pending buckets exist", async () => {
    global.fetch = makeFetchMock({ buckets: [] }) as unknown as typeof fetch;

    renderWithClient(<PendingValidationTab />);

    await waitFor(() => {
      expect(screen.getByTestId("pending-buckets-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/No pending strategy candidates/i)).toBeInTheDocument();
  });

  it("optimistically removes a bucket row when Kill is confirmed", async () => {
    const fetchMock = makeFetchMock({ buckets: sampleBuckets });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderWithClient(<PendingValidationTab />);

    const row1 = await screen.findByTestId("pending-bucket-row-bucket-1");
    fireEvent.click(within(row1).getByTestId("kill-trigger-bucket-1"));

    // Confirmation dialog renders into a portal — query the document.
    const confirm = await screen.findByTestId("kill-confirm-bucket-1");
    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("pending-bucket-row-bucket-1")).not.toBeInTheDocument();
    });
    // Other rows remain
    expect(screen.getByTestId("pending-bucket-row-bucket-2")).toBeInTheDocument();

    // The kill endpoint was called
    const killCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/api/agent/pending-buckets/bucket-1/kill") &&
        init?.method === "POST",
    );
    expect(killCall).toBeTruthy();
  });

  it("fires the graduate mutation when confirmed", async () => {
    const fetchMock = makeFetchMock({ buckets: [sampleBuckets[0]] });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderWithClient(<PendingValidationTab />);

    const row = await screen.findByTestId("pending-bucket-row-bucket-1");
    fireEvent.click(within(row).getByTestId("graduate-trigger-bucket-1"));
    const confirm = await screen.findByTestId("graduate-confirm-bucket-1");

    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      const graduateCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/api/agent/pending-buckets/bucket-1/graduate") &&
          init?.method === "POST",
      );
      expect(graduateCall).toBeTruthy();
    });
  });

  it("PendingBucketRow renders market badge styling for known markets", () => {
    renderWithClient(<PendingBucketRow bucket={sampleBuckets[0]} />);
    // MES badge text
    expect(screen.getByText("MES")).toBeInTheDocument();
    // Archetype + exit are rendered
    expect(screen.getByText("opening_range_breakout")).toBeInTheDocument();
    expect(screen.getByText("atr_multiple")).toBeInTheDocument();
  });
});
