# Decision-Atom v1.1 — verification-driven extraction (semantic conservation)

> **Mission:** extract 100% of the strategy + steps the speaker teaches in the transcript, executably, so a
> Python engine backtests it without human interpretation. v1.1 reframes extraction as **program synthesis with
> a conservation law**: the transcript is source, the IR is bytecode, the compiler synthesizes, verification
> proves semantic preservation, replay tests behavioral equivalence.

## The one change that unlocks it (operator/GPT, 2026-06-29)

Do **not** replace `SpeakerItem` — add `DecisionAtom` **beneath** it. SpeakerItem is the *semantic-concept*
layer (named tools, terminology, attribution). DecisionAtom is the *executable* layer. One concept compiles to
many atoms. The conserved unit moves from "named concept" to "executable decision."

```
Transcript -> Clause -> SpeakerItem -> DecisionAtom -> Decision Graph -> Executable IR (StrategyIR)
                              │   one concept compiles to MANY atoms:
                              └── "liquidity sweep" => WAIT_STRUCTURE -> VERIFY_STRUCTURE -> WAIT_RETEST -> WAIT_CONFIRMATION
```

Why this matters (proven): `semantic-conservation.ts` already enforces a real conservation law, but on
`SpeakerItem` (names) — so a strategy can score 100% accounted while its executable *decisions* (order,
condition, dependency) are absent (`conservation-granularity-gap.test.ts`). Names are not decisions.

## Decision atoms (`decision-atom.ts`)

Atom types map 1:1 to the existing S0–S8 IR lifecycle states (the decision graph **is** the state machine):

| Atom | IR state | Atom | IR state |
|---|---|---|---|
| `WAIT_SESSION` / `FILTER` | S3 execution_context | `WAIT_CONFIRMATION` / `CONFIRM_DIRECTION` / `ENABLE_ENTRY` | S5 confirmation |
| `WAIT_BIAS` | S1 bias | `ENTER` (terminal) | S6 entry |
| `WAIT_STRUCTURE` / `VERIFY_STRUCTURE` | S2 structural_event | `INVALIDATE` / `EXCEPTION` | S7 managed |
| `WAIT_RETEST` | S4 waiting | `RESET` / `EXIT_HINT` | S0 / S8 |

Each atom carries `{type, temporal_kind, object, object_canonical, depends_on[], provenance, parent_speaker_item?}`.
- **Events vs conditions** (`temporal_kind`): events OCCUR (edge-triggered: "engulfing closes"); conditions
  REMAIN TRUE (level-triggered: "after London open"). Execution engines treat these differently — separating
  them removes ambiguity in deterministic compilation.
- **First-class dependencies** (`depends_on`): explicit edges enable graph proofs (acyclic / reachable / satisfied).
- `provenance` reuses the IR node model (span + origin + confidence) — atoms are reverse-traceable.
- `parent_speaker_item` is **optional**: session/timing/exception atoms derive directly from a clause with no
  named concept.

## Three conservation ledgers (`conservation-ledgers.ts`) — failure localization

| Ledger | Conserves | Hard-fail | Localizes to |
|---|---|---|---|
| **A — transcript** | every clause -> exactly one disposition (decision_bearing / semantic_only / contextual / motivational / visual_only / ignored+reason) | unclassified clause; `ignored` without reason (escape-hatch guard) | clause classifier |
| **B — decision** | every decision_bearing clause -> ≥1 atom (span overlap) | orphan decision clause = **OMISSION** | extractor |
| **C — graph** | every atom on a path to `ENTER`; deps resolve; acyclic | dangling dep / cycle / unreachable atom | assembler |

The payoff: `A pass, B fail` → extractor missed an atom. `A+B pass, C fail` → assembler is broken. You know
*which stage* lost the decision, not just that one was lost.

## Bidirectional adversarial (the recovery loop)

Two independent questions catch opposite error classes:
- **Omission** — a decision in the transcript with no atom (Ledger B = structural half; an LLM critic catches
  *semantic* omission where the classifier mislabeled a decision as non-decision).
- **Hallucination** — an atom the transcript does not justify. `structuralHallucinations()` is the structural
  half (evidence_quote absent at the declared span = reverse-traceability fail); an LLM critic is the semantic half.

Loop: extract → run the critic for one omission AND one hallucination → recover → repeat **until NONE**
(dedup against existing atoms so it converges).

## Semantic idempotence (`decision-graph-canonical.ts`) — the reproducibility invariant

Run the compiler twice on the same transcript → the canonical decision graph must be **identical**, not similar.
This is what turns a non-deterministic LLM into a deterministic compiler. Canonicalization drops the volatile
surface (spans, verbatim phrasing, discovery order, restatements) and keeps only the executable identity (type
+ synonym-folded object + dependency structure). **Proven:** same decisions phrased differently / shuffled /
restated → identical hash; a dropped or hallucinated decision → different hash (caught before any replay).

This directly answers the gemma text-variance we proved this session: variance must live below canonicalization.

## The conservation invariant (at the right resolution)

> Every executable decision atom traces to ≥1 transcript span; every strategy-bearing transcript clause is
> consumed by exactly one decision atom OR classified non-executable with an adversarially-verified reason.
> No atom without a span. No strategy-bearing clause without a disposition. Two runs → one canonical graph.

## Status

**Built + tested (this commit, standalone, zero production wiring):** `decision-atom.ts` (types + atom→state +
canonicalization), `conservation-ledgers.ts` (A/B/C + adversarial structural half), `decision-graph-canonical.ts`
(canonicalize + idempotence). 15 tests green: ledger failure-localization, hallucination, semantic idempotence.

**Next (needs gemma + a transcript run):**
1. **Clause segmenter** — transcript → spanned clauses (ASR-aware, deterministic).
2. **Decision-atom extractor** — per clause/window, decompose-don't-summarize typed extraction (this kills
   summarization loss). N-sample union exploits gemma variance for recall.
3. **LLM adversarial critic** — the semantic omission + hallucination half (asymmetric: cloud critic, occasional).
4. **Atom→IR assembler** — compose the atom graph into `StrategyIR`.
Then run the full loop on one golden transcript and produce the **atom-level conservation ledger** — the first
true measure of decision-faithfulness (vs the name-level ~90% proxy).
