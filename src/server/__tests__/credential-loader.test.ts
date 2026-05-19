/**
 * C6 — credential-loader tests
 *
 * Verifies:
 * 1. Env mode: no-op passthrough, health signal correct
 * 2. Bitwarden mode: fail-closed when bw not found
 * 3. Bitwarden mode: fail-closed when BW_SESSION missing
 * 4. Bitwarden mode: fail-closed when vault locked
 * 5. Bitwarden mode: fail-closed when required credential missing
 * 6. Bitwarden mode: credentials written into process.env on success
 * 7. Bitwarden mode: key names logged, not values
 * 8. getVaultHealth() returns correct structure in each state
 * 9. checkBitwarden() throws VaultUnavailableError when bw not installed
 * 10. Security: BW_SESSION never appears in error messages
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock child_process before loading the module ─────────────────────────────
vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>();
  return {
    ...original,
    execFileSync: vi.fn(),
  };
});

// ─── Mock logger to capture structured log calls ──────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { execFileSync } from "child_process";
const execFileSyncMock = vi.mocked(execFileSync);

import {
  loadCredentials,
  getVaultHealth,
  getVaultMode,
  getActiveVaultMode,
  getVaultLoadResult,
  checkBitwarden,
  checkVaultUnlocked,
  VaultUnavailableError,
  _resetForTests,
  _setVaultModeForTests,
} from "../lib/credential-loader.js";

import { logger } from "../lib/logger.js";
const loggerMock = vi.mocked(logger);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_BW_ITEMS = JSON.stringify([
  {
    id: "item-1",
    name: "TradingForge.DATABASE_URL",
    type: 2,
    notes: JSON.stringify({ DATABASE_URL: "postgresql://user:password@host/db" }),
    fields: [
      { name: "DATABASE_URL", value: "postgresql://user:password@host/db" },
      { name: "OPENAI_API_KEY", value: "sk-test-abc123" },
    ],
  },
]);

const BW_STATUS_UNLOCKED = JSON.stringify({ status: "unlocked" });
const BW_STATUS_LOCKED   = JSON.stringify({ status: "locked" });
const BW_VERSION         = "2024.8.0";

/** Set up environment for bitwarden mode */
function setBitwardenEnv(session = "test-session-token") {
  process.env.TF_VAULT_MODE = "bitwarden";
  process.env.BW_SESSION = session;
  delete process.env.TF_VAULT_FOLDER_ID;
}

/** Reset environment to env mode */
function setEnvMode() {
  process.env.TF_VAULT_MODE = "env";
  delete process.env.BW_SESSION;
  delete process.env.TF_VAULT_FOLDER_ID;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("credential-loader", () => {
  beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
    setEnvMode();
  });

  afterEach(() => {
    setEnvMode();
    _resetForTests();
  });

  // ─── 1. Env mode ───────────────────────────────────────────────────────────

  describe("env mode (default)", () => {
    it("returns env mode result without calling execFileSync", async () => {
      const result = await loadCredentials({ exitOnFailure: false });
      expect(result.mode).toBe("env");
      expect(result.loaded).toBe(0);
      expect(result.missing).toEqual([]);
      expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it("getVaultMode() returns env when TF_VAULT_MODE is unset", () => {
      delete process.env.TF_VAULT_MODE;
      expect(getVaultMode()).toBe("env");
    });

    it("getVaultMode() returns env when TF_VAULT_MODE=env", () => {
      process.env.TF_VAULT_MODE = "env";
      expect(getVaultMode()).toBe("env");
    });

    it("getVaultMode() returns env for unrecognized values", () => {
      process.env.TF_VAULT_MODE = "hashicorp";
      expect(getVaultMode()).toBe("env");
    });

    it("getVaultHealth() returns ok status after env mode load", async () => {
      await loadCredentials({ exitOnFailure: false });
      const health = getVaultHealth();
      expect(health.mode).toBe("env");
      expect(health.status).toBe("ok");
    });

    it("getVaultHealth() returns not_loaded before any load call", () => {
      const health = getVaultHealth();
      expect(health.status).toBe("not_loaded");
    });

    it("logs env mode at info level with no secret values", async () => {
      await loadCredentials({ exitOnFailure: false });
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({ vault_mode: "env" }),
        expect.stringContaining("env mode")
      );
    });
  });

  // ─── 2. Bitwarden mode — fail-closed: CLI not found ────────────────────────

  describe("bitwarden mode — fail-closed cases", () => {
    beforeEach(() => {
      setBitwardenEnv();
      process.env.TF_VAULT_MODE = "bitwarden";
    });

    it("throws VaultUnavailableError when bw CLI not found", async () => {
      // execFileSync for bw --version throws ENOENT
      execFileSyncMock.mockImplementation(() => {
        const err = new Error("spawn bw ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      });

      await expect(loadCredentials({ exitOnFailure: false })).rejects.toThrow(VaultUnavailableError);
    });

    it("logs structured error when bw CLI not found", async () => {
      execFileSyncMock.mockImplementation(() => { throw new Error("spawn bw ENOENT"); });

      await loadCredentials({ exitOnFailure: false }).catch(() => undefined);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ vault_mode: "bitwarden" }),
        expect.stringContaining("FAIL-CLOSED")
      );
    });

    it("throws VaultUnavailableError when BW_SESSION is missing", async () => {
      delete process.env.BW_SESSION;

      // bw --version succeeds
      execFileSyncMock.mockReturnValueOnce(Buffer.from(BW_VERSION));

      await expect(loadCredentials({ exitOnFailure: false })).rejects.toThrow(VaultUnavailableError);
    });

    it("logs BW_SESSION_MISSING error without exposing the token", async () => {
      delete process.env.BW_SESSION;
      execFileSyncMock.mockReturnValueOnce(Buffer.from(BW_VERSION));

      await loadCredentials({ exitOnFailure: false }).catch(() => undefined);

      const errorCall = loggerMock.error.mock.calls.find(([obj]) =>
        (obj as Record<string, unknown>)?.error === "BW_SESSION_MISSING"
      );
      expect(errorCall).toBeDefined();
    });

    it("throws VaultUnavailableError when vault is locked", async () => {
      // bw --version ok
      execFileSyncMock.mockReturnValueOnce(Buffer.from(BW_VERSION));
      // bw status → locked
      execFileSyncMock.mockReturnValueOnce(Buffer.from(BW_STATUS_LOCKED));

      await expect(loadCredentials({ exitOnFailure: false })).rejects.toThrow(VaultUnavailableError);
    });

    it("throws VaultUnavailableError when bw list items fails", async () => {
      execFileSyncMock
        .mockReturnValueOnce(Buffer.from(BW_VERSION))     // bw --version
        .mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED)) // bw status
        .mockImplementationOnce(() => { throw new Error("connection refused"); }); // bw list

      await expect(loadCredentials({ exitOnFailure: false })).rejects.toThrow(VaultUnavailableError);
    });

    it("throws VaultUnavailableError when required credential missing from vault", async () => {
      // Return items with NO DATABASE_URL (the only required credential)
      const itemsWithoutDbUrl = JSON.stringify([
        {
          id: "item-1",
          name: "TradingForge.OPENAI_API_KEY",
          type: 2,
          notes: null,
          fields: [{ name: "OPENAI_API_KEY", value: "sk-test" }],
        },
      ]);

      execFileSyncMock
        .mockReturnValueOnce(Buffer.from(BW_VERSION))
        .mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED))
        .mockReturnValueOnce(Buffer.from(itemsWithoutDbUrl));

      // DATABASE_URL must also not be in process.env
      const originalDbUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      try {
        await expect(loadCredentials({ exitOnFailure: false })).rejects.toThrow(VaultUnavailableError);
      } finally {
        if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
      }
    });
  });

  // ─── 3. Bitwarden mode — success path ──────────────────────────────────────

  describe("bitwarden mode — success path", () => {
    beforeEach(() => {
      setBitwardenEnv();
    });

    it("writes vault credentials into process.env", async () => {
      execFileSyncMock
        .mockReturnValueOnce(Buffer.from(BW_VERSION))
        .mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED))
        .mockReturnValueOnce(Buffer.from(VALID_BW_ITEMS));

      // Ensure DATABASE_URL will be populated (it's required)
      const savedDbUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      try {
        const result = await loadCredentials({ exitOnFailure: false });

        expect(result.mode).toBe("bitwarden");
        expect(result.loaded).toBeGreaterThan(0);
        expect(process.env.DATABASE_URL).toBe("postgresql://user:password@host/db");
      } finally {
        if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl;
      }
    });

    it("does not log credential values — only key names", async () => {
      execFileSyncMock
        .mockReturnValueOnce(Buffer.from(BW_VERSION))
        .mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED))
        .mockReturnValueOnce(Buffer.from(VALID_BW_ITEMS));

      const savedDbUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = "postgresql://user:password@host/db"; // satisfy required check

      try {
        await loadCredentials({ exitOnFailure: false });

        // Verify no log call contains the actual secret value
        const allLogCalls = [
          ...loggerMock.info.mock.calls,
          ...loggerMock.warn.mock.calls,
          ...loggerMock.error.mock.calls,
        ].flatMap((args) => args.map((a) => JSON.stringify(a)));

        const hasSecretValue = allLogCalls.some((s) =>
          s.includes("postgresql://user:password") || s.includes("sk-test-abc123")
        );
        expect(hasSecretValue).toBe(false);
      } finally {
        if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl;
      }
    });

    it("getVaultHealth() returns bitwarden_active after successful load", async () => {
      execFileSyncMock
        .mockReturnValueOnce(Buffer.from(BW_VERSION))
        .mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED))
        .mockReturnValueOnce(Buffer.from(VALID_BW_ITEMS));

      process.env.DATABASE_URL = "postgresql://user:password@host/db";

      await loadCredentials({ exitOnFailure: false });

      const health = getVaultHealth();
      expect(health.mode).toBe("bitwarden");
      expect(health.status).toBe("bitwarden_active");
      expect(typeof health.loaded).toBe("number");
    });

    it("getVaultLoadResult() returns the result after load", async () => {
      execFileSyncMock
        .mockReturnValueOnce(Buffer.from(BW_VERSION))
        .mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED))
        .mockReturnValueOnce(Buffer.from(VALID_BW_ITEMS));

      process.env.DATABASE_URL = "postgresql://user:password@host/db";

      await loadCredentials({ exitOnFailure: false });

      const result = getVaultLoadResult();
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("bitwarden");
    });

    it("uses TF_VAULT_FOLDER_ID when set for list items call", async () => {
      process.env.TF_VAULT_FOLDER_ID = "abc-folder-id";
      process.env.DATABASE_URL = "postgresql://user:password@host/db";

      execFileSyncMock
        .mockReturnValueOnce(Buffer.from(BW_VERSION))
        .mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED))
        .mockReturnValueOnce(Buffer.from(VALID_BW_ITEMS));

      await loadCredentials({ exitOnFailure: false });

      // The third execFileSync call (bw list items) should include --folderid
      const listItemsCall = execFileSyncMock.mock.calls[2];
      expect(listItemsCall[1]).toContain("--folderid");
      expect(listItemsCall[1]).toContain("abc-folder-id");
    });
  });

  // ─── 4. Security: BW_SESSION must never appear in error messages ─────────────

  describe("security — BW_SESSION redaction", () => {
    beforeEach(() => {
      setBitwardenEnv("super-secret-session-token-xyz");
    });

    it("does not expose BW_SESSION in error messages when bw list fails", async () => {
      execFileSyncMock
        .mockReturnValueOnce(Buffer.from(BW_VERSION))
        .mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED))
        .mockImplementationOnce(() => {
          // Error message that accidentally contains BW_SESSION value
          throw new Error("bw error BW_SESSION=super-secret-session-token-xyz rest of message");
        });

      let thrownError: unknown;
      try {
        await loadCredentials({ exitOnFailure: false });
      } catch (e) {
        thrownError = e;
      }

      const errorMsg = thrownError instanceof Error ? thrownError.message : String(thrownError);
      expect(errorMsg).not.toContain("super-secret-session-token-xyz");
    });
  });

  // ─── 5. checkBitwarden() unit tests ──────────────────────────────────────────

  describe("checkBitwarden()", () => {
    it("returns version string when bw is installed", () => {
      execFileSyncMock.mockReturnValueOnce(Buffer.from("2024.8.0"));
      const version = checkBitwarden();
      expect(version).toBe("2024.8.0");
    });

    it("throws VaultUnavailableError when bw is not installed", () => {
      execFileSyncMock.mockImplementationOnce(() => { throw new Error("ENOENT"); });
      expect(() => checkBitwarden()).toThrow(VaultUnavailableError);
    });

    it("VaultUnavailableError message contains install instructions", () => {
      execFileSyncMock.mockImplementationOnce(() => { throw new Error("ENOENT"); });
      expect(() => checkBitwarden()).toThrow(expect.objectContaining({
        message: expect.stringContaining("bitwarden.com"),
      }));
    });
  });

  // ─── 6. checkVaultUnlocked() unit tests ──────────────────────────────────────

  describe("checkVaultUnlocked()", () => {
    it("returns true when vault is unlocked", () => {
      execFileSyncMock.mockReturnValueOnce(Buffer.from(BW_STATUS_UNLOCKED));
      expect(checkVaultUnlocked("test-session")).toBe(true);
    });

    it("returns false when vault is locked", () => {
      execFileSyncMock.mockReturnValueOnce(Buffer.from(BW_STATUS_LOCKED));
      expect(checkVaultUnlocked("test-session")).toBe(false);
    });

    it("returns false when bw status throws", () => {
      execFileSyncMock.mockImplementationOnce(() => { throw new Error("timeout"); });
      expect(checkVaultUnlocked("test-session")).toBe(false);
    });

    it("returns false when bw status returns unexpected JSON", () => {
      execFileSyncMock.mockReturnValueOnce(Buffer.from(JSON.stringify({ status: "unauthenticated" })));
      expect(checkVaultUnlocked("test-session")).toBe(false);
    });
  });

  // ─── 7. getVaultMode() ────────────────────────────────────────────────────────

  describe("getVaultMode()", () => {
    it("returns bitwarden when TF_VAULT_MODE=bitwarden", () => {
      process.env.TF_VAULT_MODE = "bitwarden";
      expect(getVaultMode()).toBe("bitwarden");
    });

    it("is case-insensitive for bitwarden", () => {
      process.env.TF_VAULT_MODE = "BITWARDEN";
      expect(getVaultMode()).toBe("bitwarden");
    });

    it("returns env for empty string", () => {
      process.env.TF_VAULT_MODE = "";
      expect(getVaultMode()).toBe("env");
    });
  });

  // ─── 8. _resetForTests() idempotency ─────────────────────────────────────────

  describe("test helpers", () => {
    it("_resetForTests clears cached state", async () => {
      await loadCredentials({ exitOnFailure: false });
      expect(getVaultLoadResult()).not.toBeNull();

      _resetForTests();
      expect(getVaultLoadResult()).toBeNull();
      expect(getActiveVaultMode()).toBe("env");
    });

    it("_setVaultModeForTests sets the internal mode", () => {
      _setVaultModeForTests("bitwarden");
      expect(getActiveVaultMode()).toBe("bitwarden");

      _setVaultModeForTests("env");
      expect(getActiveVaultMode()).toBe("env");
    });
  });
});
