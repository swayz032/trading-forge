/**
 * Deepscan #8 Fix Wave — runner fixes unit tests
 *
 * FIX 1: DETERMINISM_MODE="true" in env builders (all three runners)
 * FIX 2: Per-pid NUMBA_CACHE_DIR in env builders (all three runners)
 * FIX 7: registerExternalPythonSubprocess — quantum runners register spawned proc
 * FIX 8: TF_PYTHON_USER_SITE env-var override replaces hardcoded user-site path
 *
 * FIX 1/2/8 are tested via the spawn env capture approach on python-runner.ts
 * (the canonical implementation). Quantum runners follow the identical pattern;
 * their _buildPythonEnv / _buildTrainingEnv are verified by grep proof + tsc 0.
 *
 * FIX 7 is tested directly through the exported registerExternalPythonSubprocess.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ─── fs / os / crypto mocks (must be hoisted above imports) ──────────────────

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => false),
  // FIX 2: mkdirSync must be present so module-level _NUMBA_CACHE_DIR init doesn't throw
  mkdirSync: vi.fn(),
}));

vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-abcd1234"),
}));

// ─── logger mock (leaf import — NEVER ../index.js) ───────────────────────────

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Controlled child-process mock ───────────────────────────────────────────

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid?: number;
};

function makeFakeChild(pid = 99999): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = pid;
  return child;
}

// Captures the options.env passed to every spawn() call
const capturedSpawnEnvs: NodeJS.ProcessEnv[] = [];
let _nextChild: FakeChild | null = null;

vi.mock("child_process", () => ({
  spawn: vi.fn((_cmd: string, _args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
    capturedSpawnEnvs.push(opts?.env ?? {});
    if (!_nextChild) {
      _nextChild = makeFakeChild();
    }
    return _nextChild;
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fire runPythonModule with a controlled stdout payload and exit code.
 * Useful for capturing the env that was passed to spawn.
 */
async function callRunPythonModuleCapturingEnv(extraEnv: Record<string, string> = {}): Promise<void> {
  // Set any extra env vars needed for this call
  const origEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(extraEnv)) {
    origEnv[k] = process.env[k];
    process.env[k] = v;
  }

  const { runPythonModule } = await import("../python-runner.js");
  const child = makeFakeChild();
  _nextChild = child;

  const promise = runPythonModule({
    module: "src.engine.backtester",
    componentName: "backtest-engine",
    timeoutMs: 5000,
  });

  // Yield to let spawn and listener setup run
  await Promise.resolve();

  // Emit valid JSON result on stdout then close
  child.stdout.emit("data", Buffer.from(JSON.stringify({ sharpe: 1.5 })));
  child.emit("close", 0);

  await promise;

  // Restore env
  for (const [k, orig] of Object.entries(origEnv)) {
    if (orig === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = orig;
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FIX 7 — registerExternalPythonSubprocess", () => {
  beforeEach(() => {
    vi.resetModules();
    capturedSpawnEnvs.length = 0;
    _nextChild = null;
  });

  afterEach(() => {
    _nextChild = null;
  });

  it("adds subprocess to shutdown set — gracefullyShutdownPythonSubprocesses sends SIGTERM", async () => {
    const { registerExternalPythonSubprocess, gracefullyShutdownPythonSubprocesses } =
      await import("../python-runner.js");

    const fakeChild = makeFakeChild(12345);
    registerExternalPythonSubprocess(fakeChild as unknown as import("child_process").ChildProcess);

    // Emit exit immediately so shutdown doesn't time out waiting for the process
    setImmediate(() => fakeChild.emit("exit", 0, null));

    await gracefullyShutdownPythonSubprocesses(200);

    // The shutdown function sends SIGTERM to all registered subprocesses
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("removes subprocess from the set on 'exit' — not reached in subsequent shutdown", async () => {
    const { registerExternalPythonSubprocess, gracefullyShutdownPythonSubprocesses } =
      await import("../python-runner.js");

    const fakeChild = makeFakeChild(22222);
    registerExternalPythonSubprocess(fakeChild as unknown as import("child_process").ChildProcess);

    // Exit immediately — auto-removes from _activeSubprocesses
    fakeChild.emit("exit", 0, null);

    vi.clearAllMocks();
    // After exit, a subsequent shutdown call won't invoke kill again
    await gracefullyShutdownPythonSubprocesses(100);
    expect(fakeChild.kill).not.toHaveBeenCalled();
  });

  it("is callable without throwing (TS type contract)", async () => {
    const { registerExternalPythonSubprocess } = await import("../python-runner.js");

    const fakeChild = makeFakeChild(33333);
    expect(() => {
      registerExternalPythonSubprocess(fakeChild as unknown as import("child_process").ChildProcess);
    }).not.toThrow();

    // Clean up
    fakeChild.emit("exit", 0, null);
  });
});

describe("FIX 1 — DETERMINISM_MODE='true' in runPythonModule env", () => {
  beforeEach(() => {
    vi.resetModules();
    capturedSpawnEnvs.length = 0;
    _nextChild = null;
  });

  afterEach(() => {
    _nextChild = null;
  });

  it("passes DETERMINISM_MODE='true' to spawn", async () => {
    await callRunPythonModuleCapturingEnv();
    expect(capturedSpawnEnvs.length).toBeGreaterThan(0);
    expect(capturedSpawnEnvs[0]?.DETERMINISM_MODE).toBe("true");
  });
});

describe("FIX 2 — NUMBA_CACHE_DIR in runPythonModule env", () => {
  beforeEach(() => {
    vi.resetModules();
    capturedSpawnEnvs.length = 0;
    _nextChild = null;
  });

  afterEach(() => {
    _nextChild = null;
  });

  it("passes NUMBA_CACHE_DIR to spawn env", async () => {
    await callRunPythonModuleCapturingEnv();
    expect(capturedSpawnEnvs.length).toBeGreaterThan(0);
    expect(capturedSpawnEnvs[0]?.NUMBA_CACHE_DIR).toBeDefined();
    // Per-pid: should contain process.pid
    expect(capturedSpawnEnvs[0]?.NUMBA_CACHE_DIR).toContain(String(process.pid));
  });

  it("NUMBA_CACHE_DIR uses the tf-numba-cache prefix (platform-agnostic check)", async () => {
    await callRunPythonModuleCapturingEnv();
    // Platform-agnostic: on Windows pathJoin uses backslashes, so check for the
    // key tf-numba-cache prefix rather than the os separator.
    expect(capturedSpawnEnvs[0]?.NUMBA_CACHE_DIR).toContain("tf-numba-cache");
  });
});

describe("FIX 8 — TF_PYTHON_USER_SITE override in PYTHONPATH", () => {
  beforeEach(() => {
    vi.resetModules();
    capturedSpawnEnvs.length = 0;
    _nextChild = null;
  });

  afterEach(() => {
    _nextChild = null;
    delete process.env.TF_PYTHON_USER_SITE;
  });

  it("uses TF_PYTHON_USER_SITE when set, instead of the hardcoded path", async () => {
    const customSite = "C:\\CustomPython\\site-packages";
    await callRunPythonModuleCapturingEnv({ TF_PYTHON_USER_SITE: customSite });
    const pythonPath = capturedSpawnEnvs[0]?.PYTHONPATH ?? "";
    expect(pythonPath).toContain(customSite);
    // Hardcoded path should NOT appear when override is set
    expect(pythonPath).not.toContain("tonio\\AppData\\Roaming\\Python\\Python313\\site-packages");
  });

  it("falls back to the hardcoded user-site when TF_PYTHON_USER_SITE is unset", async () => {
    // Ensure unset
    delete process.env.TF_PYTHON_USER_SITE;
    await callRunPythonModuleCapturingEnv();
    const pythonPath = capturedSpawnEnvs[0]?.PYTHONPATH ?? "";
    expect(pythonPath).toContain("Python313\\site-packages");
  });
});
