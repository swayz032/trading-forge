# Slumdawg V2 — Canonical Auto-Decision, Entry, Candle-Quality, and Take-Profit Specification

Status: **SPECIFICATION / RESEARCH + PLATFORM-PARITY WORK ONLY**  
Date: 2026-08-10  
Scope: NQ/MNQ futures, 5-minute execution with higher-timeframe context  
Live-decision-support approval: **FALSE** until production gates pass

This specification supersedes any experimental Pine-only heuristic that independently guesses BIG DIRECTION, CURRENT MOVE, active plan, entry state, or Take Profit Zones. The TradingView and FX Replay indicators are display/parity implementations of one canonical Slumdawg decision model; they must not become separate trading brains.

---

## 1. Architectural rule — one real Slumdawg logic, multiple platform displays

The authoritative logical chain is:

`MARKET CONTEXT -> CURRENT MOVE -> ACTIVE PLAN -> ENTRY ZONE -> CANDLE/MOMENTUM CONFIRMATION -> ENTRY STATE -> TAKE-PROFIT LADDER -> UI`

Canonical components:

1. **Market Context Engine** — BIG DIRECTION and persistent higher-timeframe structure.
2. **Current Move Engine** — current 15m/5m directional leg and pullback classification.
3. **Entry Structure Engine** — meaningful LONG/SHORT Entry Zones from confirmed structure.
4. **Candle Quality Engine** — deterministic candle geometry and multi-candle sequences.
5. **Momentum Engine** — reference -> BREAK -> PUSH 1 -> quality PUSH 2 -> ENTRY READY.
6. **Reaction/Target Engine** — ordered, distinct reaction shelves and conservative TP penetration.
7. **Platform Adapter** — TradingView Pine / FX Replay render the same canonical states and values.

### 1.1 Forbidden architecture

The following is forbidden:

- Pine invents one direction rule while Python uses another.
- FX Replay independently interprets market direction.
- The top-right panel computes its own direction or plan.
- A UI default such as `LONG` silently chooses the active TP side.
- A missing TP result is hidden as a blank line without a reason code.
- A new screenshot failure is patched by adding an untested magic threshold directly in Pine.

The panel is a **dumb presentation layer**. It displays canonical engine outputs and their reason codes.

---

## 2. Instrument, timeframes, and chart contract

- Intended instruments: **NQ / MNQ futures**.
- Primary execution chart: **5 minutes**.
- Current-move structure: primarily **15 minutes**, with 5m live confirmation.
- Higher-timeframe context may use **1H, 4H, Daily, Weekly**.
- Daily/Weekly platform levels remain:
  - `PDH` — prior completed native Daily high
  - `PDL` — prior completed native Daily low
  - `PWH` — prior completed native Weekly high
  - `PWL` — prior completed native Weekly low
- Automatic trendline drawing remains **DEFERRED / REMOVED** from the active build.
- PDH/PDL/PWH/PWL price semantics from the accepted v0.14.x lane are frozen unless a separate level-parity change is explicitly approved.

---

## 3. BIG DIRECTION — persistent higher-timeframe market structure

Human meaning: **What is the larger market doing?**

Allowed UI states:

- `📈 UP`
- `📉 DOWN`
- `BUILDING / UNCLEAR`

### 3.1 BIG DIRECTION is not a weighted vote

The v0.17 experimental rule that combined Daily/4H/1H using a weighted numeric score is rejected as the final design. A strong countertrend rally must not flip BIG DIRECTION merely because several lower/higher timeframe snapshots temporarily point upward.

### 3.2 Persistent protected-structure state

BIG DIRECTION must behave as a **state machine**, not a per-bar opinion.

A bearish state conceptually contains:

- a confirmed major lower-high / lower-low structure;
- a protected higher-timeframe bearish swing high or equivalent invalidation structure;
- persistence through bullish pullbacks until actual reversal evidence is confirmed.

A bullish state mirrors this with a protected swing low.

Example from the user-approved Aug-10 context:

`BIG DIRECTION = 📉 DOWN`

A strong rally from the major low toward PWH is classified as:

`CURRENT MOVE = 📈 UP PULLBACK`

It does **not** become `BIG DIRECTION = UP` merely because the rally is large.

After rejection from PWH and a renewed lower-timeframe bearish leg:

`BIG DIRECTION = 📉 DOWN`  
`CURRENT MOVE = 📉 DOWN WITH DIRECTION`

### 3.3 Reversal requirement

BIG DIRECTION may change only when the controlling higher-timeframe structure is actually invalidated and opposite structure is confirmed.

The production definition must include measurable versions of:

1. break/close beyond the protected structural invalidation level;
2. confirmation that the break is not just a wick excursion;
3. opposite-side structure confirmation, e.g. an approved higher-low/higher-high sequence for a bearish-to-bullish reversal, mirrored for bullish-to-bearish;
4. deterministic timeframe-conflict handling.

Exact pivot family, close requirement, and confirmation depth are **CALIBRATION_REQUIRED**.

### 3.4 Timeframe conflict rule

The engine must not resolve conflict with a simple majority vote.

Required behavior:

- Daily/4H form the persistent larger-structure context.
- 1H may provide transition/corroboration evidence but cannot by itself reverse BIG DIRECTION.
- 15m never changes BIG DIRECTION; it controls CURRENT MOVE.
- When Daily and 4H conflict, preserve the last fully confirmed larger-direction state or output `BUILDING / UNCLEAR` according to a versioned deterministic rule; do not silently guess.

---

## 4. CURRENT MOVE — the active directional leg

Human meaning: **What is price doing right now inside the bigger market?**

Canonical inputs:

- confirmed 15m swing structure;
- current 15m structural leg;
- 5m live continuation evidence where appropriate.

The old shortcut `most recent pivot timestamp decides direction` is rejected as sufficient logic.

### 4.1 Current move structural states

A 15m move should remain DOWN while the active bearish leg continues to make/defend lower-high/lower-low structure. A small bounce does not flip it to UP until the relevant lower-high structure is invalidated.

Mirror for an UP leg.

### 4.2 Box wording from BIG DIRECTION + CURRENT MOVE

If BIG DIRECTION = DOWN:

- CURRENT MOVE = DOWN -> `📉 DOWN WITH DIRECTION`
- CURRENT MOVE = UP -> `📈 UP PULLBACK`

If BIG DIRECTION = UP:

- CURRENT MOVE = UP -> `📈 UP WITH DIRECTION`
- CURRENT MOVE = DOWN -> `📉 DOWN PULLBACK`

If current move is unresolved:

- `BUILDING 15M MOVE`

The words **PULLBACK** and **WITH DIRECTION** are relationships to BIG DIRECTION; they are not separate independent predictions.

---

## 5. ACTIVE PLAN

The indicator may display both structural Entry Zones simultaneously, but only one side is the **ACTIVE PLAN** for the live entry-state engine.

Allowed states:

- `🟢 LONG`
- `🔴 SHORT`
- `WAIT / BUILDING`

### 5.1 Plan selection

AUTO plan normally follows the confirmed CURRENT MOVE, while retaining the relationship to BIG DIRECTION:

- BIG DOWN + CURRENT DOWN -> active short continuation plan.
- BIG DOWN + CURRENT UP -> active long pullback/countertrend plan.
- BIG UP + CURRENT UP -> active long continuation plan.
- BIG UP + CURRENT DOWN -> active short pullback/countertrend plan.

Countertrend/pullback plans must carry a higher structural-quality burden than with-direction plans. The required delta is **CALIBRATION_REQUIRED**.

The plan must never relabel a pullback as an overall trend reversal.

---

## 6. 🟢 LONG - ENTRY ZONE / 🔴 SHORT - ENTRY ZONE

These are **structural proof lines**, not automatic market orders.

Visual contract:

- full-width horizontal yellow line;
- `🟢 LONG - ENTRY ZONE` label for long;
- `🔴 SHORT - ENTRY ZONE` label for short;
- label offset to the right so it does not block price;
- both sides may remain visible for planning.

### 6.1 Short Entry Zone

The short line belongs at the low/extreme of a **meaningful confirmed swing low / break-of-structure proof level** after price has had enough pullback/structure development that entering before the break would risk being trapped inside the pullback.

The engine must reject:

- nearest random wick;
- tiny internal noise swing;
- a swing that leaves no useful room to the first qualified TP shelf;
- an unconfirmed pivot;
- a stale level whose structure has already been consumed according to future calibrated rules.

### 6.2 Long Entry Zone

Mirror the rule:

- meaningful confirmed swing-high / break-of-structure proof level;
- line at the high/extreme of the selected swing;
- not the nearest random wick.

### 6.3 Dynamic adjustment

The Entry Zone may automatically move when a **new, better confirmed structural swing** forms during the pullback. This behavior is desired and was visually approved in the user examples.

The move must be caused by new confirmed structure, not by repainting an unconfirmed future pivot.

---

## 7. Candle-quality layer — research-gated, geometry first

Candlestick information is an **entry-quality / A+ confirmation layer**, not the primary reason for a trade.

Do not code:

`HAMMER = BUY`  
`ENGULFING = SELL`

Instead encode measurable geometry and sequence context using the existing candle-feature foundation:

- body size / range
- body fraction
- upper/lower wick fractions
- close location inside the range
- directional rejection wick
- displacement versus recent candles / volatility
- hold near favorable extreme
- recoil
- speed / acceleration where realtime information exists

### 7.1 Research sequence A — rejection -> engulf/displacement

User-positive example:

`indecision / doji-like candle -> rejection/hammer-like geometry -> opposite-side strong engulf/displacement through the reference/structure -> continuation`

The canonical detector should describe this as geometry, not depend on textbook candle names.

Candidate state name:

`🕯️ REJECTION -> ENGULF`

The sequence is eligible only when structural context, active plan, Entry Zone, and room to target also qualify.

### 7.2 Research sequence B — first-candle momentum engulf through Entry Zone

A second user-positive example shows that the first strong momentum/engulfing candle passing the Entry Zone can sometimes be a valid early entry before the normal multi-stage confirmation finishes.

This becomes a **separate explicit entry path**, not a weakening of the standard state machine.

Candidate state name:

`⚡ QUALIFIED MOMENTUM ENTRY`

Required evidence categories before this path may qualify:

1. active plan already known;
2. correct structural Entry Zone already selected;
3. candle meaningfully crosses/closes through the Entry Zone in the plan direction;
4. strong body/displacement relative to calibrated local context;
5. closes near the favorable extreme;
6. acceptable rejection wick against continuation;
7. sufficient open room to qualified TP1;
8. direction/current-move context recorded;
9. no disqualifying hard recoil / contradictory structure.

Exact thresholds are **CALIBRATION_REQUIRED**.

### 7.3 Candlestick patterns are not mandatory

A setup may qualify through the standard momentum path without a named candle sequence. Candle sequences are confluence/quality evidence and a possible separately researched early-entry lane.

---

## 8. Standard 5-minute entry state machine

The normal path remains:

`WAIT_PROOF -> REFERENCE_ARMED -> BREAK -> PUSH_1 -> ENTRY_READY`

Human display:

- `⏳ WAIT PROOF CLOSE`
- `📍 REFERENCE ARMED`
- `⚡ BREAK`
- `⚡ PUSH 1`
- `✅ ENTRY READY`

### 8.1 Proof candle

Long:

- a **completed 5m candle** closes/prints through the active Long Entry Zone according to the approved proof rule;
- completed candle high becomes the reference extreme.

Short:

- completed 5m candle closes/prints through the active Short Entry Zone;
- completed candle low becomes the reference extreme.

A doji-like or otherwise disqualified proof candle waits for another eligible reference according to calibrated candle-quality rules.

### 8.2 Yellow line after proof

Once a valid proof candle is armed, the displayed active yellow entry/reference line follows the completed reference candle extreme:

- LONG -> reference high
- SHORT -> reference low

### 8.3 Candle 2 / Candle 3 behavior

If the next 5m candle does not produce the required break before it completes:

- promote the completed candle's favorable extreme to the new reference;
- reset live push measurements;
- continue waiting.

### 8.4 Invariants

- one accepted realtime update advances at most one standard stage;
- one giant candle/tick may not secretly satisfy BREAK + PUSH1 + PUSH2;
- equal favorable extrema do not count as new pushes;
- hard recoil resets the live chain;
- symbol/contract/context change resets stale state;
- historical ordinary 5m OHLC must not pretend exact intrabar ordering is known.

The separate `⚡ QUALIFIED MOMENTUM ENTRY` lane is explicitly named and audited so it does not violate these standard-state invariants.

---

## 9. 🎯 TAKE PROFIT ZONES — reaction shelves, not wick targets

Visible name: `🎯 TAKE PROFIT ZONE 1/2/3`  
Internal semantic object: `REACTION_ZONE`

Visual contract:

- full-width **blue horizontal lines**;
- no large filled rectangles in the normal chart view;
- ordered TP1 -> TP2 -> TP3;
- label at the right edge;
- TP lines must not silently disappear because one narrow detector lane failed.

### 9.1 What a TP zone is

A Take Profit Zone is a **historically observed reaction shelf/cluster**, not an isolated old wick.

Useful evidence may include:

- repeated candle/wick reactions around a common price band;
- repeated body-edge / wick overlap;
- prior pause/base/rejection shelf;
- major higher-timeframe reaction;
- PDH/PDL/PWH/PWL confluence;
- reaction count;
- age and recency;
- source timeframe;
- usable room from entry.

### 9.2 The target is INSIDE the reaction zone

For a SHORT moving into a lower reaction zone:

`target = near/top side + calibrated penetration into the zone`

Human description: **top / top-middle**, not the deepest wick and not exactly the first outer edge.

For a LONG moving into an upper reaction zone:

`target = near/bottom side + calibrated penetration into the zone`

Human description: **bottom / bottom-middle**.

The penetration percentage is **CALIBRATION_REQUIRED**. A research default may be used in experimental builds only when visibly marked as such.

### 9.3 Entry and TP must be separate structures

TP1 is invalid if it is effectively the same structural neighborhood as the Entry Zone.

The old bad example:

`SHORT ENTRY ~29,719 -> TP1 ~29,714`

is explicitly rejected.

User-approved semantic fixture for the Aug-10 short example:

- Short Entry approximately `29,719`
- preferred TP1 reference approximately `29,628.50`
- preferred TP2 reference approximately `29,527.25`

The point of this fixture is **why** they are selected: separate lower reaction shelves with useful travel space and conservative near-side penetration.

### 9.4 Robust TP discovery — fix the “TP lines disappeared” failure

The TP engine must use a **multi-lane candidate search** before declaring a target unavailable.

#### Lane A — primary 15m reaction shelf

Scan confirmed historical 15m price interaction for clustered body/wick reaction intervals, not only textbook pivots.

#### Lane B — dense 5m shelf fallback

If 15m does not produce enough evidence for an obvious nearby destination, inspect dense 5m reactions and aggregate them into a stable shelf. This is a fallback candidate lane, not permission to target micro-noise.

#### Lane C — major higher-timeframe reaction

A major 1H/4H reaction area may qualify even when it does not look like two nearly identical 15m pivots, especially when supported by meaningful structural significance or Daily/Weekly level confluence.

#### Lane D — D/W confluence and structural shelf

PDH/PDL/PWH/PWL may strengthen or define the boundary of an already qualified reaction destination. They do not automatically become a TP merely because the level exists.

### 9.5 Candidate merge and ordering

After all lanes produce candidates:

1. merge overlapping observations that refer to the same price shelf;
2. compute deterministic zone bounds;
3. reject the Entry Zone neighborhood;
4. reject noise-only isolated observations;
5. sort valid destinations outward in trade direction;
6. choose TP1, then the next distinct shelf as TP2, then TP3;
7. place the displayed target inside the near side using the calibrated penetration rule.

### 9.6 TP visibility contract

The chart and box must distinguish three conditions:

1. **TP SET** — draw the line and show price.
2. **NO QUALIFIED SHELF AFTER FULL SEARCH** — show a plain-English reason, e.g. `NO QUALIFIED TP SHELF`; do not silently display a dash.
3. **DETECTOR / DATA INCOMPLETE** — show `TP DATA/DETECTOR UNAVAILABLE`; this is not the same as a valid market conclusion that no zone exists.

A missing TP line is therefore always explainable.

### 9.7 TP2 / TP3

TP2 and TP3 must not disappear simply because the same narrow cluster test used for TP1 cannot find them. The full candidate search is rerun beyond the prior selected shelf using the same multi-lane logic.

If no distinct deeper shelf exists after exhaustive search, the panel says so explicitly.

---

## 10. NEXT WALL

NEXT WALL is distinct from TAKE PROFIT.

It asks: **What important opposing structure does price encounter before the active destination?**

Candidate inputs may include:

- PDH/PDL/PWH/PWL;
- qualified reaction shelves;
- meaningful structural swing levels;
- future approved manual/automatic trendline walls if trendlines are ever reintroduced.

NEXT WALL must use the active plan side and must not be computed from a stale/manual default plan.

---

## 11. 🤖 SLUMDAWG TRADERS top-right box — canonical display contract

Header stays:

`🤖 SLUMDAWG TRADERS`

Style stays close to the visually accepted original palette:

- dark/black panel background;
- gold accent/frame;
- white primary words;
- green bullish value cells;
- red bearish value cells;
- yellow entry rows;
- blue TP rows;
- emojis retained.

### 11.1 Required rows

Recommended compact order:

1. `BIG DIRECTION`
2. `CURRENT MOVE`
3. `ACTIVE PLAN`
4. `NEXT WALL`
5. `🟢 LONG ENTRY`
6. `🔴 SHORT ENTRY`
7. `🎯 TP1`
8. `🎯 TP2`
9. `🎯 TP3`
10. `🕯️ CANDLE SETUP`
11. `NOW`
12. `SYSTEM`

The box may be compacted visually, but the semantic values above must remain obtainable.

### 11.2 Direction examples

Bearish larger market, bullish rally/pullback:

- BIG DIRECTION: `📉 DOWN`
- CURRENT MOVE: `📈 UP PULLBACK`
- ACTIVE PLAN: `🟢 LONG` if the current pullback plan is active

Bearish larger market after rejection and resumption:

- BIG DIRECTION: `📉 DOWN`
- CURRENT MOVE: `📉 DOWN WITH DIRECTION`
- ACTIVE PLAN: `🔴 SHORT`

Bullish larger market with temporary selloff:

- BIG DIRECTION: `📈 UP`
- CURRENT MOVE: `📉 DOWN PULLBACK`

### 11.3 Candle row

Possible research-state labels:

- `NONE / WAIT`
- `🕯️ DOJI / INDECISION`
- `🕯️ REJECTION`
- `🕯️ REJECTION -> ENGULF`
- `⚡ STRONG ENGULF`
- `⚠️ CANDLE QUALITY REJECTED`

No candle label alone authorizes a trade.

### 11.4 NOW row

Possible standard path:

- `⏳ WAIT PROOF CLOSE`
- `📍 REFERENCE ARMED`
- `⚡ BREAK`
- `⚡ PUSH 1`
- `✅ ENTRY READY`

Possible separate research path:

- `⚡ QUALIFIED MOMENTUM ENTRY`

Possible failure/reset:

- `⚠️ CONTEXT RESET`
- `↩️ RECOIL RESET`
- `⚠️ NO QUALIFIED TP SHELF`
- `⚠️ DATA/PARITY BLOCK`

### 11.5 No panel-local logic

Every displayed value must come from the same canonical state used for chart geometry and alerts. It is a regression failure if:

- box says LONG while the active engine is SHORT;
- box says UP WITH DIRECTION while canonical current move is bearish pullback;
- box says TP NOT SET while the chart has an active canonical TP1;
- box displays TP1 from one side while AUTO plan is the other side.

---

## 12. Standard entry vs early momentum entry — explicit separation

The system must log which lane qualified:

### Lane S — STANDARD

`proof close -> reference -> BREAK -> PUSH1 -> quality PUSH2 -> ENTRY_READY`

### Lane M — MOMENTUM / CANDLE-QUALITY RESEARCH

`structure already valid -> first strong displacement/engulf candle through proof -> candle/context/room gates -> QUALIFIED_MOMENTUM_ENTRY`

Lane M may not be promoted to live-decision support until research proves it adds value after costs and does not merely overfit the supplied winning examples.

---

## 13. Research program before A+ claims

The candle layer and all unresolved numeric thresholds require real NQ/MNQ research.

### 13.1 Positive fixtures

Use user-approved examples including:

- rejection/doji-like -> rejection/hammer-like -> bearish engulf/displacement -> successful short continuation;
- first strong momentum engulfing candle through the Entry Zone -> successful early entry;
- visually approved Entry Zone auto-adjustment after a clean pullback;
- visually approved reaction-shelf TP placement.

### 13.2 Negative / look-alike fixtures are mandatory

Collect losing/failed examples that look similar:

- doji + rejection + engulf that immediately reverses;
- strong engulf through Entry Zone with poor room to target;
- strong candle against BIG DIRECTION into a nearby wall;
- wick-heavy displacement with poor close location;
- first-candle break that fails because no clean pullback existed;
- apparent TP shelf that is only one isolated wick.

A positive example alone never authorizes a production rule.

### 13.3 Ablations

Compare at minimum:

1. structure-only baseline;
2. standard momentum state machine;
3. standard + candle-quality filter;
4. momentum-entry lane alone;
5. standard + momentum-entry lane;
6. with-direction vs countertrend/pullback;
7. TP edge vs calibrated penetration;
8. 15m-only TP detection vs multi-lane reaction shelf detection.

### 13.4 Validation

Required before promotion:

- deterministic unit/property tests;
- human-approved golden fixtures;
- sensitivity sweeps — stable plateau, not one magic threshold;
- chronological walk-forward / holdout;
- untouched final holdout;
- commission/slippage stress;
- multiple-testing discipline;
- cross-platform Python/Pine/FXR parity;
- realtime/reload/repaint tests for TradingView;
- FX Replay parity tests;
- live shadow before live decision support.

---

## 14. Reason codes / observability

Minimum reason-code families:

### Direction

- `BIGDIR_BEARISH_STRUCTURE_PERSISTS`
- `BIGDIR_BULLISH_STRUCTURE_PERSISTS`
- `BIGDIR_REVERSAL_CANDIDATE`
- `BIGDIR_UNRESOLVED_CONFLICT`

### Current move

- `MOVE_DOWN_WITH_DIRECTION`
- `MOVE_UP_WITH_DIRECTION`
- `MOVE_DOWN_PULLBACK`
- `MOVE_UP_PULLBACK`
- `MOVE_BUILDING_STRUCTURE`

### Entry structure

- `ENTRY_MEANINGFUL_SWING_SELECTED`
- `ENTRY_NEAREST_WICK_REJECTED`
- `ENTRY_INSUFFICIENT_ROOM_TO_TP`
- `ENTRY_NEW_CONFIRMED_SWING_REPLACED`

### Candle / entry state

- `PROOF_REFERENCE_ARMED`
- `PROOF_DOJI_REJECTED`
- `BREAK_CONFIRMED`
- `PUSH1_CONFIRMED`
- `PUSH2_ENTRY_READY`
- `REFERENCE_ROLLED`
- `RECOIL_RESET`
- `MOMENTUM_ENGULF_CANDIDATE`
- `MOMENTUM_ENTRY_QUALIFIED`
- `MOMENTUM_ENTRY_REJECTED_CONTEXT`
- `MOMENTUM_ENTRY_REJECTED_ROOM`
- `MOMENTUM_ENTRY_REJECTED_CANDLE_QUALITY`

### TP

- `TP_CLUSTER_SELECTED`
- `TP_ENTRY_NEIGHBOR_REJECTED`
- `TP_ISOLATED_WICK_REJECTED`
- `TP_CLUSTER_PENETRATION_APPLIED`
- `TP_NEXT_DISTINCT_CLUSTER_SELECTED`
- `TP_NO_QUALIFIED_SHELF_AFTER_FULL_SEARCH`
- `TP_DATA_OR_DETECTOR_INCOMPLETE`

---

## 15. Golden-fixture upgrades

Every approved screenshot case should record:

- expected BIG DIRECTION;
- protected higher-timeframe structure / invalidation concept;
- expected CURRENT MOVE and whether it is WITH DIRECTION or PULLBACK;
- expected ACTIVE PLAN;
- both yellow Entry Zones and why the selected active one is meaningful;
- rejected nearer wicks;
- proof candle / reference extreme;
- expected candle geometry/sequence label;
- expected standard or momentum entry lane;
- TP1/TP2/TP3 reaction shelves, bounds, penetration location, and reason codes;
- rejected isolated TP wicks;
- expected top-right box values;
- expected chart lines;
- expected behavior after reload/replay.

The two user candle examples become **positive research fixtures**, not evidence of edge by themselves.

---

## 16. TradingView / FX Replay parity

### TradingView

Pine must reproduce the canonical semantics using only data observable in Pine. Where exact realtime event order is unavailable historically, it must say so and avoid manufacturing state history.

### FX Replay

FXR should reproduce the same:

- BIG DIRECTION
- CURRENT MOVE
- ACTIVE PLAN
- Entry Zones
- candle-quality state
- entry state
- TP ladder
- reason codes where the platform API permits

Platform-specific data differences are logged rather than silently normalized away.

### Parity invariant

For identical normalized input data, Python reference, Pine, and FXR must agree on all observable deterministic outputs before the feature may be promoted.

---

## 17. Performance and robustness requirements

- No unbounded history loops.
- Cap reaction candidates and document the cap.
- Preserve responsive chart load on 5m and 15m.
- Use confirmed swings for historical semantic decisions.
- No repaint-based semantic acceptance.
- Context/contract/timeframe changes reset stale entry state.
- Missing data fails closed with reason.
- TP discovery may degrade through the explicit search lanes, but may not silently invent a target.
- UI drawing failure and logical target absence must be distinguishable in diagnostics.

---

## 18. Forbidden shortcuts — V2

Explicitly forbidden:

- strong rally => automatically flip BIG DIRECTION;
- latest 15m pivot timestamp => sufficient CURRENT MOVE classification;
- weighted timeframe vote => final BIG DIRECTION rule;
- nearest wick => Entry Zone;
- candle-pattern name alone => entry;
- one candle secretly satisfying multiple standard momentum stages;
- exact near edge => automatic TP;
- farthest wick => automatic TP;
- same structure as Entry Zone => TP1;
- one isolated wick => sufficient reaction shelf;
- narrow detector returns none => silently hide TP line;
- panel default side => active plan;
- panel computes independent direction/TP logic;
- screenshot success => claim of edge;
- threshold tuned on final holdout => production rule.

---

## 19. Implementation order for the next indicator build

The next build should be implemented in this order to reduce regression risk:

1. **Canonical direction/current-move state model** in the reference layer.
2. Golden tests for the Aug-10 bearish-large-context / bullish-pullback / bearish-resumption example.
3. Pine parity for BIG DIRECTION, CURRENT MOVE, ACTIVE PLAN, and panel — remove the v0.17 weighted/pivot-timestamp shortcuts.
4. Robust multi-lane reaction-shelf detector and explicit TP visibility reasons.
5. TP penetration inside the zone; preserve TP1/TP2/TP3 full-width blue lines.
6. Candle-sequence research detector in the reference layer.
7. Standard-vs-momentum-entry lane separation and tests.
8. Top-right box rows wired directly to canonical state.
9. TradingView unchanged-source compile/reload/replay test.
10. FX Replay parity implementation.
11. Only after parity: NQ/MNQ research, sensitivity, walk-forward/holdout, ablation, cost stress.

Do **not** modify the accepted PDH/PDL/PWH/PWL price semantics while implementing these lanes.

---

## 20. Acceptance checklist for the next visual test

On a chart like the Aug-10 example, the indicator must be capable of showing:

### During bullish pullback inside bearish larger structure

- `BIG DIRECTION: 📉 DOWN`
- `CURRENT MOVE: 📈 UP PULLBACK`
- long pullback plan only if its structure qualifies
- both structural Entry Zones still visible
- TP ladder for active plan visible or an explicit no-qualified-shelf reason

### After PWH rejection and bearish resumption

- `BIG DIRECTION: 📉 DOWN`
- `CURRENT MOVE: 📉 DOWN WITH DIRECTION`
- `ACTIVE PLAN: 🔴 SHORT`
- Short Entry Zone still tied to meaningful break-of-structure swing
- TP1/TP2 selected from separate lower reaction shelves
- targets placed inside the top/top-middle side of those lower shelves
- candle-quality row updates from actual candle geometry
- NOW progresses through standard confirmation or explicitly named momentum-entry lane

A build that draws correct lines but shows contradictory box logic **fails**. A build that shows correct direction but silently loses TP lines **fails**. A build that recognizes a winning candle example only through hard-coded pattern names **fails**.
