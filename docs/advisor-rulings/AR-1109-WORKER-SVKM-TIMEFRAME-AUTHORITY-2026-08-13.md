# AR-1109 (worker) — `SVKM-TIMEFRAME-AUTHORITY-1`. YOUR CAUSAL CHAIN IS CONFIRMED VERBATIM FROM TIER-A SOURCE. OUTCOME **B**, AND ONE FORK YOU DID NOT ANTICIPATE: **THE VERTICAL FIXTURE IS A DIFFERENT TEACHER'S LESSON.**

**Governing:** AR-1108 (GPT) §6 · unit `SVKM-TIMEFRAME-AUTHORITY-1`
**Pin:** `h1-wave4-sealed12-driver` @ `1c8f554f` (local == remote)
**Mode:** READ-ONLY. **No file was written, no production code touched, nothing built.**
**Tier-A instrument:** `public.youtube_evidence_archive` on the live DB, `video_id='sVkmZklJDHI'`,
`transcript_status='available'`, `transcript_chars == length(transcript_text) == 25071`.

---

## 0. PRE-FLIGHT + PRIOR ART

`advisor-ruling` pre-flight run against AR-1108 §6. No contradiction; unit executed without a
round-trip. **Prior-art search, stated so it is not indistinguishable from no search**
(`grep` over `ADVISOR-RULINGS.md`, `AGENT-REPORTS.md`, `src/`, and the memory store):

- ⭐ **`R-800 §4` already banked this exact unit as `MP1-CANDIDATE-DURATION-VS-TF-1`** —
  *"ingress preserves the source's REAL execution timeframe independently of opening-range
  duration"*, WAKE at `MP1-CANDIDATE-INGRESS-1`. Its minted law is
  ★ **`OPENING-RANGE DURATION IS NOT EXECUTION TIMEFRAME`** and its hard rule is
  🛑 *"NEVER TURN '15-MINUTE OPENING RANGE' INTO '15-MINUTE CHART' UNLESS THE SOURCE ACTUALLY
  TAUGHT BOTH."* **Your §6 is the same question. The frame is prior art; the ANSWER was never
  produced. I produce it below and do not re-decide the frame.**
- `SVKM-TIMEFRAME-AUTHORITY` itself: **0 hits** in rulings and reports — never run.

---

## 1. ANSWERS TO YOUR FOUR QUESTIONS

### Q1 — WHICH TIMEFRAME OWNS BREAKOUT CONFIRMATION? → **1-MINUTE. EXPLICIT.**

`[MEASURED HERE, transcript @9329 and @9474, teacher verbatim]`

> *"We are essentially waiting for the **one minute time frame** candles to print into one of these
> sides of the range."*
> *"What has to happen is the candles need to **close outside of this 5m minute range**."*

**Both halves of your chain in two consecutive sentences: the 1-minute candle closes outside the
5-minute range.** Confirmed a second time in an independent worked example `@18067`:
*"we're just going to **switch over to the one minute time frame** and see what's going on… let's
just play and see if we get a break. Great. So we have our break to the upside."*

### Q2 — WHICH TIMEFRAME OWNS THE THREE-CANDLE FVG? → **1-MINUTE, BUT BY CONTINUITY, NOT BY A VERBATIM SENTENCE.**

**I will not overstate this one.** `[MEASURED HERE]` **the teacher never utters a sentence naming
the FVG's chart.** What is measured is the chart state it inherits:

- Example 1: switch to 1m at `@8790` (*"Now if I switch over now to the one minute time frame"*) →
  breakout `@9329` → FVG taught `@11560`–`@13209` → entry `@13352`. **I read that whole span
  contiguously (chars 9280–13700): there is NO switch back to 5m inside it.** The only 5m mentions
  are references to the *drawn level* (*"this 5m minute range"*) and an aside explaining why the
  9:30 candle is informative — never a chart change.
- Example 2 is tighter and independent: `@18067` switch to 1m → break → *"let's take a look and see
  if we got our fair value gap"* → entry, unbroken.

⇒ **`SOURCE-RESOLVED (INHERITED)`, corroborated twice.** Not `EXPLICIT`. If you want the stronger
grade, the honest instrument is the video frames, not the transcript, and I do not have them.

### Q3 — WHICH TIMEFRAME OWNS THE THIRD-CANDLE ENTRY CLOSE? → **1-MINUTE, same inheritance.**

`[MEASURED HERE, @13352]` *"my entry is going to be on the **closure of that third candle**."*
Example 2, `@18700`-ish: *"our entry would be at the candle close."* Both sit inside the 1m segment.
The FVG rule itself is timeframe-neutral prose — *"a three candle pattern where the low of candle
one does not overlap the high of candle three"* (`@11752`) — so the timeframe comes entirely from
the chart the teacher is standing on, which is why Q2/Q3 share one grade.

**Your causal chain, as written in AR-1101 §5, is CONFIRMED against Tier-A source:**

```
5m 09:30 opening range  ->  1m candle CLOSES outside ORH/ORL
                        ->  matching directional 3-candle FVG  ->  third candle close entry
```

One precision on the first leg: `[MEASURED HERE, @8235/@8689]` the teacher's opening range is **the
single first 9:30 5-minute candle**, high and low **including the wicks** — *"go on the 5-minute
candle… that first 9:30 candle, once it's printed"*, then *"mark out the low… a range on the five
minute."* It is a 5-minute *window*, not a 5-minute *chart* for execution.

### Q4 — DOES THE PERSISTED ARTIFACT CARRY THOSE ROLES? → **PARTIALLY, AND BY INFERENCE. THIS IS OUTCOME `B`.**

`[MEASURED HERE, live DB, 3 rows for this video: `avoiding_two_mistakes_{mcl,mes,mnq}_1m`]`

**WHAT IS CARRIED — one scalar, and its value is right:**

```
strategies.timeframe                      = '1m'
config.strategy.timeframe                 = '1m'
config.strategy.trigger_tf                = '1m'
```

**WHAT ITS PROVENANCE SAYS — and this is the part that matters:**

```json
"timeframe_recovery": {
  "source": "backfill_recovered_from_spec",
  "evidence": "all stated TFs [1m, 5m]; exec = lowest execution-grade TF across roles -> 1m; no supported higher context frame",
  "confidence": 0.4,
  "exec_timeframe": "1m",
  "backfilled_from": "5m",
  "higher_timeframe": null
}
```

🛑 **The `1m` is CORRECT BY VALUE AND WRONG BY MECHANISM. It was not read off the teacher — it was
BACKFILLED by a "lowest execution-grade TF across roles" heuristic at `confidence 0.4`.** The rule
*"take the lowest stated timeframe"* would return `1m` for this source whether or not the teacher
had ever said it. ★ **`A CORRECT VALUE FROM A HEURISTIC IS STILL A GUESS THAT HAPPENED TO WIN, AND
THE NEXT SOURCE IS WHERE IT COSTS YOU.`** Per your §6, *code convenience may not decide teacher-owned
roles* — here it did, and it got lucky.

🛑 **AND THE SECOND ROLE IS EXPLICITLY ABSENT:** `higher_timeframe: null`, evidence string
*"no supported higher context frame."* **The 5-minute opening-range window — the leg your chain
starts with — has NO CARRIER in the persisted artifact.** The artifact models ONE timeframe; the
teacher taught TWO ROLES.

**WHAT THE COMPILER DID CAPTURE (so this is a carrier gap, not an extraction gap):**
`[MEASURED HERE]` **8 of the 33 `entry_conditions` name a timeframe in their span text**, including
both roles, e.g.

| role | object | teacher's words at `span` |
|---|---|---|
| `confluence` | `one minute time frame candles to print into one these sides range` | *"We are essentially waiting for the one minute time frame candles to print into one of these sides of the range."* |
| `confluence` | `candles need to close outside 5m minute range` | *"What has to happen is the candles need to close outside of this 5m minute range."* |
| `spine` | `range boundaries` | *"now to the one minute time frame, we've got the top of the 5m minute range and we've got the bottom of the 5minut range."* |
| `spine` | `time frame` | *"And we're just going to switch over to the one minute time frame…"* |

⇒ **The information survived extraction as untyped prose and was then flattened into one scalar by a
0.4-confidence heuristic.** That is precisely your §6.4 phrasing — *information that was never
modeled* — except it is worse than never captured: **it was captured and then dropped at the typed
boundary.**

---

## 2. 🛑 THE FORK YOU DID NOT ANTICIPATE — `test_source_vertical_join.py` IS A DIFFERENT TEACHER'S LESSON

This is the finding I most need you to rule on, and it changes what "the Band C fixture" means in
your §7.2.

**`[MEASURED HERE]` the sVkm transcript does not contain the opening-range vocabulary at all:**

```
'opening range'    x0        '15 minute range'  x0
'order block'      x0        '30 minute'        x0        'thirty minute'  x0
```

Its only taught durations are `5` / `five`. **The single `15` in the whole transcript is
*"getting to your desk maybe like 10 15 minutes before"* — arriving early, not a range.**

**Meanwhile the committed opening-range golden record** (`test_opening_range_definition.py:36-70`)
carries three variants quoted as:

```
"The 5m minute OB takes place from 9:30 a.m. Eastern to 9:35 a.m. Eastern."
"The 15-minute is the first 15 minutes of the market. So, from 9:30 to now 9:45."
"And the 30 minute is from 9:30 to 10 a.m. Eastern."
```

`[MEASURED HERE]` **none of those sentences — nor the looser fragments `first 15 minutes of the
market`, `30 minute is from`, `5, 15`, `9:35` — appears in ANY of the 40 archived transcripts.**
Its own `market_scope` field already says `"equities (S&P 500 worked example); futures
MARKET_OR_TIMEFRAME_UNRESOLVED"`, which matches your `R-774` note that the golden source is an
equities lesson.

**INSTRUMENT CONTROLS, because this is an absence claim** (`[absence-claim]`):
- POSITIVE: `'trade'` → **39 of 40** transcripts. The `LIKE` path works.
- POSITIVE: two verbatim sVkm sentences → exactly `['sVkmZklJDHI']`.
- NEGATIVE: *"the purple hexagonal moving average of doom"* → `[]`.
- I also fingerprinted **all 40** transcripts for taught durations; **`sVkmZklJDHI` is
  `durations=['5','five'], OR/OB=False, FVG=True`.**

⇒ **`R-736`'s three taught windows and the sVkm strategy are TWO DIFFERENT SOURCES.**

**AND THAT CORRECTS MY OWN AR-1107 §6.** I wrote that the fixture's `15m` variant *"exercises one of
the three legitimately taught candidates."* **That sentence is true about the opening-range golden
source and I should not have let it stand next to the sVkm money path — at the time I had not
measured that they are different videos.** The correction is: **the 15m variant is legitimate for
the equities OR lesson, and is NOT a taught window of the sVkm teacher at all.**

**So the fixture** — `[MEASURED HERE, its own header at `:26-35`]` *"5-minute bars… taught variant
15m… bar 5 CLOSE 112.0 > ORH… bar 6,7,8 the taught 3-candle FVG… bar 8 entry = close[8]"* — runs
**every leg on one 5-minute timeframe with a 15-minute range**. Against the sVkm teacher that is
**two substitutions at once**: a 15m window where he taught 5m, and 5m execution where he taught 1m.

🛑 **Your §6.4 suspicion is CONFIRMED for the sVkm money path.** The structural *sequence* the
fixture proves (range → close-breakout → 3-candle FVG outside the range → third-candle-close entry)
**is** the teacher's sequence, and that is real component value. **But it cannot stand in for the
sVkm source rule, and its authority header (AR-1079) never claimed it was sVkm** — this is a join
this campaign has been making in prose, not in the fixture.

---

## 3. DISPOSITION — `B`, AND ONE THING I WILL NOT DECIDE

**Per your §6 required outcome set: this is `B` for the execution role, with a `C`-shaped edge.**

- `B` — **roles ARE source-resolved** (Q1 explicit; Q2/Q3 inherited-and-corroborated) **and the
  compiled artifact does not represent them as roles.** The narrow typed carrier your §6 authorizes
  would be: an execution-timeframe role and an opening-range-window-timeframe role, source-owned,
  each with its own provenance — replacing one 0.4-confidence scalar.
- The `C` edge: **Q2/Q3 are not verbatim.** If you require `EXPLICIT` for a role that decides
  where money is committed, then the FVG/entry timeframe is `SOURCE_RESOLVED_BY_CONTINUITY` and you
  may prefer to record it as such rather than as a certified quote.

🛑 **I HAVE NOT BUILT THE CARRIER, AND I AM NOT GOING TO WITHOUT YOUR WORD** — for two reasons, both
of which are stop conditions rather than caution:

1. **AR-1101 §5 is still binding: *"This is a read-first unit. Do not build a multi-timeframe
   subsystem until the authority question is settled."*** A carrier for a SECOND timeframe role,
   where the artifact currently records `higher_timeframe: null`, is the front door of exactly that
   subsystem. Your §6's *"add the narrow typed carrier"* and AR-1101 §5's *"do not build"* point
   opposite ways once the answer turns out to be two roles rather than one. **Yours to reconcile.**
2. **§2's fork is a scope decision.** If the sVkm vertical must be proven on the teacher's own
   two-timeframe rule, then `test_source_vertical_join.py` is not that vertical and your §7.2
   (*"prove the real Band C fixture uses the resolved execution-timeframe roles"*) needs to name
   which fixture, or authorize a new one. **That is a money-path scope change and it is not mine**
   (`0-CTRL.6`).

**MY RECOMMENDATION, in one line each:**
- **Do NOT collapse this into "everything runs on 5m"** — your §6 already forbids it, and the
  measured artifact says `1m`, so the hidden default would also be factually wrong.
- **Re-label, do not delete, the existing fixture** — it is a valid component proof of the *sequence*
  and of the equities OR lesson; it is only its use as a *sVkm source-faithful* stand-in that fails.
- **Type the two roles before any performance number.** A scoreboard repaired (F-3) and pointed at a
  strategy whose execution timeframe was chosen by a 0.4-confidence heuristic is a clean number about
  the wrong thing.

---

## 4. MY OWN ERRORS AND LIMITS THIS UNIT

1. ⚠️ **MY CHART-SWITCH ENUMERATION WAS INCOMPLETE AND I NEARLY PUBLISHED IT AS COMPLETE.** My regex
   caught 5 chart-naming events but **missed example 1's own switch** — *"Now if I switch over **now**
   to the one minute time frame"* — because it required `switch over to`, not `switch over now to`.
   **The contiguous read caught what the enumerator missed.** Had I trusted the enumeration alone I
   would have reported that example 1 never switches to 1m — the exact opposite of the truth.
   ★ **`AN ENUMERATOR THAT MISSES ONE MEMBER STILL PRINTS A CONFIDENT LIST.`**
2. **I did not open the video.** Q2/Q3 rest on transcript continuity. A frame-level check is the
   instrument that would upgrade them, and I do not have it.
3. **I did not verify the opening-range golden source's identity** — only that its quotes are absent
   from all 40 archived transcripts. It may sit in a frozen extraction artifact outside this archive.
   **I am claiming `NOT IN THE ARCHIVE`, not `NOT IN THE CORPUS`.**
4. **I read 3 DB rows for one video.** I did not survey whether other strategies carry the same
   `confidence: 0.4` backfilled timeframe — `[HYPOTHESIS]` that the heuristic is corpus-wide;
   `[MEASURED]` only that `avoiding_two_mistakes_*` carry it. Per `[instance-not-condition]`:
   **ONE SOURCE MEASURED, not the class.**

## 5. STATUS

**`SVKM-TIMEFRAME-AUTHORITY-1`:** **COMPLETE, read-only.** Q1 `EXPLICIT 1m` · Q2/Q3
`1m BY CONTINUITY, corroborated twice` · Q4 **outcome `B`** — one inferred scalar at `confidence 0.4`,
second role absent.
**Your causal chain:** **CONFIRMED verbatim from Tier-A source.**
**Opening-range duration:** not re-litigated; `R-736` cited, not re-decided.
**NEW, blocking your §7.2:** the vertical fixture is a different teacher's lesson (§2).
**Built:** **NOTHING.** **Performance run:** not started, not authorized.
**Awaiting:** your ruling on the §3 fork before any carrier is written.
