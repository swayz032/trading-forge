# GPT EXTERNAL ADVISOR RULING — AR-1183

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / GOLDEN-RUN DESIGN  
**V4 stages:** GE -> C -> SF -> CO -> Q -> AR  
**Status:** END-TO-END PROOF CONTRACT FROZEN — EXECUTION BLOCKED ON AR-1138 ACCEPTANCE

## SIMPLE RESULT

Trading Forge needs one canonical proof that a **real source strategy** survives the entire V4 pipeline without its meaning changing silently.

The first golden run must not use a hand-made toy strategy.

Use the real strategy/candidate that closes AR-1138, after GPT independently accepts its source semantics.

Until then this is a proof contract only.

---

# GOLDEN RUN CENTERLINE

```text
REAL SOURCE VIDEO / TRANSCRIPT EVIDENCE
        ↓
GRAPH ENGINEERING
        ↓
COMPILER
        ↓
STRATEGY FACTORY
        ↓
SOURCE-FAITHFUL BACKTEST / REPLAY
        ↓
CONTEXT OBSERVER (READ-ONLY)
        ↓
QUALIFICATION
        ↓
3–5 DAY PAPER
        ↓
AUTONOMOUS RUNTIME EXECUTION INTENT
        ↓
ZERO BROKER EGRESS IN THIS GOLDEN TEST
```

The proof ends at validated execution intent until the separate Topstep/live launch gates are explicitly opened.

---

# CORE LAW — IDENTITY MUST SURVIVE EVERY HANDOFF

Every stage must preserve a machine-checkable lineage chain.

Minimum conceptual ledger:

```text
source_id
source_evidence_hash
extraction_artifact_hash
graph_artifact_hash
compiler_input_hash
compiled_strategy_hash
strategy_factory_artifact_id/hash
backtest_spec_hash
qualification_candidate_id/hash
paper_candidate_id/hash
runtime_strategy_id/hash
```

Field names may reuse current repository schemas. Do not create duplicate hash definitions if canonical identity functions already exist.

At every handoff record:

```text
INPUT ID/HASH
OUTPUT ID/HASH
TRANSFORM VERSION
PROVENANCE LINK
VERDICT
```

---

# STAGE 1 — SOURCE EVIDENCE

Authority is actual transcript/source evidence, not the worker's prose paraphrase.

Golden receipt must pin:

- source video/document identity;
- exact transcript/source spans supporting each decisive rule;
- source direction/symbol/timeframe/session where explicitly supported;
- unresolved ambiguity/refusal evidence.

AR-1138's current grading law remains controlling: a paraphrased `action` cannot override the pinned source quote.

No hand-edited extraction JSON after grading.

---

# STAGE 2 — GRAPH ENGINEERING

Prove the source decision can be represented as deterministic decisions/dependencies/order/state transitions/invalidations.

Required proof:

```text
source decisive facts
<->
graph decision atoms/state/dependencies
```

No decisive source rule may disappear merely because the compiler cannot express it.

If graph representation cannot express a decisive rule exactly enough, golden run = REFUSAL/BLOCK, not approximation.

---

# STAGE 3 — COMPILER

The compiler must lower graph semantics without adding or strengthening entry logic.

Required controls:

1. Same graph input -> byte/semantic-identical compiled output.
2. Deliberately mutate one decisive graph condition -> compiled behavior must change observably.
3. Unsupported decisive primitive -> exact refusal.
4. No declaration-order dependence.
5. No midpoint/default parameter invention where source supplied a real value.

The golden compiler receipt must identify every decisive binding and its source provenance.

---

# STAGE 4 — STRATEGY FACTORY

Exactly two valid outputs:

```text
A. faithful executable artifact
B. exact refusal with reason
```

No third state of "compiled enough".

Successful artifact immediately receives a frozen artifact identity/hash used downstream.

No downstream stage may silently rebuild it from mutable prose.

---

# STAGE 5 — SOURCE-FAITHFUL BACKTEST / REPLAY

Run the exact compiled artifact.

Required proof:

- test engine consumes the factory artifact directly or through a proven identity-preserving adapter;
- no manual re-entry of conditions;
- signals can be mapped back to decisive graph/compiler rules;
- zero-trade result is allowed and reported honestly;
- refusal cannot be recorded as success;
- same tape + same frozen artifact + same deterministic identities -> same semantic result.

Mutation control:

Change one decisive compiled condition and prove trades/signals change or the condition is genuinely unreachable on the fixture. A dead mutation is not proof.

---

# STAGE 6 — CONTEXT OBSERVER

Context Observer is READ-ONLY.

Golden test must prove:

```text
source signal before observer
==
source signal after observer
```

Observer may annotate:

- regime;
- structure;
- volatility;
- nearby levels;
- other approved context.

It may not veto, create, move, or mutate the source-faithful entry during this stage.

Run an observer-disabled control and prove entry identity/time/side are unchanged.

---

# STAGE 7 — QUALIFICATION

The exact frozen Strategy Factory candidate enters qualification.

Required evidence includes the existing authoritative qualification stack:

- edge screening;
- bounded challengers where applicable;
- OOS evidence;
- walk-forward/robustness;
- execution stress;
- replay parity;
- required PAPER qualification.

Discovery result is not proof of edge.

If candidate hash changes, qualification continuity resets/invalidates according to the frozen candidate law.

---

# STAGE 8 — PAPER

Required official window remains 3–5 days for V4 finalists under the current plan.

Golden PAPER proof must bind every session/trade to the same frozen candidate identity.

Must prove:

- exact candidate hash at start and end;
- correct MES/MNQ/MCL logical identity for the chosen strategy;
- deterministic daily receipts;
- restart/rehydration once;
- no duplicate signal/trade after restart;
- no strategy mutation during the counting window;
- zero broker egress;
- PAPER vs source/replay signal lineage where comparable.

---

# STAGE 9 — AUTONOMOUS RUNTIME INTENT

After qualification only, load the exact qualified artifact into the autonomous runtime in a no-egress certification mode.

Create an **execution intent**, not a broker order.

Receipt must include at minimum:

```text
strategy/candidate identity
account routing target class (test/no-egress)
symbol
side
quantity/order intent
risk decision
kill-switch state
correlation/idempotency identity
broker_egress = false
```

The generated intent must be traceable all the way back to the source decision that created the signal.

---

# GOLDEN CONSERVATION TABLE

The final report must contain a machine-generated table equivalent to:

| Boundary | Input | Output | Identity preserved? | Semantic delta? | Verdict |
|---|---|---|---|---|---|
| Source -> Graph | source evidence | graph artifact | yes/no | exact listed delta | PASS/STOP |
| Graph -> Compiler | graph | compiled | yes/no | ... | ... |
| Compiler -> Factory | compiled | factory artifact | ... | ... | ... |
| Factory -> Backtest | artifact | run | ... | ... | ... |
| Signal -> Observer | signal | annotated signal | ... | MUST be none | ... |
| Qualification -> PAPER | candidate | PAPER candidate | exact hash | MUST be none | ... |
| PAPER -> Runtime | qualified candidate | runtime artifact | exact identity | MUST be none | ... |
| Runtime -> Intent | signal | execution intent | lineage linked | framework-only risk fields allowed | ... |

The machine generates this table from receipts. Do not tidy identifiers by hand.

---

# STOP CONDITIONS

Golden run stops immediately if:

- source quote does not support a decisive rule;
- paraphrase is stronger than source;
- graph loses a decisive condition;
- compiler invents a parameter/condition;
- factory artifact identity changes silently;
- backtest tests a copy instead of production artifact;
- Context Observer changes source entry;
- candidate hash changes during qualification/PAPER;
- restart duplicates a PAPER signal/trade;
- runtime uses a different artifact than qualified;
- broker egress occurs during this certification run;
- any stage returns success while its evidence is missing/refused/unknown.

---

# FIRST GOLDEN CANDIDATE

Do not select a new strategy tonight.

The first candidate is the real AR-1138 strategy after:

```text
Claude completes AR-1138
-> worker report
-> GPT independently inspects source/code/tests
-> GPT ACCEPTS semantic closure
```

If AR-1138 is refused, that refusal is useful evidence but it does not become the executable golden candidate; select the next real strategy only under an explicit ruling.

---

# ORDERING

This contract does not authorize bypassing any stage.

AR-1138 remains first.
P0-6/Worker 2 runtime hardening remains separately gated.
Topstep network remains closed.

## Bottom line

The golden run answers one question:

> Can one real Trading Forge strategy travel from source evidence to autonomous execution intent with a complete machine-verifiable chain and zero silent semantic changes?

If yes, the factory is proven end-to-end for one real case. Then scale the same proof pattern to the library.