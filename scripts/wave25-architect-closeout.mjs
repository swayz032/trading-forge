// Wave 25 Architect Close-out (2026-05-24)
// Writes a single audit_log row capturing the Wave 25 hardening closeout.
// Pattern mirrors scripts/apply-0132-wave24-pass2.mjs.

import postgres from "postgres";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf-8");
const dbUrlLine = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = dbUrlLine?.split("=").slice(1).join("=").trim();
const sql = postgres(dbUrl, { max: 1 });

const result = {
  items_shipped: {
    count: 6,
    names: [
      "deployed_strategy_signal_starvation_watchdog",
      "webhook_latency_monitor",
      "regime_coverage_monitor",
      "agent_logs_llm_execution_path_pin",
      "broker_error_budget_aggregator",
      "payout_audit_packet_generator",
    ],
  },
  commits: "<<placeholder: parent claude fills after commit>>",
  migrations: ["0133_webhook_latency_audit"],
  routes_added: 3,
  routes_added_list: [
    "/api/deployed-strategy-starvation",
    "/api/webhook-latency",
    "/api/broker-error-budget",
  ],
  crons_added: 4,
  crons_added_list: [
    "deployed-strategy-starvation-check",
    "webhook-latency-check",
    "regime-coverage-check",
    "broker-error-budget-check",
  ],
  audit_actions_added: 6,
  audit_actions_added_list: [
    "signal.starvation_warning",
    "signal.starvation_critical",
    "webhook.broker_ack",
    "webhook.latency_high",
    "portfolio.regime_coverage_gap",
    "broker.error_budget_breach",
  ],
  sse_events_added: 5,
  sse_events_added_list: [
    "alert:signal_starvation_warn",
    "alert:signal_starvation_critical",
    "alert:webhook_latency_high",
    "alert:regime_coverage_gap",
    "alert:broker_error_budget",
  ],
  tests_added: 66,
  tests_added_breakdown: {
    "wave25-starvation-watchdog": 7,
    "wave25-webhook-latency": 13,
    "wave25-regime-coverage": 12,
    "wave25-broker-error-budget": 21,
    "wave25-payout-audit-packet": 13,
  },
  gates: {
    "check:production-isolation": "EXIT 0",
    "check:2026-compliance": "EXIT 0",
    "system-map:check": "EXIT 0 (status ok, zero drift, post sync)",
    "vitest wave25-": "127 tests GREEN across 7 files",
    "tsc --noEmit": "231 baseline errors, 0 new",
  },
  operator_carry_forwards: [
    "webhook.broker_ack instrumentation in tradingview-webhook.ts + broker-router.ts",
    "BrokerErrorBudgetCard wire into Dashboard.tsx Observability row",
    "Payout audit packet real-DB smoke test",
    "Migration 0133 apply (operator decision)",
    "OPTIONAL Wave 26 candidate: parameter jitter battery",
  ],
};

async function main() {
  const inserted = await sql`
    INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority)
    VALUES (
      'wave.25_hardening_closeout',
      'wave',
      NULL,
      ${sql.json({ wave: 25, closeout_date: "2026-05-24" })},
      ${sql.json(result)},
      'success',
      'system'
    )
    RETURNING id, created_at
  `;
  console.log("[1/1] wave.25_hardening_closeout audit row written:", inserted[0]);
  await sql.end();
  console.log("\nWave 25 architect close-out audit row OK");
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
