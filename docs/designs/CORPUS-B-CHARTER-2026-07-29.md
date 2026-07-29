# corpus_B CHARTER — what the re-extraction must capture differently

**Deliverable of R-424 item (1) (charter half) · R-409 scope item (c) · 2026-07-29**
**Status: CHARTER ONLY. No extraction run is authorized by this document.**

> **TREE — named before the first figure, per R-424 item (3).** Every number below was measured in
> `wt-preflight-blockers-20260729` @ `83efd34e`, whose `spec_family_bindings.py`,
> `spec_condition_compiler.py` and `spec_execution_preflight.py` are **sha256-identical** to
> `runtime-production` @ `a6f92822`, the checkout the tower executes. The three hashes were
> re-derived by this seat rather than inherited from R-424. **The campaign tree
> `wt-h1-wave4-20260712` was NOT used for any measurement here** — it is the 3.9× outlier and does
> not contain `spec_execution_preflight.py` at all.
>
> **INSTRUMENT.** The real `from_compiled_spec(...)` → `preflight_binding_plan(...)` pair called at
> `backtester.py:8493` and `:8509`. No reimplementation of either. DB access was SELECT-only under
> `SET default_transaction_read_only = on`; nothing was written to the DB, to `runtime-production`,
> or to any spec file. **[MEASURED] `backtests total = 0` at census time** — the standing stop
> condition, checked by this seat and not inherited.
>
> **POPULATION. `POP-120-LIVE`** — every row in the live `strategies` table carrying
> `config->'compiled_spec'`. **[MEASURED] overlap with `POP-16`/corpus_A = 0.** Nothing in this
> charter may be read as a statement about corpus_A or about `POP-41`.

---

## §1 — THE DENOMINATOR, CORRECTED BEFORE ANYTHING IS RANKED

`POP-120-LIVE` is **120 rows over 40 distinct videos.** Every video appears exactly **3×**, once per
instrument (`_mes_` / `_mnq_` / `_mcl_`), and **[MEASURED] all 40 triples carry BYTE-IDENTICAL
binding sets** (`condition_id · role · type · object · bindable · executed · reason`).

| figure | raw, per strategy row | **de-duplicated, per video** |
|---|---:|---:|
| refusals | 1368 | **456** |
| `no_recognized_session_keyword` | 1305 | **435** |
| population refusing | 120 of 120 | **40 of 40** |

★★ **The verdict is unchanged — 40 of 40 videos refuse — but every count this campaign has published
about the live library is inflated exactly 3× by the instrument fan-out.** A remediation plan sized
off `1305` would be sized off a number that contains each defect three times. **All figures below are
per-video; `strategies affected` = `videos × 3`.**

---

## §2 — THE INVENTORY: THE BIGGEST BUCKET IS NOT WHAT ITS LABEL SAYS

R-424 ordered that the 1305 `no_recognized_session_keyword` refusals not be treated as one defect.
**All 339 distinct rule texts were read — enumerated, not sampled.** The bucket is not a
session-vocabulary gap.

| remediation class | refusals | share | videos | strategies |
|---|---:|---:|---:|---:|
| `C8` non-executable annotation mis-typed as a condition | **233** | **51.1%** | 37 | 111 |
| `C2` recognized session / missing clock | 94 | 20.6% | 28 | 84 |
| `C3` unrecognized vocabulary → **EXISTING** primitive | 41 | 9.0% | 24 | 72 |
| `C7` malformed extraction | 30 | 6.6% | 15 | 45 |
| `C1` known concept / missing primitive | 19 | 4.2% | 11 | 33 |
| `C4` genuinely new vocabulary / ontology work | 18 | 3.9% | 11 | 33 |
| `C5` unsupported temporal or control-flow logic | 12 | 2.6% | 10 | 30 |
| `C6` unknown requiredness | 6 | 1.3% | 6 | 18 |
| `C9` **RESIDUAL — none of these** | 3 | 0.7% | 3 | 9 |

★★★ **More than half of everything blocking the operator's library is not a trading condition at
all.** `C8` is dominated by three shapes, all of which the extractor emitted as `entry_conditions`
and typed `WAIT_SESSION`:

- **chart-resolution declarations** — `'timeframe'` (28 videos), `'time frame'` (15), `'timeframe
  selection'` (9), `'daily time frame'`, `'4 hour chart'`, `'timeframe hierarchy'`, `'timeframe step
  1/2/3'`. A chart resolution is a **strategy parameter** — the backtester already passes
  `timeframe="5m"` — not a gate on entry.
- **instrument / symbol selection** — `'nq'`, `'es'`, `'crude oil'`, `'spy'`, `'netflix'`,
  `'ethereum'`, `'copper'`, `'eur usd'`, `'asset class'`, `'symbol selection'`. Scope metadata.
- **platform-workflow narration** — `'trading view location'`, `'trading panel selected'`, `'go to
  indicators'`, `'data collection'`, `'date selection'`, `'start up'`, `'end'`, `'live account
  trading'`, `'capital amount'`.

★★ **The genuine session gap — the thing everyone has been calling the bottleneck — is `C2` at
20.6%.** It is real and it is second, not first.

**`C9` RESIDUAL, named individually because a taxonomy without a residual forces mis-filing:**
`'market hours and fundamentals alignment'` (composite: session hours × fundamentals) ·
`'trading within range full day'` (composite: full-day window × range structure) ·
`'wait cleaner opportunity following day'` — ★ **an UNQUANTIFIED ADJECTIVE**, the defect class R-409
named on corpus_A (`"it shouldn't be choppy"`). **RECOMMENDATION: the taxonomy should gain a tenth
class for unquantified adjectives; today they land in RESIDUAL, which understates a known,
separately-ruled defect family.**

---

## §3 — THE UNLOCK ARITHMETIC: SEVEN OF NINE CLASSES UNLOCK NOTHING ALONE

A strategy is preflight-clean only when **every** refusal it carries clears, so per-term unlock
counts are misleading in isolation. Measured cumulatively:

| remediate | videos clean | strategies clean |
|---|---:|---:|
| `C1` alone · `C2` alone · `C3` alone · `C4` alone · `C5` alone · `C6` alone · `C7` alone · `C9` alone | **0** | **0** |
| `C8` alone | 2 | 6 |
| `C8` + `C3` | 5 | 15 |
| `C8` + `C3` + `C2` | 9 | 27 |
| + `C5` | 13 | 39 |
| + `C1` | 17 | 51 |
| + `C7` | 24 | 72 |
| + `C4` | 31 | 93 |
| + `C6` | 37 | 111 |
| + `C9` | 40 | 120 |

★★★ **Fixing the entire session-vocabulary gap — the largest-looking class by raw count — unlocks
ZERO strategies on its own**, because 37 of 40 videos also carry at least one `C8` refusal.
★★ **`C8` is the only class that unlocks anything alone, and it is an EXTRACTION-side fix, not an
engine fix.** That is the sequencing consequence, and it is measured rather than argued.

---

## §4 — WHAT corpus_B MUST CAPTURE DIFFERENTLY (the charter proper)

Ordered by measured blocking weight. Each item names the defect class it closes.

**(1) DO NOT EMIT NON-CONDITIONS AS `entry_conditions`. [closes `C8` — 233 refusals, 37 videos]**
Chart resolution, instrument/symbol, and platform narration must leave the condition graph. A chart
resolution belongs in the spec's `timeframe` field; an instrument belongs in its symbol scope;
narration belongs in a non-executable `annotations` array or nowhere. ★★ **Acceptance: a spec whose
teacher says "on the 4-hour chart, trading NQ" produces ZERO entry_conditions from that sentence.**

**(2) PRESERVE CLOCK PUNCTUATION — THE NORMALIZER IS DESTROYING THE ONLY FIELD A SESSION CLOCK
NEEDS. [closes part of `C7`]** ★★★ **[MEASURED] the corpus contains `'m eastern standard time'`,
`'9 30 m eastern standard time'`, `'10 00 m eastern'`, `'time 10 00 m'`, `'opening price at 10 00
m'` — while `'6 00 p m'` and `'eastern standard time to 5 00 p m'` survive intact.** The pattern is
consistent with a normalizer that strips punctuation and then drops the single-character token `a`
while keeping `p`: **`9:30 a.m.` → `9 30 m`, and the AM/PM marker — the one bit that distinguishes
09:30 from 21:30 — is gone.** ★ **This is a HYPOTHESIS about the mechanism, stated as one: I read the
damaged outputs, I did not read the normalizer.** Either way the requirement is the same:
**corpus_B must retain the verbatim source span alongside any normalized form.**

**(3) CAPTURE THE TRANSCRIPT. [makes the ledger's provenance column answerable at all]**
★★★ **[MEASURED] `transcript_chars` is ABSENT from all 120 rows** — the envelope carries
`binding_plan_summary · graph_canonical_hash · ledger_d · spec · spec_hash · video` and no
transcript. **R-424's stop condition — *"stop if the ledger cannot cite the SOURCE text for a
term"* — is therefore structurally unsatisfiable on this population, for every term, not for some.**
I did not stop, because the condition tests corpus_B's requirement rather than this ledger's
competence: the ledger cites the deepest text the artifact contains (the extractor's
already-normalized phrase) and grades the provenance column
`[UNANSWERABLE — NO TRANSCRIPT IN ROW]` rather than passing a normalized phrase off as the
teacher's words. **★ This is flagged for ruling: if the desk intends that stop condition to bind
literally, this deliverable is blocked until corpus_B carries transcripts, and no ledger over the
current artifacts can ever satisfy it.**

**(4) RE-TYPE THE MIS-TYPED CONDITIONS. [closes `C3` — 41 refusals, 24 videos, and it is the
cheapest real unlock]** `WAIT_SESSION` is functioning as a catch-all: **[MEASURED] 1329 of 1368
refusals carry it**, including `'moving averages'`, `'ema or exponential moving average'`, `'smas'`,
`'market structure'`, `'liquidity taken out'`, `'vwap trading blueprint'`. ★★ **These are not
session concepts and their primitives ALREADY EXIST** — `indicators/core.py:22 compute_sma`,
`:27 compute_ema`, `:271 compute_vwap_with_bands`, `:379 compute_anchored_vwap`,
`context/structure_engine.py:261 compute_structure_state`. **[MEASURED] `spec_family_bindings.py`
contains 0 references to `compute_sma`, `compute_vwap_with_bands` or `compute_anchored_vwap`.**
★★★ **This class is a ROUTING gap wearing a vocabulary gap's clothes — the detectors are built and
unwired, which is the same species R-408 found on corpus_A.**

**(5) FIX ROLE ASSIGNMENT — see §5. [closes the empty-spine hazard at its cause]**

**(6) QUANTIFY OR DROP UNQUANTIFIED ADJECTIVES. [closes `C9`]** Per R-409: a threshold the campaign
picks is the campaign's number, never the teacher's, and must be graded as approximation.

**(7) SESSION VOCABULARY + AN EVALUABLE WINDOW. [closes `C2` — 94 refusals, 28 videos]**
**[MEASURED] `SESSION_KEYWORDS` today holds 5 zones** (`london`, `ny_am`, `ny_pm`, `silver_bullet`,
`macro_window`) and `REFUSED_SESSION_KEYWORDS` holds 2 with no evaluable window (`overnight`,
`lunch_blackout`). ★★ **A vocabulary addition alone is NOT sufficient and must not be treated as
cheap: `'new york session'` spans both `ny_am` and `ny_pm`, so mapping it to `ny_am` would NARROW
the teacher's rule while reporting `approximation=False` — manufacturing exactly the false-exactness
claim the session-refusal release was built to stop.** Any new term needs a window in
`session_windows._ZONE_CHECKS` **and** the timezone/trading-calendar basis this campaign has carried
as `[UNENUMERATED]` since R-419.

---

## §5 — R-424 ITEM (2): THE EMPTY-SPINE ∩ `NEEDS_ARCHETYPE` JOIN, RE-DERIVED

**Join key = `strategy_id`. Second path:** AR-389 computed its census through `compile_binding_plan`
directly; this one drives `from_compiled_spec(...)`, the constructor the backtester actually uses,
and reads `lifecycle_state` from the same SELECT. **The claim reproduces.**

| the 3 empty-spine strategies | lifecycle | video |
|---|---|---|
| `6c755822-713d-48f9-867e-cf399722e69a` `5m_minute_support_level_mnq_5m` | **CANDIDATE** | `75DJN5UVQnw` |
| `97fabc41-f55b-4a20-a020-c28d6b7ffb54` `5m_minute_support_level_mcl_5m` | **CANDIDATE** | `75DJN5UVQnw` |
| `9f38ab7a-9a3d-4771-bdfb-13c1cd067536` `5m_minute_support_level_mes_5m` | **CANDIDATE** | `75DJN5UVQnw` |

`NEEDS_ARCHETYPE` rows are `5cd1ac73-…`, `89ac9dea-…`, `d2e71c2d-…`. **[MEASURED] intersection = ∅.**
★★ **One correction to how this has been described: these are not three independent strategies. They
are ONE video's spec, fanned out across three instruments** — the hazard is one spec, and the count
of exposed rows is three.

**★★★ THE CAUSE, WHICH THE BUCKET NAME DOES NOT CONTAIN.** The spec has exactly one `role=spine`
condition, and it is `'timeframe selection'` — a `C8` chart-resolution annotation, unbindable. Its
real entry logic sits under `role=trigger` (`'5m minute support level'`, `'15 minute support level'`)
and **binds fine** (`bindable=True`, `executed=True`, `primitive=spine_completion_trigger`).

★★★ **So the empty-spine hazard here is a ROLE INVERSION produced by extraction: an annotation was
labelled `spine`, the entry trigger was labelled `trigger`, and the preflight's spine test — which
counts only `role=="spine"` — found nothing executable.** Blocker (ii) catches it correctly. ★★ **It
is also live evidence bearing on R-423's second pinned promotion condition for `trigger`
(*"producer code showing it represents the entry event required for execution"*): in this spec the
`trigger` rows ARE the only executable entry logic. ★ I am not promoting anything on it — n=1 video,
and frequency is disqualified — I am recording it where the ruling seat can weigh it.**

---

## §6 — THE CEILING THIS CHARTER MUST NOT LET ANYONE FORGET

Remediating all nine classes makes `POP-120-LIVE` **preflight-clean**. It does not make it
**Phase-1 exitable**, and the gap is now quantified on the production population for the first time.

**[MEASURED, per-video basis, 2351 bindings over 40 videos]** 1896 bind · 455 do not ·
**1400 of the 1896 bound conditions carry `approximation=True`.** Only 496 are `approximation=False`,
and those 496 resolve to exactly **three** primitives:

| primitive | n | roles | types | what it is |
|---|---:|---|---|---|
| `spine_completion_trigger` | 245 | `trigger` ×245 | `ENABLE_ENTRY` 160 · `ENTER` 85 | the framework's own entry trigger — fires when the spine completes |
| `structural_stops.compute_structural_stop` | 224 | `invalidation` 189 · `trigger` 35 | `INVALIDATE` ×224 | the framework's structural stop |
| `provenance_only` | 27 | `spine` 26 · `trigger` 1 | `EXIT_HINT` ×27 | **`executed=False`** — never runs |

★★★ **Not one of the 496 concrete bindings is a taught market-condition detector.** They are
framework-owned entry/stop machinery — which Invariant 4 says is framework-owned by design — plus 27
rows that do not execute. **Every taught market condition that binds at all, binds APPROXIMATELY:
1400 of 1400.** ★★ **`0 of 155 bound_and_concrete` on corpus_A is not a corpus_A peculiarity; the
live library says the same thing at a different scale.** ★ And per R-425, approximate-but-bound
**passes the preflight** — so this ceiling is invisible to the guard by construction, and no refusal
count will ever surface it.

---

## §7 — WHAT THIS CHARTER DID NOT MEASURE

★ **[UNENUMERATED]** the timezone / trading-calendar basis — unchanged since R-419, and item (7)
above cannot be costed without it.
★ **[HYPOTHESIS, NOT MEASURED]** the AM/PM normalizer mechanism in §4(2): inferred from damaged
outputs, not read in the producer's code.
★ **[JUDGMENT, NOT MEASUREMENT]** the class assignment of all 456 refusals is MINE. The mechanical
pass nominated; I read every bucket and hand-corrected it. The full rule set and every override are
published in the ledger's generator so the assignment can be re-executed and disputed.
★ **[FUZZY BOUNDARY, NAMED]** ~8 `C2` members are arguably `C8` — `'preparation time'`,
`'time delay'`, `'trading duration limit'`, `'search start time'`, `'timezone'`, `'time zones'`,
`'trading duration'`, `'time duration'`. I filed them under the time domain; a reader who moves them
to `C8` changes `C2` 94→86 and does not change any unlock number, because both classes already
appear in those videos.
★ **[NOT MEASURED]** whether any `C3` route would bind `approximation=False` — §6 says the honest
prior is that it would not.
★ **[NOT MEASURED]** POP-16 / corpus_A under this taxonomy. Different population; not inferred.

## §8 — STOP CONDITIONS

★★★ `backtests total > 0` → **[MEASURED: 0]**, checked by this seat at census time.
★★ No refusal was softened, no role relabelled, no spec edited. **Nothing in §4 raises a pass count
by weakening the guard**; every item is an extraction-side or routing-side repair.
★ The transcript-citation stop condition is **flagged for ruling in §4(3)** rather than silently
satisfied.
