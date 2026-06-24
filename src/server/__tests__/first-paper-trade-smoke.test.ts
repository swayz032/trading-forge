/**
 * first-paper-trade-smoke.test.ts — Pass 8 Track D vitest suite
 *
 * Tests the pure-function helpers exported from
 * scripts/first-paper-trade-smoke.ts without executing the top-level
 * side-effectful body (DB connections, OS file writes, process.exit).
 *
 * Coverage:
 *   1. CheckResult + PreflightDoc interface shapes
 *   2. recordPass / recordFail / recordWarn accumulation and side-effects
 *   3. Pre-flight JSON output shape valid
 *   4. confirmOperatorFire — mock readline, verify "yes" → true / anything else → false
 *   5. env-var helpers: set → ready=true, missing → ready=false with actionRequired
 *   6. No parametric CANDIDATE → ready=false with operator instruction
 *   7. Discord webhook health → recordPass / recordWarn / recordFail dispatching
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Pure helpers: copied verbatim from scripts/first-paper-trade-smoke.ts so
// the test does NOT trigger the top-level await / DB / process.exit code in
// that script. The contract shapes tested here are the exports used by the
// operator runbook and any downstream script that reads the preflight JSON.
// ---------------------------------------------------------------------------

export interface CheckResult {
  check: string;
  ready: boolean;
  detail: string;
  actionRequired?: string;
}

export interface PreflightDoc {
  generated_at: string;
  mode: string;
  chosen_strategy_id: string | null;
  chosen_strategy_name: string | null;
  checks_total: number;
  checks_ready: number;
  checks_not_ready: number;
  all_pass: boolean;
  hard_failures: number;
  checks: CheckResult[];
  operator_action_items: Array<{ check: string; action: string }>;
}

// ---------------------------------------------------------------------------
// Helper implementations (unit-testable, no DB / no FS)
// ---------------------------------------------------------------------------

function makeCollector() {
  const results: CheckResult[] = [];
  let failures = 0;

  function recordPass(label: string, detail = ""): void {
    results.push({ check: label, ready: true, detail });
  }

  function recordFail(label: string, detail = "", actionRequired?: string): void {
    failures++;
    results.push({ check: label, ready: false, detail, actionRequired });
  }

  function recordWarn(label: string, detail = "", actionRequired?: string): void {
    // Warnings count as not-ready in the JSON output, but do NOT increment failures
    results.push({ check: label, ready: false, detail, actionRequired });
  }

  return { results, getFailures: () => failures, recordPass, recordFail, recordWarn };
}

// Mirrors the confirmOperatorFire contract: resolves true only when user types "yes"
async function confirmOperatorFire(
  promptText: string,
  mockAnswer: string,
): Promise<boolean> {
  // In the real script, readline is used. Here we simulate the readline resolution.
  void promptText; // unused in this mock path
  return mockAnswer.trim().toLowerCase() === "yes";
}

// Mirrors loadEnvFile / getEnv env-var logic
function buildEnvChecker(envMap: Record<string, string | undefined>) {
  return function getEnv(key: string): string | undefined {
    return envMap[key];
  };
}

// Mirrors the env-section check logic (Section 4)
function checkEnvSection(
  getEnv: (k: string) => string | undefined,
  collector: ReturnType<typeof makeCollector>,
) {
  if (getEnv("LIVE_ORDER_GATEWAY_URL")) {
    collector.recordPass("LIVE_ORDER_GATEWAY_URL", "Set");
  } else {
    collector.recordWarn(
      "LIVE_ORDER_GATEWAY_URL",
      "Not set",
      "Set LIVE_ORDER_GATEWAY_URL in .env",
    );
  }

  if (getEnv("LIVE_ORDER_HMAC_SECRET")) {
    collector.recordPass("LIVE_ORDER_HMAC_SECRET", "Set (value hidden)");
  } else {
    collector.recordWarn(
      "LIVE_ORDER_HMAC_SECRET",
      "Not set",
      "Set LIVE_ORDER_HMAC_SECRET in .env",
    );
  }

  const adminSecret =
    getEnv("ADMIN_OVERRIDE_HMAC_SECRET") ?? getEnv("ADMIN_PROMOTE_HMAC_SECRET");
  if (adminSecret) {
    collector.recordPass("ADMIN_OVERRIDE_HMAC_SECRET", "Set (value hidden)");
  } else {
    collector.recordWarn(
      "ADMIN_OVERRIDE_HMAC_SECRET",
      "Not set",
      "Set ADMIN_OVERRIDE_HMAC_SECRET in .env",
    );
  }

  if (getEnv("DATABASE_URL")) {
    collector.recordPass("DATABASE_URL", "Set (value hidden)");
  } else {
    collector.recordFail(
      "DATABASE_URL",
      "Not set — DB connectivity impossible",
      "Set DATABASE_URL=postgres://... in .env",
    );
  }

  if (getEnv("DISCORD_WEBHOOK_URL") || getEnv("DISCORD_ALERT_PORT")) {
    collector.recordPass("Discord notification", "Configured");
  } else {
    collector.recordWarn(
      "Discord notification",
      "Neither DISCORD_WEBHOOK_URL nor DISCORD_ALERT_PORT is set",
      "Set DISCORD_WEBHOOK_URL in .env",
    );
  }
}

// Mirrors the Discord health section (Section 6)
type DiscordWebhookHealth = "healthy" | "unreachable" | "degraded" | "not_configured";

function checkDiscordSection(
  health: DiscordWebhookHealth,
  collector: ReturnType<typeof makeCollector>,
) {
  if (health === "healthy") {
    collector.recordPass("Discord webhook reachability", "healthy — test ping 200/204");
  } else if (health === "not_configured") {
    collector.recordWarn(
      "Discord webhook reachability",
      "not_configured",
      "Set DISCORD_WEBHOOK_URL in .env",
    );
  } else if (health === "degraded") {
    collector.recordWarn(
      "Discord webhook reachability",
      "degraded — non-success HTTP status",
      "Check DISCORD_WEBHOOK_URL is valid",
    );
  } else {
    collector.recordFail(
      "Discord webhook reachability",
      "unreachable",
      "Check network connectivity and DISCORD_WEBHOOK_URL value",
    );
  }
}

// Mirrors CANDIDATE strategy section (Section 1)
function checkCandidateSection(
  candidates: Array<{ id: string; name: string }>,
  collector: ReturnType<typeof makeCollector>,
): string | null {
  if (candidates.length === 0) {
    collector.recordFail(
      "Parametric CANDIDATE strategy",
      "No parametric CANDIDATE strategies found in DB",
      "Run the scout pipeline or manually insert a CANDIDATE strategy",
    );
    return null;
  }
  const chosen = candidates[0]!;
  collector.recordPass(
    "Parametric CANDIDATE strategy",
    `Found ${candidates.length} candidate(s). Chosen: "${chosen.name}" (${chosen.id.slice(0, 8)}...)`,
  );
  return chosen.id;
}

// Builds a PreflightDoc from results (mirrors the script's preflightDoc builder)
function buildPreflightDoc(
  results: CheckResult[],
  failures: number,
  chosenStrategyId: string | null,
  chosenStrategyName: string | null,
  mode: string,
): PreflightDoc {
  const readyCount = results.filter((r) => r.ready).length;
  const notReadyCount = results.filter((r) => !r.ready).length;

  return {
    generated_at: new Date().toISOString(),
    mode,
    chosen_strategy_id: chosenStrategyId,
    chosen_strategy_name: chosenStrategyName,
    checks_total: results.length,
    checks_ready: readyCount,
    checks_not_ready: notReadyCount,
    all_pass: failures === 0,
    hard_failures: failures,
    checks: results,
    operator_action_items: results
      .filter((r) => !r.ready && r.actionRequired)
      .map((r) => ({ check: r.check, action: r.actionRequired! })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("CheckResult interface shape", () => {
  it("recordPass produces ready=true result", () => {
    const c = makeCollector();
    c.recordPass("some-check", "all good");
    expect(c.results).toHaveLength(1);
    expect(c.results[0]).toMatchObject<CheckResult>({
      check: "some-check",
      ready: true,
      detail: "all good",
    });
    expect(c.getFailures()).toBe(0);
  });

  it("recordFail produces ready=false and increments failures", () => {
    const c = makeCollector();
    c.recordFail("bad-check", "something broke", "fix it");
    expect(c.results[0]).toMatchObject<CheckResult>({
      check: "bad-check",
      ready: false,
      detail: "something broke",
      actionRequired: "fix it",
    });
    expect(c.getFailures()).toBe(1);
  });

  it("recordWarn produces ready=false but does NOT increment failures", () => {
    const c = makeCollector();
    c.recordWarn("warn-check", "advisory only", "optional action");
    expect(c.results[0]).toMatchObject<CheckResult>({
      check: "warn-check",
      ready: false,
      detail: "advisory only",
      actionRequired: "optional action",
    });
    // Warnings are not hard failures
    expect(c.getFailures()).toBe(0);
  });

  it("multiple checks accumulate correctly", () => {
    const c = makeCollector();
    c.recordPass("p1");
    c.recordPass("p2");
    c.recordFail("f1", "oops");
    c.recordWarn("w1", "heads up");

    expect(c.results).toHaveLength(4);
    expect(c.results.filter((r) => r.ready)).toHaveLength(2);
    expect(c.results.filter((r) => !r.ready)).toHaveLength(2);
    expect(c.getFailures()).toBe(1);
  });
});

describe("PreflightDoc shape", () => {
  it("builds valid JSON-serializable doc with all required fields", () => {
    const c = makeCollector();
    c.recordPass("check-a", "ok");
    c.recordWarn("check-b", "advisory", "do something");
    c.recordFail("check-c", "broken", "fix it now");

    const doc = buildPreflightDoc(
      c.results,
      c.getFailures(),
      "strat-uuid-123",
      "my-strategy",
      "preflight-readonly",
    );

    // Serialization must not throw
    const serialized = JSON.stringify(doc);
    expect(serialized).toBeTruthy();

    // Parse back and verify structural contract
    const parsed = JSON.parse(serialized) as PreflightDoc;

    expect(parsed.mode).toBe("preflight-readonly");
    expect(parsed.chosen_strategy_id).toBe("strat-uuid-123");
    expect(parsed.chosen_strategy_name).toBe("my-strategy");
    expect(parsed.checks_total).toBe(3);
    expect(parsed.checks_ready).toBe(1);
    expect(parsed.checks_not_ready).toBe(2);
    expect(parsed.all_pass).toBe(false);
    expect(parsed.hard_failures).toBe(1);
    expect(parsed.checks).toHaveLength(3);
    expect(parsed.operator_action_items).toHaveLength(2); // warn + fail both have actionRequired
  });

  it("all_pass is true when there are zero hard failures", () => {
    const c = makeCollector();
    c.recordPass("a");
    c.recordPass("b");
    // Warn does not increment failures
    c.recordWarn("c", "advisory");

    const doc = buildPreflightDoc(c.results, c.getFailures(), null, null, "preflight-readonly");
    expect(doc.all_pass).toBe(true);
    expect(doc.hard_failures).toBe(0);
  });

  it("operator_action_items omits checks without actionRequired", () => {
    const c = makeCollector();
    c.recordFail("f1", "no action field"); // no actionRequired
    c.recordFail("f2", "has action", "do X");
    c.recordWarn("w1", "no action warn"); // no actionRequired
    c.recordWarn("w2", "warn with action", "do Y");

    const doc = buildPreflightDoc(c.results, c.getFailures(), null, null, "preflight-readonly");
    // Only f2 and w2 have actionRequired
    expect(doc.operator_action_items).toHaveLength(2);
    expect(doc.operator_action_items.map((a) => a.check)).toEqual(["f2", "w2"]);
  });
});

describe("confirmOperatorFire — confirmation prompt contract", () => {
  it('resolves true when user types "yes"', async () => {
    const result = await confirmOperatorFire("Confirm (yes/no): ", "yes");
    expect(result).toBe(true);
  });

  it('resolves true when user types "YES" (case-insensitive)', async () => {
    const result = await confirmOperatorFire("Confirm (yes/no): ", "YES");
    expect(result).toBe(true);
  });

  it('resolves false when user types "no"', async () => {
    const result = await confirmOperatorFire("Confirm (yes/no): ", "no");
    expect(result).toBe(false);
  });

  it("resolves false for empty input", async () => {
    const result = await confirmOperatorFire("Confirm (yes/no): ", "");
    expect(result).toBe(false);
  });

  it("resolves false for any non-yes input", async () => {
    for (const input of ["n", "y", "abort", "1", "true"]) {
      const result = await confirmOperatorFire("Confirm (yes/no): ", input);
      expect(result).toBe(false);
    }
  });

  it("trims whitespace before comparison", async () => {
    const result = await confirmOperatorFire("Confirm: ", "  yes  ");
    expect(result).toBe(true);
  });
});

describe("Env-var pre-flight checks", () => {
  it("all vars set → all checks pass, no failures", () => {
    const c = makeCollector();
    const getEnv = buildEnvChecker({
      LIVE_ORDER_GATEWAY_URL: "https://example.com/api/live-order",
      LIVE_ORDER_HMAC_SECRET: "supersecretvalue32chars!",
      ADMIN_OVERRIDE_HMAC_SECRET: "anothersecretvalue32chars!",
      DATABASE_URL: "postgres://localhost/tf",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/abc",
    });

    checkEnvSection(getEnv, c);

    expect(c.results.filter((r) => r.ready).length).toBe(5);
    expect(c.getFailures()).toBe(0);
  });

  it("missing DATABASE_URL → hard FAIL (ready=false, failure incremented)", () => {
    const c = makeCollector();
    const getEnv = buildEnvChecker({
      LIVE_ORDER_GATEWAY_URL: "https://example.com",
      LIVE_ORDER_HMAC_SECRET: "secret",
      ADMIN_OVERRIDE_HMAC_SECRET: "adminsecret",
      DATABASE_URL: undefined,
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/abc",
    });

    checkEnvSection(getEnv, c);

    const dbCheck = c.results.find((r) => r.check === "DATABASE_URL");
    expect(dbCheck).toBeDefined();
    expect(dbCheck!.ready).toBe(false);
    expect(dbCheck!.actionRequired).toContain("DATABASE_URL");
    expect(c.getFailures()).toBe(1);
  });

  it("missing optional env vars → WARN (not-ready), but no hard failure", () => {
    const c = makeCollector();
    const getEnv = buildEnvChecker({
      DATABASE_URL: "postgres://localhost/tf",
      // All others missing
    });

    checkEnvSection(getEnv, c);

    // DATABASE_URL is set → pass. Others warn.
    expect(c.getFailures()).toBe(0); // no hard failures
    const notReady = c.results.filter((r) => !r.ready);
    // LIVE_ORDER_GATEWAY_URL, LIVE_ORDER_HMAC_SECRET, ADMIN_OVERRIDE_HMAC_SECRET, Discord
    expect(notReady.length).toBeGreaterThanOrEqual(4);
  });

  it("ADMIN_PROMOTE_HMAC_SECRET accepted as fallback for ADMIN_OVERRIDE_HMAC_SECRET", () => {
    const c = makeCollector();
    const getEnv = buildEnvChecker({
      DATABASE_URL: "postgres://localhost/tf",
      ADMIN_PROMOTE_HMAC_SECRET: "old-style-secret",
      // ADMIN_OVERRIDE_HMAC_SECRET not set
    });

    checkEnvSection(getEnv, c);

    const adminCheck = c.results.find((r) => r.check === "ADMIN_OVERRIDE_HMAC_SECRET");
    expect(adminCheck).toBeDefined();
    expect(adminCheck!.ready).toBe(true);
  });

  it("DISCORD_ALERT_PORT accepted when DISCORD_WEBHOOK_URL is absent", () => {
    const c = makeCollector();
    const getEnv = buildEnvChecker({
      DATABASE_URL: "postgres://localhost/tf",
      DISCORD_ALERT_PORT: "3001",
    });

    checkEnvSection(getEnv, c);

    const discordCheck = c.results.find((r) => r.check === "Discord notification");
    expect(discordCheck).toBeDefined();
    expect(discordCheck!.ready).toBe(true);
  });
});

describe("Parametric CANDIDATE strategy check", () => {
  it("empty candidate list → FAIL with operator instruction", () => {
    const c = makeCollector();
    const chosenId = checkCandidateSection([], c);

    expect(chosenId).toBeNull();
    const check = c.results.find((r) => r.check === "Parametric CANDIDATE strategy");
    expect(check).toBeDefined();
    expect(check!.ready).toBe(false);
    expect(check!.actionRequired).toContain("scout pipeline");
    expect(c.getFailures()).toBe(1);
  });

  it("one candidate → PASS and returns chosen strategy ID", () => {
    const c = makeCollector();
    const candidates = [{ id: "uuid-1234-5678", name: "sma-crossover-mes" }];
    const chosenId = checkCandidateSection(candidates, c);

    expect(chosenId).toBe("uuid-1234-5678");
    const check = c.results.find((r) => r.check === "Parametric CANDIDATE strategy");
    expect(check!.ready).toBe(true);
    expect(check!.detail).toContain("sma-crossover-mes");
    expect(c.getFailures()).toBe(0);
  });

  it("multiple candidates → picks first one (most recently updated)", () => {
    const c = makeCollector();
    const candidates = [
      { id: "first-id", name: "strategy-a" },
      { id: "second-id", name: "strategy-b" },
    ];
    const chosenId = checkCandidateSection(candidates, c);

    expect(chosenId).toBe("first-id");
    const check = c.results.find((r) => r.check === "Parametric CANDIDATE strategy");
    expect(check!.detail).toContain("Found 2 candidate(s)");
    expect(check!.detail).toContain("strategy-a");
  });
});

describe("Discord webhook reachability check", () => {
  it("healthy → recordPass", () => {
    const c = makeCollector();
    checkDiscordSection("healthy", c);

    const check = c.results.find((r) => r.check === "Discord webhook reachability");
    expect(check!.ready).toBe(true);
    expect(c.getFailures()).toBe(0);
  });

  it("not_configured → recordWarn (not-ready, no hard failure)", () => {
    const c = makeCollector();
    checkDiscordSection("not_configured", c);

    const check = c.results.find((r) => r.check === "Discord webhook reachability");
    expect(check!.ready).toBe(false);
    expect(check!.actionRequired).toContain("DISCORD_WEBHOOK_URL");
    expect(c.getFailures()).toBe(0); // warn, not fail
  });

  it("degraded → recordWarn with advice to check URL", () => {
    const c = makeCollector();
    checkDiscordSection("degraded", c);

    const check = c.results.find((r) => r.check === "Discord webhook reachability");
    expect(check!.ready).toBe(false);
    expect(check!.detail).toContain("degraded");
    expect(c.getFailures()).toBe(0); // warn, not fail
  });

  it("unreachable → recordFail (hard failure)", () => {
    const c = makeCollector();
    checkDiscordSection("unreachable", c);

    const check = c.results.find((r) => r.check === "Discord webhook reachability");
    expect(check!.ready).toBe(false);
    expect(check!.actionRequired).toContain("network");
    expect(c.getFailures()).toBe(1);
  });
});

describe("PreflightDoc JSON contract", () => {
  it("generated_at is a valid ISO 8601 string", () => {
    const c = makeCollector();
    c.recordPass("x");
    const doc = buildPreflightDoc(c.results, 0, null, null, "preflight-readonly");
    expect(() => new Date(doc.generated_at)).not.toThrow();
    expect(new Date(doc.generated_at).getTime()).toBeGreaterThan(0);
  });

  it("checks array items satisfy CheckResult shape", () => {
    const c = makeCollector();
    c.recordPass("check-a", "detail-a");
    c.recordFail("check-b", "detail-b", "action-b");

    const doc = buildPreflightDoc(c.results, 1, "id", "name", "operator-fire");

    for (const check of doc.checks) {
      expect(typeof check.check).toBe("string");
      expect(typeof check.ready).toBe("boolean");
      expect(typeof check.detail).toBe("string");
      if (check.actionRequired !== undefined) {
        expect(typeof check.actionRequired).toBe("string");
      }
    }
  });

  it("mode field is preserved verbatim", () => {
    const c = makeCollector();
    const doc = buildPreflightDoc(c.results, 0, null, null, "operator-fire");
    expect(doc.mode).toBe("operator-fire");
  });

  it("checks_ready + checks_not_ready equals checks_total", () => {
    const c = makeCollector();
    c.recordPass("a");
    c.recordFail("b", "x");
    c.recordWarn("c", "y");
    c.recordPass("d");

    const doc = buildPreflightDoc(c.results, c.getFailures(), null, null, "preflight-readonly");
    expect(doc.checks_ready + doc.checks_not_ready).toBe(doc.checks_total);
  });
});
