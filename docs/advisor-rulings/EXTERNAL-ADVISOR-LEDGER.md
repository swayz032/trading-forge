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

1. The worker-idle watchdog behaved correctly: it reported silence without inventing a diagnosis.
2. A future worker seat is not an assignee.
3. This was `READY — NO ACTIVE ASSIGNEE`, not an external blocker.
4. No background agent could be presumed or dispatched without authorization.

### Position

- R-503 §9 future-seat assignment: **VOID / SUPERSEDED**
- `I7`: **PARTIAL — READY, UNASSIGNED** at that ruling
- `I8`: **NOT STARTED**
- `c304b098`: **NOT-SOUND**
- Merge / deploy / release: **HOLD**

**Control rule:** `A COMPLETE WORK PACKET WITHOUT A PRESENT ASSIGNEE IS READY WORK, NOT AUTHORIZED WORK.`

---

## External Ruling — 2026-07-31 — AR-526 Publication Gate

**Evidence reviewed remotely:** R-505 at `9d1f29984d85141428f99e7ade8b4cd60944ea47`. AR-526 claims instrument commit `463f588d`, but that commit does not resolve remotely, and public branch `h1-wave4-sealed12-driver` remains exactly at R-505. The claimed generator, completed artifacts, identity maps, source-closure manifest, and RED-proof receipt are therefore unavailable for independent inspection.

### Decision

**AR-526 IS RECEIVED BUT NOT ACCEPTED AS `I7` CLOSURE.** Its reported structure is substantially aligned with R-503 §5 A–H and §3, but a committed-delivery claim cannot be certified from prose when its named commit and artifacts are absent from the public evidence channel.

### What is provisionally credible but unverified

- Two named metrics rather than one naked “yield.”
- Corpus A binding movement `0` and diagnostic-reason movement `17`.
- Corpus B binding movement `0` and diagnostic-reason movement `45`.
- Separate global, `WAIT_SESSION`, and C2-denominator reporting.
- Identity reconciliation naming the eighteenth recognized row.
- Separate route partitions and no pooled Corpus A/B rate.
- Source-closure provenance with zero relevant dirty-path intersection.
- Twenty-eight executable assertions and four discriminating mutation cases.

These are **worker claims**, not externally verified facts, until the exact evidence resolves remotely.

### Required publication gate

Before `I7` may close, publish through a reachable branch:

1. Full commit SHA for `463f588d` or its superseding commit.
2. Updated `session_role_resolver_yield.py`.
3. Final Corpus A and Corpus B result artifact.
4. Full identity-level reason-transition map.
5. Source-closure manifest containing every compared path and hash.
6. Pre-run and post-run status receipts.
7. `session_role_resolver_yield_REDPROOF.py`.
8. `session-role-resolver-yield-REDPROOF-2026-07-31.json`.
9. The assertion ledger naming all 28 checks and their pass/fail state.
10. Exact reproduction commands.

The public branch must contain those bytes. A report saying “committed” is not a substitute for a remotely resolvable commit.

### Technical review held for the published artifact

The external review will specifically verify:

- whether Corpus B's `C2` denominator is clearly labelled as OFF-control-derived rather than baseline-artifact-derived;
- whether Corpus A proves identity equality between the baseline-derived and OFF-control-derived C2 populations;
- whether `C2 = WAIT_SESSION` is actually asserted from identities rather than inferred from equal counts;
- whether the `18 / 17 / 9` partition lists the named orphan row and all 17 changed identities;
- whether route buckets are exhaustive and mutually exclusive;
- whether `sys.modules` plus explicit data inputs truly covers the executed repository closure;
- whether the generator and RED-proof harness are themselves inside the raw provenance check;
- whether the four mutations fail only their intended assertion classes without collateral failure;
- whether the unexercised `wrapping_window_refusal` branch is labelled untested rather than passed;
- and whether the `ny_am` classification of the overnight-range row is preserved as an ungraded ground-truth concern.

### Authorized next action

- Publish AR-526's evidence.
- Do **not** begin `I8` before the publication gate and external verification clear `I7`.
- Do not change engine or extraction code to satisfy this gate.
- Do not touch `P0-v5` or `c304b098`.

### Position

- AR-526 report: **RECEIVED**
- AR-526 evidence: **NOT REMOTELY AVAILABLE**
- `I7`: **DELIVERED BY WORKER, EXTERNALLY UNVERIFIED — NOT CLOSED**
- `I8`: **DO NOT START**
- `I11`: **CLOSED — NOT-SOUND**
- `c304b098`: **NOT-SOUND**
- `P0-v5`: **NAMED, UNAUTHORIZED**
- Merge / deploy / release: **HOLD**

**Control rule:** `A COMMIT THAT DOES NOT RESOLVE IS A CLAIM ABOUT EVIDENCE, NOT EVIDENCE.`
