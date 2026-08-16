# PAIRED STOP-GEOMETRY PROOF — AR-1208 §6 LANE 3 / AR-1210 §6 step 3

**Bounded golden-slice proof. Two examples only. No visual pipeline was built.**
**No geometry resolver was chosen — that remains GPT's ruling (AR-1208 §7).**

## Provenance

| field | value |
|---|---|
| video | `sVkmZklJDHI` · transcript pin `df72444f…ce99cc` |
| video format | itag **137**, 1920×1080 H.264 (previous proof was 360p) |
| timing source | YouTube auto-captions (VTT), 1,305 cues — timestamps not estimated |
| chart | `MNQZ2025 · 1 · CME`, TradingView replay |

| frame | sha256 |
|---|---|
| `h_00-12-47.png` | `52ec2375df068a8181f638922b3d384f8dca069faba367003879459fee6a75ac` |
| `h_00-12-55.png` | `467de65a2ff04795d9939e8bbda8150a68badf6ef6ebef488a4cd86c9255b72a` |
| `h_00-17-06.png` | `e27bd482b76931d3f0887ba5ab47ea6a9d2b25e102fb6e90cc4054481256c008` |
| `h_00-17-14.png` | `00480d5e6494e1526938646e9a73ab251b99953b84d7a26d1d131575128cedfa` |
| `zoomA.png` / `zoomB.png` | `0230256…4cf9` / `3386784…b187` (crops of the two settled frames) |

---

## 1. WHAT IS DIRECTLY READABLE — TradingView's own rendered labels

These are **text the charting tool drew**, not my interpretation of pixels.

### STOP-A — the SHORT example (`00:12:44`–`00:12:55`)
```
Stop:   19.00 (0.077%) 78,  Amount: 2250        <- TOP of the tool
Open P&L …  Risk/Reward Ratio                    <- entry line
Target: 19.50 (0.079%) 78,  Amount: 2756.58     <- BOTTOM of the tool
```
Stop band **above** entry, target band **below** ⇒ **SHORT**, correctly oriented.

### STOP-B — the BUY example (`00:17:06`–`00:17:14`)
```
Target: 94.50 (0.376%) 378, Amount: 3000        <- TOP of the tool
Open P&L: 0.00, Qty: 2.646
Risk/Reward Ratio: 2                             <- entry line
Stop:   47.25 (0.188%) 189, Amount: 2250        <- BOTTOM of the tool
```
Target band **above** entry, stop band **below** ⇒ **LONG/BUY**, correctly oriented.

### 1.1 ⭐ AN INDEPENDENT CORROBORATION OF THE TEACHER'S 2R

STOP-B's tool prints **`Risk/Reward Ratio: 2`**, and its own numbers agree:
`94.50 / 47.25 = 2.000`.

The extraction claimed `target.type = r_multiple, r_multiple = 2`. **That is now corroborated
by a second, non-textual path** — the teacher's own chart tool — rather than only by the
transcript sentence it was extracted from. This is the first fact in this campaign confirmed
by two genuinely non-overlapping sources.

---

## 2. THE STRUCTURAL RELATION (§5's actual proof target)

| | STOP-A | STOP-B |
|---|---|---|
| direction | SHORT | LONG / BUY |
| stop side | **above** entry | **below** entry |
| stop vs the FVG rectangle | beyond its **upper** edge | beyond its **lower** edge |
| teacher's words | *"bottom of the fair value **candle**"* + include wick | *"low of the fair value **gap** … including the wick"* |

**Both charts are consistent with ONE direction-aware rule:**

> the stop sits **beyond the FVG/candle extreme on the protective side**, wick-inclusive —
> upper extreme for a short, lower extreme for a long.

That is exactly the symmetry AR-1208 §5 named as the proof target.

---

## 3. 🛑 WHAT THIS DOES **NOT** SETTLE — AND THE TENSION IT SHARPENS

**The teacher's WORDS and his SHORT CHART still disagree.**

At `00:12:44`, during the **short**, he says *"put it at the bottom of the fair value candle"*
— yet the tool places that stop **above** entry. His words match the **long** example
(`00:17:03`, *"the low of the fair value gap"*), which is genuinely a low-side stop.

So: **his two charts agree with each other under a direction-aware rule; his short-example
wording does not agree with his own short chart.**

Consequences I am deliberately not resolving:

- whether `"bottom"` at 12:44 is a verbal slip, an ASR artifact, or a reference to a
  different object;
- whether the correct anchor is the **displacement/fair-value candle extreme**
  (`displacement_candle_low/high` → `fvg_displacement`) or the **FVG gap boundary**
  (`fvg_low/high` → generic `fvg`). At this zoom the stop line and the rectangle edge are
  close enough that I will not call it, and calling it wrong puts a stop on the wrong level.
- ⚠️ AR-1138 §3.2 left `displacement_candle_high` **fail-closed for want of short-side source
  authority**. This paired evidence is the first material bearing on that gap — but it is
  visual, and promoting it to source authority is a ruling, not a worker call.

**`fvg_low` still must not compile as generic `fvg`. Short-side symmetry stays fail-closed.**

---

## 4. AN INSTRUMENT I BUILT, DISTRUSTED, AND DISCARDED

I attempted a pixel measurement to place the stop line against the FVG edge and candle
extremes by colour-masking the position-tool zones. **It returned `STOP-A = LONG`** — flatly
contradicting the tool's own label, which reads `Stop:` at the top.

Cause: the grey threshold matched the chart background and UI chrome, so the "stop zone" mask
spanned rows `2..1065` at full width — it measured the page, not the tool.

**I discarded it rather than tuning it until it agreed with me**, and nothing in §1–§3 rests
on it. Everything above comes from rendered label text and the visible band order. The
un-measured consequence is honest: **I cannot give a tick-accurate stop level, only the
side and the qualitative relation to the rectangle.**

---

## 5. REPRODUCTION

```bash
python -m yt_dlp --skip-download --write-auto-sub --sub-lang en --sub-format vtt \
  -o "svkm.%(ext)s" "https://www.youtube.com/watch?v=sVkmZklJDHI"
python -m yt_dlp -f 137 -o "hi.%(ext)s" "https://www.youtube.com/watch?v=sVkmZklJDHI"
ffmpeg -y -ss 00:12:55 -i hi.mp4 -frames:v 1 h_00-12-55.png
ffmpeg -y -ss 00:17:14 -i hi.mp4 -frames:v 1 h_00-17-14.png
```
