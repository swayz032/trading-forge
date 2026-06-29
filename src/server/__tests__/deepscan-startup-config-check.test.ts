/**
 * deepscan-startup-config-check.test.ts — Deep-Scan H11 + H13 coverage
 *
 * H11: ADMIN_PROMOTE_HMAC_SECRET missing must be surfaced as an ERROR (errors[]),
 *      NOT a warning — without it PATCH /api/strategies/:id/lifecycle returns 401
 *      on every call, so no promotion (and no first paper trade) can ever start.
 *
 * H13: boot-time broker_accounts credential check —
 *      (a) WARN when an allow-listed firm has no enabled broker_accounts row, and
 *      (b) WARN when an enabled row's apiKeyVaultRef points at an undefined env var.
 *      Fail-soft: a DB query error must never crash boot (no warning, no throw).
 *
 * The module dynamically imports db/index + db/schema + drizzle-orm + the
 * notification service, so all four are mocked. logger is mocked (incl. error).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (declared before the dynamic import of the module under test) ─────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn().mockResolvedValue(undefined),
}));

// db/schema — only the two tables referenced by the H13 block are needed.
vi.mock("../db/schema.js", () => ({
  brokerAccounts: { enabled: "enabled_col" },
  instanceConfig: {},
}));

// drizzle-orm eq — neutralized; the mocked db ignores the predicate.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(() => ({})) };
});

// db — chainable query mock driven by module-level fixtures.
let mockEnabledAccounts: Array<Record<string, unknown>> = [];
let mockInstanceConfigRows: Array<Record<string, unknown>> = [];
let mockShouldThrow = false;

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        // brokerAccounts query: .from(brokerAccounts).where(...)
        where: vi.fn(() =>
          mockShouldThrow ? Promise.reject(new Error("db hiccup")) : Promise.resolve(mockEnabledAccounts),
        ),
        // instanceConfig query: .from(instanceConfig).limit(1)
        limit: vi.fn(() =>
          mockShouldThrow ? Promise.reject(new Error("db hiccup")) : Promise.resolve(mockInstanceConfigRows),
        ),
      })),
    })),
  },
}));

// ── Env scaffolding ─────────────────────────────────────────────────────────────
// A fully-valid env so only the variable under test drives the result.
const VALID_ENV: Record<string, string> = {
  ADMIN_RESTART_HMAC_SECRET: "a".repeat(32),
  LIVE_ORDER_HMAC_SECRET: "b".repeat(32),
  LIVE_ORDER_GATEWAY_URL: "https://example.com",
  TRADING_FORGE_PUBLIC_URL: "https://example.com",
  SLUMDAWG_WEBHOOK_SECRET: "c".repeat(32),
  ADMIN_PROMOTE_HMAC_SECRET: "d".repeat(32),
};

function applyEnv(overrides: Record<string, string | undefined>): () => void {
  const keys = [...Object.keys(VALID_ENV), ...Object.keys(overrides)];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  const merged = { ...VALID_ENV, ...overrides };
  for (const key of keys) {
    const val = merged[key];
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  return () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key] as string;
    }
  };
}

describe("checkStartupSecrets — Deep-Scan H11 + H13", () => {
  beforeEach(() => {
    mockEnabledAccounts = [];
    mockInstanceConfigRows = [];
    mockShouldThrow = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── H11 ──────────────────────────────────────────────────────────────────────

  // Deep-scan 2026-06-28: ADMIN_PROMOTE_HMAC_SECRET unset is a WARNING, not an
  // ERROR. The prior premise ("no first paper trade can ever start") was false —
  // reaching PAPER is driven by the autonomous lifecycle cron (promoteStrategy
  // internal), which never touches the HMAC-gated PATCH route. The secret only
  // gates the manual dashboard promote button.
  it("surfaces ADMIN_PROMOTE_HMAC_SECRET unset as a WARNING (manual route only; autonomous promotion unaffected)", async () => {
    const restore = applyEnv({ ADMIN_PROMOTE_HMAC_SECRET: undefined });
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).toContain("ADMIN_PROMOTE_HMAC_SECRET_NOT_SET");
      expect(result.errors).not.toContain("ADMIN_PROMOTE_HMAC_SECRET_NOT_SET");
    } finally {
      restore();
    }
  });

  it("does NOT error when ADMIN_PROMOTE_HMAC_SECRET is set (>=32 chars)", async () => {
    const restore = applyEnv({});
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.errors).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("keeps a too-short ADMIN_PROMOTE_HMAC_SECRET as a WARNING (route still works)", async () => {
    const restore = applyEnv({ ADMIN_PROMOTE_HMAC_SECRET: "short" });
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).toContain("ADMIN_PROMOTE_HMAC_SECRET_TOO_SHORT");
      expect(result.errors).not.toContain("ADMIN_PROMOTE_HMAC_SECRET_NOT_SET");
    } finally {
      restore();
    }
  });

  it("leaves other missing secrets as WARNINGS (not errors)", async () => {
    const restore = applyEnv({ LIVE_ORDER_GATEWAY_URL: undefined });
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).toContain("LIVE_ORDER_GATEWAY_URL_NOT_SET");
      expect(result.errors).toHaveLength(0);
    } finally {
      restore();
    }
  });

  // ── H13 (a): allow-listed firm with no enabled account ─────────────────────────

  it("warns when an allow-listed firm has no enabled broker_accounts row", async () => {
    mockEnabledAccounts = [{ accountId: "x", firmId: "topstep", apiKeyVaultRef: null }];
    mockInstanceConfigRows = [{ enabledFirms: ["topstep", "mffu"] }];
    const restore = applyEnv({});
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).toContain("BROKER_ACCOUNT_MISSING_FOR_ENABLED_FIRM");
    } finally {
      restore();
    }
  });

  it("does NOT warn when every allow-listed firm has an enabled account", async () => {
    mockEnabledAccounts = [
      { accountId: "x", firmId: "topstep", apiKeyVaultRef: null },
      { accountId: "y", firmId: "mffu", apiKeyVaultRef: null },
    ];
    mockInstanceConfigRows = [{ enabledFirms: ["topstep", "mffu"] }];
    const restore = applyEnv({});
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).not.toContain("BROKER_ACCOUNT_MISSING_FOR_ENABLED_FIRM");
    } finally {
      restore();
    }
  });

  // ── H13 (b): enabled row references undefined vault env var ─────────────────────

  it("warns when an enabled account's apiKeyVaultRef env var is undefined", async () => {
    delete process.env.MFFU_API_KEY_REF_TEST;
    mockEnabledAccounts = [{ accountId: "y", firmId: "mffu", apiKeyVaultRef: "MFFU_API_KEY_REF_TEST" }];
    mockInstanceConfigRows = [{ enabledFirms: ["mffu"] }];
    const restore = applyEnv({});
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).toContain("BROKER_ACCOUNT_VAULT_ENV_UNDEFINED");
    } finally {
      restore();
    }
  });

  it("does NOT warn vault-env when the referenced env var is defined", async () => {
    process.env.MFFU_API_KEY_REF_TEST = "some-secret-value";
    mockEnabledAccounts = [{ accountId: "y", firmId: "mffu", apiKeyVaultRef: "MFFU_API_KEY_REF_TEST" }];
    mockInstanceConfigRows = [{ enabledFirms: ["mffu"] }];
    const restore = applyEnv({});
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).not.toContain("BROKER_ACCOUNT_VAULT_ENV_UNDEFINED");
    } finally {
      restore();
      delete process.env.MFFU_API_KEY_REF_TEST;
    }
  });

  // ── H13 fail-soft: a DB error must never crash boot ────────────────────────────

  it("fail-soft: a broker_accounts query error produces no broker warnings and does not throw", async () => {
    mockShouldThrow = true;
    const restore = applyEnv({});
    try {
      const { checkStartupSecrets } = await import("../lib/startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).not.toContain("BROKER_ACCOUNT_MISSING_FOR_ENABLED_FIRM");
      expect(result.warnings).not.toContain("BROKER_ACCOUNT_VAULT_ENV_UNDEFINED");
    } finally {
      restore();
    }
  });
});
