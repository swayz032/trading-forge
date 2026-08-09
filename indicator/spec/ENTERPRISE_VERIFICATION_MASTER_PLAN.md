# Enterprise / Institutional Verification Master Plan

Status: mandatory verification architecture for the Slumdawg 5-minute NQ/MNQ indicator.

The term "institutional/enterprise grade" is used here as an engineering target, not as a certification claim. The indicator is not approved for live decision support until the applicable gates in this plan and `PRODUCTION_GATES.md` pass with retained evidence.

## 0. Governing principles

1. **Software certainty is separated from market uncertainty.** Determinism, data integrity, state identity, and reason codes are engineering requirements. Profitability is probabilistic and requires out-of-sample evidence.
2. **Fail closed.** Unknown, stale, gapped, malformed, off-grid, contradictory, or unsupported data produces `NO_SIGNAL`/blocked state rather than a guess.
3. **No hidden discretion.** Human words such as strong, close, major, good, middle, fakeout, big candle, and liquidity pool must resolve to explicit measurements or remain blocked in `AMBIGUITY_REGISTER.md`.
4. **No future leak.** A result is not valid if it uses information unavailable at decision time.
5. **No retrospective beautification.** Realtime state, historical reconstruction, and post-reload state are separately identified and compared.
6. **One source of semantic truth.** The Python reference engine is the semantic oracle; Pine and FXR must prove parity.
7. **Pre-register before grading.** Final holdouts and pass/fail thresholds are frozen before results are opened.
8. **Every important guard needs a kill test.** Deliberately breaking the rule must turn a test red.
9. **Evidence is versioned.** Code SHA, config hash, dataset fingerprint, platform version, contract, timezone/session, and result artifact travel together.
10. **No live-size justification from synthetic data.** Synthetic/fuzz tests can prove software properties, not market edge.

---

## 1. Verification domains

### V01 — semantic traceability
Goal: prove every visual trading rule has one unambiguous code meaning.

Required evidence:
- rule -> requirement ID -> function/state -> test -> golden fixture mapping;
- ambiguity register has zero unowned production-blocking terms;
- reason code dictionary is exhaustive and versioned;
- forbidden semantic substitutions are mutation-tested.

Examples:
- red trendline = overall direction context only;
- yellow = proof level / entry arming location;
- blue/liquidity pool = internal `REACTION_ZONE`;
- trendline crossing cannot silently become intraday-bias logic.

### V02 — market-data correctness
Goal: prove the indicator is operating on trustworthy and correctly classified data.

Test matrix:
- realtime, delayed, stale, unknown;
- disconnect/reconnect;
- missing interval / gap;
- duplicate updates;
- out-of-order updates;
- future timestamps;
- clock skew;
- feed restart;
- symbol/contract switch;
- contract roll;
- DST boundaries;
- weekends/holidays/maintenance;
- no-trade interval vs actual outage.

Live-decision-support mode MUST block delayed/stale/gapped/unknown data.

### V03 — numerical correctness
Goal: eliminate floating-point/tick-grid discrepancies.

Required:
- NQ/MNQ prices normalized against an explicit 0.25-point grid;
- off-grid values rejected by default;
- any snapping is explicit and reason-coded;
- Decimal/reference arithmetic used for critical grid tests;
- boundary tests at exact threshold, one tick below, one tick above;
- NaN/Inf/negative/overflow/underflow tests;
- rounding policy identical across Python/Pine/FXR where representable.

### V04 — time and session correctness
Goal: no hidden timezone/session shifts.

Required:
- America/New_York handling for user-facing time;
- DST transition tests;
- platform-native previous completed Daily candle for PDH/PDL;
- platform-native previous completed Weekly candle for PWH/PWL;
- explicit source timestamps and bar-open/bar-close semantics;
- parity screenshots/data snapshots around DST and contract roll.

### V05 — 5-minute intrabar state machine
Goal: exact reproduction of the manual Push sequence.

Must prove:
- one event advances at most one state;
- one flash spike cannot fake multiple pushes;
- equal-price reprints cannot count as new pushes;
- recoil invalidates stale momentum;
- slow Push 2 does not become good momentum merely by eventually reaching price;
- Candle 2 failure -> Candle 3 promotes Candle 2 extreme and resets;
- crash/restart produces identical continuation;
- LONG/SHORT mirror symmetry;
- event replay is byte/state equivalent.

### V06 — candle-quality measurement
Goal: replace visual ambiguity with explicit telemetry.

Measure separately:
- body/range fraction;
- upper/lower wick fraction;
- close location;
- displacement;
- elapsed time / speed;
- recoil fraction;
- hold near favorable extreme;
- push acceleration/deceleration;
- doji-like geometry via calibrated threshold.

No composite score is accepted until component logging and ablation exist.

### V07 — multi-timeframe / repaint safety
Goal: 5m/15m/4h/D/W context cannot leak future information.

Required:
- confirmed swing time is distinct from pivot time;
- HTF values only become eligible when actually confirmed/closed per rule;
- lookahead/repainting mutation tests;
- live vs reload comparison;
- lower-timeframe reconstruction clearly labeled where used;
- missing lower-timeframe coverage blocks exact intrabar claims.

### V08 — reaction-zone detection
Goal: define and validate "liquidity pools" as deterministic historical reaction zones.

Software tests:
- cluster order independence;
- single random wick not automatically promoted to a pool;
- equal-high/equal-low ambiguity policy;
- bounded zone width;
- age calculation;
- cross-timeframe confluence identity;
- overlapping-zone merge/split rules;
- no duplicate zone IDs;
- same source data -> same zones.

Market study:
- first-revisit reaction uplift versus matched non-zone controls;
- zone age/timeframe/reaction-count/confluence slices;
- penetration depth and approach-speed effects.

### V09 — yellow proof-level selection / anti-fakeout logic
Goal: choose a structurally meaningful level that is neither noise-close nor impractically far.

Required comparisons:
- nearest eligible wick baseline;
- fixed-distance baseline;
- structure-only baseline;
- Goldilocks structure+distance selector;
- countertrend vs with-trend thresholds;
- missed-move rate from too-far selection;
- false-break/reclaim rate from too-close selection;
- deterministic tie-breaks;
- candidate order independence.

### V10 — target selection
Goal: encode conservative near-side targeting faithfully.

Required:
- long -> near/lower side of upper reaction zone;
- short -> near/upper side of lower reaction zone;
- far wick is not default TP;
- weak move -> closer qualified pool;
- strong with-trend move may skip close minor pool only under frozen rule;
- countertrend move remains conservative;
- big-displacement/intermediate-zone logic separately calibrated;
- target snapped to valid price grid.

### V11 — runtime operational guard
Goal: a correct algorithm cannot be presented in an unsafe operating context.

Required:
- runtime mode: REPLAY / STUDY / LIVE_DECISION_SUPPORT;
- feed state banner/reason code;
- wrong symbol/timeframe block;
- stale-by-clock block;
- data-gap block;
- delayed feed live block;
- platform limitation disclosure;
- explicit `UNKNOWN` state.

### V12 — cross-platform differential testing
Goal: eliminate Python/Pine/FXR semantic drift.

For every golden fixture, compare:
- selected reaction zones;
- proof candidate set;
- selected yellow level;
- momentum transition sequence;
- reason codes;
- target zone and conservative target;
- time/bar identity;
- tick-normalized prices.

State identity tolerance: zero.
Price tolerance: zero ticks unless a documented platform feed discrepancy makes exact equality impossible; any exception is explicit and fixture-specific.

### V13 — fuzz/property/metamorphic testing
Required properties:
- LONG/SHORT mirror symmetry;
- input-order invariance where order is semantically irrelevant;
- translation invariance for relative-price logic when tick grid is preserved;
- scale/volatility normalization properties where defined;
- replay determinism;
- serialize/restore determinism;
- monotonic component-score behavior;
- no impossible state transitions;
- no entry without required predecessors.

Fuzz classes:
- random walks;
- jump diffusion / flash spikes;
- sawtooth chop;
- one-direction trend;
- mean reversion;
- repeated equal prices;
- alternating one-tick updates;
- sparse updates;
- bursty updates;
- malformed event injection.

### V14 — mutation testing / red team
Plant at least these defects:
- nearest-wick auto-selection;
- too-far level always preferred;
- trendline crossing flips intraday direction;
- one update advances multiple push states;
- recoil ignored;
- Candle-3 reset removed;
- future swing exposed early;
- far wick used as TP;
- countertrend skips close target too aggressively;
- delayed feed treated as realtime;
- off-grid target rounded silently;
- NaN score allowed into sort;
- candidate input order changes output;
- platform-native PDH replaced by custom session without declaration.

Every mutation must be killed by at least one named test.

### V15 — performance/capacity
Performance is measured independently of correctness.

Required:
- update throughput under 1x, 5x, 10x expected burst rates;
- memory growth / leak test;
- maximum historical object count;
- Pine execution/object/request budgets;
- FXR runtime limits;
- worst-case reaction-zone candidate count;
- startup/reload time;
- alert latency distribution;
- degradation behavior when resource limit approaches.

Never silently drop a required calculation to meet performance.

### V16 — chaos/recovery
Inject:
- process kill at every state transition;
- restart during BREAK/PUSH_1;
- reconnect after data gap;
- duplicate replay after reconnect;
- contract change mid-setup;
- corrupted snapshot;
- unsupported snapshot version;
- partial configuration load;
- missing higher-timeframe series;
- missing Daily/Weekly source.

Expected result: deterministic recovery or fail-closed reset; never a ghost `ENTRY_READY`.

### V17 — statistical edge validation
See `RESEARCH_PLAN.md`.

Mandatory additions:
- effect sizes plus confidence intervals, not only win rate;
- untouched final holdout;
- walk-forward windows;
- regime stratification;
- parameter stability surfaces;
- false-discovery/multiple-testing control where many variants are searched;
- trade dependency / clustered-day resampling where appropriate;
- MAE/MFE;
- stop-first vs target-first path ordering;
- costs/slippage sensitivity;
- NQ and MNQ analyzed separately when data permits;
- no survivorship from deleting ugly days/setups after results are seen.

### V18 — case-study program
Maintain three case libraries:
1. **Golden wins** — method should qualify and explains why.
2. **Golden rejects** — visually tempting but method should refuse.
3. **Adversarial edge cases** — gaps, dojis, violent rejection, huge candles, nearby pools, countertrend fakeouts, DST, roll, data gaps.

Every production bug becomes a permanent regression case.

### V19 — observability/auditability
Every setup ledger row should contain:
- code version / commit SHA;
- semantic spec version;
- config/calibration version;
- dataset/provider/platform;
- contract/symbol;
- timestamps;
- overall direction context;
- candidate reaction zones;
- rejected proof candidates + reasons;
- selected proof level + reasons;
- every momentum transition;
- candle-quality components;
- runtime/data-quality state;
- target candidates + selected target + reason;
- eventual research outcome fields if in evaluation mode.

No unexplained BUY/SELL arrow is production-acceptable.

### V20 — release/change governance
Required before promotion:
- branch review;
- automated test pass;
- mutation suite pass;
- no unresolved P0/P1 defects;
- versioned changelog;
- semantic diff review;
- config diff review;
- golden-fixture diff review;
- research evidence manifest;
- rollback version retained;
- release label signed/traceable where repository infrastructure permits.

A code change and a calibration change are separate release events.

### V21 — secure software / supply chain
Apply secure-development practices proportionate to this component and Trading Forge:
- least-privilege GitHub Actions permissions;
- pinned/controlled dependencies;
- dependency vulnerability scanning;
- secret scanning;
- code scanning/static analysis;
- provenance/SBOM where the enclosing deployment supports it;
- reviewed third-party Pine/FXR/library code;
- no secrets in indicator source or telemetry.

### V22 — human-factors verification
Because this is decision support:
- realtime vs delayed status must be obvious;
- `NO_SIGNAL` must be visually first-class;
- reason codes must be interpretable;
- countertrend setup must be visually distinguishable from with-trend setup;
- provisional/realtime values must look different from confirmed/frozen levels;
- warnings cannot be hidden behind a score;
- UI must not imply certainty or guaranteed reaction.

---

## 2. Release ladder

### L0 — SPEC_ONLY
Semantics drafted; unresolved ambiguity allowed.

### L1 — REFERENCE_VERIFIED
Reference code passes deterministic, numeric, state, fuzz, mutation, and recovery gates.

### L2 — PLATFORM_PARITY
Pine and FXR match Python on approved fixtures and runtime/reload tests.

### L3 — RESEARCH_VERIFIED
Real-market out-of-sample evidence passes pre-registered thresholds.

### L4 — SHADOW_VERIFIED
Realtime shadow logs demonstrate stable parity and operations without orders.

### L5 — LIVE_DECISION_SUPPORT
May inform a human trader. Still never described as guaranteed, autonomous execution-safe, or profitable by construction.

No level may be skipped.

---

## 3. Evidence retention

For every gate execution retain:
- test command;
- start/end UTC;
- code SHA;
- config SHA;
- dataset fingerprint;
- seed(s);
- platform/runtime version;
- pass/fail counts;
- failures with minimized reproducer;
- generated report/artifacts.

A screenshot by itself is not test evidence; it is a fixture or case-study input until tied to exact market data and expected outputs.

---

## 4. Definition of done

The indicator is not considered enterprise/institutional quality merely because all unit tests are green. Done means:

1. semantic ambiguity is bounded and owned;
2. engineering behavior is deterministic and fail-closed;
3. numerical/time/data handling is proven;
4. mutations are killed;
5. platform implementations match the oracle;
6. real-market edge survives untouched data and costs;
7. live shadow behavior matches research assumptions;
8. failures are observable, recoverable, and regression-tested;
9. releases are traceable and reversible;
10. the UI clearly separates confirmed fact, provisional state, and probabilistic trade hypothesis.
