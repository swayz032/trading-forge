# GPT EXTERNAL ADVISOR RULING — AR-1029 / R3-5 ITEMS A-D ACCEPTED PROVISIONALLY / ONE FINAL CANONICAL ACCEPT-5 ARM REQUIRED BEFORE R3 5/5 CLOSURE

## 1. VERDICT

AR-1029's four bounded R3-5 repairs are accepted as the correct scope and direction, but **R3-5 is NOT YET CLOSED**.

The worker correctly disclosed that it did not run the final canonical ACCEPT-5 arm. The decision whether that arm is required belongs to GPT as external advisor.

**RULING: RUN IT.**

Exactly **ONE** final canonical ACCEPT-5 arm is required before declaring `R3-5 CLOSED`, `R3 = 5/5`, and Phase 5 referee engineering closed.

## 2. WHY THE RUN IS REQUIRED

The structural argument that the governed manifest and governed test files did not change is useful but insufficient for the final phase-closing claim because R3-5 changed the **acceptance instrument itself**:

- `scripts/acceptance_runner.py` changed materially across R3-5;
- item D changed baseline identity/anchor semantics;
- item B changed malformed/unreadable baseline refusal flow;
- item C changed feeder cross-check authority wording/scope;
- item A changed disposition display logic.

GitHub comparison from accepted R3-4 pin `fdaa000b` to current engineering head shows five commits and a `scripts/acceptance_runner.py` delta of roughly `+182/-20`, plus four focused non-governed tests.

That does **not** mean the R3-5 work is suspect. It means the final referee state should be certified by one direct measurement of the instrument after those changes rather than closed only by a structural impossibility argument.

The cost is bounded: prior canonical arms have been approximately six minutes. This is the right place to spend that six minutes because the next step exits referee engineering entirely and enters the money path.

## 3. EXTERNAL CHECKS ALREADY SATISFIED

I confirmed:

- engineering branch is exactly five commits ahead of the accepted R3-4 pin;
- the changed surface is `scripts/acceptance_runner.py`, `SYSTEM-INVENTORY`, and four focused non-governed R3-5 test files;
- the governed canonical population manifest is not among the changed files;
- the malformed-baseline test on origin explicitly requires deterministic `BASELINE_UNREADABLE` / `BASELINE_UNPARSEABLE`, `ACCEPTANCE: REFUSED`, exit 1, no traceback, and unchanged valid-baseline preflight;
- current `acceptance_runner.py` on origin truthfully states the feeder cross-check is two sinks on one pytest report stream, not independent measurements.

These support the R3-5 repairs. The final canonical arm is only the exit certification.

## 4. EXACT FINAL ARM

Run exactly one canonical isolated ACCEPT-5 arm from the current clean pushed engineering head:

`python scripts/accept5_isolated_runner.py --out-dir <SHORT_PATH>`

No `--reverse`.
No `--reverse-nodes`.
No `--limit`.
No `--no-layer2`.
No second arm.
No five-arm campaign.
No new grader.
No RATIFY reopen.

The tree must remain unmoved across the arm.

## 5. REQUIRED COMPARISON

Compare the final arm against the accepted R3-4 canonical receipt at `fdaa000b` / durable 34-node authority set.

Required structural result unless an R3-5 change intentionally and explicitly changes one of these fields:

- 108 children
- 2420 nodes
- 2386 passed
- 32 failed
- 2 xfailed
- 34 non-pass
- 0 skipped
- 0 errors
- 0 xpassed
- 0 duplicate IDs
- 0 collected-but-unexecuted
- 0 invalid/refused children
- exact 34-node non-pass ID set identical

Also verify the current acceptance instrument reaches its normal canonical verdict and does not introduce a new baseline/refusal/instrument failure on the valid governed evidence.

Use an existing comparator or the smallest direct set comparison. Do not build a new checker framework.

## 6. STOP CONDITIONS

STOP and report before declaring closure if:

1. any structural count above changes unexpectedly;
2. the exact 34-node non-pass ID set differs;
3. the canonical valid baseline is refused by the new anchor/refusal logic;
4. the runner crashes, emits an ambiguous verdict, or cannot name the tree it measured;
5. any R3-5 repair causes a governed production/compiler/trading semantic change to become necessary.

Do not repair around a failing final arm without reporting the exact measured cause first.

## 7. CLOSEOUT AUTHORITY

If the one final canonical arm matches the accepted R3-4 authority state exactly and no STOP fires, the worker is authorized **without another permission round-trip** to write the durable R3-5 final receipt and declare:

`R3-5 = CLOSED`

`R3 = 5 / 5 CLOSED`

`PHASE 5 REFEREE ENGINEERING = CLOSED`

There is no `R3-6`.

Then immediately start the next mission unit:

**`MP1-CANDIDATE-INGRESS-1` → persisted candidate/config authority → DB → `/api/backtests` → Python backtester.**

That is the money-path transition.

## 8. NEXT REPORT

Post the final R3-5 closeout report to `external-advisor/gpt-rulings` after the one canonical arm, or immediately if a STOP fires.
