/**
 * Real HTTP integration test for GET /api/bars/:symbol — a minimal express app
 * mounting only barsRoutes, listening on an ephemeral port, exercised via native
 * fetch(). Only runPythonModule is mocked (the Python/S3 boundary); everything
 * else (zod validation, bars-window shaping, route branching) runs for real.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { Server } from "node:http";

vi.mock("../../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runPythonModule } from "../../lib/python-runner.js";
import { barsRoutes } from "../bars.js";

const mockRunPythonModule = vi.mocked(runPythonModule);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/bars", barsRoutes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mockRunPythonModule.mockReset();
});

function bar(ts: string, o = 1, h = 2, l = 0.5, c = 1.5, v: number | null = 100) {
  return { ts_event: ts, open: o, high: h, low: l, close: c, volume: v };
}

describe("GET /api/bars/:symbol", () => {
  it("daily: calls the real python-runner contract and returns newest-first bars", async () => {
    mockRunPythonModule.mockResolvedValue({
      bars: [
        bar("2026-06-01T09:30:00Z", 100, 105, 99, 104, 1000),
        bar("2026-06-02T09:30:00Z", 101, 106, 100, 105, 1100),
      ],
    });
    const resp = await fetch(`${baseUrl}/api/bars/MES?timeframe=1d&limit=2`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { bars: Array<{ date: string }> };
    expect(body.bars).toHaveLength(2);
    expect(body.bars[0].date).toBe("2026-06-02"); // newest-first

    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);
    const callArgs = mockRunPythonModule.mock.calls[0][0];
    expect(callArgs.module).toBe("src.engine.data_loader");
    expect(callArgs.args).toContain("--symbol");
    expect(callArgs.args).toContain("MES");
    expect(callArgs.args).toContain("--timeframe");
    expect(callArgs.args).toContain("1d");
  });

  it("symbol with no data anywhere (e.g. DXY) returns honest empty 200 — not fabricated, not 404", async () => {
    mockRunPythonModule.mockResolvedValue({ bars: [] });
    const resp = await fetch(`${baseUrl}/api/bars/DXY?timeframe=1d&limit=2`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { bars: unknown[] };
    expect(body.bars).toEqual([]);
  });

  it("genuine python subprocess failure returns 502 — distinguishable from honest-empty", async () => {
    mockRunPythonModule.mockRejectedValue(new Error("S3 credentials missing"));
    const resp = await fetch(`${baseUrl}/api/bars/MES?timeframe=1d&limit=2`);
    expect(resp.status).toBe(502);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("bars_fetch_failed");
  });

  it("overnight window: does not truncate a ~186-bar window at limit=120", async () => {
    const raw: ReturnType<typeof bar>[] = [];
    let t = new Date("2026-06-01T22:00:00Z").getTime();
    const endT = new Date("2026-06-02T13:25:00Z").getTime();
    while (t <= endT) {
      raw.push(bar(new Date(t).toISOString()));
      t += 5 * 60_000;
    }
    mockRunPythonModule.mockResolvedValue({ bars: raw });
    const resp = await fetch(
      `${baseUrl}/api/bars/MES?date=2026-06-02&timeframe=5m&limit=120&overnight=true`,
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { bars: unknown[] };
    expect(body.bars.length).toBeGreaterThan(120);

    // fetch window passed to python must start the day BEFORE the session date
    const callArgs = mockRunPythonModule.mock.calls[0][0];
    const startIdx = callArgs.args!.indexOf("--start");
    expect(callArgs.args![startIdx + 1]).toBe("2026-06-01");
  });

  it("intraday timeframe without date is a 400 (not silently defaulted)", async () => {
    const resp = await fetch(`${baseUrl}/api/bars/MES?timeframe=5m&limit=1`);
    expect(resp.status).toBe(400);
    expect(mockRunPythonModule).not.toHaveBeenCalled();
  });

  it("invalid symbol is rejected before ever calling python", async () => {
    const resp = await fetch(`${baseUrl}/api/bars/${encodeURIComponent("bad symbol!")}?timeframe=1d`);
    expect(resp.status).toBe(400);
    expect(mockRunPythonModule).not.toHaveBeenCalled();
  });

  it("limit=1 with date returns exactly the first RTH bar (09:30 ET)", async () => {
    mockRunPythonModule.mockResolvedValue({
      bars: [
        bar("2026-06-02T13:35:00Z"),
        bar("2026-06-02T13:30:00Z"),
        bar("2026-06-02T13:25:00Z"),
      ],
    });
    const resp = await fetch(`${baseUrl}/api/bars/MES?date=2026-06-02&timeframe=5m&limit=1`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { bars: Array<{ ts: string }> };
    expect(body.bars).toHaveLength(1);
    expect(body.bars[0].ts).toBe("2026-06-02T13:30:00Z");
  });

  it("hour-window (London range style) filters to the requested ET hours only", async () => {
    mockRunPythonModule.mockResolvedValue({
      bars: [
        bar("2026-06-02T07:00:00Z"), // 03:00 ET — in window
        bar("2026-06-02T12:00:00Z"), // 08:00 ET — excluded (end exclusive)
      ],
    });
    const resp = await fetch(
      `${baseUrl}/api/bars/MES?date=2026-06-02&timeframe=5m&start_hour_et=3&end_hour_et=8`,
    );
    const body = (await resp.json()) as { bars: unknown[] };
    expect(body.bars).toHaveLength(1);
  });
});
