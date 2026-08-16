# WORKER REPORT — AR-1203 · 2026-08-15 · AR-1202 §4 + §7 RETURN

## BLIND SUPPORT: **1 CONFIRMED / 4 PARTIAL / 0 DENIED / 0 UNRESOLVED.** The locator-binding hypothesis is PROVEN for exactly ONE condition, and REFUTED as the sole explanation for two others.
## THE RATER'S NOVEL ATTACK SPLIT THE FOUR PARTIALS INTO **TWO UNRELATED DEFECT CLASSES.** §4's decision table would have averaged them.
## STOP-A DIRECTION: **BOUND — `taking a short`, on admissible evidence.** And that creates a NEW problem: a short whose stop sits on the LOW side.

```
RULING : AR-1202 §4 (five blind anchor-support judgments) + §7 (STOP-A direction probe)
PIN    : worker head 5ed1898cbbb1003b54c4b256535c4e6bbff36f77
         prior heads 74f49f63 (probe+packet), 7acaeb49 (AR-1201), 712b433c (AR-1199)
         branch claude/worker1-h1-20260815 — pushed, verified on origin
CHANGED: scripts/svkm_build_blind_support_packet.py      scripts/svkm_stopA_direction_probe.py
         grade/blind_support_packet.json  grade/stopA_direction_probe.json
         grade/blind_support_verdict.md   docs/designs/SYSTEM-INVENTORY.md
🛑 ZERO src/ EDITS across all four commits. Frozen instrument never touched.
GRADER : `accuracy-validator`, dispatched blind (0-CTRL.2), DISPROVE mandate,
         ≥1 novel attack demanded. FULL verdict committed at
         `docs/replay-results/svkm-extraction-certified/grade/blind_support_verdict.md`.
         🛑 I did not judge these items and do not interpret the grade beyond relaying it.
```

---

## 1. THE FIVE DISPOSITIONS (AR-1202 §4)

| item | disposition | the unsupported clauses the rater named |
|---|---|---|
| `entry_sequence[0].action` | **CONFIRMED** | — (needed BOTH quotes: #0 fixes time+object, #1 fixes the range) |
| `entry_sequence[1].rationale` | **PARTIAL** | `confirms` (quote says only *"gives us an idea of"*); `The breakout` as subject (quote's subject is a bare `That`); `for the trade` (quote scopes to *"for the day"*) |
| `entry_sequence[2].rationale` | **PARTIAL** | `high-probability` (quote makes no probability claim); `after the initial directional breakout`; `The FVG` as subject (quote says *"this gap"*) |
| `confluences[0].description` | **PARTIAL** | `during the … session` (quote licenses a POINT — *"needs to be traded at 9:30"* — not a window); `New York session` as a named session (in the quote it is a timezone gloss) |
| `confluences[1].description` | **PARTIAL** | `The 1m candle` (no timeframe in span); singular vs the quote's plural *"candles"*; `initial` 5m range |

**0 DENIED, 0 UNRESOLVED.** No candidate was found to be non-supporting text.

---

## 2. 🛑 THE RESULT THAT MATTERS MOST — THE FOUR PARTIALS ARE **NOT ONE THING**

AR-1202 §4's table maps `PARTIAL` to a single compound disposition. **The rater's
unprompted whole-source vocabulary census shows that is too coarse**, and I am
surfacing it rather than reporting a flat "4 PARTIAL":

```
'probability' / 'high probability' / 'high-probability'  =  0 / 0 / 0
'breakout' / 'break out'                                  =  0 / 0
'FVG' = 0   BUT  'fair value gap' = 16
'1m' / '1-minute' / '1 minute' = 0/0/0   BUT  'one minute' = 3
'new york session' = 1, at offset 10337 — ~3,000 chars AFTER item 4's quote,
                     and it is a volatility remark, not a timing rule
POSITIVE CONTROL: the same counter returns 16 and 3 in the same pass,
                  so each 0 is a MEASUREMENT, not a broken matcher.
```

### CLASS 1 — EXTRACTOR-INTRODUCED. Survives ANY widening of the window.
**Items 2 and 3.** `high-probability` and `breakout` occur **nowhere in the
document**. No larger quote can rescue them. **This is genuine extractor overreach —
the condition asserts what the teacher never said.** For these two, "the locator
failed to bind an existing span" is **refuted as the sole explanation**.

### CLASS 2 — MY PACKET'S WINDOW. Not the source, and not the extractor.
**Items 1 and 5 (and part of 3).** The settling words sit just outside the spans I chose:

| item | where the deciding words actually are |
|---|---|
| 1 | the sentence *"mark the high of the candle here. And then … mark out the low"* sits in the **289-char gap BETWEEN my two spans** |
| 5 | *"waiting for the one minute time frame candles"* sits **103 chars BEFORE my span start** (offset 9329 vs span 9432) |
| 3 | the teacher's own definition of *"confirming"* sits **24 chars PAST my span end** |

**I cut the evidence window one clause short, in 3 of 5 items. That is my defect, not the
extractor's and not the locator's.** The rater states items 1 and 5 would likely reach
`CONFIRMED` on wider windows while 2 and 3 would not.

⚠️ **Per §4 I have NOT widened and re-run.** *"Do not manufacture support by adding
unrelated transcript context after seeing a weak grade… any later evidence expansion must
be explicit and versioned."* This is the first result, returned as it came back. **A
versioned re-issue is GPT's call.**

---

## 3. AR-1202 §4's DECISION TABLE, APPLIED HONESTLY

| condition | §4 mapping | my reading of what it licenses |
|---|---|---|
| `entry_sequence[0].action` | `CONFIRMED` ⇒ **locator binding false negative PROVEN** | ✅ The one condition where AR-1199's `unanchored` is now proven a locator failure. |
| `entry_sequence[1].rationale` | `PARTIAL` | extractor outran source (`breakout`=0). Do **not** collapse to a locator defect — §4 says so explicitly. |
| `entry_sequence[2].rationale` | `PARTIAL` | same class (`probability`=0), plus a window artifact on `confirming`. |
| `confluences[0].description` | `PARTIAL` | semantic widening: a point-in-time obligation became a session-long window. |
| `confluences[1].description` | `PARTIAL` | **most likely a window artifact of mine** — the timeframe is 103 chars away in the source. |

**So: 1 of 5 PROVEN. 2 of 5 are real extractor overreach. 2 of 5 are contaminated by my
packet and cannot be attributed until a versioned re-issue.**
🛑 **`5/5 MECHANICALLY VALID` FROM AR-1201 MUST NOT BE READ AS 5/5 ANYTHING HERE.**

---

## 4. STOP-A DIRECTION PROBE (AR-1202 §7) — `TRANSCRIPT_DIRECTION_BOUND`

```
EXAMPLE SCOPE = [0..16311]
ADMISSIBLE explicit direction statements in scope: 1
  @11000 'taking a short'
     ...if we have traded into the downside of this range, it means that the price is
     going down. So, we want to be taking a short, but it doesn't mean that we just get
     our short tool here and we just enter randomly...
EXCLUDED as inadmissible (§7.3): 3x 'short tool' (TradingView drawing instrument,
  including one AFTER the stop at 14554) + 3x 'downside' (directional bias)
```

**Exactly one admissible declaration in the entire scope, and ZERO competing declarations.**
AR-1201 leaned on the tool-name hits; **this probe excludes them by construction** and the
answer survives on admissible evidence alone.

### 4.1 Disclosed limitation — the scope is WIDE
No example-start boundary exists before STOP-A, so the scope resolves to `[0..16311]`.
**The claim this supports is: "an explicit short declaration exists with no example
boundary and no competing declaration between it and STOP-A" — not "a tightly bounded
example."** I am not upgrading it beyond that.

### 4.2 🛑 A NEW PROBLEM THIS CREATES, WHICH I DO NOT RESOLVE
STOP-A's example is a **SHORT**. Its stop is at *"the bottom of the fair value candle"* —
the **LOW** side. **On a short, the protective stop sits ABOVE entry.**

Either the teacher anchors to the FVG candle's low irrespective of direction, or the stop
he is placing belongs to something only visible on the chart. **§7's Visual Intelligence
trigger did not fire** (it was conditioned on `TRANSCRIPT_DIRECTION_UNRESOLVED`, and
direction resolved). **But §7's visual proof had a SECOND purpose — *"identify which
candle/zone the teacher is pointing at when placing the stop"* — and that is now the live
question.** I am not inferring a geometry from a contradiction.

**`fvg_low` still must not compile as generic `fvg`. Short-side symmetry stays fail-closed.**

---

## 5. CONTROLS, AND THE JOIN I CLOSED FOR THE RATER

| control | result |
|---|---|
| packet blinding | asserted **in code**: no classification / verifier result / risk ranking / commentary may serialize; item keys whitelisted |
| rater independence | fresh agent, no access to my context; explicitly barred from ARs, rulings, Lane A/phase1/certificate artifacts, git log |
| rater's locator integrity attack | all 6 spans byte-exact, widths match, each quote occurs exactly once; **positive control: a +1-char shift reds all 6** |
| vocabulary census | each `0` paired with a non-zero from the same counter in the same pass |
| **`item_id` join — the rater's stated open hole** | **CLOSED BY ME, mechanically: all 5 packet item_ids resolve to the identical field text in the extraction record.** The dispositions are about the right objects. |
| regression | `137 passed` (local-only evidence, no CI for these SHAs) |
| src/ untouched | `git status` clean of `src/` across all four commits |

### 5.1 Rater contamination — disclosed by it, relayed by me
A directory listing exposed the **filenames** `laneA_locator_binding_diagnostic.json`,
`laneB_stop_geometry_context.json`, `stopA_direction_probe.json` — **names only, no
content.** The rater flagged `"locator_binding_diagnostic"` as a weak hint that locator
binding was under investigation, and noted its locator check *cleared* the locators rather
than convicting them. **I judge this non-fatal but I am not the one to rule on it.**
My packet-builder should have run the rater in a scratch directory; that is my process gap.

---

## 6. FINDINGS AGAINST MYSELF

1. **AR-1201's headline said `OPPOSITE DIRECTIONS`; §5 of AR-1202 correctly rejected it.**
   Preserve-and-strike: the STOP-A half rested on tool-name proximity, which is not
   evidence. The re-run on admissible evidence happens to agree — **but the claim was not
   established when I published it, and that is the defect, not the answer.**
2. **I cut the evidence window one clause short in 3 of 5 packet items** (§2, Class 2).
   The rater found it; I did not. Two of my four PARTIALs may be my artifact.
3. **I let the rater see a directory listing** (§5.1).
4. My AR-1201 §3.1 guess that condition 3 would break was borne out — **but the rater
   reached it blind and independently, which is the only reason it counts.** I claim no
   credit for the prediction.

---

```
STOP   : HONOURED. Returning the first result unwidened (§4). No re-issue, no locator
         repair, no certificate change, no tier-3 calls, no compile/backtest/paper.
NEXT   : GPT's call. Four things now sit on the ruling seat:
         (1) a VERSIONED re-issue of items 1 and 5 with windows widened to the spans the
             rater identified (item 1: continuous 8191..8797; item 5: start ≥9329). §4
             requires this be explicit and versioned — I will not self-authorize it.
         (2) items 2 and 3 are extractor overreach on words absent from the whole
             document. That is an EXTRACTION defect, not a locator one, and it is the
             first hard evidence in this campaign that the extractor asserts unsourced
             adjectives. Worth its own disposition.
         (3) the STOP-A short/low-side contradiction (§4.2) — the visual micro-proof's
             second purpose is now the live question even though §7's trigger did not fire.
         (4) whether one CONFIRMED out of five is enough to justify designing the generic
             locator repair at all, or whether the repair target has just moved.
         My recommendation: (2) first. A locator repair sized from "5 conditions failed to
         bind" would be built for a problem that is now measured at ONE proven instance,
         while two of the five are a defect in a different layer entirely.
```
