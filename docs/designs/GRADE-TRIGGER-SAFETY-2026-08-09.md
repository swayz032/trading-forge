# GRADE — TRIGGER-SAFETY REFUSAL PATH (AR-851 / AR-853 / AR-856, `D-8`)

**Grader:** `accuracy-validator`, independent. I did not build any of this and take no part in its authorship.
**Pin under grade:** `16224ef5cf8bc03ed47f3fd524a18e32a0d25004` (`D-8`).
**Status of this file:** UNCOMMITTED, written into the shared tree. The desk commits it.
**Isolation:** every mutation ran in `C:/Users/tonio/Projects/wt-grade-d8`, a worktree I added at the
pin, plus `C:/Users/tonio/Projects/wt-grade-d8-parent` at `f7aefaa6` for before/after joins. No
`git stash`. No checkout/reset in the shared tree. `wt-pre6b` / `wt-6b-wip` untouched. The sibling's
`test_synthetic_market_simulator.py` untouched.

> 🛑 **HEAD MOVED DURING THE GRADE.** At start `HEAD == 16224ef5`. At close
> `HEAD == dd1759d4b1fe3292fe85aa77183f65b9a39d0a22` (5 commits: `84f986b3`, `7f8ad807`,
> `019caab2` (R-753), `62fd3b34`, `dd1759d4`). **`git diff --stat 16224ef5 dd1759d4 -- src/` is
> EMPTY** and all six blobs I graded are byte-identical at both SHAs (checked by `git rev-parse
> <sha>:<path>`), with a positive control (`f7aefaa6..ad0ffb4b -- src/`) proving the command can
> show changes. **This grade therefore describes the pin AND current HEAD for every graded file.**

---

## 1 — CRITERIA, STATED BEFORE THE VERDICT

Pre-registered before I ran anything:

1. **FAIL** if a refusal can reach any scoring/persistence/promotion surface on a path I can execute.
2. **FAIL** if the acceptance failure-set membership does not match the committed baseline.
3. **FAIL** if any of the six "repaired" tests asserts over a smaller record set than before.
4. **PASS_WITH_BOUNDED_FINDINGS** if the production behaviour holds under my own mutations but the
   *evidence apparatus* (controls, fixtures, captions) is weaker than it claims.
5. **PASS** only if I also find the controls sound as named.
6. Band 9 requires independent re-scan **plus** failure injection **plus** zero open HIGHs.

## 2 — VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| Trigger-safety refusal path (Python → TS → persistence), @`16224ef5` | **6** | **VERIFIED** | live Python `main()` envelope × 4 mode/stress + real TS service execution + 5 mutation re-runs + 103-member acceptance by membership + 7 vacuity negative controls + two independent consumer re-enumerations | 10 findings: **3 LIVE** (`F-8`, `F-9`, `F-10` conditional), 5 LATENT, 2 hygiene. **No path to capital.** |

### `PASS_WITH_BOUNDED_FINDINGS` — band 6

**The money-path safety claim holds.** A refusal is self-declaring, and I could not make one reach
a metric, a score, a trade, a transaction, a promotion, or a `completed` row. I attacked it with 5
mutations, a live cross-language join, and a malformed-envelope probe. **Nothing I found puts
capital at risk.**

🛑 **But "TERMINAL ALONG THE ENTIRE PATH" IS REFUTED AS STATED, at two live consumers one hop
outside the graded file** — and both were affirmatively excluded by `AR-856 §3`'s enumeration:

- **`F-8`** — the CANDIDATE conveyor re-selects a refused strategy **every 45 seconds, forever**, and
  counts each refusal as a *successful enqueue*. Full reachability spine measured end to end.
  **This is the third instance of the join-key family** `(D)` asked me to hunt.
- **`F-9`** — the critic evidence packet resolves "latest backtest" with **no status filter** and
  coerces a refusal's NULLs into `daily_pnls: []` and `total_trades: 0` — absence presented as
  measurement, on an operator-reachable route.
- **`F-10`** — shadow-rerun reports a refusal as a **CRITICAL "gate decision regressed"** finding.

**Band 6, not 7.** Band 7 requires residual risks *documented*; here the report affirmatively
claimed the class was empty (*"every consumer is an allowlist — so a new value cannot widen an
existing query"*) and a scheduled, reachable consumer widens. That is a missed surface, not a
declared residual. Band 6 rather than lower because the enumeration's *token-level* premise is
literally true, the safety property holds, and the Python-side work is genuinely strong.
Band 9 is excluded outright.

> ⚖️ **My own pre-finding assessment was band 7.** These two findings arrived from an independent
> consumer re-enumeration late in the grade and I re-derived the band rather than defending the
> first number.

---

## 3 — PER-CLAIM DISPOSITION

### (A) THE SIX SELF-INFLICTED TEST REPAIRS — **CONFIRMED_WITH_CORRECTION**

The repairs are faithful. I verified this **by value, not by reading the diff**: I ran the same
fixtures at the parent `f7aefaa6` and at the pin and compared the record sets.

```
PARENT minimal-spec trace len = 1     PIN minimal-spec entry_bars  = 1
PARENT record keys = ['approximation_used','bar_idx','conditions','direction',
                      'invalidations_recorded','spec_hash','ts']
PIN    record keys (minus record_kind) = IDENTICAL
PARENT cond ids = ['s1']              PIN cond ids = ['s1']
PARENT bar idx  = [None]              PIN bar idx  = [None]
```

Join keys: record count, record key-set, `condition_id` set, `bar_idx`. All equal.

**Vacuity negative controls** (a filter that empties a set leaves a green printout). I planted a
mutation in each test that must redden **iff** the assertion body executes over a non-empty set:

| test | plant | result |
|---|---|---|
| `test_exit_hint_never_appears_in_trace_gating_conditions` | raise inside loop | **RED** — body executes |
| `test_trace_record_carries_span_and_evidence_provenance` | raise inside `if bars:` | **RED** — body executes |
| `test_trace_shows_distinct_fvg_primitive_contributor_when_enabled` | raise before assert | **RED** — `fired_primitives={'fvg_native.compute_fvg_signal'}` |
| `test_trace_shows_distinct_levelzone_primitive_contributor_when_enabled` | raise before assert | **RED** — `fired_primitives={'levelzone_routing.retest_touch_check'}` |
| `test_semantic_6_...` schema loop | raise inside loop | **RED** — body executes |
| `test_entry_bar_trace_records_are_one_per_firing_bar` | `assert n_entries > 0` | **GREEN** ⇒ `n_entries=1` (direct measurement confirms `n_entries=1, len(bars)=1`) |

**None of the six is vacuous.** The renamed test was *strengthened* (it now also asserts exactly one
leading summary record). No assertion was deleted or loosened. Criterion 3 is met.

🛑 **CORRECTION 1 — `AR-851 §6.1` IS REFUTED.** It states the two skip-guarded tests *"began running
where they used to skip."* **MEASURED at the parent `f7aefaa6`: both PASSED — they were already
running.** The `if not strat.last_trace` guard never fired on these fixtures, because entry bars do
fire. The general law (`a skip condition keyed on emptiness is a reader of the shape too`) is sound;
the incident narrative attached to it is wrong. The error is in the *self-accusing* direction.

⚠️ **CORRECTION 2 — `F-5`, a PRE-EXISTING latent vacuity the repair faithfully preserved.** In
`test_semantic_6_trace_provenance_condition_metadata_unchanged`, `assert ids_off <= {"s1","s2"}` is
**vacuously true — `ids_off` is the empty set**, and empty ⊆ anything. Measured at both SHAs:

```
PIN     entry_bars OFF = 0   ids_off = set()      ids_on = {'s1','s2'}
PARENT  trace len  OFF = 0   ids_off = set()      ids_on = {'s1','s2'}
```

Identical before and after ⇒ **NOT a regression, NOT introduced here.** Reported because it is a
live assertion in the tree that cannot fail.

### (B) THE CROSS-LANGUAGE REFUSAL BRANCH — **CONFIRMED**, via a stronger path than the doer used

**Path 1 — static ordering.** The refusal returns at `backtest-service.ts:953`. Every downstream
consumer is strictly after it: `db.transaction` `:1099` · `forgeScore` write `:1114` ·
`insert(backtestTrades)` `:1244` · `broadcastSSE("backtest:completed")` `:1346` · `backtest:scored`
+ auto-promote `:1672–1726` · `backtestProvenance` `:1793` · `sqaOptimizationRuns` `:2030` ·
`monteCarloRuns` `:2185` · `quboTimingRuns` `:2260` · `tensorPredictions` `:2325` ·
`rlTrainingRuns` `:2480`.

**Path 2 — LIVE EXECUTION, and this is the one `AR-856 §7` said it did not do.** I captured the
envelope from the **real Python `main()` boundary** and pushed **that exact object** through the
**real TS service** (not the committed hand-assembled fixture):

```
[[JOIN traceON]]  returned="refused"  persisted=["refused"]  errorMessage=null
                  metricCols=[null,null,null,null,null,null]
                  sse=["backtest:refused"]  counters=["refused"]  txCalled=0
                  extras keys include spec_trace  -> true
[[JOIN traceOFF]] returned="refused"  persisted=["refused"]  errorMessage=null
                  metricCols=[null,null,null,null,null,null]
                  sse=["backtest:refused"]  counters=["refused"]  txCalled=0
                  spec_trace -> false (correctly absent)
```

`txCalled=0` ⇒ no completed-result transaction ⇒ no trades, no completed provenance. No
`backtest:completed`, no `backtest:scored`, no `strategy:promoted`. Reason is in `resultExtras`,
**not** in `errorMessage`. No fake `error` key. ✅ **This also exercises the `spec_trace` branch that
the committed fixture never reaches** — see `F-4`.

**Positive control — the neighbour genuinely completes.** By execution, not by the test's own
assertion: `[[PROBE]] returned status = "completed"`, `persisted statuses = ["completed"]`. The
engine does **not** refuse everything. (But see `F-1` — the test does not assert this.)

### (C) MUTATION / RED-PROOF DECAY — **CONFIRMED** (all five reproduce; one needed reconciliation)

Unmutated baseline at the pin: **`65 passed`**. Restored after every plant: **`65 passed`**,
`git status --porcelain` clean.

| # | mutation | claimed | **measured at pin** | disposition |
|---|---|---|---|---|
| M1 | delete `execution_summary` from the main path | 3 failed | **3 failed** | ✅ exact |
| M2 | refusal gate `if False:` | 2 failed | **13 failed** | ✅ reconciled — see below |
| M3 | revert gates to `"error" not in result` | 6 failed | **6 failed** | ✅ exact, same members |
| M4 | restore `if _spec_trace_enabled:` | 4 failed | **4 failed** | ✅ exact, all 4 boundary cases |
| M5 | TS `if (false && _executionWasRefused(result))` | 3 failed, defect verbatim | **3 failed**, `AssertionError: expected 'completed' to be 'refused'` | ✅ exact; CONTROL B stayed green |

**M2 reconciliation (a surprising result accusing my own instrument first).** 13 ≠ 2. I checked
which of the 13 existed at `AR-851`'s commit `ad0ffb4b`:

```
test_public_boundary_returns_the_refusal_trace_not_an_empty_list : at ad0ffb4b=0  at pin=1
test_a_refusal_reaches_no_analytical_surface                     : at ad0ffb4b=0  at pin=1
test_omitted_analysis_is_named_and_absent_never_zero             : at ad0ffb4b=0  at pin=1
test_the_refusal_is_not_disguised_as_a_crash                     : at ad0ffb4b=0  at pin=1
test_the_refusal_gate_precedes_both_run_paths_by_execution       : at ad0ffb4b=1  at pin=1
test_a_refused_strategy_reaches_none_of_the_three_consumers      : at ad0ffb4b=1  at pin=1
```

**Exactly 2 existed then — precisely the 2 claimed.** The other 11 were added by `AR-853`. The claim
was correct for its suite; the red path **widened**, it did not decay.

### (D) THE JOIN-KEY FAMILY — **CONFIRMED CLOSED** on the surfaces I could reach; no third LIVE instance found

I enumerated every `"error" (not) in result` occurrence in `backtester.py` and classified each by
whether its guard chain contains a refusal check:

```
:6178  guarded=0   if "error" not in result            -> _emit_validated_result (guards INTERNALLY at :6333)
:8466  guarded=0   if "error" not in result            -> governance_labels enrichment only
:8555  guarded=1   ... and not _execution_was_refused(result)
:8618  guarded=1   ... and not _execution_was_refused(result)
:8682  guarded=1   ... and not _execution_was_refused(result)
```

Both unguarded sites are benign: `:8466` stamps `governance_labels` (which a refusal *should*
carry — my live envelope shows `execution_refused: true` preserved), and its one risky sub-write
(`spec_trace`) **is** refusal-guarded at `:8484`. `:6178`'s risky write (`expected_signals`) is
refusal-guarded inside `_emit_validated_result` at `:6333`.

🛑 **BUT THE FAMILY IS NOT CLOSED. I FOUND THE THIRD INSTANCE — AND A FOURTH.** Both are one hop
*outside* the graded file, which is exactly where the first two lived relative to their predecessors:

- **`F-8` (LIVE, the answer to `(D)`)** — `candidate-backtest-conveyor-service.ts:106–121` infers
  "this strategy still needs a backtest" from the *absence* of a `completed`/`running`/recent-`failed`
  row. A refusal is none of those, so the strategy is perpetually eligible.
- **`F-9` (LIVE)** — `critic-optimizer` resolves the latest backtest unfiltered, then `?? []` / `?? 0`.
- **`F-10` (LIVE-CONDITIONAL)** — `shadow-rerun-service.ts:240` tests only `"skipped"`.
- **`F-7` (LATENT)** — `agent-service.ts:775/:791/:793` tests `result.status === "completed"` as a
  **binary** and would fabricate `errorMessage: "backtest failed"` — but Band C cannot dispatch on
  that path, so it is unreached today. **I graded this LIVE first and corrected it; see `F-7`.**

⇒ **Python side: family CLOSED (measured).** **TypeScript side: family OPEN — 3 live consumers, 1 armed.**
★ The pattern in all four: the two fixed defects were *inside* `backtester.py` and
`backtest-service.ts`. **Every surviving instance is in a CALLER of the fixed file.** After closing a
join-key defect, the next place to look is not deeper — it is one hop out.

### (E) ENUMERATION COMPLETENESS — Python half **CONFIRMED_WITH_CORRECTION**; TS half **REFUTED**

I re-derived `AR-853 §3` with **my own AST instrument**, and it closes the `[PARTIAL]` gap that
report honestly declared. `AR-853` found `_rescore_with_crisis` **by hand**; my PASS 3 finds it
mechanically by intersecting *module-wide functions that mutate their own parameters by subscript*
with *calls in `main()` receiving `result`*:

```
MODULE-WIDE PARAM MUTATORS (the complete population, n=2):
  _emit_validated_result: mutates param idx [0]
  _rescore_with_crisis:   mutates param idx [0]
```

**Exactly two, both accounted for**, both reached only under a refusal-checked guard
(`_rescore_with_crisis` at `:8584` and `:8605`, both `refusal-checked: YES`;
`_emit_validated_result` at `:8722` is unguarded at the call site but guards internally). ⇒ the
indirect half is now **`[MEASURED]`, not `[PARTIAL]`.**

⚠️ **CORRECTION — `AR-853 §3`'s table silently omits 8 direct writes.** My PASS 1 found
`result['avg_winner_to_loser_ratio']` `:8277` · `['tier']` `:8278` · **`['forge_score']` `:8287`** ·
`['run_receipt']` `:8296` · `['tp2_liquidity_*']` `:8351/:8354` · `['governance_labels']` `:8473` ·
`['backtest_id']` `:8608`, none refusal-checked. **All are harmless and I verified why by execution,
not by reading:** every one before `:8397` is discarded because the refusal branch *reassigns*
`result` to a fresh dict, and `:8473`/`:8608` write metadata a refusal should carry. My live
4-combination run confirms the emitted envelope has exactly **10** top-level keys and **no
`forge_score`**. The table's conclusion stands; its scope ("post-refusal-branch surfaces") was never
stated.

**TS half — `AR-856 §3` is REFUTED in its conclusion.** I re-derived the consumer enumeration
independently (63 `eq(backtests.status, …)` predicates across 28 files, cross-checked by two search
engines with a positive control and a negative control; 70 total column references; raw SQL and
Python `psycopg2` call sites swept separately). Results:

- **Its token-level premise is CONFIRMED:** zero `ne` / `notInArray` / `not(eq(` / `!=` / `<>` /
  `NOT IN` on `backtests.status` anywhere in `src/`. I verified the two `notInArray` occurrences are
  a comment (`schema.ts:187`) and a `vi.fn()` stub, and that every `ne(` call site targets a
  non-status column.
- 🛑 **Its conclusion — "so a new value cannot widen an existing query" — is REFUTED by `F-8`.** A
  `NOT EXISTS (… WHERE status = 'completed')` widens exactly as a denylist does. **The enumeration
  searched for a TOKEN CLASS and concluded about a SEMANTIC CLASS.**
- ⚠️ Two further surfaces its scope excluded, both real: `routes/backtests.ts:277`
  `if (status) conditions.push(eq(backtests.status, String(status)))` — **conditional**, so
  `GET /api/backtests` with no `status` param returns `refused` rows and projects the value at
  `:288`; and `lib/slumhouse/recipe-data.ts:72-78`, which takes the latest backtest **with no status
  filter**, so a refusal becomes "the latest result" with every metric column NULL.
- ✅ The three JS-side consumers that *do* branch are all fail-closed and safe:
  `monte-carlo-service.ts:84` and `quantum-mc-service.ts:150` **throw**, and
  `adversarial-stress-service.ts:209` skips with a warn — all on `!== "completed"`.
- ✅ **`AR-856 §3`'s "frontend not searched" disclosure is moot:** `src/client`, `src/web`,
  `src/frontend`, `src/app` **do not exist**; `src/dashboard` holds one `.tsx` with zero
  backtest-status references.

### (F) ACCEPTANCE POPULATION — **CONFIRMED** (membership), **with a reproducibility finding**

Population re-derived with the instrument's own `_regression_population(_SCAN_ROOT,
_CLOSURE_TARGETS)` — not by hand, not by glob:

```
path1 live AST derivation = 103   path2 committed manifest = 103   path3 baseline count = 103
path1 vs path2: EXACT MATCH    path2 vs path3: EXACT MATCH    path1 vs path3: EXACT MATCH
TAMPER CONTROL FIRED (comparison is real)     PREFLIGHT: resolved=103 missing=0
```

Acceptance run at the pin:

```
33 failed, 2322 passed, 5 skipped, 2 xfailed
observed failures = 33   baseline failures = 33
NEW (0):    GONE (0):    EXACT MEMBERSHIP MATCH: True     TAMPER CONTROL fires: True
ordered 6B RED still red: True  <- test_no_production_binding_routes_to_the_opening_range_adapter_yet
ordered 6B RED still red: True  <- test_no_typed_opening_range_output_contract_exists_in_production
```

**Failure membership matches member-for-member.** Both ordered `6B` REDs still RED by name (not
graded as defects, per the brief). The 31 pre-existing failures are genuinely pre-existing:
`git diff --stat f8273f41 f7aefaa6 -- src/` is EMPTY (verified with a positive control on a pair
that *did* change `src/`), so the baseline is valid at both SHAs exactly as `AR-853 §5` claims.

🛑 **`F-2` — totals do not reproduce: `2322 passed / 5 skipped` here vs `AR-856`'s `2324 / 3`.**
Reconciled exactly (2 tests move passed→skipped). Cause, MEASURED:

```
SKIPPED [2] src/engine/tests/test_spec_family_bindings.py:901: governed grade unavailable at
            .../docs/replay-results/blind-readjudication/blind-second-judge-LOCKED.json
```

That file **exists in the shared tree, is UNTRACKED (`git ls-files` returns nothing), and is absent
from any fresh checkout.** ⇒ **the committed acceptance baseline's totals are not reproducible from
the committed repository.** Membership is unaffected (the tests skip, they do not fail), which is
why the load-bearing claim survives.

### (G) THE `expected_signals` EPISODE — **CONFIRMED_WITH_CORRECTION**

**(i) Is the gate fail-CLOSED?** At `shadow-signal-divergence-checker.ts:192–199`, YES —
`backtestExpected.length === 0` → `ok:false, reason:"backtest_baseline_unavailable"`. Confirmed at
the executable line **and by mutation**: deleting that block turns the cited test **RED (exit=1)**,
so the gate has a path to red and test `4b` genuinely reaches it.

**(ii) Does the cited test reach the baseline gate, not `MIN_SAMPLE_SIZE`?** YES. `buildShadowSignals(20)`
with `MIN_SAMPLE_SIZE = 20`, and the test asserts `sample_size === 20` as its own positive witness
that it cleared the sample gate. The file runs **`20 passed`** — `AR-856 §2`'s count confirmed.

**(iii) Does removing the field change anything at that boundary?** **NO — confirmed at the
executable line in both consumers.** Absent and empty are literally the same branch:

```
shadow-divergence-writer.ts:76        if (!Array.isArray(rawExpected) || rawExpected.length === 0) return [];
shadow-signal-divergence-loader.ts:146  if (!Array.isArray(rawExpected) || rawExpected.length === 0) { ...; return []; }
```

🛑 **CORRECTION — the cited MECHANISM is incomplete, though the conclusion is right.** `AR-853 §3`
justified the removal with *"a missing field reaches the loader as null → [] → the gate BLOCKS."*
That is true of the **checker**. It is **not** the runtime path through the **writer**:
`shadow-divergence-writer.ts:145–176` returns early when the baseline is empty and
**never calls `compareShadowToBacktest` at all** — its own comment says
*"Fail-OPEN: write NULL + emit warn audit. Do NOT block the shadow path."* The conclusion
("removing the field costs no safety") holds regardless, because absent and empty are
indistinguishable at `:76` either way. **Right answer, partly wrong reason.**

### (H) THE DESK'S RETRACTION — **CONFIRMED, AND INCOMPLETE**

Third instrument (my own read of control flow at the executable lines, independent of both prior reads):

- The desk's **original** correction read `shadow-divergence-writer.ts` — which **is** fail-OPEN, by
  its own comment at `:56` and `:146` and by its early return at `:176`.
- The desk's **retraction** read `shadow-signal-divergence-checker.ts` — which **is** fail-CLOSED at
  `:192–199`.

**Both readings were correct about the file each read.** The retraction is **CONFIRMED** as to the
checker. It is **INCOMPLETE** as a disposal of the original point: the wrapper's fail-open early
return is a real production path that never reaches the checker's gate. Neither party was measuring
the same object — the classic `[i-measured]` shape, on both sides at once. **Materially this does
not endanger a refusal**, because `loadExpectedSignals` filters `eq(backtests.status, "completed")`
and a refusal now persists as `refused`, so it can never become a baseline.

### (I) `CONTROL B` DOES NOT PROVE ITS OWN NAME — **CONFIRMED** (see `F-1`)

### (J) THE SCHEMA-CONSTANT MOCK — **CONFIRMED** (see `F-3`)

### (K) MALFORMED REFUSAL EVIDENCE — **CONFIRMED** (see `F-4`)

---

## 4 — FINDINGS

### `F-1` — MEDIUM / **LIVE (control defect)** — `CONTROL B` has no path to red for the property it is named for

**Claim:** `backtest-service.deepscan8-fixes.test.ts:828`, *"CONTROL B — POSITIVE CONTROL: an
eligible neighbour still completes."*
**Reality:** its only status assertions are **both negative** (`:845` `not.toBe("refused")`, `:847`
`some(status === "refused")).toBe(false)`). Nothing asserts `completed`.
**Repro / decisive proof:** I replaced the neighbour's mocked Python result with
`{ error: "PLANT: the neighbour no longer completes" }` — which makes the run persist **`failed`** —
and ran the test alone:

```
Tests  1 passed | 16 skipped (17)      exit=0   ← STAYS GREEN
```

⇒ **an engine that FAILS every backtest passes CONTROL B.** The guard against "an engine that marks
everything refused is not a repair" does not cover the adjacent, equally fatal failure mode.
**Substantively the neighbour is fine** — I measured `returned status = "completed"`,
`persisted = ["completed"]`. The defect is in the control, not the code.
**Fix point:** add `expect(result.status).toBe("completed")` and
`expect(payloads.some(p => p["status"] === "completed")).toBe(true)` at `:845–847`.
**Blast radius:** any future regression that turns eligible strategies into `failed` ships green.

### `F-2` — MEDIUM / LIVE (reproducibility) — the acceptance baseline is not reproducible from the committed tree

See (F). Two of the 103 members depend on **untracked** `docs/replay-results/blind-readjudication/
blind-second-judge-LOCKED.json`. **Fix point:** commit the artifact, or make the baseline record the
skip explicitly. **Blast radius:** any future grader re-deriving the baseline totals gets a
different number and cannot tell drift from environment.

### `F-3` — MEDIUM / LATENT — no executing check witnesses the production status constant

`schema.ts:163` exports `BACKTEST_STATUS_REFUSED = "refused"`. The only test that exercises the
refusal path **`vi.mock`s the whole schema module** and hardcodes `BACKTEST_STATUS_REFUSED: "refused"`
at test `:124`.
**Repro:** I changed production `schema.ts:163` to `"PLANTED_DRIFT"` and ran the suite:
**`Tests 17 passed (17)`, exit=0 — GREEN.** `tsc --noEmit` also stays green (the constant is
structurally typed `as const` and flows into a text column).
⇒ **a production rename of that value is unwitnessed by any test.** This is the precise weak point
of the deliberate two-constant design in `AR-856 §1`: keeping `PYTHON_EXECUTION_STATUS_REFUSED` and
`BACKTEST_STATUS_REFUSED` separate defends against a *cross-side* rename, but nothing defends the
*mock-vs-production* seam. **Fix point:** import the real constant in the test instead of restating
it in the mock, or add one assertion that the mock equals the real export.

### `F-4` — MEDIUM / LATENT — a malformed refusal envelope is accepted, and one field is fabricated

`backtest-service.ts:884` `((result).refusal ?? {})` and `:891`
`entry_eligible: (result).entry_eligible ?? false`.
**Repro (executed):** feeding the border a bare `{ execution_status: "REFUSED" }`:

```
[[PROBE]] returned status   = "refused"
[[PROBE]] persisted extras  = {"execution_status":"REFUSED","entry_eligible":false,
   "condition_id":null,"disposition":null,"reason":null,"ambiguity":null,"source_prose":null,
   "metrics_omitted":null,"metrics_omitted_reason":null,"analysis_omitted":null,
   "analysis_omitted_reason":null,"governance_labels":null}
[[PROBE]] sse = ["backtest:refused"]
```

⇒ a refusal carrying **zero evidence** persists as an *evidence-backed* refusal, and
**`entry_eligible: false` is invented at the TypeScript boundary** rather than carried from Python.
`false` is the safe direction, but **a defaulted value that reads as a measured one** is the exact
shape this campaign keeps convicting.
**LATENT, not LIVE:** I measured the real Python path and it emits the complete payload in all four
mode×stress combinations. Nothing today produces a minimal envelope.
**Fix point:** require `refusal.condition_id` (or the whole `refusal` object) and refuse to persist
an evidence-free refusal; carry `entry_eligible` or record it absent, never default it.

### `F-7` — HIGH severity, **LATENT (I initially graded this LIVE and was wrong — corrected below)** — a refusal would be laundered into `failed` with a fabricated `errorMessage` by `runBacktest`'s own caller

**Claim under test** (`AR-856 §1`): *"🛑 NO fake `error`, no `failed`, no `completed`, no `REJECTED`,
no zero-trade result. The reason is in the evidence carrier, NEVER in `errorMessage` — a test
asserts the absence."*
**Reality:** true **inside** `backtest-service.ts`. **False one hop out, at its own caller.**
`agent-service.ts:757` (and `:1210`, `:1308`) is `const result = await runBacktest(...)` — the
refusal object, verbatim. Then, MEASURED at the executable lines:

```
:775  status: result.status === "completed" ? "tested" : "failed",
:791  status: result.status === "completed" ? "success" : "failure",
:793  errorMessage: result.status !== "completed" ? (result as any).error ?? "backtest failed" : undefined,
```

⇒ for a refusal: **`systemJournal.status = "failed"`**, **audit row `status = "failure"`**, and —
because a refusal deliberately carries **no `.error`** — the `??` fallback fires and the audit row's
**`errorMessage` becomes the literal string `"backtest failed"`.** A deliberate, evidence-backed
refusal is recorded as a crashed backtest, in the audit log, with an invented reason.

**Same family, one hop further out** — a binary `completed`/not-`completed` ternary meeting a third
outcome, precisely the law `R-750 §1` minted.

🛑 **CORRECTION AGAINST MYSELF — THIS IS LATENT, NOT LIVE.** I first graded it LIVE on the strength
of the three ternaries plus `result = await runBacktest(...)` at `:757`. **That was a two-true-facts
error: I proved the code shape and the call, and inferred the reachability.** An independent
reachability trace contradicted me and **I verified the contradiction myself at the executable
lines** rather than defending my finding:

```
agent-service.ts:737-755   backtestConfig = { strategy: { … python_code … }, start_date, end_date, mode }
backtester.py:8355         elif isinstance(config, dict) and config.get("compiled_spec"):
```

`agent-service` nests everything under `strategy:` and ships `python_code` — **there is no top-level
`compiled_spec`, so Band C never dispatches and no refusal envelope can be produced on this path.**
All three call sites (`:757`, `:1210`, `:1308`) share the shape.
⇒ **LATENT: correct shape, no reached path today.** It arms the moment any caller passes a
top-level `compiled_spec` config through `agent-service`.
**Fix point (still worth closing):** `agent-service.ts:775`, `:791`, `:793`; and `:1846`
`isFailure = entry.tier === "REJECTED" || entry.status === "failed"` reads the laundered journal row
back. **Blast radius if armed:** systemJournal, agent audit trail, downstream failure-rate metrics.
★ **This is the campaign's own `[two-true]` law biting the grader: the ternary is real and the call
is real, and the LINK between them was my unverified claim.**

### `F-8` — **CRITICAL to the terminality claim / LIVE** — a refused strategy is re-selected for backtest every 45 seconds, forever

**Claim under test** (`AR-856 §3`, and the commit message): *"ZERO denylist predicates on
`backtests.status` anywhere in `src/` — every consumer is an allowlist — **so a new value cannot
widen an existing query.**"*
**The premise is literally TRUE and I confirmed it independently** (no `ne`/`notInArray`/`!=`/`<>`/
`NOT IN` is ever applied to that column, in drizzle, raw SQL, `.sql` files, TS or Python).
**The CONCLUSION is REFUTED.** MEASURED at `candidate-backtest-conveyor-service.ts:106–121`:

```sql
NOT EXISTS (SELECT 1 FROM backtests b WHERE b.strategy_id = … AND b.status = 'completed')
NOT EXISTS (SELECT 1 FROM backtests b WHERE b.strategy_id = … AND b.status = 'running')
NOT EXISTS (SELECT 1 FROM backtests b WHERE b.strategy_id = … AND b.status = 'failed'
                                            AND b.created_at >= now() - interval '24 hours')
```

`'refused'` equals none of the three ⇒ all three `NOT EXISTS` stay TRUE ⇒ **a CANDIDATE strategy
whose only backtest is `refused` remains eligible on every tick.** A **negation wrapper around an
equality allowlist is semantically a denylist**, and a token-level audit for `ne`/`notInArray`
cannot see it. This is the single place in `src/` where the new value *widens* rather than narrows.

**LIVE and scheduled**, not theoretical — `scheduler.ts:6273`:
`registerJob("candidate-backtest-conveyor", 45 * 1000, …)`, described in `scheduler.ts:4110` as
*"candidate-backtest-conveyor (45s — pipeline-gated, enqueue-only, MAX_CONCURRENT_BACKTESTS slots)"*.

⇒ **the refusal is not terminal for the conveyor**: the strategy is re-enqueued every 45s, refuses
again, and re-qualifies. **No unsafe trade results** (each re-run refuses), so capital is not at
risk — but it is an unbounded compute loop that **permanently occupies `MAX_CONCURRENT_BACKTESTS`
slots and can starve legitimate CANDIDATEs**, and it falsifies "terminal" as written.
**REACHABILITY SPINE — measured end to end, not inferred** (this is the trace `F-7` lacked):

```
spec-onboarding-service.ts:663-668   finalConfig = { ...config, compiled_spec: {…} }   <- TOP LEVEL
spec-onboarding-service.ts:733       lifecycleState = conditionCompiled ? "CANDIDATE" : …
conveyor:105                         eq(strategies.lifecycleState, "CANDIDATE")
conveyor:173-176                     cfg = { ...(s.config), mode:"walkforward" }       <- TOP-LEVEL SPREAD
backtester.py:8355                   elif isinstance(config, dict) and config.get("compiled_spec")  -> Band C
backtester.py:8397                   refusal constructed
backtest-service.ts:915/:953         persisted "refused", early return
conveyor:188                         if (!result || result.status === "skipped")  <- "refused" falls THROUGH
conveyor:222/:224                    candidateConveyorEnqueuedTotal.inc() + SSE "candidate_backtest_enqueued"
```

⇒ the refusal is not merely re-run, it is **counted as a SUCCESSFUL enqueue**, and the 24h back-off
at `:119` covers only `failed` while the skip-cooldown at `:193` fires only for `"skipped"`. No
`idempotencyKey` is passed, so `backtest-service.ts:472` dedup cannot stop it either.
**Fix point:** add `AND b.status = 'refused'` as a fourth `NOT EXISTS` (or invert the three into one
positive eligibility predicate), and teach `:188` that `refused` is terminal.
**Blast radius:** the whole CANDIDATE→backtest conveyor.
✅ **CORROBORATED by two independent enumerations** (one SQL-predicate sweep, one reachability
trace) **and by my own reading of all five load-bearing lines.**

### `F-9` — MEDIUM / **LIVE (operator-reachable)** — the critic evidence packet coerces a refusal into a measured zero

`routes/critic-optimizer.ts:51-58` resolves `backtest_id` by taking the strategy's **latest backtest
with NO status predicate** (`.where(eq(backtests.strategyId, …)).orderBy(desc(createdAt)).limit(1)`)
— MEASURED at the line. A refused row is therefore selectable. Then, MEASURED:

```
critic-optimizer-service.ts:1841   daily_pnls: (bt.dailyPnls as number[]) ?? [],
critic-optimizer-service.ts:279    const totalTrades = Number((evidence.backtest_metrics as …)?.total_trades ?? 0);
```

⇒ a refusal's NULL columns become **an empty P&L series and a `total_trades` of 0 presented as
measurements**, and that 0 then drives the `GOVERNANCE_MIN_SAMPLE_DAYS` gate at `:292`. Same family:
absence coerced into a plausible number. **LIVE** via `POST /api/critic-optimizer/analyze` with only
`strategy_id`. (The automated trigger at `backtest-service.ts:2817` is on the success path and
cannot reach it.) **Fix point:** filter that resolver to `completed`, or refuse to build an evidence
packet from a non-`completed` row.

### `F-10` — MEDIUM / **LIVE-CONDITIONAL** — shadow-rerun reports a refusal as a CRITICAL metric regression

`shadow-rerun-service.ts:213` re-runs with `{...(originalBacktest.config), suppressAutoPromote:true}`
— a **top-level spread**, so a Band C config re-enters Band C. Its only status test is `:240`
`if (shadowResult.status === "skipped")`, so `refused` falls through; then `:123`
`metricsPassGate(null,null,null)` returns `false`, so `:289 statusFlipped = true` and
`computeSeverity` yields **`"critical"`**. ⇒ the first time a binding plan changes under a
previously-completed spec strategy, **a refusal is reported as "this strategy's gate decision
regressed due to a code change."** Fail-LOUD, not fail-open — but the attribution is wrong, and
`:267-280` hashes all-NULL metrics as though they were a measurement.
**I did not execute this** (it needs a prior completed backtest plus a binding change); the config
shape and the three predicates are MEASURED at the lines.

### `F-5` — LOW / LATENT, PRE-EXISTING — `assert ids_off <= {"s1","s2"}` cannot fail

See (A) CORRECTION 2. Identical at parent and pin ⇒ not a regression of this work.

### `F-6` — LOW / LIVE (hygiene) — a test in the acceptance population rewrites a **tracked** file

`src/engine/tests/test_exit_engine_ab.py` (manifest line 59, in the 103) rewrites tracked
`docs/wave25-exit-engine-ab-report.md` (`**Run date:** 2026-05-24 → 2026-08-09`). I hit this in my
own worktree and restored it. **This is why the shared tree shows that file dirty.** In a shared
tree whose pre-commit hook stashes/restores everything, a test that dirties a tracked artifact is a
live hazard to any concurrent seat.

### ⚑ STALE REGISTER ENTRY — proposed `D-7` is **already closed**

`AR-851 §7` reported, and deferred as `D-7`, that *"a REFUSED strategy still leaves `main()` carrying
a `forge_score`."* **MEASURED at the pin, live `main()`, all four mode×stress combinations: the
emitted envelope has exactly 10 top-level keys and `forge_score` is NOT among them** — it appears
only inside `analysis_omitted` as a named omission. `AR-853`'s join-key repair closed it. The
register entry should be retired as discharged rather than carried.

---

## 5 — MANDATORY COVERAGE

### 5.1 What I verified, and via which two-plus non-overlapping paths

| Claim | Path 1 | Path 2 | Path 3 |
|---|---|---|---|
| Six repairs are faithful | diff read at the executable lines | **value join**: record count/keys/ids/bar_idx at parent vs pin | 7 vacuity mutations |
| Refusal is terminal in TS | static ordering (`:953` vs `:1099–:2532`) | **live Python envelope → real TS service** | mutation M5 reproduces the defect verbatim |
| Refusal reaches no analytical surface (Python) | my own AST enumeration (PASS 1–4) | live `main()` × 4 mode/stress, 10 keys | mutations M3/M4 |
| Population = 103 | live `_regression_population` | committed manifest | baseline count + tamper control |
| Failure set unchanged | membership diff vs committed baseline | tamper control fires | both 6B REDs asserted by name |
| Baseline valid at parent | `git diff f8273f41 f7aefaa6 -- src/` empty | positive control on a changed pair | — |
| Gate is fail-closed | executable line `:192–199` | **mutation → test 4b RED** | `20 passed` on the cited file |
| TS consumer enumeration | independent re-derivation (63 predicates / 28 files) | two search engines agreeing exactly, + positive & negative controls | my own read of every load-bearing line (`F-7`, `F-8`) |

### 5.2 Positive-control witnesses for every absence claim I make

- *"No third LIVE join-key instance"* → I enumerated **all 7** `"error" in result` sites with their
  guard chains and opened the 2 unguarded ones; and the same grep style demonstrably returns the
  5 guarded ones (control).
- *"Exactly 2 module-wide param mutators"* → my PASS 3 independently rediscovers
  `_rescore_with_crisis`, the one `AR-853` found by hand — the instrument catches a known-present case.
- *"Population comparison is real"* → tamper control substitutes a fake member; comparison goes red.
- *"Failure membership unchanged"* → tamper control on the membership set fires.
- *"`src/` unchanged across SHAs"* → positive control on `f7aefaa6..ad0ffb4b` shows the command can print changes.
- *"tsc clean"* → planted `TS2322`; tsc exits **2** with the error. It can fail.
- *"Six tests are not vacuous"* → 6 of 7 plants RED; the 7th measured directly (`n_entries=1`).
- *"CONTROL B stays green under mutation D"* → observed green while 3 siblings went red.

### 5.3 Join keys checked for every "identical / unchanged / matches" claim

- Trace records: **count + key-set + `condition_id` set + `bar_idx`** (parent vs pin).
- Population: **normalised member string** (CR stripped, `\`→`/`) — set difference both directions.
- Failure set: **full pytest node id**, normalised, both directions.
- Blob equality across SHAs: **git object SHA** per path (`git rev-parse <sha>:<path>`), not mtime, not diff.
- Envelope join: **top-level key set + per-key value equality**, reported field by field.

### 5.4 Instrument failures I hit — mine, and I am naming them

1. **My vacuity script mislabelled plant 1.** It assumed every plant was a *must-redden* plant, but
   plant 1 was an *assert-positive* plant, so GREEN meant "healthy" and my script printed
   "VACUOUS". **I nearly published a fabricated finding against correct code.** Caught by
   re-measuring directly (`n_entries = 1`). *A convenient result accuses your instrument too.*
2. **`cp1252` encoding blew up three runs** mid-plant. Each time the `finally` block still restored
   the file, and I verified `git status --porcelain` clean before continuing rather than assuming.
   Fixed with `encoding="utf-8", errors="replace"` and `PYTHONIOENCODING=utf-8`.
3. **`baseline["population_members"]` is an `int`, not a list.** My three-way join crashed; I
   corrected the script and now report explicitly that the baseline pins membership **by reference**
   to the manifest, contributing only a count.
4. 🛑 **I GRADED `F-7` LIVE ON AN INFERRED LINK.** I measured the three ternaries and I measured
   `result = await runBacktest(...)`, and I let those two true facts imply reachability **without
   tracing the config shape**. An independent trace contradicted me; I verified the contradiction at
   `agent-service.ts:737-755` + `backtester.py:8355` and downgraded my own finding to LATENT. **This
   is the campaign's `[two-true]` law, and the grader is not exempt from it.** It is also why `F-8`
   carries a full reachability spine and `F-7` now carries its disproof.

### 5.5 What I did NOT verify — named surfaces

- 🛑 **NO live subprocess Python→TS handoff.** I closed most of this gap (real Python envelope →
  real TS service), but `runPythonModule`'s **stdout plumbing and JSON transport** were mocked. The
  serialization itself is unmeasured; the object I injected is the dict handed to `json.dumps`.
- 🛑 **NO full-repo `vitest`.** I ran 2 TS files (17 + 20 tests). Every other TypeScript consumer is
  `[UNMEASURED]`. `AR-856`'s "70 passed (4 files)" — I ran 2 of those 4 and did not reproduce the 70.
- ✅ **Frontend: RESOLVED, not skipped.** `src/client`, `src/web`, `src/frontend`, `src/app` do not
  exist; `src/dashboard` contains one `.tsx` with zero backtest-status references. (`public/` at repo
  root is outside the scope lock and was NOT searched.)
- 🛑 **NO database.** Every persistence claim is against the **vitest mock** of drizzle, not Postgres.
  Column nullability, the `status` CHECK constraint (if any), and JSONB round-trip of `resultExtras`
  are **UNVERIFIED**. A `refused` value that violates a DB constraint would not show up in anything I ran.
- 🛑 **`F-8` IS DERIVED FROM THE SQL TEXT, NOT EXECUTED.** I have no database, so I did not run the
  conveyor query against real rows. The finding rests on the literal SQL at `:106–121` plus
  `'refused' ∉ {'completed','running','failed'}` — first-principles, unambiguous, but **static**.
  The scheduler wiring (`45 * 1000`) and the call chain **are** measured at the executable lines.
  **If the desk wants this executed, it needs a live Postgres and one CANDIDATE row.**
- 🛑 **`F-7` IS MEASURED AT THE LINE, NOT EXECUTED.** I read the three ternaries and confirmed
  `result` is the `runBacktest` return at `:757`. I did **not** run `agent-service.ts` end-to-end
  (it needs a much larger mock surface). The `??` fallback firing depends on a refusal carrying no
  `.error`, which I **did** measure by execution (live envelope, 9–10 keys, no `error`).
- 🛑 **NO SSE consumer verification.** I confirmed `backtest:refused` is *broadcast*; I did not
  verify any subscriber handles an unknown event type.
- 🛑 **NO `PARITY_SHADOW_ENABLED` execution** — that gate is proven only by its guard.
- 🛑 **The 31 pre-existing failures were confirmed pre-existing but NOT diagnosed.**
- 🛑 **`_emit_validated_result`'s internal guard** I read at `:6333`; I did not mutate it.
- 🛑 **Lifecycle promotion** — I verified no promotion call exists in `backtest-service.ts` after the
  return, and that `loadExpectedSignals` filters on `completed`. I did **not** execute
  `lifecycle-service.ts` against a `refused` row.

### 5.6 What is UNVERIFIABLE from this seat

- Whether a `refused` row survives real Postgres — no DB (per campaign memory, every `.env` points at
  a retired instance).
- Whether the 2 untracked-artifact-dependent tests pass or fail when the artifact **is** present,
  since the artifact is not in git and I will not manufacture it.

---

## 6 — WHAT I COULD NOT REPRODUCE, STATED PLAINLY

1. **`AR-851 §6.1`'s "began running where they used to skip"** — REFUTED by measurement at the parent.
2. **`AR-856 §6`'s `2324 passed / 3 skipped`** — I get `2322 / 5`, reconciled to an untracked file (`F-2`).
3. **`AR-856`'s "70 passed (4 TS files)"** — I ran 2 files (17 + 20 = 37) and did not identify or run
   the other 2. Not refuted; **not reproduced**.
4. **`AR-851 §3`'s "2 failed"** — reproduced only after reconciling to the suite as it existed at
   `ad0ffb4b`; at the pin the same mutation reddens 13. The claim is sound; a bare "2" is unjoinable
   without its suite.

---

## 7 — RECOMMENDATION

`PASS_WITH_BOUNDED_FINDINGS`, **band 6 VERIFIED**.

The refusal path is real and survives adversarial mutation on every hop I could execute, and the
Python-side work is the strongest in this sequence — the join-key family is genuinely closed there,
and I proved it with an instrument that mechanically rediscovers the helper `AR-853` found by hand.

**Fix order, and close `F-7`–`F-10` as ONE wave — they are one defect at four consumers**
(a binary success test meeting a third outcome), and the campaign's own `[fix-pattern]` law says
sweep the class, not the instance:

1. **`F-8` first — it is the only one that compounds.** An unbounded 45s re-run loop occupying
   `MAX_CONCURRENT_BACKTESTS` slots, in the same service that produces the refusal.
2. **`F-9`** — one status filter on the evidence resolver.
3. **`F-10`** — teach `:240` that `refused` is terminal, so a refusal stops being reported as a
   critical metric regression.
4. **`F-7`** — unreached today, but it is the same edit and leaving it is how the class regrows.

Then `F-1` (a one-line assertion) and `F-3` (import the constant) — control repairs, not behaviour
changes, both cheap. `F-4` before any non-golden spec can produce a refusal envelope. `F-2` and
`F-6` are hygiene debts that will bite the next grader, not the next trade.

**None of `F-7`–`F-10` is reachable by capital.** `F-8` is reachable by the scheduler every 45s.

⚖️ **One law this grade re-earns, for the ledger:**
**`AN ENUMERATION THAT SEARCHES FOR A TOKEN CLASS MAY NOT CONCLUDE ABOUT A SEMANTIC CLASS.`**
`AR-856 §3` searched for `ne` / `notInArray` / `!=` / `NOT IN`, found zero — correctly — and
concluded *"a new value cannot widen an existing query."* A `NOT EXISTS` around an equality is a
denylist wearing an allowlist's tokens. The mechanical enumeration was honest and its premise was
right; only the inference over-reached.

**PROVENANCE OF `F-7` / `F-8`:** candidate sites were surfaced by an independent consumer
re-enumeration I dispatched; **I confirmed every load-bearing line myself** — the three
`agent-service.ts` ternaries, the three `NOT EXISTS` blocks, the `runBacktest` call at `:757`, and
the 45-second `registerJob` — by reading the executable lines at the pin. They are `MEASURED HERE`,
not `RELAYED`.

**I built none of this and I graded it against artifacts only.** No prior band was carried forward,
and I re-derived my own band downward when late evidence contradicted it.
