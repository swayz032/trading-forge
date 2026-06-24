/**
 * Component tests for PineDistributionPanel (Pass 3 Track B).
 *
 * Covers:
 *   1. "Download .pine" button renders when downloadUrl is non-null.
 *   2. "Download .pine" button is absent when downloadUrl is null.
 *   3. Clicking the button fires a GET to the correct URL.
 *   4. Loading state ("Downloading…") shows during fetch.
 *   5. Error toast fires on fetch failure (non-ok response).
 *
 * Backend is mocked at the fetch layer. The generate POST returns a synthetic
 * GenerateResult so the Download .pine button becomes visible in the tests
 * that need it.
 *
 * Note: toast is imported from @/hooks/use-toast (module-level singleton).
 * We spy on it directly rather than rendering a Toaster portal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PineDistributionPanel } from "../PineDistributionPanel";

// ─── Toast spy ────────────────────────────────────────────────────────────────
// The component calls toast() from @/hooks/use-toast. We mock the module so
// we can assert on calls without needing a Toaster in the render tree.
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
  useToast: () => ({ toast: toastSpy, toasts: [], dismiss: vi.fn() }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ASSIGNMENT = {
  accountId: "acc-001",
  strategyId: "strat-001",
  strategyName: "SMA Crossover MES 5m",
  familyMemberLabel: "Dad",
  firmId: "topstep",
  lastExportedAt: null,
  lastArtifactHash: null,
};

/** Generate POST result with a valid downloadUrl */
function makeGenerateResult(downloadUrl: string | null = "/api/pine-export/exp-1/artifacts/art-1/download") {
  return {
    artifact_path: "/tmp/dad.pine",
    artifact_hash: "abc12345def67890",
    export_id: "exp-1",
    artifact_id: "art-1",
    recipient_label: "Dad",
    qty: 6,
    setup_readme: "# Setup README\nFollow these steps...",
    presigned_url: null,
    downloadUrl,
  };
}

// ─── Fetch mock helpers ────────────────────────────────────────────────────────

type FetchLike = typeof global.fetch;

function makeSuccessGenerateFetch(downloadUrl: string | null = "/api/pine-export/exp-1/artifacts/art-1/download"): FetchLike {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/pine-export/recipient")) {
      return new Response(JSON.stringify(makeGenerateResult(downloadUrl)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
  }) as unknown as FetchLike;
}

function makeDownloadSuccessFetch(downloadUrl: string): FetchLike {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/pine-export/recipient")) {
      return new Response(JSON.stringify(makeGenerateResult(downloadUrl)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === downloadUrl) {
      const blob = new Blob(["// pine script content"], { type: "text/plain" });
      return new Response(blob, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
  }) as unknown as FetchLike;
}

function makeDownloadFailFetch(downloadUrl: string): FetchLike {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/pine-export/recipient")) {
      return new Response(JSON.stringify(makeGenerateResult(downloadUrl)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === downloadUrl) {
      return new Response(JSON.stringify({ error: "SHADOW strategy — export refused" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
  }) as unknown as FetchLike;
}

// ─── Render helper ────────────────────────────────────────────────────────────

function renderPanel(assignments = [ASSIGNMENT]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PineDistributionPanel assignments={assignments} />
    </QueryClientProvider>,
  );
}

// ─── URL.createObjectURL stub ─────────────────────────────────────────────────
// jsdom does not implement this; stub it so blob-download tests don't throw.
const createObjectURLSpy = vi.fn(() => "blob:fake");
const revokeObjectURLSpy = vi.fn();
Object.defineProperty(URL, "createObjectURL", { value: createObjectURLSpy, writable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURLSpy, writable: true });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PineDistributionPanel — Download .pine button", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    toastSpy.mockClear();
    createObjectURLSpy.mockClear();
    revokeObjectURLSpy.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("renders Download .pine button after generation when downloadUrl is non-null", async () => {
    const DOWNLOAD_URL = "/api/pine-export/exp-1/artifacts/art-1/download";
    global.fetch = makeSuccessGenerateFetch(DOWNLOAD_URL);

    renderPanel();

    // Click the generate button
    const generateBtn = screen.getByRole("button", { name: /Generate Pine for Dad/i });
    await act(async () => { fireEvent.click(generateBtn); });

    // Download .pine button should appear
    await waitFor(() => {
      expect(screen.getByTestId("download-pine-btn")).toBeInTheDocument();
    });
  });

  it("does NOT render Download .pine button when downloadUrl is null", async () => {
    // Generate returns downloadUrl: null (Track A not yet merged)
    global.fetch = makeSuccessGenerateFetch(null);

    renderPanel();

    const generateBtn = screen.getByRole("button", { name: /Generate Pine for Dad/i });
    await act(async () => { fireEvent.click(generateBtn); });

    // README button should be present (verify generate succeeded)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Download README/i })).toBeInTheDocument();
    });

    // But Download .pine should NOT be present
    expect(screen.queryByTestId("download-pine-btn")).not.toBeInTheDocument();
  });

  it("fires a GET to the correct downloadUrl when the button is clicked", async () => {
    const DOWNLOAD_URL = "/api/pine-export/exp-1/artifacts/art-1/download";
    const fetchMock = makeDownloadSuccessFetch(DOWNLOAD_URL);
    global.fetch = fetchMock;

    renderPanel();

    // Generate first
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Generate Pine for Dad/i }));
    });

    const pineBtn = await screen.findByTestId("download-pine-btn");

    // Click download
    await act(async () => { fireEvent.click(pineBtn); });

    await waitFor(() => {
      // Verify a fetch call was made to the download URL
      const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls as [string | URL, RequestInit?][];
      const downloadCall = calls.find(([url]) => {
        const u = typeof url === "string" ? url : url.toString();
        return u === DOWNLOAD_URL;
      });
      expect(downloadCall).toBeTruthy();
    });
  });

  it("shows loading state (Downloading…) on the button during fetch", async () => {
    const DOWNLOAD_URL = "/api/pine-export/exp-1/artifacts/art-1/download";

    // Make the download stall until we resolve it manually
    let resolveDownload!: (value: Response) => void;
    const stallPromise = new Promise<Response>((res) => { resolveDownload = res; });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/pine-export/recipient")) {
        return new Response(JSON.stringify(makeGenerateResult(DOWNLOAD_URL)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === DOWNLOAD_URL) {
        return stallPromise;
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
    }) as unknown as FetchLike;

    global.fetch = fetchMock;

    renderPanel();

    // Generate
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Generate Pine for Dad/i }));
    });
    const pineBtn = await screen.findByTestId("download-pine-btn");

    // Start download (don't await — let it stall)
    act(() => { fireEvent.click(pineBtn); });

    // Button should show loading text
    await waitFor(() => {
      expect(screen.getByTestId("download-pine-btn")).toHaveTextContent("Downloading…");
    });

    // Resolve the stall
    const blob = new Blob(["// content"], { type: "text/plain" });
    await act(async () => {
      resolveDownload(new Response(blob, { status: 200 }));
    });
  });

  it("fires error toast on non-ok download response", async () => {
    const DOWNLOAD_URL = "/api/pine-export/exp-1/artifacts/art-1/download";
    global.fetch = makeDownloadFailFetch(DOWNLOAD_URL);

    renderPanel();

    // Generate
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Generate Pine for Dad/i }));
    });

    const pineBtn = await screen.findByTestId("download-pine-btn");

    await act(async () => { fireEvent.click(pineBtn); });

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Download failed",
          variant: "destructive",
        }),
      );
    });
  });
});
