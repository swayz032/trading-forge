# EXTERNAL READ — 2026-08-08 — AR-808 ACCEPTED; FALSE SUCCESS CONFIRMED; STOP PHASE A, GO TO PHASE B

> **PROVENANCE:** Arrived as **OPERATOR-RELAYED CHAT**, 2026-08-08, in response to `AR-808`.
> **NOT** from `origin/external-advisor/gpt-rulings` (stale at `953a907c`, 2026-08-02).
> ✅ **CONSUMED BY `R-725`** — banner written BY that ruling, IN its commit, never in advance
> (`R-722 §1`). **It was held uncommitted for ~15 minutes** because `AR-809` had landed after it and
> no read had seen `AR-809`; the operator's standing order (asserted `5×`) is wait-before-ruling.
> **Released once reads on `AR-809`–`AR-812` arrived.** ★ **The hold is recorded because it is the
> first time this desk exercised the wait rather than discovering afterwards that it had not.**
>
> 🛑 **ONE ORDER OF THIS READ WAS REFUSED AND IS NOW MOOT:** its `SOURCE_BASELINE_STATUS =
> UNKNOWN_NOT_PROVIDED` rested on *"this advisor has not been supplied a frozen transcript"* — true of
> the READER, false of the CAMPAIGN (`R-724 §2`, re-verified by `AR-809`). **The `AR-809` read then
> corrected itself unprompted: *"TRANSCRIPT BLOCKER CLEARED."*** ★ `AN ORDER DOES NOT INHERIT ITS
> PREMISE'S GRADE` — and the reader reached the same place once it held the evidence.
>
> 🛑🛑 **ONE ITEM OF THIS READ IS REFUSED, AND THE REASON IS A REFUTED PREMISE, NOT A DISAGREEMENT.**
> Its `TRANSCRIPT RULING` orders `SOURCE_BASELINE_STATUS = UNKNOWN_NOT_PROVIDED`. **That premise —
> *"this advisor has not been supplied a frozen transcript"* — is true of the READER and false of the
> CAMPAIGN.** `R-724 §2` located it and **`AR-809` independently re-verified all three joins**
> (`sha256 eaf54253…`, blob `d36e688d`, tracked). **Recording `UNKNOWN_NOT_PROVIDED` would write a
> known falsehood into our own ledger because our reader lacks a file we hold.** ⇒ `R-725 §3` adopts
> the *"stop repeating the ask"* half and **refuses the status value**. ★ `AN ORDER DOES NOT INHERIT
> ITS PREMISE'S GRADE.`
>
> ⚠️ **TIMING:** this read saw `AR-808`. **`AR-809` landed after it** and settles two things it left
> open. **A CHANNEL IS NOT AN AUTHOR** — audited on merit in `R-725`.

---

GPT EXTERNAL ADVISOR RULING — AR-808 ACCEPTED; FALSE SUCCESS CONFIRMED AND PHASE A MUST NOW STOP

DECISION: ACCEPT FINDING. DO NOT TRACE THE REMAINING EIGHT CONDITIONS YET. TRANSITION TO PHASE B.

AR-808 proves that the golden slice's only reported exact binding is not faithful:

- it computes a different concept;
- it cannot accept the taught half-range value;
- its result does not control entry or exit;
- yet it is reported as `BINDS` with `approximation=False`.

That violates the V1 contract directly.

`n_taught_binds = 1` remains arithmetically correct, but it is not an executable-fidelity measurement. For the three traced conditions, the faithful executable count is currently:

`0 / 3`

The golden strategy must remain refused.

EXACTNESS RULING

Reusing an audited primitive does not establish semantic identity.

A taught condition may count as `BINDS` only when all of these are true:

1. The primitive computes the same concept.
2. Every required source parameter reaches it.
3. Its output reaches the intended runtime decision.
4. A meaningful source-rule mutation changes that decision.
5. No framework-owned substitute is represented as the taught rule.

A trace-only, non-gating value cannot count as a taught executable binding.

IMMEDIATE CONTAINMENT — NARROWLY SCOPED

Before positive-path implementation, freeze one RED fixture using the real golden artifact that demonstrates:

- current status is `BINDS`;
- current exactness is `approximation=False`;
- the structural selector cannot produce the opening-range midpoint by identity;
- the returned value does not drive the source exit.

Required controls:

- Hold opening-range high/low constant and mutate swing/OB/FVG candidates: the taught half-range stop must not move.
- Hold structural candidates constant and mutate opening-range high/low: the taught half-range stop must move.
- Prove the harness can observe a genuinely gating exit decision.

Then make the smallest fail-closed correction:

- this row must become `ENGINE_PRIMITIVE_WRONG_IDENTITY` or an equivalently precise measured refusal;
- if an internal state is needed, use `TRACE_ONLY_NON_GATING`;
- it must not contribute to `n_taught_binds`;
- `approximation=False` must not survive;
- the strategy must remain non-executable.

Do not audit every non-gating handler. Correct only the measured golden-path false success and preserve the fixture permanently.

PHASE B POSITIVE TARGET

After containment, repair the foundational condition first:

> Construct the taught opening range from its exact clock window and expose its high, low, completion state, and midpoint through a typed production path.

This dependency comes before the breakout and half-range stop. Row 3 confirms why: the stop cannot be faithful until the opening-range state exists.

The Phase B chain must be:

real frozen artifact
→ typed opening-range instruction
→ exact clock/timezone parameters
→ range-construction evaluator
→ deterministic range high/low
→ completed-range state
→ production consumer

Require:

- RED before implementation;
- GREEN after implementation;
- no named-session substitution;
- no hand-built binding replacing the real artifact;
- no invented teacher parameters;
- an independent negative control;
- mutations to start time, end time or duration, timezone, and range prices that fail conformance.

Any interval-boundary or trading-date convention not explicitly taught must be labeled as a framework-owned market-data convention, never as teacher provenance.

WHAT HAPPENS TO THE OTHER EIGHT ROWS

Defer them until Phase C, after one genuine condition works through production.

Tracing all eight now would repeat the exact horizontal-audit delay the accelerated plan was created to stop.

TRANSCRIPT RULING

Stop repeating the transcript request in every report.

This advisor has not been supplied a frozen transcript. Record one durable blocker:

`SOURCE_BASELINE_STATUS = UNKNOWN_NOT_PROVIDED`

Run one bounded authoritative locator or acquisition task before V1.0 certification. Its absence limits source-level certification but does not block artifact-to-engine Phase B work.

FINAL POSITION

The calibration has answered the causal question.

Trading Forge currently has:

- preserved prose;
- unsafe type-driven neighboring substitutions;
- a false exact-binding classification;
- no faithful executable condition among the three traced rows.

The next breakthrough task is no longer more diagnosis.

It is:

> Fail closed on the false stop binding, then make the real frozen opening-range instruction become the first semantically identical, parameter-complete, decision-affecting production binding.
