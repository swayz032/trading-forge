# Falsification Protocol — what must be true for the system to survive contact with reality

> One page. The entire system compressed into its falsifiable predicates. No architecture here — this is the
> statement of what reality must confirm. Everything built (CP1–6 + grounding + span-native + uncertainty +
> taxonomy + verdict harness) exists to make each predicate below cleanly TRUE or FALSE, never ambiguous.

```
                         INSTRUCTION (YouTube transcript)
                                      │
        ┌─────────────────────────────┴─────────────────────────────┐
        │  COMPILER (built, offline-proven)                          │
        │   span-native lowering → state-machine IR                   │
        │   explicit XOR inferred · evidence = transcript slice       │
        └─────────────────────────────┬─────────────────────────────┘
                                      │
            ┌──────────────┬──────────┴──────────┬──────────────┐
            ▼              ▼                     ▼              ▼
      LEXICAL (span)  PERCEPTUAL (infer)  STRUCTURAL (infer)   (dropped: promo/psych)
       event/zone/      confirmation       imposed rules        — conserved, not lost
        until                                                 
            └──────────────┴──────────┬──────────┴──────────────┘
                                      │
                              EXECUTION (runStateMachine)
                                      │
                              REAL OHLC REPLAY  ◄── the only unbuilt coupling
                                      │
                          SEGREGATED P&L by epistemic origin
                                      │
                                 VERDICT
```

## The four predicates (system survives iff all hold under real replay)

| # | predicate | survives if | falsified if | already-tested offline |
|---|---|---|---|---|
| P1 | **Compiler honesty** — every explicit node is a transcript span | 100% grounded, 0 violations | any paraphrase masquerades as explicit | ✅ 38/38 GROUNDED @ scale |
| P2 | **Behavioral fidelity** — compiled IR reproduces the educator's *demonstrated* entries | ≥70% of demonstrated entries reproduced on real OHLC | IR fires elsewhere / not at all | ✗ needs engine-attach |
| P3 | **Edge provenance** — measured edge comes from grounded or faithfully-perceptual layers | NOT STRUCTURAL_SIGNAL_SUSPECT, NOT INFERENCE_NOISE | edge lives only in compiler-imposed structure | ✗ needs real backtest |
| P4 | **Generalization** — the signal-carrying layer is stable across regimes/educators | STRUCTURAL_LAW (stable partition) | CORPUS_CONDITIONAL (varies) → valid but not universal | ✗ needs ≥3 educators × ≥2 regimes |

## What each failure means (no black box — every fail localizes)

- **P1 fails** → compiler regression (paraphrase leak). Fix: lowering. *Cheapest; runnable today.*
- **P2 fails on a GROUNDED node** → extraction gap (the educator's words weren't captured).
- **P2 fails on an INFERRED node** → the inference (reconstruction) was wrong for that trade.
- **P3 = STRUCTURAL_SIGNAL_SUSPECT** → the "edge" is the compiler's invention, not the educator's strategy → honest negative result (the system told the truth about itself).
- **P3 = INFERENCE_NOISE** → the perceptual/structural reconstruction adds noise → revisit the inference layer.
- **P4 = CORPUS_CONDITIONAL** → the decomposition is real but corpus-specific, not a universal law → still valid, scoped.

## The single line

> **The system survives reality iff: it never lied about what was taught (P1), it reproduces what the educator
> did (P2), its edge comes from what was taught or faithfully perceived — not from what it invented (P3), and
> that holds across instructors and regimes (P4).**

P1 is closed offline. P2–P4 await the one missing coupling (real OHLC replay + stable supervisor). Until then
the honest status is: **a fully instrumented scientific system waiting for its first external measurement —
structurally complete, empirically untested in its final layer.** Build nothing more; run the measurement.
