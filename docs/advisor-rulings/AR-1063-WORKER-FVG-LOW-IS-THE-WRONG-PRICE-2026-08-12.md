# AR-1063 — WORKER — **`fvg_low` IS THE WRONG PRICE.** The teacher's stop is a wick-inclusive **CANDLE extreme**; the catalog's `fvg_low` is a **GAP boundary**. Resolved from the raw transcript — **NOT a visual-evidence STOP**. A separate direction-literalism defect found.

```
RULING : AR-1059 (gpt-rulings 8e9ea5bc) SS4 UNIT B -- "the source-faithful caller must feed
         the exact FVG belonging to the qualifying setup"
SOURCE : C:\Users\tonio\Projects\trading-forge\backups\h1-shadow-eval\
         transcripts-78fe8ea7\transcripts\sVkmZklJDHI.transcript.txt  (25,071 bytes)
         [MEASURED HERE -- raw transcript, not the fixture copy]
STATUS : STOP on building the FVG producer. NOT a SS8.7 visual STOP -- see SS1.
IMPACT : invalidates an assumption inside my own committed UNIT A contract (93dfa18e).
```

## 1. 🛑 FIRST — I CORRECT MYSELF BEFORE THE RECORD HARDENS

I drafted this AR as a **visual-evidence STOP** under AR-1056 SS8.7 / AR-1059 SS8, claiming
*"which candle"* could not be resolved without the video. **The operator pointed out I had
the transcript.** I had searched only the worktree; it is in the primary tree under
`backups/`. **I withdraw the visual-evidence STOP. The transcript answers it and no video is
required.**

The underlying defect is REAL and is confirmed by the raw source — but it is a
**vocabulary/semantics defect**, not a visual ambiguity. `VisualEvidenceResolver V0` should
**stay parked**; I nearly triggered it on a question a file on disk already answered.
★ **`AN ABSENCE PROVEN OVER ONE DIRECTORY IS A CLAIM ABOUT YOUR SEARCH`** (`[fresh-worktree-
varies-nothing]`, re-earned here).

## 2. THE TEACHER'S TWO WORKED EXAMPLES, VERBATIM

**Example 1 — SHORT** (`short tool` @11057/13284/14554; `to the downside` @10052/10612/10912):

> *"...what I want you to do for the stop loss is we're just going to put it at the **bottom of
> the fair value candle**. Really simple. If this candle had a big wick, then you would also
> **include the wick**. **Don't just go to the body.** Please include the wick of the candle as
> well because it's very essential that you give your trade enough room to breathe."*

**Example 2 — LONG** (`to the upside` @18166/18261; *"ready for a buy"*):

> *"We would put our stop to the **low of the fair value gap** would be just there **including
> the wick**."*

And his own definition of the GAP, same video:

> *"The fair value gap is just ensuring that the **high of candle one** in this instance does
> not overlap the **low of candle 3**."*

And of the CANDLE:

> *"...that means that this **second big candle** is no longer a fair value gap."*

## 3. WHAT IS NOW SETTLED — AND IT REFUTES THE ANCHOR WE ARE USING

### 3.1 The anchor is a CANDLE extreme, wick-inclusive. MEASURED, twice.

The teacher uses *"fair value candle"* and *"fair value gap"* **interchangeably** for the stop
anchor. That looks like it reopens the question — **it does not**, because the invariant across
both phrasings is **"including the wick"**.

★ **A GAP BOUNDARY HAS NO WICK TO INCLUDE.** By his own definition the gap is
`high(candle 1) <-> low(candle 3)` — those *are* wick tips; there is nothing to add or omit,
and *"don't just go to the body"* would be meaningless. The wick qualifier is only a decision
on a **candle's** extreme. So even when he says *"gap"*, he means a wick-inclusive candle
extreme.

### 3.2 The committed catalog defines the opposite

`src/agents/kb/indicator-catalog.md:668`:

```
| `fvg_low` | "bottom of the fair value gap", "FVG low", "lower boundary of the imbalance" |
```

`src/engine/indicators/fvg_native.py:88-93` implements exactly that — `FVGZone.lower =
high[i-2]`, `upper = low[i]` — the **gap band**, and `FVGZone` exposes **no candle extreme at
all**.

⇒ **`anchor=fvg_low` (what AR-1052 measured the extractor emitting) resolves to a price the
teacher did not teach.** He anchors to the middle candle's wick extreme; `fvg_low` is the
imbalance boundary. **Two different prices, and the wrong one is tighter** — for a bullish FVG
the middle candle's low sits at or below `high[i-2]`, so anchoring to the gap boundary produces
**premature stop-outs on setups he would still have been in**.
⚠️ `[HYPOTHESIS, GEOMETRIC]` on the *direction* of that error — the `low[i-1] <= high[i-2]`
relation is the typical displacement shape, not something I measured over sVkm bars. **The
candle-vs-gap distinction itself is MEASURED and does not rest on it.**

### 3.3 Which candle: the SECOND one

*"this second big candle"* is the one he calls the fair value gap/candle. Entry is *"on the
closure of that third candle"*. So the anchor is **candle 2 of 3** — the displacement candle —
extreme **including wick**: `low[i-1]` long-side, `high[i-1]` short-side.

## 4. 🛑 THE NEW DEFECT — DIRECTION LITERALISM

**Example 1 is a SHORT, and he says the stop goes at the "bottom" of the candle.**
A short's stop must sit **above** entry. Taken literally that is incoherent.

Example 2 (a LONG) says *"the low ... including the wick"* — which **is** correct for a long.

So the taught wording is **"bottom"/"low" in both directions**, and it is only correct in one.
Read literally, `anchor=fvg_low` is **direction-blind** and wrong for every short.

**Three readings, and I am not choosing between them:**
1. He misspoke / ASR error in the short example, and the rule mirrors (short -> candle HIGH).
2. He teaches the rule once in long-terms and expects the student to mirror it — consistent
   with the campaign's existing `[direction-both-mirror-not-a-gap]` finding.
3. Something visible on the chart disambiguates — **this** is the part that could justify the
   visual lane later, though I do not think it is needed.

**One protective consequence, already committed:** my UNIT C wrong-side check
(`d894f2e3`) **raises `SourceAnchorUnresolved` rather than executing** when a commanded anchor
lands on the wrong side of entry. So a literal `fvg_low` on a short **refuses loudly** instead
of silently placing an inverted stop. That was written for a different reason and happens to
catch this. **It is not a fix — it is a guard that will now fire.**

## 5. WHAT THIS DOES TO COMMITTED WORK

- **UNIT B / C / D / E remain correct.** They are transport, command, arithmetic and mode
  separation; none decides *which price* the anchor is. Buffer removal, refusal behaviour,
  fixed-R math and the overlay exemption are unaffected.
- **UNIT A's `fvg_low -> required_anchor:"fvg"` mapping is WRONG** and I am flagging my own
  work: it routes the teacher's candle extreme to `nearest_fvg_below`, which the resolver
  treats as a gap-band level. `source-risk-contract.ts` needs a candle-extreme anchor concept,
  not the gap anchor.
- **Nothing executes yet**, so no wrong stop has ever been produced. `SYSTEM-INVENTORY` still
  shows the new symbols with no non-test callers. **The defect is caught before it can trade.**

## 6. WHAT I DID NOT DO

- I did **not** build the producer — it would have required committing to `fvg_low`.
- I did **not** edit the catalog or the extractor vocabulary. Both are committed source-semantics
  contracts; changing what `fvg_low` means is a ruling, not a worker cleanup.
- I did **not** re-run the extractor to see which span it attached.
- I did **not** verify the transcript file is the same artifact as the DB's
  `transcript_text` (`[teacher-words-via-span]` names the DB as authority). It is a **file on
  disk in the primary tree**, `[ARTIFACT-SOURCED]`, and its wording matches the fixture my
  predecessor measured in AR-1055 — two independent copies agreeing — but I have not joined it
  to the DB row by hash.

## 7. RECOMMENDATION

1. **Rule that the sVkm stop anchor is the displacement candle's wick-inclusive extreme**, and
   either redefine `fvg_low` for this teacher or mint a distinct anchor (e.g.
   `fvg_candle_low` / `fvg_candle_high`). **`FVGZone` exposes no candle extreme**, so the
   minimum producer needs the zone's candle indices either way — that is a small additive
   change to a frozen dataclass, not a new detector.
2. **Rule on the direction question** (SS4). It decides whether the compiler must mirror a
   direction-literal anchor or refuse it.
3. **Keep Visual Intelligence PARKED.** I nearly triggered it; the transcript sufficed.
4. **AR-1060 SS3 fork still open** (parity flag defaults FALSE, MES 6.0pt floor). Unchanged and
   still blocks execution.

**Nothing blocking for the operator. No capital, spend or irreversible action involved.**
