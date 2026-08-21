# GPT EXTERNAL ADVISOR RULING — AR-1384A

**Date:** 2026-08-21
**Repository:** `swayz032/trading-forge`
**Architecture stage:** 3 — Strategy Factory
**Worker branch inspected:** `claude/worker1-h1-20260815 @ 5794c1957524523469019ab1771d5db632075d9b`
**Worker report graded:** AR-1393
**Prior controlling ruling:** AR-1383A @ `7d7fe29732e9b35dd68eb575fbdc109d363ff3bc`
**Source personally re-reviewed:** YouTube `E8Wg6tFPYjo` — *The EASIEST Trading Strategy - 4H & 15M Fibonacci Step by Step*

## DISPOSITION

**AR-1393 = PARTIAL PASS.**

The buy-target correction is accepted. The E8 terminal source-completeness refusal is not accepted.
It followed GPT's prior instruction, but that instruction was framed incorrectly.

**GPT correction and retraction:**

1. AR-1382A's `VI-E8-3` question incorrectly made recovery of the proprietary indicator's internal
   4H range-selector formula the only possible route.
2. AR-1383A then treated “the visible chart remains on 15m” as proof that the required 4H state was
   unavailable.
3. Both statements missed the source's actual computation architecture: **the chart stays on 15m
   while the Currency Pros indicator automatically computes and displays the configured 4H
   Premium/Discount state.**

Accordingly:

- AR-1383A sections 4 and 8 are **SUPERSEDED** as to terminal E8 refusal and “move on.”
- `E8-SOURCE-COMPLETENESS-REFUSAL.md` is **SUSPENDED**, preserved as history, and must be labeled
  `SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT` in the next correction packet.
- No native 4H range algorithm may be invented.
- No E8 compile, backtest, or promotion is authorized yet.
- One bounded, no-purchase external-indicator capability preflight is authorized next.

This is not a request for another reconstruction round. It is a correction to computation
ownership and dependency routing.

---

## 1. WHAT THE SOURCE ACTUALLY TEACHES

GPT personally rechecked the video, transcript, and committed high-resolution frames.

### 1.1 Timeframe architecture

The educator states that:

- the 15-minute chart is used for execution;
- the 4-hour timeframe supplies directional bias;
- both must align;
- the indicator “automatically checks premium and discount on the higher time frame”; and
- its higher-timeframe setting is `4hour`.

The worked chart then behaves exactly that way:

| Visible execution chart | Indicator output | Taught consequence |
|---|---|---|
| `15m` | `4H | Premium` | Look only for 15m selling opportunities |
| `15m` | `4H | Discount` | Do not sell; look only for 15m buying opportunities |

Representative committed frames:

- `frames/vi3_00-02-30.png`: `15m` is selected while the indicator shows `4H | Premium` and the
  checklist includes `HTF Alignment`.
- `frames/vi3_00-12-42.png`: `15m` is selected while the indicator shows `4H | Discount`.

Therefore, absence of a visible 4H chart switch is expected. It is evidence of an HTF-on-LTF
overlay architecture, not evidence that higher-timeframe bias is missing.

### 1.2 Executable source rule

The source-faithful directional gate is:

```text
provider state = 4H PREMIUM  + valid 15m short setup -> short may proceed
provider state = 4H DISCOUNT + valid 15m long setup  -> long may proceed
opposite direction, UNKNOWN, missing, stale, or mismatched state -> NO TRADE
```

Premium/Discount is not decorative context. It is checklist item 1 and determines whether a long or
short setup is eligible.

### 1.3 What remains unknown

Two different questions were previously collapsed into one:

1. **Source semantics:** What state is used and what does it do? **Resolved.**
2. **Realization capability:** Can Trading Forge obtain the exact state reproducibly for live and
   historical evaluation? **Unverified.**

The video does not fully specify the indicator's internal/manual selection of the 4H dealing-range
high and low. That remains a blocker only for a **native reimplementation**. It does not, by itself,
erase the explicitly taught provider-output path.

A later settings-looking sequence in the video concerns the Fibonacci drawing tool. It does not
reveal the proprietary Currency Pros range algorithm. The indicator's `4hour` configuration is
nevertheless established by the narration and its visible `4H` output.

---

## 2. CORRECTED E8 EVIDENCE STATES

Split `VI-E8-3` into two independently graded facts:

### `VI-E8-3A` — semantic dependency

**Status:** `MULTIMODAL_RESOLVED`

```text
computation owner: Currency Pros indicator
display chart timeframe: 15m
decision timeframe: 4H
provider output: PREMIUM | DISCOUNT
consumer role: required direction gate / HTF Alignment checklist item
PREMIUM: SHORT_ONLY
DISCOUNT: LONG_ONLY
```

### `VI-E8-3B` — provider access and replay capability

**Status:** `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED`

Public evidence establishes that Currency Pros is a custom TradingView indicator with automated
annotations/checklist behavior. It does **not** establish that this particular Premium/Discount
state is exposed through a named alert, `alert()` call, plot value, Data Window value, CSV export,
historical series, or stable API.

TradingView supports all of those integration mechanisms in general, but provider-specific support
must be measured in the actual indicator UI:

- Currency Pros product page: <https://whop.com/discover/currencypros/cp-indicator/>
- TradingView script alerts: <https://www.tradingview.com/support/solutions/43000597494-alerts-on-alert-function/>
- TradingView named alert conditions: <https://www.tradingview.com/support/solutions/43000478392-i-m-unable-to-find-an-alert-condition-function-that-meets-my-needs/>
- TradingView alert plot placeholders: <https://www.tradingview.com/support/solutions/43000531021-how-to-use-a-variable-value-in-alert/>
- TradingView webhooks: <https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/>
- TradingView chart-data export: <https://www.tradingview.com/support/solutions/43000537255-how-to-export-chart-data/>

### Native implementation status

**Status:** `SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION`

The exact internal/manual 4H trading-range selector remains unspecified. Keep that fact. Do not let
it overwrite `VI-E8-3A` or prematurely decide `VI-E8-3B`.

---

## 3. WHY GPT AND THE WORKER GOT IT WRONG

This was not a weak OCR result. The system read the pixels correctly and asked the wrong question.

### 3.1 GPT framed a false binary

AR-1382A asked for the exact 4H high/low construction as though the only choices were:

```text
recover private formula OR refuse source
```

The missing third branch was:

```text
consume the exact external provider output under a pinned, tested dependency contract
```

GPT then graded the Worker against GPT's own incomplete framing. The premature terminal refusal is
therefore a GPT ruling defect first, not merely a Worker execution defect.

### 3.2 The Worker tested chart navigation instead of computation ownership

The 236-tile scan proved that the visible chart stayed on 15m. That observation is true, but it does
not discriminate between:

- “no 4H information exists”; and
- “a component overlays 4H information on the 15m chart.”

The visible `4H | Premium` and `4H | Discount` badges, plus the narration saying the indicator
automatically checks the higher timeframe, select the second explanation.

### 3.3 The extractor demoted a trading gate to context

The fresh E8 candidate already preserved the decisive quotes but labeled them:

- `Non-executable tooling note`; and
- worked-example `context`.

It also gave the Premium/Discount direction rules `role: context`, even though they control trade
direction. It then emitted `higher_timeframe.trading_range_definition` as a source gap.

This is an ontology failure:

```text
optional way to compute a state != optional state
external computation != non-executable context
unknown provider internals != unknown provider output semantics
```

The educator says the charting tool is optional because the work can be done manually. That does
not make higher-timeframe alignment optional. A compiler must preserve the required state and then
evaluate which faithful realization paths are available.

### 3.4 The schema had no place to represent this truth

Blueprint v4 has multimodal resolution and source/engine refusal states, but no first-class external
decision dependency. `VisualEvidenceReceipt/1` records a resolved semantic without recording who
computed it, the display timeframe, the decision timeframe, or how the result is consumed.

The existing source graph validates references, edge vocabulary, acyclicity, and reachability. Its
edges are deliberately opaque to semantic ownership. `ConditionBinding` distinguishes a source gap
from an engine primitive gap, but not either from an external provider whose semantics are known
while access is unverified.

Because the representation could not say “resolved external gate, access not yet proven,” the
pipeline forced the evidence into the nearest wrong bucket: source missing.

---

## 4. AR-1393 ITEMS THAT PASS

The Worker correctly repaired the earlier buy-target error.

- `vi2_00-16-21.png` was an intermediate state while the target was still being moved.
- `vi2_00-16-28.png` is the last stable post-action frame.
- The final target is Fibonacci level `0`, approximately `0.56073`, matching the narration.
- The resulting unified taught geometry remains:

```text
stop   = Fibonacci level 1
entry  = Fibonacci level 0.71
target = Fibonacci level 0
```

The BEFORE → DURING → AFTER-DROP → LAST-STABLE action-frame rule is accepted and remains mandatory.

The 32-entry artifact manifest also verifies against the committed artifact bytes before
regeneration, and the manifest red-proof discriminates a mutated hash.

---

## 5. AR-1393 REPRODUCIBILITY DEFECT

AR-1393's target conclusion remains valid, but its “byte-identical regeneration” claim is not
portable as committed.

On a fresh detached checkout of `5794c195`, GPT measured:

1. `sha256sum -c artifact-manifest.sha256` passes before regeneration.
2. `_worker_vi_e8_manifest_redproof.py` passes its positive arm and rejects its mutated negative
   arm.
3. Running `_worker_vi_e8_final_frame_proof.py` rewrites five committed magnification PNGs.
4. The manifest then fails for those five files in the current environment (Pillow `12.3.0`).

Affected outputs:

- `zoom_vi2_during_16-24_drag.png`
- `zoom_vi2_post_16-28_axis.png`
- `zoom_vi2_post_16-28_stop.png`
- `zoom_vi2_post_16-28_target.png`
- `zoom_vi2_pre_16-21_target.png`

The script uses Pillow resize/PNG encoding without pinning the complete rendering/encoding
environment. Fixed crop coordinates are not sufficient to guarantee byte-identical encoded files
across environments.

Required repair:

- make the semantic proof script read-only;
- move artifact generation to an explicit generator;
- pin the generator runtime and relevant image library version, or certify canonical decoded pixel
  hashes rather than encoder-dependent PNG bytes;
- add a clean-checkout regenerate-then-manifest test; and
- never let “run the proof” silently mutate committed evidence.

This defect lowers the reproducibility claim. It does not reopen the buy-target semantic result.

---

## 6. PERMANENT COMPILER DESIGN — ADDITIVE, NOT A NEW ARCHITECTURE

Extend the existing source graph with a typed dependency record. Do not build a competing auditor or
parallel compiler.

Minimum contract:

```json
{
  "dependency_id": "e8.htf_premium_discount",
  "condition_ref": "entry_sequence[1]",
  "kind": "EXTERNAL_INDICATOR",
  "provider": "Currency Pros",
  "artifact": "Currency Pros Indicator",
  "platform": "TradingView",
  "computation_owner": "EXTERNAL_PROVIDER",
  "display_chart_timeframe": "15m",
  "decision_timeframe": "4h",
  "configuration": {"higher_timeframe": "4h"},
  "output_contract": {
    "type": "enum",
    "values": ["PREMIUM", "DISCOUNT", "UNKNOWN"],
    "gate": {
      "PREMIUM": "SHORT_ONLY",
      "DISCOUNT": "LONG_ONLY",
      "UNKNOWN": "NO_TRADE"
    }
  },
  "semantic_status": "MULTIMODAL_RESOLVED",
  "access_status": "UNVERIFIED",
  "live_delivery": "UNVERIFIED",
  "historical_replay": "UNVERIFIED",
  "update_policy": "UNVERIFIED",
  "native_reimplementation_status": "SOURCE_INCOMPLETE",
  "evidence_receipt_ids": []
}
```

### 6.1 Keep three axes separate

Every external dependency must separately report:

1. **Semantic status:** what the source says the state means.
2. **Access/capability status:** whether the exact state can be obtained live and historically.
3. **Implementation status:** whether Trading Forge has a validated adapter for that capability.

No single `SOURCE_MISSING` boolean may erase those distinctions.

### 6.2 Realization routing

For each required external-computed state, route deterministically:

| Native source rule | Exact provider state | Historical state | Route |
|---|---|---|---|
| Complete | Not needed | Recomputable | Native implementation may qualify |
| Incomplete | Live + historical exposed | Available | Provider adapter may qualify |
| Incomplete | Live only | Unavailable | Shadow-live only; source-faithful backtest remains blocked |
| Incomplete | Not machine-readable | Unavailable | `UNSUPPORTED_CAPABILITY_REFUSAL` with external-dependency reason |
| Any | Stale, unknown, mismatched, or drifting | Any | Fail closed / no trade |

`EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` is a nonterminal work state. If the provider is proven
unavailable, reuse the existing terminal `UNSUPPORTED_CAPABILITY_REFUSAL` with a structured reason;
do not falsely convert it to source ambiguity.

### 6.3 Visual receipt v2

Add these fields to the existing receipt rather than replacing it:

```text
computation_owner
display_chart_timeframe
decision_timeframe
provider_output
consumer_role
dependency_id
```

### 6.4 Extraction lint

A tool, indicator, data feed, or external state that changes direction, entry eligibility, exit,
position size, or a required checklist item may not be labeled only `context`, `tooling`, or
`non-executable`.

The extractor must emit either:

- a native executable condition;
- a typed external dependency; or
- an explicit unresolved ownership finding.

The word “optional” applies to a realization only when the underlying decision state is still
required elsewhere in the source.

### 6.5 Mandatory checklist before any future source-missing ruling

Before declaring an executable rule absent, answer and preserve:

1. Who computes the value: teacher, chart platform, indicator, data vendor, or Trading Forge?
2. Where is the output visible or stated?
3. Does it gate a trade or only annotate it?
4. Is higher-timeframe state overlaid on a lower-timeframe chart?
5. Does faithful execution require the private formula, the exact output, or either one?
6. Is the output machine-readable live?
7. Is the output available historically for replay/backtest?

A terminal refusal cannot pass review with these fields omitted.

---

## 7. BOUNDED CURRENCY PROS PREFLIGHT — NO PURCHASE AUTHORIZED

Do not purchase the indicator, contact the vendor, request credentials, or bypass access controls.
If the operator already has lawful access in the normal TradingView UI, perform this bounded check.
Otherwise return `BLOCKED_OPERATOR_ACCESS_REQUIRED` with the exact UI evidence needed.

On a 15m chart with the indicator's higher-timeframe setting at 4H:

1. Record indicator identity/version if visible, symbol, exchange/feed, timezone, chart timeframe,
   and every relevant input value.
2. Open **Create Alert** and inspect for named `Premium`, `Discount`, or `HTF Alignment` conditions.
3. Check whether **Any alert() function call** is available for the indicator.
4. Inspect the Data Window and alert message placeholders for a numeric/boolean/categorical plot that
   represents the state.
5. Export chart data and check whether the state appears historically on loaded bars.
6. Capture one Premium case and one Discount case.
7. Change the configured HTF from 4H to 1H and verify that the emitted metadata/output is sensitive
   to that configuration. Restore 4H afterward.
8. Measure whether the current 4H value changes intrabar or only after the 4H bar is confirmed.
9. Check the actual target instruments/feeds; do not generalize from only the Forex examples.
10. Record any displayed licensing terms relevant to automated consumption. Escalate; do not infer
    permission.

TradingView can request higher-timeframe data while a lower-timeframe chart stays open, and its own
documentation warns that unconfirmed HTF requests can change/repaint. The update policy must be
measured and pinned:

- <https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/>
- <https://www.tradingview.com/pine-script-docs/v5/concepts/repainting/>

### Capability result matrix

```text
named alert or alert() + historical/exported state
  -> integration candidate; continue to adapter tests

live alert but no historical state
  -> live shadow candidate only; backtest/certification blocked

plot/Data Window state but no direct alert
  -> test supported plot-alert/companion-input path; do not assume

table/badge only, no machine-readable output
  -> no production OCR; request an authorized provider interface or refuse capability
```

Screen scraping/OCR is evidence tooling only. It is forbidden as a live money-path dependency.

---

## 8. INTEGRATION DESIGN IF AND ONLY IF PREFLIGHT PASSES

Do not send external indicator state directly to the broker route.

Add a separate generic external-decision ingestion boundary, for example:

```text
POST /api/external-indicator/state
```

Reuse the existing TradingView marker route's good patterns—authentication, rate limiting,
timestamps, deduplication, audit records, and fail-closed validation—but not its broker-account
semantics or `signal: -1|0|1` payload.

Minimum event:

```json
{
  "dependency_id": "e8.htf_premium_discount",
  "provider": "Currency Pros",
  "artifact": "Currency Pros Indicator",
  "provider_version": "measured-or-unknown",
  "configuration_sha256": "...",
  "symbol": "...",
  "ticker_id": "...",
  "exchange": "...",
  "feed": "...",
  "timezone": "...",
  "chart_timeframe": "15m",
  "decision_timeframe": "4h",
  "state": "PREMIUM|DISCOUNT|UNKNOWN",
  "chart_bar_time": "...",
  "emitted_at": "...",
  "event_id": "..."
}
```

Do not assume that a third-party indicator alert can compute a fresh dynamic HMAC over arbitrary
runtime fields. First measure what the provider's alert message can emit. If it permits an editable
message but no runtime signature, use a high-entropy per-integration static secret or bearer value
over TLS, then apply timestamp, idempotency, rate-limit, and replay controls server-side. Do not
label a static embedded token as dynamic HMAC authentication.

Store an immutable event log and a separately derived current-state view. The compiled gate may read
only the latest valid state matching the exact strategy dependency, provider configuration, symbol,
feed, and timeframe. Backtests may read only a hash-pinned historical state series.

The following always mean **NO TRADE**:

- missing or `UNKNOWN` state;
- stale or future-dated state;
- duplicate or out-of-order event that changes canonical history;
- wrong symbol, exchange/feed, chart timeframe, or decision timeframe;
- wrong configuration hash;
- unrecognized provider/artifact version; or
- version/configuration drift after qualification.

A provider update invalidates the affected certification until parity tests pass again.

---

## 9. REQUIRED TESTS

### 9.1 E8 semantic birth tests

- `15m` selected + visible `4H | Premium` + narration “automatically checks ... higher time frame”
  must produce an external 4H dependency, not `HTF_SOURCE_MISSING`.
- `15m` selected + `4H | Discount` must do the same with the opposite state.
- Remove either the narration or badge evidence and require a downgrade; no silent pass.
- Mutate `4H` to `1H` and require a different dependency configuration hash.
- “Indicator is optional” must not demote a required HTF direction gate to context.

### 9.2 Gate truth table

| External state | Candidate setup | Result |
|---|---|---|
| `PREMIUM` | short | eligible to continue |
| `PREMIUM` | long | no trade |
| `DISCOUNT` | long | eligible to continue |
| `DISCOUNT` | short | no trade |
| `UNKNOWN`, missing, or stale | either | no trade |

“Eligible to continue” never means route directly to execution; all remaining strategy and risk
conditions still apply.

### 9.3 Capability and temporal tests

- named-alert, `alert()`, plot, export, and history capability matrix routes correctly;
- live webhook output matches the visible provider state on both positive states;
- exported historical state matches visible/replayed samples;
- intrabar and confirmed-HTF-close behavior is measured separately;
- duplicate, out-of-order, stale, future, wrong-symbol, wrong-feed, wrong-timeframe,
  wrong-configuration, and unknown-version events all fail closed;
- provider/version drift invalidates qualification.

### 9.4 Evidence workflow tests

- action semantics bind only to BEFORE → DURING → AFTER → LAST-STABLE sequences;
- absence claims include a discriminating positive control;
- semantic proof commands are read-only;
- a clean checkout can regenerate evidence under a pinned environment and pass the manifest;
- an intentional pixel mutation fails the manifest.

After E8 passes the birth test, run one cheap corpus census for phrases and structures that indicate
external computation. Do not launch broad video vision or a factory-wide rewrite. The census output
should nominate a small regression fixture set for `indicator`, `automatically checks`, `dashboard`,
`checklist`, `signal`, `data feed`, and HTF-on-LTF patterns.

---

## 10. WORKER ORDER — AR-1394

Worker-1 shall execute in this order:

### Stage A — historical correction and reproducibility

1. Preserve AR-1393 and the refusal file as history; do not rewrite or delete them.
2. Add a supersession notice that sets the refusal to
   `SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT` under AR-1384A.
3. Record `VI-E8-3A`, `VI-E8-3B`, and the native-reimplementation gap separately.
4. Repair the mutating proof/generator split and prove clean-checkout reproducibility.

### Stage B — bounded capability preflight

5. Perform section 7 only if normal lawful indicator access is already available.
6. If access is unavailable, stop cleanly with `BLOCKED_OPERATOR_ACCESS_REQUIRED`; no purchase,
   credential request, vendor contact, or access workaround.
7. Produce a capability matrix with screenshot/receipt hashes and explicit unknowns.

### Stage C — minimum implementation only after evidence

8. If a machine-readable provider route is proven, add the typed dependency contract to the existing
   graph and implement the smallest adapter/validator slice needed for red/green tests.
9. If only live state is available, mark backtest/certification blocked and limit work to shadow-mode
   design/tests.
10. If no machine-readable path exists, emit `UNSUPPORTED_CAPABILITY_REFUSAL` with the structured
    external-dependency reason. Do not restore the false claim that the strategy semantics are absent.

Deliver one AR-1394 report containing exact commit pins, commands, test output, capability evidence,
remaining blockers, and the next smallest money-path decision. No self-grade.

---

## 11. LOCKS

Until AR-1394 is graded:

- no Currency Pros purchase or vendor contact;
- no credential collection or access-control bypass;
- no OCR/screen-scraping live adapter;
- no invented 4H range selector;
- no E8 Round 4 reconstruction;
- no E8 source-faithful backtest, certification, or promotion;
- no external state sent directly to broker execution;
- no broad Factory rerun or 160-video intake;
- no PAPER, Topstep, or live execution.

---

## FINAL RULING

**The operator's correction is confirmed. The E8 chart is intentionally on 15 minutes while the
Currency Pros indicator supplies the configured 4-hour Premium/Discount state. GPT previously
mistook “the private formula is not shown” for “the required state is absent” and then asked the
Worker to prove chart navigation instead of computation ownership. AR-1393 therefore passes its
buy-target correction but its terminal E8 refusal is suspended. Preserve the source semantics,
preflight whether the exact provider output is machine-readable live and historically, and fail
closed if it is not. Add the dependency contract and regression gates inside the existing compiler,
repair evidence regeneration portability, and do not spend money or enter the live path.**
