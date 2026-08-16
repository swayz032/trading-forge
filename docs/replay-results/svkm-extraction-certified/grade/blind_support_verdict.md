# Blind anchor-support verdict — svkm-blind-anchor-support-packet

**Rater:** accuracy-validator, independent blind rater (AR-1202 §3/§4 authority relayed by the requesting worker; I did not read the ruling).
**Packet:** `C:\Users\tonio\Projects\wt-claude-worker1-20260815\docs\replay-results\svkm-extraction-certified\grade\blind_support_packet.json`
**Transcript join key:** `transcript_sha256 = df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`
**Date:** 2026-08-15

**Basis of every disposition:** the quoted words alone, per the packet's own `task` field. Transcript-wide probes (§NOVEL ATTACK) were run as attacks on the *packet*, and are reported separately; they did **not** move any disposition. Where a probe would have *rescued* a condition, the disposition still reflects the quoted words, and the rescue is disclosed.

---

## Verdict JSON

```json
{
  "entry_sequence[0].action": {
    "support": "CONFIRMED",
    "candidates_used": ["entry_sequence[0].action#0", "entry_sequence[0].action#1"],
    "unsupported_clauses": [],
    "justification": "#0 fixes the time (9:30 a.m. Eastern) and the object (the first 9:30 candle on the 5-minute); #1 states that this gives 'a range on the five minute' defined by 'how high the price went within the first 5 minutes and that's how low it went'. Both quotes are required: #0 alone never mentions high/low or a range, #1 alone never mentions 9:30 or Eastern. The verb 'marking' is an annotation act not literally present in either quoted span (see NOVEL ATTACK B: the sentence that does state it sits in the 289-char unquoted gap between the two spans); it is not truth-conditional over the range's definition, so it does not reduce the disposition."
  },
  "entry_sequence[1].rationale": {
    "support": "PARTIAL",
    "candidates_used": ["entry_sequence[1].rationale#0"],
    "unsupported_clauses": [
      "'confirms' — the quote says only 'gives us an idea of the direction', a hedged observation; 'confirms' is an epistemic upgrade from a hint to a determination",
      "'The breakout' as the subject — the quote's subject is the bare anaphor 'That', which the quoted span never binds; the quote never mentions a breakout, a close outside a range, or any trigger",
      "'for the trade' — the quote scopes the direction to 'for the day', not to a trade"
    ],
    "justification": "Only the clause 'direction of the market (up or down)' is supported, and even that as an 'idea of' rather than a determination. The condition's subject and its certainty are both absent from the quoted words."
  },
  "entry_sequence[2].rationale": {
    "support": "PARTIAL",
    "candidates_used": ["entry_sequence[2].rationale#0"],
    "unsupported_clauses": [
      "'high-probability' — the quote makes no probability, edge, win-rate or magnitude claim of any kind; it says only that entry is permitted ('we can enter the trade')",
      "'after the initial directional breakout' — the quote's precondition is 'printed outside of the range and confirming'; it states no breakout, no ordering relative to an 'initial' event, and no direction",
      "'The FVG' as the subject — the quoted span says 'this gap', an unbound anaphor; the span never names a fair value gap"
    ],
    "justification": "The quote supports 'the gap printing outside the range permits entry'. It supports neither the probability adjective nor the breakout precondition. The span also relies on the undefined term 'confirming', which the speaker himself defers ('what do I mean by confirming?') to text outside the span, so the precondition cannot be settled from the quoted words at all."
  },
  "confluences[0].description": {
    "support": "PARTIAL",
    "candidates_used": ["confluences[0].description#0"],
    "unsupported_clauses": [
      "'during the ... session' — the quote licenses a point in time ('needs to be traded at 9:30 a.m.'), not a window. A trade initiated at 10:30 satisfies the condition text and violates the quote, so the condition is strictly laxer than its evidence",
      "'New York session' as a named session — in the quote 'New York time' is a timezone gloss apposed to 'Eastern time', not a trading session"
    ],
    "justification": "The obligation ('needs to be' -> 'must'), the clock time and the timezone are all squarely supported. The drift is the conversion of a point-in-time requirement into a session-long window, and of a timezone label into a session name."
  },
  "confluences[1].description": {
    "support": "PARTIAL",
    "candidates_used": ["confluences[1].description#0"],
    "unsupported_clauses": [
      "'The 1m candle' — the quote says 'the candles', with no timeframe stated anywhere in the span",
      "singular vs plural — the quote requires 'candles' (plural) to close outside; the condition narrows this to a single candle, a materially weaker trigger",
      "'initial' 5m range — the quote says 'this 5m minute range', an unbound anaphor; the span does not establish that this is the first/opening range"
    ],
    "justification": "The obligation and the geometry ('has to happen ... close outside of this 5m minute range') are supported. The 1-minute timeframe, the singular, and 'initial' are not in the quoted words. (Disclosed: the source does carry the timeframe 103 chars before the span — see NOVEL ATTACK D — but the packet's chosen span excludes it, and the packet's rule is quote-bound.)"
  }
}
```

---

## NOVEL ATTACK

Four attacks, all on the packet rather than on the conditions. Every absence claim below carries a positive control.

**A. Locator integrity (join key = the claim).** I recomputed `sha256` over the fixture
`src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt` and it matches the packet's
declared `transcript_sha256` byte-for-byte (25,071 bytes, 0 newlines — so no CRLF/LF ambiguity can shift an
offset). All 6 quotes are byte-exact at their declared `char_span`, each `char_span` width equals its quote
length exactly, and each quote occurs exactly **once** in the transcript (no ambiguous locator).
*Positive control:* shifting every span by +1 char makes all 6 comparisons report False, so the check has a
path to red. **Result: no offset drift, no fabricated quote, no ambiguous anchor. The packet's mechanics are sound.**

**B. Two-quote smuggling audit (item 1).** Item 1 is the only two-quote item; its spans are 289 chars apart
(8355 -> 8644). I read the unquoted gap. It says:

> ", right? I'm just going to go ahead and get my horizontal raid tool here, or your trend tool, whichever one
> you want. I like using the horizontal ray on Trading View. And I'm just going to go ahead and **mark the high
> of the candle here. And then I'm going to go ahead and mark out the low.** "

**The one sentence in the transcript that literally supports the condition's verb 'marking the high and low' is
the sentence the packet left out.** The gap does not contradict the pairing (so combining #0 and #1 is safe —
no smuggled fact), but the packet under-quotes its own best evidence. Fix point: the quote window for
`entry_sequence[0].action` should span 8191..8797 continuously rather than as two islands.

**C. Transcript-wide vocabulary census on the conditions' load-bearing words.** For each disputed word I asked
not "is it in the quote" but "does it exist anywhere in the 25,071-char source":

| condition word | occurrences transcript-wide | reading |
|---|---|---|
| `probability` / `high probability` / `high-probability` | **0 / 0 / 0** | extractor-introduced; no source anywhere |
| `breakout` / `break out` | **0 / 0** | extractor-introduced; no source anywhere |
| `FVG` | 0 (but `fair value gap` = 16) | vocabulary substitution only; concept is real in the source |
| `1m` / `1-minute` / `1 minute` | 0 / 0 / 0 (but `one minute` = 3) | notation substitution only; concept is real in the source |
| `new york session` | 1, at offset 10337 — ~3,000 chars *after* item 4's quote, and it is a volatility remark ("the New York session is the most volatile session"), not a timing requirement | the condition's session framing is not sourced from the quoted evidence |

This splits the four PARTIALs into two distinct defect classes, which a quote-bound reading alone cannot
distinguish: **items 3's `high-probability` and 2's/3's `breakout` are unsupported by the ENTIRE DOCUMENT, not
merely by the chosen span** — these are extractor inventions. Items 3's `FVG` and 5's `1m` are mere notation
substitution for concepts the speaker does state. The former class is a fidelity defect; the latter is a
locator/window defect. *Positive control on the census:* the same counter returns 16 for `fair value gap` and 3
for `one minute` in the same pass, so a zero is a measurement, not a broken matcher.

**D. Span-truncation pattern (the packet systematically cuts one clause short).** For three of five items the
words that would settle the disputed clause sit just outside the chosen window:
- item 1: `mark the high ... mark out the low` — inside the 289-char gap the packet skipped (attack B);
- item 5: `waiting for the one minute time frame candles to print` at offset 9329 — **103 chars before** the span start of 9432;
- item 3: `what do I mean by confirming? Well, in order for this fair value gap...` at 12556 — **24 chars past** the span end of 12532, i.e. the speaker's own definition of the quoted span's key term is excluded.

**Consequence for whoever consumes this grade:** a blind rater judging the quoted words (as instructed) and a
rater judging the source will disagree on items 1 and 5 for reasons that are the *packet's* fault, not the
extractor's. My PARTIALs on items 1-clause-`marking` and item 5-clause-`1m` are therefore evidence about the
**locator windows**; my PARTIALs on items 2 and 3 (`confirms`, `high-probability`, `breakout`) are evidence
about the **extractor**, and those survive any widening of the window because the words exist nowhere in the
transcript. Do not average these two classes into one score.

---

## LIMITATIONS

- **Quote-bound by construction.** Four of six quotes open on an unbound anaphor (`That`, `this gap`,
  `this 5m minute range`, `the candles`). Judging "from the quoted words alone" therefore structurally
  penalises them. I applied the packet's rule as written and disclosed every case where the source rescues the
  clause. If the intended question was "is the condition faithful to the *source*", items 1 and 5 would likely
  become CONFIRMED and items 2 and 3 would **not** — re-issue the packet with wider windows if that is the question.
- **Item 4 turns on a reading.** If "the 9:30 AM ET New York session" is read as a proper-noun label for the
  instant 9:30 rather than as a window, item 4 is CONFIRMED. I applied the "default to the weaker disposition"
  rule and the window reading, because `during <session>` admits 10:30 while the quote does not.
- **I did not verify** that the fixture transcript is the transcript the extractor actually consumed — I verified
  only that its bytes hash to the value the packet declares. If the extractor read a different copy (e.g. the DB
  column), that is an unchecked second identity.
- **I did not verify** the `item_id` join — i.e. that `entry_sequence[0].action` in the packet is the same field
  as `entry_sequence[0].action` in the extraction output. Doing so required opening
  `sVkmZklJDHI.json`, which I judged to be the extractor's full output and therefore expectation-adjacent.
  **This is an open hole: if the packet mis-labelled which condition text belongs to which item_id, every
  disposition above is correct about the wrong object.** The requester must close it.
- **I did not measure** whether these five items are representative of the extraction, nor how they were
  selected — the selector (`scripts/svkm_build_blind_support_packet.py`) was left unopened deliberately (see
  contamination note). A five-item sample supports no population claim.
- **No probability bound is offered.** Five judged items is a sample, not a rate; "4/5 PARTIAL" is not an
  extraction defect rate and must not be reported as one.

### Contamination disclosure

- **Not read:** anything under `docs/advisor-rulings/` or `advisor-reports/`, any `AR-*` file,
  `AGENT-REPORTS.md`, `ADVISOR-RULINGS.md`, `laneA_locator_binding_diagnostic.json`, `phase1.json`,
  `certificate.json`, any git log or commit message, `sVkmZklJDHI.json`, `PROVENANCE.md`, and the packet-builder
  script.
- **Read:** the packet; the transcript fixture (primary source, not an expectation artifact); a directory listing.
- **Disclosed partial exposure:** the `ls` of `grade/` printed the *filenames*
  `laneA_locator_binding_diagnostic.json`, `laneB_stop_geometry_context.json`, `stopA_direction_probe.json`,
  `certificate.json`, `phase1.json`. Filenames only, no content. The name "locator_binding_diagnostic" is a weak
  hint that locator binding is under investigation. I record it because a disclosed contamination is
  recoverable and a hidden one is not. My offset/locator check (attack A) was independently motivated — verifying
  the join key is standing method here — and it *cleared* the locators rather than convicting them, so the hint
  did not steer the result. All five dispositions rest on the condition-vs-quote reading, which I formed before
  running any transcript probe.

---

## COVERAGE

| item_id | disposition | evidence used | how judged |
|---|---|---|---|
| `entry_sequence[0].action` | CONFIRMED | both quotes (#0 + #1), minimal set = both | quote-bound reading; verified both spans verbatim; audited the 289-char gap between them |
| `entry_sequence[1].rationale` | PARTIAL | quote #0 only | quote-bound reading; transcript-wide census showed `breakout` = 0 occurrences |
| `entry_sequence[2].rationale` | PARTIAL | quote #0 only | quote-bound reading; census showed `probability` = 0 occurrences source-wide; noted the speaker defers "confirming" past the span end |
| `confluences[0].description` | PARTIAL | quote #0 only | quote-bound reading; point-in-time vs window analysis; located the single `New York session` occurrence 3k chars away and off-topic |
| `confluences[1].description` | PARTIAL | quote #0 only | quote-bound reading; census showed the 1-minute concept exists as `one minute` but 103 chars outside the span |

**Absence claims and their positive controls**
1. "No offset drift / no fabricated quote" -> control: +1-char span shift makes all 6 checks report False.
2. "`probability` appears 0 times" -> control: same counter returns 16 for `fair value gap` and 3 for `one minute` in the same pass.
3. "`breakout` appears 0 times" -> same control as (2); additionally `confirm` returns 2, so short-token matching works.
4. "Each quote is unique in the transcript" -> control: counts are computed by full-string `count()`, which returned exactly 1 for all six and >1 for the substring probes.

**Join keys checked**
- `transcript_sha256` (packet) == `sha256(fixture bytes)` — matched exactly.
- `char_span` width == `len(quote)` for all 6 — matched exactly.
- `transcript[start:end] == quote` for all 6 — matched exactly.
- **Not checked:** `item_id` -> extraction-output field identity (see LIMITATIONS).

**Verified via two non-overlapping paths:** the locator claim (span arithmetic on the packet alone, independent
of the transcript; and byte-exact slicing of the transcript at those spans). The support judgments themselves
are single-path by design — they are human-equivalent readings of quoted text, and I state them as such.
