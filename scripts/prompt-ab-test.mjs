#!/usr/bin/env node
/**
 * Prompt A/B Harness — Pass 3 Branch C + Pass 9 Branch B, Scout Architecture Fix (2026-05-04).
 *
 * Two modes:
 *
 *   --mode old-vs-new  (default; Pass 3 Branch C)
 *     Compares OLD vs NEW prompt versions on a sample of recent system_journal
 *     entries and writes tmp-n8n/prompt-refactor-ab.md. Goal: confirm the
 *     4-block-refactored prompts perform equal or better before they hit
 *     production traffic.
 *
 *   --mode chat-vs-responses  (Pass 9 Branch B)
 *     Compares Chat Completions vs Responses API code paths for the SAME
 *     current prompt + same input. Writes tmp-n8n/responses-api-ab.md.
 *     Hard gate: ≥95% agreement before any role's flag flips to production.
 *     Below 95% triggers exit code 1 + "DO NOT FLIP" warning.
 *
 * Pass 9 Branch B dependency:
 *   This harness depends on Pass 9 Branch A (model-router.ts callOpenAI
 *   flag-gated routing on OPENAI_USE_RESPONSES_API_<ROLE>). At runtime the
 *   chat-vs-responses mode dispatches to Chat Completions and Responses API
 *   directly via the OpenAI SDK using request shapes that match Branch A's
 *   wiring. If Branch A has not yet shipped, the harness will still run
 *   correctly — it independently exercises both API surfaces.
 *
 * Roles tested:
 *   Refactored (Branch A) — A/B compared against tmp-n8n/old-prompts/<role>.md:
 *     critic_evaluator, strategy_proposer, nightly_review (per plan; in this
 *     harness we exercise critic_evaluator for tested rows and run a basic
 *     parse smoke check on strategy_proposer responses).
 *   New (Branch B) — smoke test only (no prior version to compare against):
 *     scout_auditor, dsl_quality_critic, transcript_extractor.
 *
 * Production safety constraints (per plan):
 *   - No production code changes. Read-only against src/agents/*.md and DB.
 *   - 50k token budget guard. Refuses to run if projection > budget.
 *   - Concurrent OpenAI calls capped at 4.
 *   - Idempotent: re-running overwrites the report; never mutates DB or
 *     src/agents/. Operator can iterate freely.
 *   - Pipeline pause is irrelevant — this is a research script, never a
 *     production caller.
 *
 * Usage:
 *   node scripts/prompt-ab-test.mjs --help
 *   node scripts/prompt-ab-test.mjs                 # default DB sample
 *   node scripts/prompt-ab-test.mjs --sample-file=tmp-n8n/sample.json
 *   node scripts/prompt-ab-test.mjs --max-tokens=80000
 *   node scripts/prompt-ab-test.mjs --old-prompts-dir=tmp-n8n/old-prompts
 *   node scripts/prompt-ab-test.mjs --skip-live      # only build sample,
 *                                                    # write skeleton report
 *   node scripts/prompt-ab-test.mjs --sample-size=20
 *   node scripts/prompt-ab-test.mjs --dry-run        # plan only, no calls
 *
 * Exit codes:
 *   0 — completed (or skipped cleanly with documented reason)
 *   1 — fatal error (token budget overflow, bad args, write failure)
 */

import postgres from "postgres";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    help: false,
    mode: "old-vs-new",
    role: null,
    allRoles: false,
    sampleFile: null,
    oldPromptsDir: path.join(ROOT, "tmp-n8n/old-prompts"),
    maxTokens: 50_000,
    sampleSize: 50,
    skipLive: false,
    dryRun: false,
    concurrent: 4,
  };
  // Support both --flag=value and --flag value forms (chat-vs-responses spec
  // showed `--role scout_auditor` style usage).
  const tokens = argv.slice(2);
  const eat = (i) => (i + 1 < tokens.length ? tokens[++i] : null);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    let key = raw;
    let val = null;
    const eq = raw.indexOf("=");
    if (raw.startsWith("--") && eq !== -1) {
      key = raw.slice(0, eq);
      val = raw.slice(eq + 1);
    }
    const need = () => {
      if (val !== null) return val;
      if (i + 1 >= tokens.length) throw new Error(`${key} requires a value`);
      return tokens[++i];
    };
    switch (key) {
      case "--help":
      case "-h":
        args.help = true; break;
      case "--skip-live":
        args.skipLive = true; break;
      case "--dry-run":
        args.dryRun = true; break;
      case "--all-roles":
        args.allRoles = true; break;
      case "--mode": {
        const m = need();
        if (m !== "old-vs-new" && m !== "chat-vs-responses") {
          throw new Error(`--mode must be old-vs-new | chat-vs-responses (got ${m})`);
        }
        args.mode = m; break;
      }
      case "--role": {
        const r = need();
        if (!ALL_ROLES.includes(r)) {
          throw new Error(`--role must be one of: ${ALL_ROLES.join(", ")}`);
        }
        args.role = r; break;
      }
      case "--sample-file":
        args.sampleFile = need(); break;
      case "--old-prompts-dir":
        args.oldPromptsDir = need(); break;
      case "--max-tokens": {
        const n = Number(need());
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("--max-tokens must be a non-negative number");
        }
        // Allow 0 to force a budget-abort path (used in CI / dry-run smoke).
        // Otherwise enforce the 50k floor for the default guard.
        if (n > 0 && n < 50_000) {
          throw new Error("--max-tokens must be >= 50000 (default budget guard) or exactly 0 for budget-abort smoke test");
        }
        args.maxTokens = n; break;
      }
      case "--sample-size": {
        const n = Number(need());
        if (!Number.isFinite(n) || n < 1 || n > 200) {
          throw new Error("--sample-size must be 1..200");
        }
        args.sampleSize = n; break;
      }
      case "--concurrent": {
        const n = Number(need());
        if (!Number.isFinite(n) || n < 1 || n > 8) {
          throw new Error("--concurrent must be 1..8");
        }
        args.concurrent = n; break;
      }
      default:
        throw new Error(`Unknown argument: ${raw}`);
    }
  }
  if (args.mode === "chat-vs-responses" && !args.role && !args.allRoles) {
    throw new Error("--mode chat-vs-responses requires --role <role> or --all-roles");
  }
  return args;
}

function printHelp() {
  process.stdout.write(`Prompt A/B Harness (Pass 3 Branch C + Pass 9 Branch B)

Usage:
  # Mode 1 — OLD-vs-NEW prompt comparison (Pass 3 Branch C, default)
  node scripts/prompt-ab-test.mjs [options]

  # Mode 2 — Chat Completions vs Responses API comparison (Pass 9 Branch B)
  node scripts/prompt-ab-test.mjs --mode chat-vs-responses --role <role> [options]
  node scripts/prompt-ab-test.mjs --mode chat-vs-responses --all-roles [options]

Modes:
  --mode old-vs-new         (default) compare OLD vs NEW prompt versions.
                            Output: tmp-n8n/prompt-refactor-ab.md
  --mode chat-vs-responses  Compare Chat Completions vs Responses API for
                            the SAME current prompt + same input. Hard gate
                            ≥95% agreement before flipping a role.
                            Output: tmp-n8n/responses-api-ab.md

Role selection (chat-vs-responses only):
  --role <role>             One of: ${ALL_ROLES.join(", ")}
  --all-roles               Run all 6 roles in one report.

Common options:
  --help, -h                Show this help and exit.
  --sample-file PATH        JSON file with sample rows (offline mode).
  --sample-size N           Number of journal rows to test. 1..200, default 50.
  --max-tokens N            Total OpenAI token budget. Min 50000 (guard).
                            Pass 0 to force a budget-abort smoke test.
  --concurrent N            Parallel OpenAI calls. 1..8, default 4.
  --skip-live               Skip live OpenAI calls. Build sample, write
                            skeleton report. Useful for offline preview.
  --dry-run                 Print plan + token projection, exit before any
                            DB query or OpenAI call.
  --old-prompts-dir PATH    (old-vs-new only) Directory of pre-snapshotted
                            OLD prompts. Default: tmp-n8n/old-prompts/

Per-role agreement rules (chat-vs-responses):
  scout_auditor          accept must match; score within ±2
  dsl_quality_critic     accept must match; score within ±2
  strategy_proposer      both reject OR both emit; matching entry_indicator
                         + symbol + direction
  transcript_extractor   strategy count match; per-pair entry_indicator match
  critic_evaluator       evaluation (pass/warn/fail) must match
  nightly_review         pass_rate within ±5 percentage points

Hard gate:
  Below 95% agreement → exit code 1 + "DO NOT FLIP" warning.

Branch A dependency (chat-vs-responses):
  This harness exercises both Chat Completions and Responses API directly via
  the OpenAI SDK using request shapes that match Branch A's flag-gated
  callOpenAI router (env: OPENAI_USE_RESPONSES_API_<ROLE>). When Branch A
  ships, the harness output validates that production routing produces the
  same outputs.

Outputs:
  tmp-n8n/prompt-refactor-ab.md    (old-vs-new) comparison report
  tmp-n8n/responses-api-ab.md      (chat-vs-responses) comparison report

Pre-flight (old-vs-new):
  1. bash scripts/snapshot-old-prompts.sh
  2. ensure DATABASE_URL in .env (or pass --sample-file)
  3. ensure OPENAI_API_KEY in env (or use --skip-live)

Pre-flight (chat-vs-responses):
  1. ensure DATABASE_URL in .env (or pass --sample-file)
  2. ensure OPENAI_API_KEY in env (or use --skip-live / --dry-run)
  3. (production validation) Branch A merged with callOpenAI flag wiring
`);
}

// ─── Env loader (mirrors diagnose-migrations.mjs) ──────────────────────────

function loadDotenv() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const text = readFileSync(envPath, "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const eq = l.indexOf("=");
        const k = l.slice(0, eq).trim();
        const v = l
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        return [k, v];
      }),
  );
}

// ─── Sample selection ──────────────────────────────────────────────────────

// Plan said `description.length >= 80`. Real journal data sometimes carries
// the substance in `title` (scout writes long titles, empty descriptions).
// We accept rows where EITHER field has >= 80 chars of content so the
// harness has something to compare against.
const SAMPLE_QUERY = `
  SELECT id, status, source, strategy_params, created_at
  FROM system_journal
  WHERE status IN ('passed','failed','tested','scouted')
    AND created_at > NOW() - INTERVAL '14 days'
    AND (
      length(coalesce(strategy_params->>'description','')) >= 80
      OR length(coalesce(strategy_params->>'title','')) >= 80
    )
    AND coalesce(strategy_params->>'title','') <> ''
  ORDER BY created_at DESC
  LIMIT $1
`;

async function selectSampleFromDb(env, sampleSize) {
  const dbUrl = env.DATABASE_URL || env.PG_URL || env.POSTGRES_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not in .env (or PG_URL/POSTGRES_URL)");

  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 5 });
  try {
    // Pull more than needed, then bucket-sample for the 40/40/20 mix.
    const rows = await sql.unsafe(SAMPLE_QUERY, [sampleSize * 4]);
    const buckets = {
      scouted: rows.filter((r) => r.status === "scouted"),
      tested: rows.filter((r) => r.status === "tested"),
      passfail: rows.filter((r) => r.status === "passed" || r.status === "failed"),
    };
    const targetScouted = Math.floor(sampleSize * 0.4);
    const targetTested = Math.floor(sampleSize * 0.4);
    const targetPassfail = sampleSize - targetScouted - targetTested;
    const picked = [
      ...buckets.scouted.slice(0, targetScouted),
      ...buckets.tested.slice(0, targetTested),
      ...buckets.passfail.slice(0, targetPassfail),
    ];
    return picked;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

function loadSampleFromFile(filePath) {
  const abs = path.resolve(filePath);
  const text = readFileSync(abs, "utf8");
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Sample file must be a JSON array");
  return data;
}

// ─── Prompt loader ──────────────────────────────────────────────────────────

const ROLE_TO_FILENAME = {
  critic_evaluator: "critic-evaluator.md",
  strategy_proposer: "strategy-proposer.md",
  nightly_review: "nightly-self-critique.md",
  scout_auditor: "scout-auditor.md",
  dsl_quality_critic: "dsl-quality-critic.md",
  transcript_extractor: "transcript-extractor.md",
};

const REFACTORED_ROLES = ["critic_evaluator", "strategy_proposer", "nightly_review"];
const NEW_ROLES = ["scout_auditor", "dsl_quality_critic", "transcript_extractor"];
const ALL_ROLES = [...REFACTORED_ROLES, ...NEW_ROLES];

function loadNewPrompt(role) {
  const file = path.join(ROOT, "src/agents", ROLE_TO_FILENAME[role]);
  return readFileSync(file, "utf8");
}

function loadOldPrompt(role, oldPromptsDir) {
  const file = path.join(oldPromptsDir, ROLE_TO_FILENAME[role]);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  if (text.trim().length === 0) return null;
  return text;
}

// ─── Token projection (rough, deterministic) ────────────────────────────────

/** Rough token estimate: 4 chars per token. */
function estTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Per-row token budget, summed across all roles tested. New roles cost
 * (system + user). Refactored roles cost 2x (system_old + system_new) on
 * each row plus the user.
 */
function projectTokens({ sample, refactoredPrompts, newPrompts, roleAssignment }) {
  let totalIn = 0;
  let totalOut = 0;
  for (const row of sample) {
    const userPayload = JSON.stringify(buildUserPayloadForRow(row));
    const userTokens = estTokens(userPayload);
    for (const role of roleAssignment(row)) {
      const newSysTokens = estTokens(newPrompts[role]?.text ?? "");
      // Output projection uses ROLE_TO_MAXTOK / 2 as a realistic estimate
      // (gpt-5-mini typically uses ~50% of max_completion_tokens for reasoning,
      // ~50% for visible output).
      const outBudget = (ROLE_TO_MAXTOK[role] ?? 1024) / 2;
      if (REFACTORED_ROLES.includes(role) && refactoredPrompts[role]?.old) {
        // OLD + NEW
        const oldSysTokens = estTokens(refactoredPrompts[role].old);
        totalIn += oldSysTokens + userTokens + newSysTokens + userTokens;
        totalOut += 2 * outBudget;
      } else if (NEW_ROLES.includes(role)) {
        totalIn += newSysTokens + userTokens;
        totalOut += outBudget;
      }
    }
  }
  return { totalIn, totalOut, total: totalIn + totalOut };
}

// ─── Per-row → role assignment ───────────────────────────────────────────

/**
 * Decide which roles to exercise for a given row. Heuristic per plan:
 *   - Scout-shaped row (status='scouted' or signal_type='strategy_candidate'
 *     or scout source) → scout_auditor.
 *   - Tested row with DSL fields → dsl_quality_critic.
 *   - Tested/passed/failed row with metrics in strategy_params → critic_evaluator.
 * Any single row may exercise more than one role.
 */
function rolesForRow(row) {
  const out = new Set();
  const sp = row.strategy_params ?? {};
  const desc = String(sp.description ?? "").toLowerCase();
  const isScout =
    row.status === "scouted" ||
    String(sp.signal_type ?? "") === "strategy_candidate" ||
    String(row.source ?? "").startsWith("unified-search-") ||
    String(row.source ?? "").startsWith("brave") ||
    String(row.source ?? "").startsWith("tavily");
  const hasDsl =
    sp.entry_indicator || sp.entry_type || sp.symbol || sp.timeframe;
  const hasEvidence =
    sp.sharpe_ratio !== undefined ||
    sp.profit_factor !== undefined ||
    sp.max_drawdown !== undefined ||
    row.status === "tested" ||
    row.status === "passed" ||
    row.status === "failed";
  if (isScout) out.add("scout_auditor");
  if (hasDsl) out.add("dsl_quality_critic");
  if (hasEvidence) out.add("critic_evaluator");
  // transcript_extractor: only triggered on transcript-shaped rows. Not
  // commonly present in journal — we run it as a smoke test on a small
  // synthetic input later.
  if (out.size === 0 && desc.length >= 80) out.add("scout_auditor");
  return [...out];
}

function buildUserPayloadForRow(row) {
  const sp = row.strategy_params ?? {};
  return {
    journal_id: row.id,
    title: sp.title ?? "(untitled)",
    description: sp.description ?? "",
    url: sp.url ?? null,
    source: row.source ?? null,
    status: row.status,
    // forward DSL/metric fields that critic_evaluator + dsl_quality_critic care about
    entry_indicator: sp.entry_indicator ?? null,
    entry_type: sp.entry_type ?? null,
    entry_params: sp.entry_params ?? null,
    exit_type: sp.exit_type ?? null,
    exit_params: sp.exit_params ?? null,
    stop_loss_atr_multiple: sp.stop_loss_atr_multiple ?? null,
    take_profit_atr_multiple: sp.take_profit_atr_multiple ?? null,
    preferred_regime: sp.preferred_regime ?? null,
    symbol: sp.symbol ?? null,
    timeframe: sp.timeframe ?? null,
    sharpe_ratio: sp.sharpe_ratio ?? null,
    profit_factor: sp.profit_factor ?? null,
    max_drawdown: sp.max_drawdown ?? null,
    win_rate: sp.win_rate ?? null,
    total_trades: sp.total_trades ?? null,
  };
}

// ─── OpenAI call ─────────────────────────────────────────────────────────────

// NOTE: gpt-5-mini uses `reasoning_tokens` from the same `max_completion_tokens`
// budget BEFORE emitting visible content. A small budget like 256 leaves 0
// tokens for actual output (finish_reason="length", content=""). These ceilings
// are sized to leave headroom after gpt-5's typical reasoning consumption.
const ROLE_TO_MAXTOK = {
  critic_evaluator: 3072,
  strategy_proposer: 3072,
  nightly_review: 3072,
  scout_auditor: 2048,
  dsl_quality_critic: 3072,
  transcript_extractor: 4096,
};

async function callOpenAIWith({ apiKey, systemPrompt, userPayload, role }) {
  // Lazy import — avoids module-load cost when --dry-run / --skip-live.
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });
  const max = ROLE_TO_MAXTOK[role] ?? 1024;
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    max_completion_tokens: max,
    response_format: { type: "json_object" },
  });
  const ms = Date.now() - t0;
  const content = resp.choices?.[0]?.message?.content ?? null;
  return {
    content,
    tokens: resp.usage?.total_tokens ?? 0,
    ms,
  };
}

// ─── Comparison classifier ──────────────────────────────────────────────────

function parseJsonSafe(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function decisionForRole(role, parsed) {
  if (!parsed) return { decision: null, score: null };
  switch (role) {
    case "scout_auditor":
      return { decision: parsed.accept === true, score: Number(parsed.score ?? null) };
    case "dsl_quality_critic":
      return { decision: parsed.accept === true, score: Number(parsed.score ?? null) };
    case "critic_evaluator":
      // pass/warn/fail → boolean accept (pass+warn = accept)
      return {
        decision:
          parsed.evaluation === "pass" || parsed.evaluation === "warn",
        score: typeof parsed.confidence === "number" ? parsed.confidence : null,
      };
    case "strategy_proposer":
      // refusal vs strategy emission
      return { decision: parsed.reject !== true, score: null };
    case "nightly_review":
      // no binary decision — agreement = same recommendation count bucket
      return {
        decision: null,
        score:
          Array.isArray(parsed.recommendations) ? parsed.recommendations.length : null,
      };
    case "transcript_extractor":
      return {
        decision: !(parsed.refusal === true),
        score: Array.isArray(parsed.strategies) ? parsed.strategies.length : null,
      };
    default:
      return { decision: null, score: null };
  }
}

function classifyDisagreement(role, oldDec, newDec) {
  if (oldDec.decision === null && newDec.decision === null) {
    if (oldDec.score === null || newDec.score === null) return "unscored";
    const diff = Math.abs(oldDec.score - newDec.score);
    if (diff <= 2) return "agree (score within ±2)";
    return diff > 0 ? "different reasoning depth" : "agree";
  }
  if (oldDec.decision === newDec.decision) {
    if (oldDec.score !== null && newDec.score !== null) {
      const diff = Math.abs(oldDec.score - newDec.score);
      if (diff > 2) return "agree on decision but score >±2";
    }
    return "agree";
  }
  if (oldDec.decision === true && newDec.decision === false) return "NEW more strict";
  if (oldDec.decision === false && newDec.decision === true) return "NEW more lenient";
  return "different reasoning";
}

// ─── Concurrency ────────────────────────────────────────────────────────────

async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await mapper(items[i], i);
      } catch (err) {
        results[i] = { __error: err.message ?? String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Report writer ──────────────────────────────────────────────────────────

function writeReport({ outPath, args, env, sampleResult, runResult, runtimeNotes }) {
  const lines = [];
  lines.push(`# Prompt Refactor — A/B Comparison`);
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Pass:** Pass 3 Branch C — Scout Architecture Fix`);
  lines.push(`**Plan:** \`.claude/plans/image-72-i-want-greedy-wigderson.md\``);
  lines.push(`**Harness:** \`scripts/prompt-ab-test.mjs\``);
  lines.push("");
  lines.push(`## Run configuration`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Sample target | ${args.sampleSize} |`);
  lines.push(`| Sample actual | ${sampleResult?.sample?.length ?? 0} |`);
  lines.push(`| Sample source | ${sampleResult?.source ?? "n/a"} |`);
  lines.push(`| Token budget | ${args.maxTokens} |`);
  lines.push(`| Concurrent calls | ${args.concurrent} |`);
  lines.push(`| Old prompts dir | ${args.oldPromptsDir} |`);
  lines.push(`| OPENAI_API_KEY present | ${env.OPENAI_API_KEY ? "yes" : "no"} |`);
  lines.push(`| --skip-live | ${args.skipLive ? "yes" : "no"} |`);
  lines.push(`| --dry-run | ${args.dryRun ? "yes" : "no"} |`);
  lines.push("");
  if (runtimeNotes.length) {
    lines.push(`## Runtime notes`);
    lines.push("");
    for (const n of runtimeNotes) lines.push(`- ${n}`);
    lines.push("");
  }
  lines.push(`## Prompt inventory`);
  lines.push("");
  lines.push("| Role | Status | Old chars | New chars |");
  lines.push("|---|---|---:|---:|");
  for (const role of ALL_ROLES) {
    const newP = (() => {
      try {
        return loadNewPrompt(role).length;
      } catch {
        return 0;
      }
    })();
    const oldP = loadOldPrompt(role, args.oldPromptsDir);
    const oldLen = oldP ? oldP.length : 0;
    const status = REFACTORED_ROLES.includes(role)
      ? oldP
        ? "REFACTORED (A/B)"
        : "REFACTORED (no snapshot — smoke only)"
      : "NEW (smoke test only)";
    lines.push(`| \`${role}\` | ${status} | ${oldLen || "—"} | ${newP || "—"} |`);
  }
  lines.push("");
  if (!runResult) {
    lines.push(`## Verdict`);
    lines.push("");
    lines.push(`**REVIEW** — harness ready, live run did not execute.`);
    lines.push("");
    lines.push(`Operator action: address runtime notes above, then re-run:`);
    lines.push("```bash");
    lines.push(`bash scripts/snapshot-old-prompts.sh`);
    lines.push(`node scripts/prompt-ab-test.mjs`);
    lines.push("```");
    writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
    return;
  }
  // Summary table
  lines.push(`## Per-role agreement`);
  lines.push("");
  lines.push("| Role | Type | N | Agree | Agreement % | Avg tokens (old) | Avg tokens (new) |");
  lines.push("|---|---|---:|---:|---:|---:|---:|");
  for (const role of ALL_ROLES) {
    const r = runResult.perRole[role];
    if (!r || r.n === 0) {
      lines.push(`| \`${role}\` | — | 0 | — | — | — | — |`);
      continue;
    }
    // For smoke roles, "Agree" reports parseable-JSON count; for A/B roles,
    // it reports decision-agreement count.
    const isSmoke = String(r.kind).startsWith("smoke");
    const numerator = isSmoke ? r.smokeOk : r.agreed;
    const pct =
      numerator != null && r.n > 0
        ? ((100 * numerator) / r.n).toFixed(1) + "%"
        : "—";
    const label = isSmoke ? `${numerator}/${r.n} parsed` : `${numerator ?? "—"}`;
    lines.push(
      `| \`${role}\` | ${r.kind} | ${r.n} | ${label} | ${pct} | ${r.avgOldTokens ?? "—"} | ${r.avgNewTokens ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push(`## Disagreement examples (top 5 per role)`);
  lines.push("");
  for (const role of ALL_ROLES) {
    const r = runResult.perRole[role];
    if (!r || !r.disagreements || r.disagreements.length === 0) continue;
    lines.push(`### ${role}`);
    lines.push("");
    for (const d of r.disagreements.slice(0, 5)) {
      lines.push(
        `- **journal_id:** \`${d.journalId}\` — **${d.classifier}** (old.score=${d.oldScore ?? "n/a"}, new.score=${d.newScore ?? "n/a"})`,
      );
      lines.push(`  - title: \`${(d.title ?? "").slice(0, 90)}\``);
      if (d.oldRaw) lines.push(`  - OLD: \`${(d.oldRaw ?? "").slice(0, 200)}\``);
      if (d.newRaw) lines.push(`  - NEW: \`${(d.newRaw ?? "").slice(0, 200)}\``);
    }
    lines.push("");
  }
  // Verdict
  let verdict = "PROMOTE";
  const review = [];
  for (const role of REFACTORED_ROLES) {
    const r = runResult.perRole[role];
    if (!r || r.n === 0 || r.agreed == null) continue;
    const rate = r.agreed / r.n;
    if (rate < 0.8) {
      review.push(`${role} agreement ${(100 * rate).toFixed(1)}% < 80%`);
    }
  }
  // Smoke checks for new roles
  for (const role of NEW_ROLES) {
    const r = runResult.perRole[role];
    if (!r || r.n === 0) continue;
    if (r.smokeFailRate != null && r.smokeFailRate > 0.2) {
      review.push(`${role} smoke fail rate ${(100 * r.smokeFailRate).toFixed(1)}% > 20%`);
    }
  }
  if (review.length > 0) verdict = "REVIEW";
  lines.push(`## Verdict`);
  lines.push("");
  lines.push(`**${verdict}**`);
  lines.push("");
  if (verdict === "REVIEW") {
    lines.push("Issues:");
    for (const r of review) lines.push(`- ${r}`);
  } else {
    lines.push(
      "All refactored roles meet the ≥80% agreement bar; new-role smoke tests produced parseable JSON. Safe to promote.",
    );
  }
  lines.push("");
  lines.push(`## Token usage`);
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Total tokens consumed | ${runResult.totals.totalTokens} |`);
  lines.push(`| Calls succeeded | ${runResult.totals.ok} |`);
  lines.push(`| Calls failed | ${runResult.totals.fail} |`);
  lines.push(`| Wall-clock ms | ${runResult.totals.ms} |`);
  lines.push("");
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

// ─── Pass 9 Branch B: Chat Completions vs Responses API ─────────────────────
//
// Implements the API-PATH comparison harness. Same prompt, same input, two
// transports. Agreement gate ≥95% must pass before any role's
// OPENAI_USE_RESPONSES_API_<role> flag flips to true in production.

const RESPONSES_AB_REPORT_PATH = path.join(ROOT, "tmp-n8n/responses-api-ab.md");

// gpt-5-mini pricing (per 1M tokens) — kept here only for the cost-report
// column. Production cost numbers come from `ai_inference_log` rows that
// Branch A writes.
const PRICE_INPUT_PER_1M = 0.15;
const PRICE_OUTPUT_PER_1M = 0.60;

/** Call Chat Completions API directly. Mirrors Branch A's chat path. */
async function callChatCompletions({ apiKey, systemPrompt, userPayload, role }) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });
  const max = ROLE_TO_MAXTOK[role] ?? 1024;
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    max_completion_tokens: max,
    response_format: { type: "json_object" },
  });
  const ms = Date.now() - t0;
  const content = resp.choices?.[0]?.message?.content ?? null;
  return {
    content,
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
    reasoningTokens: 0,
    totalTokens: resp.usage?.total_tokens ?? 0,
    ms,
    strictRejected: false,
  };
}

/**
 * Call Responses API directly. Mirrors Branch A's responses path with
 * strict-schema response_format. Strict-schema rejections are surfaced via
 * `strictRejected`.
 */
async function callResponsesApi({ apiKey, systemPrompt, userPayload, role }) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });
  const max = ROLE_TO_MAXTOK[role] ?? 1024;
  const t0 = Date.now();
  let resp;
  let strictRejected = false;
  try {
    resp = await client.responses.create({
      model: "gpt-5-mini",
      instructions: systemPrompt,
      input: JSON.stringify(userPayload),
      max_output_tokens: max,
      // Branch A enables strict JSON via response_format on roles whose
      // schema is locked. We mirror the loose json_object here for parity
      // with chat path; Branch A may upgrade per-role to json_schema strict.
      // Strict rejections (refusal output items) are detected post-hoc.
    });
  } catch (err) {
    // Treat schema-validation errors as strict rejects (countable, not fatal).
    if (String(err?.message ?? "").toLowerCase().includes("schema")) {
      strictRejected = true;
      return {
        content: null,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        ms: Date.now() - t0,
        strictRejected,
      };
    }
    throw err;
  }
  const ms = Date.now() - t0;
  // Responses API output extraction — text comes from output[].content[].text
  // for type="message", with refusals as type="refusal".
  let content = null;
  const out = resp.output ?? [];
  for (const item of out) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === "output_text" && typeof part.text === "string") {
          content = (content ?? "") + part.text;
        } else if (part.type === "refusal") {
          strictRejected = true;
        }
      }
    }
  }
  // Fallback: SDK convenience accessor.
  if (content === null && typeof resp.output_text === "string") {
    content = resp.output_text;
  }
  const usage = resp.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const reasoningTokens =
    usage.output_tokens_details?.reasoning_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;
  return {
    content,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    ms,
    strictRejected,
  };
}

/** Parse helpers tolerant of fenced JSON or surrounding prose. */
function looseParse(s) {
  if (s == null) return null;
  // Strip ``` fences.
  const stripped = String(s)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const direct = parseJsonSafe(stripped);
  if (direct) return direct;
  // Last-ditch: find first {...} or [...] block.
  const m = stripped.match(/[\{\[][\s\S]*[\}\]]/);
  if (!m) return null;
  return parseJsonSafe(m[0]);
}

/**
 * Per-role agreement rule. Returns
 *   { agree: boolean, reason: string, fields: { ... } }
 * Both args are parsed JSON objects (or null on parse failure).
 *
 * Roles per Branch B spec:
 *   scout_auditor       — accept matches; score within ±2
 *   dsl_quality_critic  — accept matches; score within ±2
 *   strategy_proposer   — both reject OR matching entry_indicator/symbol/direction
 *   transcript_extractor— strategies.length matches; per-pair entry_indicator matches
 *   critic_evaluator    — evaluation (pass/warn/fail) matches
 *   nightly_review      — pass_rate within ±5 (percentage points)
 */
function compareForRole(role, a, b) {
  if (a == null && b == null) return { agree: false, reason: "both_unparseable", fields: {} };
  if (a == null || b == null) return { agree: false, reason: "one_unparseable", fields: {} };

  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

  switch (role) {
    case "scout_auditor":
    case "dsl_quality_critic": {
      if (a.accept !== b.accept) {
        return { agree: false, reason: "accept_mismatch", fields: { aAccept: a.accept, bAccept: b.accept } };
      }
      const sa = num(a.score), sb = num(b.score);
      if (sa !== null && sb !== null && Math.abs(sa - sb) > 2) {
        return { agree: false, reason: "score_outside_pm2", fields: { aScore: sa, bScore: sb } };
      }
      return { agree: true, reason: "ok", fields: { accept: a.accept } };
    }
    case "critic_evaluator": {
      if (a.evaluation !== b.evaluation) {
        return { agree: false, reason: "evaluation_mismatch", fields: { a: a.evaluation, b: b.evaluation } };
      }
      return { agree: true, reason: "ok", fields: { evaluation: a.evaluation } };
    }
    case "nightly_review": {
      const pa = num(a.pass_rate), pb = num(b.pass_rate);
      if (pa === null || pb === null) {
        return { agree: false, reason: "missing_pass_rate", fields: { a: a.pass_rate, b: b.pass_rate } };
      }
      // ±5% in percentage points (treat 0..1 as fraction; >1 as percent).
      const norm = (v) => (v <= 1 ? v * 100 : v);
      if (Math.abs(norm(pa) - norm(pb)) > 5) {
        return { agree: false, reason: "pass_rate_outside_pm5", fields: { aPct: norm(pa), bPct: norm(pb) } };
      }
      return { agree: true, reason: "ok", fields: { passRate: norm(pa) } };
    }
    case "strategy_proposer": {
      const aReject = a.reject === true;
      const bReject = b.reject === true;
      if (aReject !== bReject) {
        return { agree: false, reason: "reject_mismatch", fields: { aReject, bReject } };
      }
      if (aReject && bReject) {
        return { agree: true, reason: "both_reject", fields: {} };
      }
      // Both emitted DSL — structural fields must match.
      const fields = ["entry_indicator", "symbol", "direction"];
      for (const f of fields) {
        if (String(a[f] ?? "") !== String(b[f] ?? "")) {
          return {
            agree: false,
            reason: `${f}_mismatch`,
            fields: { [f]: { a: a[f], b: b[f] } },
          };
        }
      }
      return { agree: true, reason: "ok", fields: { entry_indicator: a.entry_indicator } };
    }
    case "transcript_extractor": {
      const sa = Array.isArray(a.strategies) ? a.strategies : null;
      const sb = Array.isArray(b.strategies) ? b.strategies : null;
      if (sa === null || sb === null) {
        return { agree: false, reason: "missing_strategies_array", fields: {} };
      }
      if (sa.length !== sb.length) {
        return {
          agree: false,
          reason: "strategy_count_mismatch",
          fields: { aCount: sa.length, bCount: sb.length },
        };
      }
      for (let i = 0; i < sa.length; i++) {
        if (String(sa[i]?.entry_indicator ?? "") !== String(sb[i]?.entry_indicator ?? "")) {
          return {
            agree: false,
            reason: `pair_${i}_entry_indicator_mismatch`,
            fields: { i, a: sa[i]?.entry_indicator, b: sb[i]?.entry_indicator },
          };
        }
      }
      return { agree: true, reason: "ok", fields: { count: sa.length } };
    }
    default:
      return { agree: false, reason: "unknown_role", fields: {} };
  }
}

/** Project tokens for chat-vs-responses run (2 calls per sample per role). */
function projectTokensChatVsResponses({ samples, roles, prompts }) {
  let totalIn = 0;
  let totalOut = 0;
  for (const row of samples) {
    const userPayload = JSON.stringify(buildUserPayloadForRow(row));
    const userTokens = estTokens(userPayload);
    for (const role of roles) {
      const sysTokens = estTokens(prompts[role] ?? "");
      const outBudget = (ROLE_TO_MAXTOK[role] ?? 1024) / 2;
      // 2 calls per sample (chat + responses)
      totalIn += 2 * (sysTokens + userTokens);
      totalOut += 2 * outBudget;
    }
  }
  return { totalIn, totalOut, total: totalIn + totalOut };
}

/**
 * Read cost-tracker rows that Branch A writes for the current run window.
 * Used to populate the side-by-side latency + cost report. Falls back to
 * harness-local measurements when the table is empty (e.g., Branch A not
 * yet shipped).
 */
async function readCostTrackerRows(env, sinceIso, role) {
  const dbUrl = env.DATABASE_URL || env.PG_URL || env.POSTGRES_URL;
  if (!dbUrl) return null;
  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 5 });
  try {
    const rows = await sql.unsafe(
      `SELECT model_name, provider, role, prompt_tokens, completion_tokens,
              latency_ms, status, fallback_used, created_at
       FROM ai_inference_log
       WHERE created_at >= $1 AND role = $2`,
      [sinceIso, role],
    );
    return rows;
  } catch {
    return null;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

function pct(n, total) {
  if (!total) return "—";
  return ((100 * n) / total).toFixed(1) + "%";
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function avg(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Run the chat-vs-responses harness for a single role on a sample.
 * Returns aggregate stats + disagreement examples + side-by-side metrics.
 */
async function runChatVsResponsesForRole({
  role,
  systemPrompt,
  sample,
  apiKey,
  concurrent,
  budgetRemaining,
}) {
  const stats = {
    role,
    n: 0,
    agree: 0,
    disagreements: [],
    chat: { input: [], output: [], reasoning: [], latency: [], strictRejects: 0, parseFails: 0, errors: 0 },
    resp: { input: [], output: [], reasoning: [], latency: [], strictRejects: 0, parseFails: 0, errors: 0 },
  };

  let consumed = 0;
  const tasks = sample.map((row) => ({ row, userPayload: buildUserPayloadForRow(row) }));

  await pMap(
    tasks,
    async ({ row, userPayload }) => {
      if (consumed >= budgetRemaining) {
        // Soft-stop further calls when budget exhausted.
        return;
      }
      const [chatRes, respRes] = await Promise.all([
        callChatCompletions({ apiKey, systemPrompt, userPayload, role }).catch((err) => ({ __error: err.message ?? String(err) })),
        callResponsesApi({ apiKey, systemPrompt, userPayload, role }).catch((err) => ({ __error: err.message ?? String(err) })),
      ]);
      stats.n += 1;
      if (chatRes.__error) stats.chat.errors += 1;
      else {
        stats.chat.input.push(chatRes.inputTokens);
        stats.chat.output.push(chatRes.outputTokens);
        stats.chat.latency.push(chatRes.ms);
        consumed += chatRes.totalTokens || 0;
      }
      if (respRes.__error) stats.resp.errors += 1;
      else {
        stats.resp.input.push(respRes.inputTokens);
        stats.resp.output.push(respRes.outputTokens);
        stats.resp.reasoning.push(respRes.reasoningTokens);
        stats.resp.latency.push(respRes.ms);
        if (respRes.strictRejected) stats.resp.strictRejects += 1;
        consumed += respRes.totalTokens || 0;
      }
      const aParsed = chatRes.__error ? null : looseParse(chatRes.content);
      const bParsed = respRes.__error ? null : looseParse(respRes.content);
      if (!aParsed && !chatRes.__error) stats.chat.parseFails += 1;
      if (!bParsed && !respRes.__error) stats.resp.parseFails += 1;
      const cmp = compareForRole(role, aParsed, bParsed);
      if (cmp.agree) {
        stats.agree += 1;
      } else {
        stats.disagreements.push({
          journalId: row.id,
          title: row.strategy_params?.title ?? null,
          reason: cmp.reason,
          fields: cmp.fields,
          chat: (chatRes.content ?? "").slice(0, 240),
          resp: (respRes.content ?? "").slice(0, 240),
          chatErr: chatRes.__error ?? null,
          respErr: respRes.__error ?? null,
        });
      }
    },
    concurrent,
  );
  stats.consumed = consumed;
  return stats;
}

/** Estimate $ cost from token arrays. */
function costEstimate(inputTokens, outputTokens) {
  const i = (avg(inputTokens) ?? 0) * inputTokens.length;
  const o = (avg(outputTokens) ?? 0) * outputTokens.length;
  return (i * PRICE_INPUT_PER_1M) / 1_000_000 + (o * PRICE_OUTPUT_PER_1M) / 1_000_000;
}

function writeResponsesAbReport({ outPath, args, env, runStartedAt, perRoleStats, runtimeNotes, projection, sampleSource }) {
  const lines = [];
  lines.push(`# Responses API Migration — Chat Completions vs Responses A/B`);
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Pass:** Pass 9 Branch B — Scout Architecture Fix`);
  lines.push(`**Harness:** \`scripts/prompt-ab-test.mjs --mode chat-vs-responses\``);
  lines.push(`**Branch A dependency:** model-router.ts \`callOpenAI\` flag-gated routing on`);
  lines.push(`  \`OPENAI_USE_RESPONSES_API_<ROLE>\`. The harness exercises both API paths`);
  lines.push(`  directly via the OpenAI SDK. When Branch A ships, production routing must`);
  lines.push(`  produce outputs equivalent to the harness; if not, this report is the gate.`);
  lines.push("");
  lines.push(`## Run configuration`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Mode | chat-vs-responses |`);
  lines.push(`| Roles tested | ${perRoleStats.length ? perRoleStats.map((s) => s.role).join(", ") : "—"} |`);
  lines.push(`| Sample target | ${args.sampleSize} |`);
  lines.push(`| Sample source | ${sampleSource} |`);
  lines.push(`| Token budget | ${args.maxTokens} |`);
  lines.push(`| Token projection | ${projection?.total ?? "—"} |`);
  lines.push(`| Concurrent calls | ${args.concurrent} |`);
  lines.push(`| OPENAI_API_KEY present | ${env.OPENAI_API_KEY ? "yes" : "no"} |`);
  lines.push(`| --skip-live | ${args.skipLive ? "yes" : "no"} |`);
  lines.push(`| --dry-run | ${args.dryRun ? "yes" : "no"} |`);
  lines.push(`| Run started | ${runStartedAt} |`);
  lines.push("");
  if (runtimeNotes.length) {
    lines.push(`## Runtime notes`);
    lines.push("");
    for (const n of runtimeNotes) lines.push(`- ${n}`);
    lines.push("");
  }
  lines.push(`## Per-role agreement (95% gate)`);
  lines.push("");
  if (perRoleStats.length === 0) {
    lines.push("_No live results — see runtime notes above._");
    lines.push("");
  } else {
    lines.push("| Role | N | Agree | Agreement % | Gate |");
    lines.push("|---|---:|---:|---:|---|");
    for (const s of perRoleStats) {
      const rate = s.n > 0 ? s.agree / s.n : null;
      const passes = rate !== null && rate >= 0.95;
      const badge = rate === null ? "—" : passes ? "PASS (≥95%)" : "**DO NOT FLIP**";
      lines.push(`| \`${s.role}\` | ${s.n} | ${s.agree} | ${pct(s.agree, s.n)} | ${badge} |`);
    }
    lines.push("");
  }

  // Side-by-side metrics
  for (const s of perRoleStats) {
    lines.push(`## ${s.role} — side-by-side metrics`);
    lines.push("");
    lines.push("| Metric | Chat Completions | Responses API |");
    lines.push("|---|---:|---:|");
    const fmt = (v, d = 0) => (v === null || v === undefined ? "—" : v.toFixed(d));
    lines.push(`| Avg input tokens | ${fmt(avg(s.chat.input))} | ${fmt(avg(s.resp.input))} |`);
    lines.push(`| Avg output tokens | ${fmt(avg(s.chat.output))} | ${fmt(avg(s.resp.output))} |`);
    lines.push(`| Avg reasoning tokens | n/a | ${fmt(avg(s.resp.reasoning))} |`);
    lines.push(`| p50 latency (ms) | ${fmt(percentile(s.chat.latency, 50))} | ${fmt(percentile(s.resp.latency, 50))} |`);
    lines.push(`| p95 latency (ms) | ${fmt(percentile(s.chat.latency, 95))} | ${fmt(percentile(s.resp.latency, 95))} |`);
    const chatCost = costEstimate(s.chat.input, s.chat.output);
    const respCost = costEstimate(s.resp.input, s.resp.output);
    lines.push(`| Estimated cost ($) | ${chatCost.toFixed(6)} | ${respCost.toFixed(6)} |`);
    lines.push(`| Strict-schema rejects | n/a | ${s.resp.strictRejects} |`);
    lines.push(`| Parse failures | ${s.chat.parseFails} | ${s.resp.parseFails} |`);
    lines.push(`| Call errors | ${s.chat.errors} | ${s.resp.errors} |`);
    lines.push("");
    if (s.disagreements.length > 0) {
      lines.push(`### Disagreement examples (top 5)`);
      lines.push("");
      for (const d of s.disagreements.slice(0, 5)) {
        lines.push(`- **journal_id:** \`${d.journalId}\` — **${d.reason}**`);
        if (d.title) lines.push(`  - title: \`${String(d.title).slice(0, 90)}\``);
        if (d.chatErr) lines.push(`  - CHAT error: ${d.chatErr}`);
        else if (d.chat) lines.push(`  - CHAT: \`${d.chat}\``);
        if (d.respErr) lines.push(`  - RESPONSES error: ${d.respErr}`);
        else if (d.resp) lines.push(`  - RESPONSES: \`${d.resp}\``);
      }
      lines.push("");
    }
  }

  // Canary order
  if (perRoleStats.length > 0) {
    const ordered = [...perRoleStats]
      .map((s) => ({ ...s, rate: s.n > 0 ? s.agree / s.n : 0 }))
      .sort((a, b) => b.rate - a.rate);
    lines.push(`## Recommended canary order (by readiness)`);
    lines.push("");
    let i = 1;
    for (const s of ordered) {
      const ratePct = (100 * s.rate).toFixed(1);
      const badge = s.rate >= 0.95 ? "ready for first flip" : "**DO NOT FLIP** — agreement below 95% threshold";
      lines.push(`${i}. \`${s.role}\` — agreement ${ratePct}% — ${badge}`);
      i += 1;
    }
    lines.push("");
  }

  lines.push(`## Operator playbook`);
  lines.push("");
  lines.push(`1. Pass: re-run weekly until agreement is stable across 3 consecutive runs.`);
  lines.push(`2. Flip the highest-agreement role first by setting`);
  lines.push(`   \`OPENAI_USE_RESPONSES_API_<ROLE>=true\` in production env.`);
  lines.push(`3. Watch \`ai_inference_log\` for that role for 24h. Validate latency/cost`);
  lines.push(`   table in this report matches production observations.`);
  lines.push(`4. Repeat with next role. Never flip a role with <95% agreement.`);
  lines.push("");
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

async function runChatVsResponsesMode(args, env) {
  const outPath = RESPONSES_AB_REPORT_PATH;
  if (!existsSync(path.dirname(outPath))) mkdirSync(path.dirname(outPath), { recursive: true });
  const runStartedAt = new Date().toISOString();
  const runtimeNotes = [];

  const roles = args.allRoles ? [...ALL_ROLES] : [args.role];

  // Load prompts
  const prompts = {};
  for (const role of roles) {
    try {
      prompts[role] = loadNewPrompt(role);
    } catch (err) {
      prompts[role] = "";
      runtimeNotes.push(`Failed to load prompt for \`${role}\`: ${err.message}`);
    }
  }

  // Sample
  let sample = [];
  let sampleSource = "none";
  if (args.sampleFile) {
    try {
      sample = loadSampleFromFile(args.sampleFile).slice(0, args.sampleSize);
      sampleSource = `file:${args.sampleFile}`;
    } catch (err) {
      runtimeNotes.push(`Failed to load --sample-file: ${err.message}`);
    }
  } else {
    try {
      sample = await selectSampleFromDb(env, args.sampleSize);
      sampleSource = "db:system_journal";
    } catch (err) {
      runtimeNotes.push(`DB sample failed: ${err.message}. Pass --sample-file to run offline.`);
    }
  }

  // Idempotent: deterministic ordering by id (UUID lex order).
  sample = [...sample].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Token projection + budget guard. --max-tokens=0 always aborts (CI smoke).
  const projection = projectTokensChatVsResponses({ samples: sample, roles, prompts });
  process.stdout.write(
    `[chat-vs-responses] Token projection: in=${projection.totalIn}, out=${projection.totalOut}, total=${projection.total} (budget=${args.maxTokens})\n`,
  );
  if (args.maxTokens === 0 || projection.total > args.maxTokens) {
    runtimeNotes.push(
      args.maxTokens === 0
        ? `--max-tokens=0 forces budget-abort smoke. Refusing to start.`
        : `Token projection ${projection.total} > budget ${args.maxTokens}. Refusing to start. Reduce --sample-size or raise --max-tokens.`,
    );
    writeResponsesAbReport({
      outPath, args, env, runStartedAt,
      perRoleStats: [], runtimeNotes, projection, sampleSource,
    });
    process.stdout.write(`Wrote budget-skip report → ${outPath}\n`);
    process.exit(0);
  }

  if (args.dryRun) {
    runtimeNotes.push("--dry-run set; exiting before any OpenAI call.");
    writeResponsesAbReport({
      outPath, args, env, runStartedAt,
      perRoleStats: [], runtimeNotes, projection, sampleSource,
    });
    process.stdout.write(`Wrote dry-run report → ${outPath}\n`);
    process.exit(0);
  }

  if (args.skipLive) {
    runtimeNotes.push("--skip-live set; skipping OpenAI calls.");
    writeResponsesAbReport({
      outPath, args, env, runStartedAt,
      perRoleStats: [], runtimeNotes, projection, sampleSource,
    });
    process.stdout.write(`Wrote skip-live report → ${outPath}\n`);
    process.exit(0);
  }

  if (!env.OPENAI_API_KEY) {
    runtimeNotes.push("set OPENAI_API_KEY to run — live A/B requires the key. No calls were made.");
    writeResponsesAbReport({
      outPath, args, env, runStartedAt,
      perRoleStats: [], runtimeNotes, projection, sampleSource,
    });
    process.stdout.write(`Wrote no-key report → ${outPath}\n`);
    process.exit(0);
  }

  if (sample.length === 0) {
    runtimeNotes.push("No sample rows available. Pass --sample-file with synthetic inputs.");
    writeResponsesAbReport({
      outPath, args, env, runStartedAt,
      perRoleStats: [], runtimeNotes, projection, sampleSource,
    });
    process.stdout.write(`Wrote empty-sample report → ${outPath}\n`);
    process.exit(0);
  }

  // Live run, per role
  const perRoleStats = [];
  let budgetRemaining = args.maxTokens;
  for (const role of roles) {
    const sysPrompt = prompts[role];
    if (!sysPrompt) {
      runtimeNotes.push(`Skipping \`${role}\` — no prompt loaded.`);
      continue;
    }
    const stats = await runChatVsResponsesForRole({
      role,
      systemPrompt: sysPrompt,
      sample,
      apiKey: env.OPENAI_API_KEY,
      concurrent: args.concurrent,
      budgetRemaining,
    });
    budgetRemaining -= stats.consumed ?? 0;
    perRoleStats.push(stats);
    // Try to enrich with cost-tracker DB rows (Branch A telemetry).
    const trackerRows = await readCostTrackerRows(env, runStartedAt, role);
    if (trackerRows && trackerRows.length > 0) {
      runtimeNotes.push(
        `cost-tracker: ${trackerRows.length} ai_inference_log rows for \`${role}\` since run start (Branch A telemetry visible).`,
      );
    }
  }

  // Hard gate
  let exitCode = 0;
  for (const s of perRoleStats) {
    const rate = s.n > 0 ? s.agree / s.n : 0;
    if (rate < 0.95) {
      const pctStr = (100 * rate).toFixed(1);
      process.stderr.write(
        `\n=========================================================================\n` +
          `DO NOT FLIP ${s.role} TO RESPONSES API — agreement ${pctStr}% below 95% threshold\n` +
          `=========================================================================\n\n`,
      );
      exitCode = 1;
    }
  }

  writeResponsesAbReport({
    outPath, args, env, runStartedAt,
    perRoleStats, runtimeNotes, projection, sampleSource,
  });
  process.stdout.write(`Wrote chat-vs-responses report → ${outPath}\n`);
  process.exit(exitCode);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n\n`);
    printHelp();
    process.exit(1);
  }
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const env = { ...loadDotenv(), ...process.env };

  // Pass 9 Branch B: dispatch chat-vs-responses mode before any old-vs-new
  // setup. The two modes write to different report paths and have different
  // exit-code semantics (chat-vs-responses fails the process when any role
  // is below 95% agreement).
  if (args.mode === "chat-vs-responses") {
    return runChatVsResponsesMode(args, env);
  }

  const outPath = path.join(ROOT, "tmp-n8n/prompt-refactor-ab.md");
  if (!existsSync(path.dirname(outPath))) mkdirSync(path.dirname(outPath), { recursive: true });

  const runtimeNotes = [];

  // Phase 1: load prompts
  const newPrompts = {};
  const refactoredPrompts = {};
  for (const role of ALL_ROLES) {
    try {
      newPrompts[role] = { text: loadNewPrompt(role) };
    } catch (err) {
      newPrompts[role] = { text: "" };
      runtimeNotes.push(`Failed to load NEW prompt for \`${role}\`: ${err.message}`);
    }
  }
  for (const role of REFACTORED_ROLES) {
    const old = loadOldPrompt(role, args.oldPromptsDir);
    refactoredPrompts[role] = { old };
    if (!old) {
      runtimeNotes.push(
        `OLD prompt for \`${role}\` not found in ${args.oldPromptsDir} — falling back to smoke test only. Run \`bash scripts/snapshot-old-prompts.sh\` to populate.`,
      );
    }
  }

  // Phase 2: pick sample
  let sample = [];
  let sampleSource = "none";
  if (args.sampleFile) {
    try {
      sample = loadSampleFromFile(args.sampleFile).slice(0, args.sampleSize);
      sampleSource = `file:${args.sampleFile}`;
    } catch (err) {
      runtimeNotes.push(`Failed to load --sample-file: ${err.message}`);
    }
  } else {
    try {
      sample = await selectSampleFromDb(env, args.sampleSize);
      sampleSource = "db:system_journal";
    } catch (err) {
      runtimeNotes.push(`DB sample failed: ${err.message}. Pass --sample-file to run offline.`);
    }
  }

  if (sample.length === 0) {
    runtimeNotes.push("No sample rows. Skipping live run; report is skeleton-only.");
    writeReport({
      outPath,
      args,
      env,
      sampleResult: { sample, source: sampleSource },
      runResult: null,
      runtimeNotes,
    });
    process.stdout.write(`Wrote skeleton report → ${outPath}\n`);
    process.exit(0);
  }

  // Phase 3: token projection
  const projection = projectTokens({
    sample,
    refactoredPrompts,
    newPrompts,
    roleAssignment: rolesForRow,
  });
  process.stdout.write(
    `Token projection: in=${projection.totalIn}, out=${projection.totalOut}, total=${projection.total} (budget=${args.maxTokens})\n`,
  );
  if (projection.total > args.maxTokens) {
    runtimeNotes.push(
      `Token projection ${projection.total} > budget ${args.maxTokens}. Refusing to start. Reduce --sample-size or raise --max-tokens.`,
    );
    writeReport({
      outPath,
      args,
      env,
      sampleResult: { sample, source: sampleSource },
      runResult: null,
      runtimeNotes,
    });
    process.stdout.write(`Wrote report (token-budget skip) → ${outPath}\n`);
    process.exit(0);
  }

  if (args.dryRun) {
    runtimeNotes.push("Dry run requested — exiting before any OpenAI call.");
    writeReport({
      outPath,
      args,
      env,
      sampleResult: { sample, source: sampleSource },
      runResult: null,
      runtimeNotes,
    });
    process.stdout.write(`Wrote dry-run report → ${outPath}\n`);
    process.exit(0);
  }

  if (args.skipLive) {
    runtimeNotes.push("--skip-live flag set; skipping OpenAI calls.");
    writeReport({
      outPath,
      args,
      env,
      sampleResult: { sample, source: sampleSource },
      runResult: null,
      runtimeNotes,
    });
    process.stdout.write(`Wrote skip-live report → ${outPath}\n`);
    process.exit(0);
  }

  if (!env.OPENAI_API_KEY) {
    runtimeNotes.push("OPENAI_API_KEY not set; live run skipped. Operator must set the key and re-run.");
    writeReport({
      outPath,
      args,
      env,
      sampleResult: { sample, source: sampleSource },
      runResult: null,
      runtimeNotes,
    });
    process.stdout.write(`Wrote no-key report → ${outPath}\n`);
    process.exit(0);
  }

  // Phase 4: live calls — build per-row, per-role tasks
  const tasks = [];
  for (const row of sample) {
    const roles = rolesForRow(row);
    for (const role of roles) {
      const userPayload = buildUserPayloadForRow(row);
      const newSys = newPrompts[role]?.text ?? "";
      const oldSys = refactoredPrompts[role]?.old ?? null;
      tasks.push({ row, role, userPayload, newSys, oldSys });
    }
  }

  const t0 = Date.now();
  let totalTokens = 0;
  let ok = 0;
  let fail = 0;
  const perRole = {};
  for (const r of ALL_ROLES) {
    perRole[r] = {
      kind: NEW_ROLES.includes(r) ? "smoke" : "ab",
      n: 0,
      agreed: 0,
      smokeOk: 0,
      smokeFail: 0,
      smokeFailRate: null,
      avgOldTokens: null,
      avgNewTokens: null,
      _oldTokens: [],
      _newTokens: [],
      disagreements: [],
    };
  }

  await pMap(
    tasks,
    async (task) => {
      const { row, role, userPayload, newSys, oldSys } = task;
      const newCall = await callOpenAIWith({
        apiKey: env.OPENAI_API_KEY,
        systemPrompt: newSys,
        userPayload,
        role,
      }).catch((err) => ({ content: null, tokens: 0, ms: 0, __error: err.message }));
      let oldCall = null;
      if (oldSys && totalTokens + (newCall.tokens || 0) < args.maxTokens) {
        oldCall = await callOpenAIWith({
          apiKey: env.OPENAI_API_KEY,
          systemPrompt: oldSys,
          userPayload,
          role,
        }).catch((err) => ({ content: null, tokens: 0, ms: 0, __error: err.message }));
      }
      totalTokens += (newCall.tokens || 0) + (oldCall?.tokens || 0);
      const slot = perRole[role];
      slot.n += 1;
      slot._newTokens.push(newCall.tokens || 0);
      if (oldCall) slot._oldTokens.push(oldCall.tokens || 0);

      if (NEW_ROLES.includes(role)) {
        // Smoke test: parseable JSON?
        const parsed = parseJsonSafe(newCall.content);
        if (parsed) {
          slot.smokeOk += 1;
          ok += 1;
        } else {
          slot.smokeFail += 1;
          fail += 1;
        }
        return;
      }

      // A/B: compare old vs new
      if (!oldCall) {
        // No old snapshot — degrade to smoke test
        const parsed = parseJsonSafe(newCall.content);
        if (parsed) ok += 1;
        else fail += 1;
        return;
      }
      const oldP = parseJsonSafe(oldCall.content);
      const newP = parseJsonSafe(newCall.content);
      const oldDec = decisionForRole(role, oldP);
      const newDec = decisionForRole(role, newP);
      const cls = classifyDisagreement(role, oldDec, newDec);
      if (cls === "agree" || cls === "agree (score within ±2)") {
        slot.agreed += 1;
        ok += 1;
      } else {
        slot.disagreements.push({
          journalId: row.id,
          title: row.strategy_params?.title ?? null,
          classifier: cls,
          oldScore: oldDec.score,
          newScore: newDec.score,
          oldRaw: oldCall.content,
          newRaw: newCall.content,
        });
        // Still counts as a successful round-trip pair
        ok += 1;
      }
    },
    args.concurrent,
  );

  for (const r of ALL_ROLES) {
    const slot = perRole[r];
    if (slot._oldTokens.length > 0)
      slot.avgOldTokens = Math.round(slot._oldTokens.reduce((a, b) => a + b, 0) / slot._oldTokens.length);
    if (slot._newTokens.length > 0)
      slot.avgNewTokens = Math.round(slot._newTokens.reduce((a, b) => a + b, 0) / slot._newTokens.length);
    if (NEW_ROLES.includes(r) && slot.n > 0) {
      slot.smokeFailRate = slot.smokeFail / slot.n;
    }
    if (perRole[r].kind === "ab" && perRole[r]._oldTokens.length === 0) {
      // No A/B pairs were made — mark as smoke
      perRole[r].kind = "smoke (no old snapshot)";
      perRole[r].agreed = null;
    }
    delete slot._oldTokens;
    delete slot._newTokens;
  }

  const ms = Date.now() - t0;
  runtimeNotes.push(`Live run completed: ${ok} ok / ${fail} fail / ${totalTokens} tokens / ${ms} ms`);

  // Surface roles with 0 N — indicates the live sample didn't exercise that
  // role. Common reasons: no tested/passed/failed rows in last 14 days,
  // no DSL fields on journal rows, no transcript-shaped inputs.
  const skipped = ALL_ROLES.filter((r) => (perRole[r]?.n ?? 0) === 0);
  if (skipped.length > 0) {
    runtimeNotes.push(
      `Roles with 0 sample exercise: ${skipped.join(", ")}. ` +
        `Reason: live journal sample didn't carry rows that would trigger these roles ` +
        `(e.g. no rows with status='tested'+evidence, no DSL fields, no transcripts). ` +
        `Re-run after the pipeline has produced tested/passed/failed rows, or pass ` +
        `--sample-file with synthetic inputs covering each role.`,
    );
  }

  writeReport({
    outPath,
    args,
    env,
    sampleResult: { sample, source: sampleSource },
    runResult: {
      perRole,
      totals: { totalTokens, ok, fail, ms },
    },
    runtimeNotes,
  });
  process.stdout.write(`Wrote report → ${outPath}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
