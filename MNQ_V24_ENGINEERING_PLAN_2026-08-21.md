# MNQ v2.4 — Engineering Plan and Seat Handoff (2026-08-21)

Author: Claude Code worker seat (succeeding the GPT-5.6 engineer seat, which ended on
exhausted credits). Written at branch head `e93ae74e24119475ba55afffea7425a44e348236`
(`research/current-mnq-strategy-v2-4-zone-first-candles`, PR #38, DRAFT / DO NOT MERGE).

Operator order 2026-08-21 (verbatim intent): the YouTube-extraction campaign is PAUSED.
The sole focus is the operator's own discretionary MNQ strategy translation
(`MNQ-V2.4-ZONE-CANDLE-PC3-FORCE1`). All Trading Forge tooling may be used in service
of this lane. This lane continues on this branch.

Evidence grades used below: MEASURED HERE = I ran the command / read the executable line
this session. ARTIFACT-SOURCED = read from a committed file. RELAYED = stated in the
GPT-session chat transcript the operator pasted; not yet reproduced from artifacts.

---

## 1. Measured current state

- Branch/PR: `research/current-mnq-strategy-v2-4-zone-first-candles`, 521 commits not on
  main, PR #38 OPEN + DRAFT, head `e93ae74e` (2026-08-21 00:18 EDT). [MEASURED HERE]
- Roadmap stage: `FIDELITY` (of FIDELITY → FREEZE → CLEAN_EDGE → ROBUSTNESS → EXECUTION
  → SHADOW → PRODUCTION), per `research/current_mnq_strategy_v2_4_roadmap.json`.
  [ARTIFACT-SOURCED]
- CI at exact head: green on lint, node+python test suites, calibration workflow,
  v2.3 production gates, dev diagnostic, parity/snapshot/metric gates. Two failures:
  [MEASURED HERE, run IDs 32446457612 / 32446457696]
  1. `Current MNQ Strategy v2.4 Human-Bot Replay Lab` → `REPLAY_CALIBRATION_STATUS_MISSING`
     (the workflow's inline contract demands a calibration status/receipt that does not
     exist at head — the contract landed, its producer did not).
  2. `Current MNQ Strategy v2.4 Zone + Candle Production` → exactly one pytest failure,
     `tests/test_current_mnq_strategy_v2_4_entry_fidelity.py::test_range_room_reconstructs_optional_previous_close_context`
     (`assert seen["pcm"] == {"2026-08-18": 104.0}` got `{}`; 300 others pass —
     `_range_room_authorization` does not fetch the optional previous-close premarket
     context the test requires).
  Both have the signature of a seat dying mid-edit. They are the first repairs.
- Frozen replay evidence: 14 case windows (2026-03-23 .. 2026-04-14) in
  `research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json`;
  trader labels held privately as sha256 `11d8dec0…` (bytes never committed, by design);
  6 of 14 are WAIT-at-replay-end. [ARTIFACT-SOURCED]
- Unified evidence registry (`…unified_fidelity_evidence_registry_2026_08_20.json`):
  closed-world 65-screenshot parent corpus (`Trading screenshots (5).zip`,
  sha256 `da25a057…`), 3 verified force/TP videos, semantic crosswalk final rules,
  conflict-resolution rules, `pnl_used: false`. [ARTIFACT-SOURCED]
- Clean-edge exam: pre-registered, sealed. Dataset MNQ 2019-05-06..2021-12-31,
  sha256 `45c79281…`, 547 scoreable sessions after declared quarantines; 2022-01-01..
  2026-08-17 is declared development-contaminated for OOS purposes. A prior clean run
  aborted (`ArrayMemoryError`) with no result observed. [ARTIFACT-SOURCED, SEAL.json]
- Risk contract, frozen and not negotiable: 17.25-point stop, 15 MNQ, one trade
  per session, 09:30–12:00 ET. The $400 minimum first-destination gate stands.
  [ARTIFACT-SOURCED]

## 2. Evidence custody — what exists on this machine vs. as hashes only

| Evidence | Sealed reference | Local bytes found 2026-08-21 |
|---|---|---|
| 14-case trader labels | sha256 `11d8dec0…` | NOT MATCHED YET. Downloads holds `mnq_replay_labels_FROZEN.json` (`7a815454…`), `mnq_replay_v3_labels_FROZEN.json` (`1b20b0a8…`), `mnq_replay_v3_labels_DRAFT.json` (`7fea1c66…`) — none equals the sealed hash. [MEASURED HERE] |
| 65-screenshot corpus zip | sha256 `da25a057…` | Not found in Downloads/Desktop/Documents/Videos. [MEASURED HERE] |
| 3 force/TP videos (`Desktop 2026.08.19/20 - *.mp4`) | per-file sha256 in registry | Not found in the same sweep. [MEASURED HERE] |
| Trade-ledger CSV (74 rows) + 8 ledger screenshots | reconciled in the GPT session [RELAYED]; no repo binding found under `research/` [MEASURED HERE] | Not found in the same sweep. |
| Replay-lab packs | pack id `aa4e3210…` | Downloads holds review + calibration packs (zip + unzipped). [MEASURED HERE] |

Custody actions (Phase 0): operator points the seat at the actual files (or drops them
in one folder). Every file is hash-verified against the registry before use. For the
labels: try faithful normalizations (re-serialization) of the Downloads FROZEN file to
reproduce `11d8dec0…`; if the sealed bytes cannot be reproduced, the honest state is
recorded and the operator re-confirms his 14 labels once — his word is the ground truth
the hash was protecting — and the seal is regenerated. No silent substitution.
The ledger CSV must additionally be registered (hash + row count + reconciliation
receipt) in the evidence registry — the GPT session verified it in chat [RELAYED] but
left no repo artifact; that verification must be reproduced here before the ledger is
used as an oracle.

## 3. Inherited defect queue (from the GPT session; RELAYED until re-measured)

The last chat-reported regrade baseline was 6/14 exact actions, 0 opposite-direction
trades, 0 in-window bot-only entries, ~24 release blockers: 4 missed trader entries,
6 earlier-session bot signals that would consume the daily bullet, knock-on WAIT→NO_TRADE
errors. Named open defects when the seat died:

1. TP engine rebuilt structural destinations at session open instead of the decision
   clock (violates "does this zone affect price now?"); implicated in Mar 30 / Mar 31 /
   Apr 6 target errors. Work was in flight, unfinished.
2. Mar 31 reclaim: a key zone was retired after one close-through, so the immediate
   reclaim the trader traded could not be recognized. Direction: express reclaim as a
   role-cycle inside the existing `REPEAT_TEST_MOMENTUM_ATTACK` family — never a third
   pre-break exception.
3. The 6 pre-window signals are unlabeled hazards: under the one-bullet rule a false
   early entry destroys the real setup later. They are not to be suppressed to improve
   a score; they need trader labels (new replay cases) or precise WAIT/NO_TRADE
   predicates from the operator's stated reasons: price never reached the key level /
   second candle never printed outside the level / rejection without a momentum candle
   forming / doji without the second strong candle.
4. Replay latency regressed during the anchored-zone work; correct-but-slow is a
   release blocker for live parity. Keep the proven exact-equivalence caches; profile
   before and after every map change.
5. None of the chat's post-baseline repair results (role-cycle consolidation, current-
   zone re-definition, the re-run that was in flight) may be assumed landed. The commit
   log is the only record of what survived. First regrade re-run re-establishes truth.

## 4. What the operator holds (the "powers"), mapped to engineering roles

1. Frozen replay labels (14 cases) — the action/timing oracle. Sealed, non-PnL.
2. Replay lab (built, CI-gated, runs locally) — the machine that mints NEW labeled
   cases cheaply. The registry currently says manual collection is closed; REOPENING it
   deliberately per batch is the single highest-leverage act available: every 20-minute
   labeling session adds trader-truth cases the bot must match, and is the antidote to
   overfitting 14 windows. Recommended cadence: batches of 10–15 blind cases, mixed
   with the 6 hazard windows and fresh sessions.
3. 65-screenshot closed-world corpus + gold fixtures — zone/TP semantic truth
   (`user_fidelity_gold.json` already binds the two pre-break exceptions, rejection
   stories, TP-zone-1/2 semantics).
4. 3 force videos — the live entry-clock truth (FORCE1 tug-of-war semantics).
5. Trade ledger CSV + 8 ledger screenshots — the exit-side and money-side oracle:
   direction-adjusted entry-to-exit points per trade (62 target-side exits, 7 exact
   17.25 stops, 5 scratches [RELAYED, to be reproduced]). Used as a diagnostic checksum
   for TP fidelity and, at the very end, as the "same money on the same days" sanity
   comparison. Never a tuning target.
6. Live corrections in chat — highest-authority rulings; each one becomes a frozen
   clarification + regression test the same day it is given.
7. The Topstep account parameters he actually trades — inputs to the survival
   simulator in Phase 4 (account size, trailing drawdown, daily loss limit).
8. This machine + Databento access — the forward data escrow: every session after
   2026-08-17 is uncontaminated by construction and accumulates into a second,
   modern sealed exam set.

## 5. The plan (phases follow the locked roadmap; exits are the roadmap's own)

### Phase 0 — Reseat and make head green (now)
- Worktree `C:\Users\tonio\Projects\wt-mnq-v24` pinned at `e93ae74e`, tracking the PR
  branch. [DONE, MEASURED HERE]
- Repair the two red gates: implement the previous-close premarket context fetch that
  `test_range_room_reconstructs_optional_previous_close_context` requires (after reading
  the frozen premarket/key-level contracts to confirm the test states intended
  semantics, per the estate rule "fix the source, not the assertion"); produce the
  missing calibration status receipt the replay-lab workflow demands. Both with the
  convicting instrument unchanged: same CI jobs must flip red→green at the exact head.
- Evidence custody actions of §2.
- Exit: all workflows green at exact head; custody table has no unresolved row.

### Phase 1 — FIDELITY (current stage)
- Re-run the frozen 14-case regrade at the repaired head; publish a per-case scorecard
  (action, entry clock, zone geometry in ticks, TP destination, story receipts) as a
  committed artifact. This replaces every RELAYED number with measured ones.
- Work the defect queue §3 one semantic cause at a time; every accepted repair ships
  with a red-proofed regression (fails without the fix, passes with it) and no repair
  is judged by whether the revealed trade won.
- Convert the operator's four WAIT reasons into executable story predicates with
  fixtures (they are exactly testable: no-reach, no-second-candle-outside,
  rejection-without-momentum-candle, doji-without-second-strong-candle).
- Reopen label collection (operator decision) and grow the oracle set with blind
  batches; every disagreement is mined: bot mistranslation → smallest semantic repair;
  trader-confirmed judgment call → recorded as resolved; genuinely ambiguous →
  `UNRESOLVED_SOURCE_AMBIGUITY`, not invented behavior.
- Bind the reproduced ledger as the TP/exit oracle: for sessions where bot and trader
  agree on entry, compare direction-adjusted points-to-exit distributions; disagreement
  is diagnostic evidence, never a tuning signal.
- A/B protocol for competing interpretations (zone currentness, cluster construction,
  force timing variants): judged on trader-fidelity metrics only; PnL never selects.
- Independent grading: fidelity scores are produced by the doer but certified by a
  separately dispatched `accuracy-validator` run with a DISPROVE mandate (doer ≠ grader).
- Exit (roadmap): no known material trader-vs-bot semantic disagreement unresolved;
  all exact-head fidelity/architecture tests green.

### Phase 2 — FREEZE
- One exact SHA; fingerprints bound (build contract already enforces this); refreshed
  architecture receipt; release identity locked; post-freeze rule-rescue forbidden.

### Phase 3 — CLEAN_EDGE (sealed exam)
- First fix the known infra blocker: the prior attempt died in `ArrayMemoryError`
  before any result. The exam must run to completion on 547 sessions (streaming /
  chunked replay, bounded memory) without touching strategy semantics (Lane B).
- Run the pre-registered exam exactly as sealed: ≥500 sessions, ≥100 trades, 4
  chronological folds, ≥3 positive, bootstrap LCB95 > 0, cost-stress > 0,
  top-5%-winners-removed > 0, leave-best-month-out > 0, break-even margin > 0,
  weakest-link > 0. One shot, no variant selection.
- Honest outcome space: PASS → proceed. FAIL → that is a valid scientific result; the
  options are pre-registering a genuinely new sealed dataset (the forward escrow of §4.8
  as it accumulates) or accepting the negative — never threshold rescue.

### Phase 4 — ROBUSTNESS (survive Monte Carlo and the prop firm)
- The charter's attacks: fold stability, moving-block bootstrap, declared cost/slippage
  stress, top-winner removal, leave-best-month-out, entry-delay sensitivity, parameter-
  neighborhood stability (fidelity-frozen, no clean-result selection), causal audit.
- Topstep survival simulator (new, additive, isolated from strategy semantics): Monte
  Carlo over resampled certified trade sequences against the operator's real account
  rules — trailing drawdown, daily loss limit, one-bullet cadence, eval targets.
  Outputs: P(pass eval), P(drawdown breach), time-to-pass distribution, worst losing
  streak vs. cushion, all at frozen 15 MNQ / 17.25. Sizing and stop are inputs, never
  optimization variables; if survival is unacceptable at frozen risk the finding is
  reported to the operator as a decision, not silently re-sized.
- News/holiday policy: the kernel must refuse cleanly per firm rules on declared
  no-trade days (existing PROP-FIRM-COMPLIANCE assets are reused as challengers).
- Exit (roadmap): edge positive under every required weakest-link attack.

### Phase 5 — EXECUTION
- The v2.3 scaffolding (broker adapter, topstep risk, realtime, shadow runtime) is
  brought up to the certified v2.4 kernel with shared-kernel parity receipts; MNQ tick
  grid; commission/latency/fill stress; duplicate-order protection; stale-data and
  contract-identity refusal; reconciliation; server-side stop/TP; emergency-flatten
  drills. Decision-clock latency gets a hard budget with a regression harness (the
  proven-exact map caches stay; every optimization ships with an equivalence proof).

### Phase 6 — SHADOW
- The exact certified build runs 09:30–12:00 ET beside the live market on the
  operator's machine: ≥10 full sessions, ≥5 would-trades, zero missed-first-A+, zero
  rule changes, zero historical/live parity mismatches, zero unreconciled states.

### Phase 7 — PRODUCTION eligibility
- Device/account-bound promotion receipt, runtime fingerprint verification, bullet and
  risk enforcement drills. Real-capital go remains the operator's explicit decision;
  PR merge remains a separate explicit decision after gates.

## 6. Immediate next actions (ordered)
1. Fix the failing entry-fidelity test at head (premarket previous-close context).
2. Produce the calibration status receipt; make replay-lab green at head.
3. Push; verify both formerly-red workflows green at the exact new head.
4. Operator supplies evidence bytes (§2); hash-verify all; register the ledger CSV.
5. Re-run the 14-case regrade; commit the measured per-case scorecard.
6. Resume defect queue §3 in order (decision-time target map first).

## 7. Standing rails (all phases)
- 17.25-point stop and 15 MNQ are frozen constants, never variables.
- No PnL-selected rules, no indicator additions, no strategy families, no ML/quantum
  rescue, no FORCE1 variant sweeps, no NQ substitution (roadmap non-goals).
- Exactly two pre-break exceptions exist; nothing may become a third.
- Trader clarifications outrank every older interpretation; each lands as a frozen
  contract + regression the day it is given.
- Every guard proves it can go red; every absence claim carries a positive control.
- Doer ≠ grader for any score that feeds a promotion decision.
- PR #38 stays DRAFT / DO NOT MERGE until its gates say otherwise.
