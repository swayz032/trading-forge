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
// Every key MUST be a zone session_windows._ZONE_CHECKS can evaluate (pin (b2),
// EMIT ⊆ COVERED). `lunch_blackout` / `overnight` were removed by the orphan-zone
// closure (docs/designs/packet-orphan-zone-closure-2026-07-21.md) and moved to
// REFUSED_SESSION_KEYWORDS below.
export const SESSION_KEYWORDS: Record<string, string[]> = {
  london: ["london session", "london open", "london killzone"],
  ny_am: ["ny am", "new york am", "new york morning", "ny morning", "ny open", "am session"],
  ny_pm: ["ny pm", "new york pm", "new york afternoon", "ny afternoon", "pm session"],
  silver_bullet: ["silver bullet"],
  macro_window: ["macro window", "macro release"],
};

// ─── REFUSED session vocabulary — mirror
// src/engine/spec_family_bindings.py::REFUSED_SESSION_KEYWORDS EXACTLY ──
// Recognized as session vocabulary, deliberately NOT bound: the zones they name
// have no window `is_in_killzone` can evaluate, so binding them produced an
// always-False gate wearing `approximation: false`. Refused with a named reason
// rather than silently dropped.
export const REFUSED_SESSION_KEYWORDS: Record<string, string[]> = {
  lunch_blackout: ["lunch", "midday", "noon session"],
  overnight: ["overnight", "globex", "asia session", "pre market", "premarket"],
};

export function sessionRefusalReason(refusedZone: string): string {
  return `session_zone_refused_uncomputable_window:${refusedZone}`;
}

export const MIN_SPINE_BOUND_RATIO = 0.5;

interface FamilyMeta {
  primitive: string | null;
  requiresSessionKeyword?: boolean;
  baseApproximation?: boolean;
  unsupported?: boolean;
  unboundReason?: string | null;
  executed?: boolean;
  // ─── FAMILY_META ENFORCEMENT (docs/designs/packet-family-meta-enforced-2026-07-20.md) ───
  // Mirrors the Python side's `enforced_*` column. See the ★ DRIFT DECLARATION below.
  enforcedPrimitive?: string | null;
  enforcedMechanism?: string | null;
  enforcedApproximation?: boolean;
  gates?: boolean;
  productionExecuted?: boolean;
}

// ─── Mirror src/engine/spec_family_bindings.py::FAMILY_META EXACTLY ────────
//
// ★ DRIFT DECLARATION — READ BEFORE TRUSTING THIS TABLE (packet return-checklist item 7).
// The DECLARATIONS below are fully mirrored, including the new enforced column, so the two
// tables do not silently diverge. What is NOT mirrored is the ENFORCEMENT MACHINERY:
// src/engine/family_meta_enforcement.py resolves every declared primitive to a real symbol at
// load, proves dispatch derives from this table in both directions, and checks EMIT ⊆ COVERED.
// This TypeScript module implements NONE of that — it is a pure declaration/binding mirror with
// no executable primitives to resolve, so there is nothing here for pins (a)/(b) to check.
//
//   DECLARED DRIFT:  runtime enforcement, TS side — NOT IMPLEMENTED.
//   NAMED OWNER:     the Band-B/TS parity lane (same owner as
//                    src/server/lib/__tests__/spec-family-bindings.test.ts).
//   CONSEQUENCE IF LEFT:  a future edit that makes a Python declaration fail load would be
//                    accepted silently on the TS side. The mitigation available today is that
//                    the declarations are identical, so the divergence cannot start here.
//
// The `enforced*` fields are DATA ONLY on this side: bindCondition() below still reads
// `primitive` / `baseApproximation`, exactly matching the Python flag-OFF path, which is the
// default. If TF_FAMILY_META_ENFORCED is ever defaulted ON in Python (a separate commit, per
// the two-commit law), bindCondition() here MUST be switched to the enforced column in that
// same commit or this mirror becomes wrong rather than merely incomplete.
export const FAMILY_META: Record<string, FamilyMeta> = {
  WAIT_SESSION: {
    primitive: "session_windows",
    requiresSessionKeyword: true,
    baseApproximation: false,
    unboundReason: "no_recognized_session_keyword",
    enforcedPrimitive: "session_windows.is_in_killzone",
  },
  WAIT_STRUCTURE: { primitive: "structure_engine.compute_structure_state", baseApproximation: true },
  VERIFY_STRUCTURE: { primitive: "structure_engine.compute_structure_state", baseApproximation: true },
  // Declared bias_engine.classify_institutional_regime; MEASURED 0 calls to it on 2000 real ES
  // 5min bars. The EMA-slope directional proxy is what runs, and now what is declared.
  WAIT_BIAS: {
    primitive: "bias_engine.classify_institutional_regime",
    baseApproximation: true,
    enforcedPrimitive: "spec_condition_compiler.wait_bias_directional_proxy",
  },
  CONFIRM_DIRECTION: {
    primitive: "bias_engine.classify_institutional_regime",
    baseApproximation: true,
    enforcedPrimitive: "spec_condition_compiler.wait_bias_directional_proxy",
  },
  WAIT_RETEST: { primitive: "spec_condition_compiler.retest_touch_check", baseApproximation: true },
  // *** entry_quality.confluence_factor_presence NAMES A MODULE THAT DOES NOT EXIST. *** The
  // Python engine silently substituted constant True for 390 corpus conditions with role=spine.
  // No such module was written to make the pointer pass — that would be a fabricated
  // implementation, strictly worse, because it would probe clean. The honest entry declares the
  // substitution: a non-gating constant-True mechanism.
  FILTER: {
    primitive: "entry_quality.confluence_factor_presence",
    baseApproximation: true,
    enforcedPrimitive: null,
    enforcedMechanism: "static_true_pass_through",
    enforcedApproximation: true,
    gates: false,
  },
  WAIT_CONFIRMATION: { primitive: "spec_condition_compiler.candle_confirmation_check", baseApproximation: true },
  // The sole approximation=false among executed families, and its primitive is never called in
  // production (0 calls / 495 firing bars; 492 under trace, all four signal columns identical).
  INVALIDATE: {
    primitive: "structural_stops.compute_structural_stop",
    baseApproximation: false,
    enforcedApproximation: true,
    gates: false,
    productionExecuted: false,
  },
  // `spine_completion_trigger` was never a code symbol. The real mechanism is the spine
  // conjunction; these trigger-role conditions are never evaluated as conditions at all.
  ENABLE_ENTRY: {
    primitive: "spine_completion_trigger",
    baseApproximation: false,
    enforcedPrimitive: null,
    enforcedMechanism: "spine_conjunction_trigger",
    enforcedApproximation: true,
    gates: false,
  },
  ENTER: {
    primitive: "spine_completion_trigger",
    baseApproximation: false,
    enforcedPrimitive: null,
    enforcedMechanism: "spine_conjunction_trigger",
    enforcedApproximation: true,
    gates: false,
  },
  EXIT_HINT: {
    primitive: "provenance_only",
    baseApproximation: false,
    executed: false,
    enforcedPrimitive: null,
    enforcedMechanism: "provenance_only",
    gates: false,
  },
  RESET: { primitive: null, unsupported: true, unboundReason: "control_flow_reset_unsupported" },
  EXCEPTION: { primitive: null, unsupported: true, unboundReason: "control_flow_exception_unsupported" },
};

function phraseHit(objectText: string, keywords: string[]): boolean {
  const norm = ` ${objectText.trim().toLowerCase()} `;
  return keywords.some(
    (kw) => norm.includes(` ${kw} `) || norm.trim().startsWith(kw) || norm.trim().endsWith(kw),
  );
}

export function resolveSessionKeyword(objectText: string | null | undefined): string | null {
  if (!objectText) return null;
  for (const [zone, keywords] of Object.entries(SESSION_KEYWORDS)) {
    if (phraseHit(objectText, keywords)) return zone;
  }
  return null;
}

/** The refused zone a phrase WOULD have bound before the orphan-zone closure, or null. */
export function refusedSessionZone(objectText: string | null | undefined): string | null {
  if (!objectText) return null;
  for (const [zone, keywords] of Object.entries(REFUSED_SESSION_KEYWORDS)) {
    if (phraseHit(objectText, keywords)) return zone;
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
      // Orphan-zone refusal — recognized session vocabulary with no evaluable
      // window. Named reason, never silently dropped. `approximation` is true,
      // never false: the packet forbids an exactness claim on these zones, and
      // the flag is inert here because this row is neither bindable nor executed.
      const refused = refusedSessionZone(object);
      return {
        conditionId,
        type,
        role,
        object,
        bindable: false,
        primitive: null,
        approximation: refused !== null,
        executed: false,
        reason: refused !== null ? sessionRefusalReason(refused) : (meta.unboundReason ?? null),
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
