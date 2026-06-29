# Briefing: the YouTube-strategy extraction compiler (for a new collaborator)

> You are joining a project mid-investigation. This document gives you the mission, the architecture, everything
> we have **measured** (not assumed), exactly where we are stuck, and the open decision. Read it and you can
> contribute immediately. The defining discipline here: **we move on observed evidence, not anticipation.**

## 1. The mission

Extract **100% of the trading strategy and every step a YouTube educator teaches** — faithfully and
*executably* — from the video **transcript**, so a deterministic **Python backtest engine** tests the REAL
strategy with **no human interpretation**.

- "100%" means *100% of what is expressed in the transcript text*. Chart-only elements (the educator points at
  a screen and never says the rule) are explicitly flagged `VISUAL_REQUIRED`, never silently dropped. A real
  100% with attributed visual gaps, not a fake one.
- **Two-stage ownership.** Extraction captures the **entry edge**: setup, entry trigger, confluences,
  invalidation, session/timing, the ordered steps. The **framework-overlay** (operator-canonical) owns
  stop-loss / take-profit / position sizing / risk-reward — those are NOT extraction's job and must be
  classified `framework_owned`, never emitted as strategy steps.

## 2. The reframe: it's a compiler, not "AI extraction"

Transcript = **source code**. The IR = **bytecode**. The compiler **synthesizes** the program. **Verification**
proves semantic preservation. **Replay** (later) tests behavioral equivalence. The guiding principle behind
every successful change so far: **push ambiguity upstream; keep later stages deterministic and verifiable.**

**The conservation law (the central invariant):**
> Every executable decision traces to ≥1 transcript span; every strategy-bearing transcript clause is consumed
> by exactly one decision atom OR classified non-executable with an explicit reason. Nothing appears without
> evidence; nothing executable disappears without explanation. Two runs of the compiler → one canonical graph
> (semantic idempotence).

## 3. The pipeline / layers

```
Transcript -> Clause (permanent id, exact offsets) -> SpeakerItem (semantic concept) ->
DecisionAtom (executable) -> Decision Graph -> Executable IR (S0-S8 state machine) -> [Python backtest]
```
- **SpeakerItem** = the named-concept layer (terminology, tools). NOT replaced — a DecisionAtom is the
  *executable* layer beneath it; one concept compiles to many atoms.
- **DecisionAtom** types map 1:1 to the **S0-S8 lifecycle**: WAIT_SESSION/FILTER(S3), WAIT_BIAS(S1),
  WAIT_STRUCTURE/VERIFY_STRUCTURE(S2), WAIT_RETEST(S4), WAIT_CONFIRMATION/CONFIRM_DIRECTION/ENABLE_ENTRY(S5),
  ENTER(S6=terminal), INVALIDATE/EXCEPTION(S7), RESET(S0), EXIT_HINT(S8).
- Each atom carries `{type, temporal_kind (event OCCURS / condition HOLDS), object, object_canonical,
  depends_on[] (typed edges), provenance (span+origin+confidence)}`.

## 4. What is already built (verification spine — standalone, tested, on branch `extraction/100pct-evidence`)

| File | Role |
|---|---|
| `state-machine-ir.ts` | S0-S8 IR (the decision graph) + Provenance (span/origin/confidence). The compile target. |
| `decision-atom.ts` | DecisionAtom type + atom→state map + `canonObject` normalization. |
| `conservation-ledgers.ts` | **3 ledgers that LOCALIZE failure by stage** — A transcript (clause→disposition), B decision (clause→atom = omission/extractor), C graph (atom→ENTER path = assembler). |
| `decision-graph-canonical.ts` | Canonicalization + **semantic idempotence** (run twice → identical hash). |
| `semantic-conservation.ts` | The conservation law (EXECUTED/NORMALIZED/IGNORED_WITH_REASON/silent_loss→throw). |
| `decision-closure.ts` | Graph verifier (IMPOSSIBLE_STATE/DANGLING_REF/ORPHAN_NODE/CYCLE). |
| `clause-segmenter.ts` | Transcript → stable clauses (permanent ids, exact char offsets, deterministic). |
| `scripts/atomize-transcript.ts` | **The working Phase-1 vertical slice** (see §7). |

~30 unit tests green. Tooling: **gemma4:e2b** local via Ollama; **per-clause binary extraction**; 4 golden
transcripts (`psH`=price-action ORB, `l-2`=ICT confluence, `h6T`=EMA/CCI indicator, `MKsj`=36K "two-line").

## 5. What we have MEASURED — the bottleneck march (each result is n=4)

The bottleneck has marched steadily downstream, getting more specific each time. That IS the progress —
uncertainty collapsing, not metrics improving.

1. **Hypothesis "we miss decisions" (recall) → FALSIFIED.** Omissions ~0.
2. **Real problem = PRECISION:** ~5x over-extraction (46/47 atoms vs ~9 real). The extractor manufactures
   executable decisions from explanatory/motivational language (it even minted `RESET:trust` from "you stop
   trusting yourself").
3. **Root cause = ONTOLOGY**, not prompting: the extractor asked "can I map this phrase to a type?" instead of
   "does this clause INTRODUCE a new executable state transition?" → built the **Decision Introduction Gate**
   (a clause is a decision only if *removing it would change a deterministic engine's behavior*; framework-
   owned excluded). It **halved** over-extraction. Crucially: **DBA 100% across n=4** — the gate boundary is
   STABLE; earlier "instability" did not reproduce. The gate is solved.
4. **The dominant remaining MEASURED failure = the ASSEMBLER.** Graph-conservation (Ledger C) failed on 3/4 —
   exactly the **non-linear** strategies; the one linear strategy (psH) passed. Failure aligns with graph
   **topology**, not transcript quality.
5. **Fix = move edges UPSTREAM (produce, don't infer), and never prune.** A substring resolver left ~50%
   unresolved → false prunes that DELETED real decisions. Lesson locked in: **connectivity is ADVISORY —
   classify isolated atoms `{RESOLUTION_FAILURE | FRAMEWORK | NOISE}`, never delete** (isolated = noise OR
   resolver-failure; different diagnoses).
6. Exact structured-key matching → **DRR 0%** (gemma can't emit consistent exact labels). Fuzzy token overlap →
   DRR 42-72% (its ceiling).
7. **Typed dependency descriptors `{type, role}` + a deterministic "nearest prior atom of that TYPE" resolver →
   DRR 86-100%. THE RESOLVER IS SOLVED.** It went from an NLP guess to a hash lookup over a reliable enum.

## 6. WHERE WE ARE RIGHT NOW (the open problem)

The typed-dependency result **validated "produce, don't infer"** *and* exposed the next layer:

- **DRR 86/95/100/100%** — type-anchored resolution works.
- **But connectivity is STILL broken**: CONNECTED only **0 / 4 / 5 / 19** atoms reach ENTER.
- The tell: emitted-edge counts **collapsed** to **7 / 19 / 7 / 38** for **27-136 atoms**. Most atoms get `[]`
  dependencies → they're isolated. The graph is disconnected **not because resolution fails (it doesn't) — but
  because the edges were never EMITTED.**
- **DRR is now a misleading internal metric** (psH: 100% DRR, 0 connected). The *scientific* metric is **"does
  the graph preserve the executable strategy?"** — judged against a manual audit, not DRR.
- **ROOT CAUSE: per-clause extraction cannot emit CROSS-clause dependencies.** A clause judged in isolation
  ("wait for the retest") does not know what prior atoms exist, so it can't reliably state its dependency. A
  dependency is a *relationship between clauses*; the per-clause batch can't see it.
- Persisting alongside: over-extraction still ~3-15x (27-136 atoms vs ~9-15 real) and psH **intermittently
  loses its ENTER atom**. Extraction is otherwise STABLE (DBA 100%, Δ=0).

So: `gate (solved) -> resolver (solved) -> EDGE EMISSION (the current bottleneck)`.

## 7. The open DECISION (this is what we need help reasoning about)

The edges must come from a stage that *has sequence context*. Three candidates:

1. **State-order assembly (deterministic compiler rule).** Atoms already map to S0-S8; derive the spine from
   lifecycle order — each atom depends on the nearest prior atom of an *earlier* state (ENTER←CONFIRMATION←
   RETEST←STRUCTURE←SESSION). No LLM edges needed for the spine. **Risk:** confluence strategies have *parallel*
   prerequisites (N conditions at one level) that a linear chain mis-models.
2. **Context-aware linking pass.** A second LLM stage that sees the *whole atom sequence* and emits typed edges
   with the context per-clause extraction lacked. **Risk:** reintroduces an LLM stage before the deterministic
   plumbing is fully solid.
3. **Hybrid (current lean):** deterministic state-order **default spine** + gemma-emitted typed edges as
   **corrections / branches / alternatives** on top — graph connected by construction; the model only supplies
   the non-obvious structure (branch / alternative / exception edge roles, which are already first-class).

Also unresolved and important: **strategies are branches and alternatives, not just chains** ("if bullish… OR
if bearish…", "enter after engulfing OR aggressively after MSS"). Edge *types* (prerequisite / temporal /
branch / alternative / exception) matter more than clever resolution; the assembler must support them.

## 8. How we work (please hold this discipline)

- **Measure before tuning; n≥2 before concluding a pattern is systematic.** (We resisted tuning the gate on one
  transcript — and were right.)
- **Classify, don't prune.** Never destroy evidence; a disconnected atom is information.
- **Advisory before enforcement.** Only let a check gate/transform when its metric earns it.
- **Instrumentation ≠ scientific metric.** DRR is plumbing; "graph preserves the executable strategy" is truth.
- **No goalpost-moving.** Don't relax a criterion to inflate a score; amendments are dated + justified.
- **Push ambiguity upstream; keep later stages deterministic.** Every win has followed this.

## 9. The end state we're driving to

A **connected, canonical, deterministic decision graph** that preserves the executable strategy, compiles into
the S0-S8 `StrategyIR`, and feeds the **Python backtest engine** — so the backtest tests the *real* strategy,
not a lossy paraphrase. After that: **replay** (behavioral reconstruction) as the ultimate verification.

**The single question on the table:** how should the dependency *edges* be produced — deterministic state-order
spine (#1), a context-aware linking pass (#2), or the hybrid (#3) — given that per-clause extraction cannot see
cross-clause relationships, and that real strategies branch?
