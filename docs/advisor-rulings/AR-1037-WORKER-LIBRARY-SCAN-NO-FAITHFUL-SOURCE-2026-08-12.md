# AR-1037 — WORKER — §11 CONDITION 2: **NO SOURCE IN THE LIBRARY MEETS §7** · A SOURCE EXECUTES **IF AND ONLY IF** ITS TRIGGER WAS APPROXIMATED

```
RULING : AR-1036 (gpt-rulings e5a4106f) §7 bounded selection scan · §11 condition 2
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81   origin/h1-wave4-sealed12-driver
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712  (campaign worktree)
STATE  : SCAN COMPLETE, READ-ONLY. **NO PRODUCTION CODE MUTATED. NO COMMIT.**
STOP   : §11 condition 2 — the library contains no candidate meeting §7. Reason
         distribution reported below rather than a source invented to fill the gap.
```

## 1. THE FINDING — AND IT IS A CONDITION, NOT AN INSTANCE

Population: **13** committed tier-A provenance records (`_MANIFEST.json` excluded — it is not a
strategy). Measured with the EXISTING compiler surfaces only; no scanner built, nothing persisted.

| source | refuses? | trigger approximated? | taught params reached | approx/bound spine | market |
|---|---|---|---|---|---|
| `0RBexa9JpIg__s0` | executes | **True** | `None` | 2/2 | forex |
| `ExB66jcyKxg__s0` | executes | **True** | `None` | 2/2 | index (nifty) |
| `LD1FEbwXU4o__s0` | executes | **True** | `None` | 2/2 | forex |
| `SeqVUNanFeY__s0` | executes | **True** | `None` | 5/5 | generic |
| **`XbRI0sfcXU4__s0`** | executes | **True** | `None` | 4/4 | **index_futures (NQ)** |
| `YqY0OkL5LMI__s1` | executes | **True** | `None` | 3/3 | equities |
| `hcHuDfxdywI__s0` | executes | **True** | `None` | 5/5 | forex |
| `YGdFksLavKE__s0` | REFUSES | False | `None` | 1/1 | unstated |
| `YqY0OkL5LMI__s0` | REFUSES | False | `None` | 0/0 | us_equity |
| `dENM6gt8ZRg__s0` | REFUSES | False | `None` | 1/2 | unstated |
| `pKzXxB9Blts__s0` | REFUSES | False | `None` | 4/4 | unstated |
| `st5e-YJRfKc__s0` | REFUSES | False | `None` | 2/3 | equities |
| `st5e-YJRfKc__s1` | REFUSES | False | `None` | 0/0 | equities |

> ★★★★★ **A SOURCE EXECUTES IF AND ONLY IF ITS ENTRY TRIGGER WAS APPROXIMATED. 7/7 executing
> sources have `trigger.approximation == True`; 6/6 refusing sources have it `False`. The
> correlation is perfect and inverted.**

**And `parameters` is `None` on every binding of all 13 sources.** No taught number reaches any
executable binding anywhere in the library — not the `25` and `50` exponential moving averages the
NQ source names explicitly, not the `60 points` target the nifty source names.

⇒ **§7 criterion 3** (*"not a context-only approximation masquerading as a trigger"*) and
**§7 criterion 5** (*"all load-bearing source numbers/levels/periods survive **or refusal
occurs**"*) are **failed by every executing source in the library.** Neither branch of criterion 5
holds: the numbers do not survive, **and no refusal occurs.**

## 2. WHY THE OBVIOUS PICK IS THE SHARPEST EXAMPLE

`XbRI0sfcXU4__s0` (`ema25_channel_break_short`) passes §7 criteria 1, 2, 4, 6, 7 outright and looked
like the answer:

- **only futures source in the library** — `asset_class: index_futures`, `instrument: NQ`;
- `compiled=True`, `trigger_bound=True`, **spine `4/4` fully bound**, `queue_reasons` **empty**;
- `direction: 'short'` **explicitly source-declared** — no EMA-slope proxy decides the side, so
  AR-1036 §5's constraint is satisfied;
- `execution_refusal()` returns **`None`** — it will run.

**And that is exactly the problem.** The source's own words are:

> *"i'm waiting that bar close under the that blue **25 exponential moving average** line … then i
> wanted…"* — the entry confirmation
> *"the bulls tried to push that from **50** moving average line and there is a rejection there
> with the weak close"* — the setup

Both compile to **generic** primitives (`candle_confirmation_check`, `structure_engine.
compute_structure_state`, `retest_touch_check`) with `approximation=True` and `parameters=None`.
**The 25 and the 50 do not reach execution.** A backtest of this strategy would produce
well-formed, plausible numbers for a strategy the teacher did not teach — and nothing in the
pipeline would say so.

★ **The contrast with the golden OR source is the whole lesson.** `st5e-YJRfKc__s0` **refused**,
loudly and by name. This one **executes quietly on a proxy.** `A HONEST REFUSAL IS SAFER THAN A
SILENT APPROXIMATION, AND THIS LIBRARY CURRENTLY SHIPS THE SECOND ONE SEVEN TIMES.`

## 3. THE MECHANISM — DECLARED BUT NOT CONSUMED

`approximation=True` **is recorded** on every one of those bindings, and `plan.approximation_used`
is `True`. So the system is not blind — **it knows.**

What it does not do is **act** on it: `_derive_entry_eligibility` computes `may_enter =
trigger_bound`, and `trigger_bound` is `bindable and executed`. **`approximation` is not a term in
that expression.** So an approximated trigger is `bindable=True, executed=True` and passes.

★ This is `advisor-ruling §5`'s own law biting: **`"ADVISORY-ONLY" IS A PROPERTY OF THE CONSUMER,
NOT THE PRODUCER.`** The producer declares the approximation faithfully; no consumer refuses on it.

**I am NOT proposing the repair.** Making `may_enter` consume `approximation` would change which
strategies execute across the whole library — a trading-semantic change well outside a selection
scan, and adding a taught-parameter channel is explicitly `AR-1035 §7.7` STOP and `AR-1036 §10`
"no broad compiler refactor". **This is GPT's call.**

## 4. THE OPTIONS, AS I SEE THEM

1. **Make the approximation refuse.** Add `approximation` to the eligibility contract so an
   approximated trigger cannot enter. Honest, small, and would take the executing set to **0/13** —
   i.e. it converts a silent-fidelity problem into a visible blocked money path. Nothing trades
   until a parameter channel exists.
2. **Build the taught-parameter channel** (EMA period et al.) so `25`/`50` reach execution, then
   re-scan. This is the only option that ends with a faithful trade, and it is the one previously
   fenced off as a STOP — it would need explicit authority.
3. **Accept a declared-approximate first trade**, clearly labelled NOT source-faithful, purely to
   prove the money path executes end to end. Fast, but it books an unfaithful backtest as the
   first money-path result, and `AR-1036 §3` just drew the line against blurring those meanings.
4. **Extract new sources** chosen for parameter-free, explicitly-triggered setups.

**My recommendation: (1) then (2).** Make the approximation visible by refusing first — that is
one small change to one expression and it cannot make anything silently worse — then authorize the
parameter channel as the real money-path unblocker. **(3) is the one I would argue against**: the
whole value of the last two units was proving the system stops where the source runs out, and a
deliberately unfaithful first trade spends that.

## 5. §11 REASON DISTRIBUTION (reported, not invented)

Unbound-spine reasons across the library:

```
  5x  unknown_condition_type
  2x  no_recognized_session_keyword
  1x  opening_range_breakout_confirmation_unresolved_from_source
```

And the dominant blocker, which is **not** in that list because it produces no reason at all:
**`7x  trigger bound to an approximation with no taught parameters`.**

## 6. FINDINGS AGAINST MYSELF

1. ⚠️ **My first scan printed `market=?` for 12 of 13** and I nearly reported the library as
   market-unclassified. **`instrument_classification` is present in all 13** — the records use
   **inconsistent key names** (`instrument_class` · `asset_class` · `asset_classes_mentioned` ·
   `instrument_type` · sometimes only a prose `note`). I had read the parent key's presence and
   one child's name. Corrected by reading every record's actual keys. **This is `[i-measured]`
   again — the neighbouring object.** *(Worth noting independently: that schema inconsistency is
   itself a small extraction-provenance defect. Not actioned.)*
2. ⚠️ **My entry-sequence dump printed `type=None object=None` for all four conditions** of the NQ
   source — wrong field names for that record shape. I did **not** build on it; the compiled
   binding plan is the authoritative view and is what §1–§3 rest on.
3. ✅ **Positive control on the decisive attribute:** `approximation` returns `True` for 7 sources
   and `False` for 6, so it varies and is really being read — it is not a constant or a missing
   attribute defaulting. Had it read `True` everywhere I could not have told the finding from a
   typo in my own `getattr`.

## 7. NOT DONE / NOT TOUCHED

- **No mutation, no commit.** §11 condition 2 fired inside a read-only scan.
- **Did not select a source or start §8's execution proof** — every candidate fails §7.
- **Did not** regenerate the canonical manifest (still red, still disclosed:
  `committed=107 derived=108`), retire `validate_candidate_authority`, touch the EMA-direction
  proxy, or reopen ACCEPT-5/RATIFY.
- **Population limit, stated:** these are the **13 committed tier-A provenance records** only. If a
  larger extracted library exists in Postgres, it was **not** measured — no live DB is authorized.
  **This finding is scoped to what is committed in the repo.**
- `runtime-production` not inspected.

## 8. REPRODUCE (read-only, ~20s)

```bash
git checkout 0bbcabc8
# scan script: scratchpad only, intentionally not committed (no new subsystem, §7)
# it calls only produce_spec_artifact_from_record + compile_binding_plan + SpecConditionStrategy
```

Per source: read `instrument_classification`, compile the record, then report
`plan.compiled` · `plan.trigger_bound` · the trigger binding's `.approximation` and `.parameters` ·
`execution_refusal()`.

**NEXT:** blocked on GPT for the §4 choice. **I have context to continue and am not handing off**;
if GPT picks option (1) it is a one-expression change plus a red-proof and I can execute it
immediately. Ear armed on this branch.
