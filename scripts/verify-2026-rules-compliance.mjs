#!/usr/bin/env node
/**
 * CI lint for the canonical stage-aware firm rule book.
 *
 * Python and TypeScript load src/shared/firm-stage-rules.json directly, so this
 * gate verifies that the human-audited Topstep and MFFU documents match that
 * one source rather than trying to parse legacy projections in two languages.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RULE_BOOK = path.join(ROOT, "src", "shared", "firm-stage-rules.json");
const MFFU_DOC = path.join(ROOT, "docs", "prop-firm-rules-2026-mffu.md");
const TOPSTEP_DOC = path.join(ROOT, "docs", "prop-firm-rules-2026-topstep.md");
const STALENESS_WARN_DAYS = 30;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) failInput(`MISSING required input: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    failInput(`MALFORMED JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readCanonicalYaml(docPath) {
  if (!fs.existsSync(docPath)) failInput(`MISSING canonical doc: ${docPath}`);
  const markdown = fs.readFileSync(docPath, "utf8");
  const headerIndex = markdown.indexOf("## Canonical Values");
  if (headerIndex === -1) failInput(`MISSING \"## Canonical Values\" in ${docPath}`);
  const fence = markdown.slice(headerIndex).match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!fence) failInput(`MISSING canonical YAML block in ${docPath}`);

  const values = {};
  for (const rawLine of fence[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-z0-9_]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2].trim().replace(/\s+#.*$/, "").trim();
    if (rawValue === "null") values[key] = null;
    else if (rawValue === "true" || rawValue === "false") values[key] = rawValue === "true";
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) values[key] = Number(rawValue);
    else values[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return values;
}

function failInput(message) {
  console.error(`verify-2026-rules-compliance: ${message}`);
  process.exit(2);
}

function readPath(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (current === null || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function equivalent(left, right) {
  if (left === right) return true;
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 1e-9;
  return false;
}

function warnIfStale(docPath) {
  const markdown = fs.readFileSync(docPath, "utf8");
  const match = markdown.match(/>\s*Last reviewed:\s*(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    console.warn(`WARN verify-2026-rules-compliance: no Last reviewed date in ${path.basename(docPath)}`);
    return;
  }
  const ageDays = Math.floor((Date.now() - new Date(match[1]).getTime()) / 86_400_000);
  if (ageDays > STALENESS_WARN_DAYS) {
    console.warn(
      `WARN verify-2026-rules-compliance: ${path.basename(docPath)} is ${ageDays} days old; re-verify before promotion.`,
    );
  }
}

const TOPSTEP_FIELDS = {
  firm_id: ["firm_id"],
  evaluation_account_size: ["evaluation", "account_size"],
  evaluation_monthly_fee: ["evaluation", "monthly_fee"],
  evaluation_activation_fee: ["evaluation", "activation_fee"],
  evaluation_profit_target: ["evaluation", "profit_target"],
  evaluation_max_drawdown: ["evaluation", "max_drawdown"],
  evaluation_trailing: ["evaluation", "trailing"],
  evaluation_locks_at_start: ["evaluation", "locks_at_start"],
  evaluation_trailing_lock_floor_offset: ["evaluation", "trailing_lock_floor_offset"],
  evaluation_daily_loss_limit: ["evaluation", "daily_loss_limit"],
  evaluation_max_contracts: ["evaluation", "max_contracts"],
  evaluation_min_trading_days: ["evaluation", "min_trading_days"],
  evaluation_consistency_mode: ["evaluation", "consistency", "mode"],
  evaluation_consistency_ratio: ["evaluation", "consistency", "ratio"],
  evaluation_best_day_persists_after_loss: ["evaluation", "consistency", "best_day_persists_after_loss"],
  funded_account_type: ["funded", "account_type"],
  funded_starting_balance: ["funded", "starting_balance"],
  funded_max_drawdown: ["funded", "max_drawdown"],
  funded_trailing: ["funded", "trailing"],
  funded_locks_at_start: ["funded", "locks_at_start"],
  funded_trailing_lock_floor_offset: ["funded", "trailing_lock_floor_offset"],
  funded_daily_loss_limit: ["funded", "daily_loss_limit"],
  funded_daily_loss_behavior: ["funded", "daily_loss_behavior"],
  funded_max_contracts: ["funded", "max_contracts"],
  funded_overnight_ok: ["funded", "overnight_ok"],
  funded_weekend_ok: ["funded", "weekend_ok"],
  payout_split: ["payout", "payout_split"],
  payout_minimum_request: ["payout", "minimum_request"],
  payout_account_balance_fraction: ["payout", "account_balance_fraction"],
  standard_minimum_winning_days: ["payout", "paths", "standard", "minimum_winning_days"],
  standard_minimum_winning_day_profit: ["payout", "paths", "standard", "minimum_winning_day_profit"],
  standard_positive_net_profit_since_last_payout_required: ["payout", "paths", "standard", "positive_net_profit_since_last_payout_required"],
  standard_first_payout_exempt: ["payout", "paths", "standard", "first_payout_exempt"],
  standard_payout_cap_base: ["payout", "paths", "standard", "payout_cap", "base"],
  standard_payout_cap_with_dll: ["payout", "paths", "standard", "payout_cap", "with_dll"],
  consistency_minimum_trading_days: ["payout", "paths", "consistency", "minimum_trading_days"],
  consistency_minimum_trades_per_day: ["payout", "paths", "consistency", "minimum_trades_per_day"],
  consistency_maximum_ratio: ["payout", "paths", "consistency", "maximum_consistency_ratio"],
  consistency_resets_after_payout: ["payout", "paths", "consistency", "resets_after_payout"],
  consistency_payout_cap_base: ["payout", "paths", "consistency", "payout_cap", "base"],
  consistency_payout_cap_with_dll: ["payout", "paths", "consistency", "payout_cap", "with_dll"],
  live_payout_cap: ["live", "payout_cap"],
  commission_per_side: ["execution", "commission_per_side"],
  platform_lockdown_date: ["execution", "platform_lockdown_date"],
  required_platform: ["execution", "required_platform"],
  allows_vps: ["execution", "allows_vps"],
  allows_vpn: ["execution", "allows_vpn"],
  allows_remote_desktop: ["execution", "allows_remote_desktop"],
  multi_account_within_user_allowed: ["execution", "multi_account_within_user_allowed"],
  copy_trades_within_user_allowed: ["execution", "copy_trades_within_user_allowed"],
};

const MFFU_FIELDS = {
  firm_id: ["firm_id"],
  evaluation_account_size: ["evaluation", "account_size"],
  evaluation_monthly_fee: ["evaluation", "monthly_fee"],
  evaluation_activation_fee: ["evaluation", "activation_fee"],
  evaluation_profit_target: ["evaluation", "profit_target"],
  evaluation_max_drawdown: ["evaluation", "max_drawdown"],
  evaluation_trailing: ["evaluation", "trailing"],
  evaluation_locks_at_start: ["evaluation", "locks_at_start"],
  evaluation_trailing_lock_floor_offset: ["evaluation", "trailing_lock_floor_offset"],
  evaluation_starting_floor: ["evaluation", "starting_floor"],
  evaluation_daily_loss_limit: ["evaluation", "daily_loss_limit"],
  evaluation_daily_loss_behavior: ["evaluation", "daily_loss_behavior"],
  evaluation_max_contracts: ["evaluation", "max_contracts"],
  evaluation_min_trading_days: ["evaluation", "min_trading_days"],
  funded_account_type: ["funded", "account_type"],
  funded_starting_balance: ["funded", "starting_balance"],
  funded_max_drawdown: ["funded", "max_drawdown"],
  funded_trailing: ["funded", "trailing"],
  funded_locks_at_start: ["funded", "locks_at_start"],
  funded_trailing_lock_floor_offset: ["funded", "trailing_lock_floor_offset"],
  funded_daily_loss_limit: ["funded", "daily_loss_limit"],
  funded_daily_loss_behavior: ["funded", "daily_loss_behavior"],
  funded_max_contracts: ["funded", "max_contracts"],
  funded_overnight_ok: ["funded", "overnight_ok"],
  funded_weekend_ok: ["funded", "weekend_ok"],
  payout_split: ["payout", "payout_split"],
  payout_minimum_qualifying_days: ["payout", "minimum_qualifying_days"],
  payout_buffer: ["payout", "payout_buffer"],
  payout_buffer_must_remain_after_request: ["payout", "payout_buffer_must_remain_after_request"],
  payout_first_payout_profit_above_buffer: ["payout", "first_payout_profit_above_buffer"],
  payout_subsequent_minimum_profit_since_last_payout: ["payout", "subsequent_payout_minimum_profit_since_last_payout"],
  payout_minimum_hours_since_cycle_start: ["payout", "minimum_hours_since_cycle_start"],
  payout_minimum_request: ["payout", "minimum_request"],
  payout_maximum_request: ["payout", "maximum_request"],
  payout_cycle_days: ["payout", "payout_cycle_days"],
  payout_maximum_consistency_ratio: ["payout", "maximum_consistency_ratio"],
  payout_resets_after_payout: ["payout", "resets_after_payout"],
  payout_sim_payouts_to_live: ["payout", "sim_payouts_to_live"],
  live_max_drawdown: ["live", "max_drawdown"],
  live_trailing: ["live", "trailing"],
  live_starting_balance: ["live", "starting_balance"],
  live_locks_at_start: ["live", "locks_at_start"],
  live_trailing_lock_floor_offset: ["live", "trailing_lock_floor_offset"],
  live_daily_loss_limit: ["live", "daily_loss_limit"],
  live_daily_loss_behavior: ["live", "daily_loss_behavior"],
  live_max_contracts: ["live", "max_contracts"],
  live_overnight_ok: ["live", "overnight_ok"],
  live_weekend_ok: ["live", "weekend_ok"],
  live_payout_split: ["live", "payout_split"],
  live_payout_minimum_request: ["live", "payout_minimum_request"],
  live_payout_cycle_days: ["live", "payout_cycle_days"],
  live_payout_cap: ["live", "payout_cap"],
  live_maximum_active_accounts: ["live", "maximum_active_accounts"],
  live_post_breach_cooldown_days: ["live", "post_breach_cooldown_days"],
  commission_per_side: ["execution", "commission_per_side"],
  hft_max_trades_per_day: ["execution", "hft_max_trades_per_day"],
  two_percent_rule_pct: ["execution", "two_percent_rule_pct"],
  baseline_slippage_ticks_mes: ["execution", "baseline_slippage_ticks_mes"],
};

function compareDocument(docPath, firmKey, fieldMap, ruleBook) {
  const documented = readCanonicalYaml(docPath);
  const firmRules = ruleBook?.firms?.[firmKey];
  if (!firmRules) failInput(`MISSING firm '${firmKey}' in ${RULE_BOOK}`);
  const drift = [];
  for (const [docKey, rulePath] of Object.entries(fieldMap)) {
    if (!(docKey in documented)) {
      drift.push({ firm: firmKey, field: docKey, expected: "documented key", found: "missing" });
      continue;
    }
    const actual = readPath(firmRules, rulePath);
    if (!equivalent(documented[docKey], actual)) {
      drift.push({ firm: firmKey, field: docKey, expected: documented[docKey], found: actual });
    }
  }
  return drift;
}

function main() {
  const ruleBook = readJson(RULE_BOOK);
  warnIfStale(MFFU_DOC);
  warnIfStale(TOPSTEP_DOC);
  const drift = [
    ...compareDocument(MFFU_DOC, "mffu_50k", MFFU_FIELDS, ruleBook),
    ...compareDocument(TOPSTEP_DOC, "topstep_50k", TOPSTEP_FIELDS, ruleBook),
  ];
  if (drift.length === 0) {
    console.log("verify-2026-rules-compliance: OK — canonical stage rules match Topstep + MFFU docs");
    return;
  }
  console.error("verify-2026-rules-compliance: DRIFT DETECTED");
  for (const item of drift) {
    console.error(`  [${item.firm}] ${item.field}: expected=${JSON.stringify(item.expected)} found=${JSON.stringify(item.found)}`);
  }
  process.exitCode = 1;
}

main();
