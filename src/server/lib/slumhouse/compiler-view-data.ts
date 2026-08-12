export type CompilerViewState = "uncompiled" | "compiled" | "refused" | "stale" | "unavailable";
export type CompilerChamberKey = "context" | "setup" | "entry" | "stop" | "exit" | "sizing" | "filters";
export type CompilerChamberState = "verified" | "inferred" | "refused" | "unbound";
export type CompilerRuleOrigin = "explicit" | "derived" | "compiler_generated" | "unknown";

export interface CompilerRuleView {
  id: string;
  label: string;
  type: string;
  role: string | null;
  origin: CompilerRuleOrigin;
  evidence: string | null;
  span: { start: number; end: number } | null;
  expression: string | null;
}

export interface CompilerChamberView {
  key: CompilerChamberKey;
  label: string;
  state: CompilerChamberState;
  rules: CompilerRuleView[];
}

export interface CompilerBindingView {
  compiled: boolean;
  approximationUsed: boolean;
  spineBound: number;
  spineTotal: number;
  triggerBound: boolean;
  queueReasons: string[];
}

export interface CompilerViewReceipt {
  state: CompilerViewState;
  receiptHash: string | null;
  graphHash: string | null;
  direction: string | null;
  binding: CompilerBindingView | null;
  chambers: CompilerChamberView[];
}

export interface CompilerStrategyIdentity {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  lifecycleState: string;
}

const CHAMBERS: ReadonlyArray<{ key: CompilerChamberKey; label: string }> = [
  { key: "context", label: "Context" },
  { key: "setup", label: "Setup" },
  { key: "entry", label: "Entry" },
  { key: "stop", label: "Stop" },
  { key: "exit", label: "Exit" },
  { key: "sizing", label: "Sizing" },
  { key: "filters", label: "Filters" },
];

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function originOf(condition: Record<string, unknown>): CompilerRuleOrigin {
  const provenance = record(condition.provenance);
  const origin = text(provenance?.origin);
  if (origin === "compiler_generated") return "compiler_generated";
  if (origin === "derived" || origin === "inferred") return "derived";
  if (origin === "explicit" || origin === "extracted") return "explicit";
  if (text(condition.evidence) || record(condition.span)) return "explicit";
  return "unknown";
}

function stableExpression(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function conditionRule(condition: Record<string, unknown>, index: number): CompilerRuleView | null {
  const type = text(condition.type);
  const label = text(condition.object);
  if (!type || !label) return null;
  const rawSpan = record(condition.span);
  const start = finiteNumber(rawSpan?.start);
  const end = finiteNumber(rawSpan?.end);
  return {
    id: text(condition.id) ?? `${type}:${index}`,
    label,
    type,
    role: text(condition.role),
    origin: originOf(condition),
    evidence: text(condition.evidence),
    span: start != null && end != null ? { start, end } : null,
    expression: text(condition.expression),
  };
}

function configRule(id: string, label: string, value: unknown, origin: CompilerRuleOrigin): CompilerRuleView | null {
  const expression = stableExpression(value);
  if (!expression) return null;
  return {
    id,
    label,
    type: "CONFIG",
    role: null,
    origin,
    evidence: null,
    span: null,
    expression,
  };
}

function chamberForType(type: string): CompilerChamberKey | null {
  if (type === "WAIT_SESSION") return "context";
  if (type === "WAIT_STRUCTURE") return "setup";
  if (type === "ENABLE_ENTRY" || type === "WAIT_CONFIRMATION") return "entry";
  if (type === "FILTER" || type === "INVALIDATION") return "filters";
  return null;
}

function bindingFrom(value: unknown): CompilerBindingView | null {
  const source = record(value);
  if (!source || typeof source.compiled !== "boolean") return null;
  return {
    compiled: source.compiled,
    approximationUsed: Boolean(source.approximation_used),
    spineBound: finiteNumber(source.spine_bound) ?? 0,
    spineTotal: finiteNumber(source.spine_total) ?? 0,
    triggerBound: Boolean(source.trigger_bound),
    queueReasons: Array.isArray(source.queue_reasons)
      ? source.queue_reasons.map(text).filter((item): item is string => item != null)
      : [],
  };
}

export function buildCompilerViewReceipt(
  _strategy: CompilerStrategyIdentity,
  rawConfig: unknown,
): CompilerViewReceipt {
  const config = record(rawConfig);
  const compiledSpec = record(config?.compiled_spec);
  const spec = record(compiledSpec?.spec);
  const binding = bindingFrom(compiledSpec?.binding_plan_summary);
  const state: CompilerViewState = !compiledSpec || !spec
    ? "uncompiled"
    : binding?.compiled === false ? "refused" : "compiled";
  const chamberRules = new Map<CompilerChamberKey, CompilerRuleView[]>();
  CHAMBERS.forEach(({ key }) => chamberRules.set(key, []));

  if (spec && Array.isArray(spec.entry_conditions)) {
    spec.entry_conditions.forEach((rawCondition, index) => {
      const condition = record(rawCondition);
      if (!condition) return;
      const rule = conditionRule(condition, index);
      if (!rule) return;
      const key = chamberForType(rule.type);
      if (key) chamberRules.get(key)?.push(rule);
    });
  }

  if (spec && Array.isArray(spec.invalidations)) {
    spec.invalidations.forEach((rawCondition, index) => {
      const condition = record(rawCondition);
      if (!condition) return;
      const rule = conditionRule({ ...condition, type: text(condition.type) ?? "INVALIDATION" }, index);
      if (rule) chamberRules.get("filters")?.push(rule);
    });
  }

  const stopRule = configRule("config:stop_loss", "Managed stop", config?.stop_loss, "compiler_generated");
  if (stopRule) chamberRules.get("stop")?.push(stopRule);
  const exitTypeRule = configRule("config:exit_type", "Exit type", config?.exit_type, "compiler_generated");
  const exitParamsRule = configRule("config:exit_params", "Exit parameters", config?.exit_params, "compiler_generated");
  if (exitTypeRule) chamberRules.get("exit")?.push(exitTypeRule);
  if (exitParamsRule) chamberRules.get("exit")?.push(exitParamsRule);
  const sizingRule = configRule("config:position_size", "Position sizing", config?.position_size, "compiler_generated");
  if (sizingRule) chamberRules.get("sizing")?.push(sizingRule);

  const chambers = CHAMBERS.map(({ key, label }): CompilerChamberView => {
    const rules = state === "uncompiled" ? [] : chamberRules.get(key) ?? [];
    const hasInferred = rules.some((rule) => rule.origin === "derived" || rule.origin === "compiler_generated");
    return {
      key,
      label,
      state: rules.length === 0
        ? "unbound"
        : state === "refused" ? "refused" : hasInferred ? "inferred" : "verified",
      rules,
    };
  });

  return {
    state,
    receiptHash: text(compiledSpec?.spec_hash),
    graphHash: text(compiledSpec?.graph_canonical_hash),
    direction: text(spec?.direction),
    binding,
    chambers,
  };
}
