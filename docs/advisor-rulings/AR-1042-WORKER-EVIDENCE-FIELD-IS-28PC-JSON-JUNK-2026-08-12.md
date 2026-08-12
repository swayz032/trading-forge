# AR-1042 — WORKER — **THE `evidence` FIELD IS 28% JSON JUNK: INLINE TEACHER PROSE IS ≤302, NOT 911 NOR 1214** · AND A CORRECTION TO MY OWN AR-1041 §1a

```
RULING : AR-1039 (gpt-rulings e714b966) §5 -- "continue through the remaining ORB
         teachers until all 16 are dispositioned". Read-only continuation.
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
PRIOR  : AR-1041 (69ae8749) -- transcript store found; strawman-trigger STOP.
```

**Why I did not wait for a ruling on AR-1041:** AR-1039 §5 already says *"If none yields a faithful
executable setup, continue through the remaining ORB teachers until all 16 are dispositioned."*
None of the four yielded one, so that clause is live. **AR-1041 §8 ask 3 asked GPT to authorize
what §5 had already authorized — that was a `[prior-art-check]` failure on my part and I withdraw
it.** §11's STOP blocks *mutation*; it does not block reading.

---

## 1. 🛑 THE CORRECTION — AND IT IS THE THIRD TIME THIS NUMBER HAS MOVED

**Population matched EXACTLY to AR-1039/AR-1040: `entry_conditions[]` only, 40 videos = 2150
values.** Before claiming anything, I reproduced **both** prior instruments on it:

```
POPULATION: entry_conditions[] only, 40 videos  -> 2150      (both prior ARs report 2150)

  anchored T- match   (AR-1039's method)  : 936     <- reproduces AR-1039 EXACTLY
  contains T- ref     (AR-1040's method)  : 1239    <- reproduces AR-1040 EXACTLY
  PURE JSON PUNCTUATION                   : 609     <- counted as PROSE by BOTH
  empty                                   : 0
  ACTUAL inline teacher prose             : 302
```

★ **I reproduce both published figures exactly, so the difference is not instrument drift — it is a
category both instruments lacked.** Both classified by *"does it match a `T-` pattern? no ⇒ prose"*.
**609 values are neither: they are the literal strings `},{` and `{}`.**

| | AR-1039 | AR-1040 | **MEASURED HERE** |
|---|---|---|---|
| transcript-span refs | 936 | **1239** | 1239 ✅ |
| inline teacher prose | 1214 | **911** | **≤302** |
| JSON punctuation | — | — | **609** |
| empty | 0 | 0 | 0 ✅ |

⚠️ **`302` IS AN UPPER BOUND, NOT A COUNT.** The shortest surviving "prose" values include
`{0:1}`, `{0141}`, `{0247}`, `{0611}` and the bare word `here` — more residue my punctuation regex
did not catch because it contains digits. **The true inline-prose figure is lower than 302; I am
not publishing a precise one because I have not enumerated the residue encodings**
(`UNENUMERATED` — `[unenumerated-ladder]`).

**Distribution: 669 junk values across 39 of 40 videos** (2351 total including `and_groups` /
`or_branches` / `invalidations`; 609 of them inside the 2150 `entry_conditions` population above —
the two numbers are different populations, stated so they are not confused).

### 1a. WHY THIS IS LOAD-BEARING AND NOT BOOKKEEPING

AR-1039 §4's instruction to the next worker — **"read `evidence`, not `object`"** — rests on
`evidence` carrying the teacher's words. **Measured: it does so in ≤302 of 2150 cases (≤14%), is a
transcript reference in 1239 (58%), and is corrupt JSON in 609 (28%).**

⇒ **`span` is not a convenience. It is the only reliable access path**, which is why AR-1041 §1a
matters more than it appeared to. A seat following AR-1039 §4 literally, without `span`, would read
`},{` for roughly one condition in four and could easily conclude the teaching was lost — **which
is the exact false finding AR-1039 §2 caught itself making by a different route.**

---

## 2. CORRECTION TO MY OWN AR-1041 §1a — I OVER-SCOPED IT

AR-1041 §1a said *"Every condition — inline-prose or `T-` reference — resolves to the teacher's
exact words by `transcript_text[start:end]`"*, on controls run over **5 videos**. **That claim was
broader than its evidence.** Measured over all 40:

```
SPAN-VALID 21 / WEAK 17 / flagged 2   (positive >=70% AND >=40pts over its own negative control)
positive rate range: 20%..88%   negative control: 0%..24% (median ~4%)
```

**What survives:** the negative control is near zero everywhere, so span resolution is
**mechanistically real, not coincidence** — spans do point at the right region. **What does not
survive:** my implied "100%". The positive rate never reaches 100% because the metric compares the
**short `object` label's vocabulary** against the slice, and labels are often paraphrase rather
than extraction. **So the positive rate measures LABEL-TO-QUOTE WORD OVERLAP, not span validity** —
a weaker instrument than AR-1041 implied.

### 2a. ★★★★★ AND MY CONTROL PRODUCED A FALSE `SPAN-INVALID` — CAUGHT BEFORE PUBLISHING

`VTEQ2fhGLqE` scored **0% positive, 0% negative across 102 conditions** and my harness labelled it
**SPAN-INVALID**. I opened it instead of reporting it.

**The transcript is ARABIC** (78.5% non-ASCII, 61,176 chars). **The spans are CORRECT:**

| `object` (English) | `transcript_text[start:end]` (Arabic) | meaning |
|---|---|---|
| `timeframe` | `أستخدم إطارًا زمنيًا مدته 4 ساعات.` | "I use a 4-hour timeframe" |
| `breakout capture` | `أتفوق عندما أتمكن من التقاط الاختراق.` | "I excel when I can capture the breakout" |
| `price action relative to trend line` | `كسر السعر خط الاتجاه.` | "the price broke the trend line" |

⇒ **My control asked "do the English label's words appear in the slice?" — which for an Arabic
transcript is a question about LANGUAGE, not about SPAN.** `[i-measured]` in a fifth dress: **I
measured the neighbouring property again.** The video with the most perfectly demonstrable spans
scored worst on my instrument. ★ **`A CONTROL THAT CANNOT FIRE IN THE TARGET'S LANGUAGE IS NOT A
CONTROL, IT IS A LANGUAGE DETECTOR WEARING ONE'S NAME.`**

**Corrected verdict: `VTEQ2fhGLqE` is SPAN-VALID.** `jlShztsY3oA` (20%) is **Afrikaans** and is
almost certainly the same artifact; I have not confirmed it span-by-span, so it stays
`NOT ASSESSED`, not "invalid".

---

## 3. NEW: THE PRODUCTION LIBRARY IS NOT ALL ENGLISH

`MEASURED HERE` over all 40 archived transcripts:

- **`VTEQ2fhGLqE` — Arabic**, 78.5% non-ASCII, compiled as `breakout_capture_mcl_5m`.
- **`jlShztsY3oA` — Afrikaans** (Latin script, so it does not show in a non-ASCII sweep; found by
  reading its bound trigger: *"New York oop van 9:30 tot 9:45 Eastern Standard Time as die prys
  breek hierbo…"*).
- All 40 rows carry `source_provider = 'historical_extraction_cache'` — a single provider.

⚠️ **Consequence for AR-1039 §6:** "read the teacher's exact words" requires **translation** for at
least these two, and a translation is a new evidence hop with its own fidelity question. **Not
authorized, not attempted, reported.** ★ **A non-ASCII sweep finds Arabic and misses Afrikaans —
the second language is invisible to the instrument that found the first.**

---

## 4. ORB POPULATION — I CANNOT REPRODUCE `16`, AND I AM NOT ASSERTING IT IS WRONG

AR-1038/AR-1039 fix the population at **16 ORB videos by teacher prose**. My enumeration over the
same 40 transcripts, with the regexes stated in the source script:

```
says "opening range" or "orb"        :  7   [c8VL, oDLt, e5HQ, WV1f, deym, jlSh, dHmO]
>=3 ORB-ish signals                  : 12   (adds Qxlu, sVkm, xTTD, NMUd, 7ieY)
>=1 ORB-ish signal                   : 19
```

**None of my cuts equals 16.** `[i-measured]` — **a different regex is a different population, so
this neither confirms nor refutes `16`.** The ruling's `16` remains the authority; I flag only that
**no committed instrument reconstructs it**, which is the same gap
`[population-no-instrument]` records for the regression populations. **Recommend AR-1038's
enumeration be committed as a list of 16 video ids** so it can be joined instead of re-derived.
I am working the 12-video cut as a superset of the core 7.

---

## 5. DISPOSITION PROGRESS

**Dispositioned (AR-1041 §3, 4 sources):** `oDLt9zh33LE`, `e5HQXYBUW-Q`, `c8VLqF0XDR4`,
`deymRD3kSD0` — **all four NOT faithfully executable**, three by strawman-bound trigger, one
`SOURCE_AMBIGUOUS`.

**Fifth, partial — `xTTDH5iRhJc` (`entry_at_key_levels_mcl_5m`), controls PASS:**
- trigger `[2264-2425]`: *"We are simply going to enter the market at these two key levels, and
  we're going to do it **mechanically**, meaning that we can't trade this strategy **the wrong way**."*
- range = previous day high/low (liquidity resting above/below), **not** an opening range;
- breakout above/high or below/low, then *"if the price breaks out of the level, it will usually
  **retest** the breakout level"*; a close back inside = *"we don't have a confirmed breakout yet"*;
- session filter: *"only take the trade… first 2 and 1/2 hours of the market open"*; 5-minute
  execution timeframe; entry *"at the break of the candle"*, stop *"slightly above the high"*.
- **Polarity marker `wrong way` fires, but reading it shows the teacher using it to assert
  mechanical discipline, NOT to reject the rule** — ★ a marker is a nomination, and this one
  classifies the other way. **This is the positive control for my §6 marker sweep: it proves the
  sweep is not simply flagging everything.**
- **Disposition: PROMISING but NOT an opening-range strategy** — previous-day levels, not the
  session open. Whether it belongs in the ORB family at all is GPT's call.

**Not yet dispositioned: 7 of the 12** — `Qxlu8v_6G3Y`, `WV1fyudd7fw`, `NMUd0oX_7Pg`, `7ieYBa7Z-Hg`,
`dE4lPhAWke8`, `KXWRtV2LOVc`, `sVkmZklJDHI` (+ `jlShztsY3oA`, `dHmOosYof48` from the core 7).

---

## 6. WHAT I DID NOT MEASURE

- I did **not** enumerate the residue `evidence` encodings (`{0141}`, `{0:1}`, `here`), so `302` is
  an upper bound and I publish no precise prose count.
- I did **not** confirm `jlShztsY3oA`'s spans span-by-span; it is `NOT ASSESSED`, not invalid.
- I did **not** determine WHERE the `},{` corruption is introduced — extraction, serialization, or
  persistence. **That requires touching the extraction path and is not authorized** (§8).
- I did **not** re-run AR-1038's enumeration to try to reach 16.
- No production code was compiled, executed, or mutated.

---

## 7. THE ASK — ADDING TWO TO AR-1041 §8

5. **Rule on the `},{` corruption.** 609/2150 (28%) of `entry_conditions[].evidence` are JSON
   fragments across 39/40 videos. **I recommend this outranks the ORB selection question**: it is a
   silent data-integrity defect in the field the campaign was just told to read, it has now
   corrupted three published counts (1214 → 911 → ≤302), and locating it needs one bounded look at
   the extraction/persistence seam. **Not authorized under §8, so not touched.**
6. **Rule on the non-English sources.** `VTEQ2fhGLqE` (Arabic) and `jlShztsY3oA` (Afrikaans) cannot
   be read faithfully without a translation hop. Exclude from the ORB family, or authorize
   translation as an explicit evidence hop?

**AR-1041 §8 asks 1, 2 and 4 stand. Ask 3 is WITHDRAWN — §5 already authorized it.**

**Nothing blocking for the operator.** Engineering branch untouched at `0bbcabc8`.

---

## 8. SELF-AUDIT (§0-CTRL.4)

- **I over-scoped AR-1041 §1a** and corrected it here, in the same durable channel, rather than
  letting the stronger claim stand (§2).
- **My own harness produced a false `SPAN-INVALID`** and I caught it by opening the artifact instead
  of reporting the verdict (§2a). Had I trusted it, I would have condemned the one source whose
  spans are most clearly correct.
- **I asked GPT for permission I already had** (AR-1041 §8 ask 3) and withdraw it.
- **I reproduced both prior instruments before contradicting their numbers**, so the correction
  rests on a matched population rather than on a rival measurement (§1).
- **I published `302` as an upper bound rather than a count**, because I have not enumerated the
  residue — the precision I could have claimed is not the precision I measured.
```
ARTIFACTS (session scratchpad, regenerable, each carries its own controls):
  span_validity_all40.py · reconcile_orb_population.py · digest.py
  read_teacher.py · size_the_class.py · test_frame_on_teachers.py
```
