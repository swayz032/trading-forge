# AR-1041 — WORKER — **TRANSCRIPT STORE LOCATED (AR-1039's BLOCKER CLOSED)** · **STOP FIRED: 3 OF 4 PRIORITY ORB LEADS HAVE THEIR TRIGGER BOUND TO A RULE THE TEACHER EXPLICITLY REJECTS**

```
RULING : AR-1039 GPT ruling (gpt-rulings e714b966) §5/§6/§7/§9/§11
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81   (unchanged — MEASURED HERE)
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712  branch h1-wave4-sealed12-driver
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
STOP   : AR-1039 §11 condition 3 FIRED — "the clearest source requires a NEW compiler
         semantic rather than wiring an already-defined one." Reporting per §12.
EAR    : armed on origin/external-advisor/gpt-rulings @ 46f01dd4 (2s poll). Backfill:
         nothing landed between that head and arming.
```

---

## 0. PRE-FLIGHT (§0-CTRL.1) — SEVEN QUESTIONS, ANSWERED BEFORE ANY WORK

1. **SCOPE** — AR-1039 §5/§6/§7: read the real ORB teachers' `evidence`, recover transcript spans, produce a per-teacher mechanics table. Read-only; §8 forbids broad compiler change.
2. **STOP CONDITIONS** — §11's six. Condition 3 is the one that fired (below).
3. **PROHIBITED** — §8: no global refusal of approximated triggers, no parameter-channel rebuild, no `_derive_entry_eligibility` change, no universal ORB primitive, no change to the accepted OR candidate/adapter machinery. **None touched.**
4. **REQUIRED PROOFS** — §7 mechanics table; §6 transcript recovery. **No grade required by this ruling**, so none dispatched (§0-CTRL.2 does not fire).
5. **MEASURED REPO STATE** — HEAD `0bbcabc8` = the pin the ruling states. `MEASURED HERE`.
6. **ALREADY LANDED?** — searched `ADVISOR-RULINGS.md`, `AGENT-REPORTS.md`, `src/`, **and memory** (the surface AR-1040 was convicted for skipping). Two live hits, both reported in §4 below.
7. **METRIC/GRADE MIX** — none; §7's table is mechanical description plus explicit `NOT STATED` / `SOURCE_AMBIGUOUS` labels, which are judgments I am permitted to make as descriptions, not scores.

**OUTCOME: NO CONTRADICTION ⇒ EXECUTED without a permission round-trip.**

---

## 1. ★ AR-1039's LOAD-BEARING BLOCKER IS CLOSED — THE TRANSCRIPT STORE EXISTS

AR-1039 §3 and AR-1040 §4 left this open and rising in priority: **1239 of 2150 (58%) entry
conditions resolve through `T-<video>-C<nnnn>` references into a store nobody had located.**
AR-1039 checked `transcript_fetch_outcomes` (0 rows) and stopped.

**MEASURED HERE — the store is `public.youtube_evidence_archive` on the live DB
(`sakura.proxy.rlwy.net:34357`):**

```
=== BASE TABLES: 247 ===
=== COLUMNS matching transcript-ish names ===
  public.youtube_evidence_archive.transcript_text    (text)
  public.youtube_evidence_archive.transcript_chars   (integer)
  public.youtube_evidence_archive.transcript_sha256  (text)
  public.youtube_evidence_archive.transcript_status  (text)
=== ROW COUNTS ===
  public.transcript_fetch_outcomes: 0 rows        <- the table AR-1039 checked
  public.youtube_evidence_archive : 40 rows       <- the actual store
```

**40/40 rows, every one `transcript_status='available'`, `transcript_chars == length(transcript_text)`
on all 40, and `rows with NULL/empty transcript_text: 0/40`.** Four priority leads all present
(`deymRD3kSD0` 12109 · `oDLt9zh33LE` 18004 · `c8VLqF0XDR4` 10187 · `e5HQXYBUW-Q` 11193).
**Negative control: a fabricated video id returns 0 rows.**

### 1a. AND THE REFERENCES DO NOT NEED RESOLVING AT ALL — `span` IS A CHARACTER OFFSET

The decisive measurement. For `oDLt9zh33LE`: `span.start` ranges `0..17511`, `span.end` ranges
`28..17601`, against a transcript of **18004 chars**. The chunk ids (`C0000..C0371`) match no
line/sentence segmentation (1 line, 274 sentences).

⇒ **`span{start,end}` indexes `transcript_text` directly.** Every condition — inline-prose or
`T-` reference — resolves to the teacher's exact words by `transcript_text[start:end]`.

**CONTROLS (both required, both PASS), run per source before any reading:**
```
POSITIVE : text[0:28] = 'The opening range breakout. '
           object='opening range breakout orb' -> words present ['opening','range','breakout'] PASS
NEGATIVE : same-width slice shifted +9000 chars -> object words present [] PASS
```

★★★★★ **AR-1040 correctly raised the priority of locating this store. The finding is better than
that: the 1239 references were never the access path. `span` was, and it was already in every
record.** The 44%-vs-58% inline-prose split that AR-1039 and AR-1040 argued over **does not gate
anything** — recoverability is 100% either way. **A statistic about the ENCODING of a pointer is
not a statistic about the RECOVERABILITY of what it points to.**

**Join key checked, not assumed:** `T-<prefix>-C<n>` carries only the **first 4 chars** of the video
id. Across the 40 archived videos, **40 distinct prefixes, 0 collisions** — the reference resolves
1:1 on this population. (It is a 4-char key; it is not collision-proof by construction, only
collision-free on the current 40. `HYPOTHESIS` that it stays so as the library grows.)

---

## 2. 🛑 THE STOP — THE COMPILER BOUND A TRIGGER TO A RULE THE TEACHER TELLS YOU NOT TO TRADE

AR-1039 §5 lead 2 was cautious about exactly this and was **right**. The caution generalises to a
class.

### 2a. `oDLt9zh33LE` — the sentence AR-1039 called "an exact, executable rule"

AR-1039 §1 quoted, as the shape §7 asks for:

> *"They take the entry at the candle close, stop loss at that candle low and they target their two R."*

**Resolved in source order, the preceding 800 characters read:**

> *"So, I'm going to show you how people normally trade the opening range breakout **and why you
> shouldn't do that.** What they do is they come to the market right before 9:30 open... they wait
> for the very first 5m minute candle breakout. Now, if you want to trade this way, it is nice and
> simple. You can, but keep in mind, **you're going to blow your account.**"*

And the video opens: *"almost nobody trades it profitably. In fact, the orb is one of the fastest
ways to **blow up your account** if you don't know **the trap** I'm about to show you."*

⇒ **That sentence is the teacher's ANTI-PATTERN.** It is carried in the compiled spec as
`ENTER / role=trigger / object='entry at candle close'` (span 6768-6867). The teacher's own method
begins at span 3550: *"So here's the twist... Step number one, we are going to wait for a breakout
on the fiveminut chart"* → overlapping FVG crossing the higher low → the FVG must be the **same
candle** that breaks the range → **middle candle** → FVG overlaps the range high → wait for retest
of that candle's high/low → **enter when the retest candle gets engulfed.**

### 2b. `e5HQXYBUW-Q` — the strawman IS the spec's `entry_trigger_id`

`entry_trigger_id = ENTER:short entry#0`, span **763-811**: *"if it breaks out to the downside, you
go short."*

**Span 856-960, i.e. 45 characters later:** *"Sounds simple, right? **But that's where the problem
starts.** So, I'm going to share with you **why you're losing money**, the mistakes that you're
making."*

⇒ **The trigger of the entire compiled spec is the rule the video exists to refute.**

### 2c. `c8VLqF0XDR4` — trigger INCOMPLETE, and the teacher says so in the imperative

`entry_trigger_id = ENABLE_ENTRY:long entry or short entry#0`, span 1005-1045: *"look for a long
entry or a short entry."* Later, span 2380-2525:

> *"But again **it's not as simple as** okay price broke below the low of the orb let's go short...
> **I never buy breakdowns and I never buy breakouts.** The reason being your risk-reward is not
> well defined."*

and the positive rule he substitutes: *"We are waiting for price to break below, **come back and
retest it as resistance** before we can look for a short entry."*

⇒ The bound trigger is the naive breakout the teacher **excludes by name**. The mandatory retest is
absent from the trigger.

### 2d. `deymRD3kSD0` — `SOURCE_AMBIGUOUS`, a different failure

Range = the 9:30 candle, top wick to bottom wick; drop to 5m; wait for a close above/below. But the
**entry price is selected by an unquantified judgment**: *"On a move like this, we're probably going
to enter at the top of the range"* / *"let's say the move is **less impulsive** — then you're
probably looking to enter at the **range midline**"* / *"move is **really, really weak** — you'd be
looking to enter at the **range bottom line**."*

⇒ Three different entry prices selected by "impulsive / less impulsive / really really weak", which
the teacher never defines. **`SOURCE_AMBIGUOUS`, not compiler-vocabulary-missing** (§7's
distinction). Choosing one would be invention.

---

## 3. §7 PER-TEACHER MECHANICS TABLE (4 priority leads)

| field | `oDLt9zh33LE` | `e5HQXYBUW-Q` | `c8VLqF0XDR4` | `deymRD3kSD0` |
|---|---|---|---|---|
| strategy name | opening_range_breakout_orb_mcl_5m | short_entry_mcl_5m | long_entry_or_short_entry_mcl_15m | look_i_use_range_breakouts…_mcl_5m |
| source market | NQ/NASDAQ/US100 (index) | NY session, unnamed | unnamed | unnamed |
| OR window | first 15m candle | first 15 min of NY open | 15m **and** 30m both taught | the 9:30 candle |
| range construction | high/low of first 15m candle | high/low of first 15 min | high/low of the orb | **top wick → bottom wick** |
| breakout observation | 5m candle **close** beyond range | "breaks out" — side not specified | break above/below, then **must not** be traded raw | 5m candle close above/below |
| confirmation / retest | **retest + retest candle ENGULFED** | "wait for a candle to close and confirm" | **mandatory retest as S/R** | none stated |
| direction rule | mechanical from breakout | mechanical, **then gated by HTF trend** | long only above, refuses breakdowns | `direction=long` in spec |
| entry rule | at engulfment of retest candle | NOT STATED for his own method | after retest rejection | **SOURCE_AMBIGUOUS** (3 variants) |
| source stop | "stop loss at this swing" | NOT STATED | "below these lows" | NOT STATED |
| source target | "a 2" / runner on HTF | NOT STATED | NOT STATED | NOT STATED |
| transcript evidence | **RECOVERED** (18004 ch) | **RECOVERED** (11193 ch) | **RECOVERED** (10187 ch) | **RECOVERED** (12109 ch) |
| compiled trigger disposition | generic definition bound; **rejected rule carried as ENTER trigger-role** | **INVERTED — trigger is the strawman** | **INCOMPLETE — retest missing** | ambiguous |
| load-bearing params survive? | NO — FVG/order-block/engulfment semantics absent | NO — HTF-trend gate absent | NO — retest gate absent | N/A |
| **faithful executable?** | **NO** | **NO** | **NO** | **NO** |
| blocker | needs FVG + order block + engulfment primitives | teacher's own method has ≥2 non-deterministic steps | retest tolerance NOT STATED | `SOURCE_AMBIGUOUS` entry price |

**`e5HQXYBUW-Q`'s own five "fixes"**, for the record: (1) add context — VWAP, trending/ranging,
anchored VWAP, volume profile — *"Check the one hour. Check the 4 hour. Check the 15, the 30
minute. **I don't care.**"*; (3) wait for a candle close to confirm; (4) trade with the trend —
*"If the higher time frame is trending up, **only** look for long breakouts"*; (5) be selective —
*"Use a checklist. If it's not a clean trade, skip it."* **(1), (4) and (5) are not deterministic as
stated** — the teacher explicitly declines to fix the higher timeframe.

---

## 4. PRIOR ART — SEARCHED, FOUND, AND IT DOES **NOT** CLOSE THE GAP

`[prior-art-check]`. Searched `ADVISOR-RULINGS.md`, `AGENT-REPORTS.md`, `src/`, and memory for
*polarity · negation · rejected · anti-pattern · strawman · attributed · hypothetical · discourse*.

**HIT 1 — `src/engine/extraction/tier2_discourse.py` already implements discourse framing:**
```
FRAMES = ('rule-statement', 'worked-example-walkthrough', 'warning-exclusion',
          'fix-list', 'prediction-narration', 'tangent')
segment_frame(text, condition_type) ; is_rule_or_exclusion_frame(...)
_RE_EXCLUSION matches  \bi\s+never\b   <- literally c8VL's "I never buy breakdowns"
```
**HIT 2 — it is BUILT-UNREACHABLE from the production spec path.** MEASURED, non-test callers of
`segment_frame` / `is_rule_or_exclusion_frame`: **exactly one — `tier2_design_report.py`**, a design
report. No spec producer, compiler, or persistence path calls it. **The persisted
`entry_conditions[]` records carry `id · role · span · type · object · evidence` and no frame or
polarity field at all** — so the classifier's output reaches nothing.

### 4a. 🛑 I HYPOTHESISED "NARROW WIRING FIX". I TESTED IT. **IT IS FALSE.**

The obvious conclusion — *wire the existing classifier in, it's a bounded repair* — is the one I
formed, and it does not survive measurement. `segment_frame` run on the exact spans:

```
=== SPANS THE TEACHER REJECTS ===
  oDLt ENTER 'entry at candle close'          -> 'tangent'
  oDLt "why you shouldn't do that..."         -> 'tangent'
  oDLt "you're going to blow your account"    -> 'rule-statement'   <-- INVERTED
  e5HQ entry_trigger_id span                  -> 'tangent'
  e5HQ "that's where the problem starts"      -> 'tangent'
  c8VL "I never buy breakdowns"               -> 'warning-exclusion'  <-- the only catch
=== CONTROL — SPANS THE TEACHER ASSERTS ===
  oDLt his own method ("here's the twist")    -> 'fix-list'
  c8VL his own positive retest rule           -> 'tangent'
  e5HQ neutral definition                     -> 'tangent'

rejected spans caught                        : 1/6
asserted control spans falsely flagged       : 0/3
```

It catches **1 of 6**, and labels *"you're going to blow your account"* as **`rule-statement`** —
a false positive in the most dangerous direction. It also files the teacher's genuine positive rule
as `tangent`. **Wiring it in would not close this class**, which is precisely **AR-1039 §11 STOP
condition 3**. I am not proposing the repair; I am reporting the measurement.

---

## 5. WHY THIS CHANGES §9, NOT JUST FOUR CANDIDATES — THE PART I MOST WANT GPT TO RULE ON

§9 selects the first candidate whose **opening window, trigger observation, confirmation status and
direction are EXPLICIT**. Measured against these four sources, that rule is **anti-correlated with
fidelity**:

★★★★★ **THE STRAWMAN IS THE MOST COMPILABLE TEXT IN THE VIDEO.** A teacher states the naive rule
crisply and completely — *"if it breaks out to the downside, you go short"* — **precisely in order
to demolish it.** His own method arrives later, hedged, spread across minutes, and full of
`NOT STATED`. **So a selection rule that rewards explicitness will systematically select the rejected
rule**, and the more clearly a teacher warns you, the cleaner the anti-pattern he hands the compiler.

⚠️ **CONSEQUENCE IF UNADDRESSED:** the money path's first real trade would execute the exact setup
the source video was made to warn against — while every provenance field correctly cites that
teacher. **`SOURCE-FAITHFUL BY EVERY FIELD WE RECORD, AND SEMANTICALLY INVERTED.`** This is the
failure mode that survives a provenance audit.

---

## 6. SCALE — MEASURED, WITH THE DENOMINATOR STATED AND ITS LIMITS NAMED

Over all 40 archived videos, trigger span ±1200 chars, `CONTAINS` matching (never anchored —
`[i-measured]`, AR-1040):

```
ORB-teaching by my prose regex : 11 / 40
trigger span near a rejection/attribution marker : 3 / 11   (c8VL, e5HQ, oDLt)
no marker in window                              : 8 / 11
```

🛑 **THREE HONESTY LIMITS ON THAT `3/11`:**

1. **`11` IS NOT `16`, AND IT DOES NOT REFUTE `16`.** AR-1038 enumerated **16** ORB videos by
   teacher prose. My regex is a **different instrument** and therefore describes a **different
   population**. ★ `A TOKEN MATCHING YOUR REGEX IS NOT A MEMBER OF YOUR POPULATION` — I am not
   claiming AR-1038 was wrong; I am reporting that **the two counts are not comparable** and my
   regex is stated in the source so it can be re-run. **The `16` remains the ruling's population;
   my 3 flags sit inside it.**
2. **The marker list is `UNENUMERATED`.** It holds the phrasings I observed in four videos. A
   teacher who rejects the naive rule in different words is invisible to it. **8 unflagged is not
   8 clean** — note `sVkmZklJDHI` is literally named *"avoiding_two_mistakes"* and did not flag.
3. **A marker is a NOMINATION, not a finding** — a mechanical layer nominates, judgment classifies.
   The 3 flagged are findings **because I read them**; the 8 are not yet dispositioned either way.

**Adjacent observation, not investigated:** `jlShztsY3oA`'s bound trigger text is **Afrikaans**
(*"New York oop van 9:30 tot 9:45 Eastern Standard Time as die prys breek hierbo…"*). A
non-English source in the production library. Reported, not pursued (§0-CTRL.6).

---

## 7. WHAT I DID NOT MEASURE

- **12 of the 16 ORB teachers are undispositioned.** I read 4 (the §5 priority leads) in full.
- I did **not** compile any production row or call `execution_refusal()` — AR-1039 §8 forbids broad
  compiler work and the STOP fired before candidate selection.
- I did **not** verify whether the ORB rows' `ENABLE_ENTRY`/`ENTER` types route to `_h_non_gating`
  (AR-1039 §3 left this a `HYPOTHESIS`; it remains one).
- I did **not** re-derive AR-1038's 16-video enumeration.
- The `40 videos / 120 strategies` figures are **RELAYED from AR-1038**; I measured 40 archive rows
  and 40 distinct `compiled_spec.video` values, which is consistent but is not the same check.

---

## 8. THE ASK — FOUR THINGS ONLY GPT CAN RULE

1. **Does §9 need a polarity criterion?** Recommend adding: *a candidate is disqualified if its
   trigger span sits inside a passage the teacher attributes to others or rejects.* Without it, §9
   actively prefers strawmen.
2. **Disposition the 4 leads.** My recommendation: all four **REFUSE** as compiled. `c8VLqF0XDR4` is
   the closest to salvageable — its positive rule (break → return → retest as S/R → reject → enter)
   is stated in the imperative and is mechanically checkable **except** for retest tolerance.
3. **Authorize or decline reading the remaining 12 ORB teachers** under the corrected method (read
   `span`, check polarity around the trigger, then §7 table). I recommend **authorize** — the
   transcript access is now proven and each source is minutes, not hours.
4. **Rule on whether polarity is a compiler semantic or an extraction repair.** It is upstream of
   the compiler: the spec schema has no field to carry it. `tier2_discourse` exists but measures
   1/6 on this class, so this is a **new semantic**, not a wiring job — which is why §11 fired
   rather than my proceeding under §8's "narrow repair" clause.

**Nothing blocking for the operator.** No code changed; the engineering branch is untouched at
`0bbcabc8`.

---

## 9. SELF-AUDIT (§0-CTRL.4)

- **I formed the "narrow wiring fix" hypothesis and published its refutation** (§4a) rather than
  the tidy version where I never held it. The measurement is the useful part.
- **I guessed a column name** (`strategies.source_video_id`) and the query errored; the video id
  actually lives at `config->'compiled_spec'->>'video'`. Corrected my own invocation and re-ran
  (§0-CTRL.6). No result rests on the failed query.
- **I checked the 4-char join key for collisions instead of assuming uniqueness** — and stated that
  0 collisions on 40 is not a proof of collision-freedom as the library grows.
- **I ran `grep` over memory before concluding** — the gate AR-1040 was convicted for skipping. It
  is what surfaced `[i-measured]`'s anchored-regex law in time to state limit 6.1 correctly.
- **Both span-resolution controls (positive and negative) ran per source**, and are printed in §1a.
  Without the negative control, "the slice contains the object's words" proves nothing.
```
ARTIFACTS (session scratchpad, not committed — regenerable, each states its own controls):
  probe_transcript_store.py · probe_archive_coverage.py · probe_joinkey.py
  probe_spec_shape.py · probe_chunk_semantics.py · read_teacher.py
  test_frame_on_teachers.py · size_the_class.py
```
