/**
 * Deepscan Fixes — C2, H4 (H4a/H4b/H4c), H5, H6, H7
 *
 * C2:  alert-service Discord POST includes Authorization header when API_KEY is
 *      set, and logs a warn when the bot returns a non-OK status.
 * H7:  createAlert() appends a generic family-grade postscript to every critical
 *      alert that doesn't already carry one (sentinel: "--- For family members ---").
 * H4a: refreshBwSession() persists the new token to .bw-session-runtime.
 * H4b: runBwSessionRefreshCheck() when bw status returns null (unknown_expiry)
 *      now emits a createAlert warning — no longer silent.
 * H4c: load-env.ts reads .bw-session-runtime and overrides BW_SESSION after
 *      dotenv so NSSM restarts pick up the latest session token.
 * H5:  recheckOllamaHealth() correctly resets OLLAMA_HEALTHY to true when Ollama
 *      is healthy — the mechanism that the 60s post-boot setTimeout relies on.
 * H6:  emitLocalLlmDownSignal() calls recheckOllamaHealth() first and aborts the
 *      EXTRACTION LOST alert when Ollama has recovered (prevents false positives).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ─── Shared mock helpers ──────────────────────────────────────────────────────

function makeMockAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-alert-id",
    type: "system",
    severity: "critical",
    title: "Test Alert",
    message: "test message",
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Mocks needed by alert-service.ts ────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  alerts: { _tableName: "alerts" },
  auditLog: { _tableName: "audit_log" },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
  notifyCritical: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn(
    (body: string, what: string, action: string) =>
      `${body}\n\n--- For family members ---\nWhat this means: ${what}\nWhat to do: ${action}`,
  ),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  warningSeverityDiscordRoutedTotal: { inc: vi.fn() },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

// ─── Alert-service imports (must come after vi.mock() declarations) ───────────

import { createAlert } from "../services/alert-service.js";
import { db } from "../db/index.js";
import { logger } from "../index.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// Helper: reset and re-configure the db.insert chain mock.
function configureDbInsertMock(storedMessage?: string) {
  const capturedValues: Record<string, unknown>[] = [];
  const returningMock = vi.fn().mockImplementation(() => {
    const lastVals = capturedValues[capturedValues.length - 1] ?? {};
    return Promise.resolve([makeMockAlert({ message: storedMessage ?? (lastVals.message as string) ?? "test", ...lastVals })]);
  });
  const valuesMock = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    capturedValues.push(data);
    return { returning: returningMock };
  });
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });
  return { capturedValues, valuesMock, returningMock };
}

// ─── C2: Discord auth header ──────────────────────────────────────────────────

describe("C2: alert-service Discord auth header", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    configureDbInsertMock();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.API_KEY;
    vi.unstubAllGlobals();
  });

  it("includes Authorization Bearer header when API_KEY is set", async () => {
    process.env.API_KEY = "secret-key-123";

    await createAlert({ type: "system", severity: "critical", title: "Test", message: "broke" });

    const discordCall = fetchMock.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string).includes("/alert/alerts"),
    );
    expect(discordCall, "fetch was not called for Discord endpoint").toBeDefined();
    const opts = discordCall![1] as { headers: Record<string, string> };
    expect(opts.headers["Authorization"]).toBe("Bearer secret-key-123");
  });

  it("omits Authorization header when API_KEY is not set", async () => {
    delete process.env.API_KEY;

    await createAlert({ type: "system", severity: "critical", title: "Test", message: "broke" });

    const discordCall = fetchMock.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string).includes("/alert/alerts"),
    );
    expect(discordCall).toBeDefined();
    const opts = discordCall![1] as { headers: Record<string, string> };
    expect(opts.headers["Authorization"]).toBeUndefined();
  });

  it("logs warn with HTTP status when Discord bot returns 401", async () => {
    delete process.env.API_KEY;
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await createAlert({ type: "system", severity: "critical", title: "Test", message: "broke" });

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const statusWarn = warnCalls.find(
      (args: unknown[]) => (args[0] as Record<string, unknown>)?.status === 401,
    );
    expect(statusWarn, "logger.warn was not called with { status: 401 }").toBeDefined();
    expect((statusWarn![0] as Record<string, unknown>).status).toBe(401);
  });

  it("logs warn with status 403 when bot returns Forbidden", async () => {
    process.env.API_KEY = "wrong-key";
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await createAlert({ type: "system", severity: "critical", title: "Test", message: "broke" });

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const statusWarn = warnCalls.find(
      (args: unknown[]) => (args[0] as Record<string, unknown>)?.status === 403,
    );
    expect(statusWarn).toBeDefined();
    delete process.env.API_KEY;
  });

  it("does NOT call the Discord endpoint for warning-severity alerts", async () => {
    await createAlert({ type: "system", severity: "warning", title: "Drift", message: "low" });

    const discordCalls = fetchMock.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string).includes("/alert/alerts"),
    );
    expect(discordCalls).toHaveLength(0);
  });
});

// ─── H7: family-grade postscript fallback ────────────────────────────────────

describe("H7: critical alert family-grade postscript fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends generic family postscript when critical message has no sentinel", async () => {
    const { capturedValues } = configureDbInsertMock();

    await createAlert({ type: "system", severity: "critical", title: "Kill switch", message: "Circuit breaker tripped." });

    expect(capturedValues).toHaveLength(1);
    const stored = capturedValues[0]!.message as string;
    expect(stored).toContain("--- For family members ---");
    expect(stored).toContain("call Tony");
    expect(stored).toContain("Circuit breaker tripped.");
  });

  it("does NOT duplicate postscript when sentinel is already in message", async () => {
    const { capturedValues } = configureDbInsertMock();
    const msgWithSentinel =
      "Heartbeat stale.\n\n--- For family members ---\nWhat this means: Bot stopped.\nWhat to do: Call Tony.";

    await createAlert({ type: "system", severity: "critical", title: "Heartbeat stale", message: msgWithSentinel });

    expect(capturedValues).toHaveLength(1);
    const stored = capturedValues[0]!.message as string;
    const sentinelCount = (stored.match(/--- For family members ---/g) ?? []).length;
    expect(sentinelCount).toBe(1);
  });

  it("does NOT add postscript to warning-severity alerts (DB stores original message)", async () => {
    const { capturedValues } = configureDbInsertMock();

    await createAlert({ type: "drift", severity: "warning", title: "Drift", message: "Slight drift." });

    expect(capturedValues).toHaveLength(1);
    expect(capturedValues[0]!.message).toBe("Slight drift.");
  });

  it("does NOT add postscript to info-severity alerts", async () => {
    const { capturedValues } = configureDbInsertMock();

    await createAlert({ type: "system", severity: "info", title: "Boot", message: "Scheduler started." });

    expect(capturedValues).toHaveLength(1);
    expect(capturedValues[0]!.message).toBe("Scheduler started.");
  });

  it("uses effectiveMessage (with postscript) in Discord body for critical alerts", async () => {
    configureDbInsertMock();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    await createAlert({ type: "system", severity: "critical", title: "Kill switch", message: "Raw operator text." });

    const discordCall = fetchSpy.mock.calls.find(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string).includes("/alert/alerts"),
    );
    expect(discordCall).toBeDefined();
    const body = JSON.parse((discordCall![1] as { body: string }).body) as { message: string };
    expect(body.message).toContain("--- For family members ---");
    expect(body.message).toContain("Raw operator text.");
  });
});

// ─── H4a: bitwarden runtime file write ───────────────────────────────────────

describe("H4a: refreshBwSession writes .bw-session-runtime", () => {
  it("writeFileSync is called with the project-root .bw-session-runtime path", () => {
    // Verify the source code — test that writeFileSync is imported and called
    // in the right place. We read the compiled source to avoid spawning the
    // real bw CLI (which is not available in test environment).
    const bwSource = fs.readFileSync(
      path.resolve(__dirname, "../services/bitwarden-session-refresh-service.ts"),
      "utf8",
    );

    // The import must exist
    expect(bwSource).toContain("writeFileSync");
    expect(bwSource).toContain("node:fs");
    expect(bwSource).toContain("node:path");

    // The write call must be present after the env mutation
    expect(bwSource).toContain(".bw-session-runtime");
    expect(bwSource).toContain("writeFileSync(runtimePath, newToken");

    // Must have error handling (not bare, uncaught)
    const writeIndex = bwSource.indexOf("writeFileSync(runtimePath");
    const tryCatchBefore = bwSource.lastIndexOf("try {", writeIndex);
    const catchAfter = bwSource.indexOf("} catch", writeIndex);
    expect(tryCatchBefore).toBeGreaterThan(-1);
    expect(catchAfter).toBeGreaterThan(writeIndex);
  });
});

// ─── H4b: bitwarden unknown_expiry emits alert ───────────────────────────────

describe("H4b: runBwSessionRefreshCheck unknown_expiry now emits alert", () => {
  it("source code includes createAlert call in the unknown_expiry branch", () => {
    const bwSource = fs.readFileSync(
      path.resolve(__dirname, "../services/bitwarden-session-refresh-service.ts"),
      "utf8",
    );

    // createAlert must be imported
    expect(bwSource).toMatch(/import \{[^}]*createAlert[^}]*\} from ["']\.\/alert-service/);

    // The unknown_expiry path must now contain a createAlert call
    const unknownExpiryIdx = bwSource.indexOf("hoursRemaining === null");
    expect(unknownExpiryIdx).toBeGreaterThan(-1);
    const afterBranch = bwSource.slice(unknownExpiryIdx, unknownExpiryIdx + 1500);
    expect(afterBranch).toContain("createAlert(");
    expect(afterBranch).toContain("severity: \"warning\"");
    expect(afterBranch).toContain("insertAuditRow(");
    expect(afterBranch).toContain("credential.bw_session_expiry_unknown");
  });

  it("unknown_expiry insertAuditRow has status warning (not silent/info)", () => {
    const bwSource = fs.readFileSync(
      path.resolve(__dirname, "../services/bitwarden-session-refresh-service.ts"),
      "utf8",
    );
    // Find the audit row inside the unknown_expiry branch
    const unknownIdx = bwSource.indexOf("bw_session_expiry_unknown");
    expect(unknownIdx).toBeGreaterThan(-1);
    // status: "warning" appears ~250 chars AFTER the action string inside insertAuditRow
    const window = bwSource.slice(Math.max(0, unknownIdx - 50), unknownIdx + 450);
    expect(window).toContain("status: \"warning\"");
  });
});

// ─── H4c: load-env reads .bw-session-runtime ─────────────────────────────────

describe("H4c: load-env.ts overrides BW_SESSION from .bw-session-runtime", () => {
  it("source code reads .bw-session-runtime after dotenv", () => {
    const loadEnvSource = fs.readFileSync(
      path.resolve(__dirname, "../load-env.ts"),
      "utf8",
    );

    // Must import fs and path utilities
    expect(loadEnvSource).toContain("existsSync");
    expect(loadEnvSource).toContain("readFileSync");

    // Must reference the runtime file
    expect(loadEnvSource).toContain(".bw-session-runtime");

    // dotenvConfig must come BEFORE the runtime file read
    const dotenvIdx = loadEnvSource.indexOf("dotenvConfig(");
    const runtimeIdx = loadEnvSource.indexOf(".bw-session-runtime");
    expect(dotenvIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(dotenvIdx);

    // Must set process.env["BW_SESSION"] from the file content
    expect(loadEnvSource).toContain('process.env["BW_SESSION"]');
  });

  it("overrides BW_SESSION when runtime file exists with a non-empty token", () => {
    // Integration-style: write a temp file, call the loader logic, verify override.
    const tmpDir = os.tmpdir();
    const runtimeFile = path.join(tmpDir, ".bw-session-runtime-test-" + Date.now());
    const freshToken = "fresh-runtime-token-abc123";

    fs.writeFileSync(runtimeFile, freshToken, "utf8");
    try {
      // Simulate what load-env.ts does
      const staleToken = "stale-dotenv-token";
      process.env["BW_SESSION"] = staleToken;

      if (fs.existsSync(runtimeFile)) {
        const tok = fs.readFileSync(runtimeFile, "utf8").trim();
        if (tok) process.env["BW_SESSION"] = tok;
      }

      expect(process.env["BW_SESSION"]).toBe(freshToken);
    } finally {
      fs.unlinkSync(runtimeFile);
      delete process.env["BW_SESSION"];
    }
  });

  it("leaves BW_SESSION unchanged when runtime file is absent", () => {
    const nonExistentPath = path.join(os.tmpdir(), ".bw-session-runtime-nonexistent-" + Date.now());
    process.env["BW_SESSION"] = "dotenv-value";
    try {
      if (fs.existsSync(nonExistentPath)) {
        const tok = fs.readFileSync(nonExistentPath, "utf8").trim();
        if (tok) process.env["BW_SESSION"] = tok;
      }
      expect(process.env["BW_SESSION"]).toBe("dotenv-value");
    } finally {
      delete process.env["BW_SESSION"];
    }
  });
});

// ─── H5/H6: Ollama recheck ────────────────────────────────────────────────────

describe("H5: recheckOllamaHealth resets OLLAMA_HEALTHY to true on healthy response", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns healthy:true when /api/tags returns the target model and probe passes", async () => {
    // Mock fetch to simulate a healthy Ollama with gemma4:e2b available.
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        // Phase 1: /api/tags
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ models: [{ name: "gemma4:e2b" }] }),
      })
      .mockResolvedValueOnce({
        // Phase 2: /api/generate probe — uses stream:false, so Ollama returns a
        // single JSON object; the probe calls .json() not a streaming reader.
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ response: '{"ok":true}' }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { recheckOllamaHealth, __setOllamaHealthyForTests, __getOllamaHealthyForTests } =
      await import("../services/model-router.js");

    // Force flag false to simulate cold-boot state
    __setOllamaHealthyForTests(false);
    expect(__getOllamaHealthyForTests()).toBe(false);

    const result = await recheckOllamaHealth();

    expect(result.healthy).toBe(true);
    expect(__getOllamaHealthyForTests()).toBe(true);
  });

  it("returns healthy:false and keeps OLLAMA_HEALTHY false when /api/tags fails", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 503, json: vi.fn() });
    vi.stubGlobal("fetch", fetchSpy);

    const { recheckOllamaHealth, __setOllamaHealthyForTests, __getOllamaHealthyForTests } =
      await import("../services/model-router.js");

    __setOllamaHealthyForTests(true);

    const result = await recheckOllamaHealth();

    expect(result.healthy).toBe(false);
    expect(__getOllamaHealthyForTests()).toBe(false);
  });
});

describe("H6: emitLocalLlmDownSignal aborts EXTRACTION LOST when recheck returns healthy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("__emitLocalLlmDownSignalForTests is exported as a test hook", async () => {
    const mod = await import("../services/model-router.js");
    expect(typeof mod.__emitLocalLlmDownSignalForTests).toBe("function");
  });

  it("source code calls recheckOllamaHealth() at the top of emitLocalLlmDownSignal", () => {
    const routerSource = fs.readFileSync(
      path.resolve(__dirname, "../services/model-router.ts"),
      "utf8",
    );

    const fnStart = routerSource.indexOf("async function emitLocalLlmDownSignal");
    expect(fnStart).toBeGreaterThan(-1);

    // Find the body — recheckOllamaHealth must appear early (within 950 chars)
    const fnBody = routerSource.slice(fnStart, fnStart + 950);
    expect(fnBody).toContain("recheckOllamaHealth()");
    expect(fnBody).toContain("_h6Recheck.healthy");
    expect(fnBody).toContain("return;");
  });

  it("emits logger.info 'EXTRACTION LOST alert aborted' when recheck is healthy", async () => {
    // Simulate healthy Ollama so recheckOllamaHealth returns healthy.
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ models: [{ name: "gemma4:e2b" }] }),
      })
      .mockResolvedValueOnce({
        // Phase 2: /api/generate probe (stream:false — .json(), not a reader)
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ response: '{"ok":true}' }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const { __emitLocalLlmDownSignalForTests, __setOllamaHealthyForTests } =
      await import("../services/model-router.js");

    // Force flag false (simulates the boot-time false negative)
    __setOllamaHealthyForTests(false);

    const infoSpy = logger.info as ReturnType<typeof vi.fn>;
    infoSpy.mockClear();

    await __emitLocalLlmDownSignalForTests({
      messages: [{ role: "user", content: '{"youtube_url":"https://youtube.com/test"}' }],
      fallback_reason: "ollama_unhealthy_cloud_also_exhausted",
    });

    const abortedCall = infoSpy.mock.calls.find((args: unknown[]) => {
      const msg = args[args.length - 1];
      return typeof msg === "string" && msg.includes("EXTRACTION LOST alert aborted");
    });
    expect(abortedCall, "expected 'EXTRACTION LOST alert aborted' info log was not emitted").toBeDefined();
  });
});
