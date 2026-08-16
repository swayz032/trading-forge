# STOP-A VISUAL MICRO-PROOF — AR-1204 §5 / §6 LANE 3

**Scope: STOP-A only.** No visual pipeline was built. No geometry decision was made here.

## Provenance

| field | value |
|---|---|
| video | `sVkmZklJDHI` |
| transcript pin | `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc` |
| timing source | YouTube auto-captions (`en`, VTT), 1,305 cues |
| video format | itag 18, 640×360 progressive |
| frame tool | `ffmpeg -ss <t> -frames:v 1` |
| chart in frame | `MNQZ2025 · 1 · CME` (1-minute), TradingView replay mode |

⚠️ **Resolution limit, stated up front:** these are 360p frames. They are sufficient to read
the position-tool **labels** and the **relative vertical order** of stop / entry / target.
They are **not** sufficient to read price-axis values to tick precision. Every claim below is
about label text or relative vertical order, never about an exact price.

## Timestamps (from the caption track, not estimated)

| moment | timestamp | caption text |
|---|---|---|
| direction declared | `00:09:49.600` | *"the price is going down. So, we want to be taking a short"* |
| short tool clicked | `00:12:05.360` | *"go ahead and click the short tool here."* |
| entry defined | `00:12:10.079` | *"my entry is going to be on the closure of that third candle."* |
| **STOP-A placed** | **`00:12:44.560`** | *"just going to put it at the bottom of the fair value candle. Really simple. If"* |
| wick rule | `00:12:49.120` | *"this candle had a big wick, then you would also include the wick. Don't just"* |

## Frames (immutable references)

| frame | sha256 |
|---|---|
| `f_00-12-04.jpg` | `f3a14dff047cc0ddaf71b5f8ebc129a70ac6ee21951fa666707fdffb4a26713b` |
| `f_00-12-09.jpg` | `4b234ffc78101a19e139a69c2c07ba73dcb29bf3dac58a44685eb8aaa38cf294` |
| `f_00-12-12.jpg` | `386a97777976b8c3cf32cf18fe44e2cd2d7d302906edb405f2c68bac93876a48` |
| `f_00-12-44.jpg` | `8a193f53548abe17c9cc1d31cd89c3dd324b35a30701a54183f9c653dcefcc42` |
| `f_00-12-55.jpg` | `11d8a31564396e2e25b154d140e13fd8f163814626f7b36489c778b6ac8c4e39` |
| `zoom_12-44.png` | `1b7676d82149a348ed66f943eef57c1818717e98220fef446840d6602bbcd5d4` |
| `zoom_00-12-55.png` | `d982d793d1675e8773706164ff0dac0651648b4342ca3019343a17cf986b067e` |

## §5 QUESTIONS, ANSWERED

### 1–4. Frame / tool / entry / stop
`f_00-12-44.jpg` (zoomed: `zoom_12-44.png`) catches the position tool with all three labels legible:

```
Stop:   19.00 (0.077%) 78, Amount: 2250          <- TOP of the tool
Open P&L: -0.75, Qty: 4.579  Risk/Reward Ratio   <- MIDDLE (entry line)
Target: 19.50 (0.079%) 78, Amount: 2756.58       <- BOTTOM of the tool
```

Zone colours in the settled frame `f_00-12-55.jpg`: **grey/shaded band ABOVE the entry line**
(stop zone), **cyan band BELOW** (target zone).

### 6. IS THE STOP VISUALLY ABOVE THE SHORT ENTRY? → ✅ **YES.**

The `Stop` label and its shaded band are unambiguously **above** the entry line; the `Target`
label and band are **below** it. This is the TradingView **short** position tool, consistent
with the spoken *"click the short tool"* and *"taking a short"*.

> 🛑 **This RETIRES the concern I raised in AR-1203 §4.2.** I wrote that a short with a stop at
> the "bottom"/low side was a possible contradiction. **The chart shows a normal, correctly
> oriented short: stop above, target below.** AR-1204 §5 was right that the text alone could
> not establish a contradiction, and the visual evidence resolves it in that direction.
> **There is no risk-side inversion in this teaching.**

### 5 & 7. WHICH CANDLE/ZONE, AND WHAT GEOMETRY? → 🟡 **A DISCREPANCY I AM NOT RESOLVING**

In `zoom_00-12-55.png` the stop line sits at the **TOP** of the highlighted (olive-tinted)
candle body at the left edge of the yellow FVG box, coincident with the **upper edge of the
yellow fair-value-gap rectangle**. That candle's **low** is far below — at/near the entry line.

**So the stop line is visually at an UPPER extreme, while the spoken instruction says
*"the bottom of the fair value candle"*.**

Both of these are true at once and I am not choosing between them:

- **(a)** the teacher's word *"bottom"* does not describe the level his own tool is placed at,
  for this short — a wording/ASR artifact; **or**
- **(b)** *"the fair value candle"* denotes a candle other than the one I have identified, whose
  "bottom" genuinely lies above the entry.

Reading (b) is coherent — for a short, a candle sitting above the entry has a *low* that is
still above it — and it would reconcile the words with the chart. **I cannot separate (a) from
(b) at 360p and it is not my call.**

⚠️ **Note the consequence for the wick rule either way:** *"give your trade enough room to
breathe"* means the wick rule must **widen** the stop. For a stop placed **above** a short
entry, widening means moving to the candle's **high**, not its low. A compiler that renders
*"bottom … including the wick"* as a LOW-side anchor on this short would tighten the stop in
the direction opposite to the teacher's stated intent.

## WHAT THIS DOES NOT ESTABLISH

- no price-level or tick-precision claim;
- nothing about STOP-B (`00:17:03`, the buy example) — out of scope;
- nothing about whether `fvg_low` / `displacement_candle_low` is the right resolver — that
  remains fail-closed per AR-1204 §6/§7;
- the caption track is auto-generated ASR; it timed the frames, it is not treated as authority
  for wording (the pinned transcript is).

## REPRODUCTION

```bash
python -m yt_dlp --skip-download --write-auto-sub --sub-lang en --sub-format vtt \
  -o "svkm.%(ext)s" "https://www.youtube.com/watch?v=sVkmZklJDHI"
python -m yt_dlp -f 18 -o "stopA.%(ext)s" "https://www.youtube.com/watch?v=sVkmZklJDHI"
ffmpeg -y -ss 00:12:44 -i stopA.mp4 -frames:v 1 -q:v 2 f_00-12-44.jpg
```
