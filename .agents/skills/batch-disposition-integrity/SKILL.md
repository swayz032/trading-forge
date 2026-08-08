---
name: batch-disposition-integrity
description: Use when running, reviewing, or ruling on the V1.1 strategy-library batch, intake recompiles, or any compiler census that claims complete faithful compiles or measured refusals.
---

# Batch Disposition Integrity

## Core invariant

V1.1 proves trustworthy processing, not strategy quality or universal coverage. Content-pin the immutable input manifest. Every manifest member must produce exactly one deterministic disposition; evidence-backed refusal is valid.

## Allowed dispositions

- `FAITHFUL_COMPILE_READY_FOR_BACKTEST`
- `SOURCE_INCOMPLETE`
- `SOURCE_AMBIGUOUS`
- `EXTRACTION_MISSING_REQUIRED_INFORMATION`
- `CANONICAL_TERM_UNRESOLVED`
- `PARAMETER_SCHEMA_MISMATCH`
- `MARKET_OR_TIMEFRAME_UNRESOLVED`
- `ENGINE_PRIMITIVE_MISSING`
- `ENGINE_PRIMITIVE_WRONG_IDENTITY`
- `TEMPORAL_STATE_MACHINE_MISSING`
- `DUPLICATE_OR_EQUIVALENT_STRATEGY`
- `OTHER_MEASURED_REFUSAL`

## Admission contract

1. Reconcile manifest and output identities bidirectionally. Report input, output, and unique member sets plus missing, extra, and duplicate identities. Totals are controls, never membership proof.
2. Require one output per manifest member, no extras, duplicate outputs, or silent truncation.
3. Audit each faithful compile for exact input/output condition membership, parameter identity, temporal ordering/state, source-versus-framework overlay separation, provenance, and use of the V1.0-proven production path.
4. Audit each refusal for failed condition, source evidence, expected canonical meaning, exact failed handoff, measured reason, and whether one reusable capability could unlock other strategies.
5. For duplicates, retain a disposition row naming the canonical survivor and equivalence evidence. Never silently drop the duplicate.
6. Use `OTHER_MEASURED_REFUSAL` only for evidenced failure outside every named class; state why each closer class is inapplicable.
7. Rerun and require equality over manifest identity, per-member disposition, evidence identity, and compiler/capability version.

## Verdict

`QUARANTINE` the run for missing, extra, duplicate, or invalid rows; generic/evidence-free refusal; silent condition or parameter loss; neighboring primitive substitution; unresolved framework overlay; flattened temporal sequence; or nondeterminism. Do not quarantine merely because faithful compiles are few or zero.

## Required receipt

Emit: manifest pin; input/output/unique sets; missing/extra/duplicate identities; per-disposition membership, not counts alone; compiled-membership audit; refusal-evidence audit; determinism result; reusable-capability clusters; and final `PASS` or `QUARANTINE`.
