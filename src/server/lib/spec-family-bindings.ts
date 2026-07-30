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
 * If you change FAMILY_META, MIN_SPINE_BOUND_RATIO, SESSION_KEYWORDS or
 * REFUSED_SESSION_KEYWORDS here, you MUST change
 * src/engine/spec_family_bindings.py in the SAME commit — the parity test
 * compares the WHOLE emitted plan (bidirectional key-set equality included) and
 * will fail otherwise.
 *
 * ★ WHAT THE PARITY TEST DOES AND DOES NOT PROVE: it proves the two lanes AGREE.
 *   It cannot prove either is RIGHT — two identically-wrong lanes compare equal.
 *   Correctness is asserted separately against a desk-frozen oracle authority
 *   (docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md), which is derived
 *   from an occupancy probe and semantic propositions rather than from either
 *   lane's tables. Do not treat a green parity run as a correctness result.
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

// ─── Session keyword table — BINDABLE zones only.
//
// Mirrors src/engine/spec_family_bindings.py::SESSION_KEYWORDS. The previous
// caption on this line claimed the mirror was exact while this table still held
// `lunch_blackout` and `overnight` — it asserted the opposite of what the code
// did. It was false from the moment the Python side moved those two zones to
// REFUSED_SESSION_KEYWORDS and is corrected here rather than reworded.
//
// ★★★ WHAT IS MIRRORED, AND WHAT DELIBERATELY IS NOT:
//   - MIRRORED: spec_family_bindings.py::SESSION_KEYWORDS (these 5 zones) and
//     ::REFUSED_SESSION_KEYWORDS (the 2 below). Change either here and you must
//     change it there in the SAME commit — check-spec-binding-plan-parity.ts
//     compares the whole emitted plan and will fail otherwise.
//   - NOT MIRRORED, ON PURPOSE: session_windows.SESSION_KEYWORDS still lists
//     `lunch_blackout` and `overnight` in its own lookup. That divergence is the
//     FIX, not drift — do not "resync" against that file. See the Python
//     module's identical note (spec_family_bindings.py:271-284).
//
// ★ Parity here is SEMANTIC OUTPUT parity, never table-text equality: what must
//   agree is the emitted binding plan, not the shape of these literals.
export const SESSION_KEYWORDS: Record<string, string[]> = {
  london: ["london session", "london open", "london killzone"],
  ny_am: ["ny am", "new york am", "new york morning", "ny morning", "ny open", "am session"],
  ny_pm: ["ny pm", "new york pm", "new york afternoon", "ny afternoon", "pm session"],
  silver_bullet: ["silver bullet"],
  macro_window: ["macro window", "macro release"],
};

// ─── Orphan zones: RECOGNIZED vocabulary with NO evaluable window ───────────
//
// Mirror src/engine/spec_family_bindings.py::REFUSED_SESSION_KEYWORDS.
//
// These two zones were in SESSION_KEYWORDS above until the orphan-zone closure.
// They are recognized English, but `session_windows._ZONE_CHECKS` has no entry
// for either, so `is_in_killzone()` returns False for EVERY minute of the day
// (measured: 0 of 1440, against 180 of 1440 for `ny_am`). Binding them produced
// a rule that said "only trade during X" and executed as "never trade" — while
// reporting `approximation=false`, an exactness claim.
//
// They are REFUSED, not silently dropped: the reason names the zone, so this
// stays distinguishable from "we never recognized it at all" in every
// downstream ledger. That distinction IS the finding — see
// sessionRefusalReason.
//
// ★ The refusal is UNCONDITIONAL — there is no flag, and none may be added. A
//   phrase naming a zone this engine has no evaluable window for has no honest
//   binding in any flag state, so an OFF branch could only restore the defect.
//   Rollback is `git revert` of the whole commit.
export const REFUSED_SESSION_KEYWORDS: Record<string, string[]> = {
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

/**
 * The one phrase matcher for BOTH the bind table and the refusal table.
 *
 * Mirrors spec_family_bindings.py::_session_phrase_hit, including its reason for
 * existing: a refusal table that matched differently from the bind table would
 * leave phrases that are neither bound nor refused — the silent gap this change
 * exists to close. Extracted here behaviour-identically to the expression it
 * replaces (previously inlined in resolveSessionKeyword) so the two lookups
 * cannot drift apart in THIS lane either.
 */
function sessionPhraseHit(objectText: string, keywords: string[]): boolean {
  const norm = ` ${objectText.trim().toLowerCase()} `;
  const trimmed = norm.trim();
  return keywords.some((kw) => norm.includes(` ${kw} `) || trimmed.startsWith(kw) || trimmed.endsWith(kw));
}

export function resolveSessionKeyword(objectText: string | null | undefined): string | null {
  if (!objectText) return null;
  for (const [zone, keywords] of Object.entries(SESSION_KEYWORDS)) {
    if (sessionPhraseHit(objectText, keywords)) return zone;
  }
  return null;
}

/**
 * The `reason` a refused session phrase carries.
 *
 * Mirrors spec_family_bindings.py::session_refusal_reason. Distinct from
 * `no_recognized_session_keyword` (we did not recognize it at all) — this one
 * says "recognized, and DELIBERATELY not bound, because the zone it names has no
 * window `is_in_killzone` can evaluate."
 *
 * ★ Carry this distinction verbatim: it is what lets a downstream ledger tell a
 *   VOCABULARY gap ("teach the extractor this phrase") from an ENGINE gap
 *   ("build a clock for this zone"). Collapsing them loses the finding, and the
 *   oracle authority asserts the two reasons must differ (P-4/P-6).
 */
export function sessionRefusalReason(refusedZone: string): string {
  return `session_zone_refused_uncomputable_window:${refusedZone}`;
}

/**
 * Names the zone a phrase WOULD have bound before the orphan-zone closure.
 * Never returns a binding — the return value is only ever a refusal label.
 * Mirrors spec_family_bindings.py::refused_session_zone.
 */
export function refusedSessionZone(objectText: string | null | undefined): string | null {
  if (!objectText) return null;
  for (const [zone, keywords] of Object.entries(REFUSED_SESSION_KEYWORDS)) {
    if (sessionPhraseHit(objectText, keywords)) return zone;
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
    // ─── Orphan-zone refusal, checked BEFORE resolveSessionKeyword — the same
    // order as spec_family_bindings.py:588, so a recognized zone with no
    // evaluable window can never reach a bind.
    //
    // Scoped INSIDE the session-family branch on purpose: the false concrete was
    // only ever produced by the session resolver, so refusing here is exactly as
    // wide as the defect. A refusal in the generic dispatch would also reject
    // e.g. a FILTER whose object merely mentions "lunch" — an over-refusal the
    // discriminator fixtures exist to catch.
    //
    // ★ approximation=true, never false. An exactness claim is precisely what
    //   the defect wore. The trio bindable=false + primitive=null +
    //   approximation=true is what keeps the row OUT of the concrete count;
    //   change any one of the three and the false concrete returns. It is inert
    //   for aggregates: approximationUsed filters on `bindable && executed`, and
    //   this row is neither.
    const refused = refusedSessionZone(object);
    if (refused !== null) {
      return {
        conditionId,
        type,
        role,
        object,
        bindable: false,
        primitive: null,
        approximation: true,
        executed: false,
        reason: sessionRefusalReason(refused),
        sessionZone: null,
      };
    }

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
