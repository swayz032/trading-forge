# Visual Intelligence findings — E8Wg6tFPYjo round 1

Ruling: AR-1382A (`188b41e39908518f8909f6e9e54a45c346813276`) sections 2 and 6.
Corrected under: AR-1383A (`7d7fe29732e9b35dd68eb575fbdc109d363ff3bc`) sections 5–7, by AR-1393.
Task spec: `vi_task.json` in this directory.

> ## 🛑 CORRECTION BANNER — read before using anything below
>
> **AR-1383A struck one finding in this file.** The "NEW FINDING — buy-side target contradicts its
> own narration · `SOURCE_CONFLICT`" section was **FALSE** and is struck in place (retained, not
> deleted). It was measured on `vi2_00-16-21.png`, an **intermediate frame captured mid-drag**. On
> the last stable post-action frame the target sits exactly on Fibonacci level `0`, precisely as
> the teacher narrates. See **[the corrected buy-side target](#corrected-buy-side-target-ar-1393)**.
>
> **VI-E8-1 and VI-E8-2 are ACCEPTED by AR-1383A sections 2 and 3 and stand unchanged.**
> **🛑 VI-E8-3's VERDICT WAS SUBSEQUENTLY CORRECTED BY AR-1384A** (`861dd4e2`), which supersedes
> AR-1383A sections 4 and 8. The required 4H state is **not** absent — the Currency Pros indicator
> computes it and displays it on the 15m chart. `VI-E8-3` is split into `VI-E8-3A`
> (`MULTIMODAL_RESOLVED`) and `VI-E8-3B` (`EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED`, nonterminal); the
> native-reimplementation gap is retained separately. The E8 source-completeness refusal is
> **`SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT`** — preserved as history, not authority. See
> [`../../E8-EXTERNAL-DEPENDENCY-RECORD.md`](../../E8-EXTERNAL-DEPENDENCY-RECORD.md).
>
> **Artifact integrity:** every committed artifact for this source is hashed in
> `../artifact-manifest.sha256` (32 artifacts). Verify with `sha256sum -c artifact-manifest.sha256`.

## Provenance

- Source video: `https://www.youtube.com/watch?v=E8Wg6tFPYjo` — "The EASIEST Trading Strategy - 4H & 15M Fibonacci Step by Step", channel `Ara`, 173K views.
- Media acquired with the method already documented in this repo at
  `docs/replay-results/svkm-extraction-certified/grade/visual-stopA/paired-hires/PAIRED-GEOMETRY-PROOF.md` section 5:
  ```bash
  python -m yt_dlp -f 137 -o "hi.%(ext)s" "https://www.youtube.com/watch?v=E8Wg6tFPYjo"
  ffmpeg -y -ss <HH:MM:SS> -i hi.mp4 -frames:v 1 <name>.png
  ```
- Downloaded media sha256 `06af188d3a226ca05ba9000097ec7a603ca6ca36563ed12926bf62a0da3e2841`, 35,570,757 bytes, 1920x1080, 1177.60 s. Downloaded twice and byte-identical both times. **The .mp4 is deliberately NOT committed** (30MB+ media blob); it is re-derivable in ~5 s from the command above and the committed PNG frames plus their sha256 are the durable evidence.
- Timestamp windows came from the auto-generated caption track (`youtube-transcript-api`, 598 snippets, raw artifact committed at `scripts/_worker_vi_e8_timedtext_raw.json`, sha256 `bbf2b31f3c408147dd13d54cf6edbb8f79f2f367810abca21fd51ac9cbecf239`).

### One correction to a previously published claim (AR-1391)

**AR-1391 stated that no Visual Intelligence capability exists in this repository. That was FALSE and is struck.** The capability exists as a documented worker procedure with committed precedent (AR-1204/1205 first visual micro-proof, AR-1208/1212 paired 1080p proof, AR-1218/1219 Lane V stop geometry, AR-1220/1221 pixel→price calibration) and its artifacts are committed at `docs/replay-results/svkm-extraction-certified/grade/visual-stopA/paired-hires/`. The false absence came from grepping only `src/` and `scripts/` for *code* named "visual intelligence", when the capability is a procedure plus committed frame artifacts. **The operator caught it.** A second published mechanism claim in AR-1391 — that the yt-dlp 403 was signed-URL IP binding — was already struck in that same report; the actual cause is recorded below.

### Why the documented method appeared to fail, and what actually fixed it

`yt-dlp` in this environment was version **2026.07.04**, roughly seven weeks stale. Every format and every player client returned HTTP 403. Upgrading to **2026.08.19** made the *unmodified, already-documented* command work on the first try. Nothing about the method was wrong — the tool was old. Recorded because the failure presented convincingly as a hard access/bot-detection wall and several wrong root causes were published before the right one (`[red-path-decay]`: prior art decays, and a decayed dependency looks exactly like a broken procedure).

## Method

Frames extracted at the caption-derived windows, then levels read from **TradingView's own rendered labels**, not from a pixel colour mask — the same preference AR-1212 established after a colour-mask instrument there returned a result contradicting the tool's own label and was discarded.

Pixel→price calibration per the AR-1221 standard: the price axis is fitted through two axis anchors, and the derivation is then checked against numbers **the position tool itself printed and which were not used to build the scale** (`Stop:` / `Target:` distances). Generator: `scripts/_worker_vi_e8_calibrate.py`.

```
SELL (GBPAUD)  derived stop 0.00242 vs tool-printed 0.00241 · derived target 0.00589 vs 0.00590
BUY  (NZDUSD)  derived stop 0.00071 vs tool-printed 0.00071 · derived target 0.00122 vs 0.00122
BUY  0.71 predicted from the fib anchors = 0.55898 · observed entry handle = 0.55898
```

The buy-side agreement is exact on all three independent checks, so the scale is trustworthy at the precision claimed below.

## VI-E8-1 — sell-side Fibonacci anchors and draw direction · `MULTIMODAL_RESOLVED`

Frame `vi1_00-07-48.png` (sha256 `b66e103b8205a079c1ff5ccf35cc3292a840c59752bd0a63c986846ba9614e52`), magnified in `zoom_vi1_fiblabels.png`.

**Sell-side (GBPAUD) fib is anchored level `1` at the swing HIGH and level `0` at the swing LOW:**

| level | y px | price |
|---|---|---|
| `1` (top) | 316 | 2.02682 |
| `0.75` | 435 | 2.02475 |
| `0.71` = entry | 455 | 2.02440 |
| `0` (bottom) | 794 | 2.01851 |

Discriminating control: had the orientation been the other way (0 at top, 1 at bottom), the 0.71 line would have to sit at y≈655. It is observed at y=455. The alternative is refuted, not merely disfavoured.

**Buy-side (NZDUSD) is the MIRROR** — frame `vi2_00-16-21.png` (sha256 `bce3ca65a48483e0ab59b70193d3b8376063c77f0c3240d279b943414d4ee699`), magnified in `zoom_vi2_fiblabels.png`: level `0` at the swing HIGH (0.56073), level `1` at the swing LOW (0.55826).

TradingView's Fib Retracement places level `1` at the **start** of the drag and level `0` at the **end**. The buy-side narration — *"start at the low, click, and drag to the high"* — therefore predicts exactly the observed buy-side orientation (1 at the low, 0 at the high), which independently validates that reading of the tool's convention. Applying it to the observed sell-side orientation yields the answer:

> **The sell-side Fibonacci was drawn HIGH → LOW: started at the swing high (2.02682, level 1), dragged to the swing low (2.01851, level 0). It is the direction-mirrored counterpart of the buy-side procedure, NOT a repeat of it.**

**This confirms AR-1380A HIGH A on direct visual evidence.** The candidate's ordered `entry_sequence` places the buy-side low→high drawing procedure at step 11 immediately before the sell-side 71% short entry at step 12. Executed literally, that applies the wrong anchor order to the sell side and inverts the retracement, putting the 71% entry at the wrong price. The cross-splice is a real wrong-geometry defect, exactly as AR-1389 argued and AR-1381A section 2 ruled.

## VI-E8-2 — buy-side stop wick identity · `MULTIMODAL_RESOLVED`

Same buy-side frame and zoom. The stop line, the `1` label, and the swing-low wick coincide at y≈740 / **0.55826**, and the tool's printed risk distance (0.00071) reproduces exactly from that level.

> **"That wick" is the Fibonacci level-`1` anchor itself — the swing low the fib was dragged FROM.** The stop is not a separate hand-chosen level: it is the origin anchor of the retracement.

This resolves symmetrically with the sell side, where the narration already says the stop goes to *"the high of the Fibonacci range"* — measured at 2.02682, which is that side's level `1`. So a single direction-aware rule covers both:

> **stop = Fibonacci level `1` = the extreme the impulse originated from (the drag's start anchor).**
> **entry = the `0.71` level** — exact on both sides (2.02440 sell, 0.55898 buy).

**Stated residual:** agreement is at the ~1-pip precision of this calibration; a sub-pip hand-placement offset like the ~4-tick residual AR-1221 found on the other video would not be detectable here and is NOT claimed to be absent.

## VI-E8-3 — 4H premium/discount trading-range construction · 🛑 **VERDICT CORRECTED BY AR-1384A**

> ## ⛔ THE CONCLUSION BELOW IS WRONG. THE MEASUREMENT IS RIGHT.
>
> **AR-1384A** (`861dd4e2`) **supersedes AR-1383A sections 4 and 8.** The operator caught the error
> and GPT retracted its own framing.
>
> Everything measured in this section stands: the chart really never leaves 15m, and the scan's
> positive control really works. **What was wrong is the inference.** "The visible chart stayed on
> 15m" does not discriminate between *no 4H information exists* and *a component overlays 4H
> information onto the 15m chart* — and the narration plus the indicator's own `4H → Premium` /
> `4H → Discount` rows select the second. **Absence of a chart switch is what an HTF-on-LTF overlay
> architecture looks like.** I quoted the badge in this very section and read it as proof of absence
> rather than as the answer.
>
> `VI-E8-3` was one question doing two jobs, and it is now split:
>
> | | Question | Status |
> |---|---|---|
> | **`VI-E8-3A`** | What state is used and what does it do? | ✅ `MULTIMODAL_RESOLVED` — external provider, 4H decision on a 15m chart, PREMIUM ⇒ short-only / DISCOUNT ⇒ long-only |
> | **`VI-E8-3B`** | Can Trading Forge obtain that exact state, live and historically? | ⏳ `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` — **nonterminal**, measured by the AR-1384A section 7 preflight |
> | *native* | Can the range selector be reimplemented natively? | ❌ `SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION` — retained, blocks only a native rebuild |
>
> Full record, with the seven ownership questions answered:
> [`../../E8-EXTERNAL-DEPENDENCY-RECORD.md`](../../E8-EXTERNAL-DEPENDENCY-RECORD.md).
> The panel evidence is committed at `frames/zoom_vi3_cp_panel_premium.png` and
> `frames/zoom_vi3_cp_panel_discount.png` — a structured decision surface carrying the strategy's
> own checklist (`HTF Alignment`, `Liquidity Sweep`, `BOS + Imbalance`, `71% Retracement`,
> `Trade Score`), not the mere "categorical verdict badge" this section called it.
>
> ★ **`"THE PRIVATE FORMULA IS NOT SHOWN" IS NOT "THE REQUIRED STATE IS ABSENT."`**

**The chart is never once set to the 4-hour timeframe** — true, and expected under an HTF-on-LTF
overlay. Full-video scan, not a single-frame read:

- `scan_symbol_header_15s.png` — 78 samples at 15 s intervals across the full 19:38.
- `scan_timeframe_5s.png` — **240 samples at 5 s intervals**, covering the entire runtime. Every tile reads `· 15 ·`. A 4H chart would read `· 240 ·`. There is no such tile.
- **Positive control on the scanning instrument:** the same scan plainly resolves the symbol change from `British Pound / Australian Dollar` to `New Zealand Dollar / U.S. Dollar` at roughly 11–12 min. The instrument demonstrably detects change in that field, so its failure to show a timeframe change is a real absence and not instrument blindness.
- Frames `vi3b_00-01-52/02-05/02-14.png`, taken at the exact moment of the premium/discount teaching (*"anything above 50% of the trading range is considered premium…"*), show only the Currency Pros panel's categorical verdict badge — `4H | Premium` (and `4H | Discount` in the second example, `vi3_00-12-38/42/46.png`). No 4H high, no 4H low, no 50% equilibrium line is plotted on the chart at any sampled moment.

Per AR-1382A section 2's own instruction — *"If the video shows only example-specific anchors and no general rule, return `VISUAL_UNRESOLVED`; do not manufacture a generalized range algorithm"* — no range selector is proposed. **That restraint was correct and still is: no 4H range selector has been invented, and none may be.** The educator delegates the computation to a closed-source custom indicator whose *internals* are never exposed.

~~**Consequence for compilation:** higher-timeframe alignment is checklist item 1 and gates trade direction, so this remains a hard `COMPILE_BLOCKER_SOURCE_MISSING` for a fully deterministic E8, and it is not resolvable from this source at all — neither from its text nor from its pixels.~~

🛑 **STRUCK BY AR-1384A.** The premise "not resolvable from this source at all" is false. Higher-timeframe
alignment *is* checklist item 1 and *does* gate trade direction — but the source **states the state
and its consequence explicitly**, and the indicator **displays it on the 15m chart**. What the source
withholds is the *private formula*, which blocks a **native reimplementation only**. The corrected
consequence:

- **semantics** → resolved (`VI-E8-3A`);
- **provider access / historical replay** → `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED`, **nonterminal**,
  and the actual live blocker (`VI-E8-3B`);
- **native reimplementation** → `SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION`, retained.

★ **The error was measuring chart navigation when the question was computation ownership.** The
236-tile scan is a true measurement of a discriminator that could not separate the two hypotheses in
play, and it was reported as though it had.

## ~~NEW FINDING — buy-side target contradicts its own narration · `SOURCE_CONFLICT`~~ 🛑 STRUCK

> **STRUCK BY AR-1383A SECTION 5. THIS FINDING IS FALSE.** Retained verbatim below under
> preserve-and-strike so the record shows what was claimed and when. The corrected derivation is in
> [the next section](#corrected-buy-side-target-ar-1393). **Do not carry this claim forward into any
> candidate representation, and do not treat it as evidence bearing on HIGH B.**

~~Not raised in the GPT-5.6 audit and not previously reported. Surfaced by the calibration.~~

~~The narration for the buy-side example says the take-profit is dragged *"to the high of the Fibonacci range"*. The fib high on that chart is level `0` = **0.56073**. The target is actually placed at **0.56020** — **0.00053 lower** (~5.3 pips), which is ~21% of the way into the fib range rather than at its boundary. The tool's own printed `Target: 0.00122` reproduces from 0.56020 and not from 0.56073, so this is not a reading artifact.~~

~~By contrast the **sell-side target sits exactly on its level `0`** (2.01851, printed `Target: 0.00590`, derived 0.00589). So the narrated target rule holds on one worked example and fails on the other.~~

~~This is the same shape AR-1212 recorded for the other video — *the teacher's words disagree with his own chart* — and it means `targets` cannot be compiled as "the far Fibonacci boundary" from this source without silently contradicting one of the two demonstrations. It is **evidence bearing on AR-1380A HIGH B**: beyond the invented cross-direction `priority` ranking, the two targets are not even generated by one consistent stated rule. Flagged for GPT adjudication; no representation is proposed here.~~

<a id="corrected-buy-side-target-ar-1393"></a>

## CORRECTED — buy-side target, from the final stable frame · AR-1393

**The buy-side target sits exactly on Fibonacci level `0`. The teacher's words and his finished
chart agree. There is no source conflict, on either worked example.**

The struck finding measured `vi2_00-16-21.png`. That frame is real, and its pixel arithmetic is
correct — but it captures the take-profit **while the teacher is still dragging it**. The
authoritative frame is the last stable one after the drop:

**`vi2_00-16-28.png`** · sha256 `16bcf948748143064bbbd467054a1a7fc2dc6b05a753bb9de1c477909bfa7d8b`

The corrected derivation does **not** depend on pixel→price interpolation at all. Every value below
is one TradingView itself rendered — a position-tool label or a price-axis label — and the four
closures cross-check those printed values against each other. Generator:
`scripts/_worker_vi_e8_final_frame_proof.py`.

```
rendered by TradingView on the final frame
  price-axis label on the stop line ......... 0.55827
  price-axis label on the target line ....... 0.56073
  position tool "Stop:   0.00071 (0.127%)"
  position tool "Target: 0.00175 (0.313%)"
  position tool "Risk/Reward Ratio: 2.46"

entry = 0.55827 + 0.00071 = 0.55898

CLOSURE 1  entry + printed target distance = 0.55898 + 0.00175 = 0.56073
           target line's own axis label                        = 0.56073     delta 0.00000
CLOSURE 2  0.00175 / 0.00071 = 2.4648 -> 2.46                  printed 2.46
CLOSURE 3  fib range 0.56073 - 0.55827 = 0.00246
           0.71 retracement from fib 0 downward = 0.55898       entry 0.55898  delta 0.00000
CLOSURE 4  target-line axis-highlight row y=363.5; fib `0` line row y=364 -> the same row
```

### Why the wrong frame was chosen, stated as mechanism

Three things converged, and each is now a control:

1. **The semantic answer was bound to a mid-action frame.** `vi2_00-16-24.png` — already committed,
   already in hand — shows the cursor **visibly gripping the target handle**. The evidence that the
   action was still in progress was sitting in the same directory and was not consulted.
2. **At the mid-drag target row the price axis is occluded by the webcam overlay**, so the
   interpolated reading had **no TradingView-rendered label to check itself against**. Every other
   level in this packet had one. That asymmetry was the tell and it was not noticed.
3. **The instrument was sound, so it produced a confident wrong answer.** The fib anchors read off
   the mid-drag frame (0.56073 / 0.55826) agree with the final frame's rendered axis labels
   (0.56073 / 0.55827) to 1e-5. **The calibration was never the defect — frame selection was.**

**Binding law going forward (AR-1383A section 6):** for any drag, click, resize or drawing action,
capture **BEFORE → DURING → AFTER-DROP → LAST STABLE** and bind the semantic answer only to the last
stable post-action frame. An intermediate frame is evidence that the action occurred; it may never
control the conclusion about the action's *result*. The committed triplet for this action is
`zoom_vi2_pre_16-21_target.png` / `zoom_vi2_during_16-24_drag.png` / `zoom_vi2_post_16-28_target.png`.

### What this changes upstream

The unified direction-aware rule from VI-E8-2 now closes on **both** worked examples with no
exception, and the whole buy-side setup derives from just the two Fibonacci anchors:

> **stop = Fibonacci level `1`** (the drag's start anchor / impulse origin)
> **entry = the `0.71` level**
> **target = Fibonacci level `0`** (the drag's end anchor)

**AR-1380A HIGH B is therefore narrower than AR-1392 argued.** The defect is the *invented
cross-direction `priority: 1` / `priority: 2` ranking* only — AR-1383A section 3 HIGH B. The two
worked-example targets are parallel **direction-scoped** exits produced by one consistent taught
rule. The claim that they were "not generated by one consistent stated rule" is withdrawn.

## Summary

| question | status |
|---|---|
| VI-E8-1 sell-side Fibonacci anchors / draw direction | `MULTIMODAL_RESOLVED` — high→low, mirror of buy side; confirms HIGH A |
| VI-E8-2 buy-side stop wick identity | `MULTIMODAL_RESOLVED` — the fib level-`1` anchor, 0.55826 |
| ~~VI-E8-3 4H premium/discount range construction~~ | 🛑 **VERDICT CORRECTED, AR-1384A.** Split into `VI-E8-3A` (`MULTIMODAL_RESOLVED` — external provider computes the 4H state and displays it on the 15m chart) and `VI-E8-3B` (`EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED`, nonterminal). Native reimplementation stays `SOURCE_INCOMPLETE`. |
| ~~(new) buy-side target vs its narration~~ | 🛑 **STRUCK, AR-1383A section 5** — measured on a mid-drag frame. On the final stable frame the target is exactly on fib `0`. No conflict. |

Two of the three hard blockers named by AR-1382A section 2A are resolved from source evidence and
**accepted by AR-1383A sections 2 and 3**. The third is proven unresolvable from this video, which
per AR-1382A section 7 is the trigger for an honest E8 compile refusal rather than a further
reconstruction round. **AR-1383A section 8 made that call: no Round 4 is authorized.** The refusal
is recorded at
`docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/E8-SOURCE-COMPLETENESS-REFUSAL.md`.

## Artifact integrity and reproducibility

- **`../artifact-manifest.sha256`** hashes **all 32** committed artifacts for this source (the
  original 26 plus the six AR-1393 additions). Verify with `sha256sum -c artifact-manifest.sha256`.
  AR-1392's prose implied its inline hashes covered the whole set; they covered only the frames it
  argued from. Corrected under AR-1383A section 7 item 6.
- **`frames/scan_legend_5s.png`** — the full-video scan, regenerated 2026-08-21 by the committed
  generator `scripts/_worker_vi_e8_contact_sheet.py`: **236 samples at 5 s intervals**, one crop of
  the chart legend line carrying **both** the symbol and the active timeframe. **Every tile reads
  `· 15 ·`.** The symbol-change positive control (GBP/AUD → NZD/USD, ~12:20) is visible in the same
  artifact as the absence claim it controls for. The generator validates media type, size, duration
  and sha256 and **refuses** on any mismatch.
- **`frames/scan_timeframe_5s.png`** and **`frames/scan_symbol_header_15s.png`** (AR-1392) are
  **retained as historical evidence but SUPERSEDED**: they were produced by an ad-hoc command that
  was never committed, so their sample timestamps, crop boxes and tile layout cannot be reproduced
  or audited from this repository. Their conclusion is unchanged and now independently re-derived.
- **Media:** `hi.mp4`, sha256 `06af188d3a226ca05ba9000097ec7a603ca6ca36563ed12926bf62a0da3e2841`,
  35,570,757 bytes, 1177.60 s, 1920x1080. Downloaded **three times across two sessions and
  byte-identical every time**. Deliberately not committed; re-derivable in seconds from the
  documented command.
