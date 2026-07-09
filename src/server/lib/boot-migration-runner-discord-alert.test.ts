import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// fireDiscordCritical is a pure fetch-only helper, but importing its module
// transitively pulls in db/index.ts (throws without DATABASE_URL) and logger.ts.
// Mock both — this test exercises none of the migration/DB logic.
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Point the critical-alert dedup marker at a throwaway temp file for the whole test file —
// MUST be set before the dynamic import below, since the module reads it once at load time
// into a top-level const. Prevents these tests from ever touching the real bin/ directory.
const _dedupTestPath = path.join(os.tmpdir(), `boot-migration-dedup-test-${crypto.randomUUID()}.json`);
process.env.BOOT_MIGRATION_CRITICAL_ALERT_DEDUP_PATH = _dedupTestPath;

const { fireDiscordCritical } = await import("./boot-migration-runner.js");

// Regression test for the fireDiscordCritical Bearer-header gap found 2026-07-09:
// fetch() only throws on network failure, never on a non-2xx HTTP status, so a
// sidecar 401 (missing Authorization header) used to resolve normally and hit
// `return` before ever reaching the webhook fallback — the alert was silently
// dropped. Fixed to mirror alert-service.ts's C2 pattern (Bearer header + a
// response.ok check that falls through to the webhook on any non-2xx).
//
// Each test below uses a UNIQUE title/message so the 15-min crash-loop dedup
// (added the same incident, see the "crash-loop dedup" describe block) never
// interferes with these — dedup behavior is tested explicitly, separately.
describe("fireDiscordCritical", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DISCORD_ALERT_PORT = "4100";
    try {
      fs.unlinkSync(_dedupTestPath);
    } catch {
      /* fine if it doesn't exist yet */
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv, BOOT_MIGRATION_CRITICAL_ALERT_DEDUP_PATH: _dedupTestPath };
    vi.restoreAllMocks();
  });

  it("sends a Bearer Authorization header when API_KEY is set", async () => {
    process.env.API_KEY = "test-key-123";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    await fireDiscordCritical("t1-bearer-header", "message");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-key-123",
    );
  });

  it("falls through to the webhook when the sidecar returns 401 (not thrown, not swallowed)", async () => {
    delete process.env.API_KEY;
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook";
    const fetchMock = vi
      .fn()
      // primary sidecar call: resolves normally with 401 (no throw)
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      // fallback webhook call
      .mockResolvedValueOnce({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    await fireDiscordCritical("t2-401-fallthrough", "message");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [webhookUrl] = fetchMock.mock.calls[1];
    expect(webhookUrl).toBe("https://discord.example/webhook");
  });

  it("does not call the webhook when the sidecar returns ok", async () => {
    process.env.API_KEY = "test-key-123";
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    await fireDiscordCritical("t3-sidecar-ok", "message");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls through to the webhook on a network-level throw (unchanged behavior)", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    await fireDiscordCritical("t4-network-throw", "message");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws even when both paths fail", async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    globalThis.fetch = fetchMock;

    await expect(fireDiscordCritical("t5-both-fail", "message")).resolves.toBeUndefined();
  });
});

// Regression test for the 2026-07-09 alert-fatigue incident: a boot-migration crash-loop
// (~9000 restart attempts) sent an unbounded stream of identical Discord CRITICALs — one per
// restart, no backoff — because fireDiscordCritical had no rate limiting at all. Fixed by
// generalizing the existing ds21-w2 dup-when 24h-dedup pattern into a 15-min dedup applied to
// EVERY fireDiscordCritical call, keyed on a hash of (title + message).
describe("fireDiscordCritical — crash-loop alert dedup", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DISCORD_ALERT_PORT = "4100";
    process.env.API_KEY = "test-key-123";
    try {
      fs.unlinkSync(_dedupTestPath);
    } catch {
      /* fine if it doesn't exist yet */
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv, BOOT_MIGRATION_CRITICAL_ALERT_DEDUP_PATH: _dedupTestPath };
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("suppresses a second identical (title+message) call within the dedup window — the exact crash-loop shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    await fireDiscordCritical("BOOT BLOCKED — Migration Failed: 0000_previous_nuke", "same error text");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Simulate the crash-loop: NSSM restarts, boot-migration fails again with the IDENTICAL
    // title+message, calls fireDiscordCritical again — this must NOT reach the network.
    await fireDiscordCritical("BOOT BLOCKED — Migration Failed: 0000_previous_nuke", "same error text");
    await fireDiscordCritical("BOOT BLOCKED — Migration Failed: 0000_previous_nuke", "same error text");

    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — the repeats were suppressed
  });

  it("does NOT suppress a genuinely different failure (different message)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    await fireDiscordCritical("BOOT BLOCKED", "failure A");
    await fireDiscordCritical("BOOT BLOCKED", "failure B");

    expect(fetchMock).toHaveBeenCalledTimes(2); // distinct signatures — both fire
  });

  it("fires again once the dedup window has elapsed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    await fireDiscordCritical("recurring failure", "same text");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still within the 15-min window — suppressed.
    vi.advanceTimersByTime(10 * 60 * 1000);
    await fireDiscordCritical("recurring failure", "same text");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the 15-min window — fires again.
    vi.advanceTimersByTime(6 * 60 * 1000);
    await fireDiscordCritical("recurring failure", "same text");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails OPEN (still fires) if the dedup marker file is corrupt — never silently swallows a real CRITICAL", async () => {
    fs.writeFileSync(_dedupTestPath, "{not valid json", "utf8");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    await fireDiscordCritical("some failure", "some message");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
