# AR-1047 — WORKER — **`sVkm` CAUSAL TRACE: FIRST BROKEN HANDOFF IS AN EXTRACTION HOLE THAT SWALLOWS THE ENTIRE RISK MODEL** · **AND THE 40 PRODUCTION SPECS WERE NOT PRODUCED BY THE CURRENT PIPELINE** · STOP §10.6

```
RULING : AR-1046 GPT ruling (gpt-rulings a570588a) §7 -- sVkm causal trace, first broken link
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
REPORT : §11 clause B -- a STOP fires with the exact failing link and evidence.
STOP   : §10.6 -- the corrected spec cannot be tied deterministically to a producer.
```

---

## 1. PRE-FLIGHT — GPT'S CODE PREMISES, MEASURED (they were RELAYED to me)

All of AR-1046 §3.1/§3.2 **CONFIRMED `MEASURED HERE`**:

| GPT claim | measured |
|---|---|
| `fvg_native.py::compute_fvg_signal` exists, classic 3-candle rule | ✅ `bullish_mask = low[2:] > high[:-2]`, `bearish_mask = high[2:] < low[:-2]` |
| `_eval_fvg()` returns `result.any_active` | ✅ `spec_condition_compiler.py:1478`, verbatim |
| direction decided by a generic proxy | ✅ docstring: *"direction is still decided … `self.spec['direction']` + the **EMA-slope proxy** for 'both'"* |
| `TF_FVG_IDENTITY_ENABLED` route exists | ✅ `spec_family_bindings.py:112`, **default OFF** (`"false"`) |
| `OpeningRangeState` / OR-STATE-HANDOFF-1 reusable | ✅ `opening_range_definition.py:189` |

**Two additions GPT did not have:**
- **`compute_fvg_signal` ALREADY returns `bullish_active` and `bearish_active` separately** — the
  directional signal exists in the primitive and `_eval_fvg` discards it.
- **`_select_directional()` already exists** immediately below `_eval_fvg` and does exactly the
  bullish/bearish pick from the condition's own object text. **The capability is built and unused
  on this path.**

**§10.2 does NOT fire.** The teacher's rule and the native detector agree: *"a three candle pattern
where the low of candle one does not overlap the high of candle three"* (span 11737-11844) is
`high[i] < low[i-2]` — the code's bearish form, matching his demonstrated short.

---

## 2. THE CAUSAL TRACE

| # | link | status | evidence |
|---|---|---|---|
| 1 | raw teacher words / hash / spans | ✅ | `raw/sVkmZklJDHI.txt`, sha256 `df72444f…`, 25,071 ch; spans verified pos/neg |
| 2 | **persisted extraction / spec** | 🛑 **FIRST BREAK** | §3 — the risk model is absent; `direction=long` |
| 3 | canonical typed conditions | — | not reached |
| 4 | 5m `OpeningRangeState` | ⚠️ exists; **6 pinned fields, NO breakout-side** | `opening_range_definition.py:189` |
| 5 | 1m close outside exact OR level | ⚠️ taught + extracted, not yet traced to an evaluator | spec span 9432-9513 |
| 6 | directional FVG outside same side | 🛑 **SECOND BREAK** | `_eval_fvg` → `any_active`; EMA-slope proxy picks side |
| 7 | candle-3 close entry | ⚠️ extracted (18678) | not traced |
| 8 | source stop @ FVG-candle extreme incl. wick | 🛑 **ABSENT** | §3 |
| 9 | source fixed 2R target | 🛑 **ABSENT** | §3 |
| 10 | executable trade decision | — | not reached |

---

## 3. 🛑 THE FIRST BROKEN HANDOFF — A 1,885-CHARACTER EXTRACTION HOLE OVER THE RISK MODEL

**The teacher states his complete risk model explicitly. MEASURED spans in the committed raw file:**

- **stop, span 13869-13908 →** *"what I want you to do for the stop loss is we're just going to put
  it at the bottom of the fair value candle."*
- **wick rule, span 14097-14127 →** *"If this candle had a big wick, then you would also include the
  wick. **Don't just go to the body.**"*
- **target, span 14488-14515 →** *"the fixed target we're looking for is a **risk-to-reward ratio of
  two**."*

**MEASURED in the persisted spec — all 35 rows:**
```
rows matching stop|target|risk|reward|wick|2R : 0 / 35
EXIT_HINT rows                                : 0
```

**The hole is exact and provable.** The extraction captured span **13809-13860**
(*"So, the entry would actually be around about here."*) — the sentence **immediately before** the
stop — and then its next captured span is **15745**. ⇒ **Nothing between 13860 and 15745 was
extracted: 1,885 characters containing the stop, the wick rule and the 2R target.**

★ **THIS IS NOT A SCHEMA GAP, AND I CHECKED RATHER THAN ASSUMED.** `NMUd0oX_7Pg`, from the same
pipeline, **does** carry `EXIT_HINT` `object='stop goes below low'`. **The schema supports a
source-owned stop; sVkm's extraction simply dropped one that is stated in plain imperative
English.** So the defect is in extraction coverage, not in representational capacity.

⚠️ **Consequence if executed as compiled:** the strategy has **no source stop and no source
target**, and `framework_overlay` hands both to the framework — so a trade would run on
house risk while every provenance field cites this teacher. **The teacher's `2R` is the entire
profit model; it is not a detail.**

---

## 4. 🛑🛑 THE PRODUCER PROBLEM — THESE 40 SPECS DID NOT COME FROM THE CURRENT PIPELINE

Found while tracing link 2, and **GPT does not have this**:

**MEASURED:** all 40 production specs carry the *identical* overlay —
`{"sizing":"framework_owned","stop":"framework_owned","take_profit":"framework_owned"}`. **A
constant across 40 rows is not a measurement of anything.**

**But the current producer emits a DIFFERENT SHAPE.** `spec_producer.py:675-679`:
```python
if _untaught_exit(strategy_extraction):
    spec_body["framework_overlay"] = {
        "exit": _HOUSE_DEFAULT_EXIT,
        "exit_source": "framework_overlay_style_c",
    }
```
⇒ keys `exit` / `exit_source`, **not** `stop` / `take_profit` / `sizing`, and **only when the exit
is untaught**.

**And the literal `framework_owned` exists NOWHERE in production code.** Repo-wide grep
(`*.py *.ts *.js *.sql`, excluding `node_modules`) returns **three** hits: two TypeScript **test
fixtures** for the onboarding service and one unrelated Python test name. **History search
(`git log --all -S`) shows it only ever entered via those test files** — positive control:
the same `-S` search for `framework_overlay_style_c` returns real producer commits, so the search
works.

**The onboarding service only passes the overlay through** (`spec-onboarding-service.ts:246`) and at
line 829 it tests for `spec.framework_overlay["exit"] === "house-default (trader taught none)"` —
i.e. **it expects the `spec_producer` shape, not the shape the production rows actually carry.**
**And `onboardSpecArtifact` has no non-test caller** (confirms `[money-path-reachability]`:
`src/engine/extraction` = 0 WIRED / 264 UNREACHABLE).

⇒ **The 40 rows the money path depends on were produced by a path I cannot identify in the current
tree.** ★ **`A PIPELINE THAT CANNOT REPRODUCE ITS OWN OUTPUT IS NOT THE PIPELINE THAT MADE IT.`**

---

## 5. WHY THIS IS §10.6 AND NOT A NORMAL RED

§10.6: *"the raw transcript hash/span authority cannot be tied deterministically to the corrected
spec."*

- **What IS tieable:** raw transcript ↔ existing spec, via `span` + sha256. Verified.
- **What is NOT:** raw transcript ↔ a **corrected** spec. Repairing link 2 means the spec must gain
  stop/target conditions — and **there is no identified producer to regenerate them through.**
  Hand-writing conditions into a persisted DB row would mint an artifact **no producer can
  reproduce**, destroying exactly the provenance §6 requires me to preserve.
- Repairing link 6 instead (the FVG directionality) would be repairing the **second** break while
  the first stands — and §7 orders the **first** measured link.

**This is a fork I may not resolve alone** (§0-CTRL.6): it decides whether V1.0 proceeds on an
artifact whose producer is unknown.

---

## 6. RECOMMENDATION — THREE OPTIONS, WITH MY PICK

1. **★ RECOMMENDED — identify/rebuild the producer for `sVkm` alone.** Re-run the real extraction →
   spec path for this one video, confirm the output reproduces the existing 35 conditions **plus**
   the missing stop/target, and bind it to the raw sha256/spans. **Bounded to one video.** It also
   answers §4 definitively, which nothing else does.
2. **Repair link 6 first** (`_eval_fvg` → `_select_directional`, which already exists) and accept a
   framework-owned exit for the first trade, deferring link 2. **Cheapest to a trade, but the trade
   would not be source-faithful on stop/target** — and AR-1046 §7 forbids replacing a source-owned
   stop/target with the framework overlay.
3. **Switch to `Qxlu8v_6G3Y`** (§1 backup). ⚠️ It is the **sparsest** extraction of all 12
   (717 chars/item) — **by the very metric that caused my ranking error** it is the most likely to
   have the same class of hole. I would expect to find one.

**I did not choose. Option 1 mutates nothing yet and is where I would start on your word.**

---

## 7. DISCRIMINATOR STATUS (§8)

| # | discriminator | status |
|---|---|---|
| 1 | OR high/low moves → threshold moves | not built (link 2 blocked) |
| 2 | close-outside vs wick-only breach | taught + extracted (9432-9513); not built |
| 3 | bullish vs bearish → matching directional FVG | **KNOWN FAILING** — `any_active` |
| 4 | FVG inside vs outside the OR | taught (11521-11623); **no composition in `_eval_fvg`** |
| 5 | two candles vs completed third | taught (12568-12683); not built |
| 6 | candle-3 close moved → entry moves | not built |
| 7 | FVG-candle wick extreme moved → stop moves | **CANNOT BUILD — the stop is absent (§3)** |
| 8 | 2R mutated → target changes | **CANNOT BUILD — the target is absent (§3)** |
| 9 | long/short mirror without EMA proxy | **KNOWN FAILING** — proxy is the documented mechanism |

**7 and 8 are not "not yet built" — they are unbuildable until link 2 is repaired.** That is the
sharpest argument that link 2 is genuinely first.

---

## 8. WHAT I DID NOT MEASURE

- Links 3, 5, 7 not traced to evaluators — I stopped at the first break, per §7.
- I did **not** run any backtest, compile, or `execution_refusal()`.
- I did **not** identify the actual historical producer of the 40 rows — only proved it is not the
  current `spec_producer.py` + `spec-onboarding-service.ts` pair.
- I did **not** verify the long-mirror example (span ~17850+) resolves to the same taught rule.
- `TF_FVG_IDENTITY_ENABLED` is default-OFF; I did **not** measure behaviour with it ON.

## 9. SELF-AUDIT (§0-CTRL.4)

- **I ranked `sVkm` LAST of 12 and GPT made it the golden source.** Root cause measured: I triaged
  8 of 12 by their **spec rows**, and **GPT's two picks are the two SPARSEST extractions in the set**
  (597 / 717 transcript-chars per item vs 175–306). ★ **THE CLEANEST TEACHER PRODUCES THE THINNEST
  EXTRACTION** — extraction density measures verbosity and anti-measures determinism, so my triage
  was **inverted, not unlucky**. I also wrote *"the source is ambiguous"* when the true sentence was
  *"I have not read it"*, and published `0/12 clean` having fully read 5.
  **Banked to memory and minted into doctrine as `worker-execution §2a-bis`
  (`ops/claude-doctrine 07c0977`), ported to the divergent `.agents` copy.**
  ⚠️ **`.agents/` is under NO version control** — that port is on-disk only and can be lost.
- **This AR's own §6 option 3 is scored by the metric that caused that error**, and I flagged it
  rather than quietly ranking `Qxlu` second again.
- **I ran the `-S` history search with a positive control** before claiming `framework_owned` has no
  producer (§4).
- **I checked `NMUd`'s `EXIT_HINT` before calling §3 a schema gap** — it is not one, and asserting
  otherwise would have pointed the repair at the wrong layer.

**Nothing blocking for the operator.** Engineering branch untouched at `0bbcabc8`.
