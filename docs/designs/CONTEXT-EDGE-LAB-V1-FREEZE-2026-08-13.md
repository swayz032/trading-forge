# CONTEXT EDGE LAB V1 — FROZEN DESIGN

**Status:** FROZEN DESIGN CONTRACT  
**Freeze date:** 2026-08-13  
**Scope:** Trading Forge generic strategy research capability  
**Implementation status:** NOT AUTHORIZED TO INTERRUPT THE CURRENT COMPILER / AR-1138 CRITICAL PATH

---

## 1. PURPOSE

The Context Edge Lab answers a different question from the compiler.

- **Compiler question:** did Trading Forge preserve and execute what the source actually taught?
- **Context question:** under which observable market conditions does a faithfully compiled strategy's expectancy strengthen, weaken, or disappear?

The Context Edge Lab MUST NOT alter source-faithful strategy semantics merely to improve a backtest.

A strategy may pass Context Edge Lab unchanged. Context is allowed to help, hurt, or do nothing.

---

## 2. THREE STRATEGY CLASSES — NEVER MERGE THEM

### `SOURCE_FAITHFUL`

The certified source strategy exactly as authorized by source evidence.

- no Trading Forge context filter may silently enter this object;
- source-owned stop/target semantics remain source-owned where taught;
- framework defaults are separately provenance-stamped where the source did not teach the field;
- source-faithful results remain permanently reproducible as the control arm.

### `TF_CONTEXT_CHALLENGER`

A separately identified research variant created only after a context hypothesis is registered.

It carries:

- parent source strategy identity/hash;
- context feature-set version;
- hypothesis ID;
- discovery population and date range;
- confirmation population and date range;
- trial-count / selection-history receipt;
- exact changed eligibility rule(s).

### `TF_CONTEXT_OPTIMIZED`

A challenger that survives the required confirmation and robustness gauntlet.

Promotion never overwrites or relabels the source-faithful parent.

---

## 3. V1 FAST-PATH ARCHITECTURE

V1 is **observer-first**.

During the same historical pass that executes a source-faithful strategy, Trading Forge should record deterministic context at the signal/decision timestamp.

The observer MUST NOT veto the trade, move the stop, move the target, alter size, or change strategy state.

The desired single-pass shape is:

```text
SOURCE_FAITHFUL SIGNAL / TRADE
        |
        +--> normal source-faithful execution and ledger
        |
        +--> CONTEXT SNAPSHOT at decision time
               - market state
               - direction / MTF relationship
               - deterministic structural location
               - deterministic price-action state
               - volatility state
               - session/time state
               - path / obstacle state when available
```

This prevents an unnecessary second replay merely to collect basic context and preserves the fastest robust money path.

---

## 4. CONTEXT FEATURE REGISTRY

Every context feature is versioned, deterministic, causally available at the decision timestamp, and independently testable.

No feature may exist only as prose such as "looks bullish" or "strong rejection."

Initial families:

### A. Market state

- trend / range / compression / expansion;
- volatility regime and percentile state;
- directional persistence / chop measures;
- relevant session state.

### B. Direction and multi-timeframe relationship

- higher-timeframe directional state;
- execution-timeframe directional state;
- aligned / countertrend / mixed / unknown;
- no future swing information may define current direction.

### C. Location / structure

Examples where deterministic data support exists:

- prior-day / prior-week / session highs and lows;
- opening-range boundaries;
- confirmed swing structure;
- VWAP / other explicitly defined reference levels;
- FVG / sweep / MSS / displacement / order-block families where existing production primitives are authoritative and parity-tested;
- distances to these structures in ticks, points, ATR units, or other versioned normalized measures.

### D. Price-action state

Examples:

- deterministic candle-pattern definitions;
- rejection / failed-break / break-reclaim definitions;
- displacement state;
- candle-close location and wick/body geometry;
- any pattern must have exact machine semantics and completed-bar timing rules.

### E. Path / obstacle quality

Where a deterministic structural engine can support it:

- distance to the next relevant opposing structure;
- target-room ratio;
- immediate obstruction flag;
- structural congestion / open-space measures.

### F. Time

- RTH / ETH state;
- time since session open;
- time-of-day bucket;
- day-of-week where justified;
- all clocks exchange-calendar aware.

No family is mandatory for every strategy.

---

## 5. ZERO-LOOKAHEAD LAW

A context value is admissible only if it could have been known by the production system at the exact strategy decision timestamp.

Forbidden examples include:

- using a future swing high/low to classify current structure;
- using a candle's final close before that candle closed;
- classifying the day's regime from information that occurred after entry;
- using a later reaction to decide whether a level was important at entry;
- deriving a feature from final trade outcome.

Every feature implementation must have at least one causal-mutation / temporal-boundary test capable of turning red when future information leaks in.

---

## 6. VISUAL INTELLIGENCE — TWO JOBS, ONE ARCHITECTURE

Visual intelligence is preserved but separated by purpose.

### 6.1 Source Visual Intelligence

Purpose: reconcile source transcript with what the teacher visibly demonstrates on the chart/video when transcript text alone is incomplete or ambiguous.

Examples:

- "enter here" while pointing at a specific chart object;
- visual timeframe or structure necessary to understand a source-owned rule;
- chart-and-transcript reconciliation for compiler coverage.

This belongs to compiler/source understanding and remains evidence-gated.

### 6.2 Market Visual Intelligence

Purpose: describe market context surrounding a strategy signal.

For historical backtesting, structured deterministic OHLCV/market primitives are preferred over screenshot-model inference whenever the same fact can be computed directly.

Reason:

- faster;
- reproducible;
- scalable across long history;
- easier to mutation-test;
- avoids rendering every historical chart;
- avoids model drift.

Visual-model inference is reserved for genuinely visual information that structured data cannot faithfully recover.

The two uses share concepts where appropriate but MUST NOT collapse source evidence and market-context inference into one authority.

---

## 7. DISCOVERY IS NOT PROOF

Context observation first creates a **conditional edge map**.

Example questions:

- does expectancy change when trend aligned?
- does a strategy behave differently near a prior extreme?
- does target-room matter?
- is performance concentrated in one volatility/session state?

A discovered relationship is a hypothesis, not a promoted filter.

Before confirmation:

1. register the hypothesis;
2. freeze the exact feature definition and threshold(s);
3. record discovery data range/population;
4. record how many hypotheses/configurations have already been tested;
5. define the confirmation/OOS population before reading its result.

The same observations may not both invent and certify the rule.

---

## 8. NO BRUTE-FORCE BEST-COMBINATION SEARCH

Forbidden:

- unbounded combinatorial searches over candle patterns, levels, sessions, thresholds and regimes followed by selecting the best Sharpe;
- repeatedly changing thresholds on the same holdout until it passes;
- hiding failed context experiments from trial-count accounting;
- post-hoc relabeling of a discovery as pre-registered.

Context search must use bounded hypothesis families and honest trial accounting.

---

## 9. CHALLENGER VALIDATION GAUNTLET

A context challenger may be promoted only with evidence appropriate to its sample size and strategy frequency, including the applicable subset of:

- untouched out-of-sample confirmation;
- chronological walk-forward with embargo where appropriate;
- CPCV where appropriate;
- PBO / overfit-risk measurement;
- Deflated Sharpe Ratio / trial-aware performance assessment;
- White Reality Check / SPA where applicable;
- Monte Carlo / bootstrap on the observed ledger;
- parameter/threshold perturbation and plateau tests;
- regime stability;
- commission/slippage/execution stress;
- sufficient effective sample size;
- deterministic replay parity.

Passing historical statistics does not waive execution correctness or paper qualification.

---

## 10. STRATEGY-SPECIFIC CONTEXT DNA

No universal "A+ confluence filter" is assumed.

Each strategy may eventually carry a context profile such as:

- favorable;
- neutral / unproven;
- unfavorable;
- insufficient sample.

The profile is descriptive until an independently validated challenger exists.

A strategy whose source-faithful version is already robust may be promoted without a context filter if context does not add reliable value.

---

## 11. FAST ENGINEERING / POPULATION FUNNEL

The Context Edge Lab must not force expensive deep research on the full library.

Preferred flow:

```text
faithfully compiled library
        -> cheap source-faithful screening
        -> survivors / credible candidates
        -> context edge analysis
        -> bounded challengers
        -> heavy robustness only on finalists
```

Context snapshots may be recorded during the cheap source-faithful pass when computationally cheap and production-deterministic.

Expensive context experiments, visual-model work, or new primitive development are authorized only by measured candidate value or measured compiler/context failure clusters.

---

## 12. MONEY-PATH PLACEMENT

Context Edge Lab does **not** move in front of the current compiler breakthrough.

The intended lifecycle is:

```text
real source extraction / certification
-> faithful compiler
-> full-library deterministic disposition
-> source-faithful edge screening + cheap context snapshots
-> shortlist
-> Context Edge Lab on survivors
-> challenger confirmation / robustness
-> replay / prop-rule simulation
-> PAPER
-> TopstepX evaluation candidate
```

TopstepX remains downstream of strategy qualification. It is not the research laboratory used to discover whether a strategy has edge.

---

## 13. PAPER INTERACTION

During an official PAPER qualification window:

- strategy artifact/config/risk/execution versions are frozen;
- context observation may continue as read-only telemetry;
- context research may generate recommendations for a future candidate version;
- no nightly process may silently mutate the strategy under test;
- a semantic change restarts qualification for the changed version.

The 3AM learning/intelligence loop is advisory/evidence-producing during the official PAPER window unless a separately authorized future protocol defines a new experiment.

---

## 14. DESIGN CHANGE CONTROL

This file is the V1 freeze.

Material semantic changes require a visible successor or amendment, with:

- changed rule;
- reason;
- evidence that motivated it;
- migration/compatibility effect;
- whether prior results remain comparable.

Do not silently edit the meaning of a previously run context feature or challenger.

---

## 15. CURRENT AUTHORIZATION

As of this freeze:

- design documentation: AUTHORIZED;
- current AR-1138 compiler/grading work: remains P0 and must continue uninterrupted;
- broad Context Edge implementation before compiler vertical closure: NOT AUTHORIZED;
- cheap context-carrier hooks may be designed only when they do not delay the compiler path;
- full Context Edge execution begins after faithful compiler/batch capability exists and is applied primarily to surviving edge candidates.

**Frozen principle:** collect context cheaply, prove source edge first, deepen only on survivors, and never confuse context optimization with source fidelity.
