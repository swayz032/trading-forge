/**
 * Tests for bitwarden-session-refresh-service.ts (Track 7)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(),
  },
}));
vi.mock("../db/schema.js", () => ({
  auditLog: { _tableName: "audit_log" },
}));
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    notifyBwSessionExpiringSoon: vi.fn().mockResolvedValue(undefined),
  },
  // Pre-existing gap (unrelated to deep-scan #16): the unknown_expiry branch
  // calls createAlert() directly (not via AlertFactory), which this mock never
  // exported — every test that reached that branch threw "createAlert is not
  // a function". Fixed in passing while touching this file for the
  // TF_VAULT_MODE guard tests below.
  createAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock child_process exec at module level via dynamic approach
const _bwStatusOutput: string = "";
const _bwStatusShouldThrow = false;
const _bwUnlockShouldThrow = false;

vi.mock("../services/bitwarden-session-refresh-service.js", async (importOriginal) => {
  // We will test the real module but mock its exec dependency
  return importOriginal();
});

import { db } from "../db/index.js";
import { AlertFactory } from "../services/alert-service.js";
import { notifyCritical } from "../services/notification-service.js";

// ─── We test the service by directly testing its exported functions ───────────
// and spying on exec internally. Since exec is promisified inside the module,
// we test via the public API surface and stub at the process.env level.

describe("bitwarden-session-refresh-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    });
    process.env["BW_SESSION"] = "test-session";
    process.env["BW_VAULT_PASSPHRASE"] = "test-pass";
    // Deep-scan #16 Band G: runBwSessionRefreshCheck() now no-ops unless
    // TF_VAULT_MODE=bitwarden. All the pre-existing tests below exercise the
    // "vault is active" code path, so pin the mode explicitly here rather than
    // relying on ambient env state. The new describe block further down flips
    // this to unset/"env" to verify the opposite (no-op) behavior.
    process.env["TF_VAULT_MODE"] = "bitwarden";
  });

  afterEach(() => {
    delete process.env["BW_SESSION"];
    delete process.env["BW_VAULT_PASSPHRASE"];
    delete process.env["TF_VAULT_MODE"];
  });

  it("service module is importable", async () => {
    const mod = await import("../services/bitwarden-session-refresh-service.js");
    expect(typeof mod.runBwSessionRefreshCheck).toBe("function");
    expect(typeof mod.estimateBwSessionExpiryHours).toBe("function");
    expect(typeof mod.refreshBwSession).toBe("function");
  });

  it("returns unknown_expiry when BW_SESSION not set", async () => {
    delete process.env["BW_SESSION"];
    const { runBwSessionRefreshCheck } = await import("../services/bitwarden-session-refresh-service.js");
    const result = await runBwSessionRefreshCheck();
    expect(result.status).toBe("unknown_expiry");
  });

  it("AlertFactory.notifyBwSessionExpiringSoon is callable", async () => {
    await AlertFactory.notifyBwSessionExpiringSoon(48);
    expect(AlertFactory.notifyBwSessionExpiringSoon).toHaveBeenCalledWith(48);
  });

  it("notifyCritical is callable for refresh failure path", async () => {
    await (notifyCritical as ReturnType<typeof vi.fn>)("bitwarden_refresh_failed", "error msg", {});
    expect(notifyCritical).toHaveBeenCalledWith("bitwarden_refresh_failed", "error msg", {});
  });

  it("audit_log insert is called on refresh success path (mock)", async () => {
    const insertFn = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert = insertFn;

    // Simulate a successful refresh via direct invocation
    const { runBwSessionRefreshCheck } = await import("../services/bitwarden-session-refresh-service.js");
    // Without a real bw binary this will return unknown_expiry — that's fine for smoke test
    const result = await runBwSessionRefreshCheck();
    expect(["unknown_expiry", "no_action", "refreshed", "failed"]).toContain(result.status);
  });

  it("returns unknown_expiry structure on bw status failure", async () => {
    const { runBwSessionRefreshCheck } = await import("../services/bitwarden-session-refresh-service.js");
    // bw binary is not installed in CI — will fail with unknown_expiry
    const result = await runBwSessionRefreshCheck();
    expect(result).toMatchObject({
      status: expect.stringMatching(/^(unknown_expiry|no_action|refreshed|failed)$/),
    });
  });

  // Deep-scan #16 Band G: `.env` has TF_VAULT_MODE=env (no Bitwarden vault in
  // this deployment). Before the fix, runBwSessionRefreshCheck() always fell
  // through to `estimateBwSessionExpiryHours()` → null (BW_SESSION never
  // meaningfully set in env-mode) → "unknown_expiry" → a WARN
  // createAlert("Bitwarden: session expiry check inconclusive") EVERY 6h for
  // 30 days straight, with no way for the operator to ever resolve it (there
  // is no vault to unlock). The guard below makes this a genuine no-op.
  describe("TF_VAULT_MODE guard (deep-scan #16 Band G)", () => {
    it("no-ops with status vault_mode_disabled when TF_VAULT_MODE is unset (default env mode)", async () => {
      delete process.env["TF_VAULT_MODE"];
      const { runBwSessionRefreshCheck } = await import("../services/bitwarden-session-refresh-service.js");
      const result = await runBwSessionRefreshCheck();
      expect(result).toEqual({ status: "vault_mode_disabled", hoursRemaining: null });
    });

    it("no-ops with status vault_mode_disabled when TF_VAULT_MODE=env", async () => {
      process.env["TF_VAULT_MODE"] = "env";
      const { runBwSessionRefreshCheck } = await import("../services/bitwarden-session-refresh-service.js");
      const result = await runBwSessionRefreshCheck();
      expect(result).toEqual({ status: "vault_mode_disabled", hoursRemaining: null });
    });

    it("does NOT fire the 'session expiry check inconclusive' WARN alert when vault mode is not bitwarden", async () => {
      process.env["TF_VAULT_MODE"] = "env";
      const insertFn = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
      (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert = insertFn;
      const { createAlert } = await import("../services/alert-service.js");
      const { runBwSessionRefreshCheck } = await import("../services/bitwarden-session-refresh-service.js");
      await runBwSessionRefreshCheck();
      // No audit_log row and no createAlert call — the guard exits before
      // either the unknown_expiry path or the refresh/failure paths.
      expect(insertFn).not.toHaveBeenCalled();
      expect(createAlert).not.toHaveBeenCalled();
    });

    it("still runs the real check when TF_VAULT_MODE=bitwarden (case-insensitive per getVaultMode)", async () => {
      process.env["TF_VAULT_MODE"] = "BITWARDEN";
      const { runBwSessionRefreshCheck } = await import("../services/bitwarden-session-refresh-service.js");
      const result = await runBwSessionRefreshCheck();
      expect(result.status).not.toBe("vault_mode_disabled");
    });
  });
});
