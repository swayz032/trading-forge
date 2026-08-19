# FX Replay / FXR Script Platform-Parity Acceptance Gate

Status: PREPARED, NOT STARTED.

This gate deliberately begins only after the TradingView Pine vertical slice compiles unchanged and its first golden state-transition parity cases are captured. FXR Script is not Pine Script and must be implemented independently from the Python reference semantics rather than translated by textual substitution.

## 1. Authority and sequencing

Source of truth remains the Python reference + V1 rulebook.

Required order:

1. Python reference verified;
2. Pine v6 source committed;
3. exact committed Pine source compiles in TradingView;
4. first Pine/Python golden cases captured;
5. FXR implementation begins;
6. FXR/Python cases captured;
7. three-way Python/Pine/FXR comparison;
8. unexplained mismatches = release blocker.

This order prevents two platform ports from drifting in parallel before the first platform semantics are understood.

## 2. FXR lifecycle assumptions to verify in runtime

Current FXR documentation describes:

- `init` as one-time indicator setup;
- `onTick` as the price-update calculation lifecycle;
- inputs declared inside `init`;
- custom indicators integrated with FX Replay replay sessions.

These are documentation inputs, not parity evidence. The actual runtime must be probed for:

- update ordering;
- bar-boundary behavior;
- whether repeated price updates are distinguishable;
- state persistence inside a forming candle;
- behavior when replay is paused/resumed/rewound;
- script reload semantics;
- symbol/timeframe changes;
- historical/replay data availability and precision;
- drawing/object resource limits;
- alert/event capabilities, if any.

## 3. First FXR vertical slice

The first implementation must match the same bounded Pine scope:

- NQ/MNQ + 5-minute guard where platform metadata permits;
- 0.25-point price-grid semantics;
- manual active side;
- manual overall-direction context;
- manual yellow proof level;
- prior completed native D/W levels where FXR API provides authoritative access;
- reference arming + DOJI_LIKE veto;
- `WAIT_BREAK -> BREAK -> PUSH_1 -> ENTRY_READY`;
- one update -> at most one forward stage;
- recoil reset;
- slow-push reason codes;
- failed candle -> next-candle completed-extreme reference;
- reason-coded debug output;
- hard-coded `PLATFORM_PARITY_ONLY` classification.

Missing platform capabilities must return/document `UNSUPPORTED` rather than being approximated silently.

## 4. Replay-specific chaos cases

FXR must be tested under:

- normal forward replay;
- pause/resume during BREAK;
- pause/resume during PUSH_1;
- speed changes during an active chain;
- rewind before the reference candle;
- rewind during active chain;
- symbol switch;
- timeframe switch;
- indicator remove/re-add;
- browser/app refresh if applicable.

State after a rewind must never preserve information from the future replay path.

## 5. Cross-platform D/W level parity

The V1 rule is platform-native prior completed Daily/Weekly candles. Therefore TradingView and FX Replay are allowed to disagree only when their underlying native bars/data differ.

Every disagreement must log:

- platform;
- symbol/contract;
- date/week;
- level name;
- TradingView value;
- FX Replay value;
- difference in ticks;
- whether the difference changes proof/target selection;
- disposition.

No hidden forced equality is allowed.

## 6. Promotion rule

FXR parity = PASS only after:

- exact committed FXR source runs without errors;
- runtime lifecycle probes are documented;
- all supported golden state transitions have zero unexplained mismatches versus Python;
- rewind/pause/speed chaos tests pass;
- unsupported semantics are explicit and fail closed;
- platform-native D/W discrepancies are reconciled;
- no calibration placeholder is represented as proven edge;
- three-way parity report is produced for the shared supported subset.

Passing this gate still does not prove profitability, market edge, or 69-tick-stop protection.
