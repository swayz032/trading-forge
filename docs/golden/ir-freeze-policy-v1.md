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

## Frozen corpus + no silent reruns (attributability governance — GPT)

A fourth artifact is frozen alongside representation/protocol/governance: the **Replay Corpus**
(`docs/golden/replay-corpus-v1.json`, `replay-run-ledger.ts`). Each video carries `video_id + transcript_sha +
market + instrument + timeframe + educator_family`, and the set carries a `corpus_hash`. Without this, a later
coverage change (68%→81%) entangles "better extraction" / "better replay" / "easier corpus" — the hash
de-confounds them. **Current state: `1.0-seed` (4 videos, forex/generic — does NOT meet the minimum;** needs
≥18 videos / ≥3 families / ≥2 instruments INCLUDING futures, since the engine trades MES/MNQ/MCL). The seed
becomes the official frozen **Corpus v1.0** only when `meets_minimum=true`.

**No silent reruns:** every replay execution gets a unique `run_id` + full environment manifest (compiler /
extraction / replay-engine commits + `dataset_hash` + `ir_version`). The ledger is **append-only** —
`appendRun` THROWS on a reused id. A re-run after a fix is a NEW record (R-...-002), never an overwrite, so
`R-...-001 FAILED` and `R-...-002 PASSED` both stay in history. Runs are comparable only if their
`dataset_hash` matches (`runsComparable`) — a coverage delta across different corpora is confounded, not progress.

## Three quantities, never collapsed into one "accuracy" (reporting — GPT)

When results are published internally, keep these THREE separate (each a different scientific question; a
system can score high on one and low on another):
- **Extraction fidelity** — did we capture what was taught? → Gate 1.75 (completeness)
- **Execution determinism** — could it run without guessing? → Gate 1.5 + Executable-IR invariant
- **Behavioral reconstruction** — did deterministic replay reproduce the demonstrated entries? → Gate 2
Never average them. The object of study is the CORPUS; the compiler/IR/extraction/replay/taxonomy are
instruments. A finding that "many educators rely on tacit/visual knowledge" is then evidence about the source
material, not merely a system limitation — which is why the three must stay distinct.

## Two ways the freeze ends (and only these two)

1. **Replay demonstrates an unrepresentable decision** across multiple independent cases (per the policy
   above) → justifies IR v2.0.
2. **Replay shows the representation is adequate** and the bottleneck is elsewhere (extraction, source
   material, or execution) → the IR stays v1.0 and effort goes to the layer the failure taxonomy points at.

Until one of these is evidenced, **IR v1.0 is the frozen research artifact.** The value now is preserving
experimental discipline so that whatever replay reveals is attributable to the correct cause — that is what
makes the eventual result credible rather than merely promising.
