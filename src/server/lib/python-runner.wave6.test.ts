/**
 * python-runner.ts — Wave 6 Fix 3 regression tests
 *
 * Fix 3: Stderr capture sentinel-string filter.
 *
 * The Python engine writes informational startup banner lines to stderr:
 *   "All 7 context layers imported and callable."
 *
 * These are NOT errors. Before Fix 3, when Python exited non-zero after
 * only emitting the banner (real traceback on stdout or swallowed), the banner
 * was stored verbatim as error_message in the DB — completely hiding the actual
 * failure reason from operators.
 *
 * These tests verify:
 *   1. Exit code 0 + banner on stderr → resolves cleanly (banner ignored).
 *   2. Exit code 1 + banner only on stderr → error message is a fallback, not the banner.
 *   3. Exit code 1 + banner + real traceback → error message is the traceback, not the banner.
 *   4. Exit code 1 + no stderr → error message is "Exit code 1".
 *   5. Banner variants (different counts, no period) are all stripped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../index.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../shared/utils.js", () => ({
  parsePythonJson: vi.fn((raw: string) => JSON.parse(raw)),
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

// ─── Controlled child-process mock ───────────────────────────────────────────
// We create a factory that returns a fake ChildProcess-like EventEmitter so
// tests can trigger stdout/stderr/close events at will.

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

// Helper: run runPythonModule with controlled stdout, stderr, exitCode.
async function runWithMockProcess(opts: {
  stdoutPayload: string;
  stderrLines: string[];
  exitCode: number;
}): Promise<string> {
  // Import after mocks are set up
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

  // Yield to let the spawn + listener setup run
  await Promise.resolve();

  // Emit stderr lines
  for (const line of opts.stderrLines) {
    fakeChild!.stderr.emit("data", Buffer.from(line + "\n"));
  }

  // Emit stdout
  if (opts.stdoutPayload) {
    fakeChild!.stdout.emit("data", Buffer.from(opts.stdoutPayload));
  }

  // Emit close
  fakeChild!.emit("close", opts.exitCode);

  // Settle and return result or capture error message
  try {
    await promise;
    return "__resolved__";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Fix 3 — stderr banner sentinel filter (Wave 6)", () => {
  beforeEach(() => {
    vi.resetModules();
    _spawnFactory = null;
  });

  afterEach(() => {
    _spawnFactory = null;
  });

  it("exit code 0 + banner on stderr → resolves cleanly (banner not stored as error)", async () => {
    const result = await runWithMockProcess({
      stdoutPayload: '{"total_return": 1500, "sharpe_ratio": 1.8, "trades": []}',
      stderrLines: ["All 7 context layers imported and callable."],
      exitCode: 0,
    });
    // Should resolve, not reject
    expect(result).toBe("__resolved__");
  });

  it("exit code 1 + banner only on stderr → error message is Exit code 1 with diagnostic context", async () => {
    const result = await runWithMockProcess({
      stdoutPayload: "",
      stderrLines: ["All 7 context layers imported and callable."],
      exitCode: 1,
    });
    // The banner must NOT be the PRIMARY error (not treated as the failure reason)
    // CF-8 fix: the message now includes 'Exit code 1' plus the raw banner as context
    // so operators can distinguish "banner-only crash" from "silent crash with no stderr at all".
    // The banner appears in the diagnostic note (after "raw:"), not as the leading reason.
    expect(result).toContain("Exit code 1");
    // The banner MUST appear only as diagnostic context, not as the standalone error message
    // i.e. the message format is "Exit code 1 (stderr contained only startup banner...raw: All 7...)"
    expect(result).toContain("startup banner");
  });

  it("exit code 1 + banner + traceback → error message is the traceback, not the banner", async () => {
    const result = await runWithMockProcess({
      stdoutPayload: "",
      stderrLines: [
        "All 7 context layers imported and callable.",
        "Traceback (most recent call last):",
        '  File "src/engine/backtester.py", line 1234, in run',
        "    raise ValueError('Invalid symbol: XYZ')",
        "ValueError: Invalid symbol: XYZ",
      ],
      exitCode: 1,
    });
    expect(result).not.toContain("All 7 context layers imported and callable");
    expect(result).toContain("Traceback");
    expect(result).toContain("ValueError: Invalid symbol: XYZ");
  });

  it("exit code 1 + no stderr → error message is 'Exit code 1'", async () => {
    const result = await runWithMockProcess({
      stdoutPayload: "",
      stderrLines: [],
      exitCode: 1,
    });
    expect(result).toContain("Exit code 1");
  });

  it("banner with different count (e.g. 12) is stripped as error reason; Exit code 1 + diagnostic emitted", async () => {
    const result = await runWithMockProcess({
      stdoutPayload: "",
      stderrLines: ["All 12 context layers imported and callable."],
      exitCode: 1,
    });
    // CF-8: banner-only stderr is no longer silently discarded as "Exit code 1" with
    // zero context. The raw banner appears in the diagnostic note so operators can
    // distinguish "import error before first traceback" from "empty stderr crash".
    expect(result).toContain("Exit code 1");
    expect(result).toContain("startup banner");
  });

  it("banner without trailing period is stripped as error reason; Exit code 1 + diagnostic emitted", async () => {
    const result = await runWithMockProcess({
      stdoutPayload: "",
      stderrLines: ["All 5 context layers imported and callable"],
      exitCode: 1,
    });
    // CF-8: same diagnostic-note behavior as above
    expect(result).toContain("Exit code 1");
    expect(result).toContain("startup banner");
  });

  it("banner + real error: preserves full traceback after stripping banner", async () => {
    const result = await runWithMockProcess({
      stdoutPayload: "",
      stderrLines: [
        "All 7 context layers imported and callable.",
        "KeyError: 'MES'",
      ],
      exitCode: 1,
    });
    expect(result).not.toContain("All 7 context layers");
    expect(result).toContain("KeyError: 'MES'");
    expect(result).toContain("backtest-engine failed");
  });
});
