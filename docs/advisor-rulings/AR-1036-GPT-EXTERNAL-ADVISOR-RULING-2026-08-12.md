# GPT EXTERNAL ADVISOR RULING — AR-1036 / GOLDEN OR SOURCE FAITHFULLY REFUSED / DO NOT INVENT BREAKOUT SEMANTICS / PIVOT NOW TO A FUTURES-SCOPE EXECUTABLE SOURCE

## 1. VERDICT

**AR-1036 STOP IS ACCEPTED.**

The worker obeyed the stop condition correctly. No production mutation was made, the engineering branch remains exactly at `0bbcabc81ae2ed6350bcda4d8494cff1e618dd81`, and the source/compiler evidence supports the refusal.

The current golden `opening_range_breakout` source **does not contain enough source-owned information to define a deterministic breakout trigger without invention**.

Therefore:

- **Do not bind trigger #4 by choosing close-vs-wick, tolerance, hold time, or retest semantics.**
- **Do not force a trade from this source.**
- **Do not weaken the existing `SOURCE_AMBIGUOUS / opening_range_breakout_confirmation_unresolved_from_source` refusal.**
- **Do not call this source an executable OR V1.0 strategy.**
- **Do record it as a successful compiler-fidelity outcome: `FAITHFUL_REFUSAL`.**
- **Move immediately to the next source that can produce a real deterministic trade.**

This is not a compiler failure. A compiler that refuses where the source is underspecified is behaving correctly.

## 2. INDEPENDENT SOURCE CHECK — THE FULL COMMITTED RECORD STILL DOES NOT RESOLVE THE TRIGGER

I did not accept the worker's conclusion from the one refused condition sentence alone. I independently inspected the full committed provenance record:

`docs/replay-results/h1-battery/tier-a-extraction-provenance/st5e-YJRfKc__s0.json`

The complete entry sequence says, in substance:

1. form the 5/15/30-minute opening ranges;
2. take the opening-range high and low;
3. after the range is over, look for a breakout above or below;
4. whichever direction breaks represents initial directional conviction;
5. when price breaks above the range high, buyers overcame resistance.

What it does **not** specify anywhere in the certified record:

- candle close beyond the range;
- wick/high-low penetration as sufficient;
- number of ticks/points beyond the range;
- percentage/ATR tolerance;
- one-bar or multi-bar hold;
- required retest;
- required confirmation candle;
- any other deterministic confirmation rule that resolves those alternatives.

The source therefore supports the semantic concept `breakout above/below the range`, but does not choose the executable observation rule needed for bar-by-bar backtesting.

Choosing one would be an advisor invention, not extraction fidelity.

## 3. RESOLVE THE §6 TENSION — TWO DIFFERENT FINISH LINES

AR-1036 correctly identified a wording tension in the prior ruling. Resolve it explicitly:

### Compiler-fidelity finish line

For this exact source, a deterministic named refusal **is a valid completed compiler outcome**.

The compiler has proved:

`source words → typed OR definition → exact candidate → persisted identity → compiled_spec transport → exact candidate handoff → source-ambiguity refusal before fabricated entry`.

That is a meaningful success. The system learned where it must stop.

### Money-path executable-strategy finish line

A named refusal is **not** an executable V1.0 trading strategy and does not satisfy the money-path requirement for a real backtestable candidate.

So the status is:

- **OR compiler/fidelity slice: SUCCESSFUL FAITHFUL REFUSAL.**
- **This golden source as executable OR V1.0: NOT COMPLETE / NOT ELIGIBLE FOR EDGE BACKTESTING.**

Do not blur those two meanings again.

## 4. FINDING 3 RULING — `WAIT_SESSION #1` IS NOT A SECOND EXECUTION GATE

The sentence:

> the 5-minute opening range is 9:30–9:35 ET; the 15-minute is 9:30–9:45; the 30-minute is 9:30–10:00

is the **definition of the opening-range window itself**.

That fact is already carried by the typed `OpeningRangeExecutionCandidate` / `OpeningRangeDefinition` as:

- `session_start_local`;
- `source_timezone`;
- selected taught `variant.duration_minutes`.

The certified adapter uses those exact fields to form and lock the range.

**RULING:** for this source, `WAIT_SESSION #1` is **redundant definition evidence**, not a second independent entry gate.

Do not bind it to a separate killzone/session primitive merely to make the plan greener. That would represent one taught fact twice and permit two implementations of the same window to disagree.

Do not mutate the compiler solely to reclassify this row now. Bank the role-cleanup issue if useful; it does not unblock a trade because trigger #4 remains source-ambiguous.

## 5. FINDING 2 RULING — DO NOT FIX THE LATENT EMA DIRECTION PROXY ON THIS DEAD SOURCE

AR-1036 correctly found that the source says the breakout's own direction determines initial conviction, while the generic `direction='both'` path later uses an EMA-slope proxy.

That is a real latent fidelity concern.

But the trigger is already refused, so the direction proxy is unreachable for this source.

**Do not repair it in this lane.**

For the next executable source, require one of these before accepting it:

- the source explicitly declares long or short direction; or
- the bound trigger itself produces a deterministic directional signal; or
- there is already a source-faithful directional primitive.

Do not select a next source whose executable direction would depend on this same unresolved proxy unless that becomes the smallest unavoidable blocker and is separately measured.

## 6. IMPORTANT MARKET-SCOPE RULING — THIS GOLDEN SOURCE IS NOT OUR FUTURES EDGE CANDIDATE ANYWAY

The committed provenance classifies this source as **equities**, with the educator describing stocks and an S&P-500 worked example.

The typed Opening Range definition deliberately carries `market_scope` as source-owned evidence.

Therefore even if the breakout observation were fully specified, we must not present an MES/MNQ/MCL backtest as a source-faithful result of this exact lesson without a separately authorized transfer/generalization claim.

That makes the fast-path decision stronger:

**keep this source as a compiler-fidelity fixture; do not spend more money-path time trying to turn it into the first futures edge strategy.**

## 7. NEXT ACTION — SELECT THE NEXT EXECUTABLE SOURCE USING THE EXISTING COMPILER

Do **not** build a new scanner/checker framework.

Use the existing extracted library + existing compiler/binding/refusal surfaces to identify the next strategy whose source is sufficiently explicit to execute.

Prefer the smallest real strategy satisfying all of the following:

1. **Futures-scope match:** source explicitly teaches futures or a directly relevant futures instrument/market. Prefer MES/ES, MNQ/NQ, MCL/CL-compatible teaching where available.
2. **Deterministic trigger:** the source says exactly what observable event creates the entry trigger. No unresolved close/wick/tolerance/hold/retest ambiguity.
3. **Trigger bound:** compiler reports a real executable trigger, not `SOURCE_AMBIGUOUS`, not a context-only approximation masquerading as a trigger.
4. **Direction deterministic:** source or trigger determines long/short without an unrelated proxy deciding the side.
5. **No invented parameter/default:** all load-bearing source numbers/levels/periods survive or refusal occurs.
6. **Smallest semantic surface:** among valid choices, prefer the candidate with the fewest additional unbound spine conditions and the shortest path to one real trade.
7. **Framework exits remain framework-owned:** do not derail selection into stop/TP optimization. We first need a faithful entry signal and a real backtest path.

A bounded scan/table over the already-extracted strategies is authorized. It should report, per candidate, only the fields needed to choose:

`strategy/source id · market scope · compiled? · trigger bound? · trigger primitive · direction source · unresolved load-bearing reasons · executable yes/no`.

Do not turn that table into a new product subsystem.

## 8. EXECUTE STRAIGHT THROUGH AFTER SELECTION

Once one source meets §7, continue without waiting for another GPT round-trip unless a STOP fires:

`source → compiled_spec → persisted candidate/config if applicable → /api/backtests → Python → real strategy compute → at least one deterministic entry signal → framework-owned backtest execution → trade receipt`.

Required first end-to-end proof:

1. use deterministic fixture/replay bars first;
2. prove the real trigger goes False→True for the source-specified reason;
3. prove the wrong-direction/near-miss arm stays False;
4. prove a source mutation that should move the trigger actually moves it;
5. prove no source ambiguity/refusal is being hidden as zero trades;
6. then run the smallest real historical backtest necessary to prove the money path executes a trade.

Do **not** tune for profitability yet. The first objective is `one faithful executable strategy → one real backtest trade`.

## 9. AFTER THE FIRST EXECUTABLE STRATEGY TRADES

Then move immediately into edge qualification, with the already-banked authority obligations in the correct order:

1. close any load-bearing candidate/config → persisted backtest-row identity gaps exposed by the real run;
2. **`EDGE-HTF-PASSTHROUGH-AUTHORITY-1` before ranking**, if the selected strategy uses HTF eligibility;
3. frozen development backtest window;
4. locked OOS;
5. walk-forward/CPCV as appropriate;
6. Monte Carlo / parameter sensitivity / regime checks;
7. realistic execution + prop-rule simulation;
8. short concurrent paper qualification;
9. only then Slumdawg → TopstepX.

## 10. DO NOT DO

- no invented breakout confirmation for `st5e-YJRfKc__s0`;
- no forced 5m/15m/30m winner selection;
- no separate session gate for the same OR window definition;
- no EMA-direction cleanup on this refused source;
- no ACCEPT-5/RATIFY reopening;
- no canonical-manifest regeneration for the banked post-close drift;
- no cleanup of `validate_candidate_authority`;
- no broad compiler refactor;
- no profitability tuning before a faithful strategy actually trades;
- no equities→futures transfer presented as source-faithful without explicit authority.

## 11. REPORT / STOP CONDITION

The worker may continue autonomously through source selection and the first executable trade.

Report when either:

- one source has produced a real deterministic end-to-end backtest trade through the money path; or
- the existing library contains no candidate meeting the §7 criteria; or
- the selected candidate exposes a load-bearing compiler/trading semantic gap that requires choosing among source meanings rather than wiring an already-defined meaning.

If the whole library has no clean executable source, report the measured reason distribution instead of inventing one.

**FAST PATH NOW:**

`faithful OR refusal banked → choose futures source with explicit trigger → make one real trade end-to-end → edge qualification.`
