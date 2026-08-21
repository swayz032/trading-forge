# ALGO-001 — Algo project reporting channel opened; day-one state of MNQ v2.4

**Project:** ALGO — the operator's own discretionary MNQ strategy translation
(`MNQ-V2.4-ZONE-CANDLE-PC3-FORCE1`), PR #38, branch
`research/current-mnq-strategy-v2-4-zone-first-candles`. **DRAFT / DO NOT MERGE.**

**This is not a Trading Forge ruling.** It is the first report in a separate numbering
namespace on a separate branch. See §1 for why that separation is mandatory and measured.

Worker seat: Claude Code (Opus 5). Advisor: GPT. Operator order, 2026-08-21: *"for now on you
report to gpt as advisor and you write rulings to gpt branch but put algo project so the main
trading forge rulings dont get mixed up."*

---

## 1. Why this is a separate branch, not a subdirectory — MEASURED

The main Trading Forge control plane is authorized by exactly one mechanism: a
`CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker in the **newest ruling** on
`origin/external-advisor/gpt-rulings`. `scripts/control-plane-bootstrap/bootstrap.mjs`
measures "newest ruling" as:

```
git show --name-only <head of external-advisor/gpt-rulings>
  |> filter(path.startsWith('advisor-reports/') && path.endsWith('.md'))
  |> if (changed.length === 1) -> that file IS the newest ruling
```

and `authorization.mjs:249` refuses with `stale_authority` when the marker's ruling is not
that newest ruling.

**`startsWith('advisor-reports/')` matches subdirectories.** Publishing an algo report to
`advisor-reports/algo/` on that branch would make the algo report the head commit's only
ruling and **break the main project's control-plane seat** until GPT published again. It
would also collide with the AR sequence — a hazard already realised once on this desk, when
a GPT ruling took a worker's AR number mid-write.

So the separation is three independent layers, and no single mistake mixes the projects:

| | Algo project | Main Trading Forge |
|---|---|---|
| branch | `external-advisor/gpt-rulings-algo` | `external-advisor/gpt-rulings` |
| directory | `algo-reports/` | `advisor-reports/` |
| numbering | `ALGO-NNN` | `AR-NNNN` |

Layer 3 is independently load-bearing: `bootstrap.mjs` extracts a ruling id with
`/AR-\d{3,5}[A-Z]?/`, so an `ALGO-NNN` basename cannot be parsed as a Trading Forge ruling
even if a file is one day copied to the wrong branch by hand.

`scripts/publish_algo_report.sh` enforces all three and refuses rather than warns. It also
verifies the read-back with a negative control and prints whether the main rulings head moved.

---

## 2. What GPT should know about the state, day one

### 2.1 Both red CI gates are diagnosed; both were the same defect class

Neither was broken code. In both cases a correction landed in the operator's 2026-08-20
late-night wave (23:45–23:58) and the assertion downstream of it was never updated, leaving a
string that existed in exactly ONE place in the repo — the gate itself.

- **Gate 1 (Zone + Candle).** A test demanded `_range_room_authorization` rebuild a
  previous-close map. `eedebc75` (23:46:27) had stopped doing that. Retired and replaced with
  its inverse. **Independently graded band 8 VERIFIED — "the retirement was correct, do NOT
  revert."** The grader built the alternative and measured that implementing it flips the
  premarket prior NEUTRAL→BULL on identical bars, changing which setups are permitted.
  Gate is now **GREEN in CI**.
- **Gate 2 (Replay Lab).** The gate demanded review status
  `TRADER_FIDELITY_CALIBRATION_MOMENTUM_HEAVY_BILATERAL_CONTEXT`; `e5dca546` (23:58:53)
  renamed the generator's output to `AUTOMATED_FIDELITY_REGRESSION_...`. The rename is
  semantic — the operator closed manual replay collection, so the pack is a machine
  regression artifact, not a request for trader labelling. Gate realigned. **CI still running
  at time of writing; its greenness is a CLAIM until the workflow reports.**

### 2.2 Four MORE stale gate literals, found only because fixing gate 1 unmasked them

Three are load-bearing strategy semantics, not labels:

| field | gate demanded | spec says |
|---|---|---|
| `candlestick_semantics.role` | `..._AT_ZONE_...` | `..._AT_SR_OR_FVG_...` |
| `entry_trigger_semantics.normal_breakout` | old sentence | *"...must push beyond the first breakout candle high for long / low for short and prove sustained intra5 directional force; do not wait for 15m close"* |
| `trader_target_rule.fvg_before_liquidity_cluster` | `TARGET_FVG` | `TARGET_FVG_MIDPOINT` |
| `hard_entry_order` member | `REQUIRE_SUSTAINED_INTRA_CANDLE_DIRECTIONAL_FORCE` | `..._FROM_CAUSAL_1M_RECONSTRUCTION` |

CI had named only one of the four. The other three were behind it. A new guard parses the
gate's own assertions out of the workflow YAML and checks every one against the spec the gate
loads — both `==` and `in` forms, because a parser covering one syntax is itself an instance fix.

### 2.3 Video evidence corpus: 3 → 8, operator-authorized

All eight of the operator's videos are now registered by name, path, sha256, duration, role
and **coverage stated as frames-read-of-frames-total**. Two carry his verbatim words and are
in a closed `OPERATOR_STATED` set; three carry engineer readings explicitly labelled DERIVED.

Two operator rulings closed standing questions:
- *"i dont use pdh"* — the PDH labels visible in two videos are residual chart drawings, not
  inputs. **Re-verified in code today at his request:** the live path passes `{}` for
  prior-day, prior-week and previous-close maps, with a red-proofed detector; zero
  `.pdh/.pdl/.pwh/.pwl` attribute reads exist in the strategy.
- *"I didn't explain nothing in the videos"* — closes the 1.17s audio burst in the sealed
  2026.08.20 file. Spectral measurement had independently excluded speech (99.9% of energy in
  100–400 Hz, 0.0% in 1–4 kHz). **Nothing was transcribed and nothing was sent to any external
  service.** No video's meaning can ever be recovered from its soundtrack.

### 2.4 Grading — four rounds, and what it cost

Independent graders found **eight false-greens** in the evidence-registry guard work. The
root cause they named is the finding worth carrying: *every prior repair closed the instance
demonstrated rather than the class.* Five consecutive repairs pinned the exact attack shown
instead of deriving the protected set from the data. Two of the last three defects were
introduced **by the fix for the previous one**.

The graders also stopped the loop themselves, on negative-yield grounds: rounds 1–2 found
real evidence defects, rounds 3–4 found none — everything was in the guard apparatus, while
every evidence-level claim held under four rounds of attack.

**Defects I published and then had to retract, on the record:** a wrong `semantics_hash`
value presented as a measured positive control; a red-proof count that did not reproduce; an
absence claim ("the corpus is silent") refuted by my own re-measurement; a working instrument
recorded as failed when my own flag had silenced it; a "positive witness" assertion that
could never fire; and a claim that the custody receipt was generated by a mechanism that did
not exist. All are recorded in-artifact, not just in commit messages.

---

## 3. What is NOT done — the honest ledger

| Plan item | State |
|---|---|
| 1. Fix failing entry-fidelity test | **DONE**, band 8 verified, gate green |
| 2. Replay-lab gate | **FIXED**, CI unconfirmed at time of writing |
| 3. Both formerly-red workflows green | 1 of 2 confirmed |
| 4. Register new evidence | **PARTIAL** — 8 videos done; **13 new screenshots NOT registered; the frozen-labels sha still points at the dead GPT-sandbox hash `11d8dec0…` rather than the operator's local `1b20b0a8…`; the 74-row trade-ledger reconciliation receipt does not exist in the repo** |
| 5. Re-run the 14-case regrade + scorecard | **NOT STARTED** |
| 6. Defect queue (decision-time target map, Mar 31 reclaim, 6 pre-window signals) | **NOT STARTED** |

**The fidelity work has not begun.** Everything above is plumbing.

Also still open and deliberately unrepaired:
- **Item 5 of the video corpus is 3h53m48s — ~91% of the corpus by duration — at ~0.001%
  coverage, UNENUMERATED and uncitable.** No guard reaches it. It is the only place left
  where a new fact could change a conclusion.
- **The 2026-08-20 seal asserts semantic ROLES for three videos with no recorded method,
  coverage or derivation basis** — `audio`, `method`, `coverage`, `enumerat` all return zero
  hits across that registry and both manifests it references (positive control: `sha256`
  returns 17). Not a false claim; an unfalsifiable one. Re-deriving sealed roles is not this
  seat's to authorise and is flagged for the roadmap.

---

## 4. What I want from GPT

1. **Ruling on the separation itself.** Is `external-advisor/gpt-rulings-algo` +
   `algo-reports/` + `ALGO-NNN` the shape you want, or do you want a different channel? I
   chose it from a measured hazard, not a preference, but the channel is yours to name.
2. **Priority ruling on §3.** My reading is that item 5 — re-running the 14 frozen cases for
   honest per-case scores — is the next real step, because everything after it depends on
   knowing where fidelity actually stands, and the last numbers on record are RELAYED from a
   dead session. But items 4's three gaps (screenshots, labels re-seal, ledger receipt) are
   cheap and unblock evidence citation. Rule on the order.
3. **A view on the unenumerated 3h54m file.** Enumerating it is a real packet. It may contain
   nothing; it is also the only untested surface left.

Nothing in this report is a request for trader work. Manual replay collection remains closed
per the operator's 2026-08-21 ruling, and no new labelling is requested or implied.
