# External Advisor Ledger

Purpose: independent external advisor rulings visible to the Trading Forge advisor chain.

## Operating Rules

- Verify worker reports against GitHub evidence before ruling.
- Preserve rejected attempts and corrections.
- Separate measured facts, hypotheses, and rulings.
- Never convert partial work into completion.
- Assign executable work only to a seat that presently exists and is identified.

## External Review — AR-524

Status: `I7` PARTIAL.

Key ruling:
- Binding movement and diagnostic refusal-classification movement are different metrics.
- Corpus A binding movement remains `0 / 155` globally and `0 / 27` within `WAIT_SESSION`.
- Diagnostic refusal-reason movement is `17 / 155` globally and `17 / 27` within `WAIT_SESSION`.
- The previous wiring diagnosis was withdrawn because the binder deliberately consumes classifier output as refusal classification.
- Corpus B, baseline-defined C2 denominators, refusal identity maps, the `18 / 17 / 9` reconciliation, and provenance proof remain required.
- `c304b098` remains `NOT-SOUND` pending a separately authorized repair.

Next required work:
- Complete `I7` only.
- Do not start `I8` until `I7` closes.

---

## External Ruling — 2026-07-31 — R-503 Seat-Authorization Defect

**Evidence reviewed:** R-503 at `d592160c6aed5d9fa8867cfe139a8d7f5103e286`; advisor-state correction at `31989793ab065b209f67abf9eb6344c65f80bae3`.

### Decision

**ACCEPT** the watchdog finding and the desk's self-correction. **VOID only R-503 §9's assignment to “a fresh worker seat.”** Preserve the remainder of R-503, including the complete `I7` contract, unchanged.

### Findings

1. The worker-idle watchdog behaved correctly: it reported silence without inventing a diagnosis. The advisor then established that the existing worker process and its ear were alive but had stopped at the accepted AR-524 context limit.
2. The existing seat is **alive but no longer capable of receiving work**. It must not be re-tasked merely because its process remains present.
3. A “fresh worker seat” that has not been created is not an assignee. R-503 §9 therefore issued a non-executable authorization and produced a real stall.
4. This is **not an external blocker** and must not be recorded as one. It is a `READY — NO ACTIVE ASSIGNEE` state awaiting one explicit operator action.
5. No background agent may be dispatched without explicit operator authorization. No interactive worker may be presumed to exist.

### Required recovery protocol

1. Keep `I7` in `PARTIAL — READY, UNASSIGNED` state.
2. Preserve the full R-503 §5 completion contract as the authoritative work packet. Do not re-derive it from AR-522.
3. The operator must perform exactly one of these actions:
   - create/open a new interactive worker seat; or
   - explicitly authorize the advisor harness to dispatch the remaining `I7` measurement work as a background agent.
4. After that action exists, the advisor must identify the actual seat or dispatched agent by durable identifier and issue a new assignment to that existing actor.
5. The new actor continues `I7`; it does not open `I8`, touch `P0-v5`, alter `c304b098`, or restart the completed reasoning.
6. The exhausted worker process may be closed after its durable receipts and monitor state are confirmed preserved. Its continued liveness is not progress.

### Position

- Watchdog: **SOUND**
- AR-524 context-limit handoff: **SUSTAINED**
- R-503 substantive ruling: **SUSTAINED**
- R-503 §9 future-seat assignment: **VOID / SUPERSEDED**
- `I7`: **PARTIAL — READY, UNASSIGNED**
- `I8`: **NOT STARTED**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **NAMED, UNAUTHORIZED**
- Merge / deploy / release: **HOLD**

**Control rule:** `A COMPLETE WORK PACKET WITHOUT A PRESENT ASSIGNEE IS READY WORK, NOT AUTHORIZED WORK.`
