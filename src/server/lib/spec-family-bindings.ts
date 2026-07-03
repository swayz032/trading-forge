/**
 * spec-family-bindings.ts — Band C (spec-execution-semantics, 2026-07-02)
 *
 * TS MIRROR of src/engine/spec_family_bindings.py — Ledger E parity contract
 * (same convention as firm-rules-version.ts / firm_rules_version.py). Both
 * sides implement the SAME pure condition-family -> primitive binding-plan
 * logic so a spec's binding plan is identical regardless of which side
 * computes it. Parity is enforced by
 * scripts/check-spec-binding-plan-parity.ts (mirrors
 * scripts/wave26-ts-python-exit-parity.ts's spawn-and-diff pattern).
 *
 * PURITY CONTRACT: zero I/O, zero DB reads, zero DataFrame access — pure
 * string/dict logic over a spec's condition list. This is what makes it safe
 * to call directly from spec-onboarding-service.ts at onboarding time (no
 * Python subprocess needed to decide "does this spec clear the condition-
 * compiler coverage threshold").
 *
 * If you change FAMILY_META, MIN_SPINE_BOUND_RATIO, or SESSION_KEYWORDS here,
 * you MUST change src/engine/spec_family_bindings.py in the SAME commit —
 * the parity test will fail otherwise.
 */

export interface SpecConditionLike {
  id?: string | null;
  type?: string | null;
  object?: string | null;
  role?: string | null;
}

export interface ConditionBinding {
  conditionId: string;
  type: string;
  role: string;
  object: string;
  bindable: boolean;
  primitive: string | null;
  approximation: boolean;
  executed: boolean;
  reason: string | null;
  sessionZone: string | null;
}

export interface QueueReason {
  condition_id: string;
  type: string;
  object: string;
  reason: string;
}

export interface BindingPlan {
  bindings: ConditionBinding[];
  invalidationBindings: ConditionBinding[];
  triggerConditionId: string;
  triggerBound: boolean;
  spineTotal: number;
  spineBound: number;
  confluenceTotal: number;
  confluenceBound: number;
  approximationUsed: boolean;
  compiled: boolean;
  queueReasons: QueueReason[];
}

// ─── Session keyword table — mirror src/engine/spec_family_bindings.py::SESSION_KEYWORDS EXACTLY ──
export const SESSION_KEYWORDS: Record<string, string[]> = {
  london: ["london session", "london open", "london killzone"],
  ny_am: ["ny am", "new york am", "new york morning", "ny morning", "ny open", "am session"],
  ny_pm: ["ny pm", "new york pm", "new york afternoon", "ny afternoon", "pm session"],
  silver_bullet: ["silver bullet"],
  macro_window: ["macro window", "macro release"],
  lunch_blackout: ["lunch", "midday", "noon session"],
  overnight: ["overnight", "globex", "asia session", "pre market", "premarket"],
};

export const MIN_SPINE_BOUND_RATIO = 0.5;

interface FamilyMeta {
  primitive: string | null;
  requiresSessionKeyword?: boolean;
  baseApproximation?: boolean;
  unsupported?: boolean;
  unboundReason?: string | null;
  executed?: boolean;
}

// ─── Mirror src/engine/spec_family_bindings.py::FAMILY_META EXACTLY ────────
export const FAMILY_META: Record<string, FamilyMeta> = {
  WAIT_SESSION: {
    primitive: "session_windows",
    requiresSessionKeyword: true,
    baseApproximation: false,
    unboundReason: "no_recognized_session_keyword",
  },
  WAIT_STRUCTURE: { primitive: "structure_engine.compute_structure_state", baseApproximation: true },
  VERIFY_STRUCTURE: { primitive: "structure_engine.compute_structure_state", baseApproximation: true },
  WAIT_BIAS: { primitive: "bias_engine.classify_institutional_regime", baseApproximation: true },
  CONFIRM_DIRECTION: { primitive: "bias_engine.classify_institutional_regime", baseApproximation: true },
  WAIT_RETEST: { primitive: "spec_condition_compiler.retest_touch_check", baseApproximation: true },
  FILTER: { primitive: "entry_quality.confluence_factor_presence", baseApproximation: true },
  WAIT_CONFIRMATION: { primitive: "spec_condition_compiler.candle_confirmation_check", baseApproximation: true },
  INVALIDATE: { primitive: "structural_stops.compute_structural_stop", baseApproximation: false },
  ENABLE_ENTRY: { primitive: "spine_completion_trigger", baseApproximation: false },
  ENTER: { primitive: "spine_completion_trigger", baseApproximation: false },
  EXIT_HINT: { primitive: "provenance_only", baseApproximation: false, executed: false },
  RESET: { primitive: null, unsupported: true, unboundReason: "control_flow_reset_unsupported" },
  EXCEPTION: { primitive: null, unsupported: true, unboundReason: "control_flow_exception_unsupported" },
};

export function resolveSessionKeyword(objectText: string | null | undefined): string | null {
  if (!objectText) return null;
  const norm = ` ${objectText.trim().toLowerCase()} `;
  for (const [zone, keywords] of Object.entries(SESSION_KEYWORDS)) {
    for (const kw of keywords) {
      if (norm.includes(` ${kw} `) || norm.trim().startsWith(kw) || norm.trim().endsWith(kw)) {
        return zone;
      }
    }
  }
  return null;
}

export function bindCondition(condition: SpecConditionLike): ConditionBinding {
  const conditionId = String(condition.id ?? "");
  const type = String(condition.type ?? "");
  const role = String(condition.role ?? "");
  const object = String(condition.object ?? "");

  const meta = FAMILY_META[type];
  if (!meta) {
    return {
      conditionId,
      type,
      role,
      object,
      bindable: false,
      primitive: null,
      approximation: false,
      executed: false,
      reason: "unknown_condition_type",
      sessionZone: null,
    };
  }

  if (meta.unsupported) {
    return {
      conditionId,
      type,
      role,
      object,
      bindable: false,
      primitive: null,
      approximation: false,
      executed: false,
      reason: meta.unboundReason ?? null,
      sessionZone: null,
    };
  }

  if (meta.requiresSessionKeyword) {
    const zone = resolveSessionKeyword(object);
    if (zone === null) {
      return {
        conditionId,
        type,
        role,
        object,
        bindable: false,
        primitive: null,
        approximation: false,
        executed: false,
        reason: meta.unboundReason ?? null,
        sessionZone: null,
      };
    }
    return {
      conditionId,
      type,
      role,
      object,
      bindable: true,
      primitive: meta.primitive,
      approximation: meta.baseApproximation ?? false,
      executed: meta.executed ?? true,
      reason: null,
      sessionZone: zone,
    };
  }

  return {
    conditionId,
    type,
    role,
    object,
    bindable: true,
    primitive: meta.primitive,
    approximation: meta.baseApproximation ?? false,
    executed: meta.executed ?? true,
    reason: null,
    sessionZone: null,
  };
}

export interface SpecArtifactBodyLike {
  entry_conditions?: SpecConditionLike[] | null;
  invalidations?: SpecConditionLike[] | null;
  entry_trigger_id?: string | null;
}

export function compileBindingPlan(spec: SpecArtifactBodyLike): BindingPlan {
  const entryConditions = spec.entry_conditions ?? [];
  const invalidations = spec.invalidations ?? [];
  const triggerId = String(spec.entry_trigger_id ?? "");

  const bindings = entryConditions.map(bindCondition);
  const invalidationBindings = invalidations.map(bindCondition);

  const spine = bindings.filter((b) => b.role === "spine");
  const confluence = bindings.filter((b) => b.role === "confluence");
  const spineBound = spine.filter((b) => b.bindable).length;
  const confluenceBound = confluence.filter((b) => b.bindable).length;

  const triggerBinding = bindings.find((b) => b.conditionId === triggerId) ?? null;
  const triggerBound = Boolean(triggerBinding && triggerBinding.bindable);

  const approximationUsed =
    bindings.some((b) => b.bindable && b.executed && b.approximation) ||
    invalidationBindings.some((b) => b.bindable && b.executed && b.approximation);

  const queueReasons: QueueReason[] = [];
  let compiled = true;

  if (!triggerBound) {
    compiled = false;
    queueReasons.push({
      condition_id: triggerId,
      type: triggerBinding ? triggerBinding.type : "unknown",
      object: triggerBinding ? triggerBinding.object : "",
      reason: triggerBinding ? (triggerBinding.reason ?? "unbindable") : "trigger_condition_not_found",
    });
  }

  // A bare trigger with NO spine (required-sequence) conditions at all is NOT
  // enough to call a spec "condition-compiled" — mirrors
  // spec_family_bindings.py's identical rule (see that file for rationale;
  // this specifically preserves Band B's vwapSpec fixture routing to
  // NEEDS_ARCHETYPE, not a false-positive compile).
  if (spine.length === 0) {
    compiled = false;
    queueReasons.push({
      condition_id: triggerId,
      type: triggerBinding ? triggerBinding.type : "unknown",
      object: "",
      reason: "no_spine_conditions_present",
    });
  }

  const spineRatio = spine.length > 0 ? spineBound / spine.length : 0.0;
  if (spine.length > 0 && spineRatio < MIN_SPINE_BOUND_RATIO) {
    compiled = false;
    for (const b of spine) {
      if (!b.bindable) {
        queueReasons.push({ condition_id: b.conditionId, type: b.type, object: b.object, reason: b.reason ?? "unbindable" });
      }
    }
  }

  if (compiled) {
    for (const b of spine) {
      if (!b.bindable) {
        queueReasons.push({ condition_id: b.conditionId, type: b.type, object: b.object, reason: b.reason ?? "unbindable" });
      }
    }
  }

  return {
    bindings,
    invalidationBindings,
    triggerConditionId: triggerId,
    triggerBound,
    spineTotal: spine.length,
    spineBound,
    confluenceTotal: confluence.length,
    confluenceBound,
    approximationUsed,
    compiled,
    queueReasons,
  };
}
