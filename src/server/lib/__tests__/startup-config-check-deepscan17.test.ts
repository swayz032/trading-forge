/**
 * startup-config-check-deepscan17.test.ts — deepscan17 Fix Wave 1 coverage (2026-07-05)
 *
 * Covers the two findings this fix wave closed in startup-config-check.ts:
 *
 *   G-1: boot-launcher-active self-check — detects whether NSSM is invoking
 *        scripts/tower-boot.mjs (self-healing) vs tsx directly, via the
 *        TF_LAUNCHED_VIA_BOOT_WRAPPER marker tower-boot.mjs sets on its own
 *        process.env before spawning the tsx child. Fires a Discord CRITICAL
 *        when inactive, gated to win32 + NODE_ENV=production so `npm run dev`
 *        and CI never false-positive. Also covers the daily repeat
 *        (runBootConfigReminderCheck / startBootConfigReminderMonitor /
 *        stopBootConfigReminderMonitor) so the alert isn't a single
 *        easily-missed boot-time WARN.
 *
 *   G-3: LIVE_ORDER_GATEWAY_URL auto-derives from TRADING_FORGE_PUBLIC_URL
 *        when unset (closing half the gap with zero operator action), and
 *        LIVE_ORDER_HMAC_SECRET-unset is escalated from a log-only WARN to a
 *        Discord notify (immediate + daily repeat while unset).
 *
 * Each test resets process.env before running via beforeEach. Fake timers are
 * scoped to their own describe block with explicit teardown so they never
 * leak into other tests in this file or other files in the same worker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ── Notification service mock ─────────────────────────────────────────────────
// checkStartupSecrets / runBootConfigReminderCheck dynamically import this.
const notifyCriticalMock = vi.fn();
const notifyWarningMock = vi.fn();
vi.mock("../../services/notification-service.js", () => ({
  notifyCritical: (...args: unknown[]) => notifyCriticalMock(...args),
  notifyWarning: (...args: unknown[]) => notifyWarningMock(...args),
}));

/** Valid env — no findings, no notifications — so only the variable(s) under test drive behavior. */
const VALID_ENV: Record<string, string> = {
  ADMIN_RESTART_HMAC_SECRET: "a".repeat(32),
  LIVE_ORDER_HMAC_SECRET: "b".repeat(32),
  LIVE_ORDER_GATEWAY_URL: "https://tf-relay-production.up.railway.app/api/live-order",
  TRADING_FORGE_PUBLIC_URL: "https://tf-relay-production.up.railway.app",
  SLUMDAWG_WEBHOOK_SECRET: "c".repeat(32),
  ADMIN_PROMOTE_HMAC_SECRET: "d".repeat(32),
};

const ALL_KEYS = [...Object.keys(VALID_ENV), "NODE_ENV", "TF_LAUNCHED_VIA_BOOT_WRAPPER"];

function withEnv(
  overrides: Record<string, string | undefined>,
  test: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of ALL_KEYS) saved[key] = process.env[key];
    const merged = { ...VALID_ENV, ...overrides };
    for (const key of ALL_KEYS) {
      const val = merged[key];
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    try {
      await test();
    } finally {
      for (const key of ALL_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key] as string;
      }
    }
  };
}

/** True platform of this test run — the tower and this dev box are both win32. */
const REAL_PLATFORM = process.platform;

function withPlatform(platform: NodeJS.Platform, test: () => Promise<void>): () => Promise<void> {
  return async () => {
    Object.defineProperty(process, "platform", { value: platform });
    try {
      await test();
    } finally {
      Object.defineProperty(process, "platform", { value: REAL_PLATFORM });
    }
  };
}

describe("startup-config-check — deepscan17 G-1 (boot launcher self-check)", () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) delete process.env[key];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "warns BOOT_LAUNCHER_NOT_ACTIVE + fires notifyCritical when NODE_ENV=production and marker unset (native platform)",
    withPlatform(
      "win32",
      withEnv(
        { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
        async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("BOOT_LAUNCHER_NOT_ACTIVE");
        expect(notifyCriticalMock).toHaveBeenCalledTimes(1);
        expect(notifyCriticalMock.mock.calls[0]?.[0]).toContain("self-healing launcher");
        // Family-grade postscript + operator activation command must both be present.
        const body = notifyCriticalMock.mock.calls[0]?.[1] as string;
        expect(body).toContain("install-tower-launcher.ps1");
        expect(body).toContain("For family members");
        },
      ),
    ),
  );

  it(
    "does NOT warn when NODE_ENV=production and marker IS set",
    withPlatform(
      "win32",
      withEnv(
        { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: "1" },
        async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("BOOT_LAUNCHER_NOT_ACTIVE");
        expect(notifyCriticalMock).not.toHaveBeenCalled();
        },
      ),
    ),
  );

  it(
    "does NOT warn outside NODE_ENV=production even with marker unset (no npm-run-dev false positive)",
    withEnv(
      { NODE_ENV: undefined, TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("BOOT_LAUNCHER_NOT_ACTIVE");
        expect(notifyCriticalMock).not.toHaveBeenCalled();
      },
    ),
  );

  it(
    "does NOT warn on non-Windows even with NODE_ENV=production and marker unset (NSSM is Windows-only)",
    withPlatform(
      "linux",
      withEnv(
        { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
        async () => {
          const { checkStartupSecrets } = await import("../startup-config-check.js");
          const result = await checkStartupSecrets();
          expect(result.warnings).not.toContain("BOOT_LAUNCHER_NOT_ACTIVE");
          expect(notifyCriticalMock).not.toHaveBeenCalled();
        },
      ),
    ),
  );

  it(
    "isBootLauncherCheckApplicable / isBootLauncherActive pure predicates match env",
    withPlatform(
      "win32",
      withEnv(
        { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: "1" },
        async () => {
          const mod = await import("../startup-config-check.js");
          expect(mod.isBootLauncherCheckApplicable()).toBe(true);
          expect(mod.isBootLauncherActive()).toBe(true);
        },
      ),
    ),
  );
});

describe("startup-config-check — deepscan17 G-1 daily reminder (runBootConfigReminderCheck)", () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) delete process.env[key];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "re-fires notifyCritical + notifyWarning on each tick while both gaps persist",
    withPlatform(
      "win32",
      withEnv(
        {
          NODE_ENV: "production",
          TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined,
          LIVE_ORDER_HMAC_SECRET: undefined,
        },
        async () => {
        const { runBootConfigReminderCheck } = await import("../startup-config-check.js");
        await runBootConfigReminderCheck();
        expect(notifyCriticalMock).toHaveBeenCalledTimes(1);
        expect(notifyWarningMock).toHaveBeenCalledTimes(1);
        // A second tick while still broken re-fires — this IS the point of the
        // daily reminder (a single boot-time alert is what deepscan17 rejected).
        await runBootConfigReminderCheck();
        expect(notifyCriticalMock).toHaveBeenCalledTimes(2);
        expect(notifyWarningMock).toHaveBeenCalledTimes(2);
        },
      ),
    ),
  );

  it(
    "fires neither alert once both gaps are fixed",
    withEnv(
      {
        NODE_ENV: "production",
        TF_LAUNCHED_VIA_BOOT_WRAPPER: "1",
        LIVE_ORDER_HMAC_SECRET: "b".repeat(32),
      },
      async () => {
        const { runBootConfigReminderCheck } = await import("../startup-config-check.js");
        await runBootConfigReminderCheck();
        expect(notifyCriticalMock).not.toHaveBeenCalled();
        expect(notifyWarningMock).not.toHaveBeenCalled();
      },
    ),
  );

  it(
    "fail-soft: a thrown notify never propagates out of the reminder tick",
    withPlatform(
      "win32",
      withEnv(
        { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
        async () => {
        notifyCriticalMock.mockImplementationOnce(() => {
          throw new Error("discord webhook down");
        });
        const { runBootConfigReminderCheck } = await import("../startup-config-check.js");
        await expect(runBootConfigReminderCheck()).resolves.toBeUndefined();
        },
      ),
    ),
  );
});

describe("startup-config-check — deepscan17 G-1 reminder scheduler (start/stop)", () => {
  // One day in ms — must match DAILY_REMINDER_INTERVAL_MS in the module under test.
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    for (const key of ALL_KEYS) delete process.env[key];
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    const { stopBootConfigReminderMonitor } = await import("../startup-config-check.js");
    stopBootConfigReminderMonitor();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it(
    "re-fires the boot-launcher alert 24h after start() while the gap persists, and stop() halts further ticks",
    withPlatform(
      "win32",
      withEnv(
        { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
        async () => {
        const { startBootConfigReminderMonitor, stopBootConfigReminderMonitor } = await import(
          "../startup-config-check.js"
        );

        startBootConfigReminderMonitor();
        expect(notifyCriticalMock).not.toHaveBeenCalled(); // no immediate fire at start()

        await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
        expect(notifyCriticalMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
        expect(notifyCriticalMock).toHaveBeenCalledTimes(2);

        stopBootConfigReminderMonitor();
        await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
        expect(notifyCriticalMock).toHaveBeenCalledTimes(2); // no further ticks after stop()
        },
      ),
    ),
  );

  it(
    "start() is idempotent — calling it twice does not double-schedule",
    withPlatform(
      "win32",
      withEnv(
        { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
        async () => {
          const { startBootConfigReminderMonitor } = await import("../startup-config-check.js");
          startBootConfigReminderMonitor();
          startBootConfigReminderMonitor();

          await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
          expect(notifyCriticalMock).toHaveBeenCalledTimes(1); // not 2
        },
      ),
    ),
  );
});

describe("startup-config-check — deepscan17 G-3 (LIVE_ORDER_GATEWAY_URL auto-derivation)", () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) delete process.env[key];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "derives '<TRADING_FORGE_PUBLIC_URL>/api/live-order' when LIVE_ORDER_GATEWAY_URL is unset",
    withEnv(
      { LIVE_ORDER_GATEWAY_URL: undefined, TRADING_FORGE_PUBLIC_URL: "https://tower.example.com" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("LIVE_ORDER_GATEWAY_URL_NOT_SET");
        expect(process.env.LIVE_ORDER_GATEWAY_URL).toBe("https://tower.example.com/api/live-order");
      },
    ),
  );

  it(
    "strips a trailing slash from TRADING_FORGE_PUBLIC_URL before deriving (no double slash)",
    withEnv(
      { LIVE_ORDER_GATEWAY_URL: undefined, TRADING_FORGE_PUBLIC_URL: "https://tower.example.com/" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        await checkStartupSecrets();
        expect(process.env.LIVE_ORDER_GATEWAY_URL).toBe("https://tower.example.com/api/live-order");
      },
    ),
  );

  it(
    "still warns LIVE_ORDER_GATEWAY_URL_NOT_SET when TRADING_FORGE_PUBLIC_URL is ALSO unset",
    withEnv(
      { LIVE_ORDER_GATEWAY_URL: undefined, TRADING_FORGE_PUBLIC_URL: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_GATEWAY_URL_NOT_SET");
        expect(process.env.LIVE_ORDER_GATEWAY_URL).toBeUndefined();
      },
    ),
  );

  it(
    "does NOT overwrite an already-set LIVE_ORDER_GATEWAY_URL",
    withEnv(
      { LIVE_ORDER_GATEWAY_URL: "https://explicit-value.example.com/api/live-order" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        await checkStartupSecrets();
        expect(process.env.LIVE_ORDER_GATEWAY_URL).toBe("https://explicit-value.example.com/api/live-order");
      },
    ),
  );
});

describe("startup-config-check — deepscan17 G-3 (LIVE_ORDER_HMAC_SECRET Discord escalation)", () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) delete process.env[key];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "fires notifyWarning when LIVE_ORDER_HMAC_SECRET is unset (previously log-only)",
    withEnv(
      { LIVE_ORDER_HMAC_SECRET: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_HMAC_SECRET_NOT_SET");
        expect(notifyWarningMock).toHaveBeenCalledTimes(1);
        expect(notifyWarningMock.mock.calls[0]?.[0]).toContain("LIVE_ORDER_HMAC_SECRET");
      },
    ),
  );

  it(
    "does NOT fire notifyWarning when LIVE_ORDER_HMAC_SECRET is valid",
    withEnv(
      { LIVE_ORDER_HMAC_SECRET: "b".repeat(32) },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        await checkStartupSecrets();
        expect(notifyWarningMock).not.toHaveBeenCalled();
      },
    ),
  );
});
