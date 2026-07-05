/**
 * startup-config-check-deepscan18.test.ts — deepscan18 Fix Wave Track 3 coverage (2026-07-05)
 *
 * Covers the two findings this pass added to startup-config-check.ts:
 *
 *   G-2: boot-launcher AUTO-APPLY — converts the deepscan17 G-1 alert-only
 *        carry-forward into a self-healing path (nssm set + get read-back +
 *        graceful self-restart). The mutating I/O (child_process exec,
 *        DB queries, fetch) is deliberately NOT exercised here — this suite
 *        proves (a) the two pure decision helpers (shouldAutoApplyLauncher,
 *        buildNssmSetCommand/buildNssmGetCommand) are correct in isolation,
 *        and (b) the hard VITEST safety rail actually prevents
 *        attemptBootLauncherAutoApply() from ever taking the mutating path
 *        during a test run — this file itself IS that proof, since this box
 *        has a real nssm.exe and a real tower-boot.mjs on disk at the exact
 *        default paths the module resolves to.
 *
 *   G-3: LIVE_ORDER_GATEWAY_URL localhost/private-range WARN — the pure
 *        isLocalOrPrivateGatewayUrl() detector, plus the checkStartupSecrets
 *        wiring that escalates from info-log to WARN + Discord notify.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const notifyCriticalMock = vi.fn();
const notifyWarningMock = vi.fn();
vi.mock("../../services/notification-service.js", () => ({
  notifyCritical: (...args: unknown[]) => notifyCriticalMock(...args),
  notifyWarning: (...args: unknown[]) => notifyWarningMock(...args),
}));

const VALID_ENV: Record<string, string> = {
  ADMIN_RESTART_HMAC_SECRET: "a".repeat(32),
  LIVE_ORDER_HMAC_SECRET: "b".repeat(32),
  LIVE_ORDER_GATEWAY_URL: "https://tf-relay-production.up.railway.app/api/live-order",
  TRADING_FORGE_PUBLIC_URL: "https://tf-relay-production.up.railway.app",
  SLUMDAWG_WEBHOOK_SECRET: "c".repeat(32),
  ADMIN_PROMOTE_HMAC_SECRET: "d".repeat(32),
};

const ALL_KEYS = [
  ...Object.keys(VALID_ENV),
  "NODE_ENV",
  "TF_LAUNCHED_VIA_BOOT_WRAPPER",
  "BOOT_LAUNCHER_AUTO_APPLY_ENABLED",
  "TF_NSSM_PATH",
  "TF_TOWER_BOOT_LAUNCHER_PATH",
];

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

describe("startup-config-check — deepscan18 G-2 shouldAutoApplyLauncher (pure decision)", () => {
  const BASE_STATE = {
    applicable: true,
    alreadyActive: false,
    autoApplyEnabled: true,
    hasRestartSecret: true,
    hasScmWritePrivilege: true,
    nssmAndLauncherPresent: true,
    attemptsInWindow: 0,
    maxAttemptsPerWindow: 1,
  };

  it("returns true when every gate holds", async () => {
    const { shouldAutoApplyLauncher } = await import("../startup-config-check.js");
    expect(shouldAutoApplyLauncher(BASE_STATE)).toBe(true);
  });

  it("returns false when not applicable (not win32+production)", async () => {
    const { shouldAutoApplyLauncher } = await import("../startup-config-check.js");
    expect(shouldAutoApplyLauncher({ ...BASE_STATE, applicable: false })).toBe(false);
  });

  it("returns false when already active — nothing to do", async () => {
    const { shouldAutoApplyLauncher } = await import("../startup-config-check.js");
    expect(shouldAutoApplyLauncher({ ...BASE_STATE, alreadyActive: true })).toBe(false);
  });

  it("returns false when operator opted out (autoApplyEnabled=false)", async () => {
    const { shouldAutoApplyLauncher } = await import("../startup-config-check.js");
    expect(shouldAutoApplyLauncher({ ...BASE_STATE, autoApplyEnabled: false })).toBe(false);
  });

  it("returns false without ADMIN_RESTART_HMAC_SECRET — no way to authenticate the follow-up restart", async () => {
    const { shouldAutoApplyLauncher } = await import("../startup-config-check.js");
    expect(shouldAutoApplyLauncher({ ...BASE_STATE, hasRestartSecret: false })).toBe(false);
  });

  it("returns false without confirmed SCM write privilege", async () => {
    const { shouldAutoApplyLauncher } = await import("../startup-config-check.js");
    expect(shouldAutoApplyLauncher({ ...BASE_STATE, hasScmWritePrivilege: false })).toBe(false);
  });

  it("returns false when nssm.exe or the launcher file is missing on disk", async () => {
    const { shouldAutoApplyLauncher } = await import("../startup-config-check.js");
    expect(shouldAutoApplyLauncher({ ...BASE_STATE, nssmAndLauncherPresent: false })).toBe(false);
  });

  it("returns false once the per-window attempt cap is reached (anti-restart-loop rail)", async () => {
    const { shouldAutoApplyLauncher } = await import("../startup-config-check.js");
    expect(
      shouldAutoApplyLauncher({ ...BASE_STATE, attemptsInWindow: 1, maxAttemptsPerWindow: 1 }),
    ).toBe(false);
    expect(
      shouldAutoApplyLauncher({ ...BASE_STATE, attemptsInWindow: 5, maxAttemptsPerWindow: 1 }),
    ).toBe(false);
  });
});

describe("startup-config-check — deepscan18 G-2 buildNssmSetCommand / buildNssmGetCommand (pure)", () => {
  it("builds the correct argv for nssm set AppParameters", async () => {
    const { buildNssmSetCommand } = await import("../startup-config-check.js");
    const spec = buildNssmSetCommand("C:\\bin\\nssm.exe", "TradingForgeAPI", "C:\\repo\\scripts\\tower-boot.mjs");
    expect(spec).toEqual({
      cmd: "C:\\bin\\nssm.exe",
      args: ["set", "TradingForgeAPI", "AppParameters", "C:\\repo\\scripts\\tower-boot.mjs"],
    });
  });

  it("builds the correct argv for nssm get AppParameters (read-back verification)", async () => {
    const { buildNssmGetCommand } = await import("../startup-config-check.js");
    const spec = buildNssmGetCommand("C:\\bin\\nssm.exe", "TradingForgeAPI");
    expect(spec).toEqual({ cmd: "C:\\bin\\nssm.exe", args: ["get", "TradingForgeAPI", "AppParameters"] });
  });

  it("never builds a shell string — args stay a discrete argv array (no injection surface)", async () => {
    const { buildNssmSetCommand } = await import("../startup-config-check.js");
    const spec = buildNssmSetCommand("nssm", "svc", "C:\\evil path\\& whoami");
    // The malicious-looking payload is carried as ONE argv element, not concatenated into a shell string.
    expect(spec.args).toEqual(["set", "svc", "AppParameters", "C:\\evil path\\& whoami"]);
    expect(spec.args.length).toBe(4);
  });

  it.each([
    ["nssmPath", () => import("../startup-config-check.js").then((m) => m.buildNssmSetCommand("", "svc", "launcher"))],
    ["serviceName", () => import("../startup-config-check.js").then((m) => m.buildNssmSetCommand("nssm", "  ", "launcher"))],
    ["launcherPath", () => import("../startup-config-check.js").then((m) => m.buildNssmSetCommand("nssm", "svc", ""))],
  ])("buildNssmSetCommand throws on empty/whitespace-only %s", async (_label, run) => {
    await expect(run()).rejects.toThrow();
  });

  it("buildNssmGetCommand throws on empty nssmPath or serviceName", async () => {
    const { buildNssmGetCommand } = await import("../startup-config-check.js");
    expect(() => buildNssmGetCommand("", "svc")).toThrow();
    expect(() => buildNssmGetCommand("nssm", "")).toThrow();
  });
});

describe("startup-config-check — deepscan18 G-2 attemptBootLauncherAutoApply VITEST safety rail", () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) delete process.env[key];
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "ALWAYS returns 'skipped' under vitest, even with every gate otherwise satisfied — proves this test run " +
      "cannot execute a real nssm/DB side effect on this box (which has a real nssm.exe + tower-boot.mjs on disk)",
    withEnv(
      { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
      async () => {
        expect(process.env.VITEST).toBeTruthy();
        const { attemptBootLauncherAutoApply } = await import("../startup-config-check.js");
        const outcome = await attemptBootLauncherAutoApply();
        expect(outcome).toBe("skipped");
        // No mutation, no restart, no notify — the guard returns before any of that.
        expect(notifyCriticalMock).not.toHaveBeenCalled();
      },
    ),
  );

  it(
    "checkStartupSecrets() does not crash and falls back to the original alert path while under vitest",
    withEnv(
      { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("BOOT_LAUNCHER_NOT_ACTIVE");
        expect(result.warnings).not.toContain("BOOT_LAUNCHER_AUTO_APPLIED");
        expect(notifyCriticalMock).toHaveBeenCalledTimes(1);
      },
    ),
  );
});

describe("startup-config-check — deepscan18 G-3 isLocalOrPrivateGatewayUrl (pure)", () => {
  it.each([
    ["http://localhost:4000/api/live-order", true],
    ["http://127.0.0.1:4000/api/live-order", true],
    ["http://0.0.0.0:4000/api/live-order", true],
    ["http://[::1]:4000/api/live-order", true],
    ["http://10.0.0.5:4000/api/live-order", true],
    ["http://172.16.0.1/api/live-order", true],
    ["http://172.31.255.255/api/live-order", true],
    ["http://192.168.1.42/api/live-order", true],
    ["http://mytower.local/api/live-order", true],
    ["http://127.99.1.2/api/live-order", true],
  ])("flags %s as local/private", async (url, expected) => {
    const { isLocalOrPrivateGatewayUrl } = await import("../startup-config-check.js");
    expect(isLocalOrPrivateGatewayUrl(url)).toBe(expected);
  });

  it.each([
    "https://tf-relay-production.up.railway.app/api/live-order",
    "https://8.8.8.8/api/live-order",
    "http://172.32.0.1/api/live-order", // just outside 172.16.0.0/12
    "http://193.168.1.1/api/live-order", // NOT 192.168.x.x
  ])("does NOT flag %s", async (url) => {
    const { isLocalOrPrivateGatewayUrl } = await import("../startup-config-check.js");
    expect(isLocalOrPrivateGatewayUrl(url)).toBe(false);
  });

  it("returns false (not true) for an unparseable URL — this detector's job is only the local/private signal", async () => {
    const { isLocalOrPrivateGatewayUrl } = await import("../startup-config-check.js");
    expect(isLocalOrPrivateGatewayUrl("not-a-url")).toBe(false);
  });
});

describe("startup-config-check — deepscan18 G-3 checkStartupSecrets wiring", () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) delete process.env[key];
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "warns LIVE_ORDER_GATEWAY_URL_IS_LOCAL_OR_PRIVATE + fires notifyWarning when explicit URL is localhost under production",
    withEnv(
      { NODE_ENV: "production", LIVE_ORDER_GATEWAY_URL: "http://localhost:4000/api/live-order" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).toContain("LIVE_ORDER_GATEWAY_URL_IS_LOCAL_OR_PRIVATE");
        expect(notifyWarningMock).toHaveBeenCalled();
        const call = notifyWarningMock.mock.calls.find((c) => String(c[0]).includes("localhost"));
        expect(call).toBeTruthy();
      },
    ),
  );

  it(
    "warns when TRADING_FORGE_PUBLIC_URL derives to a private-range LIVE_ORDER_GATEWAY_URL under production",
    withEnv(
      {
        NODE_ENV: "production",
        LIVE_ORDER_GATEWAY_URL: undefined,
        TRADING_FORGE_PUBLIC_URL: "http://192.168.1.50:4000",
      },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(process.env.LIVE_ORDER_GATEWAY_URL).toBe("http://192.168.1.50:4000/api/live-order");
        expect(result.warnings).toContain("LIVE_ORDER_GATEWAY_URL_IS_LOCAL_OR_PRIVATE");
      },
    ),
  );

  it(
    "does NOT warn when LIVE_ORDER_GATEWAY_URL is a public URL under production",
    withEnv(
      { NODE_ENV: "production", LIVE_ORDER_GATEWAY_URL: "https://tf-relay-production.up.railway.app/api/live-order" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("LIVE_ORDER_GATEWAY_URL_IS_LOCAL_OR_PRIVATE");
        expect(notifyWarningMock).not.toHaveBeenCalled();
      },
    ),
  );

  it(
    "does NOT warn about local/private URL outside NODE_ENV=production (dev boxes always use localhost)",
    withEnv(
      { NODE_ENV: "development", LIVE_ORDER_GATEWAY_URL: "http://localhost:4000/api/live-order" },
      async () => {
        const { checkStartupSecrets } = await import("../startup-config-check.js");
        const result = await checkStartupSecrets();
        expect(result.warnings).not.toContain("LIVE_ORDER_GATEWAY_URL_IS_LOCAL_OR_PRIVATE");
      },
    ),
  );
});

describe("startup-config-check — deepscan18 G-3 runBootConfigReminderCheck wiring", () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) delete process.env[key];
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "re-fires the local/private gateway-URL reminder on each tick while the condition persists",
    withEnv(
      { NODE_ENV: "production", LIVE_ORDER_GATEWAY_URL: "http://10.0.0.9:4000/api/live-order" },
      async () => {
        const { runBootConfigReminderCheck } = await import("../startup-config-check.js");
        await runBootConfigReminderCheck();
        expect(notifyWarningMock).toHaveBeenCalled();
        const firstCallCount = notifyWarningMock.mock.calls.length;
        await runBootConfigReminderCheck();
        expect(notifyWarningMock.mock.calls.length).toBeGreaterThan(firstCallCount);
      },
    ),
  );

  it(
    "does not throw when attemptBootLauncherAutoApply is invoked from the reminder tick (VITEST guard keeps it a no-op)",
    withEnv(
      { NODE_ENV: "production", TF_LAUNCHED_VIA_BOOT_WRAPPER: undefined },
      async () => {
        const { runBootConfigReminderCheck } = await import("../startup-config-check.js");
        await expect(runBootConfigReminderCheck()).resolves.toBeUndefined();
      },
    ),
  );
});
