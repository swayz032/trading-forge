# E8 — EXTERNAL DECISION DEPENDENCY RECORD

**Dependency:** `e8.htf_premium_discount`
**Source:** YouTube `E8Wg6tFPYjo` — *The EASIEST Trading Strategy - 4H & 15M Fibonacci Step by Step*
**Issued:** 2026-08-21, worker-1 (AR-1394), under AR-1384A sections 2, 6 and 10 Stage A item 3
**Supersedes:** the single collapsed `VI-E8-3` question and the terminal refusal built on it

> **THIS IS AN EVIDENCE RECORD, NOT A WIRED CONTRACT.** AR-1384A section 10 puts the typed
> dependency into the compiler graph at **Stage C**, and only *after* the Stage B capability
> preflight proves a machine-readable route. Nothing here is compiled, executed, or gating anything.

---

## 1. THE SPLIT — THREE AXES, KEPT SEPARATE

AR-1384A section 6.1: no single `SOURCE_MISSING` boolean may erase these distinctions. The previous
refusal existed precisely because one flag was carrying three different facts.

| Axis | Question | Status |
|---|---|---|
| **Semantic** (`VI-E8-3A`) | What state is used, and what does it do? | ✅ `MULTIMODAL_RESOLVED` |
| **Access / capability** (`VI-E8-3B`) | Can the exact state be obtained live **and** historically? | ⏳ `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` — **nonterminal** |
| **Implementation** | Is there a validated Trading Forge adapter? | ⛔ `NOT_STARTED` — gated on the axis above |
| *(separate)* **Native path** | Can we reimplement the range selector ourselves? | ❌ `SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION` |

**The native gap is real and is retained.** It blocks a *native reimplementation only*. It does not
erase the explicitly taught provider-output path — that conflation is exactly what AR-1384A
section 3.1 identifies as a false binary.

---

## 2. `VI-E8-3A` — SEMANTIC DEPENDENCY · `MULTIMODAL_RESOLVED`

```text
computation owner        : Currency Pros indicator (third-party, TradingView)
display chart timeframe  : 15m
decision timeframe       : 4H
provider output          : PREMIUM | DISCOUNT
consumer role            : required direction gate / checklist item 1 (HTF Alignment)
PREMIUM                  : SHORT_ONLY
DISCOUNT                 : LONG_ONLY
UNKNOWN / missing / stale: NO_TRADE
```

### Evidence, measured on committed artifacts

**Narration.** *"So, my indicator automatically checks premium and discount on the higher time
frame. As you can see here, I have it set to 4hour. So, it's already telling me that we're trading
at a premium on the 4hour time frame and it's right before selling opportunities."* (~2:18–2:41)
And for the second example: *"my indicator is showing me that the 4hour time frame is currently at a
discount, which means we should not be looking for selling opportunities."* (~12:33–12:50)

**On-chart panel.** The Currency Pros panel is **not a decorative badge** — it is a structured
decision surface rendered on the 15m chart, and it carries the decision timeframe in its own row:

| Committed artifact | Symbol | Chart TF | `[TF]` row | Panel contents |
|---|---|---|---|---|
| `zoom_vi3_cp_panel_premium.png` (from `vi3_00-02-30.png`) | GBP/AUD | `15m` | **`4H` → `Premium`** (red) | `Checklist`, ✅ `HTF Alignment`, ✅ `Liquidity Sweep`, ✅ `BOS + Imbalance`, ✅ `71% Retracement`, `Trade Score 100` |
| `zoom_vi3_cp_panel_discount.png` (from `vi3_00-12-42.png`) | NZD/USD | `15m` | **`4H` → `Discount`** (teal) | same checklist rows, `Trade Score 100` |

The panel's checklist rows **are the taught strategy's own checklist**, with `HTF Alignment` as
item 1 — which is what makes this a gate rather than an annotation.

### Why the earlier "absent" conclusion was wrong

AR-1393 measured that the visible chart never leaves 15m (236 samples, 5 s apart, positive control
on the symbol change). **That measurement is true and is retained.** It simply does not discriminate
between the two live hypotheses:

```text
H1  no 4H information exists                         <- what was concluded
H2  a component overlays 4H information onto the 15m chart   <- what is true
```

The `4H | Premium` / `4H | Discount` rows and the narration select **H2**. The absence of a chart
switch is *expected* under an HTF-on-LTF overlay architecture — it is evidence **for** H2, not
against it.

★ **`AN ABSENCE CLAIM IS ONLY AS GOOD AS THE QUESTION IT WAS MEASURED AGAINST. A PERFECT
MEASUREMENT OF THE WRONG DISCRIMINATOR IS STILL A FALSE FINDING.`**

---

## 3. `VI-E8-3B` — ACCESS AND REPLAY CAPABILITY · `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED`

**Nothing in this section is decided. It is the Stage B preflight's job to measure it.**

What is established: Currency Pros is a custom TradingView indicator with automated
annotation/checklist behaviour. What is **not** established: whether this Premium/Discount state is
exposed through a named alert condition, an `alert()` call, a plot value, a Data Window value, a CSV
export, a historical series, or any stable API.

### One measurable hypothesis, flagged as such — NOT a conclusion

⚠️ **`HYPOTHESIS, UNVERIFIED`** — and it is recorded precisely because it is the kind of claim that
must not be settled by appearance, which is the error this whole packet is correcting.

The panel *renders like* a Pine `table.*` drawing. In TradingView, table cells are **drawing
objects, not plots**: they do not appear in the Data Window, are not addressable by plot-based alert
placeholders, and are not included in chart-data export. **If** the state reaches the screen only
through `table.*`, there may be **no machine-readable route** unless the script *also* exposes a
`plot()` / `plotchar()` series or an `alertcondition()` / `alert()` call.

**This is a rendering observation, not a capability finding.** A table on screen says nothing about
what else the script publishes. **Do not treat it as a result.** Section 7 of AR-1384A settles it by
measurement in the actual indicator UI — the Create Alert dialog, the Data Window, and chart export
are the only admissible evidence.

### The routing this feeds (AR-1384A section 6.2)

| Native rule | Exact provider state | Historical state | Route |
|---|---|---|---|
| Incomplete | Live + historical exposed | Available | **Provider adapter may qualify** |
| Incomplete | Live only | Unavailable | **Shadow-live only**; source-faithful backtest stays blocked |
| Incomplete | Not machine-readable | Unavailable | **`UNSUPPORTED_CAPABILITY_REFUSAL`** with a structured external-dependency reason |
| Any | Stale / unknown / mismatched / drifting | Any | **Fail closed — no trade** |

🛑 If the provider proves unavailable, the terminal state is `UNSUPPORTED_CAPABILITY_REFUSAL`
**with an external-dependency reason** — it must **never** be converted back into a claim that the
source semantics are absent. That conversion is the exact defect this record exists to prevent.

---

## 4. THE TYPED DEPENDENCY CONTRACT (AR-1384A section 6) — RECORDED, NOT WIRED

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
  "configuration": { "higher_timeframe": "4h" },
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
  "evidence_receipt_ids": ["VI-E8-3A"]
}
```

⚠️ `condition_ref` is carried **verbatim from AR-1384A section 6** and has **not** been validated
against the rejected candidate's actual `entry_sequence` indexing. The rejected candidate SHA is
under lock, and its ordering is itself the subject of the HIGH A direction-splice defect. **Treat
`entry_sequence[1]` as provisional** until the successor candidate exists; binding it now would
inherit an index from an artifact known to be mis-ordered.

---

## 5. VISUAL RECEIPT v2 FIELDS (AR-1384A section 6.3)

Additive to the existing `VisualEvidenceReceipt/1`. Populated for this dependency:

```text
computation_owner       : EXTERNAL_PROVIDER (Currency Pros indicator)
display_chart_timeframe : 15m
decision_timeframe      : 4h
provider_output         : PREMIUM | DISCOUNT
consumer_role           : REQUIRED_DIRECTION_GATE (checklist item 1, HTF Alignment)
dependency_id           : e8.htf_premium_discount
```

**Why the old receipt could not hold this** (AR-1384A section 3.4): `VisualEvidenceReceipt/1`
records a *resolved semantic* but not **who computed it**, at **what decision timeframe**, or **how
it is consumed**. With no field for "resolved external gate, access not yet proven," the pipeline
forced the evidence into the nearest wrong bucket — `SOURCE_MISSING`. **The schema gap and the false
refusal are the same defect at two layers.**

---

## 6. EXTRACTION ONTOLOGY FINDING (AR-1384A section 3.3)

The fresh E8 candidate preserved the decisive quotes and then **mislabelled them**:
`Non-executable tooling note`, worked-example `context`, and `role: context` on the Premium/Discount
direction rules — which control trade direction. It then emitted
`higher_timeframe.trading_range_definition` as a source gap.

```text
optional way to compute a state   !=  optional state
external computation              !=  non-executable context
unknown provider internals        !=  unknown provider output semantics
```

The educator says the charting tool is optional **because the work can be done manually**. That does
not make higher-timeframe alignment optional. AR-1384A section 6.4 makes this a lint rule: anything
that changes direction, entry eligibility, exit, size, or a required checklist item may not be
labelled only `context` / `tooling` / `non-executable` — the extractor must emit a native executable
condition, a typed external dependency, or an explicit unresolved-ownership finding.

**Not implemented here.** The lint is a compiler change and belongs to Stage C.

---

## 7. THE SEVEN QUESTIONS (AR-1384A section 6.5), ANSWERED AND PRESERVED

Required before any future source-missing ruling. Answered here for `e8.htf_premium_discount`:

| # | Question | Answer |
|---|---|---|
| 1 | Who computes the value? | **The Currency Pros indicator** — a third-party TradingView script. Not the teacher, not the platform, not Trading Forge. |
| 2 | Where is the output visible or stated? | On the 15m chart, in the indicator's panel: `4H → Premium` / `4H → Discount`; and in narration at ~2:18–2:41 and ~12:33–12:50. |
| 3 | Does it gate a trade or only annotate it? | **Gates.** Checklist item 1 (`HTF Alignment`); PREMIUM ⇒ short-only, DISCOUNT ⇒ long-only. |
| 4 | Is HTF state overlaid on a lower-timeframe chart? | **Yes** — 4H decision state on a 15m execution chart. This is the fact the earlier refusal missed. |
| 5 | Does faithful execution need the private formula, the exact output, or either? | **Either.** The exact output suffices; the private formula is needed only for a native reimplementation. |
| 6 | Is the output machine-readable live? | **UNVERIFIED** — Stage B measures it. |
| 7 | Is the output available historically for replay/backtest? | **UNVERIFIED** — Stage B measures it. This one gates source-faithful backtesting specifically. |

---

## 8. STAGE B OUTCOME · `BLOCKED_OPERATOR_ACCESS_REQUIRED`

**The AR-1384A section 7 preflight did not run.** Its precondition — the operator already holding
lawful Currency Pros access in the normal TradingView UI — is **not confirmed**.

**What was asked and what came back.** The operator was asked directly whether he already has
Currency Pros on his TradingView account. His answer, verbatim: **"we using topstep x"**. He did not
answer yes. Per AR-1384A section 10 item 6 the authorized outcome is a clean stop — **no purchase,
no vendor contact, no credential request, no access workaround.** None was attempted.

⚖️ **Recorded honestly:** the operator answered a *different* question than the one asked — he named
the platform rather than confirming or denying indicator access. This record does **not** claim he
lacks access; it claims access is **unconfirmed**, which is what fails the precondition. If he does
hold it, the preflight is unblocked by one word and nothing here needs redoing.

### The exact UI evidence needed to unblock (AR-1384A section 7, steps 1–10)

On a **15m** chart with the indicator's higher-timeframe input set to **4H**:

1. Indicator identity/version if visible, symbol, exchange/feed, timezone, chart timeframe, and every relevant input value.
2. **Create Alert** dialog — are there named `Premium`, `Discount`, or `HTF Alignment` conditions?
3. Is **Any alert() function call** available for the indicator?
4. **Data Window** and alert-message placeholders — is there a numeric/boolean/categorical plot representing the state?
5. **Export chart data** — does the state appear historically on loaded bars?
6. Capture one Premium case and one Discount case.
7. Change the configured HTF from 4H to 1H; verify the emitted output is sensitive to that configuration. Restore 4H.
8. Does the current 4H value change intrabar, or only after the 4H bar confirms?
9. Check the **actual target instruments/feeds** — do not generalize from the Forex examples.
10. Record any displayed licensing terms relevant to automated consumption. **Escalate; do not infer permission.**

---

## 8a. 🛑 NEW ARCHITECTURAL FINDING — THE PLATFORM THE INTEGRATION ASSUMES IS NOT THE EXECUTION PLATFORM

Surfaced by the operator's answer, then **measured in the repository** rather than relayed.

| Grade | Fact |
|---|---|
| `RELAYED` | Operator, verbatim: **"we using topstep x"** |
| `MEASURED HERE` | `src/server/services/broker-router.ts:5-6` — *"Today only the TradersPost path actually fires; TopstepX returns a clear `not configured` stub."* |
| `ARTIFACT-SOURCED` | `CLAUDE.md` §6 — Topstep platform is **TopstepX ONLY**; NinjaTrader/Tradovate banned as of 2026-01-12. §7 — Topstep routes **TopstepX REST/WS direct, no TradersPost**. |
| `ARTIFACT-SOURCED` | `CLAUDE.md` §8 — the TradingView → TradersPost path is the **family/external Pine** workflow, and TradingView is *"the bot's eye"*, explicitly **not** the execution path for the full strategy. |

**The consequence GPT should weigh.** AR-1384A section 8 designs the provider adapter as a
**TradingView alert → webhook → `POST /api/external-indicator/state`** ingestion. That is a
*decision-input* path, not an order-routing path, so it is **not** directly blocked by TopstepX
being the execution venue — the two can coexist.

But it does mean that, as designed, **every E8 trade's direction gate would depend at runtime on:**

1. a **third-party paid indicator** (Currency Pros),
2. hosted on **TradingView** — a platform that is *not* the Topstep execution venue and whose role
   in this system is explicitly monitoring/paper rather than live execution, and
3. a **live alert delivery path** whose failure mode must be `NO_TRADE`.

That is a standing external dependency in the critical path of the operator's primary money path,
on a platform the architecture deliberately keeps out of live Topstep execution.

⚖️ **This is escalated, not decided.** It is an architecture and money-path question, which is GPT's
(`worker-onboarding` 0-CTRL.6). Three routes exist and the worker does not choose between them:

- **(a)** accept the TradingView-resident dependency for the E8 direction gate, with fail-closed
  delivery guarantees;
- **(b)** treat E8 as a **calibration/compiler-fidelity** source only — proving the compiler can
  faithfully represent an external-decision dependency — without E8 itself becoming a live strategy;
- **(c)** require a native 4H premium/discount implementation before E8 is money-path eligible,
  which the source does **not** supply (`SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION`) and which
  no one may invent (AR-1384A section 11).

★ Worth noting that **(b)** costs nothing and is not blocked by the access question at all: the
compiler-side value of E8 is that it forced the typed external-dependency contract into existence,
and that contract is now recorded regardless of whether Currency Pros is ever reachable.

---

## 9. STATUS AND NEXT

- **`VI-E8-3A`** — resolved and accepted as evidence; preserved for reuse.
- **`VI-E8-3B`** — the live blocker, and it is **nonterminal**. Resolved only by the AR-1384A
  section 7 bounded preflight, which requires **the operator's existing lawful Currency Pros
  access**. No purchase, no vendor contact, no credential request, no access-control bypass.
- **Native reimplementation** — remains `SOURCE_INCOMPLETE`. Retained, not escalated.
- **`E8-SOURCE-COMPLETENESS-REFUSAL.md`** — `SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT`,
  preserved as history, not authority.

**Stage B result: `BLOCKED_OPERATOR_ACCESS_REQUIRED`** (section 8 above). Access is **unconfirmed**,
not disproven — one word from the operator unblocks the preflight, and nothing recorded here would
need redoing.

**Stage C: not started**, gated on Stage B as AR-1384A section 10 requires.

**Two questions now sit with GPT**, neither of which the worker may decide:

1. **The routing question (section 8a)** — is a TradingView-resident, third-party-paid, live
   dependency acceptable in the critical path of the direction gate, given that Topstep executes via
   TopstepX and TradingView is deliberately not the live execution path? Routes (a) / (b) / (c) are
   laid out there.
2. **Whether Stage C's compiler work should proceed under route (b) regardless.** The typed
   external-dependency contract, the receipt v2 fields, and the section 6.4 extraction lint are all
   **independent of whether Currency Pros is ever reachable** — they are the compiler learning to
   represent *any* external decision dependency instead of mislabelling it a source gap. That is the
   durable value E8 produced, and it does not depend on the access answer.
