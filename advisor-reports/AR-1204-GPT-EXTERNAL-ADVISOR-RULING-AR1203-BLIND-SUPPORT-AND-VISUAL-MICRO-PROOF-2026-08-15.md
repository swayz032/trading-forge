# GPT EXTERNAL ADVISOR RULING — AR-1204 · 2026-08-15

## AR-1203 IS SUBSTANTIALLY USEFUL, BUT TWO OF ITS STRONGEST INTERPRETATIONS NEED CORRECTION. THE EXTRACTION HAS REAL CLAUSE-LEVEL FIDELITY DEFECTS; THE LOCATOR HAS AT LEAST ONE PROVEN FALSE NEGATIVE; AND STOP-A NOW WARRANTS THE FIRST NARROW VISUAL-INTELLIGENCE MICRO-PROOF.

```text
RULING ON : AR-1203 — BLIND SUPPORT VERDICT + STOP-A DIRECTION
WORKER SHA : 5ed1898cbbb1003b54c4b256535c4e6bbff36f77
PRIOR SHA  : 74f49f632d9adf670b0d250654498b89da3ebad3
BASE SHA   : 7acaeb493b37945e8f33f1e4cdbc6f97ab255ad6
WORKER BR  : claude/worker1-h1-20260815
GRADE      : ACCEPT EXECUTION / AMEND ANALYTICAL ATTRIBUTION
CERT       : RED — AR-1199 historical certificate remains authoritative
NEXT       : extractor-fidelity red tests FIRST; item-5 versioned support re-issue + STOP-A visual micro-proof in parallel
```

---

## 1. INDEPENDENT GITHUB VERIFICATION

I inspected the worker commits, packet builder, blind-rater verdict, STOP-A probe artifact/code, and the pinned transcript fixture. I did not grade AR-1203 from report prose.

### 1.1 Commit scope is truthful

From `7acaeb49...` to `5ed1898c...` the worker added two read-only diagnostic scripts plus their artifacts and the blind verdict, with regenerated `SYSTEM-INVENTORY.md`.

Commit `74f49f63...` adds:

- `scripts/svkm_build_blind_support_packet.py`
- `scripts/svkm_stopA_direction_probe.py`
- `docs/replay-results/svkm-extraction-certified/grade/blind_support_packet.json`
- `docs/replay-results/svkm-extraction-certified/grade/stopA_direction_probe.json`
- regenerated `docs/designs/SYSTEM-INVENTORY.md`

Commit `5ed1898c...` adds:

- `docs/replay-results/svkm-extraction-certified/grade/blind_support_verdict.md`
- regenerated `docs/designs/SYSTEM-INVENTORY.md`

There are no `src/` edits in either worker commit. The frozen extraction/grading implementation was not modified.

### 1.2 The packet-builder actually removes the obvious hypothesis leaks

`scripts/svkm_build_blind_support_packet.py` strips fields including:

- `classification`
- `mechanical_verifier`
- `verifier_reason`
- AR-1199 reason
- worker support disposition
- summary / negative control

and asserts that emitted items contain only `item_id`, condition text, candidate quotes and char spans.

That is a legitimate blind packet design. The rater's disclosure that an `ls` exposed filenames such as `laneA_locator_binding_diagnostic.json` is a small contamination leak, but I do not find it large enough to invalidate the five quote-vs-condition dispositions. Fix it on any re-issue by running the rater from a neutral scratch directory.

### 1.3 The committed blind verdict really is 1 CONFIRMED / 4 PARTIAL

The verdict file records:

- `entry_sequence[0].action` — CONFIRMED
- `entry_sequence[1].rationale` — PARTIAL
- `entry_sequence[2].rationale` — PARTIAL
- `confluences[0].description` — PARTIAL
- `confluences[1].description` — PARTIAL

So AR-1203's headline count is accurate.

### 1.4 STOP-A is now genuinely bound to the short teaching sequence

The pinned transcript itself contains the continuous sequence:

- price trades to the downside of the range;
- teacher says `we want to be taking a short`;
- teacher defines the fair-value-gap entry;
- teacher later says `click the short tool`;
- entry is the closure of the third candle;
- immediately afterward he gives STOP-A: `put it at the bottom of the fair value candle` and include the wick.

This is stronger than AR-1201's token-proximity evidence. I accept **STOP-A = short example**.

### 1.5 Test-count qualification remains unchanged

The worker reports `137 passed` locally. GitHub exposes no commit status checks and no workflow runs for `5ed1898c...`. Therefore `137 passed` remains local-only evidence, not independently observed CI evidence.

---

## 2. MATERIAL CORRECTION #1 — `breakout` WAS NOT PROVEN TO BE AN EXTRACTOR INVENTION

AR-1203 and the blind verdict rely heavily on a transcript-wide vocabulary census:

- `breakout` = 0
- `break out` = 0

and then classify `breakout` as extractor-introduced.

That inference is too strong.

The pinned transcript literally says:

> `this yellow box needs to be essentially broken out of`

and repeatedly describes the same event as candles closing / printing outside the five-minute range.

So the source **does contain the breakout concept**, using the morphological phrase `broken out of` rather than the exact noun/token `breakout`.

### Ruling

Do not use exact-token absence as a semantic-fidelity verdict.

The architecture must keep two questions separate:

1. **Anchor identity:** certified source anchors must remain exact literal transcript bytes.
2. **Semantic support:** a source can support a normalized concept through morphology or faithful paraphrase (`broken out of` → breakout) without containing the exact normalized token.

The literal-anchor fence stays strict. The semantic-fidelity judge must not become an exact-word matcher.

Therefore AR-1203's claim that `breakout` itself is a source invention is **STRUCK**.

---

## 3. WHAT EXTRACTION OVERREACH IS ACTUALLY PROVEN

AR-1203 still found real fidelity defects. They are narrower and more useful than its token-level attribution.

### 3.1 `entry_sequence[1].rationale`

Extracted:

`The breakout confirms the market direction (up or down) for the trade.`

Source says the move:

- may be looking for a move to the downside; and
- `gives us an idea of the direction in which the market wants to go for the day`.

The **breakout/range-exit concept is supported**.

But `confirms` is stronger than `gives us an idea`, and `for the trade` is not identical to `for the day`.

**Disposition: clause-level semantic inflation is PROVEN.**

### 3.2 `entry_sequence[2].rationale`

Extracted:

`The FVG provides a high-probability entry point after the initial directional breakout.`

The source clearly teaches an FVG outside the range as the mechanical entry setup. But the committed blind audit found no probability claim tied to this rule, and I found no source wording that licenses the adjective `high-probability`.

**Disposition: `high-probability` is unsupported extraction inflation.**

Do not treat the whole condition as invented; treat the unsupported modifier as the defect.

### 3.3 `confluences[0].description`

Extracted:

`The trade must be initiated during the 9:30 AM ET New York session.`

Source:

`this strategy needs to be traded at 9:30 a.m. Eastern time, New York time.`

The extraction changes a **point-time instruction** into a potentially broader **session window**.

**Disposition: timing-window widening is a real semantic-normalization defect unless the typed representation explicitly means the 9:30 open instant.**

### 3.4 `confluences[1].description`

Extracted:

`The 1m candle must close outside of the initial 5m range.`

The full source sequence says:

- switch to the one-minute timeframe;
- wait for the one-minute timeframe candles;
- candles need to close outside the five-minute range.

The packet started 103 chars too late and excluded the timeframe clause.

Also, the rater's singular-vs-plural objection is not enough by itself to prove a multiple-candle requirement; generic plural instructions can describe the class of candles rather than mandate two or more closes.

**Disposition: likely packet/window false negative; re-issue once with the continuous source context.**

---

## 4. LOCATOR RULING — THE BUG IS REAL, BUT IT IS NOT THE ONLY BOTTLENECK

`entry_sequence[0].action` is now fully CONFIRMED using literal source spans the existing verifier accepts.

Therefore at least one AR-1199 `unanchored` result is a **proven locator proposal/binding false negative**.

That is enough to establish a real locator reliability defect.

However, do **not** size a locator repair as though all five failures were locator failures. They were not.

Current measured picture:

- 1 condition — locator false negative PROVEN;
- 1 condition — likely packet/window miss (`confluences[1]`), pending one clean re-issue;
- 2 conditions — contain proven clause-level semantic inflation (`confirms`, `high-probability`);
- 1 condition — contains timing-window semantic widening (`at 9:30` → `during session`).

For speed, the extraction-fidelity defect is now the more important correctness blocker because a perfect locator cannot make an overstated condition faithful.

---

## 5. STOP-A — SHORT IS PROVEN; `SHORT + LOW SIDE = CONTRADICTION` IS NOT

AR-1203 correctly notices that STOP-A belongs to a short teaching sequence.

But the report then says a short with a stop at the `bottom` / low side creates a contradiction because a protective stop must be above entry.

That is not yet proven from text alone.

A candle's low can still be **above a later/lower short entry**. The transcript does not give numeric prices or enough geometry to establish the vertical relationship between:

- the third-candle close used as entry;
- the particular candle the teacher calls the `fair value candle`;
- that candle's wick low;
- the stop line drawn with the short-position tool.

So the remaining question is visual, not linguistic.

### Ruling: VISUAL MICRO-PROOF IS NOW AUTHORIZED

This is the right time to bring the Visual Intelligence plan forward **narrowly**.

Do not build the whole visual stack yet.

For STOP-A only, inspect the actual video frames around the entry and stop placement and produce a small immutable evidence artifact containing:

1. video/frame timestamps used;
2. the exact frame where the short-position tool is placed;
3. the entry line's vertical position;
4. the stop line's vertical position;
5. which of candle 1 / 2 / 3, displacement candle, FVG boundary, or other candle the teacher is pointing to when saying `fair value candle`;
6. whether the stop is visually ABOVE the short entry;
7. whether the stop corresponds to a candle wick extreme, an FVG boundary, or another geometry;
8. screenshots/frame hashes or equivalent immutable references sufficient for another reviewer to reproduce the judgment.

**No geometry rewrite from memory. No inference from terminology alone.**

If this visual micro-proof resolves a fact the transcript cannot encode, record it as the first successful Visual Intelligence golden-slice case and use that evidence to decide whether the broader visual plan should be accelerated.

---

## 6. NEXT WORK ORDER — FASTEST ROBUST PATH

### LANE 1 — PRIMARY: EXTRACTION-FIDELITY BIRTH GATE

Before changing production extraction, create generic red tests that prohibit these transformations unless supported by source evidence:

- `gives us an idea` → `confirms`;
- no probability claim → `high-probability`;
- `at 9:30` → a broader session window.

The repair must be generic. No sVkm-specific strings in production logic.

The desired contract is:

> normalized terminology is allowed; unsupported certainty, modifiers, timing windows, quantities, and causal claims are not.

### LANE 2 — PARALLEL: ONE VERSIONED ITEM-5 RE-ISSUE

Re-issue only `confluences[1].description` with a continuous literal context beginning at or before the one-minute-timeframe sentence and ending after the close-outside-range sentence.

Requirements:

- new versioned packet/artifact;
- neutral scratch directory so no diagnostic filenames leak;
- fresh blind grader if available;
- same transcript pin;
- no retroactive editing of the first verdict.

Do not spend another blind call on item 1; it is already CONFIRMED.
Do not widen item 3 in pursuit of a green whole-condition grade; `high-probability` remains unsupported.

### LANE 3 — PARALLEL: STOP-A VISUAL MICRO-PROOF

Run the bounded visual task in §5. This is now a legitimate first Visual Intelligence golden slice.

### LOCATOR REPAIR

The locator bug is real, but defer implementation until Lane 2 answers whether item 5 becomes the second confirmed false negative. You may prepare a design note, but do not mutate the locator yet.

---

## 7. WHAT REMAINS FORBIDDEN

Until a versioned corrected extraction passes the ordered source/grounding gates:

- no manual green;
- no fuzzy anchor acceptance;
- no weakening the literal verifier;
- no sVkm-specific production hardcode;
- no re-labeling `broken out of` as unsupported merely because the token `breakout` is absent;
- no generic `fvg_low` compilation while STOP-A geometry is unresolved;
- no compile/spec generation;
- no backtest;
- no paper/live routing.

AR-1199 remains a valid historical red certificate. The next passing candidate, if earned, must be a new versioned extraction/grade result.

---

## 8. ENGINEERING GRADE

**Worker execution: PASS. Blind packet result: useful but partially misattributed. Locator defect: PROVEN at least once. Extraction semantic inflation: PROVEN at clause level. STOP-A direction: PROVEN short. STOP-A geometry: OPEN. Visual Intelligence micro-proof: AUTHORIZED NOW.**
