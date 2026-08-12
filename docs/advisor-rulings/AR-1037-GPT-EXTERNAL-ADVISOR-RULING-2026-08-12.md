# GPT EXTERNAL ADVISOR RULING — AR-1037 / TIER-A SCAN ACCEPTED AS BOUNDED DIAGNOSTIC / WHOLE-LIBRARY CLAIM REJECTED / ORB IS A STRATEGY FAMILY, NOT ONE RULE / FULL ORB-SUBSET SCAN FIRST

## 1. VERDICT

**AR-1037 is ACCEPTED AS A BOUNDED DIAGNOSTIC ONLY.**

The 13 committed Tier-A provenance records were measured honestly and the findings inside that population are useful:

- 7/7 executing Tier-A sources have approximated triggers;
- 6/6 refusing Tier-A sources do not;
- taught binding parameters are absent across that 13-record population;
- the NQ EMA source demonstrates a real fidelity problem because its taught EMA numbers do not reach execution while the plan still reports executable.

However, the headline **“NO SOURCE IN THE LIBRARY MEETS §7” is REJECTED AS OVER-SCOPED.**

The worker explicitly measured only **13 committed Tier-A provenance records** and did not measure the actual larger Trading Forge strategy library. The operator confirms the real library contains multiple ORB strategies.

Therefore the Tier-A sample cannot justify a whole-library conclusion or a broad compiler-semantic rewrite.

## 2. ORB IS A FAMILY, NOT A SINGLE STRATEGY

This is now an explicit architecture rule:

**Different educators teach Opening Range Breakout differently. Trading Forge must preserve each teacher's ORB as a distinct source strategy.**

Examples of dimensions that may differ teacher to teacher:

- 5m vs 15m vs 30m range;
- RTH open vs another session anchor;
- candle close outside the range vs wick/high-low penetration;
- one tick / point / percentage / ATR buffer;
- first breakout only vs repeated attempts;
- immediate entry vs next-bar entry;
- breakout then retest;
- breakout + rejection/confirmation candle;
- long/short direction directly from the break vs an external bias rule;
- fixed stop vs opposite side of OR vs midpoint/half-range stop;
- fixed target vs OR-width projection vs framework-owned exits;
- session expiration/reset rules.

**DO NOT NORMALIZE THESE INTO ONE UNIVERSAL `ORB` RECIPE.**

Instead represent them as separate source-owned strategies/variants, for example conceptually:

`ORB_teacher_A_close_break_5m`
`ORB_teacher_B_wick_retest_15m`
`ORB_teacher_C_breakout_confirmation_30m`

The names are illustrative only; do not invent production names without the actual source IDs.

The compiler's job is to preserve each source's exact mechanics, not decide what ORB “usually means.”

## 3. MARKET-ORIGIN CORRECTION — SOURCE MARKET IS METADATA, NOT A BAN

AR-1036's market-scope wording was too restrictive if interpreted as “a strategy taught on equities/forex should not be tested on futures.”

Correct architecture:

- `SOURCE_MARKET` = where/how the teacher demonstrated the setup;
- `SOURCE_FAITHFUL_MECHANICS` = the rules extracted from that lesson;
- `TRANSFER_TEST_MARKET` = MES, MNQ, MCL, or another market Trading Forge chooses to evaluate.

A strategy taught on stocks or forex may still be tested on futures as a **cross-market transfer candidate** as long as the result is labelled honestly.

Do not say the teacher taught MES if they did not. But do not discard a mechanically portable strategy just because the worked example was stocks or forex.

The actual blocker on `st5e-YJRfKc__s0` remains its unresolved breakout observation rule, not its equities example.

## 4. DO NOT AUTHORIZE A BROAD APPROXIMATION/PARAMETER REWRITE YET

AR-1037 proposed:

1. globally refusing approximated triggers;
2. then building a broad taught-parameter channel.

**HOLD both as broad actions for now.**

Why: the scan motivating them covered only 13 Tier-A records, while the actual library is larger and includes multiple ORB strategies that may already contain explicit deterministic triggers.

Policy still stands:

- an approximated trigger cannot count as a source-faithful V1.0 trade;
- do not silently label approximation as exact;
- but do not mutate whole-library execution semantics until the broader source search proves that repair is really the shortest unblocker.

## 5. IMMEDIATE FAST PATH — SCAN THE ACTUAL ORB SUBSET FIRST

Locate the actual strategy-library authority used by Trading Forge — database/library files/manifests/services as applicable — and enumerate every strategy whose source/extraction is an Opening Range / ORB setup.

**Do not assume the Tier-A provenance directory is the complete library.**

For every ORB candidate, inspect the underlying source transcript/extraction and preserve its own mechanics.

Produce one bounded comparison table:

`strategy/source id · source market · OR window · exact breakout observation rule · confirmation/retest · direction rule · stop/target rule · compiler trigger disposition · parameter survival · faithful executable yes/no`.

### Trigger questions to answer from the source

For each ORB transcript, specifically search for:

- close above/below range;
- wick/high-low penetration;
- number of ticks/points beyond range;
- percentage/ATR buffer;
- candle-body requirement;
- hold for N bars;
- next-bar entry;
- retest of ORH/ORL;
- rejection/confirmation after retest;
- first breakout only vs multiple attempts;
- breakout direction directly controls long/short;
- session reset/expiration.

A teacher who says “close outside the 15m OR and buy the retest” and a teacher who says “trade the first wick break of the 5m OR” are **two different strategies**, even though both are called ORB.

## 6. TRANSCRIPT RECOVERY IS AUTHORIZED

If an extraction is ambiguous, search its attributable transcript/source corpus before declaring the strategy dead.

Permitted evidence chain:

`transcript span → extracted condition → canonical rule`.

Not permitted:

- common ORB convention;
- “most traders use candle close”;
- another educator's rule silently filling this educator's silence;
- advisor/worker choosing close-vs-wick for convenience.

If a different transcript teaches a complete ORB rule, that becomes its own strategy candidate.

## 7. CLEAR NON-ORB SETUP ALREADY FOUND — SECONDARY CANDIDATE

Independent advisor inspection found `hcHuDfxdywI__s0` / `institutional_order_block_reversal_entry` with unusually explicit mechanics:

- bullish break of structure;
- defined bullish order block;
- liquidity sweep confirmation;
- imbalance/FVG confirmation;
- unmitigated requirement;
- CHoCH/internal-low break used as entry trigger;
- three explicit limit-entry variants: upper wick, upper body, midpoint;
- stop below lower wick adjusted by spread.

This is a strong source candidate even though its worked market is USDJPY/forex, because cross-market portability can later be tested honestly.

But AR-1037 measured that its current compiler trigger still executes through approximation, so **do not call it source-faithful executable yet.** Keep it as a high-information fallback if the ORB subset does not yield a shorter exact path.

## 8. SELECTION ORDER AFTER THE ORB SCAN

Choose the candidate with the shortest truthful path to one real trade:

1. ORB source with fully explicit trigger/direction already representable by exact existing primitives;
2. ORB source with fully explicit trigger where only one narrow compiler handoff is missing;
3. another clear source such as the order-block setup above with a similarly narrow exact repair;
4. only if none exists, return to generalized taught-parameter/approximation-policy work.

Do not rank by whether the source example was stocks, forex, or futures. Rank by:

**semantic completeness + implementation distance + source fidelity.**

Then separately test transfer markets.

## 9. REQUIRED MONEY-PATH PROOF ON THE WINNER

Once selected:

`source transcript → extraction → canonical condition → exact production binding → persisted config/candidate if applicable → /api/backtests → Python → deterministic entry signal → framework execution → one trade receipt`.

Require:

- trigger False before source condition;
- trigger True exactly when source condition occurs;
- near-miss/wrong-direction arm remains False;
- a meaningful source mutation moves the signal;
- no approximated load-bearing trigger counted as exact;
- no source ambiguity hidden as zero trades.

Then run the smallest historical backtest needed to prove the money path executes a real trade.

## 10. DO NOT DO

- no “whole library has zero faithful candidates” claim from the 13-record Tier-A sample;
- no universal ORB rule;
- no flattening different educators' ORBs into one trigger;
- no market-origin ban on MES/MNQ/MCL transfer testing;
- no forced futures-only source selection;
- no global approximation-gate mutation before the broader ORB scan;
- no broad parameter-channel campaign unless the scan proves it is the shortest unblocker;
- no invented close/wick/retest semantics;
- no ACCEPT-5/RATIFY reopening;
- no manifest cleanup;
- no profitability optimization before one faithful executable trade.

## 11. REPORT / STOP

Continue without another advisor round-trip until one of these occurs:

1. a clear ORB/source is selected and produces one faithful end-to-end trade;
2. the actual ORB subset is exhausted and every member has a measured refusal/gap;
3. the best candidate exposes one load-bearing semantic choice that cannot be made without source invention;
4. accessing the actual broader library is blocked by an unavailable DB/source authority.

If blocked on library access, report where the real library lives, what was accessible, and what was not. Do not substitute the 13 Tier-A fixture directory for the real library.

**FAST PATH:**

`full ORB-family scan → choose clearest teacher-specific ORB → exact compile → one real trade → edge qualification.`
