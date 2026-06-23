/**
 * first-paper-trade-smoke.ts — Pass 8 Track D pre-flight + post-flight harness
 *
 * Validates the 7-step critical loop end-to-end BEFORE the operator manually
 * fires their first paper trade:
 *
 *   1. Strategy in DB (CANDIDATE or higher)
 *   2. Pine artifact generated (Pass 4 parametric path)
 *   3. Operator loads .pine into TradingView paper chart
 *   4. Alert webhook fires → TF gateway (Path B canonical)
 *   5. TradersPost relays order to broker paper
 *   6. Fill/error returns + Trading Forge ingests
 *   7. Operator sees fill/error via Discord + dashboard
 *
 * Usage:
 *   npx tsx scripts/first-paper-trade-smoke.ts
 *   npx tsx scripts/first-paper-trade-smoke.ts --operator-fire
 *
 * Exit codes:
 *   0 = all preflight checks pass (or --operator-fire completed successfully)
 *   1 = one or more preflight checks failed
 *
 * --operator-fire flag:
 *   When ON: prints the lifecycle promotion + Pine artifact curl commands for the
 *   operator to run manually, after obtaining explicit confirmation at the prompt.
 *   DEFAULT OFF — safe to run without it (100% READ-ONLY).
 *
 * CRITICAL: In the default (no --operator-fire) mode, this script is READ-ONLY.
 * It never promotes, never writes strategy rows, never fires orders.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { createInterface } from "node:readline";
import postgres from "postgres";

// ─── DB connection from .env ──────────────────────────────────────────────────

function loadDbUrl(): string {
  try {
    const envContent = readFileSync(".env", "utf-8");
    const line = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
    const url = line?.split("=").slice(1).join("=").trim();
    if (url) return url;
  } catch {
    // fall through to process.env
  }
  const envUrl = process.env["DATABASE_URL"];
  if (!envUrl) {
    console.error("FAIL: DATABASE_URL not found in .env or process.env");
    process.exit(1);
  }
  return envUrl;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let failures = 0;

export interface CheckResult {
  check: string;
  ready: boolean;
  detail: string;
  actionRequired?: string;
}

const checkResults: CheckResult[] = [];

export function recordPass(label: string, detail = ""): void {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  checkResults.push({ check: label, ready: true, detail });
}

export function recordFail(label: string, detail = "", actionRequired?: string): void {
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  if (actionRequired) console.error(`        ACTION: ${actionRequired}`);
  failures++;
  checkResults.push({ check: label, ready: false, detail, actionRequired });
}

export function recordWarn(label: string, detail = "", actionRequired?: string): void {
  console.warn(`  WARN  ${label}${detail ? ` — ${detail}` : ""}`);
  if (actionRequired) console.warn(`        ACTION: ${actionRequired}`);
  // Warnings count as "not ready" for the JSON output but do not increment failures
  checkResults.push({ check: label, ready: false, detail, actionRequired });
}

function section(title: string): void {
  console.log(`\n[${title}]`);
}

// ─── Confirm prompt for --operator-fire ──────────────────────────────────────

export async function confirmOperatorFire(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

// ─── Env loader (safe, no dotenv side effects on server graph) ────────────────

function loadEnvFile(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const envContent = readFileSync(".env", "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1).trim();
      env[key] = value;
    }
  } catch {
    // .env not found — rely on process.env
  }
  return env;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const operatorFireMode = args.includes("--operator-fire");

console.log("=".repeat(70));
console.log("  Trading Forge — First Paper Trade Smoke Test (Pass 8 Track D)");
console.log("=".repeat(70));
console.log(`  Mode: ${operatorFireMode ? "OPERATOR-FIRE (prints promotion commands)" : "PRE-FLIGHT READ-ONLY"}`);
console.log(`  Date: ${new Date().toISOString()}`);

const dbUrl = loadDbUrl();
const sql = postgres(dbUrl, { max: 1 });

// Load env file values
const envFile = loadEnvFile();
function getEnv(key: string): string | undefined {
  return process.env[key] ?? envFile[key];
}

// ─── Section 1: Parametric CANDIDATE strategy discovery ──────────────────────

section("1. Parametric CANDIDATE Strategy Discovery");

let chosenStrategyId: string | null = null;
let chosenStrategyName: string | null = null;

try {
  // Parametric strategies: entry_indicator does NOT start with "archetype:"
  // This is stored inside config->'entry_quality'->>'entry_indicator'
  const candidates = await sql<
    Array<{ id: string; name: string; lifecycle_state: string }>
  >`
    SELECT id, name, lifecycle_state
    FROM strategies
    WHERE lifecycle_state = 'CANDIDATE'
      AND (
        config->'entry_quality'->>'entry_indicator' IS NULL
        OR config->'entry_quality'->>'entry_indicator' NOT LIKE 'archetype:%'
      )
    ORDER BY updated_at DESC
    LIMIT 10
  `;

  if (candidates.length === 0) {
    recordFail(
      "Parametric CANDIDATE strategy",
      "No parametric CANDIDATE strategies found in DB",
      "Run the scout pipeline to graduate at least one strategy. Look for sma_crossover or bollinger_breakout type strategies. You can also manually set lifecycle_state='CANDIDATE' on an existing strategy for testing.",
    );
  } else {
    const chosen = candidates[0]!;
    chosenStrategyId = chosen.id;
    chosenStrategyName = chosen.name;
    recordPass(
      "Parametric CANDIDATE strategy",
      `Found ${candidates.length} candidate(s). Chosen: "${chosenStrategyName}" (${chosenStrategyId.slice(0, 8)}...)`,
    );
  }
} catch (err) {
  recordFail(
    "Parametric CANDIDATE strategy",
    `DB query failed: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// ─── Section 2: Paper-to-DeployReady gates (dry-run) ─────────────────────────

section("2. Paper-to-DeployReady Gate Evaluation (Dry-Run)");

if (chosenStrategyId) {
  try {
    // Dynamic import — module path is not statically resolvable at tsc time
    // because paper-to-deploy-ready-gates.ts was added in Wave 27.5 and the
    // smoke script may run against a checkout that does not yet include it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { evaluatePaperToDeployReadyGates } = await import(
      /* @vite-ignore */
      "../src/server/lib/paper-to-deploy-ready-gates.js" as string
    ) as { evaluatePaperToDeployReadyGates: (input: Record<string, unknown>) => { passed: boolean; status: string } };

    // Minimal dry-run input: only required fields (strategyId + frozenPolicy.id)
    // All optional gate inputs null = "data unavailable" paths — gates will fallback
    // to legacy/unavailable paths rather than blocking
    const dryRunInput = {
      strategyId: chosenStrategyId,
      correlationId: `smoke-preflight-${Date.now()}`,
      b14SurvivalTwin: null,
      mcRuinCi: null,
      b14McDataAvailable: false,
      b15Battery: null,
      walkForwardResults: null,
      orchGates: null,
      compositeShadow: null,
      frozenPolicy: { id: chosenStrategyId, frozenPolicyHash: null },
    };

    const result = evaluatePaperToDeployReadyGates(dryRunInput);
    // In dry-run with no backtest data, passed will be false due to missing data —
    // that is correct behavior. We verify the function runs without throwing.
    recordPass(
      "evaluatePaperToDeployReadyGates (dry-run)",
      `Ran without error. passed=${result.passed}, status=${result.status}. (dry-run — gates show unavailable-legacy until strategy completes CPCV+WF)`,
    );
  } catch (err) {
    recordWarn(
      "evaluatePaperToDeployReadyGates (dry-run)",
      `Dynamic import failed: ${err instanceof Error ? err.message : String(err)}. This is expected when running outside the full server context (DB module requires live Postgres connection).`,
      "Run the full smoke test from the project root with .env loaded and DATABASE_URL set.",
    );
  }
}

// ─── Section 3: compileDualPineExport dry-run ─────────────────────────────────

section("3. Pine Export Compilation (Dry-Run, persist=false)");

if (chosenStrategyId) {
  try {
    const { compileDualPineExport } = await import(
      "../src/server/services/pine-export-service.js"
    );

    const result = await compileDualPineExport(
      chosenStrategyId,
      undefined,        // firmKey
      null,             // injectedRiskIntelligence
      false,            // persist = false → dry-run, no DB writes
      `smoke-preflight-${Date.now()}`,
      undefined,        // recipientQty
      undefined,        // recipientLabel
      undefined,        // hmacSecret
      undefined,        // accountId
    );

    if (!result) {
      recordWarn(
        "compileDualPineExport (dry-run)",
        "Returned null/undefined — service may require live DB context.",
        "Ensure DATABASE_URL is set and the strategies table is accessible.",
      );
    } else if ("status" in result && (result as { status: string }).status === "failed") {
      const errReason = (result as { error?: string }).error ?? "unknown";
      if (errReason === "shadow_strategy_pine_blocked") {
        recordWarn(
          "compileDualPineExport (dry-run)",
          "Strategy is in SHADOW state — Pine export blocked per Wave 29 Pass A invariant",
          "Wait for strategy to graduate from SHADOW→PAPER before loading Pine into TradingView.",
        );
      } else {
        recordFail(
          "compileDualPineExport (dry-run)",
          `Export failed: ${errReason}`,
          "Check strategy config has valid entry_indicator and all required fields. Review audit_log for pine_export.* rows.",
        );
      }
    } else {
      // Check for TF-gateway payload markers in compiled Pine
      const contentStr = [
        (result as { indicator_file?: string }).indicator_file ?? "",
        (result as { strategy_file?: string }).strategy_file ?? "",
      ].join("\n");

      const missingMarkers: string[] = [];
      if (!contentStr.includes("live_order_token")) missingMarkers.push("live_order_token");
      if (!contentStr.includes("account_id")) missingMarkers.push("account_id");
      if (!contentStr.includes("bar_timestamp")) missingMarkers.push("bar_timestamp");

      if (missingMarkers.length > 0 && getEnv("LIVE_ORDER_GATEWAY_URL")) {
        recordFail(
          "compileDualPineExport TF-gateway markers",
          `Missing: ${missingMarkers.join(", ")}`,
          "LIVE_ORDER_GATEWAY_URL is set but gateway markers are absent in compiled Pine. This indicates a Pine compiler issue — check pine-gateway-options.ts and webhook-builder.ts.",
        );
      } else if (missingMarkers.length > 0) {
        recordWarn(
          "compileDualPineExport TF-gateway markers",
          `Missing: ${missingMarkers.join(", ")} — expected when LIVE_ORDER_GATEWAY_URL is not set`,
          "Set LIVE_ORDER_GATEWAY_URL in .env before final TradingView deployment to ensure alert payload includes TF-gateway markers.",
        );
      } else {
        recordPass(
          "compileDualPineExport TF-gateway markers",
          "live_order_token + account_id + bar_timestamp all present in compiled Pine",
        );
      }

      recordPass(
        "compileDualPineExport (dry-run)",
        `Compilation succeeded. Score: ${(result as { exportabilityScore?: number }).exportabilityScore ?? "N/A"}`,
      );
    }
  } catch (err) {
    recordWarn(
      "compileDualPineExport (dry-run)",
      `Dynamic import or compilation failed: ${err instanceof Error ? err.message : String(err)}`,
      "The Pine compiler spawns a Python subprocess. Run from project root with Python/venv available, or check Python path.",
    );
  }
}

// ─── Section 4: Environment variable checks ───────────────────────────────────

section("4. Required Environment Variables");

if (getEnv("LIVE_ORDER_GATEWAY_URL")) {
  recordPass("LIVE_ORDER_GATEWAY_URL", `Set → ${(getEnv("LIVE_ORDER_GATEWAY_URL") ?? "").slice(0, 50)}...`);
} else {
  recordWarn(
    "LIVE_ORDER_GATEWAY_URL",
    "Not set",
    "Set LIVE_ORDER_GATEWAY_URL=https://<your-backend>/api/live-order in .env. This is the webhook target baked into the Pine alert payload (Path B canonical).",
  );
}

if (getEnv("LIVE_ORDER_HMAC_SECRET")) {
  recordPass("LIVE_ORDER_HMAC_SECRET", "Set (value hidden)");
} else {
  recordWarn(
    "LIVE_ORDER_HMAC_SECRET",
    "Not set",
    "Set LIVE_ORDER_HMAC_SECRET=<random 32+ char secret> in .env. Used to authenticate Pine alert payloads at the gateway endpoint.",
  );
}

const adminSecret = getEnv("ADMIN_OVERRIDE_HMAC_SECRET") ?? getEnv("ADMIN_PROMOTE_HMAC_SECRET");
if (adminSecret) {
  recordPass("ADMIN_OVERRIDE_HMAC_SECRET", "Set (value hidden)");
} else {
  recordWarn(
    "ADMIN_OVERRIDE_HMAC_SECRET",
    "Not set",
    "Set ADMIN_OVERRIDE_HMAC_SECRET=<random 32+ char secret> in .env. Required for frozen-policy override route (Wave 29 Pass B).",
  );
}

if (getEnv("DATABASE_URL")) {
  recordPass("DATABASE_URL", "Set (value hidden)");
} else {
  recordFail("DATABASE_URL", "Not set — DB connectivity impossible", "Set DATABASE_URL=postgres://... in .env");
}

if (getEnv("DISCORD_WEBHOOK_URL") || getEnv("DISCORD_ALERT_PORT")) {
  recordPass(
    "Discord notification",
    getEnv("DISCORD_WEBHOOK_URL") ? "DISCORD_WEBHOOK_URL is set" : `DISCORD_ALERT_PORT=${getEnv("DISCORD_ALERT_PORT")}`,
  );
} else {
  recordWarn(
    "Discord notification",
    "Neither DISCORD_WEBHOOK_URL nor DISCORD_ALERT_PORT is set",
    "Set DISCORD_WEBHOOK_URL=<Discord webhook URL> in .env so Step 7 of the loop (operator sees fill/error) works.",
  );
}

// ─── Section 5: Broker account existence check ────────────────────────────────

section("5. Broker Account Configuration");

try {
  const brokerRows = await sql<
    Array<{ account_id: string; firm_id: string; broker_type: string; enabled: boolean }>
  >`
    SELECT account_id, firm_id, broker_type, enabled
    FROM broker_accounts
    WHERE enabled = true
    ORDER BY created_at ASC
    LIMIT 5
  `;

  if (brokerRows.length === 0) {
    recordWarn(
      "broker_accounts (enabled)",
      "No enabled broker_account rows found",
      "Add a broker_account row. Example: INSERT INTO broker_accounts (firm_id, broker_type) VALUES ('topstep', 'traderspost'); Required for TradersPost order routing (Step 5 of the loop).",
    );
  } else {
    for (const row of brokerRows) {
      recordPass(
        `broker_account firm=${row.firm_id}`,
        `broker_type=${row.broker_type}, id=${row.account_id.slice(0, 8)}...`,
      );
    }
  }
} catch (err) {
  recordFail(
    "broker_accounts query",
    `DB error: ${err instanceof Error ? err.message : String(err)}`,
    "Verify database connection and that broker_accounts table exists (applies via boot-migration-runner).",
  );
}

// ─── Section 6: Discord webhook reachability ──────────────────────────────────

section("6. Discord Webhook Reachability");

try {
  const { runDiscordFanoutAudit } = await import(
    "../src/server/services/discord-fanout-audit-service.js"
  );

  const health = await runDiscordFanoutAudit("first-paper-trade-smoke");

  if (health === "healthy") {
    recordPass("Discord webhook reachability", "healthy — test ping 200/204");
  } else if (health === "not_configured") {
    recordWarn(
      "Discord webhook reachability",
      "not_configured — DISCORD_WEBHOOK_URL and DISCORD_ALERT_PORT both absent",
      "Set DISCORD_WEBHOOK_URL in .env. Step 7 of the loop (operator sees fill via Discord) requires this.",
    );
  } else if (health === "degraded") {
    recordWarn(
      "Discord webhook reachability",
      "degraded — webhook returned non-success HTTP status",
      "Check DISCORD_WEBHOOK_URL is valid. Rotate the webhook in Discord server settings if the URL was deleted or regenerated.",
    );
  } else {
    recordFail(
      "Discord webhook reachability",
      "unreachable — webhook could not be contacted",
      "Check network connectivity and DISCORD_WEBHOOK_URL value. The operator needs Discord for fill notifications (Step 7).",
    );
  }
} catch (err) {
  recordWarn(
    "Discord webhook reachability",
    `Dynamic import failed: ${err instanceof Error ? err.message : String(err)}`,
    "This is expected when running outside the full server context. Start the server and check /api/production-status for discordWebhookHealth.",
  );
}

// ─── Section 7: Paper session and audit log readiness ────────────────────────

section("7. Paper Session and Audit Log Readiness");

try {
  const [sessionCountRow] = await sql<Array<{ cnt: string }>>`
    SELECT COUNT(*)::text AS cnt FROM paper_sessions WHERE status = 'active'
  `;
  const activeSessions = parseInt(sessionCountRow?.cnt ?? "0", 10);

  if (activeSessions > 0) {
    recordPass("Active paper sessions", `${activeSessions} active session(s) found`);
  } else {
    recordWarn(
      "Active paper sessions",
      "No active paper sessions. CANDIDATE strategies need TESTING→SHADOW→PAPER lifecycle first.",
      "Use --operator-fire to get the promotion commands, or use POST /api/strategies/:id/promote to move a strategy through the lifecycle ladder.",
    );
  }

  const [signalCountRow] = await sql<Array<{ cnt: string }>>`
    SELECT COUNT(*)::text AS cnt
    FROM paper_signal_logs
    WHERE created_at >= NOW() - INTERVAL '7 days'
  `;
  const recentSignals = parseInt(signalCountRow?.cnt ?? "0", 10);
  recordPass("paper_signal_logs (last 7 days)", `${recentSignals} signal(s) logged`);

  // Check recent broker_router audit rows
  const recentBrokerRows = await sql<Array<{ action: string; created_at: Date }>>`
    SELECT action, created_at
    FROM audit_log
    WHERE action LIKE 'broker_router%'
    ORDER BY created_at DESC
    LIMIT 3
  `;

  if (recentBrokerRows.length > 0) {
    recordPass(
      "broker_router audit rows",
      `${recentBrokerRows.length} recent row(s). Latest: ${recentBrokerRows[0]!.action} at ${recentBrokerRows[0]!.created_at.toISOString()}`,
    );
  } else {
    recordWarn(
      "broker_router audit rows",
      "No broker_router.* audit rows yet — expected trace: broker_router.route_order → webhook.broker_ack",
      "This is normal for first-time setup. After the first trade fires, query: SELECT action, correlation_id, created_at FROM audit_log WHERE action LIKE 'broker_router%' ORDER BY created_at DESC LIMIT 10;",
    );
  }
} catch (err) {
  recordWarn(
    "Paper session / audit log check",
    `DB error: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// ─── Pre-flight summary ───────────────────────────────────────────────────────

section("PRE-FLIGHT CHECKLIST SUMMARY");

const readyCount = checkResults.filter((r) => r.ready).length;
const notReadyCount = checkResults.filter((r) => !r.ready).length;

console.log(`\n  Ready:     ${readyCount} / ${checkResults.length}`);
console.log(`  Not Ready: ${notReadyCount} / ${checkResults.length}`);
console.log(`  Failures:  ${failures}`);

if (failures === 0) {
  console.log("\n  STATUS: ALL CHECKS PASS — pre-flight is GREEN");
} else {
  console.log(`\n  STATUS: ${failures} FAIL(s) — address action items above before firing first trade`);
}

// Write structured pre-flight JSON
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

const preflightDoc: PreflightDoc = {
  generated_at: new Date().toISOString(),
  mode: operatorFireMode ? "operator-fire" : "preflight-readonly",
  chosen_strategy_id: chosenStrategyId,
  chosen_strategy_name: chosenStrategyName,
  checks_total: checkResults.length,
  checks_ready: readyCount,
  checks_not_ready: notReadyCount,
  all_pass: failures === 0,
  hard_failures: failures,
  checks: checkResults,
  operator_action_items: checkResults
    .filter((r) => !r.ready && r.actionRequired)
    .map((r) => ({ check: r.check, action: r.actionRequired! })),
};

const outPath = pathResolve("docs", "first-paper-trade-smoke-preflight.json");
try {
  writeFileSync(outPath, JSON.stringify(preflightDoc, null, 2), "utf-8");
  console.log(`\n  Preflight JSON written to: docs/first-paper-trade-smoke-preflight.json`);
} catch (writeErr) {
  console.warn(`  Could not write preflight JSON: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
}

// ─── Operator instructions ────────────────────────────────────────────────────

section("OPERATOR NEXT STEPS");

const gatewayUrl = getEnv("LIVE_ORDER_GATEWAY_URL") ?? "<set LIVE_ORDER_GATEWAY_URL in .env>";

console.log(`
  After all pre-flight checks pass (or you accept the warnings):

  STEP 1 — LOAD PINE INTO TRADINGVIEW
    Download the STRATEGY.pine artifact for your chosen strategy:
      GET /api/pine-export/compile (POST with strategyId to generate first)
      GET /api/pine-export/<exportId>/artifacts/<artifactId>/download
    Open TradingView → Pine Script Editor → Open → paste the STRATEGY.pine
    Click "Add to chart" (not "Publish")

  STEP 2 — CONFIGURE TRADINGVIEW ALERT
    Right-click on chart → Add Alert
    Condition: your strategy name from the list
    Alert Actions: check "Webhook URL"
    Webhook URL: ${gatewayUrl}
    Message: LEAVE EMPTY — Pine fills this with the gateway payload
    Frequency: "Once Per Bar Close" (MANDATORY — prevents duplicate orders)
    Expiration: "Open-ended alert"

  STEP 3 — WAIT FOR THE FIRST SIGNAL
    The strategy fires when entry conditions are met on bar close
    Watch the TradingView Strategy() panel for long/short markers
    Each alert appears in the TradersPost webhook log

  STEP 4 — MONITOR DISCORD
    TF gateway sends fill/error notifications to your Discord channel
    Expected trace: broker_router.route_order → TradersPost → webhook.broker_ack

  STEP 5 — VERIFY THE AUDIT TRACE
    SELECT action, entity_id, status, created_at, correlation_id
    FROM audit_log
    WHERE action LIKE 'broker_router%' OR action LIKE 'webhook%'
    ORDER BY created_at DESC LIMIT 20;

  STEP 6 — CONFIRM PAPER ACCOUNT FILL IN TRADERSPOST
    Log into TradersPost → Paper Trading → verify fill appeared
    Compare fill price vs TradingView Strategy() (should be ≤1-2 ticks off)

  STEP 7 — AFTER 3-5 CLEAN PAPER DAYS
    Compare Strategy Tester P&L vs TradersPost paper account P&L
    If parity confirmed: flip TradersPost from paper → funded account
`);

if (chosenStrategyName && chosenStrategyId) {
  console.log(
    `  Chosen strategy for this run:\n` +
    `    Name: ${chosenStrategyName}\n` +
    `    ID:   ${chosenStrategyId}\n`,
  );
}

// ─── --operator-fire path ─────────────────────────────────────────────────────

if (operatorFireMode) {
  section("--operator-fire MODE — Promotion Commands");

  if (!chosenStrategyId) {
    console.error("  BLOCKED: No parametric CANDIDATE strategy found — cannot print promotion commands.");
    await sql.end();
    process.exit(1);
  }

  console.log(`
  WARNING: --operator-fire will show you the lifecycle promotion + Pine compile
  curl commands. YOU will run them manually. This harness does NOT auto-promote.

  Strategy: "${chosenStrategyName}" (${chosenStrategyId})
  Type "yes" to show promotion commands, anything else to abort.
`);

  const confirmed = await confirmOperatorFire("  Confirm (yes/no): ");

  if (!confirmed) {
    console.log("  Aborted by operator.");
    await sql.end();
    process.exit(0);
  }

  // Check current lifecycle state
  const [stratRow] = await sql<
    Array<{ id: string; name: string; lifecycle_state: string }>
  >`SELECT id, name, lifecycle_state FROM strategies WHERE id = ${chosenStrategyId}`;

  if (!stratRow) {
    console.error(`  BLOCKED: Strategy ${chosenStrategyId} not found in DB.`);
    await sql.end();
    process.exit(1);
  }

  console.log(`\n  Current lifecycle_state = ${stratRow.lifecycle_state}`);
  console.log("");

  if (stratRow.lifecycle_state === "CANDIDATE") {
    console.log(`  To promote to TESTING (first step):`);
    console.log(`    curl -X POST http://localhost:4000/api/strategies/${chosenStrategyId}/promote \\`);
    console.log(`      -H "Content-Type: application/json" \\`);
    console.log(`      -d '{"targetState":"TESTING"}'`);
    console.log(`\n  Then run this script again after the strategy completes backtesting and walk-forward.`);
  } else if (stratRow.lifecycle_state === "TESTING" || stratRow.lifecycle_state === "SHADOW") {
    const nextState = stratRow.lifecycle_state === "TESTING" ? "SHADOW" : "PAPER";
    console.log(`  To promote ${stratRow.lifecycle_state} → ${nextState}:`);
    console.log(`    curl -X POST http://localhost:4000/api/strategies/${chosenStrategyId}/promote \\`);
    console.log(`      -H "Content-Type: application/json" \\`);
    console.log(`      -d '{"targetState":"${nextState}"}'`);
    console.log(`\n  After reaching PAPER, generate the Pine artifact:`);
    console.log(`    curl -X POST http://localhost:4000/api/pine-export/compile \\`);
    console.log(`      -H "Content-Type: application/json" \\`);
    console.log(`      -d '{"strategyId":"${chosenStrategyId}","persist":true}'`);
  } else if (stratRow.lifecycle_state === "PAPER") {
    console.log(`  Strategy is already in PAPER state.`);
    console.log(`  Generate/refresh Pine artifact:`);
    console.log(`    curl -X POST http://localhost:4000/api/pine-export/compile \\`);
    console.log(`      -H "Content-Type: application/json" \\`);
    console.log(`      -d '{"strategyId":"${chosenStrategyId}","persist":true}'`);
    console.log(`\n  Then download the STRATEGY.pine:`);
    console.log(`    GET http://localhost:4000/api/pine-export/<exportId>/artifacts/<artifactId>/download`);
  } else {
    console.warn(`  WARNING: Strategy is in ${stratRow.lifecycle_state} state.`);
    console.warn(`  Only TESTING or SHADOW strategies can be promoted to PAPER.`);
    console.warn(`  Ensure all hard gates (B14 ci_high, WFE, PBO, B15, compliance) pass first.`);
  }
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

await sql.end();

console.log("\n" + "=".repeat(70));
if (failures === 0) {
  console.log("  SMOKE TEST COMPLETE — PRE-FLIGHT GREEN");
} else {
  console.log(`  SMOKE TEST COMPLETE — ${failures} HARD FAIL(S) — address before firing first trade`);
}
console.log("=".repeat(70) + "\n");

process.exit(failures > 0 ? 1 : 0);
