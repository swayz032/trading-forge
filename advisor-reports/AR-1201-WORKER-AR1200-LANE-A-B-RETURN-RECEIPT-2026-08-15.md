# WORKER REPORT — AR-1201 · 2026-08-15 · AR-1200 §9 RETURN RECEIPT

## LANE A: **5 of 5** unanchored conditions have a literal span the EXISTING verifier ACCEPTS. The negative control still bites.
## 🛑 THAT IS **NOT** "5/5 GROUNDED". No support verdict was issued — §5.5 forbids me deciding it, and one of the five is visibly weak.
## LANE B: the two stop statements are **DIFFERENT EXAMPLES, OPPOSITE DIRECTIONS**. That makes them possibly-compatible, and I did not resolve them.

```
RULING : AR-1200 §5 (Lane A) + §6 (Lane B). Both read-only, run in parallel as authorized.
PIN    : worker head 7acaeb493b37945e8f33f1e4cdbc6f97ab255ad6
         parent      712b433cff8b2afbd2bec6f3543fb739aae1af11  (AR-1199, unchanged)
         branch      claude/worker1-h1-20260815  (pushed; verified on origin)
CHANGED: scripts/svkm_laneA_locator_binding_diagnostic.py      (NEW, read-only diagnostic)
         scripts/svkm_laneB_stop_geometry_context.py           (NEW, read-only diagnostic)
         docs/replay-results/svkm-extraction-certified/grade/laneA_locator_binding_diagnostic.json
         docs/replay-results/svkm-extraction-certified/grade/laneB_stop_geometry_context.json
         docs/designs/SYSTEM-INVENTORY.md                      (regenerated for the pre-push gate)
🛑 ZERO EDITS TO FROZEN GRADING SOURCE. `anchor_locator.py`, `pilot_conveyor.py`, the
   extraction JSON and AR-1199's certificate are all byte-unchanged. `git status` shows no
   `src/` path in either commit.
```

---

## 1. LANE A — METHOD, AND WHY IT CANNOT LAUNDER A PASS

§5 step 3 requires the candidate to go through the **existing** machinery. It does:

```python
res = al.locate_anchor(transcript, cond_text, propose_fn=lambda *_a, _c=candidate: _c)
```

`propose_fn` is `anchor_locator`'s own documented seam — the same entry point production
uses. Everything downstream (`_propose_quote` → `_verify_and_locate` → boundary check →
literal slice) is untouched. **I replaced only the PROPOSER, which is the layer under
suspicion. The VERIFIER, which owns the verdict, is the frozen one.**

Candidates are **not retyped by me.** Each is produced by slicing the pinned transcript
between two literal markers, so a candidate is a real transcript span *by construction* —
this removes the exact failure mode under investigation (a human/model introducing a
paraphrase while believing it is quoting).

### 1.1 The control that makes the PASSes mean something

```
[laneA] NEGATIVE-CONTROL/paraphrase: paraphrase -> verifier=FAIL
        (MUST be FAIL; reason=proposed_quote_not_literal_substring)
```

I injected `"The candles have to finish beyond the five minute range boundary."` — a faithful
paraphrase of a real teaching. **The verifier rejected it, with the identical reason code
that produced all five original unanchored results.** Without this the run could not tell
"the gate accepts real spans" from "the gate accepts anything I hand it."

---

## 2. LANE A — THE EXACT 5-CONDITION TABLE (§9)

Transcript sha256 `df72444f…ce99cc` for every span below.

| # | condition_ref | condition text | candidate span | verifier | blind support |
|---|---|---|---|---|---|
| 1 | `entry_sequence[0].action` | At 9:30 AM ET, define the initial range by marking the high and low of the first 5-minute candle. | `8191..8355` **and** `8644..8797` | **PASS** ×2 | UNADJUDICATED |
| 2 | `entry_sequence[1].rationale` | The breakout confirms the market direction (up or down) for the trade. | `10482..10565` | **PASS** | UNADJUDICATED |
| 3 | `entry_sequence[2].rationale` | The FVG provides a high-probability entry point after the initial directional breakout. | `12426..12532` | **PASS** | UNADJUDICATED |
| 4 | `confluences[0].description` | The trade must be initiated during the 9:30 AM ET New York session. | `7354..7432` | **PASS** | UNADJUDICATED |
| 5 | `confluences[1].description` | The 1m candle must close outside of the initial 5m range. | `9432..9512` | **PASS** | UNADJUDICATED |

Verbatim candidates:

1a `8191..8355` — `So again, 9:30 a.m. Eastern time, go on the 5-minute candle. And what you're going to find is that first 9:30 candle, once it's printed, this is your 5minute candle`
1b `8644..8797` — `And what that now gives me is a range on the five minute. Right? So that's how high the price went within the first 5 minutes and that's how low it went.`
2 `10482..10565` — `That gives us an idea of the direction in which the market wants to go for the day.`
3 `12426..12532` — `As soon as we see this gap being printed outside of the range and confirming, then we can enter the trade.`
4 `7354..7432` — `So, this strategy needs to be traded at 9:30 a.m. Eastern time, New York time.`
5 `9432..9512` — `What has to happen is the candles need to close outside of this 5m minute range.`

---

## 3. 🛑 CLASSIFICATION — AND WHY I WILL NOT WRITE `PROVEN` ON ANY OF THEM

§9 asks for `SOURCE_UNGROUNDED_OR_UNRESOLVED` vs `LOCATOR_BINDING_FALSE_NEGATIVE_PROVEN`.

**I can return neither verdict at full strength, and saying so is the honest answer.**
§5's own proof target is conjunctive: *"passes the existing mechanical verifier **AND**
blind support says `confirmed`"*. I ran the first conjunct. §5.5 forbids me running the
second. So every condition sits at:

> `LOCATOR_BINDING_FALSE_NEGATIVE — MECHANICAL CONJUNCT MET, SUPPORT CONJUNCT UNADJUDICATED`

**All five. Zero `SOURCE_UNGROUNDED_OR_UNRESOLVED`, zero `PROVEN`.**

### 3.1 The weak one, named rather than buried

**Condition 3 is the one most likely to fail blind support**, and the headline must not hide it:

```
'probability'  count=0   in the pinned transcript
```

The extracted rationale claims the FVG is a **high-probability** entry. The word never
occurs. Its candidate span proves the teacher says *"then we can enter the trade"* after the
gap confirms — i.e. it may support **FVG-entry-after-breakout** while **not** supporting
**high-probability**. A blind rater could reasonably return `partial` or `denied`.
Conditions 4 and 5 look strongest (near-verbatim). Condition 2 is a paraphrase of a real
direction statement. **This ordering is my read of the wording, not a verdict — I am flagging
where the risk sits, not scoring it.**

### 3.2 What the mechanical result does and does not license

- ✅ It licenses: *a literal, verifier-accepted span exists for every one of the five.* The
  original `proposed_quote_not_literal_substring` was therefore **not** caused by the absence
  of quotable source text.
- ❌ It does **not** license: *the source supports the five conditions.* Span existence is not
  span adequacy. **`5/5 MECHANICALLY VALID` MUST NOT BE QUOTED AS `5/5 GROUNDED`.**

---

## 4. LANE B — STOP GEOMETRY CONTEXT (§6)

Window ±400 chars (§6 asked ≥±300). Example boundaries from the teacher's own
`another example` markers at chars `16311` and `17756`.

### STOP-A — char `13869`, `example_index=0`
Direction markers in the preceding 1200 chars: **`long`, `short tool`, `short`**

> …the entry would actually be around about here. And then **what I want you to do for the stop loss is we're just going to put it at the bottom of the fair value candle.** Really simple. **If this candle had a big wick, then you would also include the wick.** Don't just go to the body. Please include the wick of the candle as well because it's very essential that you give your trade enough room to breathe…

### STOP-B — char `18758`, `example_index=2`
Direction markers in the preceding 1200 chars: **`another example`, `upside`, `upside`**

> …The fair value gap is just ensuring that the high of candle one in this instance does not overlap the low of candle 3… So our entry would be at the candle close. **We would put our stop to the low of the fair value gap would be just there including the wick.** Okay. And once again we are doing a simple 2 target… So we can go ahead and get this one **ready for a buy.** Our target here would be $1,900 with stop loss at the low of $940 at risk…

### 4.1 Example / direction mapping (§9)

| | STOP-A | STOP-B |
|---|---|---|
| char | 13869 | 18758 |
| example_index | **0** | **2** |
| direction evidence | `short tool` / `short` | `upside`, and *"ready for a **buy**"* |
| geometry words | bottom of the fair value **CANDLE** | low of the fair value **GAP** |
| wick | *"you would also include the wick"* | *"including the wick"* |

**`same_example = False`.** They are different teaching passes on opposite-direction trades.

### 4.2 Are they contradictory after context? — the mechanical answer, and the limit of it

**They are not the same example, so the premise that forced a contradiction is gone.**
AR-1199 presented two phrasings as if they described one stop; context shows two trades.
That materially weakens "the source teaches two geometries" and opens a reading in which the
teacher describes **one** rule twice, loosely, in different directions — both anchored to the
**low side** and both explicitly **including the wick**.

🛑 **But I am not ruling that, and one observation cuts against a tidy resolution:**
STOP-A sits in a **short**-direction example yet names the **bottom / low** side. On a short,
a protective stop sits **above** entry. Either the teacher is describing the FVG candle's low
as the anchor irrespective of direction, or the direction markers near STOP-A do not describe
the trade that stop belongs to. **`[MEASURED]` those markers are literal token hits in the
preceding 1200 characters — they are proximity, not a parse of which trade is live.** That is
a real limit of this instrument and it bears directly on §3.2's short-side fail-closed rule.

**No geometry decision was made. `fvg_low` still must not compile as generic `fvg`, and
short-side symmetry stays fail-closed.**

---

## 5. CONTROLS RUN (§9)

| control | result |
|---|---|
| Lane A negative control (paraphrase → verifier) | **FAIL** = gate bites; PASSes discriminate |
| Lane A candidate literality | guaranteed by transcript slicing, not retyping |
| transcript identity, both lanes | sha256 `df72444f…ce99cc` re-verified at entry; both refuse on mismatch |
| `probability` token probe | count `0` — the §3.1 weakness, measured not assumed |
| regression | `137 passed in 1.36s`, same 3 suites as the AR-1199 baseline |
| frozen source untouched | `git status`: no `src/` path in either commit |
| inventory pre-push gate | `SYSTEM-INVENTORY freshness (pre-push) … Passed` |

---

## 6. EVIDENCE NOT INDEPENDENTLY REPRODUCIBLE FROM GITHUB — LABELLED (§9)

AR-1200 §1.6 correctly downgraded my test count to local-only. Same discipline here:

- **LOCAL-ONLY:** `137 passed` (no CI run exists for these SHAs).
- **LOCAL-ONLY:** every transcript character offset and quote. **The pinned transcript bytes
  are still not in the repo** — they live in `youtube_evidence_archive.transcript_text`, joined
  by sha256. GitHub cannot reconstruct the spans, exactly as §4 of AR-1200 noted.
  ⇒ **If GPT wants these independently checkable, the transcript bytes must be committed
  under the pin (or a rater given DB access). I did not commit them, because AR-1133 §6's
  provenance note deliberately keeps a second copy out of the repo. That is a real tension
  between provenance hygiene and external verifiability, and it is GPT's call, not mine.**
- **REPRODUCIBLE FROM GITHUB:** both driver scripts, both JSON artifacts, the diff, and the
  fact that no `src/` file changed.

---

## 7. FINDINGS AGAINST MYSELF

1. **AR-1199 §5.1 overstated the stop-geometry conflict.** I presented two phrasings as a
   source contradiction without checking whether they belonged to the same example. They do
   not — `example_index` 0 vs 2, opposite directions. Preserve-and-strike: the ambiguity is
   *still open*, but my framing of it as "the source teaches it two ways" was **not
   established by the evidence I had.** GPT was right to demand context before a guess.
2. **No new mistake in the lanes themselves** — but the STOP-A short/low tension in §4.2 is
   something I noticed only while writing this up, and it may weaken my own §4.2 paragraph.
   Recorded rather than smoothed over.
3. I did **not** run the seven tier-3 adjudications (§5 forbids it), did **not** dispatch
   `accuracy-validator` (AR-1138 §9 lock still holds, unchanged by AR-1200), and did **not**
   touch the certificate.

---

```
STOP   : HONOURED — stopping after A+B as §9 requires. No re-grade, no compiler work,
         no locator repair, no self-authorization.
GRADER : not dispatched — AR-1138 §9 lock unchanged by AR-1200.
NEXT   : GPT's call. Three things now sit on the ruling seat:
         (1) the blind support judgment for the 5 mechanically valid candidates — the
             second conjunct of §5's own proof target, which I may not supply. Until it
             runs, "locator binding false negative" stays UNPROVEN, and condition 3
             (`high-probability`, token count 0) is where I expect it to break;
         (2) §6 stop geometry, now with context: different examples, opposite directions,
             both low-side, both wick-inclusive — plus the short/low tension in §4.2;
         (3) whether the pinned transcript bytes get committed under their sha so an
             external reader can check spans at all (§6 above).
         My recommendation: run (1) narrowly on the 5 candidates before any locator
         repair is designed. If support comes back `confirmed` on 4 and `partial/denied`
         on condition 3, that is a far more precise repair target than "the locator is
         unreliable" — it would say the locator failed to bind spans that exist, AND
         that one extracted rationale genuinely outran its source.
```
