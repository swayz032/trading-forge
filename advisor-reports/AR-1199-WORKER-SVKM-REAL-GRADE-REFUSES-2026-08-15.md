# WORKER REPORT — AR-1199 · 2026-08-15

## THE REAL sVkm GRADE RAN AND IT REFUSES. `certificate_grade=False`, 5 UNANCHORED / 7 UNRESOLVED / 0 OK. NOT CERTIFIED — STOPPING PER §6.
## AND ONE CORRECTION THAT IS OWED UPWARD: **AR-1138 §2.1's OWN QUOTED SPAN IS NOT A LITERAL SUBSTRING OF THE PINNED TRANSCRIPT.**

```
RULING : AR-1138 §4/§5/§6 (real pilot_conveyor grade authorized NOW) + AR-1140 §6
         (no redirect; resume and finish exactly where the worker stopped).
PIN    : worker head 712b433cff8b2afbd2bec6f3543fb739aae1af11
         tree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         branch claude/worker1-h1-20260815  (pushed; verified on origin)
         started from 5a82f6f51eeb0d6b47976f83a73cfa8446ca0013, clean
CHANGED: scripts/svkm_grade_phase1.py                      (NEW driver)
         scripts/svkm_grade_phase2_certificate.py          (NEW driver)
         docs/replay-results/svkm-extraction-certified/grade/phase1.json
         docs/replay-results/svkm-extraction-certified/grade/certificate.json
         docs/replay-results/svkm-extraction-certified/grade/phase1_preps.pkl
         docs/designs/SYSTEM-INVENTORY.md                  (regenerated for the pre-push gate)
         🛑 ZERO src/ FILES ADDED OR MODIFIED. The instrument was consumed, never edited.
```

---

## 1. IDENTITY GATES — BOTH HOLD, BOTH RED-PROOFED

The grading authority is the pinned transcript. It is deliberately **not** committed
(`PROVENANCE.md`), so I joined it from `youtube_evidence_archive.transcript_text`.

```
rows for sVkmZklJDHI: 1
non-empty transcript_text rows: 1
  [0] chars=25071 sha256=df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc match=True
negative control (1-byte mutation) matches pin: False
read-back sha256=df72444f...ce99cc match=True
```

```
[svkm] transcript chars=25071 sha256=df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc
[svkm] extraction_sha256=c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823
[svkm] strategies=1 instrument_classification=futures_primary
[svkm] extractor_version=gemma4:e4b-it-qat:minimal-8field-pass-l:content-157741d7cc760ea5
[svkm] taxonomy_version=h1-pilot-2026-07-12
```

**RED-PROOF of the refusal gate** (a mutated transcript must not be gradable):

```
$ python scripts/svkm_grade_phase1.py --transcript <1-byte-mutated>
[svkm] transcript chars=25071 sha256=4744def7adc9ff16cdb72f08a74d83a4b05586d2ff3328089464688c04dac4ad
[svkm] ABORT: transcript bytes differ from the pin — REFUSING (AR-1138 §5).
exit=2
```

`extraction_sha256` was verified **by its key** inside the record, not by the file hash.
The whole-file sha256 is `25bc0a5a…` — a different object; the pin covers the `extraction`
sub-object, `sort_keys=True` (`extractor_bridge.save_extraction:350`). `transcript_sha256`
and `provenance_class` live under `seed_params`, and both match.

---

## 2. WHY A NEW DRIVER, AND WHY THAT IS NOT "AUTHORING A SECOND ORACLE"

`scripts/h1_pilot_phase1.py` iterates `h1-sealed-fresh-set-2026-07-12.json` and writes into
the frozen `pilot-run/` population — which §4 and AR-1133 §6 forbid touching, and which would
put this run inside the sealed-exam apparatus. So the new driver runs **the same instrument
functions** (`pc.prepare_video` → `pc.finalize_certificate` → `pc.diagnose_certificate`) over
the one pinned extraction, importing phase 1's **own** `robust_propose` seam, `prep_json_view`
and `TAXONOMY_VERSION` **by import** rather than re-authoring them. No comparator, no oracle,
no second grading logic was written.

---

## 3. THE MEASURED RESULT — REAL RUN, `dry_run=False`, NO SYNTHETIC VERDICTS

```
[svkm] ROLLUP: {"spine_conditions": 12, "anchored": 7, "unanchored": 5,
  "tier1_classified": 0, "tier1_fallthrough": 7, "axis2_zero_content_overlap": 0,
  "axis3_audit_items": 0, "leak_scan_clean_all": true,
  "propose_abstain_by_parse_failure": 0, "tier3_targets": 7}
```

```
[svkm-cert]   pilot_grade      = False
[svkm-cert]   full_grade       = False
[svkm-cert]   certificate_grade= False
[svkm-cert]   dry_run          = False
[svkm-cert]   unanchored_count = 5
[svkm-cert]   conditions       = 12
[svkm-cert]   diagnosis        = {"unanchored": 5, "coverage_miss": 0,
                "classification_fallthrough_unresolved": 7, "tier3_fail": 0,
                "lint_fail": 0, "ok": 0}
```

`tier3_verdicts` was passed **EMPTY**. That is the ABSENCE of a verdict, not a manufactured
one: the 7 fall-through items require a real blind rater (stage-1 role + stage-2 support,
`h1_pilot_phase2_build.py`), and none has run. `dry_run` is `False` — I never set it.

**THE CERTIFICATE DOES NOT PASS. Per §6 I am stopping and reporting, not relabelling.**

### 3.1 The 5 unanchored conditions — exact field, exact reason

All five share one reason: `proposed_quote_not_literal_substring` (the locator's honest
decline — gemma proposed a quote that is not a literal span of the transcript).

| # | field | condition text |
|---|---|---|
| 1 | `entry_sequence[0].action` | At 9:30 AM ET, define the initial range by marking the high and low of the first 5-minute candle. |
| 2 | `entry_sequence[1].rationale` | The breakout confirms the market direction (up or down) for the trade. |
| 3 | `entry_sequence[2].rationale` | The FVG provides a high-probability entry point after the initial directional breakout. |
| 4 | `confluences[0].description` | The trade must be initiated during the 9:30 AM ET New York session. |
| 5 | `confluences[1].description` | The 1m candle must close outside of the initial 5m range. |

`anchored_fraction = 0.5833`. By field: `entry_sequence[].action` 3/1,
`entry_sequence[].rationale` 2/2, `confluences[].description` **0/2**,
`stop.rationale` 1/0, `targets[].rationale` 1/0.

**Rows 1 and 5 are exactly the card's dispositions #1 and #2.** Both are unanchored.

### 3.2 `tier1_classified = 0` is a real reading, and here is its decomposition

```
"outcome_counts": {"fallthrough_pending_tier3": 4, "fallthrough_dual_read_disagreement": 3}
```

Of the 7 anchored conditions, **3 were vetoed by the ADDENDUM-4 FIX-1 dual-read agreement
gate** (tier-1 on the located quote and on the condition's own text disagreed → honest
fall-through) and 4 carry no tier-1 surface at all. Nothing was suppressed; the non-drop
invariant holds: `12 = 5 unanchored + 7 fall-through`.

---

## 4. 🛑 THE CORRECTION I OWE UPWARD — §2.1's QUOTED SPAN IS NOT IN THE PINNED TRANSCRIPT

AR-1138 §2.1 states that the extraction contains material *"capable of proving the missing
fact"* and quotes it as:

> `That now gives me a range on the five minute. That's how high the price went within the first 5 minutes and that's how low it went.`

**`[MEASURED HERE]` that string does not occur in the pinned bytes.**

```
POSITIVE CONTROL — token that must exist: "the" -> 286
'AR-1138 quoted span'                   count= 0
'gives me a range'                      count= 0
'gives me is a range'                   count= 1
'how high the price went'               count= 1
NEGATIVE CONTROL (must be 0)            count= 0
```

The decisive pair is `gives me a range` = **0** against `gives me is a range` = **1**: the
ruling's citation and the real bytes differ by one word, and that one word is enough to fail
a literal-substring anchor.

The **real** bytes at char `8689` are:

> `And what that now gives me is a range on the five minute. Right? So that's how high the price went within the first 5 minutes and that's how low it went.`

Differences: `gives me **is** a range`, and `Right? So` sits between the two sentences.

⚠️ **This does not weaken the order** (`[order-premise-grade]`: a RELAYED premise does not
lower the ORDER's authority) — but it is load-bearing in a specific way: **§2.1's premise
quote fails the very literal-substring test the anchor-locator applies, which is the same
test that produced all five unanchored conditions.** The paraphrase-vs-verbatim gap the
ruling identified in the extractor is present in the ruling's own citation.

---

## 5. WHAT THE SOURCE ACTUALLY SUPPORTS — MECHANICAL SPAN LOCATION ONLY, NO ADJUDICATION

§2.3 makes the pinned span the authority and §2.1/§2.2 explicitly instruct the grader to
**locate** the real supporting span. I did that **mechanically** (literal substring search).
I am the doer; I am **not** ruling that these spans PROVE the conditions — that is the blind
rater's stage-2 judgment and I have not made it.

| § | required fact | verbatim span located | char |
|---|---|---|---|
| 5.2 | first-5-minute range | `And what that now gives me is a range on the five minute. Right? So that's how high the price went within the first 5 minutes and that's how low it went.` | 8689 |
| 5.3 | **close** vs print | `We are essentially waiting for the one minute time frame candles to print into one of these sides of the range. Now, what does that mean? What has to happen is the candles need to close outside of this 5m minute range.` | 9362–9474 |
| 5.5 | third-candle entry completion | `my entry is going to be on the closure of that third candle` | 13336 |
| 5.6 | stop geometry | `what I want you to do for the stop loss is we're just going to put it at the bottom of the fair value candle` | 13800 |
| 5.6 | stop geometry (second teaching) | `We would put our stop to the low of the fair value gap would be just there including the wick.` | 18714 |

**§2.2 RESOLVES IN THE SOURCE'S FAVOUR:** the teacher does explicitly require a **close** —
*"the candles need to close outside of this 5m minute range"* — at a span **different from
the one the extractor attached**. The extractor's paraphrase was right and its citation was
wrong. That is the honest finding; the condition is still UNANCHORED in this run because the
locator never bound that span.

### 5.1 🛑 §3 STOP GEOMETRY — I AM NOT RESOLVING IT. THE SOURCE USES BOTH PHRASINGS.

§3.1 asks whether the teacher means the FVG **displacement/fair-value candle extreme**
(`displacement_candle_low` → `fvg_displacement`) or the **generic FVG gap boundary**
(`fvg_low` → `fvg`). The transcript contains **both**:

- `13800` — *"the bottom of the fair value **candle**"* → candle extreme
- `18714` — *"the low of the fair value **gap** … including the wick"* → gap boundary

These are different geometries in the same source, taught about the same stop. §3 forbids
letting raw `fvg_low` silently command generic `fvg`, and equally forbids hand-editing the
JSON to force the prior answer. **I am doing neither.** This is a genuine
`UNRESOLVED_SOURCE_AMBIGUITY` and it needs GPT (§3.1's "if the path cannot resolve this
distinction from source evidence, STOP AND REPORT"). Short-side `displacement_candle_high`
remains fail-closed and untouched (§3.2).

---

## 6. CONTROLS

| control | result |
|---|---|
| mutated transcript → grade | **REFUSES**, exit 2 (gate bites) |
| unmutated transcript → grade | runs, exit 0 (control discriminates) |
| transcript positive control (`the`) | 286 occurrences — I am reading real text |
| span negative control | `zzqqxx-not-in-transcript` = 0 |
| DB round-trip | write→read-back sha256 still matches the pin |
| leak scan on the tier-3 packet | `clean = true` |
| `propose_abstain_by_parse_failure` | **0** — no unanchoring was caused by gemma transport/parse failure |
| regression | `137 passed in 1.36s` (same 3 suites as the start-of-task baseline) |

The `propose_abstain` count matters: it separates *"the locator declined because the model
misbehaved"* from *"the locator declined because the proposal was not literal."* It is zero,
so all 5 unanchored are the genuine literal-substring refusal.

---

## 7. FINDINGS — INCLUDING AGAINST MYSELF

1. **My first `diagnose_certificate` call was wrong** — I guessed a 1-arg signature; it takes
   3. `TypeError`, exit 1. I read the real signature and re-ran. The certificate values in §3
   are from the corrected run. Disclosed per `0-CTRL.4`.
2. **I first hashed the wrong object** — the whole extraction FILE (`25bc0a5a…`) instead of the
   `extraction` sub-object the pin covers. Caught by dumping all keys before concluding, per
   `[i-measured]`. No false mismatch was reported.
3. **I first read `transcript_sha256`/`provenance_class` at top level and saw `None`** and was
   ~1 step from reporting a provenance gap. They live under `seed_params`. Same near-miss class;
   caught by the same all-keys dump.
4. **AR-1138 §2.1's quoted span is not in the transcript** (§4 above).
5. **The source teaches the stop geometry two different ways** (§5.1) — unresolved, escalated.
6. `docs/designs/SYSTEM-INVENTORY.md` went STALE when I added two scripts; regenerated, and the
   `SYSTEM-INVENTORY freshness (pre-push)` hook **Passed** on the real push.
7. **Not done, and not claimed:** no blind rater ran, so no tier-3 role/support verdict exists;
   no `EXTRACTION_CERTIFIED` record was written; no compile, no `.spec.json`, no
   `source_timeframe_roles` carrier, no backtest, no trade. §9.2 remains OPEN.

---

## 8. WHY I DID **NOT** DISPATCH THE INDEPENDENT GRADER

`0-CTRL.2` pre-authorizes a grader dispatch *when the ruling requires one*. AR-1138 §9 does the
opposite — it lists `independent grader/performance/edge testing: 🔒 BLOCKED UNTIL THE ORDERED
GATES CLOSE`. The ordered gate did not close. Dispatching `accuracy-validator` now would cross
that lock, so I did not. **This is a deliberate non-dispatch, not an omission.**

---

## 9. STATUS AGAINST §5's REQUIRED FACTS

| # | fact | disposition |
|---|---|---|
| 1 | 09:30 ET session | span exists (`7558`); condition UNANCHORED (`confluences[0]`) |
| 2 | OPENING_RANGE_WINDOW 5m | span exists (`8689`); condition UNANCHORED (`entry_sequence[0].action`) |
| 3 | BREAKOUT_CONFIRMATION close vs print | **close IS taught** (`9474`); condition UNANCHORED (`confluences[1]`) |
| 4 | FVG_DETECTION outside range | anchored, tier-1 fall-through — needs blind rater |
| 5 | ENTRY_COMPLETION third candle | span exists (`13336`); fall-through — needs blind rater |
| 6 | STOP geometry | 🛑 **UNRESOLVED_SOURCE_AMBIGUITY** — source teaches candle AND gap (§5.1) |
| 7 | TARGET fixed 2R | `targets[].rationale` anchored; fall-through — needs blind rater |
| 8 | DIRECTION both | not adjudicated; short-side stop geometry stays fail-closed |

**0 of 8 are certified. None may be treated as grounded on this run.**

---

```
STOP   : FIRED — AR-1138 §6 ("if any load-bearing condition is unanchored … STOP AND REPORT
         with the exact failing condition/span/axis") and §3.1 (stop geometry unresolvable
         from source without a ruling). Reported above with exact fields, spans and axes.
GRADER : NOT dispatched — §9 locks it until the ordered gates close (§8).
NEXT   : GPT's call. The fork I cannot take myself:
         (A) authorize a real blind-rater pass (phase2/phase3) over the 7 fall-through items,
             which still leaves the 5 unanchored forcing certificate_grade=False; or
         (B) rule on whether the anchor-locator's literal-substring contract is the right
             gate at all, given §2.1's own citation fails it and the supporting spans
             demonstrably EXIST in the transcript (§5) — i.e. this may be a LOCATOR
             BINDING defect, not a source-support absence; or
         (C) rule the §3 stop geometry (candle extreme vs gap boundary) from the two
             verbatim spans at 13800 and 18714.
         My recommendation: (B) first. Four of the five unanchored conditions have a real
         supporting span in the pinned bytes that I located by literal search in seconds;
         the locator proposed non-literal paraphrases instead. Grading the extractor on a
         binding failure would convict the wrong layer. But (B) changes an instrument, so
         it is a ruling, not a worker call.
```
