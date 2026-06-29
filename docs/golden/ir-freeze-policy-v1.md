# IR Freeze Policy — v1.0 (governance, not a feature)

> **Purpose (GPT/operator, 2026-06-28):** prevent replay results from unintentionally biasing the
> architecture. The representation has reached **completeness** — the next change must be driven by an
> *observed* failure, never by anticipation. This is a governance rule on top of the frozen IR, so that
> "the architecture evolved because of evidence" stays true and auditable.

## IR v1.0 is a versioned, frozen spec

`IR_VERSION = "1.0"` (`src/server/lib/state-machine-ir.ts`), frozen for the first replay validation cycle.

| Allowed without a version bump | NOT allowed in v1.0 |
|---|---|
| bug fixes | new semantic node types |
| implementation fixes | new execution semantics |
| extraction fixes (recall/binding/quarantine) | replay-driven tuning of the representation |

If replay genuinely proves the IR cannot represent a decision, that is **IR v2.0** — a deliberate, versioned
migration — **not a quiet modification of v1.0.** Versioning makes replay results comparable over time: a
v1.0 result and a v2.0 result are explicitly different experiments.

## Representation Change Policy (the gate on IR v2.0)

A representation change (new node type / new execution semantic) is permitted **only if ALL hold**:

1. **≥3 independent replay failures** demonstrate a trading decision the current IR cannot encode —
2. spanning **≥2 different educators AND ≥2 strategy families** (one unusual educator is not enough), AND
3. the failures are classified `COMPILER_DEFECT`-adjacent *representation gaps*, NOT `EXTRACTION_MISS` /
   `VISUAL_DEPENDENCY` / `EDUCATOR_AMBIGUITY` (those don't justify changing the representation), AND
4. the proposed extension **resolves all of those failures** without **adding ambiguity** or **reducing
   determinism** (it must not introduce an `UNKNOWN`-tolerant execution path).

If a proposed change fails any clause, it does not happen in this cycle. This protects against adding a field
because of a single weird video — the exact bias the policy exists to prevent.

## The determinism invariant — never relaxed by replay (GPT, reaffirmed)

If replay shows coverage is reduced because `UNKNOWN` decisions stop execution, that is an **empirical finding
about the corpus** (the source was under-specified), NOT a weakness to engineer around. The system must NOT
acquire rules like *"if confidence > 0.8, execute anyway"* or *"choose the most likely interpretation."* That
would blur faithful reconstruction into invention. **Confidence belongs to the extraction layer; execution
stays binary (TRUE/FALSE/UNKNOWN/UNOBSERVABLE); a required UNKNOWN refuses to emit.** This is a scientific
control, not a bug.

## Two ways the freeze ends (and only these two)

1. **Replay demonstrates an unrepresentable decision** across multiple independent cases (per the policy
   above) → justifies IR v2.0.
2. **Replay shows the representation is adequate** and the bottleneck is elsewhere (extraction, source
   material, or execution) → the IR stays v1.0 and effort goes to the layer the failure taxonomy points at.

Until one of these is evidenced, **IR v1.0 is the frozen research artifact.** The value now is preserving
experimental discipline so that whatever replay reveals is attributable to the correct cause — that is what
makes the eventual result credible rather than merely promising.
