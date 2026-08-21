# E8 — SOURCE-COMPLETENESS REFUSAL 🛑 **SUSPENDED**

> # ⛔ SUPERSESSION NOTICE — READ THIS BEFORE ANYTHING BELOW
>
> ## Status: `SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT`
>
> **Suspended 2026-08-21 by AR-1384A** (`861dd4e27f60ea73c614896bf6fda1669b8e7c88`), which
> **SUPERSEDES AR-1383A sections 4 and 8** as to terminal E8 refusal and "move on". This file is
> **preserved as history and is NOT authority.** Do not act on its `REFUSED` verdict.
>
> ### What this document got wrong
>
> It concluded that the required 4H premium/discount state is **absent from the source**. It is not.
> **The operator caught the error and GPT retracted its own framing.**
>
> The educator keeps the chart on **15m for execution** while the **Currency Pros indicator computes
> and displays the configured 4H Premium/Discount state on that same chart**. The `4H | Premium` and
> `4H | Discount` badges are the taught state — they are visible in frames this very packet
> committed, and the narration says the indicator *"automatically checks premium and discount on the
> higher time frame."* **The absence of a visible 4H chart switch is evidence of an HTF-on-LTF
> overlay architecture, not evidence that higher-timeframe bias is missing.**
>
> ### The mechanism of the error, stated plainly
>
> **I measured chart navigation when the question was computation ownership.** The 236-tile scan is
> correct and its positive control is sound — but "the visible chart stayed on 15m" **does not
> discriminate** between *"no 4H information exists"* and *"a component overlays 4H information onto
> the 15m chart."* I ran a true measurement against a question that could not separate the two
> hypotheses, then reported the result as though it had. **I even quoted the `4H | Premium` badge in
> the findings and treated it as proof of absence rather than as the answer.**
>
> GPT records this as **a ruling defect first** (AR-1384A section 3.1: AR-1382A framed a false
> binary — *recover the private formula OR refuse the source* — and omitted the third branch,
> *consume the exact provider output under a pinned dependency contract*). It is also mine: I had
> the disconfirming evidence in hand and did not let it bite.
>
> ### What replaces the single blocker
>
> `VI-E8-3` was one question doing two jobs. It is now split, and the two are graded independently:
>
> | | Question | Status |
> |---|---|---|
> | **`VI-E8-3A`** | What state is used, and what does it do? | ✅ **`MULTIMODAL_RESOLVED`** |
> | **`VI-E8-3B`** | Can Trading Forge obtain that exact state, live and historically? | ⏳ **`EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED`** — nonterminal |
> | *native path* | Can we reimplement the range selector ourselves? | ❌ `SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION` |
>
> **The native gap is real and is kept** — but it blocks only a *native reimplementation*. It does
> **not** erase the explicitly taught provider-output path. Full record:
> [`E8-EXTERNAL-DEPENDENCY-RECORD.md`](./E8-EXTERNAL-DEPENDENCY-RECORD.md).
>
> ### What is authorized now
>
> One **bounded, no-purchase** Currency Pros capability preflight (AR-1384A section 7), gated on the
> operator already holding lawful access. **No purchase, no vendor contact, no credential request,
> no access-control bypass.** If access is unavailable this returns
> `BLOCKED_OPERATOR_ACCESS_REQUIRED` and stops cleanly.
>
> ### The lesson this file now carries
>
> ★ **`"THE PRIVATE FORMULA IS NOT SHOWN" IS NOT "THE REQUIRED STATE IS ABSENT."`**
> ★ **`AN ABSENCE CLAIM MUST BE MEASURED AGAINST A QUESTION THAT COULD HAVE COME OUT THE OTHER WAY.`
> A 236-sample scan with a working positive control is still worthless if the thing it measures
> cannot distinguish the two hypotheses in play.**
>
> Before any future source-missing ruling, AR-1384A section 6.5 requires seven questions be answered
> and preserved — beginning with **"who computes this value?"** A terminal refusal cannot pass review
> with those fields omitted.

---

**Original status, retained as history (NO LONGER AUTHORITY):**
`REFUSED — SOURCE INCOMPLETE FOR DETERMINISTIC SOURCE_FAITHFUL COMPILATION`
**Source:** YouTube `E8Wg6tFPYjo` — *"The EASIEST Trading Strategy - 4H & 15M Fibonacci Step by
Step"*, channel `Ara`
**Issued:** 2026-08-21, worker-1, under AR-1383A section 8 (`7d7fe29732e9b35dd68eb575fbdc109d363ff3bc`)
**Authority chain:** AR-1381A → AR-1382A section 7 → AR-1383A sections 4, 8, 10

---

## 1. THE REFUSAL

E8 **cannot** be compiled source-faithfully. One rule the taught strategy depends on is **not
present in the source at all** — not in its transcript, and not in its pixels. Per AR-1382A
section 7 and AR-1383A section 8, the correct outcome is to say so and stop, not to run further
reconstruction rounds trying to manufacture a survivor.

**This is a successful fail-closed outcome, not an engineering failure.** The source was measured,
the gap was isolated to one named rule, and nothing was invented to paper over it.

---

## 2. THE REMAINING BLOCKER — ONE, AND ONLY ONE

### `VI-E8-3` — 4H premium/discount trading-range construction · `COMPILE_BLOCKER_SOURCE_MISSING`

> Exactly which 4H high and low define the trading range whose 50% separates premium from discount,
> and does the video demonstrate a general selection rule or only example-specific anchors?

**Why it is load-bearing:** higher-timeframe alignment is **checklist item 1** of the taught
strategy. Premium/discount classification gates whether the strategy looks for buys or sells *at
all*. It cannot be computed without a deterministic range definition, so the strategy cannot be
made deterministic without this rule.

**What the source actually shows.** The educator delegates the entire computation to a closed-source
custom indicator (`Currency Pros`) and reads off its verdict. The chart displays only a categorical
badge — `4H | Premium`, `4H | Discount`. **No 4H high, no 4H low, and no 50% equilibrium line is
ever plotted, at any sampled moment in the video.**

**Evidence, and its positive control.** `frames/scan_legend_5s.png` — **236 samples at 5-second
intervals across the full 1177.60 s**, produced by the committed generator
`scripts/_worker_vi_e8_contact_sheet.py`, which validates the media's type, size, duration and
sha256 before sampling and refuses on any mismatch. **Every one of the 236 tiles shows the chart on
`· 15 ·`.** A 4H chart would read `· 240 ·`; no such tile exists.

The **positive control lives in the same artifact as the absence claim**: the crop carries the
symbol as well as the timeframe, and the scan plainly resolves the mid-video change from
`British Pound / Australian Dollar` to `New Zealand Dollar / U.S. Dollar` at ~12:20. The field is
demonstrably being read and is demonstrably capable of showing change, so **the absence of any 4H
tile is a real absence, not instrument blindness.**

**Why no rule can be recovered.** The indicator's inputs are never exposed and its construction is
never narrated. Recovering a range selector would require inventing one — a lookback, a swing
definition, a session boundary — none of which the teacher provides. **AR-1382A section 2 and
AR-1383A sections 4 and 10 forbid exactly that.** So the refusal is terminal *for this source*: it
is not a matter of looking harder.

---

## 3. WHAT IS PRESERVED FOR FUTURE EVIDENCE REUSE

AR-1383A section 8 item 4 requires the accepted visual facts be preserved. Both are **accepted by
GPT** (AR-1383A sections 2 and 3) and are reusable without re-running Visual Intelligence.

### `VI-E8-1` — sell-side Fibonacci draw direction · `MULTIMODAL_RESOLVED` · **ACCEPTED**

The sell-side (GBP/AUD) Fibonacci is drawn **high → low**: level `1` at the swing high
**2.02682**, level `0` at the swing low **2.01851**. This is the **direction-mirror** of the
buy-side procedure, not a repeat of it. The buy-side (NZD/USD) is the inverse: `0` at the high
**0.56073**, `1` at the low **0.55827**.

*Discriminating control:* the opposite orientation predicts the 0.71 line at y≈655; it is observed
at y=455. The alternative is **refuted**, not merely disfavoured.

*Consequence, confirmed on direct visual evidence:* **AR-1380A HIGH A is real.** The rejected
candidate's ordered `entry_sequence` runs the buy-side low→high drawing step straight into the
sell-side 71% short entry. Executed literally that inverts the retracement and places the entry at
the wrong price.

### `VI-E8-2` — buy-side stop wick identity · `MULTIMODAL_RESOLVED` · **ACCEPTED**

*"That wick"* is the **Fibonacci level-`1` anchor itself** — the swing low the fib was dragged from,
**0.55827** — where the stop line, the `1` label and the wick coincide, and from which the position
tool's printed `Stop: 0.00071` reproduces exactly.

*Stated residual, carried not buried:* agreement is at ~1-pip calibration precision. A sub-pip
hand-placement offset like the ~4-tick residual AR-1221 found on a different video **would not be
detectable here and is not claimed absent.** AR-1383A section 3 explicitly cautions against
claiming sub-pip precision the pixels cannot prove.

### The unified rule the two accepted facts establish

Both worked examples, with no exception, derive the entire trade from just the two Fibonacci
anchors:

> **stop = Fibonacci level `1`** — the drag's start anchor, the extreme the impulse originated from
> **entry = the `0.71` level**
> **target = Fibonacci level `0`** — the drag's end anchor

**This survives Blueprint v4's ownership law:** the educator *teaches* a stop and *teaches* a
target, so under AR-1382A section 1 both must be preserved in `SOURCE_FAITHFUL` execution and may
**not** be replaced by ATR or Style C. A Trading Forge overlay may be tested separately as
`TF_OVERLAY_VARIANT`, never reported as the educator's exact strategy.

---

## 4. WHAT THIS REFUSAL IS **NOT** SAYING

Scope discipline, so the headline is not read wider than the body supports:

- **Not** that the E8 source is worthless — two of three hard questions resolved cleanly, and the
  entry/stop/target geometry is fully determined.
- **Not** that the representation defects (AR-1383A section 3: HIGH A direction splice, HIGH B
  invented cross-direction target ranking, and the nine atomic quote-binding fixes) are unfixable.
  They are repairable **from evidence already in hand** and need no new source evidence.
- **Not** that Visual Intelligence failed. It answered every observable question put to it and
  correctly returned `VISUAL_UNRESOLVED` on the one the source does not answer.
- **Not** a claim about any other source. This is scoped to `E8Wg6tFPYjo`.

---

## 5. STANDING LOCKS (AR-1383A section 10)

Still forbidden, and unchanged by this refusal:

- Round-4 E8 candidate authoring.
- Invented 4H range anchors or selector logic.
- Hand-editing or reusing the rejected E8 candidate SHA
  `b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041`.
- Source-taught stop/target replacement by ATR/Style C inside `SOURCE_FAITHFUL`.
- Certifier/compiler promotion for E8; `SOURCE_FAITHFUL` backtesting for E8.
- Broad Factory rerun or 160-video intake; PAPER; broker/Topstep/live.

---

## 6. EVIDENCE INDEX

| Artifact | What it carries |
|---|---|
| `visual-intelligence-e8-round1/E8Wg6tFPYjo/vi_findings.md` | Full findings, with the struck buy-target finding retained and the corrected derivation |
| `visual-intelligence-e8-round1/E8Wg6tFPYjo/vi_task.json` | Task spec, the three questions, struck historical fields, the action-frame law |
| `visual-intelligence-e8-round1/E8Wg6tFPYjo/artifact-manifest.sha256` | SHA-256 for all 32 committed artifacts; `sha256sum -c` verifies |
| `.../frames/scan_legend_5s.png` | The 236-sample full-video scan that carries the VI-E8-3 absence claim **and** its positive control |
| `.../frames/vi1_00-07-48.png` | Sell-side Fibonacci orientation |
| `.../frames/vi2_00-16-28.png` | Buy-side final stable frame — stop, entry and target all rendered |
| `scripts/_worker_vi_e8_contact_sheet.py` | Deterministic scan generator, with the media-validation refusal |
| `scripts/_worker_vi_e8_final_frame_proof.py` | The four closures on the corrected buy-side target |
| `scripts/_worker_vi_e8_hash_manifest.py` | Manifest generator |
| `scripts/_worker_vi_e8_manifest_redproof.py` | Both-arm red-proof that the manifest discriminates |

**Media** (not committed; re-derivable): `hi.mp4`, sha256
`06af188d3a226ca05ba9000097ec7a603ca6ca36563ed12926bf62a0da3e2841`, 35,570,757 bytes, 1177.60 s,
1920x1080 — downloaded three times across two sessions, byte-identical every time.

---

## 7. NEXT

AR-1383A section 8 item 5 directs the campaign to **move to the next calibration source**.

🛑 **`[MEASURED 2026-08-21]` no ordered calibration-source queue exists anywhere in this
repository.** The phrase "next calibration source" occurs in exactly three places — `CURRENT_STATE.md`,
AR-1382A section 7, and AR-1383A section 8 — and in all three it is a **procedural rule, never a
pointer to a named successor**. The closest artifacts are the Strategy Factory census
(`docs/replay-results/strategy-factory-census/library-manifest-v1.1.json`, ~40 unique source videos)
and `docs/designs/source-videos-2026-07-02.json`, both **flat inventories with no ordering or
priority field**. The only other source carried through a comparable certified pipeline is
`sVkmZklJDHI`, but no document states a sequence.

**Selecting the successor is a money-path priority decision and is GPT's, not the worker's**
(`worker-onboarding` 0-CTRL.6). It is named here as an open decision rather than resolved by
inference, and the search that establishes the absence is stated so it is not mistaken for an
unstated one.
