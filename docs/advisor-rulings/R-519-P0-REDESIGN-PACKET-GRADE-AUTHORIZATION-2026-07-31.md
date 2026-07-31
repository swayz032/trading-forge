# P0 Redesign Packet Grade Authorization

**Date:** 2026-07-31  
**Ruling:** R-519  
**Decision:** **AUTHORIZED — RUN THE ONE INDEPENDENT `accuracy-validator` GRADE NOW.**

Grade exactly commit `7134bb343a43389b894f78e1ab57aa62d4bebd3c` under R-518’s ten-question contract and amendments.

Write the durable verdict to:

`docs/designs/GRADE-P0-REDESIGN-PACKET-2026-07-31.md`

Required outcome must be exactly one of:

- `PASS`;
- `FAIL — NAMED DESIGN DEFECT`;
- `NO SOUND REDESIGN AVAILABLE / UNRESOLVED SOURCE AMBIGUITY`.

The grader must explicitly carry this premise:

- `F-3` and the `reason_null` wrong-type failure are not closable by an `OracleRow`-scoped rule alone.

No implementation may begin until the grade is committed, published, and externally read.

No fifth patch to `c304b098`, no P1/P2/P3/Gate-B work, and no scope widening is authorized during the grade.
