/**
 * python-runner.ts — Deep-scan #16 Wave-1 Track 5 (HIGH #12) regression tests
 *
 * Fix: stderr `data` events from a Node child_process pipe do NOT respect line
 * boundaries — a single logical line (e.g. a PARITY_SHADOW_DRIFT_JSON /
 * INVARIANT_FAILURE_JSON / B15_BATTERY_JSON sentinel) can be split across two or
 * more "data" events. Before this fix, each chunk was split on "\n" independently
 * with no carry-over buffer, so a straddling sentinel line failed to parse in
 * EITHER half and silently vanished (logged as two meaningless partial warn lines,
 * with no truthinessEvents entry and no elevated error log).
 *
 * These tests verify:
 *   1. A sentinel split across two "data" chunks is reassembled and captured.
 *   2. A sentinel split across three "data" chunks is reassembled and captured.
 *   3. Normal single-chunk-per-line behavior (the Wave 6 baseline) is unaffected.
 *   4. A sentinel as the very last bytes written (no trailing "\n") is still
 *      captured via the close-time buffer flush.
 *   5. Multiple complete lines in a single chunk are still each processed once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLogger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("./logger.js", () => ({
  logger: mockLogger,
}));

vi.mock("../../shared/utils.js", () => ({
  parsePythonJson: vi.fn((raw: string) => JSON.parse(raw)),
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

// ─── Controlled child-process mock ───────────────────────────────────────────

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

let _spawnFactory: (() => FakeChild) | null = null;

vi.mock("child_process", () => ({
  spawn: vi.fn((..._args: unknown[]) => {
    if (!_spawnFactory) throw new Error("spawn called but no factory set");
    return _spawnFactory();
  }),
}));

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

// Helper: run runPythonModule, emit raw stderr chunks (NOT pre-split by line),
// then emit stdout + close. Returns the resolved result (with _truthiness_events
// attached) or the rejection message.
async function runWithRawStderrChunks(opts: {
  stdoutPayload: string;
  stderrChunks: string[];
  exitCode: number;
}): Promise<{ resolved: boolean; value: unknown }> {
  const { runPythonModule } = await import("./python-runner.js");

  let fakeChild: FakeChild;
  _spawnFactory = () => {
    fakeChild = makeFakeChild();
    return fakeChild;
  };

  const promise = runPythonModule({
    module: "src.engine.backtester",
    componentName: "backtest-engine",
    timeoutMs: 5000,
  });

  await Promise.resolve();

  for (const chunk of opts.stderrChunks) {
    fakeChild!.stderr.emit("data", Buffer.from(chunk));
  }

  if (opts.stdoutPayload) {
    fakeChild!.stdout.emit("data", Buffer.from(opts.stdoutPayload));
  }

  fakeChild!.emit("close", opts.exitCode);

  try {
    const value = await promise;
    return { resolved: true, value };
  } catch (err) {
    return { resolved: false, value: err instanceof Error ? err.message : String(err) };
  }
}

describe("HIGH #12 — stderr line-buffering across chunk boundaries (deep-scan #16)", () => {
  beforeEach(() => {
    vi.resetModules();
    _spawnFactory = null;
    mockLogger.warn.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  afterEach(() => {
    _spawnFactory = null;
  });

  it("reassembles a PARITY_SHADOW_DRIFT_JSON sentinel split across two data chunks", async () => {
    const sentinelJson = JSON.stringify({ drift_pct: 0.12, metric: "sharpe_ratio" });
    const fullLine = `PARITY_SHADOW_DRIFT_JSON ${sentinelJson}\n`;
    // Split the line in the middle of the JSON payload — this is the exact
    // failure mode: neither half parses as valid sentinel JSON on its own.
    const splitPoint = Math.floor(fullLine.length / 2);
    const chunk1 = fullLine.slice(0, splitPoint);
    const chunk2 = fullLine.slice(splitPoint);

    const result = await runWithRawStderrChunks({
      stdoutPayload: '{"total_return": 100}',
      stderrChunks: [chunk1, chunk2],
      exitCode: 0,
    });

    expect(result.resolved).toBe(true);
    const truthinessEvents = (result.value as Record<string, unknown>)["_truthiness_events"] as
      | Array<{ type: string; payload: Record<string, unknown> }>
      | undefined;
    expect(truthinessEvents).toBeDefined();
    expect(truthinessEvents).toHaveLength(1);
    expect(truthinessEvents![0].type).toBe("parity_shadow_drift");
    expect(truthinessEvents![0].payload).toEqual({ drift_pct: 0.12, metric: "sharpe_ratio" });

    // The sentinel must be logged at error (elevated), not lost as two warn half-lines.
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sentinelType: "parity_shadow_drift" }),
      expect.stringContaining("truthiness sentinel captured"),
    );
  });

  it("reassembles an INVARIANT_FAILURE_JSON sentinel split across THREE data chunks", async () => {
    const sentinelJson = JSON.stringify({ invariant: "no_negative_equity", violated_at_bar: 4821 });
    const fullLine = `INVARIANT_FAILURE_JSON ${sentinelJson}\n`;
    const third = Math.floor(fullLine.length / 3);
    const chunk1 = fullLine.slice(0, third);
    const chunk2 = fullLine.slice(third, third * 2);
    const chunk3 = fullLine.slice(third * 2);

    const result = await runWithRawStderrChunks({
      stdoutPayload: '{"total_return": 100}',
      stderrChunks: [chunk1, chunk2, chunk3],
      exitCode: 0,
    });

    expect(result.resolved).toBe(true);
    const truthinessEvents = (result.value as Record<string, unknown>)["_truthiness_events"] as
      | Array<{ type: string; payload: Record<string, unknown> }>
      | undefined;
    expect(truthinessEvents).toHaveLength(1);
    expect(truthinessEvents![0].type).toBe("invariant_failure");
    expect(truthinessEvents![0].payload).toEqual({ invariant: "no_negative_equity", violated_at_bar: 4821 });
  });

  it("baseline: a sentinel delivered as one complete per-chunk line still works", async () => {
    const sentinelJson = JSON.stringify({ sdr: 0.9, psi: 0.02, rws: 0.1, passed: true });
    const result = await runWithRawStderrChunks({
      stdoutPayload: '{"total_return": 100}',
      stderrChunks: [`B15_BATTERY_JSON ${sentinelJson}\n`],
      exitCode: 0,
    });

    expect(result.resolved).toBe(true);
    const truthinessEvents = (result.value as Record<string, unknown>)["_truthiness_events"] as
      | Array<{ type: string; payload: Record<string, unknown> }>
      | undefined;
    expect(truthinessEvents).toHaveLength(1);
    expect(truthinessEvents![0].type).toBe("b15_battery");
  });

  it("captures a sentinel as the final bytes written with NO trailing newline (close-time flush)", async () => {
    const sentinelJson = JSON.stringify({ drift_pct: 0.05 });
    // No trailing "\n" — simulates the process exiting immediately after its last write.
    const noNewlineLine = `PARITY_SHADOW_DRIFT_JSON ${sentinelJson}`;

    const result = await runWithRawStderrChunks({
      stdoutPayload: '{"total_return": 100}',
      stderrChunks: [noNewlineLine],
      exitCode: 0,
    });

    expect(result.resolved).toBe(true);
    const truthinessEvents = (result.value as Record<string, unknown>)["_truthiness_events"] as
      | Array<{ type: string; payload: Record<string, unknown> }>
      | undefined;
    expect(truthinessEvents).toHaveLength(1);
    expect(truthinessEvents![0].payload).toEqual({ drift_pct: 0.05 });
  });

  it("processes multiple complete lines within a single chunk exactly once each", async () => {
    const line1 = "Some diagnostic banner line\n";
    const sentinelJson = JSON.stringify({ drift_pct: 0.2 });
    const line2 = `PARITY_SHADOW_DRIFT_JSON ${sentinelJson}\n`;
    const line3 = "Another diagnostic line\n";

    const result = await runWithRawStderrChunks({
      stdoutPayload: '{"total_return": 100}',
      stderrChunks: [line1 + line2 + line3],
      exitCode: 0,
    });

    expect(result.resolved).toBe(true);
    const truthinessEvents = (result.value as Record<string, unknown>)["_truthiness_events"] as
      | Array<{ type: string; payload: Record<string, unknown> }>
      | undefined;
    expect(truthinessEvents).toHaveLength(1);
    // Two plain diagnostic lines logged at warn, sentinel logged at error.
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });
});
