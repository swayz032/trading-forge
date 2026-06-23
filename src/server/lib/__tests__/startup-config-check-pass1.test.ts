/**
 * startup-config-check-pass1.test.ts — Pass 1 Track C vitest coverage
 *
 * Verifies that checkStartupSecrets() emits the correct warning keys for each
 * failure mode introduced in Pass 1 Track C:
 *   - LIVE_ORDER_HMAC_SECRET  (not set / too short)
 *   - LIVE_ORDER_GATEWAY_URL  (not set)
 *   - TRADING_FORGE_PUBLIC_URL (not set)
 *   - SLUMDAWG_WEBHOOK_SECRET (not set / placeholder / too short)
 *
 * Also verifies that valid values produce no warnings, and that the pre-existing
 * ADMIN_RESTART_HMAC_SECRET checks continue to work correctly.
 *
 * Each test resets process.env before running via beforeEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Logger mock ───────────────────────────────────────────────────────────────
// Must be declared before the dynamic import of the module under test.
vi.mock("../logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ── Notification service mock ─────────────────────────────────────────────────
// checkStartupSecrets does a dynamic import of notification-service.js.
// We stub it to a no-op to prevent any real Discord calls during tests.
vi.mock("../../services/notification-service.js", () => ({
  notifyWarning: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────

/** A set of valid env values that should produce zero warnings. */
const VALID_ENV: Record<string, string> = {
  ADMIN_RESTART_HMAC_SECRET: "a".repeat(32),
  LIVE_ORDER_HMAC_SECRET: "b".repeat(32),
  LIVE_ORDER_GATEWAY_URL: "https://tf-relay-production.up.railway.app",
  TRADING_FORGE_PUBLIC_URL: "https://tf-relay-production.up.railway.app",
  SLUMDAWG_WEBHOOK_SECRET: "c".repeat(32),
};

/** Deploy-time placeholder that must trigger a warning even though it's set. */
const SLUMDAWG_PLACEHOLDER = "slumdawg-rotate-me-after-first-deploy-2026-05-25";

/** Helper: snapshot env, set provided values, and restore after test. */
function withEnv(
  overrides: Record<string, string | undefined>,
  test: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
      saved[key] = process.env[key];
      if (overrides[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = overrides[key] as string;
      }
    }
    try {
      await test();
    } finally {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key] as string;
        }
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("checkStartupSecrets — Pass 1 Track C", () => {
  // Clear relevant env keys before each test to avoid cross-test bleed.
  beforeEach(() => {
    for (const key of Object.keys(VALID_ENV)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path: all valid ────────────────────────────────────────────────

  it(
    "produces no warnings when all required secrets are valid",
    withEnv(VALID_ENV, async () => {
      // Dynamic import so the module picks up the mocked logger.
      const { checkStartupSecrets } = await import("../startup-config-check.js");
      const result = await checkStartupSecrets();
      expect(result.warnings).toHaveLength(0);
    }),
  );

  // ── ADMIN_RESTART_HMAC_SECRET (existing checks) ──────────────────────────

  it(
    "warns ADMIN_RESTART_HMAC_SECRET_NOT_SET when unset",
    withEnv(
      { ...VALID_ENV, ADMIN_RESTART_HMAC_SECRET: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("ADMIN_RESTART_HMAC_SECRET_NOT_SET");
      },
    ),
  );

  it(
    "warns ADMIN_RESTART_HMAC_SECRET_TOO_SHORT when < 32 chars",
    withEnv(
      { ...VALID_ENV, ADMIN_RESTART_HMAC_SECRET: "tooshort" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("ADMIN_RESTART_HMAC_SECRET_TOO_SHORT");
      },
    ),
  );

  // ── LIVE_ORDER_HMAC_SECRET ───────────────────────────────────────────────

  it(
    "warns LIVE_ORDER_HMAC_SECRET_NOT_SET when unset",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_HMAC_SECRET: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_HMAC_SECRET_NOT_SET");
      },
    ),
  );

  it(
    "warns LIVE_ORDER_HMAC_SECRET_NOT_SET when empty string",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_HMAC_SECRET: "" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_HMAC_SECRET_NOT_SET");
      },
    ),
  );

  it(
    "warns LIVE_ORDER_HMAC_SECRET_TOO_SHORT when < 32 chars",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_HMAC_SECRET: "short" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_HMAC_SECRET_TOO_SHORT");
      },
    ),
  );

  it(
    "does NOT warn LIVE_ORDER_HMAC_SECRET when exactly 32 chars",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_HMAC_SECRET: "x".repeat(32) },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("LIVE_ORDER_HMAC_SECRET_NOT_SET");
        expect(result.warnings).not.toContain("LIVE_ORDER_HMAC_SECRET_TOO_SHORT");
      },
    ),
  );

  // ── LIVE_ORDER_GATEWAY_URL ───────────────────────────────────────────────

  it(
    "warns LIVE_ORDER_GATEWAY_URL_NOT_SET when unset",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_GATEWAY_URL: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_GATEWAY_URL_NOT_SET");
      },
    ),
  );

  it(
    "warns LIVE_ORDER_GATEWAY_URL_NOT_SET when empty string",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_GATEWAY_URL: "" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_GATEWAY_URL_NOT_SET");
      },
    ),
  );

  it(
    "does NOT warn LIVE_ORDER_GATEWAY_URL when set to any non-empty string",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_GATEWAY_URL: "https://example.com" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("LIVE_ORDER_GATEWAY_URL_NOT_SET");
      },
    ),
  );

  // ── TRADING_FORGE_PUBLIC_URL ─────────────────────────────────────────────

  it(
    "warns TRADING_FORGE_PUBLIC_URL_NOT_SET when unset",
    withEnv(
      { ...VALID_ENV, TRADING_FORGE_PUBLIC_URL: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("TRADING_FORGE_PUBLIC_URL_NOT_SET");
      },
    ),
  );

  it(
    "warns TRADING_FORGE_PUBLIC_URL_NOT_SET when empty string",
    withEnv(
      { ...VALID_ENV, TRADING_FORGE_PUBLIC_URL: "" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("TRADING_FORGE_PUBLIC_URL_NOT_SET");
      },
    ),
  );

  it(
    "does NOT warn TRADING_FORGE_PUBLIC_URL when set",
    withEnv(
      { ...VALID_ENV, TRADING_FORGE_PUBLIC_URL: "https://example.com" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("TRADING_FORGE_PUBLIC_URL_NOT_SET");
      },
    ),
  );

  // ── SLUMDAWG_WEBHOOK_SECRET ──────────────────────────────────────────────

  it(
    "warns SLUMDAWG_WEBHOOK_SECRET_NOT_SET when unset",
    withEnv(
      { ...VALID_ENV, SLUMDAWG_WEBHOOK_SECRET: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("SLUMDAWG_WEBHOOK_SECRET_NOT_SET");
      },
    ),
  );

  it(
    "warns SLUMDAWG_WEBHOOK_SECRET_NOT_SET when empty string",
    withEnv(
      { ...VALID_ENV, SLUMDAWG_WEBHOOK_SECRET: "" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("SLUMDAWG_WEBHOOK_SECRET_NOT_SET");
      },
    ),
  );

  it(
    "warns SLUMDAWG_WEBHOOK_SECRET_IS_PLACEHOLDER when set to deploy-time placeholder",
    withEnv(
      { ...VALID_ENV, SLUMDAWG_WEBHOOK_SECRET: SLUMDAWG_PLACEHOLDER },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("SLUMDAWG_WEBHOOK_SECRET_IS_PLACEHOLDER");
        // Must NOT also fire the NOT_SET warning for the same variable
        expect(result.warnings).not.toContain("SLUMDAWG_WEBHOOK_SECRET_NOT_SET");
      },
    ),
  );

  it(
    "warns SLUMDAWG_WEBHOOK_SECRET_TOO_SHORT when < 32 chars (non-placeholder)",
    withEnv(
      { ...VALID_ENV, SLUMDAWG_WEBHOOK_SECRET: "tooshort" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("SLUMDAWG_WEBHOOK_SECRET_TOO_SHORT");
        expect(result.warnings).not.toContain("SLUMDAWG_WEBHOOK_SECRET_NOT_SET");
        expect(result.warnings).not.toContain("SLUMDAWG_WEBHOOK_SECRET_IS_PLACEHOLDER");
      },
    ),
  );

  it(
    "does NOT warn SLUMDAWG_WEBHOOK_SECRET when valid (>=32 chars, not placeholder)",
    withEnv(
      { ...VALID_ENV, SLUMDAWG_WEBHOOK_SECRET: "d".repeat(32) },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("SLUMDAWG_WEBHOOK_SECRET_NOT_SET");
        expect(result.warnings).not.toContain("SLUMDAWG_WEBHOOK_SECRET_IS_PLACEHOLDER");
        expect(result.warnings).not.toContain("SLUMDAWG_WEBHOOK_SECRET_TOO_SHORT");
      },
    ),
  );

  // ── Multiple simultaneous failures ───────────────────────────────────────

  it(
    "accumulates multiple warnings when several secrets are bad simultaneously",
    withEnv(
      {
        ADMIN_RESTART_HMAC_SECRET: undefined,
        LIVE_ORDER_HMAC_SECRET: undefined,
        LIVE_ORDER_GATEWAY_URL: undefined,
        TRADING_FORGE_PUBLIC_URL: undefined,
        SLUMDAWG_WEBHOOK_SECRET: undefined,
      },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("ADMIN_RESTART_HMAC_SECRET_NOT_SET");
        expect(result.warnings).toContain("LIVE_ORDER_HMAC_SECRET_NOT_SET");
        expect(result.warnings).toContain("LIVE_ORDER_GATEWAY_URL_NOT_SET");
        expect(result.warnings).toContain("TRADING_FORGE_PUBLIC_URL_NOT_SET");
        expect(result.warnings).toContain("SLUMDAWG_WEBHOOK_SECRET_NOT_SET");
        expect(result.warnings.length).toBeGreaterThanOrEqual(5);
      },
    ),
  );

  // ── Exact 32-char boundary (edge case) ──────────────────────────────────

  it(
    "does NOT warn for LIVE_ORDER_HMAC_SECRET at exactly 32 chars (boundary)",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_HMAC_SECRET: "z".repeat(32) },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings.some((w) => w.startsWith("LIVE_ORDER_HMAC_SECRET"))).toBe(false);
      },
    ),
  );

  it(
    "warns LIVE_ORDER_HMAC_SECRET_TOO_SHORT at exactly 31 chars (boundary below)",
    withEnv(
      { ...VALID_ENV, LIVE_ORDER_HMAC_SECRET: "z".repeat(31) },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_HMAC_SECRET_TOO_SHORT");
      },
    ),
  );
});
