# EXTERNAL READ — external `R-752`, 2026-08-09 → adopted as campaign `R-752`

> **BANKED VERBATIM per `R-751 §10`.** Campaign `R-752 §5` adopts `§6` items `1`–`7` and `§7`
> controls `A`–`E` **BY REFERENCE**, with four desk amendments. **A 7-item contract summarised
> is a contract with items missing — execute from THIS file, not from the ruling's prose.**
>
> 🛑🛑 **NUMBERING — THE OFFSET COLLAPSED TO ZERO.** External reads ran `R-750..R-755` against
> campaign `R-747..R-751` (offset reaching FOUR). **This read titles itself `R-752` and maps to
> campaign `R-752`.** ⚠️ **A seat applying the carried "offset four" would mis-join this to
> campaign `R-748`.** ★★★★★ **`A CORRECTED OFFSET IS MORE DANGEROUS THAN A CONSTANT ONE — THE
> STALE RULE STILL PRODUCES A VALID-LOOKING RULING NUMBER.` NAME THE CARRIER.**
>
> ⚖️ **ADOPTED ON MERIT.** The desk CONFIRMED `§4` independently before adopting (campaign
> `R-752 §3`, three measurements). ⭐ **`§3` of this read also CORRECTED THE DESK'S OWN FALSE
> CORRECTION** — see campaign `R-752 §1`, a full retraction.

---

## VERBATIM

GPT EXTERNAL ADVISOR RULING — AR-853 PASSES AT THE PYTHON BOUNDARY, BUT THE TYPESCRIPT SERVICE STILL TURNS "REFUSED" INTO "COMPLETED"

R-752 · 2026-08-09

I CHECKED THE PUSHED REPOSITORY AND THE ACTUAL CROSS-LANGUAGE MONEY PATH.

REMOTE IDENTITY VERIFIED

Repository: swayz032/trading-forge
Branch: h1-wave4-sealed12-driver
Remote head: 186f22cdfea4ea9d5a2d275af2acbbc78e5270fd
Branch versus 186f22cd: IDENTICAL
Commit versus base 33921307: one commit ahead

Changed production surface:
- src/engine/backtester.py

Changed controls:
- src/engine/tests/test_trigger_safety_refusal.py
- committed 33-member acceptance baseline

GitHub exposes no CI statuses on this SHA. The worker's test totals remain worker-measured until the independent grade executes them.

§1 — ACCEPTED: THE PYTHON REFUSAL IS NOW TERMINAL

Repository inspection confirms:

- `_execution_was_refused(result)` uses semantic `execution_status == REFUSED`.
- No fake `error` key is added.
- The refusal trace is no longer overwritten by `strategy.last_trace`.
- Stress, crisis rescoring, invariants, parity shadow and B15 are guarded against refusals.
- `crisis_results=None` is no longer stamped on the pipeline refusal path.
- `forge_score`, `forge_score_components`, `invariants`, `parity_shadow` and `b15_battery` remain absent.
- The omissions are named through `analysis_omitted`.
- Both ordered mutation controls and the eligible-neighbour control exist.

R-751 §8 is ACCEPTED at the Python `main()` boundary.

§2 — ACCEPTED: THE BASELINE IS NOW REAL

The baseline is committed at:

docs/replay-results/h1-battery/acceptance-baseline-2026-08-09.json

It contains:

- the 103-member manifest identity;
- exact invocation and path root;
- all 33 failure node IDs;
- both expected 6B REDs named;
- the measured SHA discrepancy and byte-equivalence explanation.

R-751 §7 is ACCEPTED.

§3 — THE EXPECTED-SIGNALS CHANGE IS FAIL-CLOSED, VERIFIED FROM TYPESCRIPT

The worker left this `[UNVERIFIED AT THE TS BOUNDARY]`. I opened both consumers.

`shadow-signal-divergence-loader.ts` converts missing or empty `expected_signals` into an empty baseline.

`shadow-signal-divergence-checker.ts:192-199` then returns:

    ok: false
    reason: backtest_baseline_unavailable

Therefore removing `expected_signals` from a refused result does not weaken SHADOW→PAPER. It blocks promotion with the correct reason.

That part is independently verified and needs no repair.

§4 — NEW BLOCKER: TYPESCRIPT DOES NOT UNDERSTAND REFUSAL

The production service contains zero reads of `execution_status`.

At `backtest-service.ts:807-829`, the Python envelope gate checks only:

- `result.error`; and
- top-level `result.status`.

A deliberate refusal carries neither.

The service therefore proceeds into the normal successful-backtest path:

- line 832: treats the refusal as metrics;
- line 979: writes database status `completed`;
- line 1631: increments the completed-backtest counter;
- line 1633 onward: records completed-backtest provenance;
- line 3242: returns `{status: "completed", ...result}`.

No Forge score or tier means most promotion branches happen not to fire. That is not an enforced refusal contract. It is accidental safety caused by missing fields.

The current cross-language result says, in effect:

    Python:     execution_status = REFUSED
    TypeScript: backtest status = completed

Both cannot be true.

A REFUSAL THAT BECOMES "COMPLETED" AT THE NEXT SERVICE BOUNDARY IS NOT TERMINAL. IT IS TERMINAL ONLY INSIDE ONE PROCESS.

§5 — RULING

AR-853 is accepted as complete within its authorized Python scope.

Overall production money-path terminality is:

    Python boundary:      COMPLETE
    TypeScript consumer:  INCOMPLETE
    Fan-in:               1 / 2

Accuracy-validator is HELD.

The state-channel checkpoint remains HELD.

Grading 186f22cd now would knowingly grade a cross-language contradiction and create another avoidable grade cycle.

§6 — D-8 IS AUTHORIZED NOW: ONE BOUNDED TYPESCRIPT REFUSAL BRANCH

Implement one early refusal branch in `backtest-service.ts`.

It must execute immediately after the existing Python crash/envelope validation and before:

    const metrics = result.oos_metrics ?? result

Required behavior:

1. Recognize `result.execution_status === "REFUSED"` explicitly.

2. Do not convert the refusal into:

   - `error`;
   - `failed`;
   - `completed`;
   - `REJECTED`;
   - a zero-trade result.

3. Persist a distinct backtest status of `refused`.

The database column is free text, so this does not inherently require a database migration. Update the schema comment and any closed TypeScript status union reached by the focused consumer check.

If a measured consumer makes adding `refused` materially broader than this boundary, STOP and report it. Do not silently substitute `failed` or `completed`.

4. Persist the refusal evidence, not just the status:

   - execution_status;
   - entry_eligible;
   - refusal condition ID;
   - disposition;
   - reason;
   - ambiguity or missing capability;
   - metrics_omitted;
   - analysis_omitted;
   - spec_trace;
   - governance labels.

Use `resultExtras` or another existing evidence carrier. Do not put the refusal reason in `errorMessage`.

5. Return:

    { id, status: "refused", ...refusalResult }

6. Emit a refusal-specific audit/SSE event.

A successfully enforced refusal may produce a successful audit event, but it must not produce `backtest.run = success`, `backtest:scored`, or `backtest completed`.

7. The refusal branch must return before:

   - completed-result transaction;
   - trade persistence;
   - completed provenance;
   - Forge scoring;
   - performance gates;
   - Monte Carlo;
   - SQA;
   - QUBO;
   - tensor evaluation;
   - RL training;
   - lifecycle promotion.

§7 — REQUIRED CONTROLS

A. REFUSAL PATH

Feed the service the real Python refusal-envelope shape and assert:

- database status is `refused`;
- returned status is `refused`;
- no error key or error message;
- refusal evidence is durably persisted;
- all metric columns remain null;
- no trades are inserted;
- completed counter is not incremented;
- no completed provenance is written;
- no scoring, qualification or promotion consumer runs.

B. POSITIVE CONTROL

An eligible neighbouring strategy must still:

- persist as `completed`;
- reach its existing analytical path;
- preserve its current result contract.

An engine that marks everything refused is not a repair.

C. EXPECTED-SIGNALS CONTRACT

Execute the actual TypeScript comparator with an absent baseline and assert:

    ok == false
    reason == backtest_baseline_unavailable

This converts my repository read into a permanent control.

D. MUTATION

Remove or disable the TypeScript refusal branch.

The test must turn RED because the refusal is persisted or returned as `completed`.

E. EXISTING ACCEPTANCE

- Python trigger-safety suites remain green.
- The committed 33-member Python failure set remains identical.
- The two ordered 6B REDs remain RED.
- Focused TypeScript tests and typecheck pass.
- No full-repository repair or unrelated TypeScript sweep.

§8 — SCOPE LOCK

DO NOT:

- merge or replay f788c64b;
- resume the state channel;
- repair the other 31 baseline failures;
- invent the breakout confirmation;
- redesign the backtest lifecycle;
- add a broad status framework;
- run edge qualification;
- grade the current 186f22cd SHA.

This is one cross-language handoff branch, one positive control and one mutation.

§9 — GRADE RELEASE

Once D-8 is:

- committed;
- pushed;
- remotely verified;
- green on the focused Python and TypeScript controls;
- equal to the committed 33-member Python baseline;

the independent accuracy-validator is automatically authorized against that new immutable SHA. No additional desk wait is required.

The worker must not grade its own work.

The grade must inspect the complete path:

    frozen extraction
    → Python classification/refusal
    → Python public result
    → TypeScript service
    → persisted backtest status/evidence
    → no scoring or promotion

§10 — FAST-ENGINEERING POSITION

This remains the fastest correct plan.

We are not starting another architecture project. We found one missing translation at the Python→TypeScript border.

Simple English:

Python now says "I refused this strategy" correctly.

But the next service still files it as "completed."

Add one small refusal lane so both sides agree. Then grade once. After that, resume the final state-channel work.

Distance to the compiler breakthrough:

- one small TypeScript refusal commit;
- one independent grade;
- then the held state-channel integration and final source-to-engine proof.

This is still a bounded finish, not a redesign.

---

## DESK NOTES (`R-752`)

- ✅ **`§4` CONFIRMED BY THE DESK, THREE WAYS** (`R-752 §3`): zero production TS reads of
  `execution_status` · the envelope gate keys on `status`, a DIFFERENT KEY from
  `execution_status`, so both disjuncts are false and control falls through · `:979` writes
  `completed`. ★ **Desk addition the read did not make: `_PYTHON_ENVELOPE_KNOWN_SUCCESS` is an
  EMPTY SET and the guard's own comment claims it catches new status values — it catches new
  VALUES, not a new KEY NAME.**
- 🛑 **`§3` CORRECTED THE DESK, NOT THE WORKER.** The desk had published that `AR-853 §3` was
  "backwards"; it was the DESK that read the wrong file (`shadow-divergence-writer.ts`, a
  WRAPPER, instead of `shadow-signal-divergence-checker.ts`, the GATE). **Full retraction at
  campaign `R-752 §1`.** ⇒ **`§7` control `C` is PROMOTED TO REQUIRED so this is settled by an
  executing test rather than by a third repository read.**
- ⚠️ **UNVERIFIED BY THE DESK:** the read's line-level citations `:832`, `:1631`, `:1633`,
  `:3242` were **not individually opened** — `:807-829` and `:979` were. **The conclusion is
  confirmed; four of its line numbers are `[RELAYED]`.**
