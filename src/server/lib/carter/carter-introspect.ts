/**
 * carter-introspect.ts — Carter "knows every inch of Trading Forge" read tools.
 *
 * 7 GREEN, read-only, voice-friendly introspection handlers that let the voice
 * agent explain the system to the operator:
 *
 *   explain_gate            — plain-English explanation of a hard gate (+ live threshold)
 *   list_subsystems         — bounded list of registered subsystem names
 *   summarize_subsystem     — one subsystem's registry entry
 *   read_strategy_internals — a strategy's policy slice (config JSONB + columns)
 *   trace_correlation       — audit_log rows for one correlationId (end-to-end trace)
 *   read_recent_decisions   — recent lifecycle_transitions + strategy name
 *   read_system_map         — section/headings of the System Map v2 doc
 *
 * INVARIANTS:
 *   - All read-only. No mutations. No secrets read.
 *   - Bounded outputs (voice agent) — arrays/strings capped.
 *   - Fail-SOFT on file/DB errors — return a structured { error } object, never
 *     crash the route (the route catches throws, but these handlers prefer a
 *     structured soft-fail for file/registry I/O; bad INPUT still throws).
 *
 * Each handler matches the signature `(params: unknown) => Promise<unknown>`.
 * Handler keys in CARTER_INTROSPECT_HANDLERS MUST match the CarterTool.handler
 * field in tool-registry.ts; the contract test enforces parity.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "../../db/index.js";
import { strategies, auditLog, lifecycleTransitions } from "../../db/schema.js";
import { desc, asc, eq } from "drizzle-orm";

import { logger } from "../logger.js";

// Gate threshold getters (env-synced, called at request time for the LIVE value).
import { getB14CiHighThreshold } from "../b14-ci-gate.js";
import { getWfeHardFloor } from "../wfe-gate.js";
import { getPboLifecycleThreshold } from "../pbo-gate.js";

// ─── Path resolution (ESM tsx + compiled-to-dist) ─────────────────────────────
// carter-introspect.ts lives at src/server/lib/carter/ → repo root is 4 hops up.
const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);
const REPO_ROOT = path.resolve(_dirname, "../../../../");

/** Resolve a repo-relative file, trying the import-relative root then cwd. */
function resolveRepoFile(relative: string): string | null {
  const candidates = [path.join(REPO_ROOT, relative), path.join(process.cwd(), relative)];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ─── GATE_CATALOG ─────────────────────────────────────────────────────────────
// Derived from CLAUDE.md §12 (Hard Gates) + §13 (Don'ts). Each entry is a static
// description; gates with a canonical live threshold getter attach it at runtime.

interface GateEntry {
  gate: string;
  what_it_catches: string;
  stage: string;
  plain_english: string;
  /** Canonical static threshold note (live value injected for some gates). */
  threshold?: string;
  /** Internal: which live getter to call to refresh `threshold` at request time. */
  _live?: "b14" | "wfe" | "pbo";
  /** Internal: alias tokens (already normalized) for loose matching. */
  _aliases: string[];
}

/** Normalize a name for loose matching: lowercase, drop "the ", strip non-alphanum. */
function normalizeGateName(raw: string): string {
  return String(raw)
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

const GATE_CATALOG: GateEntry[] = [
  {
    gate: "B14 ci_high (Survival Twin)",
    what_it_catches: "Per-firm payout-denial / account-ban risk from probability-of-ruin",
    stage: "PAPER → DEPLOY_READY (HARD)",
    plain_english:
      "Runs thousands of Monte Carlo what-if account simulations and looks at the WORST-case (upper confidence bound) chance of blowing the account or getting a payout denied. If that worst-case is too high, the strategy is blocked from going live — it reads the conservative ci_high bound, never the rosy point estimate.",
    _live: "b14",
    _aliases: ["b14", "b14cihigh", "cihigh", "survivaltwin", "ruin", "probabilityofruin", "b14survivaltwin"],
  },
  {
    gate: "WFE (Walk-Forward Efficiency)",
    what_it_catches: "Out-of-sample decay — backtest looks good but doesn't hold up on unseen data",
    stage: "PAPER → DEPLOY_READY (HARD)",
    plain_english:
      "Compares how well the strategy did on data it was tuned on versus fresh, unseen data. If the out-of-sample performance falls below the institutional floor, it's overfit and gets blocked. The band just below the floor blocks too — not just a warning.",
    _live: "wfe",
    _aliases: ["wfe", "walkforwardefficiency", "walkforward"],
  },
  {
    gate: "PBO (Probability of Backtest Overfitting)",
    what_it_catches: "Selection overfitting across many tested variants",
    stage: "TESTING → SHADOW / PAPER (HARD)",
    plain_english:
      "When the scout tries hundreds of parameter variants, some look great purely by luck. PBO estimates the chance the 'best' one is a fluke that will underperform live. Above the institutional threshold, it's blocked.",
    _live: "pbo",
    _aliases: ["pbo", "probabilityofbacktestoverfitting", "overfit", "overfitting"],
  },
  {
    gate: "Parameter Drift (overfit_drift)",
    what_it_catches: "Parameters that shift across walk-forward folds for non-regime reasons",
    stage: "PAPER → DEPLOY_READY (HARD when overfit_drift + confidence ≥ 0.70)",
    plain_english:
      "Watches whether the best parameters jump around between time windows. If they drift in a way the market regime can't explain (and the classifier is confident), that's curve-fitting and the promotion is blocked. Regime-driven drift is allowed; indeterminate drift is a warning.",
    threshold: "overfit_drift AND confidence ≥ 0.70 blocks",
    _aliases: ["parameterdrift", "paramdrift", "drift", "overfitdrift"],
  },
  {
    gate: "B15 Parameter Robustness Battery",
    what_it_catches: "Perturbation fragility — strategy breaks under ±20% parameter jitter",
    stage: "PAPER → DEPLOY_READY (HARD when battery enabled)",
    plain_english:
      "Nudges every parameter up and down by about 20% and checks the strategy still performs. If small changes wreck it (SDR < 0.85, PSI > 0.05, or RWS > 0.20), it's too fragile to trust with real money.",
    threshold: "SDR ≥ 0.85, PSI ≤ 0.05, RWS ≤ 0.20",
    _aliases: ["b15", "parameterrobustness", "robustnessbattery", "robustness", "sdr", "psi", "rws"],
  },
  {
    gate: "BIF (Backtest Inflation Factor)",
    what_it_catches: "Selection-inflated in-sample Sharpe vs walk-forward (OOS) Sharpe",
    stage: "PAPER → DEPLOY_READY (HARD)",
    plain_english:
      "Measures how much the tuned in-sample Sharpe is inflated over the honest out-of-sample Sharpe. A big ratio means the scout cherry-picked a lucky variant. Above 4x it blocks; 2x–4x warns. Guards against promoting selection-inflated strategies.",
    threshold: "blocks when BIF > 4.0 (warn 2.0–4.0)",
    _aliases: ["bif", "backtestinflationfactor", "inflationfactor"],
  },
  {
    gate: "Compliance Enforce Mode",
    what_it_catches: "Trades that violate firm rules (2% rule, HFT limit, MFFU hedging ban)",
    stage: "every backtest fill / every live entry (HARD by default)",
    plain_english:
      "By default backtests BLOCK any trade that would break a prop-firm rule at fill time, instead of quietly letting it through. Shadow mode (log-only) only exists for explicit novel-edge research, never for promotion decisions.",
    threshold: "BACKTEST_COMPLIANCE_MODE=enforce (default)",
    _aliases: ["complianceenforce", "compliance", "compliancemode", "2026compliance", "enforce"],
  },
  {
    gate: "Frozen-Policy Hash Drift",
    what_it_catches: "Silent retraining drift — a deployed strategy's policy slice was mutated",
    stage: "PAPER → DEPLOY_READY (HARD, after all Wave 27.5 gates clear)",
    plain_english:
      "When a strategy passes validation it gets a tamper-proof fingerprint (SHA-256) of its core policy: entry quality, sizing, stop, target, and exit plan. If anyone changes those five fields and tries to re-promote, it's blocked unless an operator signs an HMAC override with a written reason (≥50 chars). Cosmetic edits like name/symbol don't trip it.",
    threshold: "SHA-256 over {entry_quality, position_size, stop_loss, take_profit, exit_plan_config}",
    _aliases: ["frozenpolicy", "frozenpolicyhash", "frozenpolicycontract", "policyhash"],
  },
  {
    gate: "Shadow-Signal Divergence",
    what_it_catches: "Training-serving skew — live shadow signals diverge from backtest expectations",
    stage: "SHADOW → PAPER (HARD)",
    plain_english:
      "Before a strategy touches a real broker it runs in SHADOW (logged, no orders). This gate compares those logged signals to what the backtest predicted. If they diverge by 5% or more across at least 20 signals, the live wiring doesn't match the test — the #1 institutional failure mode — so promotion is blocked.",
    threshold: "blocks when divergence ≥ 5% across ≥ 20 signals",
    _aliases: ["shadowdivergence", "shadowsignaldivergence", "divergence", "trainingservingskew", "skew"],
  },
  {
    gate: "Daily Trade Cap",
    what_it_catches: "Over-trading past the 1–2 A+ trades/day mandate",
    stage: "every paper entry signal (HARD, signal-time)",
    plain_english:
      "Enforces the operator's '1–2 A+ trades per day per account' rule. The default cap is 2, so the 3rd signal of the day is the first one rejected. Counted per prop-firm account over the CME trading day. Fails OPEN on a DB error (lets one slip rather than silently halting).",
    threshold: "TF_MAX_TRADES_PER_DAY=2 (default)",
    _aliases: ["dailytradecap", "tradecap", "maxtradesperday", "tradelimit"],
  },
  {
    gate: "Lunch Blackout",
    what_it_catches: "Low-quality midday chop / false breakouts",
    stage: "every entry signal (HARD, signal-time)",
    plain_english:
      "Blocks new entries during the 11:30–13:30 ET lunch dead zone, where prop-firm data shows >60% false-breakout rates. Mean-reversion archetypes can opt out per-strategy; trend/structural strategies never should.",
    threshold: "11:30–13:30 ET (LUNCH_BLACKOUT_START_ET / _END_ET)",
    _aliases: ["lunchblackout", "lunch", "lunchdeadzone", "middayblackout"],
  },
  {
    gate: "macro_alignment hard-block",
    what_it_catches: "Trading into FOMC / CPI / NFP event blackouts",
    stage: "every weighted-confluence signal (HARD-BLOCK)",
    plain_english:
      "On major economic-event days (FOMC, CPI, NFP) the confluence score is forced to ZERO no matter how strong every other factor looks. There is no per-strategy override and no env escape — if you want to trade these days, the answer is to skip the trade.",
    threshold: "calendarBlocked=true ⇒ score forced to 0",
    _aliases: ["macroalignment", "macro", "macrohardblock", "fomc", "cpi", "nfp", "newsblackout"],
  },
  {
    gate: "Kill Switch / Production-Halt",
    what_it_catches: "Any new position while the system is halted for production safety",
    stage: "every openPosition (FIRST gate)",
    plain_english:
      "The very first check before any new position is whether the production kill switch is engaged. If the system has halted itself for a safety reason, no order opens — period. This is the master cutoff and is never bypassed.",
    threshold: "killSwitch.isHaltedForProduction() must be false",
    _aliases: ["killswitch", "productionhalt", "productionmodehalt", "halt", "kill"],
  },
  {
    gate: "A4 Frankenstein",
    what_it_catches: "Curve-fit luck stitched together from unrelated pieces",
    stage: "TESTING → PAPER",
    plain_english:
      "Shuffles the strategy's trade sequence many times (N-shuffle) to check the edge isn't just a lucky ordering of trades 'stitched together' like Frankenstein's monster. If the real sequence isn't meaningfully better than random shuffles, it's luck, not edge.",
    _aliases: ["a4", "frankenstein", "a4frankenstein"],
  },
  {
    gate: "A7 Signal Correlation",
    what_it_catches: "Duplicate-signal failure — strategy is really just one repeated bet",
    stage: "PAPER → DEPLOY_READY",
    plain_english:
      "Checks whether the strategy's signals are too correlated with each other — meaning it's effectively making the same trade over and over rather than a diversified edge. Highly duplicate signals fail because one bad regime takes them all down at once.",
    _aliases: ["a7", "signalcorrelation", "a7signalcorrelation", "correlation"],
  },
];

// Pre-index aliases → entry for O(1) loose lookup.
const _gateAliasIndex = new Map<string, GateEntry>();
for (const g of GATE_CATALOG) {
  _gateAliasIndex.set(normalizeGateName(g.gate), g);
  for (const a of g._aliases) _gateAliasIndex.set(a, g);
}

// ─── explain_gate ─────────────────────────────────────────────────────────────

interface ExplainGateParams {
  name?: string;
}

async function explainGate(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as ExplainGateParams;
  if (!p.name || typeof p.name !== "string" || p.name.trim() === "") {
    throw new Error("params.name is required");
  }

  const norm = normalizeGateName(p.name);
  // Exact alias hit first, then substring containment either direction.
  let match = _gateAliasIndex.get(norm) ?? null;
  if (!match && norm.length >= 2) {
    for (const [alias, entry] of _gateAliasIndex) {
      if (alias.includes(norm) || norm.includes(alias)) {
        match = entry;
        break;
      }
    }
  }

  if (!match) {
    return {
      error: "unknown_gate",
      requested: p.name,
      known: GATE_CATALOG.map((g) => g.gate),
    };
  }

  // Refresh live threshold for gates that have a canonical getter.
  let threshold = match.threshold ?? null;
  try {
    if (match._live === "b14") {
      threshold = `blocks when probability_of_ruin_ci.ci_high > ${getB14CiHighThreshold()}`;
    } else if (match._live === "wfe") {
      threshold = `blocks when wfe_overall < ${getWfeHardFloor()}`;
    } else if (match._live === "pbo") {
      threshold = `blocks when pbo_overall > ${getPboLifecycleThreshold()}`;
    }
  } catch (err) {
    logger.warn({ err, gate: match.gate }, "carter-introspect.explain_gate: live threshold getter threw");
    // keep static threshold note
  }

  return {
    gate: match.gate,
    what_it_catches: match.what_it_catches,
    stage: match.stage,
    plain_english: match.plain_english,
    threshold,
  };
}

// ─── Subsystem registry loading ───────────────────────────────────────────────

interface SubsystemEntry {
  id: string;
  domain?: string;
  automation_scope?: string;
  routes?: unknown;
  database_tables?: unknown;
  audit_actions?: unknown;
  criticality?: unknown;
  [k: string]: unknown;
}

const SUBSYSTEM_REGISTRY_REL = "docs/system-subsystem-registry.json";

/** Read + parse the subsystem registry, fail-soft to null on any error. */
function loadSubsystemRegistry(): SubsystemEntry[] | null {
  try {
    const file = resolveRepoFile(SUBSYSTEM_REGISTRY_REL);
    if (!file) return null;
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as SubsystemEntry[];
  } catch (err) {
    logger.warn({ err }, "carter-introspect: failed to load subsystem registry");
    return null;
  }
}

// ─── list_subsystems ──────────────────────────────────────────────────────────

const SUBSYSTEM_LIST_CAP = 120;

async function listSubsystems(_params: unknown): Promise<unknown> {
  const registry = loadSubsystemRegistry();
  if (!registry) {
    return { error: "subsystem_registry_unavailable" };
  }

  const items = registry
    .filter((s) => s && typeof s.id === "string")
    .slice(0, SUBSYSTEM_LIST_CAP)
    .map((s) => ({ name: s.id, category: typeof s.domain === "string" ? s.domain : null }));

  return {
    count: items.length,
    total: registry.length,
    truncated: registry.length > SUBSYSTEM_LIST_CAP,
    subsystems: items,
  };
}

// ─── summarize_subsystem ──────────────────────────────────────────────────────

interface SummarizeSubsystemParams {
  name?: string;
}

/** Cap an array-ish field to N entries of strings. */
function capStrings(value: unknown, cap: number): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v) => typeof v === "string").slice(0, cap) as string[];
}

async function summarizeSubsystem(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as SummarizeSubsystemParams;
  if (!p.name || typeof p.name !== "string" || p.name.trim() === "") {
    throw new Error("params.name is required");
  }

  const registry = loadSubsystemRegistry();
  if (!registry) {
    return { error: "subsystem_registry_unavailable" };
  }

  const want = p.name.toLowerCase().trim().replace(/[\s-]+/g, "_");
  let entry =
    registry.find((s) => typeof s.id === "string" && s.id.toLowerCase() === want) ?? null;
  if (!entry) {
    entry =
      registry.find(
        (s) =>
          typeof s.id === "string" &&
          (s.id.toLowerCase().includes(want) || want.includes(s.id.toLowerCase())),
      ) ?? null;
  }

  if (!entry) {
    return { error: "unknown_subsystem", requested: p.name };
  }

  return {
    name: entry.id,
    domain: typeof entry.domain === "string" ? entry.domain : null,
    description: typeof entry.automation_scope === "string" ? entry.automation_scope : null,
    criticality: typeof entry.criticality === "string" ? entry.criticality : null,
    routes: capStrings(entry.routes, 20),
    database_tables: capStrings(entry.database_tables, 30),
    audit_actions: capStrings(entry.audit_actions, 30),
  };
}

// ─── read_strategy_internals ──────────────────────────────────────────────────

interface ReadStrategyInternalsParams {
  strategyId?: string;
  name?: string;
}

async function readStrategyInternals(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as ReadStrategyInternalsParams;
  if (!p.strategyId && !p.name) {
    throw new Error("params.strategyId or params.name is required");
  }

  const rows = p.strategyId
    ? await db.select().from(strategies).where(eq(strategies.id, p.strategyId)).limit(1)
    : await db.select().from(strategies).where(eq(strategies.name, p.name!)).limit(1);

  if (!rows[0]) throw new Error("strategy_not_found");
  const s = rows[0];

  const cfg = (s.config ?? {}) as Record<string, unknown>;

  return {
    id: s.id,
    name: s.name,
    lifecycleState: s.lifecycleState,
    symbols: Array.isArray(s.symbols) ? s.symbols : [s.symbol],
    entry_quality: cfg["entry_quality"] ?? null,
    position_size: cfg["position_size"] ?? null,
    stop_loss: cfg["stop_loss"] ?? null,
    take_profit: cfg["take_profit"] ?? null,
    exit_plan_config: cfg["exit_plan_config"] ?? s.exitPlanConfig ?? null,
    use_weighted_scoring:
      typeof cfg["use_weighted_scoring"] === "boolean"
        ? cfg["use_weighted_scoring"]
        : (s.useWeightedScoring ?? false),
  };
}

// ─── trace_correlation ────────────────────────────────────────────────────────

interface TraceCorrelationParams {
  correlationId?: string;
}

const TRACE_EVENT_CAP = 50;

async function traceCorrelation(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as TraceCorrelationParams;
  if (!p.correlationId || typeof p.correlationId !== "string" || p.correlationId.trim() === "") {
    throw new Error("params.correlationId is required");
  }

  const rows = await db
    .select({
      action: auditLog.action,
      status: auditLog.status,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.correlationId, p.correlationId))
    .orderBy(asc(auditLog.createdAt))
    .limit(TRACE_EVENT_CAP);

  return {
    correlationId: p.correlationId,
    count: rows.length,
    events: rows.map((r) => ({
      action: r.action,
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
  };
}

// ─── read_recent_decisions ────────────────────────────────────────────────────

interface ReadRecentDecisionsParams {
  limit?: number;
}

async function readRecentDecisions(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as ReadRecentDecisionsParams;
  const limit = Math.min(Math.max(Number(p.limit) || 15, 1), 50);

  const rows = await db
    .select({
      strategyName: strategies.name,
      strategyId: lifecycleTransitions.strategyId,
      fromState: lifecycleTransitions.fromState,
      toState: lifecycleTransitions.toState,
      createdAt: lifecycleTransitions.createdAt,
    })
    .from(lifecycleTransitions)
    .leftJoin(strategies, eq(lifecycleTransitions.strategyId, strategies.id))
    .orderBy(desc(lifecycleTransitions.createdAt))
    .limit(limit);

  return {
    count: rows.length,
    decisions: rows.map((r) => ({
      strategy: r.strategyName ?? r.strategyId ?? "(unknown)",
      fromState: r.fromState,
      toState: r.toState,
      at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
  };
}

// ─── read_system_map ──────────────────────────────────────────────────────────

interface ReadSystemMapParams {
  section?: string;
}

const SYSTEM_MAP_REL = "Trading Forge System Map v2.md";
const SECTION_CHAR_CAP = 3500;

interface MapHeading {
  level: number; // number of leading '#'
  title: string;
  line: number; // 0-based line index
}

/** Parse all ## / ### headings from the markdown text. */
function parseHeadings(lines: string[]): MapHeading[] {
  const out: MapHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{2,3})\s+(.*\S)\s*$/.exec(lines[i]!);
    if (m) out.push({ level: m[1]!.length, title: m[2]!.trim(), line: i });
  }
  return out;
}

async function readSystemMap(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as ReadSystemMapParams;

  let lines: string[];
  try {
    const file = resolveRepoFile(SYSTEM_MAP_REL);
    if (!file) return { error: "system_map_unavailable" };
    lines = readFileSync(file, "utf8").split(/\r?\n/);
  } catch (err) {
    logger.warn({ err }, "carter-introspect.read_system_map: read failed");
    return { error: "system_map_unavailable" };
  }

  const headings = parseHeadings(lines);

  // No section → return the available heading list (bounded).
  if (!p.section || typeof p.section !== "string" || p.section.trim() === "") {
    return {
      headings: headings.slice(0, 200).map((h) => h.title),
      count: Math.min(headings.length, 200),
      total: headings.length,
    };
  }

  // Best-matching heading: exact (case-insensitive) first, then substring.
  const want = p.section.toLowerCase().trim();
  let idx = headings.findIndex((h) => h.title.toLowerCase() === want);
  if (idx === -1) idx = headings.findIndex((h) => h.title.toLowerCase().includes(want));
  if (idx === -1) {
    return {
      error: "section_not_found",
      requested: p.section,
      headings: headings.slice(0, 200).map((h) => h.title),
    };
  }

  const start = headings[idx]!;
  // Section ends at the next heading of same-or-higher level (lower/equal '#' count).
  let endLine = lines.length;
  for (let j = idx + 1; j < headings.length; j++) {
    if (headings[j]!.level <= start.level) {
      endLine = headings[j]!.line;
      break;
    }
  }

  let text = lines.slice(start.line, endLine).join("\n").trim();
  let truncated = false;
  if (text.length > SECTION_CHAR_CAP) {
    text = text.slice(0, SECTION_CHAR_CAP);
    truncated = true;
  }

  return {
    section: start.title,
    level: start.level,
    text,
    truncated,
  };
}

// ─── CARTER_INTROSPECT_HANDLERS ───────────────────────────────────────────────

/**
 * Map of handler keys → introspection handler functions.
 * Keys MUST match CarterTool.handler values in tool-registry.ts.
 * Spread into CARTER_READ_HANDLERS by carter-reads.ts.
 */
export const CARTER_INTROSPECT_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  explain_gate: explainGate,
  list_subsystems: listSubsystems,
  summarize_subsystem: summarizeSubsystem,
  read_strategy_internals: readStrategyInternals,
  trace_correlation: traceCorrelation,
  read_recent_decisions: readRecentDecisions,
  read_system_map: readSystemMap,
};

// Exported for direct unit testing.
export const __test = { GATE_CATALOG, normalizeGateName, parseHeadings, loadSubsystemRegistry };
