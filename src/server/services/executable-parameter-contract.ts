/**
 * EXECUTABLE PARAMETER CONTRACT — the dependency LEAF for the parameter boundary.
 * R-690 §5 Lane 19. TYPES AND REFUSAL BEHAVIOUR ONLY.
 *
 * WHY THIS FILE HAS NO IMPORTS AT ALL, AND WHY THAT IS THE POINT
 *   AR-762 measured 10 `db.insert(strategies)` sites. Two of them (the graduator's)
 *   pass through NO guard, and two others hold PRIVATE COPIES of the shared
 *   cross-validation guard rather than importing it. AR-764 then measured WHY the
 *   graduator cannot simply import the shared module: it sits in a real static cycle
 *       agent-service -> backtest-service -> paper-trading-stream -> index.ts
 *       -> routes/agent.ts -> direct-bucket-graduator
 *   so any boundary living inside that closure is unreachable from the writer that
 *   most needs it. A boundary every writer can import must import NOTHING itself.
 *
 *   *** THIS MODULE MUST NEVER IMPORT ANYTHING. *** Not the db, not the logger, not
 *   a sibling service, not a type from one. The import-closure guard in
 *   executable-parameter-contract.test.ts enforces that mechanically, because
 *   R-690 §3 measured that this repository holds three stated-but-unenforced
 *   architectural rules and has violated all three. A stated rule is a wish.
 *
 * WHAT IT REFUSES, AND WHY REFUSAL IS THE WHOLE FEATURE
 *   AR-753 measured a taught 20/200 being DROPPED and replaced with the midpoint of a
 *   validator's allowed range — a number from no lesson, no defaults table and no
 *   human decision. R-682 §5 (operator-adopted) forbids exactly that:
 *     NO HARDCODED VALUE, MIDPOINT, OPTIMIZER VALUE, RANGE DEFAULT OR ENGINE DEFAULT
 *     MAY SUBSTITUTE FOR A MISSING TEACHER VALUE.
 *   So this contract has no fill path of any kind. When a required parameter is
 *   absent it BLOCKS. When two source values disagree it BLOCKS. It never clamps,
 *   never defaults, never rounds toward a range. Callers get parameters or a reason.
 *
 * WHAT IT IS NOT
 *   Not a parser (AR-752 measured two numeric parsers already; a third is the defect,
 *   not the fix). Not a persistence gateway — R-690 §5 forbids building that here.
 *   Not wired to any production caller in this commit.
 */

/** Where a parameter value came from. Ordered strongest to weakest. */
export type ParameterProvenance =
  | "exact_source"                    // the lesson stated this value
  | "validated_structured_extraction" // an extraction the validator accepted
  | "inferred"                        // derived, NOT taught — may never win over the above
  | "none";                           // no provenance: not a source value at all

/**
 * Refusal codes. R-686 §3 fixed this vocabulary and its narrowing applies:
 * `unresolved_source_ambiguity` means "the source is ambiguous about WHICH parameter
 * this value binds to" — NOT "two values disagree", which is
 * `conflicting_source_parameters`. The campaign-level research verdict of the same
 * name is a different layer and the two must never be conflated again.
 */
export type ParameterBlockCode =
  | "missing_source_parameter"
  | "conflicting_source_parameters"
  | "unknown_parameter_key"
  | "unresolved_source_ambiguity"
  | "source_parameter_not_exact";

/**
 * What the UPSTREAM extraction concluded about this value.
 *
 * R-691 §3 adopted this as the way to give `unresolved_source_ambiguity` a reachable
 * path. AR-766 flagged that code as DECLARED-BUT-UNREACHABLE, and the fork was
 * "build an ambiguity detector or delete the code". Both were wrong: ambiguity is a
 * property of the SOURCE, and a leaf that must import nothing can never read a source.
 * So the upstream decides and DECLARES it here, and this module refuses on the
 * declaration. That keeps out-degree at 0 while making the code live.
 *
 * `ambiguous` is narrowed exactly as R-690 §4 narrowed it: the lesson does not make
 * clear WHICH parameter this value binds to. It is NOT "two values disagree" (that is
 * `conflicting_source_parameters`), and it is NOT the campaign-level research verdict
 * of the same name — R-684 §7.2 keeps those at different layers and they collided once.
 */
export type UpstreamParameterStatus =
  | "exact"      // the lesson stated this value for this key
  | "ambiguous"  // the lesson states a value but not which parameter it binds to
  | "missing"    // the upstream looked and the lesson does not supply it
  | "inferred"   // derived from context, not taught
  | "generated"; // produced by search/optimization — never a source value

/**
 * WHAT THE CALLER IS ASKING FOR. There is no default: a caller must say which.
 *
 * R-691 §3: the shipped positive control "an inferred value IS accepted when nothing
 * stronger exists" is correct for RESEARCH and wrong for a FIDELITY CERTIFICATE, and
 * nothing in the contract distinguished them. It does now.
 *
 * This parameter is REQUIRED rather than defaulted on purpose. A defaulted mode is a
 * policy decision made by whoever forgot to pass an argument — and the two modes
 * differ precisely on what may be certified as faithful to a teacher.
 */
export type ContractMode =
  | "source_fidelity"    // every required value must be EXACT. Anything softer refuses.
  | "research_candidate"; // inferred/generated may resolve, and the result is marked
                          // ineligible for fidelity certification.

export interface SourceParameter {
  readonly key: string;
  readonly value: number;
  readonly provenance: ParameterProvenance;
  /**
   * The upstream's verdict about this value. OPTIONAL, and its absence is not treated
   * as `exact`: when omitted the provenance tier governs, exactly as before this field
   * existed. An omitted status is "the upstream did not say", never "the upstream said
   * it was fine" — inferring the strongest status from silence is the substitution
   * this whole module exists to prevent.
   */
  readonly status?: UpstreamParameterStatus;
  /** Optional verbatim support from the lesson. Never synthesised. */
  readonly evidence?: string;
}

export interface ParameterSpec {
  /** Keys that MUST be present. A missing one blocks; it is never filled. */
  readonly required: readonly string[];
  /** Keys permitted in addition to `required`. Anything else blocks. */
  readonly optional?: readonly string[];
}

export type ContractResult =
  | {
      readonly ok: true;
      readonly parameters: Readonly<Record<string, number>>;
      readonly mode: ContractMode;
      /**
       * The provenance each surviving value actually carried. A value that resolves in
       * `research_candidate` because it was inferred REPORTS `inferred` here — it is
       * never relabelled on the way out. R-691 §5(3) requires a fixture proving the
       * same value cannot silently change provenance between modes; this field is what
       * makes that observable rather than a matter of trust.
       */
      readonly provenanceByKey: Readonly<Record<string, ParameterProvenance>>;
      /**
       * FALSE for every `research_candidate` result, without exception. A research
       * result may be useful, backtested and reported; it may not be presented as
       * faithful to a teacher.
       */
      readonly eligibleForFidelityCertification: boolean;
    }
  | {
      readonly ok: false;
      readonly block: ParameterBlockCode;
      /** The parameter key the refusal is about, so a caller can act on it. */
      readonly key: string;
      readonly detail: string;
      readonly mode: ContractMode;
    };

const PROVENANCE_RANK: Readonly<Record<ParameterProvenance, number>> = {
  exact_source: 3,
  validated_structured_extraction: 2,
  inferred: 1,
  none: 0,
};

/**
 * Resolve source-supplied parameters against a spec, or refuse.
 *
 * Never substitutes, never clamps, never rounds, never defaults. A value that
 * survives comes out identical to the value that went in — that is the property the
 * fixtures assert, and it is the one AR-753 measured missing.
 */
export function resolveExecutableParameters(
  spec: ParameterSpec,
  supplied: readonly SourceParameter[],
  mode: ContractMode,
): ContractResult {
  const allowed = new Set<string>([...spec.required, ...(spec.optional ?? [])]);

  for (const p of supplied) {
    if (!allowed.has(p.key)) {
      return {
        ok: false,
        block: "unknown_parameter_key",
        key: p.key,
        detail: `'${p.key}' is not a parameter of this indicator (allowed: ${[...allowed].join(", ")})`,
        mode,
      };
    }
  }

  // ── UPSTREAM STATUS IS CHECKED BEFORE ANYTHING ELSE, IN BOTH MODES ────────────────
  // An ambiguous or missing DECLARATION is a statement about the source, and no amount
  // of provenance ranking downstream can repair it. Checking it first also means the
  // refusal names the real reason: ranking first would report an ambiguous value as
  // `missing_source_parameter` once it lost its tier, which is a true-sounding wrong
  // answer.
  for (const p of supplied) {
    if (p.status === "ambiguous") {
      return {
        ok: false,
        block: "unresolved_source_ambiguity",
        key: p.key,
        detail: `the source supplies ${p.value} but the upstream could not determine that it binds to '${p.key}'; this contract does not guess an assignment`,
        mode,
      };
    }
    if (p.status === "missing") {
      return {
        ok: false,
        block: "missing_source_parameter",
        key: p.key,
        detail: `the upstream reports '${p.key}' absent from the source — no midpoint, engine default, range default or compiler fallback may stand in for it`,
        mode,
      };
    }
    if (mode === "source_fidelity" && (p.status === "inferred" || p.status === "generated")) {
      return {
        ok: false,
        block: "source_parameter_not_exact",
        key: p.key,
        detail: `'${p.key}' is ${p.status}, not exact. A fidelity certificate may only rest on values the lesson stated; re-run as 'research_candidate' if an unfaithful value is acceptable`,
        mode,
      };
    }
  }

  const byKey = new Map<string, SourceParameter[]>();
  for (const p of supplied) {
    const list = byKey.get(p.key);
    if (list) list.push(p);
    else byKey.set(p.key, [p]);
  }

  const resolved: Record<string, number> = {};
  const provenanceByKey: Record<string, ParameterProvenance> = {};
  for (const [key, values] of byKey) {
    const sourced = values.filter((v) => PROVENANCE_RANK[v.provenance] > PROVENANCE_RANK.none);
    if (sourced.length === 0) {
      return {
        ok: false,
        block: "missing_source_parameter",
        key,
        detail: `'${key}' was supplied with provenance 'none' — a value with no provenance is not a source value, and this contract does not invent one`,
        mode,
      };
    }

    const strongest = Math.max(...sourced.map((v) => PROVENANCE_RANK[v.provenance]));
    const top = sourced.filter((v) => PROVENANCE_RANK[v.provenance] === strongest);
    const distinct = new Set(top.map((v) => v.value));
    if (distinct.size > 1) {
      return {
        ok: false,
        block: "conflicting_source_parameters",
        key,
        detail: `'${key}' has ${distinct.size} disagreeing values at the same provenance tier: ${[...distinct].join(", ")}`,
        mode,
      };
    }
    // An inferred value NEVER overwrites an explicit source value (R-686 §3): the
    // ranking above discards weaker tiers before the disagreement check, so a
    // taught value and a guessed one is not a conflict — the taught one simply wins.
    resolved[key] = top[0].value;
    provenanceByKey[key] = top[0].provenance;
  }

  for (const key of spec.required) {
    if (!(key in resolved)) {
      return {
        ok: false,
        block: "missing_source_parameter",
        key,
        detail: `'${key}' is required and the source did not supply it — no midpoint, engine default, range default or compiler fallback may stand in for it`,
        mode,
      };
    }
  }

  // ── SECOND FIDELITY CHECK, ON PROVENANCE RATHER THAN DECLARED STATUS ──────────────
  // The status loop above catches values whose upstream ADMITTED they were inferred.
  // This catches values that carried provenance `inferred` while declaring no status
  // at all. Both are "not exact"; only one of them announced itself, and a certificate
  // that rests on the announcement alone rests on the caller's honesty.
  if (mode === "source_fidelity") {
    for (const key of spec.required) {
      if (provenanceByKey[key] === "inferred") {
        return {
          ok: false,
          block: "source_parameter_not_exact",
          key,
          detail: `'${key}' resolved from an inferred value. A fidelity certificate may only rest on values the lesson stated`,
          mode,
        };
      }
    }
  }

  return {
    ok: true,
    parameters: resolved,
    mode,
    provenanceByKey,
    // Research results are NEVER eligible, regardless of how strong the individual
    // values turned out to be. The mode is the caller's declaration of what the result
    // is FOR, and a result produced under research rules does not become a fidelity
    // certificate because its inputs happened to be clean.
    eligibleForFidelityCertification: mode === "source_fidelity",
  };
}

/**
 * Report whether a resolved value sits outside an advisory range WITHOUT changing it.
 *
 * Deliberately returns a flag instead of a clamped number. AR-753 measured
 * `clampToRange` silently moving a taught value to a range boundary with only a
 * warning string; a taught value that is "out of range" is a finding about the range
 * or about the lesson, and it is never this contract's business to edit it.
 */
export function isOutsideAdvisoryRange(
  value: number,
  range: readonly [number, number],
): boolean {
  return value < range[0] || value > range[1];
}
