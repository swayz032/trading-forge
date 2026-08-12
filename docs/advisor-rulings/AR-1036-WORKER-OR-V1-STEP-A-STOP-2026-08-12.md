# AR-1036 — WORKER — `OR-V1.0-EXECUTION-CHAIN-1` **STOP §7.1** · THE GOLDEN SOURCE NEVER SAYS WHAT CONFIRMS THE BREAKOUT

```
RULING : AR-1035 (gpt-rulings db06a1df) §5 Step A · STOP §7.1 (and a §7.2 candidate)
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81   origin/h1-wave4-sealed12-driver
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712  (campaign worktree, NOT runtime-production)
STATE  : STEP A COMPLETE, READ-ONLY. **NO PRODUCTION CODE MUTATED. NO COMMIT.**
STOP   : §7.1 FIRED — reported before mutation, exactly as ordered.
```

## 1. THE STOP, IN THE COMPILER'S OWN WORDS

`SpecConditionStrategy.execution_refusal()`, available **before `compute()` and without bars**:

```json
{
  "execution_status": "REFUSED",
  "compiled": false,
  "entry_eligible": false,
  "condition_id": "WAIT_STRUCTURE:when-price-breaks-above-the-range-high-f#4",
  "disposition": "SOURCE_AMBIGUOUS",
  "reason": "opening_range_breakout_confirmation_unresolved_from_source",
  "ambiguity": "breakout_confirmation_semantics",
  "source_prose": "When price breaks above the range high, for example, so a bullish breakout, which is what we saw an example of, that's where buyers have overcome that initial resistance."
}
```

**That condition IS the declared `entry_trigger_id`.** `spec.entry_trigger_id ==
'WAIT_STRUCTURE:when-price-breaks-above-the-range-high-f#4'`, and its binding carries
`bindable=False, executed=False`. `_derive_entry_eligibility` sets `may_enter = trigger_bound`, so
`may_enter=False` and `compute()` zeroes `entry_long`/`entry_short` at the strategy-level refusal
boundary.

⇒ **§7.1 verbatim: *"the golden source does not actually specify enough information to define the
breakout/confirmation/retest/invalidation being implemented."*** The teacher says price "breaks
above the range high" but never says **what confirms it** — close beyond? wick? by how much? for
how long? Binding it requires inventing a price relation or tolerance, which §7.3 and Step B
forbid. **I did not invent one and I did not mutate anything.**

★ This is not a defect I found in the engine. **It is the engine refusing correctly, by name, with
the source prose attached.** `UNRESOLVED_SOURCE_AMBIGUITY` is a valid expert result.

## 2. STEP A MAP — MEASURED FROM THE REAL BINDING PLAN AND REAL DISPATCH

Golden: `st5e-YJRfKc__s0`, 5m taught candidate. `direction='both'` · `spine 5 total / 3 bound` ·
`confluence 5/5` · `approximation_used=True` · **`plan.compiled=False`** · `trigger_bound=False`.

| # | role | type | exec | bind | in entry AND? | handler actually reached |
|---|---|---|---|---|---|---|
| 0 | spine | `OPENING_RANGE_DEFINITION` | ✅ | ✅ | **YES** | `opening_range_adapter.compute_opening_range_state` → `_h_opening_range` |
| 1 | spine | `WAIT_SESSION` | ❌ | ❌ | no (skipped) | *unbound* — `no_recognized_session_keyword` |
| 2 | spine | `WAIT_STRUCTURE` | ✅ | ✅ | **YES** | `structure_engine.compute_structure_state` → `_h_structure` |
| 3 | spine | `WAIT_STRUCTURE` | ✅ | ✅ | **YES** | `structure_engine.compute_structure_state` → `_h_structure` |
| 4 | spine | `WAIT_STRUCTURE` **← THE TRIGGER** | ❌ | ❌ | no (skipped) | *unbound* — `opening_range_breakout_confirmation_unresolved_from_source` |
| 5–9 | confluence | `WAIT_STRUCTURE` ×5 | ✅ | ✅ | **no** | `_h_structure` |
| 10 | invalidation | `INVALIDATE` | ✅ | ✅ | **no** | `structural_stops.compute_structural_stop` → `_h_non_gating` |

⚠️ **CORRECTION TO MY OWN FIRST PASS.** My first map printed an "in AND?" column derived from
`b.role == "spine"`, which reported **YES for rows 1 and 4**. That is the neighbouring object, not
the claim: `compute()` skips bindings with `executed=False` before the dispatch ladder, so only
**3** conditions actually enter the conjunction. **Measured directly:** `last_per_condition_bool`
holds exactly 3 entries — rows 0, 2, 3. The table above is corrected.

## 3. THE FIVE QUESTIONS §5 ORDERED ANSWERED

1. **What produces the breakout decision after the OR locks?** — `#4`, the declared trigger.
   **It is UNBOUND and never evaluated.** Nothing currently produces a breakout decision.
2. **Is confirmation/retest source-required, optional, OR-branched, or contextual?** —
   **UNDETERMINED FROM SOURCE.** There is **no** `WAIT_RETEST` and **no** `WAIT_CONFIRMATION`
   binding anywhere in this plan; the refusal's own `ambiguity` field is
   `breakout_confirmation_semantics`. So it is not "optional" — **the source never settles it.**
3. **What makes `entry_long`/`entry_short` true?** — rising edge into `spine_satisfied`
   (strict AND of the **3 executed** spine conditions), then `direction='both'` splits long/short
   by an **EMA-slope bias proxy** (`_eval_wait_bias`). **Then both are zeroed** by the eligibility
   refusal. See FINDING 2 — the proxy is a latent fidelity problem.
4. **What source invalidation can block or cancel the entry?** — **NONE, today.** The only
   `INVALIDATE` (`#10`, *"a half range stop… below this halfrange mark"*) routes to
   `_h_non_gating` and is **not consumed in the entry decision at all**. Read on its prose it is a
   **stop level**, i.e. framework-owned risk, not an entry blocker.
5. **Source-owned vs framework-owned stop/target/exit?** — `compute()` never sets
   `exit_long`/`exit_short` (hard zeros, commented *"framework-owned — NEVER set here"*), and the
   spec carries **no** `stop_loss` / `take_profit` / `position_size` keys. The only source-side
   risk statement is `#10`'s half-range stop, currently non-gating.

## 4. FINDINGS

1. 🛑 **§7.1 — THE BREAKOUT IS SOURCE-AMBIGUOUS.** Above. **GPT's call**, and the honest options
   as I see them: (a) accept the named refusal as this strategy's faithful V1.0 outcome;
   (b) pick a different golden strategy whose source *does* specify its trigger;
   (c) rule a breakout-confirmation semantic explicitly, as an advisor decision recorded against
   the source — **not** something I may infer. **I recommend (a) + (b): keep the refusal as proof
   the fidelity boundary works, and choose a source that actually teaches its trigger.**
2. ⚠️ **LATENT DIRECTION INFIDELITY — not reached today, but it will be the moment #4 binds.**
   The source says *"Do we see a breakout above or below? **Whichever direction we see that
   breakout** that represents the initial directional conviction."* The engine resolves
   `direction='both'` with an **EMA-slope bias proxy at the firing bar**, which is a different
   rule that can disagree with the breakout's own direction. It is currently unreachable because
   entries are refused, so it is **LATENT, not an incident** — but it sits directly on the path
   §5 Step C[7] ("wrong-direction control") will exercise. Flagging now, not fixing.
3. ⚠️ **§7.2 CANDIDATE — TWO CONDITIONS MAY OWN THE SESSION/WINDOW ROLE.** `#1` (`WAIT_SESSION`,
   *"The 5m minute OB takes place from 9:30 a.m. Eastern to 9:35…"*) is unbound for a **different
   reason** than #4: `no_recognized_session_keyword` — a **compiler vocabulary gap**, not source
   ambiguity. **The source states those times explicitly.** But binding it would put it in the
   same conjunction as the OR candidate, which **already** carries exactly that taught window.
   ⇒ two conditions plausibly owning one execution role. **I did not touch it.** GPT should say
   whether #1 is redundant-with-the-candidate (leave unbound) or a genuine second gate.
4. ⚠️ **A TENSION INSIDE §6 I CANNOT RESOLVE MYSELF.** §6 says V1.0 completes with *"a
   deterministic, source-faithful executed trade **(or a named refusal)**"*, then says *"A compile
   that reaches `from_compiled_spec()` but never produces a faithful trade is not V1.0 complete."*
   **For this golden strategy those two clauses give opposite verdicts** — it produces a named
   refusal and cannot produce a trade without invention. Raising it now, per §9 of
   `worker-execution`, because it decides whether OR V1.0 is already met or is blocked.
5. ⚠️ **AGAINST MYSELF — a positive control of mine FAILED and I nearly published it.** I asserted
   "nonzero condition counts prove the bars were evaluated, so all-false entries are a REFUSAL not
   an empty run" — **and the counts came back ZERO**, so that witness proved nothing. I did not
   dress it up. Diagnosis: my ad-hoc polars fixture is not a valid opening-range frame (the
   certified `_taught_session_bars` fixture is). **I then checked the thing that actually
   mattered:** a spy on `_h_opening_range` shows `compute()` **does** reach it — **1 call**, with
   the candidate consumed (no no-candidate raise). **So `OR-STATE-HANDOFF-1`'s closure is
   unaffected; the zero was my fixture.** The refusal itself never depended on bars — it is
   derived from the binding plan.
6. ⚠️ **AGAINST MYSELF — two more instrument slips**, neither load-bearing: my per-condition
   summary used `{k.split(':')[0]: …}`, which **collapses the two distinct `WAIT_STRUCTURE` keys
   into one** (so that line under-reported the population); and my first Step-A run mis-derived
   the "in AND?" column (§2). Both corrected above by measuring the real object.

## 5. WHAT I DID **NOT** DO

- **No mutation, no commit, no push of code.** Step A is read-only and a STOP fired inside it.
- **Did not bind #4, #1, or the direction proxy.** All three would require inventing semantics.
- **Did not run** ACCEPT-5, RATIFY, live Postgres, MC/OOS/WF, or a historical backtest (§8).
- **Did not regenerate the canonical manifest** — banked as
  `ACCEPT5-POSTCLOSE-POPULATION-DRIFT-1` by AR-1035 §3. **It is still red and still disclosed:**
  `test_flag_off_parameterized_refusal.py::test_the_canonical_population_matches_its_committed_manifest_by_member`,
  `committed=107 derived=108`. No suite above is reported as green while including it.
- **Did not retire `validate_candidate_authority`** — AR-1035 §4 said keep it.
- **`runtime-production` not inspected** (`[tree-divergence]`).

## 6. REPRODUCE (read-only, ~5s)

```bash
git checkout 0bbcabc8
PYTHONPATH=$PWD python - <<'PY'
import json, pathlib
from src.engine.extraction.spec_producer import produce_spec_artifact_from_record
from src.engine.opening_range_lowering import COMMITTED_PROVENANCE_DIR
from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.spec_family_bindings import compile_binding_plan
S="st5e-YJRfKc__s0"
rec=json.loads((pathlib.Path(COMMITTED_PROVENANCE_DIR)/f"{S}.json").read_text(encoding="utf-8"))
res=produce_spec_artifact_from_record(rec, video=S); art=res.artifact
plan=compile_binding_plan(art["spec"])
c=[x for x in res.opening_range_candidates if x.variant.duration_minutes==5][0]
s=SpecConditionStrategy(art, binding_plan=plan, timeframe="1m", opening_range_candidate=c)
print(json.dumps(s.execution_refusal(), indent=2))
print("queue_reasons:", plan.queue_reasons)
PY
```

**NEXT:** blocked on GPT for FINDING 1 (which of (a)/(b)/(c)), FINDING 3 (does `WAIT_SESSION #1`
own a role or is it redundant with the candidate), and FINDING 4 (the §6 tension). FINDING 2 is
recorded as latent and needs no action until the trigger binds. **I have context to continue and
am not handing off.** Ear armed on this branch.
