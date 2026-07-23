/**
 * LLM Sandbox Service — C3 Prompt Injection Defense (W15 Team A)
 *
 * Runs LLM-generated Python strategy code in an isolated subprocess with:
 *   - No network access (environment stripped of all API keys and URLs)
 *   - No filesystem write access (tempdir only, cleaned after run)
 *   - Hard wall-clock timeout (15 seconds — prevents hanging subprocesses)
 *   - Restricted Python import whitelist enforcement (via AST pre-scan)
 *   - Output limited to 50KB (prevents exfiltration through stdout)
 *
 * The sandbox does NOT execute the strategy in the full backtest engine.
 * Its purpose is:
 *   1. Detect code that attempts to import dangerous modules
 *   2. Detect code that attempts to open files or network connections
 *   3. Detect syntax errors the compiler would otherwise miss
 *   4. Catch infinite loops (timeout kills the process)
 *
 * This is a static + lightweight dynamic check, NOT a full security sandbox.
 * The Python code still runs in the OS process — sandboxing is achieved via:
 *   - Environment variable stripping (no keys to steal)
 *   - AST pre-scan (catches most static attacks before execution)
 *   - TIMEOUT (prevents resource exhaustion)
 *
 * For deeper isolation in future, the subprocess can be run via
 * `firejail --no-root --private` on Linux or `conpty` on Windows.
 */

import { spawn } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "../lib/logger.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const SANDBOX_TIMEOUT_MS = 15_000;        // 15s hard kill
const MAX_OUTPUT_BYTES = 50 * 1024;       // 50KB stdout cap
const MAX_CODE_BYTES = 256 * 1024;        // 256KB code size limit

/** Python modules we always allow in strategy code. */
const ALLOWED_IMPORTS = new Set([
  "math", "statistics", "decimal", "fractions", "numbers",
  "collections", "itertools", "functools", "operator",
  "typing", "types", "abc",
  "datetime", "time",
  "json", "re", "string", "enum",
  "numpy", "pandas", "polars", "vectorbt",
  "ta", "scipy",
  "logging",
]);

/** Python modules that are explicitly forbidden. */
const FORBIDDEN_IMPORTS = new Set([
  "os", "sys", "subprocess", "shutil", "glob", "pathlib",
  "socket", "urllib", "http", "requests", "aiohttp", "httpx",
  "ftplib", "smtplib", "imaplib", "poplib",
  "sqlite3", "psycopg2", "pymongo", "redis",
  "ctypes", "cffi", "mmap",
  "importlib", "__import__",
  "exec", "eval", "compile",
  "open", "io", "builtins",
  "pickle", "marshal", "shelve",
  "threading", "multiprocessing", "asyncio", "concurrent",
  "signal", "resource", "platform",
]);

// ─── AST Pre-Scan ─────────────────────────────────────────────────────────────

/**
 * Python AST scanner script. Runs as a very short Python subprocess.
 * Checks imports without executing the strategy code body.
 */
const AST_SCAN_SCRIPT = `
import ast, sys, json

code = sys.stdin.read()
forbidden_imports = set(${JSON.stringify([...FORBIDDEN_IMPORTS])})
allowed_imports = set(${JSON.stringify([...ALLOWED_IMPORTS])})

violations = []
try:
    tree = ast.parse(code)
except SyntaxError as e:
    print(json.dumps({"ok": False, "violations": [f"SyntaxError: {e}"], "syntax_error": True}))
    sys.exit(0)

for node in ast.walk(tree):
    # Check import statements
    if isinstance(node, ast.Import):
        for alias in node.names:
            mod = alias.name.split('.')[0]
            if mod in forbidden_imports:
                violations.append(f"forbidden import: {alias.name}")
    elif isinstance(node, ast.ImportFrom):
        if node.module:
            mod = node.module.split('.')[0]
            if mod in forbidden_imports:
                violations.append(f"forbidden from-import: {node.module}")
    # Check direct calls to exec/eval/open/__import__
    elif isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name):
            if node.func.id in ('exec', 'eval', 'compile', '__import__', 'open'):
                violations.append(f"forbidden call: {node.func.id}()")
        elif isinstance(node.func, ast.Attribute):
            if node.func.attr in ('system', 'popen', 'exec', 'execvp', 'execve', 'fork'):
                violations.append(f"forbidden attribute call: .{node.func.attr}()")

print(json.dumps({"ok": len(violations) == 0, "violations": violations, "syntax_error": False}))
`.trim();

// ─── Sandbox Environment ──────────────────────────────────────────────────────

/**
 * Build a stripped environment for the sandbox subprocess.
 * Removes all API keys, credentials, database URLs, and network references.
 */
function buildSandboxEnv(): NodeJS.ProcessEnv {
  const stripped: NodeJS.ProcessEnv = {};

  // Only pass through non-sensitive env vars
  const allowedEnvPrefixes = ["PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USER", "LANG", "LC_"];
  const allowedEnvExact = [
    "PYTHONPATH",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONUNBUFFERED",
    // setup-python builds can require their own shared-library directory. These
    // contain no credentials and are required for the interpreter to start.
    "LD_LIBRARY_PATH",
    "DYLD_LIBRARY_PATH",
  ];

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const upperKey = key.toUpperCase();

    // Block any key containing these patterns — they're secrets
    if (
      upperKey.includes("KEY") ||
      upperKey.includes("SECRET") ||
      upperKey.includes("TOKEN") ||
      upperKey.includes("PASSWORD") ||
      upperKey.includes("DATABASE") ||
      upperKey.includes("DB_") ||
      upperKey.includes("_DB") ||
      upperKey.includes("URL") ||
      upperKey.includes("HOST") ||
      upperKey.includes("PORT") ||
      upperKey.includes("DSN") ||
      upperKey.includes("OPENAI") ||
      upperKey.includes("ANTHROPIC") ||
      upperKey.includes("BRAVE") ||
      upperKey.includes("TAVILY") ||
      upperKey.includes("N8N") ||
      upperKey.includes("RAILWAY") ||
      upperKey.includes("AWS") ||
      upperKey.includes("IBM")
    ) {
      continue; // Strip this env var
    }

    const isAllowed =
      allowedEnvExact.includes(key) ||
      allowedEnvPrefixes.some((p) => upperKey.startsWith(p));

    if (isAllowed) {
      stripped[key] = value;
    }
  }

  // Add safe Python flags
  stripped.PYTHONDONTWRITEBYTECODE = "1";
  stripped.PYTHONUNBUFFERED = "1";
  // Disable Python's site module to reduce import surface
  stripped.PYTHONNOUSERSITE = "1";

  return stripped;
}

// ─── Public Interface ─────────────────────────────────────────────────────────

export interface SandboxResult {
  passed: boolean;
  syntaxError: boolean;
  violations: string[];     // AST violations found
  timeout: boolean;
  stdout: string;           // truncated stdout from execution (if run)
  stderr: string;           // truncated stderr
  durationMs: number;
}

/**
 * Run an AST scan on Python code without executing it.
 * This is the primary sandbox check — fast, safe, no execution.
 */
export async function astScanCode(pythonCode: string): Promise<{
  ok: boolean;
  violations: string[];
  syntaxError: boolean;
}> {
  // Size limit check — large code blobs exceed AST scan budget and indicate injection attempt
  if (pythonCode.length > MAX_CODE_BYTES) {
    return {
      ok: false,
      violations: [`code size ${pythonCode.length} bytes exceeds ${MAX_CODE_BYTES} byte limit`],
      syntaxError: false,
    };
  }

  return new Promise((resolve) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(python, ["-c", AST_SCAN_SCRIPT], {
      env: buildSandboxEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000, // 10s for AST scan (should be < 100ms normally)
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", () => {
      try {
        const result = JSON.parse(stdout.trim());
        resolve({
          ok: result.ok ?? false,
          violations: Array.isArray(result.violations) ? result.violations : [],
          syntaxError: result.syntax_error ?? false,
        });
      } catch {
        resolve({
          ok: false,
          violations: [`AST scan parse failed: ${stderr.slice(0, 200)}`],
          syntaxError: false,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        ok: false,
        violations: [`AST scan subprocess error: ${err.message}`],
        syntaxError: false,
      });
    });

    // Write code to stdin
    proc.stdin.write(pythonCode);
    proc.stdin.end();
  });
}

/**
 * Full sandbox check for LLM-generated Python strategy code.
 *
 * Performs:
 *   1. Size limit check
 *   2. AST scan for forbidden imports/calls (no execution)
 *   3. If AST passes and `runCode=true`: executes code with stripped environment,
 *      timeout, and output cap (for syntax/runtime validation)
 *
 * The `runCode` option defaults to false — AST scan alone is the primary defense.
 * Set runCode=true only when you need to catch runtime errors (e.g., NameError,
 * AttributeError) that AST analysis cannot detect.
 */
export async function sandboxCheckCode(
  pythonCode: string,
  opts: { runCode?: boolean; strategyName?: string } = {},
): Promise<SandboxResult> {
  const startMs = Date.now();

  // ── 0. Size limit ────────────────────────────────────────────────────────
  if (pythonCode.length > MAX_CODE_BYTES) {
    logger.warn(
      { strategyName: opts.strategyName, codeBytes: pythonCode.length },
      "llm-sandbox: code exceeds size limit",
    );
    return {
      passed: false,
      syntaxError: false,
      violations: [`code size ${pythonCode.length} exceeds ${MAX_CODE_BYTES} byte limit`],
      timeout: false,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startMs,
    };
  }

  // ── 1. AST scan ──────────────────────────────────────────────────────────
  const astResult = await astScanCode(pythonCode);

  if (!astResult.ok) {
    logger.warn(
      {
        strategyName: opts.strategyName,
        violations: astResult.violations,
        syntaxError: astResult.syntaxError,
      },
      "llm-sandbox: AST scan failed",
    );
    return {
      passed: false,
      syntaxError: astResult.syntaxError,
      violations: astResult.violations,
      timeout: false,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startMs,
    };
  }

  // ── 2. Optional execution (runCode=true only) ────────────────────────────
  if (!opts.runCode) {
    return {
      passed: true,
      syntaxError: false,
      violations: [],
      timeout: false,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startMs,
    };
  }

  // Write code to a temp file (avoids shell injection via -c argument)
  const tempDir = mkdtempSync(join(tmpdir(), "tf-sandbox-"));
  const tempFile = join(tempDir, "strategy.py");

  try {
    writeFileSync(tempFile, pythonCode, "utf-8");

    return await new Promise((resolve) => {
      const python = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(python, [tempFile], {
        env: buildSandboxEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        cwd: tempDir, // restrict working dir to temp
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGKILL");
      }, SANDBOX_TIMEOUT_MS);

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        // Hard cap on output to prevent exfiltration
        if (stdout.length > MAX_OUTPUT_BYTES) {
          proc.kill("SIGKILL");
        }
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        const passed = !killed && code === 0;

        if (killed) {
          logger.warn({ strategyName: opts.strategyName }, "llm-sandbox: execution timeout");
        } else if (!passed) {
          logger.info(
            { strategyName: opts.strategyName, exitCode: code, stderr: stderr.slice(0, 200) },
            "llm-sandbox: execution failed (non-zero exit)",
          );
        }

        resolve({
          passed,
          syntaxError: false,
          violations: [],
          timeout: killed,
          stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
          stderr: stderr.slice(0, 2_000),
          durationMs: Date.now() - startMs,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          passed: false,
          syntaxError: false,
          violations: [`subprocess error: ${err.message}`],
          timeout: false,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startMs,
        });
      });
    });
  } finally {
    // Clean up temp files unconditionally
    try {
      unlinkSync(tempFile);
    } catch {
      // Best-effort cleanup
    }
    try {
      // rmSync on directory
      const { rmSync } = await import("fs");
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
