# AR-1032 — WORKER — `MP1-CANDIDATE-INGRESS-1` RED→GREEN COMPLETE · THE AUTHORITY THAT PROVES A CANDIDATE HAD ZERO NON-TEST CALLERS

```
RULING : AR-1031 (gpt-rulings f98dc291) §4 REPAIR A/B/C/D, §5 controls 1-6
PIN    : 4f5a5815  h1-wave4-sealed12-driver   (parent 3be07ddc, the ruling's pin)
STATE  : MP1-CANDIDATE-INGRESS-1 implemented and proven end-to-end. No STOP fired.
SEAT   : fresh worker seated 02:02, per AR-1031 §1. No handoff.
```

## 0. PRE-FLIGHT — AND ONE CONTRADICTION THAT WAS NOT ONE

`advisor-ruling` §0.-2 pre-flight run against `AR-1030` first, then re-run against `AR-1031`
when the ear fired mid-work. **No contradiction; executed without a round-trip.**

⚠️ **One premise in `AR-1031 §2A` arrived `RELAYED` and is now `[MEASURED HERE]`:** that
`compiled_spec.spec_hash` is available as the parent anchor. **Confirmed** at
`spec-onboarding-service.ts:896-898` (`compiled_spec: { …, spec_hash: specHash }`), a sibling of
the three candidate fields written at `:929-935`. ⇒ **`STOP [3]` does NOT fire**: the persisted
sidecar does contain enough to bind to its parent without guessing.

## 1. THE FINDING THAT CHANGES THE SHAPE OF THE REPAIR

`AR-1031 §2D` said the Python validator "already exists elsewhere". It is stronger than that.

**`[MEASURED HERE]` `resolve_row_for_execution` had ZERO non-test callers, and so did
`resolve_execution_candidate` outside its own module.**

```
$ grep -rn "resolve_row_for_execution" --include=*.py . | grep -v __pycache__
  opening_range_candidate_persistence.py:164   <- the definition
  opening_range_candidate_persistence.py:41,81 <- its own docstrings
  tests/test_mp1_candidate_persistence.py:94,219,236,250,286   <- tests only
```

The whole candidate-authority chain — 25 tested obligations, six anchors, a docstring that
literally reads *"The execution entry point"* — terminated in a function nothing in production
called. This is the dormant-activation class, not a missing-capability class.

★★★★★ **`AN IDENTITY PROVEN AT MINT AND UNREAD AT USE IS NOT AN IDENTITY — IT IS A COMMENT.`**

⚠️ **AND ONE CORRECTION TO `AR-1031` (the worker trace), stated before it becomes a premise.**
That trace flagged that `fullConfig` "may carry the identity implicitly by spread". **REFUTED,
measured:** `config` at `backtests.ts:157` is built from `...rest` of the **request body**
(`backtestRequestSchema` has no candidate field), and the DB-derived `resolvedStrategy` at
`:187-197` is an **explicit nine-field whitelist**. Nothing rode along. GPT reached the same
conclusion independently at `§2B` ("the sidecar is actually dropped") — two paths, one answer.

## 2. WHAT LANDED — `4f5a5815`, four files, `backtester.py` a PURE addition (0 deletions)

| | |
|---|---|
| **REPAIR A** | `backtests.ts` lifts the four DB-authoritative values out of `strategies.config` into the config handed to `runBacktest`. Partial sidecar, or missing `compiled_spec.spec_hash`, ⇒ `409 candidate_authority_incomplete`. Resolved **before** `_acquireBacktestSlot()` so a refusal never leaks a concurrency slot. |
| **REPAIR B** | candidate-aware row + request-body `strategy` ⇒ `409 candidate_authority_conflict`, **before any Python spawn**. Neither side silently preferred. |
| **REPAIR C** | `backtester.py::main()` rebuilds a `CandidatePersistenceRow` and calls `resolve_row_for_execution` at the earliest boundary — config parsed, nothing else run. Failure emits the **existing** named REFUSED envelope (`execution_status == EXECUTION_STATUS_REFUSED`, the key `_execution_was_refused()` and its TS twin already test). |
| **REPAIR D** | a row with no candidate fields returns `{kind:"legacy"}` / `None` and spreads nothing. |

**No second validator, no re-canonicalisation, no receipt hashing, no new checker framework, no
DB migration, no change to `runPythonModule`.** The adapter converts a config dict to a row; the
authority module does every proof.

## 3. EVIDENCE

**RED 1 — at the real route boundary, as `§4` requires.** The test pulls the handler off
`backtestRoutes`' own Express layer stack and invokes it; it does not re-implement the
object-building logic.

```
7 failed | 2 passed
control 1: AssertionError: expected undefined to be 'cand-15m-bbbb2222'
control 2/3/3b: expected 202 to be 409
```
★ **The 2 passes were the legacy controls — the positive control that the harness genuinely drove
the route and genuinely built a config** (`strategy.entry_long === "close > open"`). Without them
the seven reds could have been a broken harness.

**GREEN.**

| suite | result |
|---|---|
| `mp1-candidate-ingress.test.ts` (route, controls 1,1b,2,3×3,3b,5,5b) | **9 / 9** |
| `test_mp1_backtester_ingress.py` (engine, controls 1,3×4,3b,4,4b,4c,5,6) | **11 / 11** |
| existing `test_mp1_candidate_receipt` + `_persistence` (the 25 obligations) | **25 / 25** |
| `tsc --noEmit`, whole repo | **0 errors** |
| 7 adjacent backtest suites | **59 / 59** |

**MUTATION RED-PROOF — the tests discriminate on BEHAVIOUR, not on the code existing.**
Neutering the gate (`return None` at the top of `validate_candidate_authority`) kills **9 of 11**.
The 2 survivors are exactly control 1 and control 5, the *"proceeds"* assertions, which **should**
survive a gate that allows everything. Re-run after control 6 was rewritten (`[red-path-decay]`):
still 9/11. Restored, mutant count 0, back to 11/11.

**CONTROL 6 — transport witness, real transport.** Config written to a real JSON file and read
back by the real `main()` (the path `python-runner.ts` uses). One field mutated in transit
(`cache_identity`) is visible at Python validation and **attributable** — the refusal detail names
`cache_identity`, not merely "something failed". Arm B, untampered, same transport, is **not**
refused.

⚠️ **`bt.main` is a `click.Command`** — `.callback` is used, per `[main-spy-both-arms]`.

**REFUSED BEFORE MARKET DATA — proven, not asserted.** `load_ohlcv` is stubbed to record-and-raise,
so "did execution get past the gate" is a **direct observation** rather than an inference from a
downstream error string. Arm A: `reached_market_data is False`. Arm B: `True`.

## 4. MY OWN MISTAKES, SURFACED (`0-CTRL.4`)

**Nothing here changes the result; all three were caught and corrected before the commit.**

1. **I inserted the Python block between the `@click` decorator stack and `def main`,** breaking
   the module (`SyntaxError`). My `grep -B4` for a decorator was too shallow and saw only the
   stack's closing paren. **`[main-spy-both-arms]` had warned me `main` was a click command and I
   moved past it too fast.** Relocated above `@click.command()`; `ast.parse` clean.
2. **My first arm B was a weak witness.** It inferred "got past the gate" from a downstream
   `BacktestRequest` sizing error — which only appears when `TF_ALLOW_FIXED_1` is unset. Under
   pytest, `src/engine/conftest.py:29` sets it, so arm B ran on to a **live S3 fetch** and produced
   no stdout. **The positive-witness assertion I had just added is what caught it.** Rewritten to
   the `load_ohlcv` sentinel above: offline, deterministic, order-independent (verified standalone
   **and** combined).
3. 🛑 **I ran `ruff check --fix` on `backtester.py` to satisfy the pre-commit hook and it applied
   77 fixes across the whole file** — `Optional[X]`→`X | None`, `timezone.utc`→`UTC`, ~140 lines of
   unrelated rewrite of a central production file. **Reverted in full** from a pre-ruff copy, then
   the single `I001` fixed by hand (alphabetising three imported names). **Verified: the committed
   `backtester.py` has 0 deletions vs `HEAD`.** The hook then passed on its own terms — no
   `--no-verify`.

## 5. WHAT I DID **NOT** MEASURE — read this before relying on anything above

- **Nothing was run against a live database or a live `/api/backtests`.** The route proof drives
  the real handler with a stubbed `db`. The DB→route hop is proven by *contract* (the exact keys
  `spec-onboarding-service.ts` writes), not by a round trip through Postgres.
- **No full backtest ever executed with a candidate attached.** Control 6 arm B proves execution
  reaches market-data loading; it does **not** prove a candidate-aware backtest produces correct
  trades. That is `OR-STATE-HANDOFF-1` / full OR V1.0, deliberately out of scope per `§3`.
- **The candidate is proven, then not yet *used*.** `resolve_row_for_execution` returns an
  `OpeningRangeExecutionCandidate` and MP1 discards it after proving it. Trading semantics are
  unchanged by design (`§3`, `STOP [1]`/`[2]`). **The engine now refuses an unprovable candidate but
  does not yet trade a proven one differently.**
- **One pre-existing fail-open I did not change, and am flagging rather than fixing:**
  `backtests.ts` catches a DB read failure and, if the request supplied `strategy`, proceeds with
  `stratConfig` undefined ⇒ the row reads as legacy and REPAIR B cannot fire. **A DB outage plus a
  request-side `strategy` therefore still bypasses candidate authority.** It is pre-existing
  behaviour and outside the authorized seam; closing it changes an existing production contract
  (`STOP [5]`'s shape). **Recommend GPT rule on it separately.**
- **Three pre-existing test failures** (`test_accuracy_fixes` ×2, `test_compile_lints` ×1) appear
  in a combined run and pass standalone — order dependence, the banked `ACCEPT5-TEST-SIDE-EFFECT-1`
  class. **Measured identical (`3 failed / 102 passed`, same three IDs) against a pristine
  `backtester.py` swapped in from `HEAD`. Not caused by this change.**
- **`EDGE-HTF-PASSTHROUGH-AUTHORITY-1` untouched** (`§7`). The nine-field whitelist at `:187-197`
  is unchanged; I did not solve it by stealth and it did not become load-bearing.

## 6. NO GRADE WAS DISPATCHED, AND THAT IS A DECISION I AM SURFACING

`AR-1031 §10` asks for a report after RED→GREEN, and **does not require an independent grade**.
`0-CTRL.2` pre-authorizes dispatch only when the ruling requires one, so I did not spend one.
**Everything in §3 is mechanical and re-executable from the pin; none of it is a graded judgment.**
⇒ **If GPT wants `accuracy-validator` on this seam, say so and I dispatch it with a DISPROVE
mandate.** The obvious attack surface to hand it: *"prove the route test can pass while the real
production route drops the sidecar."*

## 7. ARTIFACTS

```
COMMIT      4f5a5815  (parent 3be07ddc — the ruling's pin, unchanged beneath it)
BRANCH      h1-wave4-sealed12-driver          [NOT pushed — this report is a deliberate
                                               single-file publish, R-840 §7]
PRODUCTION  src/server/routes/backtests.ts    (+139/-3)
            src/engine/backtester.py          (+135/-0, pure addition)
TESTS       src/server/routes/__tests__/mp1-candidate-ingress.test.ts   (+283, new)
            src/engine/tests/test_mp1_backtester_ingress.py             (+299, new)
```

**Reproduce:**
```bash
npx vitest run src/server/routes/__tests__/mp1-candidate-ingress.test.ts
python -m pytest src/engine/tests/test_mp1_backtester_ingress.py \
                 src/engine/tests/test_mp1_candidate_receipt.py \
                 src/engine/tests/test_mp1_candidate_persistence.py -q
npx tsc --noEmit
```

## 8. EXIT CONDITION — `§9`, CLAIMED AGAINST ITS OWN WORDING

> *persisted candidate row → `/api/backtests` DB-authoritative sidecar → `runBacktest` → existing
> Node↔Python config transport → Python authoritative candidate validation → named REFUSED on
> mismatch / normal continuation on exact match, with legacy behavior unchanged.*

Each hop is proven above **except** the literal `strategies` table read, which is contract-proven
rather than round-tripped (§5, first bullet). **I am not calling that "end-to-end through a live
DB", and GPT should decide whether the contract proof suffices to close the unit.**

The ear stays armed on this branch. Standing by for the ruling on §5's fail-open and §6's grade.
